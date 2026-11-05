// 리뷰 재생 (docs/m2.1-design.md 14절 0단계 O2: V26 기준표, V30 요청 대조). 저장된 M2 내보내기 묶음에 지금의 리뷰어를 다시
// 돌린다: core/review.ts의 프롬프트(요청 포함, 지금 판)와 스키마, adapters/claude.ts의 claude -p, 앱과 같은 읽기 도구와 시간
// 상한(main/works-review.ts). claude의 환경은 평가가 앱에 준 것이다: run.json options의 에이전트 모델과 effort를
// ANTHROPIC_MODEL, CLAUDE_CODE_EFFORT_LEVEL로 준다(relay-v2 eval lib/env.mjs agentEnv. 앱의 리뷰어가 물려받았다).
//   node scripts/review-replay.ts [--dry] [--out <파일.jsonl>] [--resume] [--summary] [--jobs <n>] [--limit <n>]
//                                 [--results <폴더>] [--scenarios <폴더>] [--prompts <폴더>] [--keep]
// - 대상: A는 14에서 숨긴 시험이 실패한 relay3·relay3-noreview 묶음(8개)을 3번씩, B는 통과한 묶음을 07, 08, 10, 19, 40, 43에서
//   다섯씩(30개) 1번씩. B는 (회차, 쪽, Work id) 차례로 실행마다 첫 Work를 먼저, 모자라면 같은 차례로 나머지에서 고른다.
// - 묶음은 gate-replay-fixture.ts의 규칙이다: results/m2-main-<시나리오>(report.json이 있는 배치), 오류 없이 숨긴 시험 결과가
//   있는 실행, works[].gate.export가 참이고 evidence.json의 head가 exportedHead인 Work.
// - 레포: 시나리오의 repo/에 품질 기준 덧씌우기(지금의 relay init 초안, run.json의 sha256과 견줌)를 얹어 base로, final/<Work>.diff
//   (평가의 `git diff --no-index base tree`라 a/base/, b/tree/가 붙는다)를 git apply -p2로 얹어 head로 커밋한 임시 checkout.
//   diff와 diff stat은 앱처럼 base..head로 낸다. 최종 diff는 실행 끝의 작업 트리라 증거의 diff와 견준다(same_as_evidence).
// - 계약은 앱처럼 parseContract로 읽는다. 증거 요약은 저장된 묶음 그대로의 evidenceFacts다(관문 재생과 같다). 예시 자료 확인
//   (V27)은 넣지 않는다: M2 세션이 손으로 쓴 자료(배열 등)는 지금의 정규 꼴이 아니라 38개 가운데 29개가 다름·읽지 못함이 된다.
// - 결과는 JSONL(한 줄이 호출 하나, 모델 이름은 쓰지 않는다). --resume은 끝난 호출을 건너뛴다. 끝에 14절의 통과 기준과 보고만
//   하는 값을 찍는다(--summary는 찍기만). --dry는 claude 대신 고정 지적의 가짜 리뷰어다(레포와 프롬프트는 그대로, 판정에 안 씀).
import { createHash } from 'node:crypto'
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { claudeJson, findClaude, type ClaudeJsonResult } from '../src/adapters/claude.ts'
import { git } from '../src/adapters/exec.ts'
import { killRunFiles } from '../src/adapters/pty.ts'
import { contractHash, parseContract } from '../src/core/contract.ts'
import { evidenceFacts, parseReview, raises, REVIEW_PROMPT_VERSION } from '../src/core/review.ts'
import { REVIEW_SCHEMA, reviewPrompt } from '../src/core/review.ts'
import type { EvidenceBundle, ReviewFinding } from '../src/core/types.ts'
import { QUALITY_PATH } from '../src/engine/check.ts'
import { draftFor, draftText } from '../src/engine/init.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const ARMS = ['relay3', 'relay3-noreview']
/** 리뷰어의 읽기 도구. main/works-review.ts REVIEW_TOOLS와 같다([단위]가 본다) */
export const REVIEW_TOOLS = ['Read', 'Grep', 'Glob']
/** main/works-review.ts REVIEW_TIMEOUT_MS와 같다 */
const TIMEOUT_MS = 15 * 60 * 1000
/** 평가의 copyTree(relay-v2 eval lib/util.mjs)가 빼는 것 */
const SKIP = new Set(['.git', 'node_modules', '.relay-out'])
const GIT_ID = ['-c', 'user.name=relay review replay', '-c', 'user.email=replay@relay.invalid']

/** 14절의 대상과 통과 기준. A: 3번 중 gaps번 이상 request_gap인 묶음이 hits개 이상. B: request_gap인 묶음이 hits개 이하 */
export const TARGET_A = { scenario: '14-double-notify', bundles: 8, repeats: 3, gaps: 2, hits: 4 }
const B_LIST = '07-two-bugs 08-timezone 10-invoice-rounding 19-split-report 40-three-libraries'
const B_SCENARIOS = `${B_LIST} 43-split-engines`.split(' ')
export const TARGET_B = { scenarios: B_SCENARIOS, each: 5, hits: 4 }
const B_BUNDLES = TARGET_B.scenarios.length * TARGET_B.each
const DESIGN_CALLS = TARGET_A.bundles * TARGET_A.repeats + B_BUNDLES

/** --dry의 가짜 리뷰어가 내는 고정 지적(structured_output 꼴): 올림 둘(request_gap/low, 구조/medium), 메모 둘 */
export const DRY_FINDINGS = [
  { severity: 'low', raise: 'request_gap', text: '가짜 리뷰어(--dry): 요청과 어긋남' },
  { severity: 'medium', raise: 'structure', text: '가짜 리뷰어(--dry): 구조 medium' },
  { severity: 'low', raise: 'structure', text: '가짜 리뷰어(--dry): 구조 low' },
  { severity: 'low', text: '가짜 리뷰어(--dry): 갈래 없음' },
]

type Target = 'A' | 'B'

/** run.json options에서 읽는 칸(relay-v2 eval episode.mjs) */
export interface RunOptions {
  agentModel?: string
  effort?: string
  humanMode?: string
  qualityOverlay?: { sha256?: string } | null
}

/** 저장된 내보내기 묶음 하나 */
export interface Bundle {
  scenario: string
  arm: string
  run: number
  work: string
  hidden_pass: boolean
  /** 실행 폴더(<시나리오>/<쪽>-<n>) */
  dir: string
  options: RunOptions
}

export interface Call {
  target: Target
  key: string
  repeat: number
}

interface CheckoutFacts {
  /** 덧씌운 품질 기준이 평가의 것과 같은가(run.json의 sha256) */
  overlay: 'same' | 'differs' | 'not_recorded'
  /** 다시 만든 base..head가 증거의 diff(경로, 더한 줄, 뺀 줄)와 같은가 */
  same_as_evidence: boolean
  /** 증거의 계약 hash가 contract.json과 같은가 */
  contract_same: boolean
}

/** JSONL 한 줄: 리뷰 호출 하나 */
export interface Line {
  key: string
  target: Target
  scenario: string
  arm: string
  run: number
  work: string
  hidden_pass: boolean
  repeat: number
  dry: boolean
  prompt_version: number
  status: 'done' | 'failed'
  error?: string
  /** 리뷰어에게 요청을 줬는가(request.md를 읽었는가) */
  request: boolean
  prompt_chars: number
  findings: ReviewFinding[]
  /** 올림(core raises)의 '갈래/심각도'별 수 */
  raises: Record<string, number>
  /** 메모: 올림이 아닌 지적의 수 */
  memos: number
  request_gap: boolean
  usage: Record<string, number> | null
  ms: number
  checkout: CheckoutFacts | null
}

/** 리뷰어: 프롬프트를 받아 claude -p의 결과 꼴을 낸다. 던지지 않는다 */
type ReviewCall = { cwd: string; prompt: string; env: Record<string, string> }
export type Reviewer = (o: ReviewCall) => Promise<ClaudeJsonResult>

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const sha256 = (t: string) => createHash('sha256').update(t).digest('hex')
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
export const keyOf = (b: Pick<Bundle, 'scenario' | 'arm' | 'run' | 'work'>) =>
  `${b.scenario}/${b.arm}-${b.run}/${b.work}`

// ── 묶음 고르기 ─────────────────────────────────────────────────────────────

interface StoredRun {
  error?: unknown
  outcome?: { success?: unknown } | null
  options?: RunOptions
  works?: { id: string; exportedHead?: string | null; gate?: { export?: boolean } }[]
}

/** 배치 하나(results/m2-main-<시나리오>)의 relay3·relay3-noreview 내보내기 묶음 */
export function readBundles(results: string, scenario: string): Bundle[] {
  const batch = path.join(results, `m2-main-${scenario}`)
  const sDir = path.join(batch, scenario)
  if (!existsSync(path.join(batch, 'report.json')) || !existsSync(sDir)) return []
  const out: Bundle[] = []
  for (const name of readdirSync(sDir).sort()) {
    const [, arm = '', n] = /^(.+)-(\d+)$/.exec(name) ?? []
    const dir = path.join(sDir, name)
    if (!ARMS.includes(arm) || !existsSync(path.join(dir, 'run.json'))) continue
    const run = readJson<StoredRun>(path.join(dir, 'run.json'))
    const success = run.outcome?.success
    if (run.error !== undefined && run.error !== null) continue
    if (typeof success !== 'boolean' || run.options?.humanMode === 'hands-off') continue
    const options = run.options ?? {}
    const id = { scenario, arm, run: Number(n), hidden_pass: success, dir, options }
    for (const w of run.works ?? []) {
      const ev = path.join(dir, 'works', w.id, 'evidence.json')
      if (w.gate?.export !== true || !existsSync(ev)) continue
      if (readJson<EvidenceBundle>(ev).head === w.exportedHead) out.push({ ...id, work: w.id })
    }
  }
  return out
}

const order = (a: Bundle, b: Bundle) => a.run - b.run || cmp(a.arm, b.arm) || cmp(a.work, b.work)

/** n개를 고른다: (회차, 쪽, Work) 차례로 실행마다 첫 Work를 먼저, 모자라면 같은 차례로 나머지에서 */
export function spread(bundles: Bundle[], n: number): Bundle[] {
  const sorted = [...bundles].sort(order)
  const seen = new Set<string>()
  const first = sorted.filter((b) => !seen.has(b.dir) && seen.add(b.dir))
  return [...first, ...sorted.filter((b) => !first.includes(b))].slice(0, n)
}

/** 14절의 계획: 대상 A(모두, 3번씩)와 B(시나리오마다 다섯, 1번씩) */
export function plan(all: Bundle[]): { target: Target; bundle: Bundle; repeats: number }[] {
  const a = all.filter((b) => b.scenario === TARGET_A.scenario && !b.hidden_pass).sort(order)
  const passed = (s: string) => all.filter((x) => x.scenario === s && x.hidden_pass)
  const b = TARGET_B.scenarios.flatMap((s) => spread(passed(s), TARGET_B.each))
  const as = (target: Target, repeats: number) => (bundle: Bundle) => ({ target, bundle, repeats })
  return [...a.map(as('A', TARGET_A.repeats)), ...b.map(as('B', 1))]
}

export function callsOf(p: ReturnType<typeof plan>): Call[] {
  return p.flatMap(({ target, bundle, repeats }) =>
    Array.from({ length: repeats }, (_, i) => ({ target, key: keyOf(bundle), repeat: i + 1 })),
  )
}

// ── 레포와 리뷰 ─────────────────────────────────────────────────────────────

/** 평가가 앱에 준 claude 환경(relay-v2 eval lib/env.mjs agentEnv) */
export function evalEnv(o: RunOptions): Record<string, string> {
  return {
    ...(o.agentModel ? { ANTHROPIC_MODEL: o.agentModel } : {}),
    ...(o.effort ? { CLAUDE_CODE_EFFORT_LEVEL: o.effort } : {}),
  }
}

/** 사용량의 수 칸만(맨 위) */
export function slimUsage(u: object | undefined): Record<string, number> | null {
  if (u === undefined) return null
  return Object.fromEntries(Object.entries(u).filter(([, v]) => typeof v === 'number'))
}

/** 다시 만든 diff의 numstat이 증거의 diff와 같은가 */
export function sameDiff(numstat: string, d: EvidenceBundle['diff']): boolean {
  const rows = numstat.split('\n').flatMap((l) => (l === '' ? [] : [l.split('\t')]))
  const sum = (i: number) => rows.reduce((n, r) => n + (Number(r[i]) || 0), 0)
  const paths = rows.map((r) => r.slice(2).join('\t')).sort()
  const want = [...d.paths].sort()
  return sum(0) === d.added && sum(1) === d.deleted && paths.join('\n') === want.join('\n')
}

async function makeCheckout(b: Bundle, scenarios: string, ev: EvidenceBundle) {
  const dir = mkdtempSync(path.join(tmpdir(), 'relay-review-replay-'))
  try {
    const filter = (src: string) => !SKIP.has(path.basename(src))
    cpSync(path.join(scenarios, b.scenario, 'repo'), dir, { recursive: true, filter })
    await git(['init', '-q', '-b', 'main'], dir)
    const text = draftText(await draftFor(dir))
    mkdirSync(path.dirname(path.join(dir, QUALITY_PATH)), { recursive: true })
    writeFileSync(path.join(dir, QUALITY_PATH), text)
    const want = b.options.qualityOverlay?.sha256
    const commit = async (msg: string) => {
      await git(['add', '-A'], dir)
      const flags = ['-q', '--no-verify', '--no-gpg-sign', '--allow-empty', '-m', msg]
      await git([...GIT_ID, 'commit', ...flags], dir)
      return (await git(['rev-parse', 'HEAD'], dir)).trim()
    }
    const base = await commit('base')
    const patch = path.join(b.dir, 'final', `${b.work}.diff`)
    if (readFileSync(patch, 'utf8').trim() !== '')
      await git(['apply', '-p2', '--whitespace=nowarn', patch], dir)
    const head = await commit('head')
    const [diffStat, diff, numstat] = await Promise.all([
      git(['diff', '--stat', '--no-color', base, head], dir),
      git(['diff', '--no-color', '--no-ext-diff', base, head], dir),
      git(['diff', '--numstat', '--no-color', base, head], dir),
    ])
    const overlay = want === undefined ? 'not_recorded' : sha256(text) === want ? 'same' : 'differs'
    const facts = { overlay, same_as_evidence: sameDiff(numstat, ev.diff) } as const
    return { dir, diffStat, diff, facts }
  } catch (e) {
    rmSync(dir, { recursive: true, force: true })
    throw e
  }
}

/** claude -p 리뷰어: 앱의 claudeReview(main/works-review.ts)와 같은 어댑터, 스키마, 도구, 시간 상한 */
export function claudeReviewer(bin: string): Reviewer {
  const call = { bin, schema: REVIEW_SCHEMA, allowedTools: REVIEW_TOOLS, timeoutMs: TIMEOUT_MS }
  return (o) => claudeJson({ ...call, ...o })
}

export const dryReviewer: Reviewer = () =>
  Promise.resolve({ ok: true, value: { findings: DRY_FINDINGS }, usage: {} })

const EMPTY = { findings: [], raises: {}, memos: 0, request_gap: false }

type ReviewFields = Pick<Line, 'status' | 'error' | keyof typeof EMPTY | 'usage'>

/** 리뷰 결과에서 줄의 리뷰 칸 */
export function reviewFields(r: ClaudeJsonResult): ReviewFields {
  if (!r.ok) return { status: 'failed', error: r.error, ...EMPTY, usage: null }
  const usage = slimUsage(r.usage)
  const parsed = parseReview(r.value)
  const error = parsed.ok ? '' : `리뷰 결과를 읽지 못함: ${parsed.errors.join('; ')}`
  if (!parsed.ok) return { status: 'failed', error, ...EMPTY, usage }
  const findings = parsed.value
  const counts: Record<string, number> = {}
  for (const f of findings.filter(raises)) {
    const k = `${f.raise ?? ''}/${f.severity}`
    counts[k] = (counts[k] ?? 0) + 1
  }
  const gap = findings.some((f) => f.raise === 'request_gap' && raises(f))
  const memos = findings.filter((f) => !raises(f)).length
  return { status: 'done', findings, raises: counts, memos, request_gap: gap, usage }
}

interface RunOpts {
  scenarios: string
  reviewer: Reviewer
  dry: boolean
  out: string
  keep: boolean
  prompts: string | undefined
  progress: (line: Line) => void
}

/** 묶음 하나: 레포를 만들고 반복마다 리뷰어를 불러 줄을 쓴다. 준비가 실패하면 반복마다 실패 줄 */
async function runBundle(b: Bundle, target: Target, repeats: number[], o: RunOpts): Promise<void> {
  const key = keyOf(b)
  const { scenario, arm, run, work: id, hidden_pass } = b
  const common = { key, target, scenario, arm, run, work: id, hidden_pass, dry: o.dry }
  const prompt_version = REVIEW_PROMPT_VERSION
  const write = (line: Line) => {
    appendFileSync(o.out, `${JSON.stringify(line)}\n`)
    o.progress(line)
  }
  let co: Awaited<ReturnType<typeof makeCheckout>> | null = null
  try {
    const work = path.join(b.dir, 'works', b.work)
    const ev = readJson<EvidenceBundle>(path.join(work, 'evidence.json'))
    const parsed = parseContract(readFileSync(path.join(work, 'contract.json'), 'utf8'))
    if (!parsed.ok) throw new Error(`계약을 읽지 못함: ${parsed.errors.join('; ')}`)
    const contract = parsed.value
    const reqPath = path.join(work, 'request.md')
    const request = existsSync(reqPath) ? readFileSync(reqPath, 'utf8') : null
    co = await makeCheckout(b, o.scenarios, ev)
    const facts = { ...co.facts, contract_same: ev.contract?.hash === contractHash(contract) }
    const input = { contract, request, diffStat: co.diffStat, diff: co.diff }
    const prompt = reviewPrompt({ ...input, evidenceSummary: evidenceFacts(ev) })
    if (o.prompts !== undefined) {
      mkdirSync(o.prompts, { recursive: true })
      writeFileSync(path.join(o.prompts, `${key.replaceAll('/', '_')}.md`), prompt)
    }
    for (const repeat of repeats) {
      const t0 = Date.now()
      const r = await o
        .reviewer({ cwd: co.dir, prompt, env: evalEnv(b.options) })
        .catch((e: unknown): ClaudeJsonResult => ({ ok: false, error: message(e) }))
      const rest = { request: request !== null, prompt_chars: prompt.length, checkout: facts }
      write({ ...common, prompt_version, repeat, ...reviewFields(r), ...rest, ms: Date.now() - t0 })
    }
  } catch (e) {
    const fail = { status: 'failed' as const, error: `준비 실패: ${message(e)}`, ...EMPTY }
    const none = { request: false, usage: null, prompt_chars: 0, ms: 0, checkout: null }
    for (const repeat of repeats) write({ ...common, prompt_version, repeat, ...fail, ...none })
  } finally {
    if (co !== null && !o.keep) rmSync(co.dir, { recursive: true, force: true })
  }
}

// ── 요약 ────────────────────────────────────────────────────────────────────

interface Row {
  key: string
  planned: number
  done: Line[]
}

export interface Summary {
  dry: boolean
  calls: { planned: number; done: number; failed: number; missing: number }
  /** 계획이 설계의 규모(A 8×3, B 30×1)인가 */
  design: boolean
  a: { rows: Row[]; hits: number; pass: boolean | null }
  b: { rows: Row[]; hits: number; pass: boolean | null }
  structure: Record<Target, { all: number; up: number }>
  raises: Record<Target, Record<string, number>>
  flips: { bundles: number; request_gap: number; any_raise: number; structure_up: number }
  checkout: { diff_differs: string[]; overlay_differs: string[]; contract_differs: string[] }
  usage: { input: number; output: number }
}

const up = (f: ReviewFinding) => f.raise === 'structure' && f.severity !== 'low'
const raised = (l: Line) => Object.values(l.raises).reduce((a, n) => a + n, 0)
const num = (l: Line, k: string) => l.usage?.[k] ?? 0
const INPUT = ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']
const tokens = (l: Line) => INPUT.reduce((n, k) => n + num(l, k), 0)

/** 계획된 호출마다 끝난 줄(다시 돈 것은 뒤의 끝난 줄)로 14절의 기준과 보고 값을 센다 */
export function summarize(lines: Line[], calls: Call[]): Summary {
  const latest = new Map<string, Line>()
  for (const l of lines) {
    const k = `${l.key}#${l.repeat}`
    if (!(latest.get(k)?.status === 'done' && l.status !== 'done')) latest.set(k, l)
  }
  const rows: Record<Target, Row[]> = { A: [], B: [] }
  const calls_ = { planned: calls.length, done: 0, failed: 0, missing: 0 }
  for (const c of calls) {
    const l = latest.get(`${c.key}#${c.repeat}`)
    let row = rows[c.target].find((r) => r.key === c.key)
    if (row === undefined) rows[c.target].push((row = { key: c.key, planned: 0, done: [] }))
    row.planned += 1
    if (l?.status === 'done') row.done.push(l)
    calls_[l === undefined ? 'missing' : l.status === 'done' ? 'done' : 'failed'] += 1
  }
  const gaps = (r: Row) => r.done.filter((l) => l.request_gap).length
  const complete = (t: Target) => rows[t].every((r) => r.done.length === r.planned)
  const aHits = rows.A.filter((r) => gaps(r) >= TARGET_A.gaps).length
  const bHits = rows.B.filter((r) => gaps(r) > 0).length
  const done = [...rows.A, ...rows.B].flatMap((r) => r.done)
  const structure = { A: { all: 0, up: 0 }, B: { all: 0, up: 0 } }
  const byKind: Record<Target, Record<string, number>> = { A: {}, B: {} }
  for (const l of done) {
    for (const f of l.findings.filter((x) => x.raise === 'structure')) {
      structure[l.target].all += 1
      if (f.severity !== 'low') structure[l.target].up += 1
    }
    for (const [k, n] of Object.entries(l.raises))
      byKind[l.target][k] = (byKind[l.target][k] ?? 0) + n
  }
  const flip = (r: Row, f: (l: Line) => boolean) => new Set(r.done.map(f)).size > 1
  const repeated = [...rows.A, ...rows.B].filter((r) => r.done.length > 1)
  const firsts = [...rows.A, ...rows.B].flatMap((r) => r.done.slice(0, 1))
  const differs = (f: (c: CheckoutFacts) => boolean) =>
    firsts.filter((l) => l.checkout !== null && f(l.checkout)).map((l) => l.key)
  return {
    dry: lines.some((l) => l.dry),
    calls: calls_,
    design: calls.length === DESIGN_CALLS && rows.A.length === TARGET_A.bundles,
    a: { rows: rows.A, hits: aHits, pass: complete('A') ? aHits >= TARGET_A.hits : null },
    b: { rows: rows.B, hits: bHits, pass: complete('B') ? bHits <= TARGET_B.hits : null },
    structure,
    raises: byKind,
    flips: {
      bundles: repeated.length,
      request_gap: repeated.filter((r) => flip(r, (l) => l.request_gap)).length,
      any_raise: repeated.filter((r) => flip(r, (l) => raised(l) > 0)).length,
      structure_up: repeated.filter((r) => flip(r, (l) => l.findings.some(up))).length,
    },
    checkout: {
      diff_differs: differs((c) => !c.same_as_evidence),
      overlay_differs: differs((c) => c.overlay === 'differs'),
      contract_differs: differs((c) => !c.contract_same),
    },
    usage: {
      input: done.reduce((n, l) => n + tokens(l), 0),
      output: done.reduce((n, l) => n + num(l, 'output_tokens'), 0),
    },
  }
}

const verdict = (p: boolean | null) =>
  p === null ? '모름(끝나지 않은 호출이 있음)' : p ? '통과' : '넘지 못함'
const pct = (a: number, b: number) => (b === 0 ? '-' : `${Math.round((a / b) * 100)}%`)
const counts = (r: Record<string, number>) =>
  Object.entries(r)
    .sort(([a], [b]) => cmp(a, b))
    .map(([k, n]) => `${k} ${n}`)
    .join(', ') || '없음'

const list = (keys: string[]) => `${keys.length}${keys.length ? ` (${keys.join(', ')})` : ''}`

export function summaryText(s: Summary): string {
  const marks = (r: Row) => r.done.map((l) => (l.request_gap ? '●' : '○')).join('') || '-'
  const out = [
    `리뷰 재생 (m2.1-design 14절 O2), 프롬프트 판 ${REVIEW_PROMPT_VERSION}${s.dry ? ', --dry: 가짜 리뷰어의 고정 지적이라 판정에 쓰지 않는다' : ''}`,
    `호출: 계획 ${s.calls.planned}, 끝남 ${s.calls.done}, 실패 ${s.calls.failed}, 남음 ${s.calls.missing}${s.calls.failed + s.calls.missing > 0 ? ' (--resume으로 잇는다)' : ''}`,
  ]
  if (!s.design)
    out.push(
      `주의: 계획(A ${s.a.rows.length}묶음, B ${s.b.rows.length}묶음, ${s.calls.planned}번)이 설계(A ${TARGET_A.bundles}×${TARGET_A.repeats}, B ${B_BUNDLES}×1, ${DESIGN_CALLS}번)와 다르다. 판정은 참고`,
    )
  out.push(
    `대상 A (14 실패 묶음 × ${TARGET_A.repeats}번): request_gap을 ${TARGET_A.repeats}번 중 ${TARGET_A.gaps}번 이상 올린 묶음 ${s.a.hits}/${s.a.rows.length} → ${verdict(s.a.pass)} (기준: ${TARGET_A.hits}개 이상)`,
    ...s.a.rows.map(
      (r) => `  ${r.key}  ${marks(r)}  올림 수 ${r.done.map(raised).join('·') || '-'}`,
    ),
    `대상 B (통과 묶음 × 1번): request_gap을 올린 묶음 ${s.b.hits}/${s.b.rows.length} → ${verdict(s.b.pass)} (기준: ${TARGET_B.hits}개 이하)`,
    ...s.b.rows.filter((r) => r.done.some((l) => l.request_gap)).map((r) => `  ${r.key}`),
  )
  const both = s.a.pass === true && s.b.pass === true
  const fail = s.a.pass === false || s.b.pass === false
  out.push(
    `판정: ${both ? '통과. V30 request_gap은 올림 그대로 배치를 돈다' : fail ? '기준을 넘지 못함. V30은 메모로 내린 채 배치를 돈다(14절)' : '모름(끝나지 않은 호출이 있음)'}`,
  )
  const st = s.structure
  out.push(
    `보고만: 구조 지적 가운데 medium 이상 A ${st.A.up}/${st.A.all}, B ${st.B.up}/${st.B.all}, 모두 ${st.A.up + st.B.up}/${st.A.all + st.B.all} (${pct(st.A.up + st.B.up, st.A.all + st.B.all)})`,
    `보고만: 반복 사이 뒤집힘(반복이 둘 이상인 ${s.flips.bundles}묶음): request_gap ${s.flips.request_gap}, 올림 있음 ${s.flips.any_raise}, 구조 medium 이상 ${s.flips.structure_up}`,
    `올림(갈래/심각도): A ${counts(s.raises.A)}; B ${counts(s.raises.B)}`,
    `레포: diff가 증거와 다른 묶음 ${list(s.checkout.diff_differs)}, 품질 기준이 평가와 다른 묶음 ${list(s.checkout.overlay_differs)}, 계약 hash가 증거와 다른 묶음 ${list(s.checkout.contract_differs)}`,
    `토큰: 입력(캐시 포함) ${s.usage.input}, 출력 ${s.usage.output}`,
  )
  return out.join('\n')
}

// ── 명령줄 ──────────────────────────────────────────────────────────────────

export function readLines(file: string): Line[] {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l, i) => {
      try {
        return JSON.parse(l) as Line
      } catch {
        throw new Error(`${file}:${i + 1}: JSON이 아님`)
      }
    })
}

async function pool<T>(items: T[], n: number, f: (t: T) => Promise<void>): Promise<void> {
  const queue = [...items]
  const worker = async () => {
    for (let t = queue.shift(); t !== undefined; t = queue.shift()) await f(t)
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker))
}

function int(text: string): number {
  const n = Number(text)
  if (!Number.isInteger(n) || n < 1) throw new Error(`1 이상의 정수가 아님: ${text}`)
  return n
}

async function main(argv: string[]): Promise<void> {
  const { values: v } = parseArgs({
    args: argv,
    options: {
      dry: { type: 'boolean', default: false },
      out: { type: 'string' },
      resume: { type: 'boolean', default: false },
      summary: { type: 'boolean', default: false },
      jobs: { type: 'string', default: '2' },
      limit: { type: 'string' },
      results: { type: 'string', default: path.join(ROOT, '../relay-v2/app/eval/results') },
      scenarios: { type: 'string', default: path.join(ROOT, '../relay-v2/app/eval/scenarios') },
      prompts: { type: 'string' },
      keep: { type: 'boolean', default: false },
    },
  })
  const out = path.resolve(
    v.out ??
      (v.dry
        ? path.join(tmpdir(), 'relay-review-replay.dry.jsonl')
        : path.join(ROOT, 'docs/experiments/m2.1/review-replay.jsonl')),
  )
  const planned = plan(
    [TARGET_A.scenario, ...TARGET_B.scenarios].flatMap((s) => readBundles(v.results, s)),
  )
  const calls = callsOf(planned)
  if (!v.summary) {
    let lines = readLines(out)
    if (lines.length > 0 && !v.resume) {
      if (!v.dry) throw new Error(`이미 있음: ${out} (--resume으로 잇거나 지운다)`)
      rmSync(out)
      lines = []
    }
    if (lines.some((l) => l.dry !== v.dry || l.prompt_version !== REVIEW_PROMPT_VERSION))
      throw new Error(`${out}에 --dry 여부나 프롬프트 판이 다른 줄이 있음`)
    const done = new Set(
      lines.filter((l) => l.status === 'done').map((l) => `${l.key}#${l.repeat}`),
    )
    const left = calls.filter((c) => !done.has(`${c.key}#${c.repeat}`))
    const todo = v.limit === undefined ? left : left.slice(0, int(v.limit))
    const bin = v.dry ? null : findClaude(process.env)
    if (!v.dry && bin === null) throw new Error('claude를 찾지 못함(CLAUDE_BIN이나 PATH)')
    const repeatsOf = (b: Bundle) => todo.filter((c) => c.key === keyOf(b)).map((c) => c.repeat)
    const jobs = planned.map((p) => ({ ...p, repeats: repeatsOf(p.bundle) }))
    mkdirSync(path.dirname(out), { recursive: true })
    const say = (t: string) => process.stderr.write(`${t}\n`)
    say(
      `${v.dry ? '가짜 리뷰어(--dry)' : `claude -p (${bin ?? ''}, 환경: ANTHROPIC_MODEL, CLAUDE_CODE_EFFORT_LEVEL은 run.json options)`}로 ${todo.length}번 부른다 (계획 ${calls.length}, 끝남 ${done.size}) → ${out}`,
    )
    let n = 0
    const opts: RunOpts = {
      scenarios: v.scenarios,
      reviewer: bin === null ? dryReviewer : claudeReviewer(bin),
      dry: v.dry,
      out,
      keep: v.keep,
      prompts: v.prompts,
      progress: (l) =>
        say(
          `[${++n}/${todo.length}] ${l.target} ${l.key} #${l.repeat}: ${l.status === 'done' ? `올림 ${counts(l.raises)}${l.request_gap ? ' (request_gap)' : ''}` : `실패: ${l.error ?? ''}`}`,
        ),
    }
    const work = jobs.filter((j) => j.repeats.length > 0)
    await pool(work, int(v.jobs), (j) => runBundle(j.bundle, j.target, j.repeats, opts))
  }
  console.log(summaryText(summarize(readLines(out), calls)))
}

const entry = process.argv[1]
if (entry !== undefined && path.resolve(entry) === fileURLToPath(import.meta.url)) {
  process.on('SIGINT', () => {
    killRunFiles()
    process.exit(130)
  })
  main(process.argv.slice(2)).catch((e: unknown) => {
    process.stderr.write(`${message(e)}\n`)
    process.exit(1)
  })
}

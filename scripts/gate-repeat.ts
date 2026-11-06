// 관문 5회 반복 안정성 (M4f, docs/m4-design.md 8절, V52). 앱 장치가 아니라 이름표 붙은 측정 자료를 만드는 평가 도구다(V31처럼).
// 화면과 CLI에는 없다. 계기는 마일스톤마다, GATE_VERSION을 올릴 때, Claude Code major.minor가 바뀔 때(8.3). 셈은 engine/stability.ts.
//   node scripts/gate-repeat.ts targets --bundle <시나리오/쪽-회/Work>... --into <폴더> [--results <폴더>] [--scenarios <폴더>]
//   node scripts/gate-repeat.ts check  --targets <targets.json> [--repeats 5] [--out <파일.jsonl>] [--resume] [--summary]
//   node scripts/gate-repeat.ts review --targets <targets.json> [--repeats 5] [--dry] [--out <파일.jsonl>] [--resume] [--summary]
//                                      [--pass-env <이름,…>]
//   node scripts/gate-repeat.ts review --from <리뷰 jsonl>       이미 있는 반복 자료를 세기만(예: docs/experiments/m2.1/review-replay.jsonl)
//   node scripts/gate-repeat.ts generation [<재생 자료 폴더나 .jsonl>...]   기본은 test/fixtures/gate-replay/
// - 대상(targets.json): [{ name, repo, base, head, contract?, request?, options?: { effort?, agentModel? } }]. 경로는 그 파일 기준.
//   targets는 relay-v2 평가 결과(results/m2-main-<시나리오>의 relay3·relay3-noreview, m21-design·m21-sealed-<시나리오>의
//   relay3-m21)의 묶음에서 대상을 만든다(scripts/review-replay.ts makeCheckout과 같은
//   checkout: 시나리오 레포 + 품질 기준 덧씌우기가 base, final diff가 head). relay-v3 Work의 head는 손으로 적는다.
// - 레포를 바꾸지 않는다: 대상마다 `git clone --shared --no-checkout`한 임시 레포에서 돈다(check worktree의 등록도 거기에 남는다).
// - (A) check: 반복마다 새 임시 RELAY_HOME(SHA 캐시가 없게)으로 engine check를 돌린다. 리뷰는 부르지 않고 고정한 리뷰(지적 없음,
//   요청을 봄)를 넣어 결론이 결정론 입력에만 달리게 한다. 정책은 초안 조건, 서버 null, 실적 빈 값(재생과 같다). 줄은 칸의 digest다.
// - (B) review: check를 한 번 돌려 앱처럼 프롬프트를 만들고 리뷰만 여러 번 부른다(claude -p, 호출마다 새 설정 폴더, 운영자의
//   CLAUDE*·ANTHROPIC_* 변수는 넘기지 않음: review-replay.ts와 같다). --dry는 가짜 리뷰어다(판정에 쓰지 않음).
// - (C) generation: 새 실행 없이 재생 자료(scripts/gate-replay-fixture.ts가 만든 것)의 같은 요청 여러 실행을 견준다. 까닭(reasons)은
//   자료에 적지 않고 읽을 때 지금 관문으로 다시 계산한다.
// - 줄에는 모델 이름을 쓰지 않는다.
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { findClaude, type ClaudeJsonResult } from '../src/adapters/claude.ts'
import { git } from '../src/adapters/exec.ts'
import { killRunFiles } from '../src/adapters/pty.ts'
import { gate } from '../src/core/gate.ts'
import { evidenceFacts, REVIEW_PROMPT_VERSION, reviewPrompt } from '../src/core/review.ts'
import type { Contract, EvidenceBundle } from '../src/core/types.ts'
import { parseContract } from '../src/core/contract.ts'
import { check } from '../src/engine/check.ts'
import { humanRequest } from '../src/engine/judge.ts'
import {
  checkDigest,
  generationSpread,
  reviewStability,
  stabilityOf,
  type ReviewRun,
  type RunDigest,
} from '../src/engine/stability.ts'
import { conditionsMet } from '../src/engine/track.ts'
import {
  DRAFT_POLICY,
  generationRuns,
  readReplay,
  type ReplayBundle,
} from '../test/support/gate-replay.ts'
import { keyOf, M2_MAIN, M21_BATCHES, readBundles, type RunOptions } from './review-replay-plan.ts'
import {
  claudeReviewer,
  dryReviewer,
  evalEnv,
  makeCheckout,
  makeConfigDir,
  operatorEnv,
  reviewFields,
  type Reviewer,
} from './review-replay.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT_DIR = path.join(ROOT, 'docs/experiments/m4')
const REPLAY_DIR = path.join(ROOT, 'test/fixtures/gate-replay')
/** 8절의 반복 수 */
export const REPEATS = 5

/** 대상 하나(targets.json의 한 칸) */
export interface Target {
  name: string
  repo: string
  base: string
  head: string
  contract?: string
  request?: string
  /** (B) 리뷰어의 환경(review-replay.ts evalEnv: effort, 모델). 줄에는 쓰지 않는다 */
  options?: Pick<RunOptions, 'effort' | 'agentModel'>
}

/** (A)의 한 줄 */
export interface CheckLine {
  name: string
  repeat: number
  status: 'done' | 'failed'
  error?: string
  digest: RunDigest
  ms: number
}

/** (B)의 한 줄. 리뷰 칸은 review-replay.ts reviewFields와 같다 */
export interface ReviewLine extends ReviewRun {
  name: string
  repeat: number
  dry: boolean
  prompt_version: number
  error?: string
  findings: unknown[]
  /** 리뷰어 결과의 usage에서 수인 칸(토큰). 비용 어림에 쓴다. 준비 실패나 결과가 없으면 null */
  usage: Record<string, number> | null
  ms: number
}

/** 결정론 입력만 남기는 고정 리뷰: 지적 없음, 요청을 봄, 지금 프롬프트 판 */
const FIXED_REVIEW: NonNullable<EvidenceBundle['review']> = {
  status: 'done',
  findings: [],
  prompt_version: REVIEW_PROMPT_VERSION,
  request: true,
}

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
const say = (t: string) => process.stderr.write(`${t}\n`)

/** targets.json을 읽고 경로를 그 파일 기준으로 푼다 */
export function readTargets(file: string): Target[] {
  const dir = path.dirname(path.resolve(file))
  const raw = readJson<unknown>(file)
  if (!Array.isArray(raw)) throw new Error(`${file}: 대상의 배열이 아님`)
  return raw.map((t: Partial<Target>, i) => {
    const { name, repo, base, head } = t
    if (![name, repo, base, head].every((v) => typeof v === 'string' && v !== ''))
      throw new Error(`${file}: ${i}번째 대상에 name, repo, base, head가 없음`)
    const at = (p: string | undefined) => (p === undefined ? undefined : path.resolve(dir, p))
    return {
      ...(t as Target),
      repo: at(repo) ?? '',
      ...(t.contract === undefined ? {} : { contract: at(t.contract) }),
      ...(t.request === undefined ? {} : { request: at(t.request) }),
    }
  })
}

/** 대상의 레포를 임시 폴더에 --shared로 clone한다(원래 레포의 ref·설정·worktree 등록을 바꾸지 않는다). 부른 쪽이 지운다 */
async function cloneOf(t: Target): Promise<{ dir: string; base: string; head: string }> {
  const sha = async (ref: string) =>
    (await git(['rev-parse', '--verify', `${ref}^{commit}`], t.repo)).trim()
  const [base, head] = [await sha(t.base), await sha(t.head)]
  const dir = mkdtempSync(path.join(tmpdir(), 'relay-gate-repeat-repo-'))
  await git(['clone', '-q', '--shared', '--no-checkout', t.repo, dir], ROOT)
  return { dir, base, head }
}

/** 새 임시 RELAY_HOME으로 check 한 번 */
async function checkOnce(t: Target, repo: { dir: string; base: string; head: string }) {
  const home = mkdtempSync(path.join(tmpdir(), 'relay-gate-repeat-home-'))
  try {
    return await check({
      repo: repo.dir,
      base: repo.base,
      head: repo.head,
      ...(t.contract === undefined ? {} : { contractPath: t.contract }),
      ...(t.request === undefined ? {} : { requestPath: t.request }),
      home,
      now: new Date().toISOString(),
      rerun: true,
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

function contractOf(t: Target): Contract | null {
  if (t.contract === undefined) return null
  const parsed = parseContract(readFileSync(t.contract, 'utf8'))
  if (!parsed.ok) throw new Error(`계약을 읽지 못함: ${parsed.errors.join('; ')}`)
  return parsed.value
}

/** (A) 묶음 하나의 digest: 고정 리뷰를 넣고 초안 정책으로 관문과 채운 조건 */
export function digestOf(ev: EvidenceBundle, contract: Contract | null): RunDigest {
  const evidence = { ...ev, review: FIXED_REVIEW }
  const g = gate(evidence, contract, DRAFT_POLICY, ev.head)
  return checkDigest(evidence, g, conditionsMet(evidence, contract, DRAFT_POLICY, ev.head))
}

// ── 줄 파일 ─────────────────────────────────────────────────────────────────

export function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l, i) => {
      try {
        return JSON.parse(l) as T
      } catch {
        throw new Error(`${file}:${i + 1}: JSON이 아님`)
      }
    })
}

/** 이어 돌기: 끝난 (이름, 회)를 돌려준다. --resume이 아닌데 파일이 있으면 던진다(--dry는 지운다) */
function prepareOut(out: string, resume: boolean, replace: boolean): Set<string> {
  let lines = readJsonl<{ name: string; repeat: number; status: string }>(out)
  if (lines.length > 0 && !resume) {
    if (!replace) throw new Error(`이미 있음: ${out} (--resume으로 잇거나 지운다)`)
    rmSync(out)
    lines = []
  }
  mkdirSync(path.dirname(out), { recursive: true })
  return new Set(lines.filter((l) => l.status === 'done').map((l) => `${l.name}#${l.repeat}`))
}

/** 이름마다 회의 마지막 줄(끝난 줄이 실패한 줄에 지지 않음), 이름은 나온 차례 */
export function latest<T extends { name: string; repeat: number; status: string }>(
  lines: readonly T[],
): Map<string, T[]> {
  const by = new Map<string, Map<number, T>>()
  for (const l of lines) {
    const m = by.get(l.name) ?? new Map<number, T>()
    const before = m.get(l.repeat)
    if (!(before?.status === 'done' && l.status !== 'done')) m.set(l.repeat, l)
    by.set(l.name, m)
  }
  return new Map(
    [...by].map(([name, m]) => [name, [...m.values()].sort((a, b) => a.repeat - b.repeat)]),
  )
}

// ── (A) 결정론 입력 ─────────────────────────────────────────────────────────

async function runCheck(targets: Target[], repeats: number, out: string, done: Set<string>) {
  for (const t of targets) {
    const todo = range(repeats).filter((r) => !done.has(`${t.name}#${r}`))
    if (todo.length === 0) continue
    let repo: Awaited<ReturnType<typeof cloneOf>> | null = null
    try {
      repo = await cloneOf(t)
      const contract = contractOf(t)
      for (const repeat of todo) {
        const t0 = Date.now()
        const line: CheckLine = await checkOnce(t, repo)
          .then((ev) => ({
            name: t.name,
            repeat,
            status: 'done' as const,
            digest: digestOf(ev, contract),
            ms: Date.now() - t0,
          }))
          .catch((e: unknown) => failedCheck(t.name, repeat, message(e)))
        appendFileSync(out, `${JSON.stringify(line)}\n`)
        say(
          `[check] ${t.name} #${repeat}: ${line.status === 'done' ? line.digest['conclusion'] : `실패: ${line.error ?? ''}`}`,
        )
      }
    } catch (e) {
      for (const repeat of todo) {
        const line = failedCheck(t.name, repeat, `준비 실패: ${message(e)}`)
        appendFileSync(out, `${JSON.stringify(line)}\n`)
      }
    } finally {
      if (repo !== null) rmSync(repo.dir, { recursive: true, force: true })
    }
  }
}

const failedCheck = (name: string, repeat: number, error: string): CheckLine => ({
  name,
  repeat,
  status: 'failed',
  error,
  digest: {},
  ms: 0,
})

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1)

/** (A)의 요약 글: 대상마다 갈린 칸, 끝에 결론이 갈린 head 수(12절 3) */
export function checkSummary(lines: readonly CheckLine[]): string {
  const out = ['관문 5회 (A) 결정론 입력: 대상마다 갈린 칸(반복마다의 값)']
  let changed = 0
  let measured = 0
  for (const [name, ls] of latest(lines)) {
    const done = ls.filter((l) => l.status === 'done')
    const s = stabilityOf(done.map((l) => l.digest))
    const failed = ls.length - done.length
    if (done.length >= 2) measured++
    if (s.conclusion_changed) changed++
    const head = `${name}: ${done.length}회${failed > 0 ? `, 실패 ${failed}` : ''}`
    const verdict =
      done.length < 2
        ? '견줄 수 없음'
        : s.conclusion_changed
          ? '결론이 갈림'
          : s.diverged.length > 0
            ? '칸이 갈림(결론은 같음)'
            : '같음'
    out.push(`- ${head} → ${verdict}`)
    for (const d of s.diverged) out.push(`  ${d.field}: ${d.values.join(' | ')}`)
  }
  out.push(`결정론 입력만으로 결론(또는 채운 조건)이 갈린 head: ${changed}/${measured}`)
  return out.join('\n')
}

// ── (B) 리뷰 ────────────────────────────────────────────────────────────────

async function runReview(
  targets: Target[],
  repeats: number,
  o: { out: string; done: Set<string>; reviewer: Reviewer; dry: boolean },
) {
  for (const t of targets) {
    const todo = range(repeats).filter((r) => !o.done.has(`${t.name}#${r}`))
    if (todo.length === 0) continue
    const write = (line: ReviewLine) => {
      appendFileSync(o.out, `${JSON.stringify(line)}\n`)
      say(
        `[review] ${t.name} #${line.repeat}: ${line.status === 'done' ? Object.keys(line.raises).join(', ') || '올림 없음' : `실패: ${line.error ?? ''}`}`,
      )
    }
    const common = { name: t.name, dry: o.dry, prompt_version: REVIEW_PROMPT_VERSION }
    let repo: Awaited<ReturnType<typeof cloneOf>> | null = null
    try {
      repo = await cloneOf(t)
      const contract = contractOf(t)
      if (contract === null) throw new Error('리뷰에는 계약이 있어야 함')
      const ev = await checkOnce(t, repo)
      // 리뷰어가 읽는 head 파일: clone에 head를 꺼낸다(앱은 Work의 worktree에서 리뷰한다)
      await git(['checkout', '-q', '--detach', repo.head], repo.dir)
      const range_ = [ev.base, repo.head]
      const [diffStat, diff] = await Promise.all([
        git(['diff', '--stat', '--no-color', ...range_], repo.dir),
        git(['diff', '--no-color', '--no-ext-diff', ...range_], repo.dir),
      ])
      const request = t.request === undefined ? null : humanRequest(readFileSync(t.request, 'utf8'))
      const prompt = reviewPrompt({
        contract,
        request,
        diffStat,
        diff,
        evidenceSummary: evidenceFacts(ev),
      })
      for (const repeat of todo) {
        const t0 = Date.now()
        const config = makeConfigDir()
        const r = await o
          .reviewer({ cwd: repo.dir, prompt, env: evalEnv(t.options ?? {}, config) })
          .catch((e: unknown): ClaudeJsonResult => ({ ok: false, error: message(e) }))
          .finally(() => rmSync(config, { recursive: true, force: true }))
        const f = reviewFields(r)
        write({
          ...common,
          repeat,
          status: f.status,
          ...(f.error === undefined || f.error === '' ? {} : { error: f.error }),
          raises: f.raises,
          findings: f.findings,
          usage: f.usage,
          ms: Date.now() - t0,
        })
      }
    } catch (e) {
      for (const repeat of todo)
        write({
          ...common,
          repeat,
          status: 'failed',
          error: `준비 실패: ${message(e)}`,
          raises: {},
          findings: [],
          usage: null,
          ms: 0,
        })
    } finally {
      if (repo !== null) rmSync(repo.dir, { recursive: true, force: true })
    }
  }
}

/** (B)의 요약 글. 줄은 이 도구의 줄이나 review-replay.ts의 줄(이름 대신 key)이다 */
export function reviewSummary(
  raw: readonly (Partial<ReviewLine> & { key?: string; repeat: number; status: string })[],
): string {
  const lines = raw.map((l) => ({
    name: l.name ?? l.key ?? '?',
    repeat: l.repeat,
    status: l.status,
    raises: l.raises ?? {},
  }))
  const out = ['관문 5회 (B) 리뷰: 같은 head의 리뷰 반복마다 올린 갈래(● 올림 있음, ○ 없음)']
  let repeated = 0
  let presence = 0
  let kind = 0
  for (const [name, ls] of latest(lines)) {
    const s = reviewStability(
      ls.map((l) => ({ status: l.status === 'done' ? 'done' : 'failed', raises: l.raises })),
    )
    if (s.done >= 2) repeated++
    if (s.presence_flip) presence++
    if (s.kind_flip) kind++
    const marks = s.kinds.map((k) => (k.length > 0 ? '●' : '○')).join('')
    const kinds = s.kinds.map((k) => k.join('+') || '-').join(' | ')
    out.push(
      `- ${name}: ${marks || '-'}${s.failed > 0 ? ` (실패 ${s.failed})` : ''} ${kinds}${s.presence_flip ? ' [유무 갈림]' : ''}${s.kind_flip ? ' [갈래 갈림]' : ''}`,
    )
  }
  out.push(
    `반복이 둘 이상인 head ${repeated}개 가운데 올림 유무가 갈림 ${presence}, 올림 갈래(심각도는 보지 않음)가 갈림 ${kind}`,
    '이 숫자는 8.4 일곱째 조건(결정론 입력)이 아니라 devices.md 독립 리뷰 줄의 지표다(8절)',
  )
  const cost = reviewCost(raw)
  if (cost !== null) out.push(cost)
  return out.join('\n')
}

/** 끝난 리뷰 한 번의 평균 시간과 토큰(배치 비용 어림). 끝난 줄이 없으면 null */
export function reviewCost(
  raw: readonly { status: string; ms?: number; usage?: Record<string, number> | null }[],
): string | null {
  const done = raw.filter((l) => l.status === 'done')
  if (done.length === 0) return null
  const counted = done.flatMap((l) => (l.usage ? [l.usage] : []))
  const tok = (k: string) =>
    counted.length === 0
      ? '-'
      : String(Math.round(counted.reduce((n, u) => n + (u[k] ?? 0), 0) / counted.length))
  const timed = done.filter((l) => typeof l.ms === 'number' && l.ms > 0)
  const secs =
    timed.length === 0
      ? '-'
      : `${Math.round(timed.reduce((n, l) => n + (l.ms ?? 0), 0) / timed.length / 1000)}초`
  return `리뷰 한 번(끝난 반복 ${done.length}, 토큰을 적은 반복 ${counted.length}): 평균 ${secs}, 토큰 평균 입력 ${tok('input_tokens')}, 캐시 읽기 ${tok('cache_read_input_tokens')}, 캐시 쓰기 ${tok('cache_creation_input_tokens')}, 출력 ${tok('output_tokens')}`
}

// ── (C) 생성 ────────────────────────────────────────────────────────────────

/** 재생 자료 읽기: 폴더(그 안의 *.jsonl)나 .jsonl 파일 */
export function readReplayInputs(inputs: string[]): ReplayBundle[] {
  return inputs.flatMap((p) =>
    statSync(p).isDirectory() ? readReplay(p) : readJsonl<ReplayBundle>(p),
  )
}

/** (C)의 요약 글: 실행이 둘 이상인 무리마다 줄 종류, 사람 줄, 결론, 조건 채움, 갈린 까닭 */
export function generationSummary(bundles: readonly ReplayBundle[]): string {
  const spread = generationSpread(generationRuns(bundles)).filter((s) => s.runs >= 2)
  const counts = (r: Record<string, number>) =>
    Object.entries(r)
      .map(([k, n]) => `${k} ${n}`)
      .join('; ')
  const out = [
    '관문 5회 (C) 생성: 같은 요청을 새로 돈 실행(재생 자료, 지금 관문, 초안 정책). 생성 분산이라 관문에서 뺄 입력이 아니고 보고만 한다',
    '| 무리 | 실행 | 줄 종류(실행 수) | 사람 줄 | 결론(실행 수) | 조건 채움 | 실행마다 다른 까닭 |',
    '|---|---|---|---|---|---|---|',
  ]
  for (const s of spread)
    out.push(
      `| ${s.group} | ${s.runs} | ${counts(s.kinds)} | ${s.human}/${s.runs} | ${counts(s.conclusions)} | ${s.met}/${s.runs} | ${s.facts_varying.join(', ') || '-'} |`,
    )
  const n = (k: keyof (typeof spread)[number]['diverged']) => spread.filter((s) => s.diverged[k])
  const list = (xs: typeof spread) =>
    xs.map((s) => `${s.group} ${s.met}/${s.runs}`).join(', ') || '-'
  out.push(
    `무리 ${spread.length}개 가운데 실행마다 갈림: 줄 종류 ${n('kinds').length}, 사람 줄 ${n('human').length}, 결론 ${n('conclusion').length}, 조건 채움 ${n('met').length}`,
    `조건 채움이 갈린 무리: ${list(n('met'))}`,
  )
  return out.join('\n')
}

// ── 대상 만들기 ─────────────────────────────────────────────────────────────

/** 평가 결과의 묶음(키 '시나리오/쪽-회/Work')에서 대상 checkout을 into 아래에 만들고 targets.json을 쓴다 */
async function makeTargets(
  keys: string[],
  o: { results: string; scenarios: string; into: string },
) {
  mkdirSync(o.into, { recursive: true })
  const targets: Target[] = []
  for (const key of keys) {
    const scenario = key.split('/')[0] ?? ''
    const b = [M2_MAIN, ...M21_BATCHES]
      .flatMap((src) => readBundles(o.results, scenario, null, src))
      .find((x) => keyOf(x) === key)
    if (b === undefined)
      throw new Error(
        `묶음을 찾지 못함(results/m2-main-<시나리오>의 relay3·relay3-noreview, m21-design·m21-sealed-<시나리오>의 relay3-m21): ${key}`,
      )
    const work = path.join(b.dir, 'works', b.work)
    const ev = readJson<EvidenceBundle>(path.join(work, 'evidence.json'))
    const co = await makeCheckout(b, o.scenarios, ev)
    const name = key.replaceAll('/', '_')
    const dest = path.join(o.into, name)
    try {
      cpSync(co.dir, dest, { recursive: true })
    } finally {
      rmSync(co.dir, { recursive: true, force: true })
    }
    cpSync(path.join(work, 'contract.json'), `${dest}.contract.json`)
    const req = path.join(work, 'request.md')
    if (existsSync(req)) cpSync(req, `${dest}.request.md`)
    const { effort, agentModel } = b.options
    targets.push({
      name: key,
      repo: name,
      base: 'HEAD~1',
      head: 'HEAD',
      contract: `${name}.contract.json`,
      ...(existsSync(req) ? { request: `${name}.request.md` } : {}),
      options: { ...(effort ? { effort } : {}), ...(agentModel ? { agentModel } : {}) },
    })
    say(`대상: ${key} → ${dest}${co.facts.same_as_evidence ? '' : ' (diff가 증거와 다름)'}`)
  }
  const file = path.join(o.into, 'targets.json')
  writeFileSync(file, `${JSON.stringify(targets, null, 2)}\n`)
  say(`${file}: ${targets.length}개`)
}

// ── 명령줄 ──────────────────────────────────────────────────────────────────

function int(text: string): number {
  const n = Number(text)
  if (!Number.isInteger(n) || n < 1) throw new Error(`1 이상의 정수가 아님: ${text}`)
  return n
}

async function main(argv: string[]): Promise<void> {
  const [mode, ...args] = argv
  const { values: v, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      targets: { type: 'string' },
      repeats: { type: 'string', default: String(REPEATS) },
      out: { type: 'string' },
      resume: { type: 'boolean', default: false },
      summary: { type: 'boolean', default: false },
      dry: { type: 'boolean', default: false },
      from: { type: 'string' },
      'pass-env': { type: 'string', default: '' },
      bundle: { type: 'string', multiple: true, default: [] },
      into: { type: 'string' },
      results: { type: 'string', default: path.join(ROOT, '../relay-v2/app/eval/results') },
      scenarios: { type: 'string', default: path.join(ROOT, '../relay-v2/app/eval/scenarios') },
    },
  })
  if (mode === 'generation') {
    const inputs = positionals.length > 0 ? positionals : [REPLAY_DIR]
    console.log(generationSummary(readReplayInputs(inputs)))
    return
  }
  if (mode === 'targets') {
    if (v.into === undefined || v.bundle.length === 0) throw new Error('--bundle과 --into가 필요함')
    await makeTargets(v.bundle, { results: v.results, scenarios: v.scenarios, into: v.into })
    return
  }
  if (mode === 'review' && v.from !== undefined) {
    console.log(reviewSummary(readJsonl(v.from)))
    return
  }
  if (mode !== 'check' && mode !== 'review')
    throw new Error('쓰는 법: gate-repeat.ts <targets|check|review|generation> … (머리 주석)')
  const dryOut = path.join(tmpdir(), `relay-gate-repeat-${mode}.dry.jsonl`)
  const out = path.resolve(
    v.out ?? (v.dry ? dryOut : path.join(OUT_DIR, `gate-repeat-${mode}.jsonl`)),
  )
  if (!v.summary) {
    if (v.targets === undefined) throw new Error('--targets가 필요함')
    const targets = readTargets(v.targets)
    const repeats = int(v.repeats)
    const done = prepareOut(out, v.resume, v.dry)
    if (mode === 'check') await runCheck(targets, repeats, out, done)
    else {
      const bin = v.dry ? null : findClaude(process.env)
      if (!v.dry && bin === null) throw new Error('claude를 찾지 못함(CLAUDE_BIN이나 PATH)')
      for (const k of operatorEnv(process.env, v['pass-env'].split(',').filter(Boolean)))
        Reflect.deleteProperty(process.env, k)
      const reviewer = bin === null ? dryReviewer : claudeReviewer(bin)
      await runReview(targets, repeats, { out, done, reviewer, dry: v.dry })
    }
  }
  console.log(mode === 'check' ? checkSummary(readJsonl(out)) : reviewSummary(readJsonl(out)))
  if (v.dry) console.log('--dry: 가짜 리뷰어의 고정 지적이라 판정에 쓰지 않는다')
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

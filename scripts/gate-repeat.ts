// 관문 5회 반복 안정성 (M4f, docs/m4-design.md 8절, V52). 앱 장치가 아니라 이름표 붙은 측정 자료를 만드는 평가 도구다(V31처럼).
// 화면과 CLI에는 없다. 계기는 마일스톤마다, GATE_VERSION을 올릴 때, Claude Code major.minor가 바뀔 때(8.3). 셈은 engine/stability.ts.
//   node scripts/gate-repeat.ts targets --bundle <시나리오/쪽-회/Work>... --into <폴더> [--results <폴더>] [--scenarios <폴더>]
//   node scripts/gate-repeat.ts check  --targets <targets.json> [--repeats 5] [--out <파일.jsonl>] [--resume] [--summary]
//                                      [--max-attempts 2]
//   node scripts/gate-repeat.ts review --targets <targets.json> [--repeats 5] [--dry] [--out <파일.jsonl>] [--resume] [--summary]
//                                      [--pass-env <이름,…>] [--max-attempts 2] [--check <(A)의 jsonl>]
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
// - 다시 하기: --resume은 끝나지 않은 반복만 다시 하고, 한 반복을 --max-attempts(기본 2)번까지만 한다(줄 파일의 줄이 시도다).
//   (A)에서 setup(예: npm ci)이 실패한 반복은 칸의 갈림이 아니라 준비 실패(failed)로 적는다(M4 규약 9절).
// - 요약은 끝난 반복이 --repeats에 이른 대상만 분모에 넣고, 못 미친 대상은 '덜 함'으로 따로 적는다.
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
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
import { checkDigest, type RunDigest } from '../src/engine/stability.ts'
import { conditionsMet } from '../src/engine/track.ts'
import { DRAFT_POLICY } from '../test/support/gate-replay.ts'
import {
  checkSummary,
  generationSummary,
  readJsonl,
  readReplayInputs,
  reviewSummary,
  type CheckLine,
  type ReviewLine,
} from './gate-repeat-summary.ts'
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

export {
  checkSummary,
  generationSummary,
  isMetInput,
  latest,
  readJsonl,
  readReplayInputs,
  reviewCost,
  reviewSummary,
  type CheckLine,
  type ReviewLine,
} from './gate-repeat-summary.ts'

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

/**
 * 이어 돌기: 다시 하지 않을 (이름, 회)를 돌려준다(끝난 것과 시도가 maxAttempts에 이른 것). --resume이 아닌데 파일이 있으면
 * 던진다(--dry는 지운다)
 */
export function prepareOut(
  out: string,
  resume: boolean,
  replace: boolean,
  maxAttempts = Infinity,
): Set<string> {
  let lines = readJsonl<{ name: string; repeat: number; status: string }>(out)
  if (lines.length > 0 && !resume) {
    if (!replace) throw new Error(`이미 있음: ${out} (--resume으로 잇거나 지운다)`)
    rmSync(out)
    lines = []
  }
  mkdirSync(path.dirname(out), { recursive: true })
  const tries = new Map<string, number>()
  for (const l of lines)
    tries.set(`${l.name}#${l.repeat}`, (tries.get(`${l.name}#${l.repeat}`) ?? 0) + 1)
  return new Set([
    ...lines.filter((l) => l.status === 'done').map((l) => `${l.name}#${l.repeat}`),
    ...[...tries].filter(([, n]) => n >= maxAttempts).map(([k]) => k),
  ])
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
          .then((ev): CheckLine => {
            const digest = digestOf(ev, contract)
            const setup = ev.missing.filter((m) => m.startsWith('setup('))
            return setup.length > 0
              ? { ...failedCheck(t.name, repeat, `setup 실패: ${setup.join('; ')}`), digest }
              : { name: t.name, repeat, status: 'done', digest, ms: Date.now() - t0 }
          })
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
      'max-attempts': { type: 'string', default: '2' },
      check: { type: 'string' },
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
  const checkLines = v.check === undefined ? null : readJsonl<CheckLine>(v.check)
  if (mode === 'review' && v.from !== undefined) {
    console.log(reviewSummary(readJsonl(v.from), checkLines))
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
    const done = prepareOut(out, v.resume, v.dry, int(v['max-attempts']))
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
  const minDone = int(v.repeats)
  console.log(
    mode === 'check'
      ? checkSummary(readJsonl(out), minDone)
      : reviewSummary(readJsonl(out), checkLines, minDone),
  )
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

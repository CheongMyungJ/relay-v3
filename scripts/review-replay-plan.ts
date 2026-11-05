// 리뷰 재생(scripts/review-replay.ts, docs/m2.1-design.md 14절 0단계 O2)의 묶음 고르기와 호출 계획. review-replay.ts가
// 600줄을 넘지 않게 나눴다.
// - 묶음은 gate-replay-fixture.ts의 규칙이다: results/m2-main-<시나리오>(report.json이 있는 배치), 오류 없이 숨긴 시험 결과가
//   있는 실행, works[].gate.export가 참이고 evidence.json의 head가 exportedHead인 Work.
// - A는 14에서 숨긴 시험이 실패한 relay3·relay3-noreview 묶음(8개)을 3번씩, B는 통과한 묶음을 07, 08, 10, 19, 40, 43에서
//   다섯씩(30개) 1번씩. B는 (회차, 쪽, Work id) 차례로 실행마다 첫 Work를 먼저, 모자라면 같은 차례로 나머지에서 고른다.
// - B는 깨끗한 일이어야 한다: 요청이 그 Work의 몫보다 넓은 묶음(widerRequest)은 B에서 빼고 남은 묶음에서 같은 차례로 고른다.
//   Work가 여럿인 실행에서 시나리오의 리포트 전부를 받고 계약이 나머지를 다른 Work에 넘긴 Work(40의 '세 모듈'을 받은 Work
//   등)는 request_gap이 거짓 올림이 아닐 수 있다.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { EvidenceBundle } from '../src/core/types.ts'

const ARMS = ['relay3', 'relay3-noreview']

/** 14절의 대상과 통과 기준. A: 3번 중 gaps번 이상 request_gap인 묶음이 hits개 이상. B: request_gap인 묶음이 hits개 이하 */
export const TARGET_A = { scenario: '14-double-notify', bundles: 8, repeats: 3, gaps: 2, hits: 4 }
const B_LIST = '07-two-bugs 08-timezone 10-invoice-rounding 19-split-report 40-three-libraries'
const B_SCENARIOS = `${B_LIST} 43-split-engines`.split(' ')
export const TARGET_B = { scenarios: B_SCENARIOS, each: 5, hits: 4 }
export const B_BUNDLES = TARGET_B.scenarios.length * TARGET_B.each
export const DESIGN_CALLS = TARGET_A.bundles * TARGET_A.repeats + B_BUNDLES

/**
 * 요청이 '시나리오의 리포트 전부'인가: 리포트(여럿이면 모두)의 낱말 가운데 요청에 있는 것의 비율이 이 값 이상. M2 묶음에서
 * Work가 여럿인 실행의 요청은 몫만 받은 것이 0.61 이하, 리포트 전부를 받은 것이 1.00이었다. 사람 역할이 말을 조금 바꿔
 * 옮겨도 전부로 보게 1.00이 아니라 0.8로 둔다
 */
export const FULL_REPORT = 0.8

export type Target = 'A' | 'B'

/** 요청이 Work의 몫보다 넓은 까닭(B에서 뺀다). full_report: Work가 여럿인 실행에서 리포트 전부를 받음. non_goal_elsewhere:
 * Work가 여럿인 실행에서 계약의 비목표가 요청이 이름 부른 파일이나 함수를 다른 Work·브랜치로 넘김 */
export type Wider = 'full_report' | 'non_goal_elsewhere'

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
  /** 요청이 이 Work의 몫보다 넓으면 그 까닭(B에서 뺀다). 아니면 null */
  wider: Wider | null
}

export interface Call {
  target: Target
  key: string
  repeat: number
}

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
export const keyOf = (b: Pick<Bundle, 'scenario' | 'arm' | 'run' | 'work'>) =>
  `${b.scenario}/${b.arm}-${b.run}/${b.work}`

// ── 요청이 Work의 몫보다 넓은가 ───────────────────────────────────────────────

/** 낱말: 글자·숫자·_·.·/가 둘 이상 이어진 것(소문자). 'src/csv.js에'처럼 조사가 붙은 채로 견준다 */
const words = (t: string) => new Set(t.toLowerCase().match(/[\p{L}\p{N}_./]{2,}/gu) ?? [])
/** 비목표가 다른 Work나 브랜치를 말한다 */
const ELSEWHERE =
  /(다른|별도|따로|another|other|separate)\s*(의\s*)?(work|워크|브랜치|branch)|(work|브랜치|branch)[^.\n]{0,20}(따로|별도)/i
/** 코드의 이름: 파일(csv.js)과 낙타 꼴 함수 이름(parseCsv) */
const codeNames = (t: string) =>
  new Set([
    ...(t.match(/[A-Za-z_][\w-]*\.(?:m?js|ts|py)\b/g) ?? []),
    ...(t.match(/\b[a-z]+[A-Z][A-Za-z0-9]*\b/g) ?? []),
  ])

/** 리포트의 낱말 가운데 요청에 있는 것의 비율(리포트에 낱말이 없으면 0) */
export function reportCoverage(request: string, report: string | string[]): number {
  const want = words(Array.isArray(report) ? report.join('\n') : report)
  if (want.size === 0) return 0
  const have = words(request)
  return [...want].filter((w) => have.has(w)).length / want.size
}

/**
 * 요청이 이 Work의 몫보다 넓은가(B에서 뺀다). Work가 하나인 실행은 늘 아니다. Work가 여럿이면 둘 가운데 하나다:
 * 요청이 리포트 전부(reportCoverage ≥ FULL_REPORT), 또는 비목표 하나가 다른 Work·브랜치를 말하며 요청이 이름 부른 파일이나
 * 함수를 이름 부른다(그 몫을 다른 Work로 넘김)
 */
export function widerRequest(o: {
  works: number
  request: string | null
  report: string | string[] | null
  nonGoals: string[]
}): Wider | null {
  if (o.works < 2 || o.request === null) return null
  if (o.report !== null && reportCoverage(o.request, o.report) >= FULL_REPORT) return 'full_report'
  const asked = codeNames(o.request)
  const handed = (g: string) => ELSEWHERE.test(g) && [...codeNames(g)].some((n) => asked.has(n))
  return o.nonGoals.some(handed) ? 'non_goal_elsewhere' : null
}

// ── 묶음 고르기 ─────────────────────────────────────────────────────────────

interface StoredRun {
  error?: unknown
  outcome?: { success?: unknown } | null
  options?: RunOptions
  works?: { id: string; exportedHead?: string | null; gate?: { export?: boolean } }[]
}

/** 시나리오의 리포트(scenario.json report). 읽지 못하면 null */
export function readReport(scenarios: string, scenario: string): string | string[] | null {
  const file = path.join(scenarios, scenario, 'scenario.json')
  if (!existsSync(file)) return null
  const report = readJson<{ report?: unknown }>(file).report
  const isText = (x: unknown): x is string => typeof x === 'string'
  if (isText(report) || (Array.isArray(report) && report.every(isText))) return report
  return null
}

/** 계약의 비목표(글). 읽지 못하면 없음 */
function nonGoalsOf(file: string): string[] {
  try {
    const goals = readJson<{ non_goals?: unknown }>(file).non_goals
    return Array.isArray(goals) ? goals.filter((g): g is string => typeof g === 'string') : []
  } catch {
    return []
  }
}

/** 배치 하나(results/m2-main-<시나리오>)의 relay3·relay3-noreview 내보내기 묶음. report는 시나리오의 리포트(widerRequest) */
export function readBundles(
  results: string,
  scenario: string,
  report: string | string[] | null = null,
): Bundle[] {
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
    const works = (run.works ?? []).length
    for (const w of run.works ?? []) {
      const at = path.join(dir, 'works', w.id)
      const ev = path.join(at, 'evidence.json')
      if (w.gate?.export !== true || !existsSync(ev)) continue
      if (readJson<EvidenceBundle>(ev).head !== w.exportedHead) continue
      const req = path.join(at, 'request.md')
      const request = existsSync(req) ? readFileSync(req, 'utf8') : null
      const nonGoals = nonGoalsOf(path.join(at, 'contract.json'))
      const wider = widerRequest({ works, request, report, nonGoals })
      out.push({ ...id, work: w.id, wider })
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

/** B의 후보: 그 시나리오에서 숨긴 시험을 통과한 묶음 가운데 요청이 Work의 몫보다 넓지 않은 것 */
const passedOf = (all: Bundle[], s: string) =>
  all.filter((x) => x.scenario === s && x.hidden_pass && x.wider === null)

/** 14절의 계획: 대상 A(모두, 3번씩)와 B(시나리오마다 다섯, 1번씩. 요청이 Work의 몫보다 넓은 묶음은 빼고) */
export function plan(all: Bundle[]): { target: Target; bundle: Bundle; repeats: number }[] {
  const a = all.filter((b) => b.scenario === TARGET_A.scenario && !b.hidden_pass).sort(order)
  const b = TARGET_B.scenarios.flatMap((s) => spread(passedOf(all, s), TARGET_B.each))
  const as = (target: Target, repeats: number) => (bundle: Bundle) => ({ target, bundle, repeats })
  return [...a.map(as('A', TARGET_A.repeats)), ...b.map(as('B', 1))]
}

/** B에서 뺀 묶음(숨긴 시험을 통과했지만 요청이 Work의 몫보다 넓음): '키 (까닭)'. 요약에 적는다 */
export function excludedFromB(all: Bundle[]): string[] {
  return all
    .filter((b) => TARGET_B.scenarios.includes(b.scenario) && b.hidden_pass && b.wider !== null)
    .sort((x, y) => cmp(x.scenario, y.scenario) || order(x, y))
    .map((b) => `${keyOf(b)} (${b.wider ?? ''})`)
}

export function callsOf(p: ReturnType<typeof plan>): Call[] {
  return p.flatMap(({ target, bundle, repeats }) =>
    Array.from({ length: repeats }, (_, i) => ({ target, key: keyOf(bundle), repeat: i + 1 })),
  )
}

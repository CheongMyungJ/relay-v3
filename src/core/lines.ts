// 계약 줄 판정: 예시 태그를 단 수용 시험의 head·base 결과로 줄마다 met 여부를 정한다.
import { findExampleTags } from './contract.ts'
import type {
  Contract,
  ContractLine,
  ExampleEvidence,
  LineStatus,
  LineVerdict,
  TestCase,
  TestStatus,
} from './types.ts'

/** 예시 id → 그 태그를 이름에 담은 testcase들 */
type Index = Map<string, TestCase[]>

/** 태그는 testcase 이름과 감싼 testsuite 이름(node:test의 describe)에서 찾는다 */
function tagsOf(tc: TestCase, contractId: string): string[] {
  const text = tc.suite === undefined ? tc.name : `${tc.suite} > ${tc.name}`
  return findExampleTags(text, contractId)
}

function indexByExample(cases: TestCase[], contractId: string): Index {
  const index: Index = new Map()
  for (const tc of cases) {
    for (const id of tagsOf(tc, contractId)) {
      const list = index.get(id)
      if (list === undefined) index.set(id, [tc])
      else list.push(tc)
    }
  }
  return index
}

/** 같은 태그가 여럿이면: 하나라도 실패면 실패(단언 실패가 오류보다 앞), 모두 건너뜀이면 건너뜀 */
function combine(cases: TestCase[] | undefined): TestStatus | 'missing' {
  const statuses = (cases ?? []).map((c) => c.status)
  if (statuses.length === 0) return 'missing'
  if (statuses.includes('failed')) return 'failed'
  if (statuses.includes('error')) return 'error'
  if (statuses.every((s) => s === 'skipped')) return 'skipped'
  return 'passed'
}

// ── 기준에서 시험 파일을 불러오지 못한 경우 ──────────────────────────────────
// vitest·node:test는 import 실패를 태그 없는 파일 단위 testcase 하나로 낸다
// (vitest: name = classname = 파일, node:test: name = 파일, classname = 'test').

const SOURCE_PATH = /^[^\s]+\.(?:[cm]?[jt]sx?|py|go|rb|java|kt|rs)$/i

const isPath = (s: string | undefined): s is string => s !== undefined && SOURCE_PATH.test(s)

function samePath(a: string, b: string): boolean {
  const x = a.replace(/\\/g, '/').replace(/^\.\//, '')
  const y = b.replace(/\\/g, '/').replace(/^\.\//, '')
  return x === y || x.endsWith(`/${y}`) || y.endsWith(`/${x}`)
}

/** base에서 파일째 실패한 testcase의 파일 경로들 */
function fileFailures(base: TestCase[], contractId: string): string[] {
  const out: string[] = []
  for (const tc of base) {
    if (tc.status !== 'failed' && tc.status !== 'error') continue
    if (tagsOf(tc, contractId).length > 0) continue
    if (tc.name === tc.classname || tc.name === tc.file || isPath(tc.name)) {
      const path = tc.file ?? (isPath(tc.name) ? tc.name : tc.classname)
      if (path !== undefined) out.push(path)
    }
  }
  return out
}

/**
 * base에 태그가 없는 예시를 '기준에서 불러오지 못함'으로 볼 수 있나.
 * head 시험의 파일을 알면 같은 파일의 파일 단위 실패가 있어야 한다.
 * 파일을 모르면(node:test) 파일 단위 실패가 하나라도 있어야 하고 detail에 적는다.
 */
function loadFailure(headCases: TestCase[], failures: string[]): 'same_file' | 'some_file' | null {
  if (failures.length === 0) return null
  const files = headCases.map((c) => c.file ?? c.classname).filter(isPath)
  if (files.length === 0) return 'some_file'
  return files.some((f) => failures.some((g) => samePath(f, g))) ? 'same_file' : null
}

function verdict(
  line: ContractLine,
  status: LineStatus,
  detail: string,
  examples: ExampleEvidence[],
): LineVerdict {
  return { line: line.id, kind: line.kind, status, detail, examples }
}

const list = (evs: ExampleEvidence[], side: (e: ExampleEvidence) => string): string =>
  evs.map((e) => `${e.id}(${side(e)})`).join(', ')

/** head 쪽 공통 판정. 모두 통과면 null을 돌려주고 종류별 판정으로 넘긴다 */
function judgeHead(evs: ExampleEvidence[]): Judged | null {
  const broken = evs.filter((e) => e.head === 'failed' || e.head === 'error')
  if (broken.length > 0)
    return { status: 'not_met', detail: `결과에서 실패: ${list(broken, (e) => e.head)}` }
  const missing = evs.filter((e) => e.head === 'missing')
  if (missing.length > 0)
    return {
      status: 'missing_evidence',
      detail: `태그를 단 시험이 없음: ${missing.map((e) => e.id).join(', ')}`,
    }
  const skipped = evs.filter((e) => e.head === 'skipped')
  if (skipped.length > 0)
    return {
      status: 'missing_evidence',
      detail: `결과에서 건너뜀: ${skipped.map((e) => e.id).join(', ')}`,
    }
  return null
}

type Judged = { status: LineStatus; detail: string }

interface BaseContext {
  head: Index | null
  failures: string[]
}

/**
 * 바뀜 줄: 예시가 모두 결과에서 통과하고(judgeHead), 하나 이상이 기준에서 실패하면 met이다. 기준에서도 통과하는 예시는
 * 그 줄의 지킴으로 적는다(예: 'LA의 토요일'을 고치는 줄의 '일요일'). 예시가 모두 기준에서도 통과하면 바뀐 동작을
 * 시험하지 않은 것이다. M2 평가 배치 1에서 '하나라도 기준에서 통과하면 not_met'이 계약 바꾸기 요청의 반을 만들었다
 */
function judgeChange(evs: ExampleEvidence[], ctx: BaseContext): Judged {
  const same = evs.filter((e) => e.base === 'passed')
  if (same.length === evs.length)
    return {
      status: 'not_met',
      detail: `기준에서도 통과: 바뀐 동작을 시험하지 않음 (${same.map((e) => e.id).join(', ')})`,
    }
  if (evs.every((e) => e.base === 'not_run'))
    return { status: 'met', detail: '결과에서 통과. 기준 실패를 확인하지 못함' }
  const unconfirmed: string[] = []
  const notes: string[] = []
  for (const e of evs) {
    if (e.base === 'skipped') unconfirmed.push(`${e.id}(기준에서 건너뜀)`)
    else if (e.base === 'error') notes.push(`${e.id}: 기준에서 오류`)
    else if (e.base === 'not_run') unconfirmed.push(`${e.id}(기준에서 돌리지 않음)`)
    else if (e.base === 'missing') {
      const why = loadFailure(ctx.head?.get(e.id) ?? [], ctx.failures)
      if (why === null) unconfirmed.push(`${e.id}(기준에 그 시험이 없음)`)
      else
        notes.push(
          why === 'same_file'
            ? `${e.id}: 기준에서 시험 파일을 불러오지 못함`
            : `${e.id}: 기준에서 불러오지 못한 시험 파일이 있음(파일은 확인하지 못함)`,
        )
    }
  }
  if (unconfirmed.length > 0)
    return {
      status: 'missing_evidence',
      detail: `기준 실패를 확인하지 못함: ${unconfirmed.join(', ')}`,
    }
  if (same.length > 0) notes.push(`기준에서도 통과(지킴): ${same.map((e) => e.id).join(', ')}`)
  if (notes.length === 0) return { status: 'met', detail: '기준에서 실패, 결과에서 통과' }
  return { status: 'met', detail: `결과에서 통과. ${notes.join('. ')}` }
}

function judgeKeep(evs: ExampleEvidence[]): Judged {
  if (evs.every((e) => e.base === 'not_run'))
    return { status: 'met', detail: '결과에서 통과(기준에서는 돌리지 않음)' }
  const broken = evs.filter((e) => e.base === 'failed')
  if (broken.length > 0)
    return {
      status: 'not_met',
      detail: `기준에서 실패: 지킬 동작이 아니라 바뀐 동작을 시험함 (${broken.map((e) => e.id).join(', ')})`,
    }
  const unknown = evs.filter((e) => e.base !== 'passed')
  if (unknown.length > 0)
    return {
      status: 'missing_evidence',
      detail: `기준에서 통과를 확인하지 못함: ${list(unknown, (e) => e.base ?? 'not_run')}`,
    }
  return { status: 'met', detail: '기준과 결과에서 모두 통과' }
}

function evidenceOf(line: ContractLine, head: Index | null, base: Index | null): ExampleEvidence[] {
  return line.examples.map((id) => ({
    id,
    head: head === null ? 'missing' : combine(head.get(id)),
    base: base === null ? 'not_run' : combine(base.get(id)),
  }))
}

function judgeTestLine(
  line: ContractLine,
  examples: ExampleEvidence[],
  headRan: boolean,
  ctx: BaseContext,
): Judged {
  if (!headRan) return { status: 'missing_evidence', detail: '수용 시험을 돌리지 못함' }
  if (examples.length === 0) {
    const detail =
      line.kind === 'remove' ? '쓰는 곳 없음을 보일 시험이 없음' : '시험으로 확인할 예시가 없음'
    return { status: 'missing_evidence', detail }
  }
  const fromHead = judgeHead(examples)
  if (fromHead !== null) return fromHead
  if (line.kind === 'change') return judgeChange(examples, ctx)
  if (line.kind === 'keep') return judgeKeep(examples)
  return { status: 'met', detail: '결과에서 통과' }
}

/** check가 test가 아니거나 종류가 observe·human인 줄은 시험으로 판정하지 않는다 */
function untested(line: ContractLine): 'observe' | 'human' | null {
  if (line.kind === 'human' || line.check === 'human') return 'human'
  if (line.kind === 'observe' || line.check === 'observe') return 'observe'
  return null
}

export function judgeLines(
  contract: Contract,
  head: TestCase[] | null,
  base: TestCase[] | null,
): LineVerdict[] {
  const headIndex = head === null ? null : indexByExample(head, contract.id)
  const baseIndex = base === null ? null : indexByExample(base, contract.id)
  const ctx: BaseContext = {
    head: headIndex,
    failures: base === null ? [] : fileFailures(base, contract.id),
  }
  return contract.lines.map((line) => {
    const examples = evidenceOf(line, headIndex, baseIndex)
    const other = untested(line)
    if (other === 'human') return verdict(line, 'human', '사람이 확인하는 줄', examples)
    if (other === 'observe') return verdict(line, 'observe', '시험 대신 보고 확인하는 줄', examples)
    const r = judgeTestLine(line, examples, head !== null, ctx)
    return verdict(line, r.status, r.detail, examples)
  })
}

/**
 * 바뀜 줄의 base 실행을 두 번 돌렸을 때 합친다(V7을 base 실패에도). 단언 실패는 두 번 모두
 * 실패해야 실패로 남는다. 한 번이라도 통과했으면 통과로 본다(우연한 실패를 증거로 쓰지 않는다).
 */
export function confirmFailures(first: TestCase[], second: TestCase[]): TestCase[] {
  const key = (t: TestCase) => `${t.classname ?? ''}\0${t.suite ?? ''}\0${t.name}`
  const again = new Map<string, TestStatus[]>()
  for (const t of second) again.set(key(t), [...(again.get(key(t)) ?? []), t.status])
  return first.map((t) => {
    if (t.status !== 'failed') return t
    const later = again.get(key(t))
    if (later !== undefined && later.includes('passed')) {
      const passed: TestCase = { ...t, status: 'passed' }
      delete passed.message
      return passed
    }
    return t
  })
}

/** 자동 조건 require_all_lines_tested. 줄이 없으면 확인한 것이 없으니 거짓 */
export function allLinesTestedAndMet(verdicts: LineVerdict[]): boolean {
  return verdicts.length > 0 && verdicts.every((v) => v.status === 'met')
}

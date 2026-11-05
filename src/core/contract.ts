// 계약: 모양 검사, 단위(V21), 근거 확인, 예시 태그, 예시 자료(정규 파일과 견줌).
import { qualityHash } from './quality.ts'
import { err, ok, type Result } from './result.ts'
import type {
  Contract,
  ContractLine,
  Delivery,
  Example,
  ExampleFileDiff,
  ExamplesFileCheck,
  Grounding,
  LineKind,
} from './types.ts'

// ── 모양 검사 도구 (quality.ts와 같은 방식) ────────────────────────────────────

type Obj = Record<string, unknown>
type Read<T> = (v: unknown, path: string, errors: string[]) => T

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const sub = (path: string, key: string): string => (path === '' ? key : `${path}.${key}`)
const where = (path: string): string => (path === '' ? '최상위' : path)

function shape(v: unknown, path: string, e: string[], keys: readonly string[]): Obj | null {
  if (!isObj(v)) {
    e.push(`${where(path)}: 객체여야 함`)
    return null
  }
  for (const k of Object.keys(v)) if (!keys.includes(k)) e.push(`${sub(path, k)}: 알 수 없는 키`)
  return v
}

function req<T>(o: Obj, key: string, path: string, e: string[], read: Read<T>, fallback: T): T {
  if (!Object.hasOwn(o, key)) {
    e.push(`${sub(path, key)}: 필요함`)
    return fallback
  }
  return read(o[key], sub(path, key), e)
}

function opt<T>(o: Obj, key: string, path: string, e: string[], read: Read<T>): T | undefined {
  return Object.hasOwn(o, key) ? read(o[key], sub(path, key), e) : undefined
}

function prune<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
}

const str: Read<string> = (v, p, e) => {
  if (typeof v !== 'string') e.push(`${p}: 문자열이어야 함`)
  else if (v.trim() === '') e.push(`${p}: 비어 있으면 안 됨`)
  else return v
  return ''
}

function pattern(re: RegExp, hint: string): Read<string> {
  return (v, p, e) => {
    const s = str(v, p, e)
    if (s !== '' && !re.test(s)) e.push(`${p}: ${hint}`)
    return s
  }
}

function list<T>(read: Read<T>): Read<T[]> {
  return (v, p, e) => {
    if (!Array.isArray(v)) {
      e.push(`${p}: 배열이어야 함`)
      return []
    }
    return v.map((x, i) => read(x, `${p}[${i}]`, e))
  }
}

function oneOf<T extends string>(values: readonly T[], fallback?: T): Read<T> {
  return (v, p, e) => {
    if (typeof v === 'string' && (values as readonly string[]).includes(v)) return v as T
    e.push(`${p}: ${values.map((x) => `'${x}'`).join(', ')} 중 하나여야 함`)
    return fallback ?? (values[0] as T)
  }
}

const lineNo: Read<number> = (v, p, e) => {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 1) return v
  e.push(`${p}: 1 이상의 정수여야 함`)
  return 1
}

const texts = list(str)

// ── 계약 읽기 ───────────────────────────────────────────────────────────────

const LINE_ID = /^C\d+$/
const EXAMPLE_ID = /^(C\d+)\.\d+$/
const KINDS: readonly LineKind[] = ['change', 'new', 'keep', 'remove', 'observe', 'human']
const CHECKS = ['test', 'observe', 'human'] as const
/** check가 test일 때 예시가 꼭 있어야 하는 종류. remove는 예시 없이도 된다 */
const NEEDS_EXAMPLE: readonly LineKind[] = ['change', 'new', 'keep']
/** 단위 이름(V21): 브랜치 이름(`<Work 브랜치>--<단위>`, V22)에도 쓸 수 있는 꼴 */
const UNIT_NAME = /^[a-z][a-z0-9-]{0,20}$/
const DELIVERIES: readonly Delivery[] = ['one_branch', 'branch_per_unit']
/** branch_per_unit에서 단위가 꼭 있어야 하는 종류(V21). keep·observe·human은 모든 단위에 걸칠 수 있다 */
const NEEDS_UNIT: readonly LineKind[] = ['change', 'new', 'remove']

const contractId = pattern(
  /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
  '영문·숫자로 시작하고 영문·숫자·. _ -만 써야 함',
)
const lineId = pattern(LINE_ID, 'C<숫자> 모양이어야 함')
const unitName = pattern(UNIT_NAME, '영문 소문자로 시작하고 영문 소문자·숫자·-만, 21자까지여야 함')
const exampleId = pattern(EXAMPLE_ID, '<줄 id>.<숫자> 모양이어야 함')
const relPath: Read<string> = (v, p, e) => {
  const s = str(v, p, e)
  if (s !== '' && (/^(?:[A-Za-z]:)?[\\/]/.test(s) || s.split(/[\\/]/).includes('..')))
    e.push(`${p}: 레포 안의 상대 경로여야 함`)
  return s
}

const readGround: Read<Grounding> = (v, p, e) => {
  const fallback: Grounding = { type: 'guess' }
  if (!isObj(v)) {
    e.push(`${where(p)}: 객체여야 함`)
    return fallback
  }
  const type = v['type']
  if (type === 'code') {
    const o = shape(v, p, e, ['type', 'path', 'line', 'name']) ?? {}
    return prune({
      type,
      path: req(o, 'path', p, e, relPath, ''),
      line: req(o, 'line', p, e, lineNo, 1),
      name: opt(o, 'name', p, e, str),
    })
  }
  if (type === 'request') {
    const o = shape(v, p, e, ['type', 'quote']) ?? {}
    return { type, quote: req(o, 'quote', p, e, str, '') }
  }
  if (type === 'knowledge') {
    const o = shape(v, p, e, ['type', 'id']) ?? {}
    return { type, id: req(o, 'id', p, e, str, '') }
  }
  if (type === 'guess') {
    shape(v, p, e, ['type'])
    return { type }
  }
  if (Object.hasOwn(v, 'type'))
    oneOf(['code', 'request', 'knowledge', 'guess'])(type, sub(p, 'type'), e)
  else e.push(`${sub(p, 'type')}: 필요함`)
  return fallback
}

const readLine: Read<ContractLine> = (v, p, e) => {
  const o = shape(v, p, e, ['id', 'kind', 'text', 'grounds', 'examples', 'check', 'unit'])
  // 대신 값은 교차 검사에서 덧붙는 오류를 내지 않는 것으로 고른다
  if (o === null)
    return { id: '', kind: 'observe', text: '', grounds: [], examples: [], check: 'human' }
  return prune({
    id: req(o, 'id', p, e, lineId, ''),
    kind: req(o, 'kind', p, e, oneOf(KINDS, 'observe'), 'observe'),
    text: req(o, 'text', p, e, str, ''),
    grounds: opt(o, 'grounds', p, e, list(readGround)) ?? [],
    examples: opt(o, 'examples', p, e, list(exampleId)) ?? [],
    check: req(o, 'check', p, e, oneOf(CHECKS, 'human'), 'human'),
    unit: opt(o, 'unit', p, e, unitName),
  })
}

const readExample: Read<Example> = (v, p, e) => {
  const o = shape(v, p, e, ['id', 'input', 'output', 'error', 'note'])
  if (o === null) return { id: '', input: null }
  if (!Object.hasOwn(o, 'input')) e.push(`${sub(p, 'input')}: 필요함`)
  return prune({
    id: req(o, 'id', p, e, exampleId, ''),
    input: o['input'],
    output: o['output'],
    error: o['error'],
    note: opt(o, 'note', p, e, str),
  })
}

const TOP_KEYS = [
  'version',
  'id',
  'goal',
  'lines',
  'non_goals',
  'human_rules',
  'examples',
  'hint',
  'tidy',
  'approved_by',
  'approved_at',
  'change_requested',
  'delivery',
]

/** 줄과 예시 사이의 약속: id 겹침, 예시의 주인 줄, check와 종류 */
function crossCheck(c: Contract, e: string[]): void {
  const lineIds = new Set<string>()
  c.lines.forEach((l, i) => {
    if (l.id !== '' && lineIds.has(l.id)) e.push(`lines[${i}].id: id가 겹침 (${l.id})`)
    lineIds.add(l.id)
  })
  const exampleIds = new Set<string>()
  c.examples.forEach((x, i) => {
    if (x.id === '') return
    if (exampleIds.has(x.id)) e.push(`examples[${i}].id: id가 겹침 (${x.id})`)
    exampleIds.add(x.id)
    const owner = EXAMPLE_ID.exec(x.id)?.[1]
    if (owner !== undefined && !lineIds.has(owner)) e.push(`examples[${i}].id: 없는 줄 (${owner})`)
  })
  c.lines.forEach((l, i) => {
    const p = `lines[${i}]`
    const used = new Set<string>()
    l.examples.forEach((id, j) => {
      if (id === '') return
      const at = `${p}.examples[${j}]`
      if (used.has(id)) e.push(`${at}: 예시가 겹침 (${id})`)
      used.add(id)
      if (!exampleIds.has(id)) e.push(`${at}: examples에 없는 예시 (${id})`)
      if (l.id !== '' && EXAMPLE_ID.exec(id)?.[1] !== l.id)
        e.push(`${at}: ${l.id}의 예시가 아님 (${id})`)
    })
    if (l.check === 'test' && NEEDS_EXAMPLE.includes(l.kind) && l.examples.length === 0)
      e.push(`${p}.examples: 시험으로 확인하는 ${l.kind} 줄은 예시가 하나 이상 있어야 함`)
    if (l.kind === 'human' && l.check !== 'human') e.push(`${p}.check: human 줄은 'human'이어야 함`)
  })
  if (c.delivery === 'branch_per_unit') unitsPerBranch(c, e)
}

/** branch_per_unit(V22)의 약속: 단위가 둘 이상이고, change·new·remove 줄마다 단위가 있다 */
function unitsPerBranch(c: Contract, e: string[]): void {
  const n = unitsOf(c).length
  if (n < 2) e.push(`delivery: 'branch_per_unit'이면 단위가 둘 이상이어야 함 (지금 ${n}개)`)
  c.lines.forEach((l, i) => {
    if (NEEDS_UNIT.includes(l.kind) && l.unit === undefined)
      e.push(`lines[${i}].unit: 'branch_per_unit'이면 ${l.kind} 줄은 단위가 있어야 함`)
  })
}

export function parseContract(text: string): Result<Contract> {
  let raw: unknown
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch (cause) {
    return err(`JSON을 읽지 못함: ${(cause as Error).message}`)
  }
  const e: string[] = []
  const o = shape(raw, '', e, TOP_KEYS)
  if (o === null) return err(...e)

  if (!Object.hasOwn(o, 'version')) e.push('version: 필요함')
  else if (o['version'] !== 1) e.push('version: 1이어야 함')

  const c: Contract = prune({
    version: 1 as const,
    id: req(o, 'id', '', e, contractId, ''),
    goal: req(o, 'goal', '', e, str, ''),
    lines: req(o, 'lines', '', e, list(readLine), []),
    non_goals: opt(o, 'non_goals', '', e, texts) ?? [],
    human_rules: opt(o, 'human_rules', '', e, texts) ?? [],
    examples: opt(o, 'examples', '', e, list(readExample)) ?? [],
    hint: opt(o, 'hint', '', e, str),
    tidy: opt(o, 'tidy', '', e, texts) ?? [],
    approved_by: opt(o, 'approved_by', '', e, oneOf(['human', 'caller'] as const)),
    approved_at: opt(o, 'approved_at', '', e, str),
    change_requested: opt(o, 'change_requested', '', e, str),
    delivery: opt(o, 'delivery', '', e, oneOf(DELIVERIES)),
  })
  // 줄이 없는 계약은 '모든 줄 met'을 거저 채운다
  if (Object.hasOwn(o, 'lines') && Array.isArray(o['lines']) && c.lines.length === 0)
    e.push('lines: 줄이 하나 이상 있어야 함')
  crossCheck(c, e)
  return e.length > 0 ? err(...e) : ok(c)
}

// ── 단위 (V21) ──────────────────────────────────────────────────────────────
// 한 요청은 한 Work와 한 계약이다. 단위는 계약 안의 줄 묶음이고, 단위가 없는 줄은 모든 단위에 걸친다.

/** 계약의 단위 이름: 줄에 처음 나온 차례로, 겹침 없이 */
export function unitsOf(c: Contract): string[] {
  return [...new Set(c.lines.flatMap((l) => (l.unit === undefined ? [] : [l.unit])))]
}

/**
 * 한 단위의 조각(V22가 단위 브랜치를 잴 때): 그 단위의 줄과 단위가 없는 줄, 그 줄들의 예시. 계약 id와 줄 밖의 칸은 그대로다
 */
export function sliceContract(c: Contract, unit: string): Contract {
  const lines = c.lines.filter((l) => l.unit === undefined || l.unit === unit)
  const ids = new Set(lines.map((l) => l.id))
  const examples = c.examples.filter((x) => ids.has(EXAMPLE_ID.exec(x.id)?.[1] ?? ''))
  return { ...c, lines, examples }
}

// ── 근거 확인 ───────────────────────────────────────────────────────────────

const squash = (s: string): string => s.normalize('NFC').replace(/\s+/g, ' ').trim()

export function checkRequestQuote(request: string, quote: string): boolean {
  const q = squash(quote)
  return q !== '' && squash(request).includes(q)
}

function splitLines(fileText: string): string[] {
  if (fileText === '') return []
  const lines = fileText.split(/\r\n|\n|\r/)
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

const ID_CHAR = /[\p{L}\p{N}_$]/u

/** 식별자 중간에 걸친 것(예: width 속의 id)은 이름으로 보지 않는다 */
function hasName(line: string, name: string): boolean {
  const edgeStart = ID_CHAR.test(name.charAt(0))
  const edgeEnd = ID_CHAR.test(name.charAt(name.length - 1))
  for (let i = line.indexOf(name); i !== -1; i = line.indexOf(name, i + 1)) {
    const before = line.charAt(i - 1)
    const after = line.charAt(i + name.length)
    if ((!edgeStart || !ID_CHAR.test(before)) && (!edgeEnd || !ID_CHAR.test(after))) return true
  }
  return false
}

export function checkCodeGround(
  fileText: string | null,
  ground: { line: number; name?: string },
): { ok: boolean; detail: string } {
  if (fileText === null) return { ok: false, detail: '파일이 없음' }
  const lines = splitLines(fileText)
  const n = ground.line
  if (!Number.isInteger(n) || n < 1 || n > lines.length)
    return { ok: false, detail: `${n}번 줄이 없음 (파일은 ${lines.length}줄)` }
  const name = ground.name ?? ''
  if (name === '') return { ok: true, detail: `${n}번 줄이 있음` }
  const from = Math.max(1, n - 2)
  const to = Math.min(lines.length, n + 2)
  for (let i = from; i <= to; i++) {
    if (hasName(lines[i - 1] ?? '', name)) return { ok: true, detail: `${i}번 줄에 ${name} 있음` }
  }
  return { ok: false, detail: `${from}~${to}번 줄에 ${name} 없음` }
}

// ── 예시 태그 ───────────────────────────────────────────────────────────────
// 태그에 계약 id를 넣는다. 머지된 앞 Work의 수용 시험(`[앞 계약:C1.1]`)이 레포에 남아도
// 새 계약의 C1.1 증거로 잡히지 않게 한다.

export function exampleTag(contractId: string, id: string): string {
  return `[${contractId}:${id}]`
}

const EXAMPLE_TAG = /\[([A-Za-z0-9][A-Za-z0-9._-]*):(C\d+\.\d+)\]/g

/** 시험 이름 속 이 계약의 태그가 가리키는 예시 id를 처음 나온 순서대로, 겹침 없이 */
export function findExampleTags(testName: string, contractId: string): string[] {
  const ids: string[] = []
  for (const m of testName.matchAll(EXAMPLE_TAG)) {
    if (m[1] === contractId && m[2] !== undefined && !ids.includes(m[2])) ids.push(m[2])
  }
  return ids
}

/**
 * 예시 태그(어느 계약이든)를 뺀 시험 이름. 있던 시험에 태그를 붙이면 이름이 바뀌지만 같은 시험이다(M2 평가 07:
 * 래칫이 이를 '사라진 시험'으로 읽었다)
 */
export function withoutExampleTags(testName: string): string {
  return testName.replace(EXAMPLE_TAG, ' ').replace(/\s+/g, ' ').trim()
}

export function examplesFile(examplesDir: string, contractId: string): string {
  const dir = examplesDir.replace(/\/+$/, '')
  return dir === '' ? `${contractId}.json` : `${dir}/${contractId}.json`
}

/** 계약 내용의 해시. 증거 묶음이 어느 계약(어느 판)으로 만들어졌는지 가린다 */
export function contractHash(c: Contract): string {
  return qualityHash(stableJson(c))
}

function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  if (isObj(v)) {
    const keys = Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(',')}}`
  }
  return JSON.stringify(v) ?? 'null'
}

// ── 예시 자료 (examples_dir/<계약 id>.json, V27) ─────────────────────────────
// 앱이 계약에서 정규 꼴의 파일을 쓰고(제출 때 초안, 승인과 받아들인 계약 바꾸기 때 승인본), 수용 시험을 그 파일을 얹어
// 돌린다. 세션은 그 파일을 커밋한다. head에 커밋된 파일은 승인본과 값으로 견준다.

const EXAMPLE_FIELDS = ['input', 'output', 'error', 'note'] as const

/** 예시 id의 번호 차례(C1.2가 C1.10보다 앞) */
function exampleOrder(a: string, b: string): number {
  const num = (id: string) => (/^C(\d+)\.(\d+)$/.exec(id) ?? []).slice(1).map(Number)
  const [x, y] = [num(a), num(b)]
  return (x[0] ?? 0) - (y[0] ?? 0) || (x[1] ?? 0) - (y[1] ?? 0) || (a < b ? -1 : a > b ? 1 : 0)
}

/** 값 속 객체의 열쇠를 글자 차례로. fromEntries는 `__proto__` 열쇠도 제 칸으로 둔다 */
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (!isObj(v)) return v
  return Object.fromEntries(
    Object.keys(v)
      .sort()
      .map((k) => [k, sortKeys(v[k])]),
  )
}

/** 승인본의 예시 id → { input, output?, error?, note? }. 예시 id는 번호 차례, 예시 안은 이 칸 차례 */
function canonicalExamples(c: Contract): Obj {
  const out: Obj = {}
  for (const ex of [...c.examples].sort((a, b) => exampleOrder(a.id, b.id))) {
    const entry: Obj = {}
    for (const k of EXAMPLE_FIELDS) if (ex[k] !== undefined) entry[k] = sortKeys(ex[k])
    out[ex.id] = entry
  }
  return out
}

/**
 * 계약의 예시 자료를 정규 꼴로: 예시 id에서 `{input, output?, error?, note?}`로 가는 객체, 열쇠는 정렬(예시 id는 번호 차례,
 * 예시 안은 input·output·error·note, 값 속 객체는 글자 차례), 두 칸 들여쓰기와 끝 줄바꿈. 같은 계약은 늘 같은 글이다
 */
export function examplesFileText(c: Contract): string {
  return `${JSON.stringify(canonicalExamples(c), null, 2)}\n`
}

/** 견줌 결과(경로는 부르는 쪽이 붙인다: EvidenceBundle.examples_file) */
export type ExamplesFileResult = Omit<ExamplesFileCheck, 'path'>

/**
 * head에 커밋된 예시 자료를 승인본(examplesFileText)과 값으로 견준다. 없으면 absent, JSON이 아니거나 객체가 아니면
 * unreadable, 예시나 칸이 하나라도 다르면 differs(diffs에 예시 차례로, 승인본에 없는 예시는 끝에). 칸의 순서와 들여쓰기는
 * 보지 않는다
 */
export function checkExamplesFile(contract: Contract, text: string | null): ExamplesFileResult {
  if (text === null) return { status: 'absent', diffs: [] }
  let raw: unknown
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch (cause) {
    return {
      status: 'unreadable',
      diffs: [],
      error: `JSON을 읽지 못함: ${(cause as Error).message}`,
    }
  }
  if (!isObj(raw))
    return { status: 'unreadable', diffs: [], error: '예시 id를 열쇠로 하는 객체가 아님' }
  const want = canonicalExamples(contract)
  const diffs: ExampleFileDiff[] = []
  for (const [id, expected] of Object.entries(want)) {
    if (!Object.hasOwn(raw, id)) diffs.push({ id, expected })
    else diffs.push(...entryDiffs(id, expected as Obj, raw[id]))
  }
  for (const id of Object.keys(raw))
    if (!Object.hasOwn(want, id)) diffs.push({ id, found: raw[id] })
  return { status: diffs.length === 0 ? 'same' : 'differs', diffs }
}

function entryDiffs(id: string, expected: Obj, found: unknown): ExampleFileDiff[] {
  if (!isObj(found)) return [{ id, expected, found }]
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(found)])]
  const out: ExampleFileDiff[] = []
  for (const field of keys) {
    const has = [Object.hasOwn(expected, field), Object.hasOwn(found, field)]
    if (has[0] && has[1] && stableJson(expected[field]) === stableJson(found[field])) continue
    out.push(
      prune({
        id,
        field,
        expected: has[0] ? expected[field] : undefined,
        found: has[1] ? found[field] : undefined,
      }),
    )
  }
  return out
}

/** 차이를 보이는 값: 한 줄 JSON, 앞쪽 max자 */
export function exampleValueText(v: unknown, max = 40): string {
  const text = JSON.stringify(v) ?? String(v)
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

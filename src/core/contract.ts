// 계약: 모양 검사, 근거 확인, 예시 태그, 예시 자료 확인.
import { qualityHash } from './quality.ts'
import { err, ok, type Result } from './result.ts'
import type { Contract, ContractLine, Example, Grounding, LineKind } from './types.ts'

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

const contractId = pattern(
  /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
  '영문·숫자로 시작하고 영문·숫자·. _ -만 써야 함',
)
const lineId = pattern(LINE_ID, 'C<숫자> 모양이어야 함')
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
  const o = shape(v, p, e, ['id', 'kind', 'text', 'grounds', 'examples', 'check'])
  // 대신 값은 교차 검사에서 덧붙는 오류를 내지 않는 것으로 고른다
  if (o === null)
    return { id: '', kind: 'observe', text: '', grounds: [], examples: [], check: 'human' }
  return {
    id: req(o, 'id', p, e, lineId, ''),
    kind: req(o, 'kind', p, e, oneOf(KINDS, 'observe'), 'observe'),
    text: req(o, 'text', p, e, str, ''),
    grounds: opt(o, 'grounds', p, e, list(readGround)) ?? [],
    examples: opt(o, 'examples', p, e, list(exampleId)) ?? [],
    check: req(o, 'check', p, e, oneOf(CHECKS, 'human'), 'human'),
  }
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
  })
  // 줄이 없는 계약은 '모든 줄 met'을 거저 채운다
  if (Object.hasOwn(o, 'lines') && Array.isArray(o['lines']) && c.lines.length === 0)
    e.push('lines: 줄이 하나 이상 있어야 함')
  crossCheck(c, e)
  return e.length > 0 ? err(...e) : ok(c)
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

/** 시험 이름 속 이 계약의 태그가 가리키는 예시 id를 처음 나온 순서대로, 겹침 없이 */
export function findExampleTags(testName: string, contractId: string): string[] {
  const ids: string[] = []
  for (const m of testName.matchAll(/\[([A-Za-z0-9][A-Za-z0-9._-]*):(C\d+\.\d+)\]/g)) {
    if (m[1] === contractId && m[2] !== undefined && !ids.includes(m[2])) ids.push(m[2])
  }
  return ids
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

// ── 예시 자료 (examples_dir/<계약 id>.json) ──────────────────────────────────

/**
 * 커밋된 예시 자료가 승인된 예시와 같은지 본다 (philosophy 원칙 2).
 * 파일은 예시 id → { input, output?, error?, note? } 객체이거나 계약의 examples 같은 배열이다.
 * 파일에 있는 예시만 견준다(시험이 예시를 글로 옮겨 쓴 경우는 리뷰가 본다). 없는 파일은 null.
 * 돌려주는 differs는 input·output·error 가운데 하나라도 다른 예시 id.
 */
export function checkExamplesFile(
  contract: Contract,
  text: string | null,
): { differs: string[]; error?: string } {
  if (text === null) return { differs: [] }
  let raw: unknown
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch (cause) {
    return { differs: [], error: `JSON을 읽지 못함: ${(cause as Error).message}` }
  }
  const entries = new Map<string, Obj>()
  if (Array.isArray(raw)) {
    for (const x of raw) if (isObj(x) && typeof x['id'] === 'string') entries.set(x['id'], x)
  } else if (isObj(raw)) {
    for (const [id, x] of Object.entries(raw)) if (isObj(x)) entries.set(id, x)
  } else {
    return { differs: [], error: '객체나 배열이어야 함' }
  }
  const differs: string[] = []
  for (const ex of contract.examples) {
    const got = entries.get(ex.id)
    if (got === undefined) continue
    const same = (['input', 'output', 'error'] as const).every(
      (k) => stableJson(got[k]) === stableJson(ex[k]),
    )
    if (!same) differs.push(ex.id)
  }
  return { differs }
}

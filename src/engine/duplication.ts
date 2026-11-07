// 중복 코드 래칫 (docs/quality-floor.md 2절, V56): 이름·글·수를 지운 토큰 창이 두 곳에 있으면 중복이다.
// 순수 함수다. 파일 글은 adapters git.ts readBlobs가 읽는다. 같은 입력이면 늘 같은 값이다(파일은 경로 순으로 본다).
import type { DiffFacts, RatchetResult, RatchetSpec } from '../core/types.ts'
import { inScan, langOf, listText, percent, SYNTAX, type Lang } from './languages.ts'

export type DuplicationSpec = Extract<RatchetSpec, { kind: 'duplication' }>

/** 창의 토큰 수. 이만큼 같아야 중복이다 */
export const WINDOW_TOKENS = 50
/** 중복 한 쌍이 양쪽에서 덮어야 하는 코드 줄 수 */
export const MIN_LINES = 5
/** 몫이 이만큼(0.1%p) 넘게 늘어야 나빠짐이다. 중복 줄 수도 늘어야 한다(지우기만 해서 몫이 오르면 나빠짐이 아님) */
export const EPSILON = 0.001

/** 읽는 파일의 상한(바이트). 넘으면 만든 파일로 보고 뺀다 */
export const MAX_FILE_BYTES = 1_000_000

/** 지우지 않고 그대로 두는 낱말. 이름(I)과 섞이면 모든 코드가 비슷해 보인다 */
const KEYWORDS = new Set(
  (
    'if else for while do return function const let var class new switch case default break ' +
    'continue try catch finally throw import export from def elif in is not and or lambda yield ' +
    'async await func go defer package struct interface type fn mut impl pub use match enum mod ' +
    'public private protected static final void this self super true false null nil None True ' +
    'False extends implements with as val fun object when where'
  ).split(' '),
)

/** 문장 머리가 이 낱말이면 그 문장(괄호가 닫히는 줄 끝까지)을 버린다: import 묶음은 어느 파일이나 닮았다 */
const IMPORTS: Readonly<Record<Lang, readonly string[]>> = {
  js: ['import'],
  py: ['import', 'from'],
  go: ['import', 'package'],
  java: ['import', 'package'],
  rs: ['use'],
}

export interface Token {
  t: string
  line: number
}

const SPACE = /[ \t\r\f\v]/
const WORD_START = /[A-Za-z_$\p{L}]/u
const WORD = /[\w$\p{L}\p{N}]/u

/** 토큰: 이름은 I, 글·수는 L, 낱말표는 그대로, 나머지는 글자 하나. 공백·주석은 버린다 */
export function tokenize(text: string, lang: Lang): Token[] {
  const { comment, quotes } = SYNTAX[lang]
  const out: Token[] = []
  let line = 1
  let i = 0
  const n = text.length
  const skipTo = (stop: number) => {
    for (let k = i; k < stop; k++) if (text.charCodeAt(k) === 10) line++
    i = stop
  }
  while (i < n) {
    const c = text.charAt(i)
    if (c === '\n') {
      line++
      i++
    } else if (SPACE.test(c)) i++
    else if (text.startsWith(comment, i)) {
      const end = text.indexOf('\n', i)
      i = end < 0 ? n : end
    } else if (lang !== 'py' && text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2)
      skipTo(end < 0 ? n : end + 2)
    } else if (quotes.includes(c)) {
      const close = lang === 'py' && text.startsWith(c.repeat(3), i) ? c.repeat(3) : c
      const many = close.length === 3 || c === '`'
      let j = i + close.length
      while (j < n && !text.startsWith(close, j) && (many || text.charAt(j) !== '\n'))
        j += text.charAt(j) === '\\' ? 2 : 1
      out.push({ t: 'L', line })
      skipTo(Math.min(n, j < n && text.charAt(j) !== '\n' ? j + close.length : j))
    } else if (/[0-9]/.test(c)) {
      while (i < n && /[\w.]/.test(text.charAt(i))) i++
      out.push({ t: 'L', line })
    } else if (WORD_START.test(c)) {
      const start = i
      while (i < n && WORD.test(text.charAt(i))) i++
      const word = text.slice(start, i)
      out.push({ t: KEYWORDS.has(word) ? word : 'I', line })
    } else {
      out.push({ t: c, line })
      i++
    }
  }
  return dropImports(out, IMPORTS[lang])
}

function dropImports(tokens: Token[], heads: readonly string[]): Token[] {
  const out: Token[] = []
  let depth = 0
  let skipping = -1
  for (let k = 0; k < tokens.length; k++) {
    const tok = tokens[k] as Token
    const first = k === 0 || (tokens[k - 1] as Token).line < tok.line
    if (skipping >= 0 && first && depth <= 0 && tok.line > skipping) skipping = -1
    if (skipping < 0 && first && heads.includes(tok.t)) {
      skipping = tok.line
      depth = 0
    }
    if (skipping < 0) {
      out.push(tok)
      continue
    }
    if ('([{'.includes(tok.t)) depth++
    else if (')]}'.includes(tok.t)) depth--
    skipping = tok.line
  }
  return out
}

/** 한 쪽의 자리: 경로와 줄 범위 */
export interface Span {
  path: string
  from: number
  to: number
}

export interface DupReport {
  /** 코드 줄(이름·낱말·글·수가 있는 줄. '}'만 있는 짧은 줄은 세지 않는다) */
  code: number
  /** 중복 쌍에 든 코드 줄 */
  dup: number
  share: number
  perFile: Map<string, number>
  /** 뒤 파일(a)이 앞 파일(b)을 닮은 쌍 */
  pairs: { a: Span; b: Span }[]
}

const isCode = (t: string) => t === 'I' || t === 'L' || KEYWORDS.has(t)

/** 파일 글들(경로 → 글)에서 중복을 잰다. 표에 없는 확장자는 뺀다 */
export function duplication(files: ReadonlyMap<string, string>): DupReport {
  const paths = [...files.keys()].filter((p) => langOf(p) !== null).sort()
  const toks = paths.map((p) => tokenize(files.get(p) ?? '', langOf(p) as Lang))
  const marked = paths.map(() => new Set<number>())
  const pairs: DupReport['pairs'] = []
  const seen = new Map<string, [number, number]>()
  const W = WINDOW_TOKENS
  for (let f = 0; f < paths.length; f++) {
    const ts = toks[f] as Token[]
    let run: { g: number; i: number; j: number; len: number } | null = null
    const close = () => {
      if (run !== null) keep(run.g, run.j, f, run.i, run.len)
      run = null
    }
    for (let i = 0; i + W <= ts.length; i++) {
      const key = ts
        .slice(i, i + W)
        .map((t) => t.t)
        .join(' ')
      const at = seen.get(key)
      if (at === undefined) seen.set(key, [f, i])
      if (at === undefined || (at[0] === f && i - at[1] < W)) {
        close()
        continue
      }
      const r = run as { g: number; i: number; j: number; len: number } | null
      if (r !== null && r.g === at[0] && r.i + r.len === i && r.j + r.len === at[1]) r.len++
      else {
        close()
        run = { g: at[0], i, j: at[1], len: 1 }
      }
    }
    close()
  }

  function keep(g: number, j: number, f: number, i: number, len: number): void {
    const lines = (file: number, from: number) =>
      [
        ...new Set(
          (toks[file] as Token[])
            .slice(from, from + len + W - 1)
            .filter((t) => isCode(t.t))
            .map((t) => t.line),
        ),
      ].sort((x, y) => x - y)
    const a = lines(f, i)
    const b = lines(g, j)
    if (a.length < MIN_LINES || b.length < MIN_LINES) return
    for (const l of a) marked[f]?.add(l)
    for (const l of b) marked[g]?.add(l)
    const span = (file: number, ls: number[]): Span => ({
      path: paths[file] as string,
      from: ls[0] as number,
      to: ls[ls.length - 1] as number,
    })
    pairs.push({ a: span(f, a), b: span(g, b) })
  }

  let code = 0
  let dup = 0
  const perFile = new Map<string, number>()
  paths.forEach((p, f) => {
    code += new Set((toks[f] as Token[]).filter((t) => isCode(t.t)).map((t) => t.line)).size
    const d = marked[f]?.size ?? 0
    dup += d
    if (d > 0) perFile.set(p, d)
  })
  return { code, dup, share: code === 0 ? 0 : dup / code, perFile, pairs }
}

/** 범위 안의 파일만 남긴다(spec과 늘 빼는 곳, more는 시험 파일 glob) */
export function scoped(
  files: ReadonlyMap<string, string>,
  spec: DuplicationSpec,
  more: readonly string[],
): Map<string, string> {
  return new Map([...files].filter(([p]) => inScan(p, spec, more)))
}

const spanText = (s: Span) => `${s.path}:${s.from}-${s.to}`
const pct1 = (share: number) => Math.round(share * 1000) / 10

/**
 * 기준·head의 중복을 견준다. 몫이 EPSILON 넘게 오르고 중복 줄도 늘면 나빠짐, EPSILON 넘게 내리면 나아짐. 나빠졌으면 이 diff가
 * 더한 줄(added_at)에 닿은 쌍을 where로, 중복 줄이 는 파일을 offenders로 알린다. base·head 값은 백분율(소수 한 자리)
 */
export function duplicationRatchet(
  spec: DuplicationSpec,
  base: DupReport,
  head: DupReport,
  diff: Pick<DiffFacts, 'files'>,
): RatchetResult {
  const detail = `중복 ${percent(base.share)} → ${percent(head.share)} (중복 줄 ${base.dup}/${base.code} → ${head.dup}/${head.code})`
  const nums = { base: pct1(base.share), head: pct1(head.share) }
  const delta = head.share - base.share
  if (delta < -EPSILON) return { id: spec.id, status: 'better', ...nums, detail }
  if (delta <= EPSILON || head.dup <= base.dup)
    return { id: spec.id, status: 'same', ...nums, detail }
  const added = new Map(diff.files.map((f) => [f.path, new Set(f.added_at ?? [])]))
  const touches = (s: Span) => {
    const set = added.get(s.path)
    if (set === undefined) return false
    for (let l = s.from; l <= s.to; l++) if (set.has(l)) return true
    return false
  }
  const fresh = head.pairs.filter((p) => touches(p.a) || touches(p.b))
  const offenders: NonNullable<RatchetResult['offenders']> = []
  for (const f of diff.files) {
    const now = head.perFile.get(f.path) ?? 0
    const from = f.status === 'A' || f.status === 'C' ? null : (f.old_path ?? f.path)
    const was = from === null ? 0 : (base.perFile.get(from) ?? 0)
    if (f.status === 'D' || now <= was) continue
    offenders.push(
      from === null ? { path: f.path, head: now } : { path: f.path, base: was, head: now },
    )
  }
  const shown = fresh.map((p) => `${spanText(p.a)} ↔ ${spanText(p.b)}`)
  const where = fresh.map((p) => `${spanText(p.a)} duplicates ${spanText(p.b)}`)
  return {
    id: spec.id,
    status: 'worse',
    ...nums,
    detail: shown.length === 0 ? detail : `${detail}: ${listText(shown, 3)}`,
    offenders,
    where: where.length > 5 ? [...where.slice(0, 5), `+${where.length - 5} more`] : where,
  }
}

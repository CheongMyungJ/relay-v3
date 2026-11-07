// 억누름 래칫 (docs/quality-floor.md 2절, V55): 경고를 덮거나 시험을 건너뛰는 표식을 확장자별 무늬표로 센다.
// 순수 함수다. 줄은 adapters git.ts grepLines가 GREP_NEEDLES로 먼저 거른 것을 받는다.
// 한 줄 안의 글(따옴표 안)에 든 표식은 세지 않는다. 여러 줄 글과 블록 주석 안의 따옴표는 보지 않는다(V55).
import type { DiffFacts, RatchetResult, RatchetSpec } from '../core/types.ts'
import { inScan, langOf, listText, SYNTAX, type Lang } from './languages.ts'

export type SuppressionsSpec = Extract<RatchetSpec, { kind: 'suppressions' }>

/** 표식 하나가 든 줄 */
export interface Suppression {
  path: string
  line: number
  marker: string
  /** 줄의 글(앞뒤 공백을 뺌). 기준과 견줄 때 쓴다 */
  text: string
}

interface Marker {
  /** 보일 이름. 없으면 맞은 글 그대로 */
  name?: string
  re: RegExp
}

/** 확장자별 무늬표. 하나를 더하면 GREP_NEEDLES에 그것을 거를 글이 있어야 한다([단위] suppressions.test.ts) */
export const MARKERS: Readonly<Record<Lang, readonly Marker[]>> = {
  js: [
    { name: 'eslint-disable', re: /eslint-disable/g },
    { name: '@ts-ignore', re: /@ts-ignore/g },
    { name: '@ts-expect-error', re: /@ts-expect-error/g },
    { name: '.skip(', re: /\.skip\(/g },
    { re: /\bx(?:it|describe|test)\(/g },
  ],
  py: [
    { name: '# noqa', re: /#\s*noqa\b/gi },
    { name: '# type: ignore', re: /#\s*type:\s*ignore\b/g },
    { name: '@pytest.mark.skip', re: /@pytest\.mark\.skip(?:if)?\b/g },
  ],
  go: [
    { name: '//nolint', re: /\/\/\s*nolint\b/g },
    { name: 't.Skip(', re: /\bt\.Skip(?:f|Now)?\(/g },
  ],
  java: [
    { name: '@SuppressWarnings', re: /@SuppressWarnings\b/g },
    { name: '@Suppress', re: /@Suppress\b/g },
    { name: '@Disabled', re: /@Disabled\b/g },
    { name: '@Ignore', re: /@Ignore\b/g },
  ],
  rs: [
    { name: '#[allow(', re: /#!?\[allow\(/g },
    { name: '#[ignore]', re: /#\[ignore\b/g },
  ],
}

/** git grep -i -F로 먼저 거를 글. 무늬표의 모든 표식은 이 가운데 하나를 담는다 */
export const GREP_NEEDLES: readonly string[] = [
  'eslint-disable',
  'ignore',
  '@ts-expect-error',
  'skip',
  'xit(',
  'xdescribe(',
  'xtest(',
  'noqa',
  'nolint',
  '@suppress',
  '@disabled',
  '[allow(',
]

/**
 * 줄에서 한 줄 글(따옴표 안)을 비운 것. 한 줄 주석이 시작되면 그 뒤는 그대로 둔다(주석 속 따옴표가 표식을 가리지 않게).
 * 닫지 않은 따옴표는 줄 끝까지 글이다
 */
export function codePart(line: string, lang: Lang): string {
  const { comment, quotes } = SYNTAX[lang]
  let out = ''
  for (let i = 0; i < line.length; i++) {
    if (line.startsWith(comment, i)) return out + line.slice(i)
    const ch = line.charAt(i)
    if (!quotes.includes(ch)) {
      out += ch
      continue
    }
    let j = i + 1
    while (j < line.length && line.charAt(j) !== ch) j += line.charAt(j) === '\\' ? 2 : 1
    out += ch + ch
    i = j
  }
  return out
}

/** 한 줄의 표식들. 표에 없는 확장자는 빈 목록 */
export function suppressionsInLine(path: string, line: number, text: string): Suppression[] {
  const lang = langOf(path)
  if (lang === null) return []
  const code = codePart(text, lang)
  const out: Suppression[] = []
  for (const m of MARKERS[lang]) {
    for (const hit of code.matchAll(m.re))
      out.push({ path, line, marker: m.name ?? hit[0], text: text.trim() })
  }
  return out
}

/** 파일 글 전체의 표식([단위] 시험과 작은 입력용) */
export function suppressionsIn(path: string, text: string): Suppression[] {
  return text.split(/\r?\n/).flatMap((l, i) => suppressionsInLine(path, i + 1, l))
}

/**
 * 기준·head의 표식 수를 견준다(낮을수록 좋음). 범위는 spec의 include·exclude와 늘 빼는 곳(languages.ts SCAN_EXCLUDE).
 * 나빠졌으면 수가 는 파일을 offenders(바뀐 파일만: 옮긴 파일은 옛 자리와 견준다)로, 새로 생긴 표식을 where로 알린다
 */
export function suppressionsRatchet(
  spec: SuppressionsSpec,
  base: Suppression[],
  head: Suppression[],
  diff: Pick<DiffFacts, 'files'>,
): RatchetResult {
  const b = base.filter((s) => inScan(s.path, spec))
  const h = head.filter((s) => inScan(s.path, spec))
  const detail = `억누름 ${b.length} → ${h.length}`
  const nums = { base: b.length, head: h.length }
  if (h.length === b.length) return { id: spec.id, status: 'same', ...nums, detail }
  if (h.length < b.length) return { id: spec.id, status: 'better', ...nums, detail }
  const offenders: NonNullable<RatchetResult['offenders']> = []
  const fresh: Suppression[] = []
  for (const f of diff.files) {
    if (f.status === 'D') continue
    const from = f.status === 'A' || f.status === 'C' ? null : (f.old_path ?? f.path)
    const was = from === null ? [] : b.filter((s) => s.path === from)
    const now = h.filter((s) => s.path === f.path)
    if (now.length <= was.length) continue
    offenders.push(
      from === null
        ? { path: f.path, head: now.length }
        : { path: f.path, base: was.length, head: now.length },
    )
    fresh.push(...newOnes(was, now))
  }
  const where = fresh.map((s) => `${s.path}:${s.line} ${s.marker}`)
  return {
    id: spec.id,
    status: 'worse',
    ...nums,
    detail: where.length === 0 ? detail : `${detail}: ${listText(where, 3)}`,
    offenders,
    where: where.length > 5 ? [...where.slice(0, 5), `+${where.length - 5} more`] : where,
  }
}

/** head 표식 가운데 기준의 같은 표식·같은 글과 짝이 없는 것(하나씩만 짝짓는다) */
function newOnes(was: Suppression[], now: Suppression[]): Suppression[] {
  const pool = new Map<string, number>()
  const key = (s: Suppression) => `${s.marker}\0${s.text}`
  for (const s of was) pool.set(key(s), (pool.get(key(s)) ?? 0) + 1)
  return now.filter((s) => {
    const n = pool.get(key(s)) ?? 0
    if (n > 0) pool.set(key(s), n - 1)
    return n === 0
  })
}

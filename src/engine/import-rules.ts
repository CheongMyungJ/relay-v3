// 구조 규칙 래칫 (docs/structure-rules.md 3절, V74): 사람이 고른 층(layers)과 금지(forbid)를 어긴 import의 집합을 기준·head에서
// 견준다. 순수 함수다. 새로 어긴 (가져오는 파일, 대상)이 하나라도 있으면 수가 줄었어도 나빠짐이다. 옮긴 파일은 옛 자리와 견준다.
import { matchAny } from '../core/glob.ts'
import type { DiffFacts, RatchetResult, RatchetSpec } from '../core/types.ts'
import type { ImportEdge, ImportFacts } from './imports.ts'
import { importSource } from './imports.ts'
import { listText } from './languages.ts'

export type ImportsSpec = Extract<RatchetSpec, { kind: 'imports' }>

/** 어긴 import 하나 */
export interface Violation extends ImportEdge {
  /** 어긴 규칙(보이기용): 'src/core는 src/engine을 가져오지 않음' */
  rule: string
}

/** 대상이 묶음에 드나: 파일이면 그대로, 폴더(Go 패키지, Python 이름 공간)면 그 아래의 무엇이든 */
const inGroup = (path: string, group: string[]): boolean =>
  matchAny(path, group) || matchAny(`${path}/_`, group)

const name = (group: string[]): string => group.map((g) => g.replace(/\/\*\*$|\/$/, '')).join(', ')

/** 가져오는 쪽으로 세는 파일인가: 읽는 언어, 늘 빼는 곳 밖, 시험이 아님(tests가 아니면), include·exclude */
export function counted(path: string, spec: ImportsSpec, testGlobs: readonly string[]): boolean {
  if (!importSource(path)) return false
  if (spec.tests !== true && matchAny(path, [...testGlobs])) return false
  if (spec.exclude !== undefined && matchAny(path, spec.exclude)) return false
  return spec.include === undefined || spec.include.length === 0 || matchAny(path, spec.include)
}

/** import 하나가 어긴 규칙(없으면 null). 층은 아래(뒤) 묶음이 위(앞) 묶음을 가져오면 어김 */
export function ruleBroken(spec: ImportsSpec, from: string, to: string): string | null {
  const layers = spec.layers ?? []
  const fl = layers.findIndex((g) => matchAny(from, g))
  const tl = layers.findIndex((g) => inGroup(to, g))
  if (fl >= 0 && tl >= 0 && fl > tl)
    return `${name(layers[fl] ?? [])}는 위층 ${name(layers[tl] ?? [])}를 가져오지 않음`
  for (const f of spec.forbid ?? [])
    if (matchAny(from, f.from) && inGroup(to, f.to) && !matchAny(to, f.from))
      return `${name(f.from)}는 ${name(f.to)}를 가져오지 않음`
  return null
}

export function violations(
  spec: ImportsSpec,
  facts: ImportFacts,
  testGlobs: readonly string[],
): Violation[] {
  const out: Violation[] = []
  for (const e of facts.edges) {
    if (!counted(e.from, spec, testGlobs)) continue
    const rule = ruleBroken(spec, e.from, e.to)
    if (rule !== null) out.push({ ...e, rule })
  }
  return out
}

/** 규칙 묶음에 든 '못 봄'(가져오는 쪽이 어느 묶음에 들 때만) */
export function unseenIn(
  spec: ImportsSpec,
  facts: ImportFacts,
  testGlobs: readonly string[],
): number {
  const groups = [...(spec.layers ?? []), ...(spec.forbid ?? []).map((f) => f.from)]
  return facts.unseen.filter(
    (u) => counted(u.from, spec, testGlobs) && groups.some((g) => matchAny(u.from, g)),
  ).length
}

const key = (from: string, to: string) => `${from}\0${to}`

export function importsRatchet(
  spec: ImportsSpec,
  base: Violation[],
  head: Violation[],
  diff: Pick<DiffFacts, 'files'>,
): RatchetResult {
  // 옮긴 파일: 기준의 옛 이름을 새 이름으로 바꿔 견준다(가져오는 쪽과 대상 모두)
  const moved = new Map<string, string>()
  for (const f of diff.files)
    if (f.status === 'R' && f.old_path !== undefined) moved.set(f.old_path, f.path)
  const rename = (p: string) => moved.get(p) ?? p
  const was = new Set(base.map((v) => key(rename(v.from), rename(v.to))))
  const fresh = head.filter((v) => !was.has(key(v.from, v.to)))
  const nums = { base: base.length, head: head.length }
  const detail = `구조 규칙을 어긴 import ${base.length} → ${head.length}`
  if (fresh.length === 0)
    return { id: spec.id, status: head.length < base.length ? 'better' : 'same', ...nums, detail }
  const where = fresh.map((v) => `${v.from}:${v.line} → ${v.to} (${v.rule})`)
  const by = new Map<string, number>()
  for (const v of head) by.set(v.from, (by.get(v.from) ?? 0) + 1)
  const before = new Map<string, number>()
  for (const v of base) before.set(rename(v.from), (before.get(rename(v.from)) ?? 0) + 1)
  const offenders = [...new Set(fresh.map((v) => v.from))].map((path) => {
    const b = before.get(path)
    return b === undefined
      ? { path, head: by.get(path) ?? 0 }
      : { path, base: b, head: by.get(path) ?? 0 }
  })
  return {
    id: spec.id,
    status: 'worse',
    ...nums,
    detail: `${detail}, 새로 어김 ${fresh.length}: ${listText(where, 3)}`,
    offenders,
    where: where.length > 5 ? [...where.slice(0, 5), `+${where.length - 5} more`] : where,
  }
}

// 구조 규칙 후보 (docs/structure-rules.md 5절, V75): 지금 코드의 import를 폴더 그래프로 줄여, 이미 지켜지는 방향에 이름을 붙인다.
// 순수 함수다. 앱은 설계를 지어내지 않는다: 층(순환이 없거나 아주 작은 화살표만 빼면 없음), 한쪽 방향, 거의 한쪽 방향만 낸다.
import { matchAny } from '../core/glob.ts'
import type { ImportFacts } from './imports.ts'
import { ruleBroken, type ImportsSpec } from './import-rules.ts'

/** 초안의 묻는 것에 넣는 후보 하나. value는 답의 글(층 '위>아래>…', 같은 층은 ',', 금지 '앞:뒤') */
export interface StructureCandidate {
  value: string
  label: string
  /** 근거의 무게(덮는 화살표 수). 줄 세우기에 쓴다 */
  weight: number
}

/** 한쪽 방향 후보의 최소 무게 */
export const ONE_WAY_MIN = 5
/** 거의 한쪽 방향: 이만큼 이상이고 반대쪽이 NEAR_BACK 이하 */
export const NEAR_MIN = 10
export const NEAR_BACK = 2
/** 층 후보에서 뺄 수 있는 화살표 무게의 합: 전체의 2%와 2 가운데 큰 것 */
const backLimit = (total: number) => Math.max(2, Math.floor(total * 0.02))
const MAX_CANDIDATES = 5

const dirOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '.')
const under = (p: string, dir: string) => (dir === '.' ? p : p.slice(dir.length + 1))
const tail = (p: string) => p.split('/').at(-1) ?? p

type Weights = Map<string, Map<string, number>>

/** 부모 폴더 아래의 마디(자식 폴더) 사이 화살표. 파일 하나가 같은 대상을 여러 번 가져와도 하나 */
function folderGraph(facts: ImportFacts, parent: string, skip: (p: string) => boolean): Weights {
  const node = (p: string): string | null => {
    if (parent !== '.' && !p.startsWith(`${parent}/`)) return null
    const rest = under(p, parent).split('/')
    return rest.length < 2 || rest[0] === ''
      ? null
      : parent === '.'
        ? (rest[0] ?? null)
        : `${parent}/${rest[0]}`
  }
  const w: Weights = new Map()
  for (const e of facts.edges) {
    if (skip(e.from) || skip(e.to)) continue
    const a = node(e.from)
    // 폴더 대상(Go 패키지)은 그 폴더 아래의 파일처럼 본다
    const b = node(`${e.to}/_`)
    if (a === null || b === null || a === b) continue
    const row = w.get(a) ?? new Map<string, number>()
    row.set(b, (row.get(b) ?? 0) + 1)
    w.set(a, row)
  }
  return w
}

const weight = (w: Weights, a: string, b: string) => w.get(a)?.get(b) ?? 0

/** 순환 하나(마디 목록)를 찾는다. 없으면 null */
function findCycle(w: Weights): string[] | null {
  const state = new Map<string, 1 | 2>()
  const stack: string[] = []
  const visit = (n: string): string[] | null => {
    state.set(n, 1)
    stack.push(n)
    for (const m of [...(w.get(n)?.keys() ?? [])].sort()) {
      if (state.get(m) === 1) return stack.slice(stack.indexOf(m))
      if (state.get(m) === undefined) {
        const c = visit(m)
        if (c !== null) return c
      }
    }
    stack.pop()
    state.set(n, 2)
    return null
  }
  for (const n of [...w.keys()].sort()) {
    if (state.get(n) !== undefined) continue
    const c = visit(n)
    if (c !== null) return c
  }
  return null
}

/** 순환이 없어질 때까지 순환마다 가장 가벼운 화살표를 뺀다. 뺀 무게가 상한을 넘으면 null */
function acyclic(w: Weights, limit: number): Weights | null {
  const g: Weights = new Map([...w].map(([k, v]) => [k, new Map(v)]))
  let removed = 0
  for (let cycle = findCycle(g); cycle !== null; cycle = findCycle(g)) {
    const pairs = cycle.map((a, i) => [a, cycle[(i + 1) % cycle.length] ?? a] as const)
    const [a, b] = [...pairs].sort((x, y) => weight(g, ...x) - weight(g, ...y))[0] ?? ['', '']
    removed += weight(g, a, b)
    if (removed > limit) return null
    g.get(a)?.delete(b)
  }
  return g
}

/** 층: 가져오는 것이 없는 마디가 맨 아래(0), 나머지는 가져오는 마디의 가장 높은 층 + 1 */
function levels(g: Weights, nodes: string[]): Map<string, number> {
  const out = new Map<string, number>()
  const level = (n: string): number => {
    const known = out.get(n)
    if (known !== undefined) return known
    const next = [...(g.get(n)?.keys() ?? [])]
    const v = next.length === 0 ? 0 : 1 + Math.max(...next.map(level))
    out.set(n, v)
    return v
  }
  for (const n of nodes) level(n)
  return out
}

/** 층 후보의 답 글을 규칙으로(래칫 만들기와 같은 꼴) */
export function layersOf(value: string): string[][] {
  return value.split('>').map((l) => l.split(',').map((s) => s.trim()))
}

function examples(spec: ImportsSpec, facts: ImportFacts, skip: (p: string) => boolean) {
  return facts.edges.filter((e) => !skip(e.from) && ruleBroken(spec, e.from, e.to) !== null)
}

const shown = (bad: { from: string; line: number }[]) =>
  bad.length === 0
    ? '지금 어긴 곳 0'
    : `지금 어긴 곳 ${bad.length}: ${bad
        .slice(0, 2)
        .map((e) => `${e.from}:${e.line}`)
        .join(', ')}${bad.length > 2 ? ' …' : ''}`

/**
 * 후보를 낸다(다섯까지, 무게 순: 층이 먼저). 부모 폴더는 레포 루트와 깊이 둘까지의 폴더. 시험 파일은 양쪽에서 뺀다.
 * 층 후보가 있는 부모에서는 쌍 후보를 내지 않는다(층이 이미 덮는다)
 */
export function structureCandidates(
  facts: ImportFacts,
  files: readonly string[],
  testGlobs: readonly string[],
): StructureCandidate[] {
  const skip = (p: string) => matchAny(p, [...testGlobs])
  const parents = new Set<string>(['.'])
  for (const f of files) {
    const d = dirOf(f).split('/')
    for (let k = 1; k <= Math.min(2, d.length - 1); k++) parents.add(d.slice(0, k).join('/'))
  }
  const layered: StructureCandidate[] = []
  const pairs: StructureCandidate[] = []
  for (const parent of [...parents].sort()) {
    const w = folderGraph(facts, parent, skip)
    const nodes = [
      ...new Set([...w.keys(), ...[...w.values()].flatMap((r) => [...r.keys()])]),
    ].sort()
    if (nodes.length < 2) continue
    const total = [...w.values()].reduce(
      (s, r) => s + [...r.values()].reduce((a, b) => a + b, 0),
      0,
    )
    const g = nodes.length >= 3 ? acyclic(w, backLimit(total)) : null
    const lv = g === null ? null : levels(g, nodes)
    const top = lv === null ? -1 : Math.max(...lv.values())
    if (lv !== null && top >= 2) {
      const order = Array.from({ length: top + 1 }, (_, i) => top - i).map((l) =>
        nodes.filter((n) => lv.get(n) === l),
      )
      const value = order.map((l) => l.join(',')).join('>')
      const spec: ImportsSpec = { id: 'x', kind: 'imports', layers: layersOf(value) }
      const bad = examples(spec, facts, skip)
      const where = parent === '.' ? '레포 루트' : parent
      const text = order.map((l) => l.map(tail).join('·')).join(' > ')
      layered.push({
        value,
        label: `${where}의 층(위 > 아래): ${text}. 아래 층은 위 층을 가져오지 않음 (${shown(bad)})`,
        weight: total,
      })
      continue
    }
    for (const a of nodes)
      for (const b of nodes) {
        const ab = weight(w, a, b)
        const ba = weight(w, b, a)
        const one = ab >= ONE_WAY_MIN && ba === 0
        const near = ab >= NEAR_MIN && ba > 0 && ba <= NEAR_BACK
        if (!one && !near) continue
        const spec: ImportsSpec = { id: 'x', kind: 'imports', forbid: [{ from: [b], to: [a] }] }
        const bad = examples(spec, facts, skip)
        pairs.push({
          value: `${b}:${a}`,
          label: `${b}는 ${a}를 가져오지 않음 (반대쪽 ${ab}, ${shown(bad)})`,
          weight: ab,
        })
      }
  }
  const byWeight = (x: StructureCandidate, y: StructureCandidate) =>
    y.weight - x.weight || (x.value < y.value ? -1 : 1)
  return [...layered.sort(byWeight), ...pairs.sort(byWeight)].slice(0, MAX_CANDIDATES)
}

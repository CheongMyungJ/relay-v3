// Python 의존성 묶음 읽기 (V69, 시범 찾은 문제 7·8). pyproject.toml의 [project] dependencies, [project.optional-dependencies]
// (extra), PEP 735 [dependency-groups](group, include-group 포함), poetry의 dependencies·group·extras, [tool.uv]
// default-groups와 requirements*.txt(-r 포함)를 읽어, 초안이 고를 도구가 setup이 실제로 까는 묶음에 있는지 본다. 순수 함수다.

import { arrayItems, tomlEntries } from './toml-lite.ts'

/** 꾸러미 이름의 정규형(PEP 503) */
export const normName = (n: string): string => n.toLowerCase().replace(/[-_.]+/g, '-')

/** 요구 글("pytest>=8", "pkg[a,b]; python_version>'3'")의 이름과 extra */
function requirement(spec: string): { name: string; extras: string[] } | null {
  const m = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[([^\]]*)\])?/.exec(spec)
  if (m === null) return null
  const extras = (m[2] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
  return { name: normName(m[1] ?? ''), extras }
}

export interface Pyproject {
  /** [project]가 있다 */
  project: boolean
  /** [project] dependencies(이름) */
  dependencies: string[]
  extras: Map<string, string[]>
  /** PEP 735 묶음(include-group을 풀었다) */
  groups: Map<string, string[]>
  /** poetry의 본 의존성([tool.poetry.dependencies], 옛 dev-dependencies) */
  poetryMain: string[]
  poetryGroups: Map<string, { deps: string[]; optional: boolean }>
  poetryExtras: Map<string, string[]>
  /** [tool.uv] default-groups(없으면 undefined: uv의 기본은 dev) */
  uvDefaultGroups: string[] | 'all' | undefined
  /** [tool.mypy]에 files가 있다(그러면 mypy는 대상 없이 돈다) */
  mypyFiles: boolean
}

export function readPyproject(text: string): Pyproject {
  const entries = tomlEntries(text)
  const is = (p: string[], ...want: string[]) =>
    p.length === want.length && want.every((w, i) => w === '*' || p[i] === w)
  const names = (value: string) =>
    arrayItems(value)
      .strings.map(requirement)
      .filter((r) => r !== null)
  const py: Pyproject = {
    project: /^\s*\[project\]\s*$/m.test(text) || entries.some((e) => e.path[0] === 'project'),
    dependencies: [],
    extras: new Map(),
    groups: new Map(),
    poetryMain: [],
    poetryGroups: new Map(),
    poetryExtras: new Map(),
    uvDefaultGroups: undefined,
    mypyFiles: false,
  }
  const projectName = normName(
    /^"(.*)"$/.exec(entries.find((e) => is(e.path, 'project', 'name'))?.value ?? '')?.[1] ?? '',
  )
  const rawExtras = new Map<string, { name: string; extras: string[] }[]>()
  const rawGroups = new Map<string, { deps: string[]; includes: string[] }>()
  const poetryGroup = (g: string) => {
    const x = py.poetryGroups.get(g) ?? { deps: [], optional: false }
    py.poetryGroups.set(g, x)
    return x
  }
  for (const { path: p, value } of entries) {
    if (is(p, 'project', 'dependencies')) py.dependencies = names(value).map((r) => r.name)
    else if (is(p, 'project', 'optional-dependencies', '*')) rawExtras.set(p[2] ?? '', names(value))
    else if (is(p, 'dependency-groups', '*')) {
      const items = arrayItems(value)
      const deps = items.strings.map(requirement).filter((r) => r !== null)
      rawGroups.set(p[1] ?? '', { deps: deps.map((r) => r.name), includes: items.includes })
    } else if (is(p, 'tool', 'poetry', 'dependencies', '*') && p[3] !== 'python')
      py.poetryMain.push(normName(p[3] ?? ''))
    else if (is(p, 'tool', 'poetry', 'dev-dependencies', '*'))
      py.poetryMain.push(normName(p[3] ?? ''))
    else if (is(p, 'tool', 'poetry', 'group', '*', 'dependencies', '*'))
      poetryGroup(p[3] ?? '').deps.push(normName(p[5] ?? ''))
    else if (is(p, 'tool', 'poetry', 'group', '*', 'optional'))
      poetryGroup(p[3] ?? '').optional = value === 'true'
    else if (is(p, 'tool', 'poetry', 'extras', '*'))
      py.poetryExtras.set(p[3] ?? '', arrayItems(value).strings.map(normName))
    else if (is(p, 'tool', 'uv', 'default-groups'))
      py.uvDefaultGroups = value === '"all"' ? 'all' : arrayItems(value).strings
    else if (is(p, 'tool', 'uv', 'dev-dependencies')) {
      const dev = rawGroups.get('dev') ?? { deps: [], includes: [] }
      dev.deps.push(...names(value).map((r) => r.name))
      rawGroups.set('dev', dev)
    } else if (is(p, 'tool', 'mypy', 'files')) py.mypyFiles = true
  }
  // extra가 제 꾸러미의 다른 extra를 부르면("app[lint]") 그 이름들을 더한다
  const extra = (name: string, seen: Set<string>): string[] =>
    seen.has(name)
      ? []
      : (rawExtras.get(name) ?? []).flatMap((r) =>
          r.name === projectName && projectName !== ''
            ? r.extras.flatMap((x) => extra(x, new Set([...seen, name])))
            : [r.name],
        )
  for (const name of rawExtras.keys()) py.extras.set(name, extra(name, new Set()))
  const group = (name: string, seen: Set<string>): string[] => {
    const g = rawGroups.get(name)
    if (g === undefined || seen.has(name)) return []
    const next = new Set([...seen, name])
    return [...g.deps, ...g.includes.flatMap((x) => group(x, next))]
  }
  for (const name of rawGroups.keys()) py.groups.set(name, group(name, new Set()))
  return py
}

/** requirements 글의 꾸러미 이름. `-r 다른 파일`은 texts에 있으면 따라간다 */
export function requirementNames(
  path: string,
  texts: ReadonlyMap<string, string>,
  seen: Set<string> = new Set(),
): string[] {
  const text = texts.get(path)
  if (text === undefined || seen.has(path)) return []
  seen.add(path)
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : ''
  const out: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*$/, '').trim()
    const inc = /^(?:-r|--requirement)\s*=?\s*(\S+)$/.exec(line)
    if (inc?.[1] !== undefined) out.push(...requirementNames(dir + inc[1], texts, seen))
    else if (!line.startsWith('-')) {
      const r = requirement(line)
      if (r !== null) out.push(r.name)
    }
  }
  return out
}

/**
 * 이름이 좁은 쓰임을 말하는 requirements 파일(V69, 시범 찾은 문제 8): mypy·typing·lint·docs·dev-tools 같은 조각이 들면 설치 본으로
 * 고르지 않는다(그 쓰임의 도구만 깐다). requirements.txt, -test(s), -dev 같은 것은 설치 본이다
 */
const NARROW = new Set(
  ['mypy', 'typing', 'types', 'type', 'typecheck', 'lint', 'linting', 'linters', 'flake8'].concat(
    ['ruff', 'pylint', 'style', 'format', 'docs', 'doc', 'sphinx', 'mkdocs', 'tools', 'bench'],
    ['benchmark', 'benchmarks', 'release', 'publish', 'pre-commit', 'precommit'],
  ),
)
export function narrowRequirements(name: string): boolean {
  const stem = name.replace(/^requirements/, '').replace(/\.txt$/, '')
  return stem.split(/[-_.]+/).some((t) => NARROW.has(t.toLowerCase()))
}

/** 골라야 까는 묶음 하나 */
export interface Bundle {
  kind: 'extra' | 'group' | 'poetry-group'
  name: string
  deps: string[]
}

/** 도구 칸: 앞의 이름이 먼저(ruff가 없으면 flake8) */
export type Slot = readonly string[]

/**
 * setup이 늘 까는 이름(always)에 없는 칸마다, 그 칸의 도구를 담은 묶음 가운데 남은 칸을 가장 많이 채우는 것(같으면 앞의 것)을
 * 더한다. 돌려준 has는 고른 묶음까지 깐 뒤의 이름이다
 */
export function chooseBundles(
  always: readonly string[],
  optional: readonly Bundle[],
  slots: readonly Slot[],
): { chosen: Bundle[]; has: (name: string) => boolean } {
  const have = new Set(always.map(normName))
  const chosen: Bundle[] = []
  const filled = (slot: Slot) => slot.some((t) => have.has(normName(t)))
  for (const slot of slots) {
    if (filled(slot)) continue
    for (const tool of slot) {
      const cands = optional.filter((b) => !chosen.includes(b) && b.deps.includes(normName(tool)))
      if (cands.length === 0) continue
      const score = (b: Bundle) =>
        slots.filter((s) => !filled(s) && s.some((t) => b.deps.includes(normName(t)))).length
      const best = cands.reduce((a, b) => (score(b) > score(a) ? b : a))
      chosen.push(best)
      for (const d of best.deps) have.add(d)
      break
    }
  }
  return { chosen, has: (name) => have.has(normName(name)) }
}

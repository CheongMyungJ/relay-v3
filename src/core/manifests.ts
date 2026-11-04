// 매니페스트 읽기 (signals.ts가 쓴다). 새 의존성, 의존성 출처 바뀜, 명령 정의(scripts)와
// 시험 러너 설정(pyproject의 [tool.pytest]) 바뀜을 찾는다. TOML은 필요한 만큼만 줄 단위로 읽는다.

import type { Signal } from './types.ts'

/** 매니페스트 하나의 base·head 내용. 없으면 null */
export interface ManifestPair {
  path: string
  base: string | null
  head: string | null
}

export interface ManifestReport {
  /** 명령 정의·시험 설정이 바뀜 (guard_path) */
  guard: Signal[]
  /** 새 의존성·의존성 출처 바뀜 (structure_change) */
  structure: Signal[]
  /** 새 의존성 이름(출처가 바뀐 것 포함) */
  names: string[]
}

function unique(items: string[]): string[] {
  return [...new Set(items)]
}

function listText(names: string[]): string {
  const shown = names.slice(0, 5).join(', ')
  return names.length > 5 ? `${shown} 외 ${names.length - 5}개` : shown
}

export function readManifests(manifests: ManifestPair[]): ManifestReport {
  const report: ManifestReport = { guard: [], structure: [], names: [] }
  const addName = (n: string): void => {
    if (!report.names.includes(n)) report.names.push(n)
  }
  for (const m of manifests) {
    const kind = manifestKind(m.path)
    if (kind === null) continue
    const changed = configChanges(kind, m)
    if (changed.length > 0) report.guard.push({ kind: 'guard_path', path: m.path, detail: changed })
    if (m.head === null) continue
    const before = new Set(m.base === null ? [] : readDependencies(kind, m.base))
    const added = unique(readDependencies(kind, m.head)).filter((n) => !before.has(n))
    if (added.length > 0) {
      report.structure.push(structure(m.path, `새 의존성: ${listText(added)}`))
      added.forEach(addName)
    }
    if (kind === 'npm' && m.base !== null) {
      const moved = sourceChanges(m.base, m.head).filter((c) => !added.includes(c.name))
      if (moved.length > 0) {
        const text = moved.map((c) => `${c.name} → ${c.spec}`)
        report.structure.push(structure(m.path, `의존성 출처가 바뀜: ${listText(text)}`))
        moved.forEach((c) => addName(c.name))
      }
    }
  }
  return report
}

function structure(path: string, detail: string): Signal {
  return { kind: 'structure_change', path, detail }
}

// ── 명령 정의와 시험 설정 ────────────────────────────────────────────────────
// quality.json은 base 것을 쓰지만(V9) `npm run lint`가 무엇을 돌릴지는 head의 scripts가 정한다.
// 그래서 scripts가 바뀌면 지킴 파일을 바꾼 것으로 본다(pre·post 스크립트도 명령을 바꾼다).

function configChanges(kind: ManifestKind, m: ManifestPair): string {
  if (m.base === null) return ''
  if (kind === 'npm') {
    const before = npmScripts(m.base)
    const after = m.head === null ? new Map<string, string>() : npmScripts(m.head)
    const names = unique([...before.keys(), ...after.keys()]).filter(
      (k) => before.get(k) !== after.get(k),
    )
    return names.length === 0
      ? ''
      : `명령 정의(scripts)가 바뀜: ${listText(names.map((n) => `scripts.${n}`))}`
  }
  if (kind === 'pyproject') {
    const before = pytestConfig(m.base)
    const after = m.head === null ? '' : pytestConfig(m.head)
    return before === after ? '' : '시험 설정([tool.pytest])이 바뀜'
  }
  return ''
}

function npmScripts(text: string): Map<string, string> {
  const scripts = new Map<string, string>()
  const s = readJson(text)?.['scripts']
  if (isRecord(s)) for (const [k, v] of Object.entries(s)) scripts.set(k, JSON.stringify(v))
  return scripts
}

function pytestConfig(text: string): string {
  const { entries } = readToml(text)
  const isPytest = (path: string[]): boolean => path[0] === 'tool' && path[1] === 'pytest'
  return entries
    .filter((e) => isPytest([...e.table, ...e.key]))
    .map((e) => `${[...e.table, ...e.key].join('.')}=${e.value}`)
    .join('\n')
}

/** 레지스트리 밖을 가리키는 버전 글(별칭, git, 파일, 주소, user/repo 줄임) */
const OFF_REGISTRY =
  /^(?:npm:|git|github:|gitlab:|bitbucket:|gist:|file:|link:|portal:|workspace:|https?:|\.{0,2}\/|~\/)|^[^@\s/][^\s]*\/[^\s]+$/

/** 있던 의존성이 레지스트리 밖으로 출처를 바꿈 */
function sourceChanges(base: string, head: string): { name: string; spec: string }[] {
  const before = npmSpecs(base)
  const out: { name: string; spec: string }[] = []
  for (const [name, spec] of npmSpecs(head)) {
    const was = before.get(name)
    if (was !== undefined && was !== spec && OFF_REGISTRY.test(spec)) out.push({ name, spec })
  }
  return out
}

type ManifestKind = 'npm' | 'pip' | 'go' | 'cargo' | 'pyproject'

function manifestKind(path: string): ManifestKind | null {
  const name = path.slice(path.lastIndexOf('/') + 1)
  if (name === 'package.json') return 'npm'
  if (/^requirements.*\.txt$/.test(name)) return 'pip'
  if (name === 'go.mod') return 'go'
  if (name === 'Cargo.toml') return 'cargo'
  if (name === 'pyproject.toml') return 'pyproject'
  return null
}

/** 매니페스트에 적힌 의존성 이름. 읽지 못하면 빈 목록 */
function readDependencies(kind: ManifestKind, text: string): string[] {
  switch (kind) {
    case 'npm':
      return npmDependencies(text)
    case 'pip':
      return requirementsDependencies(text)
    case 'go':
      return goDependencies(text)
    case 'cargo':
      return tomlDependencies(text, false)
    case 'pyproject':
      return tomlDependencies(text, true)
  }
}

const NPM_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function readJson(text: string): Record<string, unknown> | null {
  try {
    const data: unknown = JSON.parse(text)
    return isRecord(data) ? data : null
  } catch {
    return null
  }
}

/** package.json의 의존성 이름 → 버전 글 */
function npmSpecs(text: string): Map<string, string> {
  const specs = new Map<string, string>()
  const data = readJson(text)
  if (data === null) return specs
  for (const field of NPM_FIELDS) {
    const deps = data[field]
    if (!isRecord(deps)) continue
    for (const [name, spec] of Object.entries(deps)) {
      if (!specs.has(name)) specs.set(name, typeof spec === 'string' ? spec : JSON.stringify(spec))
    }
  }
  return specs
}

function npmDependencies(text: string): string[] {
  return [...npmSpecs(text).keys()]
}

/** PEP 508 요구 글의 이름을 PEP 503으로 맞춘다(대소문자, `-_.`) */
function pythonName(spec: string): string | null {
  const m = /^\s*([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)/.exec(spec)
  return m?.[1] ? m[1].toLowerCase().replace(/[-_.]+/g, '-') : null
}

function requirementsDependencies(text: string): string[] {
  const names: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw
      .replace(/(^|\s)#.*$/, '')
      .replace(/\s*\\$/, '')
      .trim()
    // 다른 요구 파일(-r, -c)과 해시 줄은 의존성이 아니다
    if (line === '' || /^(?:-[rc]\b|--requirement\b|--constraint\b|--hash\b)/.test(line)) continue
    // 옵션(-e, --index-url 등)과 주소 줄: #egg= 이름을 쓰고, 없으면 줄 자체를 센다(엄격한 쪽)
    if (line.startsWith('-') || /^[A-Za-z][\w+.-]*:\/\//.test(line)) {
      const egg = /#egg=([A-Za-z0-9._-]+)/.exec(line)?.[1]
      names.push((egg === undefined ? null : pythonName(egg)) ?? line.replace(/\s+/g, ' '))
      continue
    }
    const name = pythonName(line)
    if (name !== null) names.push(name)
  }
  return names
}

function goDependencies(text: string): string[] {
  const names: string[] = []
  let inBlock = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*$/, '').trim()
    if (inBlock) {
      if (line.startsWith(')')) inBlock = false
      else if (line !== '') names.push(goModule(line))
      continue
    }
    if (/^require\s*\($/.test(line)) {
      inBlock = true
      continue
    }
    const m = /^require\s+([^\s(].*)$/.exec(line)
    if (m?.[1]) names.push(goModule(m[1]))
  }
  return names
}

function goModule(spec: string): string {
  return (spec.split(/\s+/)[0] ?? '').replace(/^"|"$/g, '')
}

// TOML은 의존성 표를 읽을 만큼만 줄 단위로 읽는다.

interface TomlEntry {
  table: string[]
  key: string[]
  value: string
}

function indexOutsideQuotes(text: string, target: string): number {
  let quote: string | null = null
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i)
    if (quote !== null) {
      if (c === '\\' && quote === '"') i++
      else if (c === quote) quote = null
    } else if (c === '"' || c === "'") {
      quote = c
    } else if (c === target) {
      return i
    }
  }
  return -1
}

function stripComment(line: string): string {
  const i = indexOutsideQuotes(line, '#')
  return i < 0 ? line : line.slice(0, i)
}

function splitKey(text: string): string[] {
  const parts: string[] = []
  let rest = text
  for (;;) {
    const dot = indexOutsideQuotes(rest, '.')
    const part = (dot < 0 ? rest : rest.slice(0, dot)).trim()
    parts.push(part.replace(/^(["'])(.*)\1$/, '$2'))
    if (dot < 0) return parts
    rest = rest.slice(dot + 1)
  }
}

/** 따옴표 밖의 열린 `[`·`{` 수. 여러 줄 배열·인라인 표를 한 값으로 모으는 데 쓴다 */
function bracketDepth(text: string): number {
  let depth = 0
  let quote: string | null = null
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i)
    if (quote !== null) {
      if (c === '\\' && quote === '"') i++
      else if (c === quote) quote = null
    } else if (c === '"' || c === "'") quote = c
    else if (c === '[' || c === '{') depth++
    else if (c === ']' || c === '}') depth--
  }
  return depth
}

function readToml(text: string): { tables: string[][]; entries: TomlEntry[] } {
  const tables: string[][] = []
  const entries: TomlEntry[] = []
  let table: string[] = []
  let pending: TomlEntry | null = null
  let multiString: string | null = null
  for (const raw of text.split(/\r?\n/)) {
    if (multiString !== null) {
      if (raw.includes(multiString)) multiString = null
      continue
    }
    const line = stripComment(raw).trim()
    if (pending !== null) {
      pending.value += ` ${line}`
      if (bracketDepth(pending.value) <= 0) {
        entries.push(pending)
        pending = null
      }
      continue
    }
    if (line === '') continue
    const header = /^\[\[?\s*(.+?)\s*\]\]?$/.exec(line)
    if (header?.[1]) {
      table = splitKey(header[1])
      tables.push(table)
      continue
    }
    const eq = indexOutsideQuotes(line, '=')
    if (eq < 0) continue
    const entry = { table, key: splitKey(line.slice(0, eq)), value: line.slice(eq + 1).trim() }
    const delim = entry.value.slice(0, 3)
    if ((delim === '"""' || delim === "'''") && !entry.value.slice(3).includes(delim)) {
      multiString = delim
    }
    if (/^[[{]/.test(entry.value) && bracketDepth(entry.value) > 0) pending = entry
    else entries.push(entry)
  }
  if (pending !== null) entries.push(pending)
  return { tables, entries }
}

/** 배열 값 속 PEP 508 글의 이름. 인라인 표(`{ include-group = ... }`)는 뺀다 */
function pep508Names(value: string): string[] {
  const names: string[] = []
  const text = value.replace(/\{[^}]*\}/g, '')
  for (const m of text.matchAll(/"([^"]*)"|'([^']*)'/g)) {
    const name = pythonName(m[1] ?? m[2] ?? '')
    if (name !== null) names.push(name)
  }
  return names
}

const DEPENDENCY_TABLE = /dependencies$|^dependency-groups$/

/**
 * Cargo: [dependencies]·[dev-dependencies]·[build-dependencies]·[target.*.dependencies]의 키와
 * [dependencies.이름] 표. pyproject: Poetry 표의 키(python 빼고)와
 * PEP 621·735 배열(project.dependencies, optional-dependencies, dependency-groups)의 이름.
 */
function tomlDependencies(text: string, python: boolean): string[] {
  const { tables, entries } = readToml(text)
  const names: string[] = []
  const add = (name: string | undefined): void => {
    if (name === undefined || name === '') return
    const n = python ? pythonName(name) : name
    if (n !== null && !(python && n === 'python')) names.push(n)
  }
  for (const t of tables) {
    const parent = t[t.length - 2]
    if (parent !== undefined && DEPENDENCY_TABLE.test(parent)) add(t[t.length - 1])
  }
  for (const e of entries) {
    const isArray = e.value.startsWith('[')
    const leaf = e.key[e.key.length - 1] ?? ''
    const last = e.table[e.table.length - 1]
    if (python && isArray && leaf.endsWith('dependencies')) {
      names.push(...pep508Names(e.value))
    } else if (python && e.value.startsWith('{') && leaf.endsWith('dependencies')) {
      // optional-dependencies = { dev = ["pytest"] } 같은 인라인 표
      names.push(...pep508Names(e.value.slice(1, e.value.lastIndexOf('}'))))
    } else if (last !== undefined && DEPENDENCY_TABLE.test(last)) {
      if (python && isArray && e.key.length === 1) names.push(...pep508Names(e.value))
      else add(e.key[0])
    }
  }
  return names
}

// diff에서 사람에게 보낼 신호를 찾는다 (docs/m1-modules.md signals.ts, devices.md 바닥 장치).
// 사람 경로, 지킴 파일, 시험 약화, 구조 변경. 결정론이고 놓치기보다 더 보내는 쪽을 고른다.

import { firstMatch, matchAny } from './glob.ts'
import { DEFAULT_TEST_GLOBS, effectiveGuardPaths } from './quality.ts'
import type { DiffFacts, FileChange, QualityConfig, Signal, SignalKind } from './types.ts'

/** 매니페스트 하나의 base·head 내용. 없으면 null */
export interface ManifestPair {
  path: string
  base: string | null
  head: string | null
}

export interface SignalInput {
  diff: DiffFacts
  quality: QualityConfig
  /** base 트리의 모든 디렉터리 */
  baseDirs: Set<string>
  manifests: ManifestPair[]
}

export interface SignalReport {
  signals: Signal[]
  new_dependencies: string[]
  new_modules: string[]
}

export function detectSignals(input: SignalInput): SignalReport {
  const { diff, quality } = input
  const testGlobs = quality.test_globs.length > 0 ? quality.test_globs : DEFAULT_TEST_GLOBS
  const modules = newModules(diff.files, input.baseDirs, testGlobs, quality.examples_dir)
  const deps = newDependencies(input.manifests)
  const signals: Signal[] = [
    ...pathSignals(diff.files, quality.human_paths, 'human_path', '사람 경로를 건드림'),
    ...pathSignals(diff.files, effectiveGuardPaths(quality), 'guard_path', '지킴 파일을 건드림'),
    ...testWeakening(diff.files, testGlobs),
    ...modules.map((dir) => structure(dir, `새 모듈: ${dir}`)),
    ...deps.signals,
    ...publicNames(diff.files, quality.public_api),
  ]
  return { signals, new_dependencies: deps.names, new_modules: modules }
}

// ── 공통 ────────────────────────────────────────────────────────────────────

function touchedPaths(f: FileChange): string[] {
  return f.old_path !== undefined && f.old_path !== f.path ? [f.path, f.old_path] : [f.path]
}

function unique(items: string[]): string[] {
  return [...new Set(items)]
}

/** 이름 목록을 짧게: 다섯 개까지 쓰고 나머지는 수만 */
function listText(names: string[]): string {
  const shown = names.slice(0, 5).join(', ')
  return names.length > 5 ? `${shown} 외 ${names.length - 5}개` : shown
}

function clip(line: string): string {
  const t = line.trim()
  return t.length > 60 ? `${t.slice(0, 59)}…` : t
}

function structure(path: string, detail: string): Signal {
  return { kind: 'structure_change', path, detail }
}

function isUnder(path: string, dir: string): boolean {
  return dir !== '' && (path === dir || path.startsWith(`${dir}/`))
}

function normalizeDir(dir: string): string {
  return dir.replace(/^(\.\/)+/, '').replace(/\/+$/, '')
}

// ── 사람 경로, 지킴 파일 ─────────────────────────────────────────────────────

function pathSignals(
  files: FileChange[],
  globs: string[],
  kind: SignalKind,
  label: string,
): Signal[] {
  if (globs.length === 0) return []
  const out: Signal[] = []
  for (const f of files) {
    for (const path of touchedPaths(f)) {
      const glob = firstMatch(path, globs)
      if (glob !== null) {
        out.push({ kind, path, detail: `${label} (${glob})` })
        break
      }
    }
  }
  return out
}

// ── 시험 약화 ───────────────────────────────────────────────────────────────

const SKIP_MARKERS: RegExp[] = [
  /\.skip\(/,
  /\.only\(/,
  /\bx(it|describe|test)\(/,
  /\bf(it|describe)\(/,
  /\.todo\(/,
  /@pytest\.mark\.(skip|xfail)/,
  /unittest\.skip/,
  /t\.Skip\(/,
  /#\[ignore\]/,
  /@Disabled/,
  /@Ignore/,
]

const ASSERTION = /expect\(|assert|should\./

function countAssertions(lines: string[]): number {
  return lines.filter((l) => ASSERTION.test(l)).length
}

function testWeakening(files: FileChange[], testGlobs: string[]): Signal[] {
  const out: Signal[] = []
  for (const f of files) {
    const isTest = matchAny(f.path, testGlobs)
    if (f.status === 'D') {
      if (isTest) out.push({ kind: 'test_weakening', path: f.path, detail: '시험 파일을 지움' })
      continue
    }
    if (f.status === 'R' && f.old_path !== undefined && !isTest && matchAny(f.old_path, testGlobs)) {
      // 시험 glob 밖으로 옮기면 러너가 더는 줍지 않는다. 지운 것과 같다
      out.push({
        kind: 'test_weakening',
        path: f.old_path,
        detail: `시험 파일을 시험 밖으로 옮김 (${f.path})`,
      })
      continue
    }
    if (!isTest) continue
    const marker = f.added_lines.find((l) => SKIP_MARKERS.some((r) => r.test(l)))
    if (marker !== undefined) {
      out.push({
        kind: 'test_weakening',
        path: f.path,
        detail: `건너뛰기·하나만 표식을 더함: ${clip(marker)}`,
      })
    }
    const removed = countAssertions(f.removed_lines)
    const added = countAssertions(f.added_lines)
    if (removed > added) {
      out.push({
        kind: 'test_weakening',
        path: f.path,
        detail: `단언 줄이 줄어듦 (지움 ${removed}, 더함 ${added})`,
      })
    }
  }
  return out
}

// ── 구조 변경: 새 모듈 ───────────────────────────────────────────────────────

function newModules(
  files: FileChange[],
  baseDirs: Set<string>,
  testGlobs: string[],
  examplesDir: string,
): string[] {
  const examples = normalizeDir(examplesDir)
  const found: string[] = []
  for (const f of files) {
    // 이름 바뀜·복사도 새 자리에 파일이 생긴다
    if (f.status !== 'A' && f.status !== 'R' && f.status !== 'C') continue
    const path = f.path
    if (matchAny(path, testGlobs) || isUnder(path, examples) || isUnder(path, '.relay')) continue
    const segments = path.split('/').slice(0, -1)
    let dir = ''
    for (const segment of segments) {
      dir = dir === '' ? segment : `${dir}/${segment}`
      if (!baseDirs.has(dir) && !baseDirs.has(`${dir}/`)) {
        if (!found.includes(dir)) found.push(dir)
        break
      }
    }
  }
  return found
}

// ── 구조 변경: 새 의존성 ─────────────────────────────────────────────────────

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

function newDependencies(manifests: ManifestPair[]): { signals: Signal[]; names: string[] } {
  const signals: Signal[] = []
  const names: string[] = []
  for (const m of manifests) {
    const kind = manifestKind(m.path)
    if (kind === null || m.head === null) continue
    const before = new Set(m.base === null ? [] : readDependencies(kind, m.base))
    const added = unique(readDependencies(kind, m.head)).filter((n) => !before.has(n))
    if (added.length === 0) continue
    signals.push(structure(m.path, `새 의존성: ${listText(added)}`))
    for (const n of added) if (!names.includes(n)) names.push(n)
  }
  return { signals, names }
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

function npmDependencies(text: string): string[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return []
  }
  if (!isRecord(data)) return []
  const names: string[] = []
  for (const field of NPM_FIELDS) {
    const deps = data[field]
    if (isRecord(deps)) names.push(...Object.keys(deps))
  }
  return names
}

/** PEP 508 요구 글의 이름을 PEP 503으로 맞춘다(대소문자, `-_.`) */
function pythonName(spec: string): string | null {
  const m = /^\s*([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)/.exec(spec)
  return m?.[1] ? m[1].toLowerCase().replace(/[-_.]+/g, '-') : null
}

function requirementsDependencies(text: string): string[] {
  const names: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*$/, '').trim()
    // 옵션(-r, -e, --hash)과 주소만 있는 줄은 이름이 없다
    if (line === '' || line.startsWith('-') || /^[A-Za-z][\w+.-]*:\/\//.test(line)) continue
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
    } else if (last !== undefined && DEPENDENCY_TABLE.test(last)) {
      if (python && isArray && e.key.length === 1) names.push(...pep508Names(e.value))
      else add(e.key[0])
    }
  }
  return names
}

// ── 구조 변경: 새 공개 이름 ──────────────────────────────────────────────────

type Lang = 'js' | 'rust' | 'python'

function langOf(path: string): Lang {
  if (/\.pyi?$/.test(path)) return 'python'
  if (path.endsWith('.rs')) return 'rust'
  return 'js'
}

const PUBLIC_LINE: Record<Lang, RegExp> = {
  js: /^\s*export\s/,
  rust: /^pub\s/,
  python: /^(?:async def|def|class) [A-Za-z]/,
}

const JS_DECL =
  /^\s*export\s+(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\s*\*\s*|(?:function|class|const|let|var|interface|type|enum|namespace|module)\s+)([A-Za-z_$][\w$]*)/
const JS_LIST = /^\s*export\s+(?:type\s+)?\{([^}]*)\}/
const RUST_DECL =
  /^pub\s+(?:(?:unsafe|async|const|extern(?:\s+"[^"]*")?)\s+)*(?:fn|struct|enum|trait|type|mod|const|static|union|macro)\s+([A-Za-z_]\w*)/
const PYTHON_DECL = /^(?:async def|def|class) ([A-Za-z_]\w*)/

/** 공개 줄이 내놓는 이름. 이름을 못 뽑으면 줄 자체를 이름으로 본다 */
function declaredNames(line: string, lang: Lang): string[] {
  if (lang === 'js') {
    const decl = JS_DECL.exec(line)
    if (decl?.[1]) return [decl[1]]
    const list = JS_LIST.exec(line)
    if (list?.[1] !== undefined) {
      return list[1]
        .split(',')
        .map((part) => (part.split(/\s+as\s+/).pop() ?? '').trim())
        .filter((n) => n !== '')
    }
    if (/^\s*export\s+default\b/.test(line)) return ['default']
  } else {
    const decl = (lang === 'rust' ? RUST_DECL : PYTHON_DECL).exec(line)
    if (decl?.[1]) return [decl[1]]
  }
  return [line.trim()]
}

function publicNamesOf(lines: string[], lang: Lang): string[] {
  return lines.filter((l) => PUBLIC_LINE[lang].test(l)).flatMap((l) => declaredNames(l, lang))
}

function publicNames(files: FileChange[], publicApi: string[]): Signal[] {
  if (publicApi.length === 0) return []
  const out: Signal[] = []
  for (const f of files) {
    if (f.status === 'D' || !matchAny(f.path, publicApi)) continue
    const lang = langOf(f.path)
    // 지운 줄에 같은 이름이 있으면 모양만 바꾼 것이다
    const before = new Set(publicNamesOf(f.removed_lines, lang))
    const added = unique(publicNamesOf(f.added_lines, lang)).filter((n) => !before.has(n))
    if (added.length > 0) out.push(structure(f.path, `새 공개 이름: ${listText(added)}`))
  }
  return out
}

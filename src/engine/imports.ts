// 구조 규칙의 import 읽기 (docs/structure-rules.md 4절, V74). JS/TS·Python·Go 소스에서 import를 뽑아 레포 안의 대상으로 푼다.
// 순수 함수다. 정밀한 파서가 아니라 주석을 지운 글 위의 무늬로 읽는다. 레포 밖(패키지, 표준 라이브러리)은 버리고,
// 레포 안으로 보이는데 풀지 못한 것과 글자 그대로가 아닌 동적 import는 '못 봄'으로 센다.
import { matchAny } from '../core/glob.ts'
import { langOf, SCAN_EXCLUDE } from './languages.ts'

/** 레포 안의 import 하나. to는 파일 경로이거나(JS·Python) 폴더 경로다(Go 패키지, Python 이름 공간 패키지) */
export interface ImportEdge {
  from: string
  to: string
  line: number
  /** 적힌 그대로의 대상(보이기용) */
  spec: string
}

export interface ImportFacts {
  edges: ImportEdge[]
  /** 레포 안으로 보이는데 풀지 못한 것, 글자 그대로가 아닌 동적 import */
  unseen: { from: string; line: number; spec: string }[]
  /** 읽은 소스 파일 수 */
  files: number
}

/** 읽는 언어. Java/Kotlin·Rust는 2단계(structure-rules 11절) */
export const IMPORT_LANGS = ['js', 'py', 'go'] as const

/** import를 읽는 소스 파일인가 */
export function importSource(path: string): boolean {
  const l = langOf(path)
  return (l === 'js' || l === 'py' || l === 'go') && !matchAny(path, [...SCAN_EXCLUDE])
}

/** 풀기에 쓰는 설정 글: tsconfig·jsconfig(별칭), package.json(작업 공간 이름), go.mod(module) */
export function importConfig(path: string): boolean {
  if (matchAny(path, [...SCAN_EXCLUDE])) return false
  const name = path.slice(path.lastIndexOf('/') + 1)
  return (
    /^(?:tsconfig.*|jsconfig)\.json$/.test(name) || name === 'package.json' || name === 'go.mod'
  )
}

// ── 주석 지우기 ──────────────────────────────────────────────────────────────

/**
 * 주석을 공백으로 바꾼다(줄바꿈과 자리는 둔다). strings면 글(따옴표 안)도 지운다: Python은 늘(import 대상이 글이 아님),
 * JS·Go는 낱말이 글 밖에 있는지 볼 때만(대상이 글이다). 정규식 글과 템플릿 안의 식은 보지 않는다
 */
export function stripComments(
  text: string,
  lang: 'js' | 'py' | 'go',
  strings = lang === 'py',
): string {
  const out: string[] = []
  const n = text.length
  const blank = (s: string) => s.replace(/[^\n]/g, ' ')
  let i = 0
  while (i < n) {
    const c = text.charAt(i)
    const line = lang === 'py' ? c === '#' : text.startsWith('//', i)
    if (line) {
      const end = text.indexOf('\n', i)
      const stop = end < 0 ? n : end
      out.push(blank(text.slice(i, stop)))
      i = stop
    } else if (lang !== 'py' && text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2)
      const stop = end < 0 ? n : end + 2
      out.push(blank(text.slice(i, stop)))
      i = stop
    } else if (c === '"' || c === "'" || c === '`') {
      const triple = lang === 'py' && text.startsWith(c.repeat(3), i)
      const close = triple ? c.repeat(3) : c
      const many = triple || c === '`'
      let j = i + close.length
      while (j < n && !text.startsWith(close, j) && (many || text.charAt(j) !== '\n'))
        j += text.charAt(j) === '\\' && !(lang === 'go' && c === '`') ? 2 : 1
      const stop = Math.min(n, j < n && text.startsWith(close, j) ? j + close.length : j)
      const s = text.slice(i, stop)
      out.push(
        strings && s.length >= 2 ? s.charAt(0) + blank(s.slice(1, -1)) + s.charAt(s.length - 1) : s,
      )
      i = stop
    } else {
      out.push(c)
      i++
    }
  }
  return out.join('')
}

// ── 뽑기 ────────────────────────────────────────────────────────────────────

/** 파일 하나에서 뽑은 import. spec은 적힌 대상(JS 경로, Python 점 이름, Go 가져오기 경로) */
export interface RawImport {
  line: number
  spec: string
  /** Python: from 뒤의 이름들(`from . import a, b`) */
  names?: string[]
  /** 글자 그대로가 아닌 동적 import */
  dynamic?: boolean
}

const lineAt = (text: string, index: number): number => {
  let n = 1
  for (let k = 0; k < index; k++) if (text.charCodeAt(k) === 10) n++
  return n
}

const JS_PATTERNS = [
  // 꼴: import 이름 from 대상, import { a, b } from 대상, import type …, import 대상(대상은 따옴표 글). 주석에 그대로 적으면 electron-vite의 ESM 심이 import로 읽는다
  /(?<![.\w$])import\s+(?:type\s+)?(?:[\w$*{}\s,]+?\s+from\s*)?(['"])([^'"\n]+)\1/g,
  // export * from 'y', export { a } from 'y'
  /(?<![.\w$])export\s+(?:type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*(['"])([^'"\n]+)\1/g,
  // import('y'), require('y')
  /(?<![.\w$])(?:import|require)\s*\(\s*(['"`])([^'"`\n$]+)\1\s*\)/g,
]
const JS_DYNAMIC = /(?<![.\w$])import\s*\(\s*(?!['"`][^'"`\n$]+['"`]\s*\))/g

/** 글 안의 낱말(예: 시험 자료의 코드 글)은 import가 아니다: 글을 지운 글에서도 그 자리에 낱말이 있어야 한다 */
const outsideStrings = (bare: string, at: number) =>
  /^(?:import|export|require)/.test(bare.slice(at, at + 7))

function jsImports(text: string): RawImport[] {
  const code = stripComments(text, 'js')
  const bare = stripComments(text, 'js', true)
  const out: RawImport[] = []
  for (const re of JS_PATTERNS)
    for (const m of code.matchAll(re))
      if (outsideStrings(bare, m.index)) out.push({ line: lineAt(code, m.index), spec: m[2] ?? '' })
  for (const m of bare.matchAll(JS_DYNAMIC))
    out.push({ line: lineAt(code, m.index), spec: 'import(…)', dynamic: true })
  return out.sort((a, b) => a.line - b.line)
}

const PY_NAME = /^[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*$/

function pyImports(text: string): RawImport[] {
  const lines = stripComments(text, 'py').split('\n')
  const out: RawImport[] = []
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] ?? ''
    const imp = /^\s*import\s+(.+)$/.exec(l)
    if (imp) {
      for (const part of (imp[1] ?? '').split(',')) {
        const name =
          part
            .trim()
            .split(/\s+as\s+/)[0]
            ?.trim() ?? ''
        if (PY_NAME.test(name)) out.push({ line: i + 1, spec: name })
      }
      continue
    }
    const from = /^\s*from\s+(\.*)([\w.]*)\s+import\s+(.*)$/.exec(l)
    if (!from) continue
    let rest = from[3] ?? ''
    // 괄호로 여러 줄에 걸친 이름들
    for (let j = i + 1; rest.includes('(') && !rest.includes(')') && j < lines.length; j++)
      rest += ` ${lines[j] ?? ''}`
    const names = rest
      .replace(/[()\\]/g, ' ')
      .split(',')
      .map(
        (x) =>
          x
            .trim()
            .split(/\s+as\s+/)[0]
            ?.trim() ?? '',
      )
      .filter((x) => /^[A-Za-z_]\w*$/.test(x))
    out.push({ line: i + 1, spec: `${from[1] ?? ''}${from[2] ?? ''}`, names })
  }
  return out
}

function goImports(text: string): RawImport[] {
  // 여러 줄 글(`…`) 안의 import 줄은 지운다(대상의 따옴표 "…"는 그대로)
  const code = stripComments(text, 'go').replace(/`[^`]*`/g, (s) => s.replace(/[^\n]/g, ' '))
  const out: RawImport[] = []
  const one = /^[ \t]*import[ \t]+(?:[\w.]+[ \t]+)?"([^"\n]+)"/gm
  for (const m of code.matchAll(one)) out.push({ line: lineAt(code, m.index), spec: m[1] ?? '' })
  for (const m of code.matchAll(/^[ \t]*import[ \t]*\(([^)]*)\)/gm)) {
    const start = m.index + m[0].indexOf('(')
    for (const s of (m[1] ?? '').matchAll(/(?:^|\n)[ \t]*(?:[\w.]+[ \t]+)?"([^"\n]+)"/g))
      out.push({ line: lineAt(code, start + 1 + s.index + s[0].indexOf('"')), spec: s[1] ?? '' })
  }
  return out.sort((a, b) => a.line - b.line)
}

/** 파일 하나의 import(표에 없는 언어는 빈 목록) */
export function rawImports(path: string, text: string): RawImport[] {
  const l = langOf(path)
  return l === 'js'
    ? jsImports(text)
    : l === 'py'
      ? pyImports(text)
      : l === 'go'
        ? goImports(text)
        : []
}

// ── 풀기 ────────────────────────────────────────────────────────────────────

interface Alias {
  /** tsconfig가 있는 폴더(이 아래 파일에만 쓴다) */
  dir: string
  base: string | null
  paths: [string, string[]][]
}

/** 풀기에 쓰는 레포의 사실. 파일 목록과 설정 글로 한 번 만든다 */
export interface ImportContext {
  files: ReadonlySet<string>
  dirs: ReadonlySet<string>
  aliases: Alias[]
  /** 작업 공간 패키지 이름 → 폴더 */
  packages: Map<string, string>
  /** Go module 경로 → 폴더(긴 것부터) */
  modules: [string, string][]
  /** Python 모듈 점 이름 → 파일이나 폴더 */
  pyModules: Map<string, string>
  /** Python 최상위 이름(레포 안의 것) */
  pyTop: Set<string>
}

const dirOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '.')
const join = (dir: string, rel: string): string | null => {
  const parts = dir === '.' ? [] : dir.split('/')
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (parts.length === 0) return null
      parts.pop()
    } else parts.push(seg)
  }
  return parts.length === 0 ? '.' : parts.join('/')
}

/** 주석과 끝 쉼표를 허락하는 JSON(tsconfig) */
export function looseJson(text: string): unknown {
  const code = stripComments(text, 'js').replace(/,(\s*[}\]])/g, '$1')
  try {
    return JSON.parse(code) as unknown
  } catch {
    return null
  }
}

const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null

export function importContext(
  files: readonly string[],
  texts: ReadonlyMap<string, string>,
): ImportContext {
  const set = new Set(files)
  const dirs = new Set<string>()
  for (const f of files) for (let d = dirOf(f); d !== '.'; d = dirOf(d)) dirs.add(d)
  const aliases: Alias[] = []
  const packages = new Map<string, string>()
  const modules: [string, string][] = []
  for (const [path, text] of [...texts].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (!importConfig(path)) continue
    const dir = dirOf(path)
    const name = path.slice(path.lastIndexOf('/') + 1)
    if (name === 'go.mod') {
      const m = /^\s*module\s+(\S+)/m.exec(stripComments(text, 'go'))
      if (m) modules.push([(m[1] ?? '').replace(/^"|"$/g, ''), dir])
    } else if (name === 'package.json') {
      const n = obj(looseJson(text))?.['name']
      if (typeof n === 'string' && n !== '' && dir !== '.') packages.set(n, dir)
    } else {
      const opts = obj(obj(looseJson(text))?.['compilerOptions'])
      if (opts === null) continue
      const base = typeof opts['baseUrl'] === 'string' ? join(dir, opts['baseUrl']) : null
      const paths = Object.entries(obj(opts['paths']) ?? {}).flatMap(([k, v]) =>
        Array.isArray(v)
          ? [[k, v.filter((x): x is string => typeof x === 'string')] as [string, string[]]]
          : [],
      )
      if (base !== null || paths.length > 0) aliases.push({ dir, base, paths })
    }
  }
  modules.sort((a, b) => b[0].length - a[0].length)
  // tsconfig는 가까운 것부터
  aliases.sort((a, b) => b.dir.length - a.dir.length)
  const { pyModules, pyTop } = pythonModules(files, set)
  return { files: set, dirs, aliases, packages, modules, pyModules, pyTop }
}

/**
 * Python 모듈 표. 뿌리는 레포 루트, `src/`, 그리고 pyproject·setup.py가 있는 폴더(와 그 `src/`). 뿌리 바로 아래의 .py
 * 파일과 폴더(그 안에 .py가 있는)가 최상위 이름이다
 */
function pythonModules(files: readonly string[], set: ReadonlySet<string>) {
  const py = files.filter((f) => f.endsWith('.py') && importSource(f))
  const roots = new Set(['.', 'src'])
  for (const f of files)
    if (/(^|\/)(pyproject\.toml|setup\.py|setup\.cfg)$/.test(f)) {
      roots.add(dirOf(f))
      roots.add(join(dirOf(f), 'src') ?? 'src')
    }
  const pyModules = new Map<string, string>()
  const pyTop = new Set<string>()
  for (const root of [...roots].sort((a, b) => b.length - a.length)) {
    const prefix = root === '.' ? '' : `${root}/`
    for (const f of py) {
      if (!f.startsWith(prefix)) continue
      const parts = f.slice(prefix.length, -3).split('/')
      if (parts.some((p) => !/^[A-Za-z_]\w*$/.test(p))) continue
      if (parts.at(-1) === '__init__') parts.pop()
      if (parts.length === 0) continue
      pyTop.add(parts[0] ?? '')
      const name = parts.join('.')
      if (!pyModules.has(name)) pyModules.set(name, f)
      // 폴더(이름 공간 패키지 포함)
      for (let k = 1; k < parts.length; k++) {
        const pkg = parts.slice(0, k).join('.')
        if (!pyModules.has(pkg)) {
          const dir = prefix + parts.slice(0, k).join('/')
          pyModules.set(pkg, set.has(`${dir}/__init__.py`) ? `${dir}/__init__.py` : dir)
        }
      }
    }
  }
  return { pyModules, pyTop }
}

const JS_EXT = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.d.ts']

/** JS 경로(확장자 없음, .js를 .ts로 쓴 ESM 꼴, 폴더의 index)를 레포의 파일로 */
function jsFile(ctx: ImportContext, path: string): string | null {
  if (ctx.files.has(path)) return path
  const stem = path.replace(/\.(?:m|c)?js$|\.jsx$/, '')
  for (const e of JS_EXT) if (ctx.files.has(stem + e)) return stem + e
  for (const e of JS_EXT) if (ctx.files.has(`${path}/index${e}`)) return `${path}/index${e}`
  if (ctx.dirs.has(path)) return path
  return null
}

type Resolved = { to: string } | 'external' | 'unseen'

function resolveJs(ctx: ImportContext, from: string, spec: string): Resolved {
  const clean = spec.replace(/[?#].*$/, '')
  if (clean.startsWith('.') || clean.startsWith('/')) {
    const p = clean.startsWith('/') ? join('.', clean) : join(dirOf(from), clean)
    const f = p === null ? null : jsFile(ctx, p)
    return f === null ? 'unseen' : { to: f }
  }
  for (const a of ctx.aliases) {
    if (a.dir !== '.' && !from.startsWith(`${a.dir}/`)) continue
    for (const [key, targets] of a.paths) {
      const star = key.indexOf('*')
      const hit =
        star < 0
          ? clean === key
            ? ''
            : null
          : clean.startsWith(key.slice(0, star)) && clean.endsWith(key.slice(star + 1))
            ? clean.slice(star, clean.length - (key.length - star - 1))
            : null
      if (hit === null) continue
      for (const t of targets) {
        const p = join(a.base ?? a.dir, t.replace('*', hit))
        const f = p === null ? null : jsFile(ctx, p)
        if (f !== null) return { to: f }
      }
      return 'unseen'
    }
    if (a.base !== null) {
      const p = join(a.base, clean)
      const f = p === null ? null : jsFile(ctx, p)
      if (f !== null) return { to: f }
    }
  }
  const name = clean.startsWith('@') ? clean.split('/').slice(0, 2).join('/') : clean.split('/')[0]
  const dir = name === undefined ? undefined : ctx.packages.get(name)
  if (dir !== undefined) {
    const rest = clean.slice((name ?? '').length).replace(/^\//, '')
    const f = rest === '' ? null : jsFile(ctx, `${dir}/${rest}`)
    return { to: f ?? dir }
  }
  return 'external'
}

function resolvePy(ctx: ImportContext, from: string, imp: RawImport): Resolved[] {
  const dots = /^\.*/.exec(imp.spec)?.[0].length ?? 0
  if (dots > 0) {
    let dir: string | null = dirOf(from)
    for (let k = 1; k < dots && dir !== null; k++) dir = dir === '.' ? null : dirOf(dir)
    if (dir === null) return ['unseen']
    const rest = imp.spec.slice(dots).replace(/\./g, '/')
    const base = rest === '' ? dir : join(dir, rest)
    if (base === null) return ['unseen']
    const at = (p: string): string | null =>
      ctx.files.has(`${p}.py`)
        ? `${p}.py`
        : ctx.files.has(`${p}/__init__.py`)
          ? `${p}/__init__.py`
          : ctx.dirs.has(p)
            ? p
            : null
    if (rest === '') {
      const names = (imp.names ?? []).map((n) => at(join(base, n) ?? '')).filter((x) => x !== null)
      const own = at(base) ?? (base === '.' ? null : base)
      const out = names.length > 0 ? names : own === null ? [] : [own]
      return out.length === 0 ? ['unseen'] : out.map((to) => ({ to }))
    }
    const hit = at(base)
    return [hit === null ? 'unseen' : { to: hit }]
  }
  if (!ctx.pyTop.has(imp.spec.split('.')[0] ?? '')) return ['external']
  // from a.b import c는 a.b.c가 모듈이면 그것
  const names = (imp.names ?? []).filter((n) => ctx.pyModules.has(`${imp.spec}.${n}`))
  if (names.length > 0)
    return names.map((n) => ({ to: ctx.pyModules.get(`${imp.spec}.${n}`) ?? '' }))
  // import a.b와 from a.b의 a.b는 모듈이어야 한다(없으면 C 확장, 만든 파일 같은 것: 못 봄)
  const hit = ctx.pyModules.get(imp.spec)
  if (hit !== undefined) return [{ to: hit }]
  return ['unseen']
}

function resolveGo(ctx: ImportContext, spec: string): Resolved {
  for (const [mod, dir] of ctx.modules) {
    if (spec !== mod && !spec.startsWith(`${mod}/`)) continue
    const p = join(dir, spec.slice(mod.length))
    return p !== null && (ctx.dirs.has(p) || p === dir) ? { to: p } : 'unseen'
  }
  return 'external'
}

/** 소스 글들의 import 그래프. 자기 자신을 가리키는 것과 같은 (from, to)는 한 번만 */
export function importFacts(sources: ReadonlyMap<string, string>, ctx: ImportContext): ImportFacts {
  const edges: ImportEdge[] = []
  const unseen: ImportFacts['unseen'] = []
  let files = 0
  for (const [from, text] of [...sources].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (!importSource(from)) continue
    files++
    const seen = new Set<string>()
    const lang = langOf(from)
    for (const imp of rawImports(from, text)) {
      if (imp.dynamic === true) {
        unseen.push({ from, line: imp.line, spec: imp.spec })
        continue
      }
      const rs =
        lang === 'py'
          ? resolvePy(ctx, from, imp)
          : [lang === 'go' ? resolveGo(ctx, imp.spec) : resolveJs(ctx, from, imp.spec)]
      for (const r of rs) {
        if (r === 'external') continue
        if (r === 'unseen') {
          unseen.push({ from, line: imp.line, spec: imp.spec })
          continue
        }
        if (r.to === from || (lang === 'go' && r.to === dirOf(from)) || seen.has(r.to)) continue
        seen.add(r.to)
        edges.push({ from, to: r.to, line: imp.line, spec: imp.spec })
      }
    }
  }
  return { edges, unseen, files }
}

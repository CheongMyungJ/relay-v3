// diff에서 사람에게 보낼 신호를 찾는다 (docs/m1-modules.md signals.ts, devices.md 바닥 장치).
// 사람 경로, 지킴 파일, 시험 약화, 구조 변경. 결정론이고 놓치기보다 더 보내는 쪽을 고른다.

import { firstMatch, matchAny } from './glob.ts'
import { readManifests, type ManifestPair } from './manifests.ts'
import { DEFAULT_TEST_GLOBS, effectiveGuardPaths } from './quality.ts'
import type { DiffFacts, FileChange, QualityConfig, Signal, SignalKind } from './types.ts'

export type { ManifestPair } from './manifests.ts'

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
  const manifests = readManifests(input.manifests)
  const signals: Signal[] = [
    ...pathSignals(diff.files, quality.human_paths, 'human_path', '사람 경로를 건드림'),
    ...pathSignals(diff.files, effectiveGuardPaths(quality), 'guard_path', '지킴 파일을 건드림'),
    ...manifests.guard,
    ...testWeakening(diff.files, testGlobs),
    ...modules.map((dir) => structure(dir, `새 모듈: ${dir}`)),
    ...manifests.structure,
    ...publicNames(diff.files, quality.public_api),
  ]
  return { signals, new_dependencies: manifests.names, new_modules: modules }
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
  /\.(?:skip|only|todo)(?:\(|\.)/,
  /\.(?:skipIf|runIf|fails|failing|fixme)\(/,
  /\bx(?:it|describe|test)\(/,
  /\bf(?:it|describe)\(/,
  // node:test의 옵션 { skip: true }, { todo: '나중에' }
  /\b(?:skip|todo)\s*:\s*(?!false\b|null\b|undefined\b|0\b)[^\s,}]/,
  /@pytest\.mark\.(?:skip|xfail)/,
  /\bpytest\.(?:skip|xfail)\(/,
  /unittest\.(?:skip|expectedFailure)/,
  /\bskipTest\(/,
  /\bt\.Skip(?:f|Now)?\(/,
  /#\[ignore\]/,
  /@Disabled/,
  /@Ignore/,
]

const ASSERTION = /expect\(|assert|should\./
/** 시험을 정의하는 줄. 주석으로 끈 것을 찾는 데 쓴다 */
const TEST_DEFINITION = /\b(?:it|test|describe)(?:\.\w+)*\s*\(|^\s*(?:async\s+)?def test_|func Test/
// '#'은 Python 주석. Rust 속성(#[ignore])은 뺀다
const COMMENT = /^\s*(?:\/\/+|#+(?!\[)|\/\*+|\*+(?!\/)|<!--)\s?/

const isComment = (line: string): boolean => COMMENT.test(line)
const squash = (line: string): string => line.replace(/\s+/g, ' ').trim()

/** 주석 줄은 단언으로 세지 않는다. 주석으로 끈 단언이 단언 수를 채우지 못하게 */
function countAssertions(lines: string[]): number {
  return lines.filter((l) => !isComment(l) && ASSERTION.test(l)).length
}

/** 지운 시험 줄이 주석이 되어 다시 더해졌나. 찾으면 그 줄 */
function commentedOut(f: FileChange): string | undefined {
  const removed = new Set(f.removed_lines.map(squash))
  return f.added_lines.find((l) => {
    if (!isComment(l)) return false
    const code = squash(l.replace(COMMENT, '').replace(/\*\/\s*$/, ''))
    return removed.has(code) && (ASSERTION.test(code) || TEST_DEFINITION.test(code))
  })
}

/** 닫지 않은 블록 주석(`/*`)을 연 줄. 문서 주석(`/**`)은 뺀다 */
function blockCommentOpened(f: FileChange): string | undefined {
  return f.added_lines.find((l) => /^\s*\/\*(?!\*)/.test(l) && !l.includes('*/'))
}

/** 마지막 '.' 뒤. 'a.test.ts' → 'ts' */
function extension(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1)
}

function testWeakening(files: FileChange[], testGlobs: string[]): Signal[] {
  const out: Signal[] = []
  const weak = (path: string, detail: string) => out.push({ kind: 'test_weakening', path, detail })
  for (const f of files) {
    const isTest = matchAny(f.path, testGlobs)
    if (f.status === 'D') {
      if (isTest) weak(f.path, '시험 파일을 지움')
      continue
    }
    if (f.status === 'R' && f.old_path !== undefined && matchAny(f.old_path, testGlobs)) {
      // 시험 glob 밖으로 옮기거나 확장자를 바꾸면(a.test.ts.bak) 러너가 더는 줍지 않는다
      if (!isTest) {
        weak(f.old_path, `시험 파일을 시험 밖으로 옮김 (${f.path})`)
        continue
      }
      if (extension(f.old_path) !== extension(f.path)) {
        weak(f.old_path, `시험 파일의 확장자를 바꿈 (${f.path})`)
        continue
      }
    }
    if (!isTest) continue
    // 새 시험 파일(A, C)의 건너뛰기는 원래 있던 시험을 줄이지 않는다(V17). 지운 파일·옮긴 파일은 위에서 본다
    if (f.status === 'A' || f.status === 'C') continue
    // 옮긴 줄(같은 줄을 지우고 더함)은 새 표식이 아니다
    const moved = new Set(f.removed_lines.map(squash))
    const marker = f.added_lines.find((l) => {
      if (moved.has(squash(l)) || isComment(l)) return false
      const code = l.replace(/\s\/\/.*$/, '')
      return SKIP_MARKERS.some((r) => r.test(code))
    })
    if (marker !== undefined) weak(f.path, `건너뛰기·하나만 표식을 더함: ${clip(marker)}`)
    const commented = commentedOut(f)
    if (commented !== undefined) weak(f.path, `시험 줄을 주석으로 끔: ${clip(commented)}`)
    const block = blockCommentOpened(f)
    if (block !== undefined) weak(f.path, `시험 파일에 블록 주석을 염: ${clip(block)}`)
    const removed = countAssertions(f.removed_lines)
    const added = countAssertions(f.added_lines)
    if (removed > added) weak(f.path, `단언 줄이 줄어듦 (지움 ${removed}, 더함 ${added})`)
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

/**
 * 여러 줄 export 목록(`export {` … `}`)의 이름 한 줄. --unified=0이라 `export {` 줄은 diff에 없으므로
 * public_api 파일(JS)에서 식별자 하나뿐인 줄은 공개 이름으로 센다(놓치기보다 더 보내는 쪽)
 */
const JS_LIST_ITEM = /^\s*(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*,?\s*$/
/** 식별자 한 줄로 쓰여도 이름이 아닌 낱말 */
const JS_WORDS = new Set(
  'return break continue else default try finally do debugger this null true false undefined yield'.split(
    ' ',
  ),
)

function publicNamesOf(lines: string[], lang: Lang): string[] {
  const out: string[] = []
  for (const l of lines) {
    if (PUBLIC_LINE[lang].test(l)) out.push(...declaredNames(l, lang))
    else if (lang === 'js') {
      const item = JS_LIST_ITEM.exec(l)
      const name = item?.[2] ?? item?.[1]
      if (name !== undefined && !JS_WORDS.has(name)) out.push(name)
    }
  }
  return out
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

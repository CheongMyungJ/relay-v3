// 앱이 직접 재는 래칫(억누름, 중복, 바뀐 줄 커버리지)이 함께 쓰는 언어 표와 범위 (docs/quality-floor.md 2절, V58).
// 순수 함수다. src/core 상한 때문에 engine에 둔다.
import { matchAny } from '../core/glob.ts'

export type Lang = 'js' | 'py' | 'go' | 'java' | 'rs'

const EXT: Readonly<Record<string, Lang>> = {
  js: 'js',
  jsx: 'js',
  mjs: 'js',
  cjs: 'js',
  ts: 'js',
  tsx: 'js',
  mts: 'js',
  cts: 'js',
  py: 'py',
  pyi: 'py',
  go: 'go',
  java: 'java',
  kt: 'java',
  kts: 'java',
  rs: 'rs',
}

/** 표의 확장자(소스 파일). 초안의 file_lines 범위가 쓴다(V66) */
export const SOURCE_EXTENSIONS: readonly string[] = Object.keys(EXT)

/** 확장자로 가른 언어. 표에 없으면 null(세지 않는다) */
export function langOf(path: string): Lang | null {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? null : (EXT[name.slice(dot + 1).toLowerCase()] ?? null)
}

/** 언어마다 한 줄 주석의 시작과 글 따옴표(한 줄 안에서만 본다) */
export const SYNTAX: Readonly<Record<Lang, { comment: string; quotes: string }>> = {
  js: { comment: '//', quotes: `'"\`` },
  py: { comment: '#', quotes: `'"` },
  go: { comment: '//', quotes: `'"\`` },
  java: { comment: '//', quotes: `'"` },
  rs: { comment: '//', quotes: '"' },
}

const LOCKFILES = [
  ...['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock'],
  ...['poetry.lock', 'uv.lock', 'Cargo.lock', 'go.sum', 'Gemfile.lock'],
]

/** 늘 빼는 곳: 받아 온 코드, 만든 결과물, relay의 자리, 잠금 파일(표의 확장자가 아니어도 적어 둔다) */
export const SCAN_EXCLUDE: readonly string[] = [
  '**/node_modules/**',
  '**/vendor/**',
  '**/dist/**',
  '**/build/**',
  '**/target/**',
  '.relay/**',
  ...LOCKFILES.map((f) => `**/${f}`),
]

/** 셀 파일인가: 표에 있는 언어이고, 늘 빼는 곳과 exclude 밖이고, include가 있으면 그 안 */
export function inScan(
  path: string,
  spec: { include?: string[]; exclude?: string[] },
  more: readonly string[] = [],
): boolean {
  if (langOf(path) === null || matchAny(path, [...SCAN_EXCLUDE, ...more])) return false
  if (spec.exclude !== undefined && matchAny(path, spec.exclude)) return false
  return spec.include === undefined || spec.include.length === 0 || matchAny(path, spec.include)
}

/** 다섯 개까지 쓰고 나머지는 수만(core ratchet.ts와 같은 꼴) */
export function listText(items: string[], max = 5): string {
  const shown = items.slice(0, max).join(', ')
  return items.length > max ? `${shown} 외 ${items.length - max}개` : shown
}

/** 0.583 → '58.3%' */
export function percent(share: number): string {
  return `${(Math.round(share * 1000) / 10).toFixed(1)}%`
}

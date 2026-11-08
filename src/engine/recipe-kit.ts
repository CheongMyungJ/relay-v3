// 여러 언어 초안의 레시피가 함께 쓰는 모양과 도움 함수 (V60, V69~V71). recipes.ts(JS·Go·Rust와 단위 찾기), recipes-python.ts,
// recipes-jvm.ts가 가져간다. 순수 함수다.

import type { CommandSpec, RatchetSpec, SetupSpec } from '../core/types.ts'
import type { ImportFacts } from './imports.ts'

/** 레포의 파일 목록(레포 기준 경로)과 읽은 매니페스트·설정 글(경로 → 글) */
export interface RepoScan {
  files: string[]
  texts: ReadonlyMap<string, string>
  /** 작업 트리 소스의 import 그래프(구조 규칙 후보, V75). 없으면 경계 후보를 내지 않는다 */
  imports?: ImportFacts
}

export type UnitLang = 'js' | 'py' | 'go' | 'java' | 'rust'
export type CommandRatchet = Extract<RatchetSpec, { kind: 'command' }>
export interface Coverage {
  report: string
  format: 'lcov' | 'cobertura' | 'jacoco'
}

/** 언어 단위 하나. 경로와 명령은 단위 폴더(dir) 기준이다. 합칠 때 draft.ts가 `cd <dir> && `를 붙인다 */
export interface Unit {
  lang: UnitLang
  dir: string
  label: string
  setup?: SetupSpec
  fast: CommandSpec[]
  /** JUnit을 쓰는 시험 명령 */
  acceptance?: CommandSpec
  /** JUnit 없이 도는 시험 명령. 수용 시험이 없거나 이 단위가 주 단위가 아니면 빠른 검사로 들어간다 */
  test?: CommandSpec
  /** 수용 시험이 함께 쓰는 커버리지 보고서 */
  coverage?: Coverage
  ratchets: CommandRatchet[]
  suggestions: string[]
  /** 언어는 알아봤지만 돌릴 명령을 고르지 못함(V70: go.mod 없는 Go 등). 명령이 없어도 단위와 제안을 보인다 */
  bare?: boolean
}

export const JUNIT = '.relay-out/junit.xml'
/** go test -json의 출력(V65). 앱이 JUnit처럼 읽는다 */
export const GO_TEST_JSON = '.relay-out/go-test.json'
/** cargo test의 기본 출력(stdout, V71). 앱이 JUnit처럼 읽는다 */
export const CARGO_TEST_OUT = '.relay-out/cargo-test.txt'

export const LABEL: Readonly<Record<UnitLang, string>> = {
  js: 'JS/TS',
  py: 'Python',
  go: 'Go',
  java: 'Java',
  rust: 'Rust',
}

export const baseName = (p: string): string => p.slice(p.lastIndexOf('/') + 1)
export const dirName = (p: string): string =>
  p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '.'
export const depth = (dir: string): number => (dir === '.' ? 0 : dir.split('/').length)
export const at = (dir: string, name: string): string => (dir === '.' ? name : `${dir}/${name}`)

/** 단위 폴더 바로 아래의 파일 이름들 */
export function namesIn(files: readonly string[], dir: string): Set<string> {
  const out = new Set<string>()
  for (const f of files) if (dirName(f) === dir) out.add(baseName(f))
  return out
}

/** 단위 폴더 아래 파일(단위 기준 경로) */
export function filesUnder(files: readonly string[], dir: string): string[] {
  if (dir === '.') return [...files]
  const pre = `${dir}/`
  return files.filter((f) => f.startsWith(pre)).map((f) => f.slice(pre.length))
}

export const unit = (lang: UnitLang, dir: string, label: string): Unit => ({
  lang,
  dir,
  label,
  fast: [],
  ratchets: [],
  suggestions: [],
})

/** 주석(# 뒤)을 뺀 글. TOML·requirements의 의존성 이름을 찾을 때 */
const uncomment = (text: string): string => text.replace(/#.*$/gm, '')

/** 의존성 목록에 name이 있나(pyproject의 "ruff>=0.5", poetry의 ruff = "^0.5", requirements의 ruff==0.5) */
export function hasDep(text: string, name: string): boolean {
  const n = name.replace(/[-_.]/g, '[-_.]')
  return new RegExp(`(^|[\\s"'\\[,{])${n}\\s*([<>=!~;\\[,"'@]|$)`, 'im').test(uncomment(text))
}

// 여러 언어 초안의 레시피 (docs/quality-floor.md 5.2, V60). 레포의 파일 목록과 매니페스트·설정 글만 보고 언어 단위(폴더 하나에
// 매니페스트 하나)마다 설치, 빠른 검사, 수용 시험(JUnit), 커버리지 보고서, 명령 래칫을 고른다. 레포에 이미 있는 도구만 쓴다:
// 의존성(매니페스트)이나 설정 파일에 없는 도구는 명령에 넣지 않고 제안 글로만 낸다. 순수 함수다(src/core 상한 때문에 engine).
// JS는 core draftQuality(V19)를 그대로 쓴다(bun 잠금 파일만 여기서 더 본다).

import { matchAny } from '../core/glob.ts'
import { draftQuality } from '../core/quality.ts'
import type { CommandSpec, RatchetSpec, SetupSpec } from '../core/types.ts'
import { langOf, SCAN_EXCLUDE, type Lang } from './languages.ts'

/** 레포의 파일 목록(레포 기준 경로)과 읽은 매니페스트·설정 글(경로 → 글) */
export interface RepoScan {
  files: string[]
  texts: ReadonlyMap<string, string>
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
}

export const JUNIT = '.relay-out/junit.xml'

/** 매니페스트 이름 → 언어. requirements*.txt는 따로 본다 */
const MANIFEST: Readonly<Record<string, UnitLang>> = {
  'package.json': 'js',
  'pyproject.toml': 'py',
  'go.mod': 'go',
  'pom.xml': 'java',
  'build.gradle': 'java',
  'build.gradle.kts': 'java',
  'Cargo.toml': 'rust',
}
const REQUIREMENTS = /^requirements[^/]*\.txt$/
const ORDER: readonly UnitLang[] = ['js', 'py', 'go', 'java', 'rust']
/** 언어 단위를 찾는 깊이(폴더 둘까지)와 한 언어의 단위 수 상한 */
const MAX_DEPTH = 2
const MAX_UNITS_PER_LANG = 3

const baseName = (p: string): string => p.slice(p.lastIndexOf('/') + 1)
const dirName = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '.')
const depth = (dir: string): number => (dir === '.' ? 0 : dir.split('/').length)
const at = (dir: string, name: string): string => (dir === '.' ? name : `${dir}/${name}`)

/** 매니페스트 파일이면 그 언어. 받아 온 코드·만든 결과물 아래는 보지 않는다 */
export function manifestLang(path: string): UnitLang | null {
  const name = baseName(path)
  const lang = MANIFEST[name] ?? (REQUIREMENTS.test(name) ? 'py' : null)
  return lang === null || matchAny(path, [...SCAN_EXCLUDE]) ? null : lang
}

/**
 * 언어 단위 폴더. 언어마다 레포 루트에 매니페스트가 있으면 루트 하나(작업 공간·여러 모듈 빌드는 루트가 묶는다), 없으면 가장 얕은
 * 깊이(둘까지)의 폴더들. 셋을 넘으면 넣지 않고 제안에 남긴다(사람이 고른다)
 */
export function unitDirs(files: readonly string[]): {
  dirs: { lang: UnitLang; dir: string }[]
  skipped: string[]
} {
  const found = new Map<UnitLang, Set<string>>()
  for (const f of files) {
    const lang = manifestLang(f)
    const dir = dirName(f)
    if (lang === null || depth(dir) > MAX_DEPTH) continue
    const set = found.get(lang) ?? new Set<string>()
    set.add(dir)
    found.set(lang, set)
  }
  const dirs: { lang: UnitLang; dir: string }[] = []
  const skipped: string[] = []
  for (const lang of ORDER) {
    const all = [...(found.get(lang) ?? [])]
    if (all.length === 0) continue
    const min = Math.min(...all.map(depth))
    const shallow = all.filter((d) => depth(d) === min).sort()
    if (shallow.length > MAX_UNITS_PER_LANG) skipped.push(`${LABEL[lang]}: ${shallow.join(', ')}`)
    else for (const dir of shallow) dirs.push({ lang, dir })
  }
  return { dirs, skipped }
}

const LABEL: Readonly<Record<UnitLang, string>> = {
  js: 'JS/TS',
  py: 'Python',
  go: 'Go',
  java: 'Java',
  rust: 'Rust',
}

/** 단위 폴더 바로 아래의 파일 이름들 */
function namesIn(files: readonly string[], dir: string): Set<string> {
  const out = new Set<string>()
  for (const f of files) if (dirName(f) === dir) out.add(baseName(f))
  return out
}

/** 단위 폴더 아래 파일(단위 기준 경로) */
function filesUnder(files: readonly string[], dir: string): string[] {
  if (dir === '.') return [...files]
  const pre = `${dir}/`
  return files.filter((f) => f.startsWith(pre)).map((f) => f.slice(pre.length))
}

/** 단위 폴더 아래 그 언어의 소스 파일 수(주 단위를 고를 때) */
export function sourceCount(files: readonly string[], dir: string, lang: UnitLang): number {
  const want: Lang = lang === 'rust' ? 'rs' : lang
  return filesUnder(files, dir).filter((f) => langOf(f) === want && !matchAny(f, [...SCAN_EXCLUDE]))
    .length
}

/** 주석(# 뒤)을 뺀 글. TOML·requirements의 의존성 이름을 찾을 때 */
const uncomment = (text: string): string => text.replace(/#.*$/gm, '')

/** 의존성 목록에 name이 있나(pyproject의 "ruff>=0.5", poetry의 ruff = "^0.5", requirements의 ruff==0.5) */
export function hasDep(text: string, name: string): boolean {
  const n = name.replace(/[-_.]/g, '[-_.]')
  return new RegExp(`(^|[\\s"'\\[,{])${n}\\s*([<>=!~;\\[,"'@]|$)`, 'im').test(uncomment(text))
}

export function buildUnit(scan: RepoScan, lang: UnitLang, dir: string): Unit | null {
  if (lang === 'js') return jsUnit(scan, dir)
  if (lang === 'py') return pythonUnit(scan, dir)
  if (lang === 'go') return goUnit(scan, dir)
  if (lang === 'java') return jvmUnit(scan, dir)
  return rustUnit(scan, dir)
}

const unit = (lang: UnitLang, dir: string, label: string): Unit => ({
  lang,
  dir,
  label,
  fast: [],
  ratchets: [],
  suggestions: [],
})

// ── JS/TS: core draftQuality(V19) 그대로. bun 잠금 파일은 여기서 ─────────────

function jsUnit(scan: RepoScan, dir: string): Unit {
  const packageJson = scan.texts.get(at(dir, 'package.json'))
  const files = filesUnder(scan.files, dir)
  const q = draftQuality(packageJson === undefined ? { files } : { packageJson, files })
  const u = unit('js', dir, LABEL.js)
  const names = namesIn(scan.files, dir)
  const bun = q.setup === undefined && (names.has('bun.lock') || names.has('bun.lockb'))
  const pm = bun ? 'bun' : (/^(pnpm|yarn)\b/.exec(q.setup?.run ?? '')?.[1] ?? 'npm')
  const fix = (c: CommandSpec): CommandSpec =>
    bun ? { ...c, run: c.run.replace(/^npm run /, 'bun run ').replace(/^npx /, 'bunx ') } : c
  if (q.setup !== undefined) u.setup = q.setup
  else if (bun) {
    const lock = names.has('bun.lock') ? 'bun.lock' : 'bun.lockb'
    u.setup = { run: 'bun install --frozen-lockfile', inputs: [lock], keep: ['node_modules'] }
  }
  for (const c of q.commands.fast) {
    if (c.id === 'test') u.test = fix(c)
    else u.fast.push(fix(c))
  }
  const acc = q.commands.acceptance
  if (acc !== undefined) {
    u.acceptance = fix(acc)
    u.test = { id: 'test', run: `${pm} run test` }
    const pkg = packageJson ?? ''
    const provider = /"@vitest\/coverage-(?:v8|istanbul)"/.test(pkg)
    if (/\bvitest run\b/.test(acc.run) && provider) {
      // 레포에 커버리지 제공자가 있을 때만 켠다. 보고서는 lcov 하나
      const out = '.relay-out/coverage'
      u.acceptance.run = `${u.acceptance.run} --coverage.enabled --coverage.reporter=lcov --coverage.reportsDirectory=${out}`
      u.coverage = { report: `${out}/lcov.info`, format: 'lcov' }
    } else if (/\bvitest run\b/.test(acc.run))
      u.suggestions.push(
        '@vitest/coverage-v8을 dev 의존성에 더하면 바뀐 줄 커버리지 래칫을 쓸 수 있습니다',
      )
  }
  return u
}

// ── Python: uv, poetry, pip(venv) ──────────────────────────────────────────

function pythonUnit(scan: RepoScan, dir: string): Unit | null {
  const names = namesIn(scan.files, dir)
  const pyproject = scan.texts.get(at(dir, 'pyproject.toml')) ?? ''
  const reqs = [...names]
    .filter((n) => REQUIREMENTS.test(n))
    .sort((a, b) => (a === 'requirements.txt' ? -1 : b === 'requirements.txt' ? 1 : a < b ? -1 : 1))
  const poetry = names.has('poetry.lock') || /^\[tool\.poetry\]/m.test(pyproject)
  const pm = names.has('uv.lock') ? 'uv' : poetry ? 'poetry' : 'pip'
  const project = /^\[project\]/m.test(pyproject)
  // 도구 설정만 있는 pyproject(예: JS 레포의 [tool.ruff])는 Python 단위가 아니다
  if (pm === 'pip' && reqs.length === 0 && !project) return null
  const deps = [pyproject, ...reqs.map((r) => scan.texts.get(at(dir, r)) ?? '')].join('\n')
  const has = (name: string) => hasDep(deps, name)
  const u = unit('py', dir, `Python (${pm === 'pip' ? 'pip' : pm})`)
  const p = pm === 'uv' ? 'uv run ' : pm === 'poetry' ? 'poetry run ' : '.venv/bin/'
  if (pm === 'uv') {
    u.setup = { run: 'uv sync', inputs: ['pyproject.toml', 'uv.lock'], keep: ['.venv'] }
  } else if (pm === 'poetry') {
    const inputs = names.has('poetry.lock') ? ['pyproject.toml', 'poetry.lock'] : ['pyproject.toml']
    u.setup = { run: 'poetry install', inputs, keep: ['.venv'] }
  } else {
    const extra = /^\[project\.optional-dependencies\]([\s\S]*?)(?=^\[|$(?![\s\S]))/m.exec(
      pyproject,
    )
    const group = ['dev', 'test', 'tests'].find((g) =>
      new RegExp(`^${g}\\s*=`, 'm').test(extra?.[1] ?? ''),
    )
    const install =
      reqs.length > 0
        ? reqs.map((r) => `-r ${r}`).join(' ')
        : group === undefined
          ? '-e .'
          : `-e '.[${group}]'`
    u.setup = {
      run: `python3 -m venv .venv && .venv/bin/pip install ${install}`,
      inputs: reqs.length > 0 ? reqs : ['pyproject.toml'],
      keep: ['.venv'],
    }
  }
  if (has('ruff')) u.fast.push({ id: 'lint', run: `${p}ruff check .` })
  else if (has('flake8')) u.fast.push({ id: 'lint', run: `${p}flake8` })
  else u.suggestions.push('ruff를 dev 의존성에 더하면 빠른 검사(lint)를 쓸 수 있습니다')
  const src = scan.files.some((f) => f.startsWith(at(dir, 'src/')) && f.endsWith('.py'))
  if (has('mypy')) u.fast.push({ id: 'types', run: `${p}mypy ${src ? 'src' : '.'}` })
  else if (has('pyright')) u.fast.push({ id: 'types', run: `${p}pyright` })
  if (has('import-linter')) u.fast.push({ id: 'imports', run: `${p}lint-imports` })
  if (has('pytest')) {
    let run = `${p}pytest --junitxml=${JUNIT}`
    if (has('pytest-cov')) {
      run += ' --cov=. --cov-report=xml:.relay-out/coverage.xml'
      u.coverage = { report: '.relay-out/coverage.xml', format: 'cobertura' }
    } else
      u.suggestions.push('pytest-cov를 dev 의존성에 더하면 바뀐 줄 커버리지 래칫을 쓸 수 있습니다')
    u.acceptance = { id: 'test', run, junit: JUNIT }
    u.test = { id: 'test', run: `${p}pytest` }
  } else
    u.suggestions.push('pytest를 dev 의존성에 더하면 수용 시험과 시험 수 래칫을 쓸 수 있습니다')
  if (has('radon')) {
    const count = `awk '/ - [C-F] /{n++} END{print n+0}'`
    u.ratchets.push({
      id: 'complexity',
      kind: 'command',
      run: `${p}radon cc -n C -i .venv . | ${count}`,
      better: 'lower',
    })
  } else u.suggestions.push('radon을 dev 의존성에 더하면 복잡도 래칫을 쓸 수 있습니다')
  return u
}

// ── Go ─────────────────────────────────────────────────────────────────────

/** go.mod의 tool 지시문(Go 1.24)에 적힌 도구 경로 */
export function goTools(gomod: string): string[] {
  const out: string[] = []
  const text = gomod.replace(/\/\/.*$/gm, '')
  for (const m of text.matchAll(/^tool\s+\(([\s\S]*?)\)/gm))
    out.push(...(m[1] ?? '').split(/\s+/).filter((s) => s !== ''))
  for (const m of text.matchAll(/^tool\s+([^\s(]+)\s*$/gm)) out.push(m[1] ?? '')
  return out
}

function goUnit(scan: RepoScan, dir: string): Unit {
  const names = namesIn(scan.files, dir)
  const tools = goTools(scan.texts.get(at(dir, 'go.mod')) ?? '')
  const tool = (name: string) => tools.some((t) => t === name || t.endsWith(`/${name}`))
  const u = unit('go', dir, LABEL.go)
  u.setup = {
    run: 'go mod download',
    inputs: names.has('go.sum') ? ['go.mod', 'go.sum'] : ['go.mod'],
    keep: [],
  }
  u.fast.push({ id: 'vet', run: 'go vet ./...' })
  if (tool('golangci-lint')) u.fast.push({ id: 'lint', run: 'go tool golangci-lint run' })
  else if ([...names].some((n) => /^\.golangci\.(ya?ml|toml|json)$/.test(n)))
    u.fast.push({ id: 'lint', run: 'golangci-lint run' })
  u.test = { id: 'test', run: 'go test ./...' }
  if (tool('gotestsum'))
    u.acceptance = {
      id: 'test',
      run: `go tool gotestsum --junitfile ${JUNIT} -- ./...`,
      junit: JUNIT,
    }
  else
    u.suggestions.push(
      'gotestsum을 go.mod의 tool로 더하면(go get -tool gotest.tools/gotestsum) 수용 시험(JUnit)과 시험 수 래칫을 쓸 수 있습니다',
    )
  // go의 -coverprofile은 앱이 읽는 형식(lcov, Cobertura, JaCoCo)이 아니다
  if (!tool('govulncheck'))
    u.suggestions.push('govulncheck를 go.mod의 tool로 더하면 취약점 수 래칫을 쓸 수 있습니다')
  return u
}

// ── Java·Kotlin: Maven, Gradle ─────────────────────────────────────────────

/** 시험 결과 폴더(sub)의 TEST-*.xml을 하나의 JUnit 파일로 묶는 셸 조각(XML 선언 줄만 뺀다) */
export function mergeJUnit(sub: string): string {
  const find = `find . -path '*/${sub}/TEST-*.xml' -exec sed '/^<?xml/d' {} +`
  return `mkdir -p .relay-out && { echo '<testsuites>'; ${find}; echo '</testsuites>'; } > ${JUNIT}`
}

function jvmUnit(scan: RepoScan, dir: string): Unit {
  const names = namesIn(scan.files, dir)
  if (names.has('pom.xml')) return mavenUnit(scan, dir, names)
  const build =
    scan.texts.get(at(dir, 'build.gradle.kts')) ?? scan.texts.get(at(dir, 'build.gradle')) ?? ''
  const kotlin =
    /kotlin\(|org\.jetbrains\.kotlin/.test(build) ||
    filesUnder(scan.files, dir).some((f) => f.endsWith('.kt'))
  const u = unit('java', dir, `${kotlin ? 'Kotlin' : 'Java'} (Gradle)`)
  const gw = `${names.has('gradlew') ? './gradlew' : 'gradle'} --no-daemon`
  u.fast.push({ id: 'compile', run: `${gw} -q testClasses` })
  if (/ktlint/.test(build)) u.fast.push({ id: 'ktlint', run: `${gw} -q ktlintCheck` })
  if (/detekt/.test(build)) u.fast.push({ id: 'detekt', run: `${gw} -q detekt` })
  if (/\bcheckstyle\b/.test(build))
    u.fast.push({ id: 'checkstyle', run: `${gw} -q checkstyleMain` })
  const jacocoXml =
    /\bjacoco\b/.test(build) &&
    /xml\.(?:required|isEnabled|enabled)\s*(?:\.set\(\s*true\s*\)|=\s*true|\s+true)/.test(build)
  const tasks = jacocoXml ? 'test jacocoTestReport' : 'test'
  u.acceptance = {
    id: 'test',
    run: `${gw} ${tasks}; s=$?; ${mergeJUnit('build/test-results/test')}; exit $s`,
    junit: JUNIT,
  }
  u.test = { id: 'test', run: `${gw} test` }
  if (jacocoXml)
    u.coverage = { report: 'build/reports/jacoco/test/jacocoTestReport.xml', format: 'jacoco' }
  else
    u.suggestions.push(
      'jacoco 플러그인과 XML 보고서(xml.required)를 켜면 바뀐 줄 커버리지 래칫을 쓸 수 있습니다',
    )
  return u
}

function mavenUnit(scan: RepoScan, dir: string, names: Set<string>): Unit {
  const pom = scan.texts.get(at(dir, 'pom.xml')) ?? ''
  const u = unit('java', dir, 'Java (Maven)')
  const mvn = `${names.has('mvnw') ? './mvnw' : 'mvn'} -B`
  u.fast.push({ id: 'compile', run: `${mvn} -q -DskipTests test-compile` })
  if (/maven-checkstyle-plugin/.test(pom))
    u.fast.push({ id: 'checkstyle', run: `${mvn} -q checkstyle:check` })
  if (/spotless-maven-plugin/.test(pom))
    u.fast.push({ id: 'format', run: `${mvn} -q spotless:check` })
  // 여러 모듈이면 보고서가 모듈마다라 하나로 읽을 수 없다
  const jacoco = /jacoco-maven-plugin/.test(pom) && !/<modules>/.test(pom)
  u.acceptance = {
    id: 'test',
    run: `${mvn} test${jacoco ? ' jacoco:report' : ''}; s=$?; ${mergeJUnit('target/surefire-reports')}; exit $s`,
    junit: JUNIT,
  }
  u.test = { id: 'test', run: `${mvn} test` }
  if (jacoco) u.coverage = { report: 'target/site/jacoco/jacoco.xml', format: 'jacoco' }
  else
    u.suggestions.push(
      'jacoco-maven-plugin을 pom.xml에 더하면 바뀐 줄 커버리지 래칫을 쓸 수 있습니다',
    )
  return u
}

// ── Rust ───────────────────────────────────────────────────────────────────

/** .config/nextest.toml에서 JUnit을 쓰는 profile과 경로 */
export function nextestJUnit(text: string): { profile: string; path: string } | null {
  const m = /^\[profile\.([A-Za-z0-9_-]+)\.junit\]\s*$([\s\S]*?)(?=^\[|$(?![\s\S]))/m.exec(text)
  const path = m === null ? null : /^path\s*=\s*"([^"]+)"/m.exec(m[2] ?? '')
  return m === null || path === null ? null : { profile: m[1] ?? '', path: path[1] ?? '' }
}

function rustUnit(scan: RepoScan, dir: string): Unit {
  const names = namesIn(scan.files, dir)
  const cargo = scan.texts.get(at(dir, 'Cargo.toml')) ?? ''
  const u = unit('rust', dir, LABEL.rust)
  u.setup = {
    run: 'cargo fetch',
    inputs: names.has('Cargo.lock') ? ['Cargo.toml', 'Cargo.lock'] : ['Cargo.toml'],
    keep: ['target'],
  }
  const ci = [...scan.texts]
    .filter(([p]) => p.startsWith('.github/workflows/'))
    .some(([, t]) => /clippy/.test(t))
  // 레포가 clippy를 이미 엄격히 쓰는 표시가 있을 때만 경고를 실패로 본다
  const strict =
    names.has('clippy.toml') || names.has('.clippy.toml') || /^\[lints\.clippy\]/m.test(cargo) || ci
  u.fast.push(
    strict
      ? { id: 'clippy', run: 'cargo clippy --all-targets -- -D warnings' }
      : { id: 'check', run: 'cargo check --all-targets' },
  )
  if (names.has('rustfmt.toml') || names.has('.rustfmt.toml'))
    u.fast.push({ id: 'format', run: 'cargo fmt --check' })
  const nextest = nextestJUnit(scan.texts.get(at(dir, '.config/nextest.toml')) ?? '')
  if (nextest !== null) {
    const junit = `target/nextest/${nextest.profile}/${nextest.path}`
    u.acceptance = { id: 'test', run: `cargo nextest run --profile ${nextest.profile}`, junit }
  } else
    u.suggestions.push(
      'cargo-nextest의 JUnit 출력(.config/nextest.toml의 [profile.<이름>.junit])을 두면 수용 시험과 시험 수 래칫을 쓸 수 있습니다',
    )
  u.test = { id: 'test', run: 'cargo test' }
  u.suggestions.push(
    'cargo-llvm-cov로 lcov를 쓰는 시험 명령을 두면 바뀐 줄 커버리지 래칫을 쓸 수 있습니다',
  )
  return u
}

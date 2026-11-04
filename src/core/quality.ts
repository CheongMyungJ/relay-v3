// 품질 기준(.relay/quality.json): 파싱, 기본값, 해시, relay init 초안.
import { err, ok, type Result } from './result.ts'
import type {
  AutoCondition,
  CommandSpec,
  QualityConfig,
  RatchetSpec,
  SetupSpec,
} from './types.ts'

export const DEFAULT_GUARD_PATHS: string[] = [
  '.relay/quality.json',
  '.github/workflows/**',
  '.gitlab-ci.yml',
  '.circleci/**',
  '**/eslint.config.*',
  '**/.eslintrc*',
  '**/tsconfig*.json',
  '**/.prettierrc*',
  '**/vitest.config.*',
  '**/vite.config.*',
  '**/jest.config.*',
  '**/pytest.ini',
  '**/.coveragerc',
  'CODEOWNERS',
  '.github/CODEOWNERS',
  'docs/CODEOWNERS',
]

export const DEFAULT_TEST_GLOBS: string[] = [
  '**/*.test.*',
  '**/*.spec.*',
  '**/test_*.py',
  '**/*_test.py',
  '**/*_test.go',
  'test/**',
  'tests/**',
  '__tests__/**',
  'spec/**',
]

const DEFAULT_EXAMPLES_DIR = '.relay/examples'

// ── 모양 검사 도구 ───────────────────────────────────────────────────────────
// 읽기 함수는 잘못된 값이면 오류를 더하고 대신 값을 돌려준다. 오류가 하나라도 있으면 결과 전체를 버린다.

type Obj = Record<string, unknown>
type Read<T> = (v: unknown, path: string, errors: string[]) => T

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const sub = (path: string, key: string): string => (path === '' ? key : `${path}.${key}`)
const where = (path: string): string => (path === '' ? '최상위' : path)

function shape(v: unknown, path: string, e: string[], keys: readonly string[]): Obj | null {
  if (!isObj(v)) {
    e.push(`${where(path)}: 객체여야 함`)
    return null
  }
  for (const k of Object.keys(v)) if (!keys.includes(k)) e.push(`${sub(path, k)}: 알 수 없는 키`)
  return v
}

function req<T>(o: Obj, key: string, path: string, e: string[], read: Read<T>, fallback: T): T {
  if (!Object.hasOwn(o, key)) {
    e.push(`${sub(path, key)}: 필요함`)
    return fallback
  }
  return read(o[key], sub(path, key), e)
}

function opt<T>(o: Obj, key: string, path: string, e: string[], read: Read<T>): T | undefined {
  return Object.hasOwn(o, key) ? read(o[key], sub(path, key), e) : undefined
}

/** undefined인 칸을 빼서 선택 칸이 없는 것과 같게 만든다 */
function prune<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
}

const text: Read<string> = (v, p, e) => {
  if (typeof v !== 'string') e.push(`${p}: 문자열이어야 함`)
  else if (v.trim() === '') e.push(`${p}: 비어 있으면 안 됨`)
  else return v
  return ''
}

const ident: Read<string> = (v, p, e) => {
  const s = text(v, p, e)
  if (s !== '' && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(s))
    e.push(`${p}: 영문·숫자로 시작하고 영문·숫자·. _ -만 써야 함`)
  return s
}

const relPath: Read<string> = (v, p, e) => {
  const s = text(v, p, e)
  if (s !== '' && (/^(?:[A-Za-z]:)?[\\/]/.test(s) || s.split(/[\\/]/).includes('..')))
    e.push(`${p}: 레포 안의 상대 경로여야 함`)
  return s
}

const bool: Read<boolean> = (v, p, e) => {
  if (typeof v === 'boolean') return v
  e.push(`${p}: true나 false여야 함`)
  return false
}

const count: Read<number> = (v, p, e) => {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v
  e.push(`${p}: 0 이상의 정수여야 함`)
  return 0
}

const seconds: Read<number> = (v, p, e) => {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v
  e.push(`${p}: 0보다 큰 수여야 함`)
  return 1
}

function list<T>(read: Read<T>): Read<T[]> {
  return (v, p, e) => {
    if (!Array.isArray(v)) {
      e.push(`${p}: 배열이어야 함`)
      return []
    }
    return v.map((x, i) => read(x, `${p}[${i}]`, e))
  }
}

function oneOf<T extends string>(values: readonly T[]): Read<T> {
  return (v, p, e) => {
    if (typeof v === 'string' && (values as readonly string[]).includes(v)) return v as T
    e.push(`${p}: ${values.map((x) => `'${x}'`).join(', ')} 중 하나여야 함`)
    return values[0] as T
  }
}

const texts = list(text)
const paths = list(relPath)

// ── quality.json 읽기 ───────────────────────────────────────────────────────

const readCommand: Read<CommandSpec> = (v, p, e) => {
  const o = shape(v, p, e, ['id', 'run', 'timeout_sec', 'junit'])
  if (o === null) return { id: '', run: '' }
  return prune({
    id: req(o, 'id', p, e, ident, ''),
    run: req(o, 'run', p, e, text, ''),
    timeout_sec: opt(o, 'timeout_sec', p, e, seconds),
    junit: opt(o, 'junit', p, e, relPath),
  })
}

const readSetup: Read<SetupSpec> = (v, p, e) => {
  const o = shape(v, p, e, ['run', 'inputs', 'keep', 'timeout_sec'])
  if (o === null) return { run: '', inputs: [], keep: [] }
  return prune({
    run: req(o, 'run', p, e, text, ''),
    inputs: req(o, 'inputs', p, e, paths, []),
    keep: req(o, 'keep', p, e, paths, []),
    timeout_sec: opt(o, 'timeout_sec', p, e, seconds),
  })
}

const readCommands: Read<QualityConfig['commands']> = (v, p, e) => {
  const o = shape(v, p, e, ['fast', 'acceptance', 'full'])
  if (o === null) return { fast: [] }
  const acceptance = opt(o, 'acceptance', p, e, readCommand)
  // 수용 시험은 JUnit을 내야 줄 판정에 쓸 수 있다 (V11)
  if (acceptance !== undefined && acceptance.id !== '' && acceptance.junit === undefined)
    e.push(`${sub(p, 'acceptance')}.junit: 필요함`)
  return prune({
    fast: req(o, 'fast', p, e, list(readCommand), []),
    acceptance,
    full: opt(o, 'full', p, e, (fv, fp, fe) => {
      const f = shape(fv, fp, fe, ['ci_checks', 'local'])
      if (f === null) return {}
      return prune({
        ci_checks: opt(f, 'ci_checks', fp, fe, texts),
        local: opt(f, 'local', fp, fe, list(readCommand)),
      })
    }),
  })
}

const RATCHET_KINDS = ['file_lines', 'test_count', 'command'] as const

const readRatchet: Read<RatchetSpec> = (v, p, e) => {
  const fallback: RatchetSpec = { id: '', kind: 'test_count' }
  if (!isObj(v)) {
    e.push(`${where(p)}: 객체여야 함`)
    return fallback
  }
  const kind = v['kind']
  if (kind === 'file_lines') {
    const o = shape(v, p, e, ['id', 'kind', 'max', 'include', 'exclude']) ?? {}
    return prune({
      id: req(o, 'id', p, e, ident, ''),
      kind,
      max: req(o, 'max', p, e, count, 0),
      include: opt(o, 'include', p, e, texts),
      exclude: opt(o, 'exclude', p, e, texts),
    })
  }
  if (kind === 'test_count') {
    const o = shape(v, p, e, ['id', 'kind']) ?? {}
    return { id: req(o, 'id', p, e, ident, ''), kind }
  }
  if (kind === 'command') {
    const o = shape(v, p, e, ['id', 'kind', 'run', 'better', 'timeout_sec']) ?? {}
    return prune({
      id: req(o, 'id', p, e, ident, ''),
      kind,
      run: req(o, 'run', p, e, text, ''),
      better: req(o, 'better', p, e, oneOf(['lower', 'higher'] as const), 'lower'),
      timeout_sec: opt(o, 'timeout_sec', p, e, seconds),
    })
  }
  if (Object.hasOwn(v, 'kind')) oneOf(RATCHET_KINDS)(kind, sub(p, 'kind'), e)
  else e.push(`${sub(p, 'kind')}: 필요함`)
  return fallback
}

const AUTO_LIMITS = [
  'max_changed_lines',
  'paths',
  'no_new_dependencies',
  'no_new_modules',
  'require_all_lines_tested',
] as const

const readAuto: Read<AutoCondition> = (v, p, e) => {
  const o = shape(v, p, e, ['id', ...AUTO_LIMITS])
  if (o === null) return { id: '' }
  const c: AutoCondition = prune({
    id: req(o, 'id', p, e, ident, ''),
    max_changed_lines: opt(o, 'max_changed_lines', p, e, count),
    paths: opt(o, 'paths', p, e, texts),
    no_new_dependencies: opt(o, 'no_new_dependencies', p, e, bool),
    no_new_modules: opt(o, 'no_new_modules', p, e, bool),
    require_all_lines_tested: opt(o, 'require_all_lines_tested', p, e, bool),
  })
  // 제한이 없는 조건은 모든 변경을 자동으로 보낸다. 그런 조건은 받지 않는다
  const limited = AUTO_LIMITS.some((k) => c[k] !== undefined && c[k] !== false)
  if (!limited) e.push(`${where(p)}: 자동 조건에 제한이 하나도 없음`)
  return c
}

const TOP_KEYS = [
  'version',
  'setup',
  'commands',
  'human_paths',
  'guard_paths',
  'public_api',
  'test_globs',
  'examples_dir',
  'ratchets',
  'rules',
  'auto',
]

function noDuplicateIds(items: { id: string; path: string }[], e: string[]): void {
  const seen = new Set<string>()
  for (const { id, path } of items) {
    if (id === '') continue
    if (seen.has(id)) e.push(`${path}: id가 겹침 (${id})`)
    seen.add(id)
  }
}

export function parseQuality(text: string): Result<QualityConfig> {
  let raw: unknown
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch (cause) {
    return err(`JSON을 읽지 못함: ${(cause as Error).message}`)
  }
  const e: string[] = []
  const o = shape(raw, '', e, TOP_KEYS)
  if (o === null) return err(...e)

  if (!Object.hasOwn(o, 'version')) e.push('version: 필요함')
  else if (o['version'] !== 1) e.push('version: 1이어야 함')

  const q: QualityConfig = prune({
    version: 1 as const,
    setup: opt(o, 'setup', '', e, readSetup),
    commands: req(o, 'commands', '', e, readCommands, { fast: [] }),
    human_paths: opt(o, 'human_paths', '', e, texts) ?? [],
    guard_paths: opt(o, 'guard_paths', '', e, texts) ?? [],
    public_api: opt(o, 'public_api', '', e, texts) ?? [],
    test_globs: opt(o, 'test_globs', '', e, texts) ?? [...DEFAULT_TEST_GLOBS],
    examples_dir: opt(o, 'examples_dir', '', e, relPath) ?? DEFAULT_EXAMPLES_DIR,
    ratchets: opt(o, 'ratchets', '', e, list(readRatchet)) ?? [],
    rules: opt(o, 'rules', '', e, texts) ?? [],
    auto: opt(o, 'auto', '', e, list(readAuto)) ?? [],
  })

  const cmds = q.commands
  noDuplicateIds(
    [
      ...cmds.fast.map((c, i) => ({ id: c.id, path: `commands.fast[${i}].id` })),
      ...(cmds.acceptance ? [{ id: cmds.acceptance.id, path: 'commands.acceptance.id' }] : []),
      ...(cmds.full?.local ?? []).map((c, i) => ({ id: c.id, path: `commands.full.local[${i}].id` })),
    ],
    e,
  )
  noDuplicateIds(
    q.ratchets.map((r, i) => ({ id: r.id, path: `ratchets[${i}].id` })),
    e,
  )
  noDuplicateIds(
    q.auto.map((c, i) => ({ id: c.id, path: `auto[${i}].id` })),
    e,
  )
  return e.length > 0 ? err(...e) : ok(q)
}

export function effectiveGuardPaths(q: QualityConfig): string[] {
  return [...new Set([...DEFAULT_GUARD_PATHS, ...q.guard_paths])]
}

// ── 내용 해시: FNV-1a 64비트, UTF-8 바이트 위에서 ──────────────────────────────

const FNV_OFFSET = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n
const MASK64 = 0xffffffffffffffffn

export function qualityHash(text: string): string {
  let h = FNV_OFFSET
  const mix = (b: number): void => {
    h = ((h ^ BigInt(b)) * FNV_PRIME) & MASK64
  }
  for (const ch of text) {
    let cp = ch.codePointAt(0) ?? 0
    if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd // 짝 없는 대리 문자
    if (cp < 0x80) mix(cp)
    else if (cp < 0x800) {
      mix(0xc0 | (cp >> 6))
      mix(0x80 | (cp & 0x3f))
    } else if (cp < 0x10000) {
      mix(0xe0 | (cp >> 12))
      mix(0x80 | ((cp >> 6) & 0x3f))
      mix(0x80 | (cp & 0x3f))
    } else {
      mix(0xf0 | (cp >> 18))
      mix(0x80 | ((cp >> 12) & 0x3f))
      mix(0x80 | ((cp >> 6) & 0x3f))
      mix(0x80 | (cp & 0x3f))
    }
  }
  return h.toString(16).padStart(16, '0')
}

// ── relay init 초안 ─────────────────────────────────────────────────────────

type PackageManager = 'npm' | 'pnpm' | 'yarn'

// 여러 lockfile이 있고 packageManager로 가를 수 없으면 앞의 것을 쓴다
const LOCKFILES: { file: string; pm: PackageManager; install: string }[] = [
  { file: 'package-lock.json', pm: 'npm', install: 'npm ci' },
  { file: 'npm-shrinkwrap.json', pm: 'npm', install: 'npm ci' },
  { file: 'pnpm-lock.yaml', pm: 'pnpm', install: 'pnpm install --frozen-lockfile' },
  { file: 'yarn.lock', pm: 'yarn', install: 'yarn install --frozen-lockfile' },
]

const JUNIT_OUT = '.relay-out/junit.xml'

const ACCEPTANCE: Record<'vitest' | 'node', string> = {
  vitest: `npx vitest run --reporter=junit --outputFile=${JUNIT_OUT}`,
  node: `node --test --test-reporter=junit --test-reporter-destination=${JUNIT_OUT}`,
}

function readPackage(text: string | undefined): {
  scripts: Record<string, string>
  pm?: PackageManager
} {
  if (text === undefined) return { scripts: {} }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { scripts: {} }
  }
  if (!isObj(raw)) return { scripts: {} }
  const scripts: Record<string, string> = {}
  const s = raw['scripts']
  if (isObj(s)) for (const [k, v] of Object.entries(s)) if (typeof v === 'string') scripts[k] = v
  const named = typeof raw['packageManager'] === 'string' ? raw['packageManager'].split('@')[0] : ''
  const pm = LOCKFILES.find((l) => l.pm === named)?.pm
  return pm ? { scripts, pm } : { scripts }
}

/** 한 명령으로 러너를 바로 부르는 test 스크립트만 알아본다. 이어 붙인 명령은 모른다고 본다 */
function testRunner(script: string): 'vitest' | 'node' | null {
  if (/[;&|]/.test(script)) return null
  const words = script.trim().split(/\s+/)
  const is = (w: string, name: string): boolean => w === name || w.endsWith(`/${name}`)
  if (words.some((w) => is(w, 'vitest'))) return 'vitest'
  const node = words.findIndex((w) => is(w, 'node'))
  if (node !== -1 && words.indexOf('--test', node + 1) !== -1) return 'node'
  return null
}

export function draftQuality(input: { packageJson?: string; files: string[] }): QualityConfig {
  const files = new Set(input.files.map((f) => (f.startsWith('./') ? f.slice(2) : f)))
  const pkg = readPackage(input.packageJson)
  const locks = LOCKFILES.filter((l) => files.has(l.file))
  const lock = locks.find((l) => l.pm === pkg.pm) ?? locks[0]
  const pm = lock?.pm ?? pkg.pm ?? 'npm'

  const fast: CommandSpec[] = []
  for (const id of ['typecheck', 'lint']) {
    if (pkg.scripts[id] !== undefined) fast.push({ id, run: `${pm} run ${id}` })
  }
  let acceptance: CommandSpec | undefined
  const test = pkg.scripts['test']
  // npm init이 넣는 자리표시 스크립트는 늘 실패하므로 넣지 않는다
  if (test !== undefined && !/no test specified/i.test(test)) {
    const runner = testRunner(test)
    if (runner) acceptance = { id: 'test', run: ACCEPTANCE[runner], junit: JUNIT_OUT }
    else fast.push({ id: 'test', run: `${pm} run test` })
  }

  const hasCi = [...files].some((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f))
  // lockfile은 커도 사람이 쓴 코드가 아니므로 줄 수 래칫에서 뺀다
  const lockGlobs = LOCKFILES.map((l) => l.file)
    .filter((name) => [...files].some((f) => f === name || f.endsWith(`/${name}`)))
    .map((name) => `**/${name}`)

  const ratchets: RatchetSpec[] = []
  if (acceptance) ratchets.push({ id: 'tests', kind: 'test_count' })
  ratchets.push(
    lockGlobs.length > 0
      ? { id: 'file-size', kind: 'file_lines', max: 600, exclude: lockGlobs }
      : { id: 'file-size', kind: 'file_lines', max: 600 },
  )

  return prune({
    version: 1 as const,
    setup: lock ? { run: lock.install, inputs: [lock.file], keep: ['node_modules'] } : undefined,
    // CI가 있으면 어떤 검사를 기다릴지는 사람이 ci_checks에 채운다
    commands: prune({ fast, acceptance, full: hasCi ? { ci_checks: [] } : undefined }),
    human_paths: [],
    guard_paths: [],
    public_api: [],
    test_globs: [...DEFAULT_TEST_GLOBS],
    examples_dir: DEFAULT_EXAMPLES_DIR,
    ratchets,
    rules: [],
    auto: [],
  })
}

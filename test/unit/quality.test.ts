import { describe, expect, test } from 'vitest'
import { matchAny } from '../../src/core/glob.ts'
import {
  DEFAULT_GUARD_PATHS,
  DEFAULT_TEST_GLOBS,
  effectiveGuardPaths,
  hasRealLimit,
  parseQuality,
  qualityHash,
} from '../../src/core/quality.ts'
import type { QualityConfig } from '../../src/core/types.ts'

function valueOf(text: string): QualityConfig {
  const r = parseQuality(text)
  if (!r.ok) throw new Error(`통과를 기대함: ${r.errors.join(' / ')}`)
  return r.value
}

function errorsOf(text: string): string[] {
  const r = parseQuality(text)
  if (r.ok) throw new Error('오류를 기대했지만 통과함')
  return r.errors
}

const minimal = { version: 1, commands: { fast: [] } }
const doc = (extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ ...minimal, ...extra })
// 선택 칸의 기본값 (ratchets 빼고)
const defaults = {
  ...{ human_paths: [], guard_paths: [], public_api: [], test_globs: DEFAULT_TEST_GLOBS },
  ...{ examples_dir: '.relay/examples', rules: [], auto: [] },
}

// docs/design.md 2절의 예시
const designExample = {
  version: 1,
  setup: { run: 'npm ci', inputs: ['package-lock.json'], keep: ['node_modules'] },
  commands: {
    fast: [
      { id: 'typecheck', run: 'npm run typecheck' },
      { id: 'lint', run: 'npm run lint' },
    ],
    acceptance: {
      id: 'test',
      run: 'node --test --test-reporter=junit --test-reporter-destination=.relay-out/junit.xml',
      junit: '.relay-out/junit.xml',
    },
    full: { ci_checks: ['ci'] },
  },
  human_paths: ['migrations/**', 'src/auth/**'],
  guard_paths: [],
  public_api: ['src/index.ts'],
  test_globs: ['**/*.test.*', '**/*.spec.*', 'test/**', 'tests/**'],
  examples_dir: '.relay/examples',
  ratchets: [
    { id: 'tests', kind: 'test_count' },
    { id: 'file-size', kind: 'file_lines', max: 600 },
  ],
  rules: [],
  auto: [
    {
      id: 'small',
      max_changed_lines: 50,
      no_new_dependencies: true,
      no_new_modules: true,
      require_all_lines_tested: true,
    },
  ],
}

describe('parseQuality: 정상', () => {
  test('설계 문서의 예시를 그대로 읽는다', () => {
    expect(valueOf(JSON.stringify(designExample))).toEqual(designExample)
  })

  test('빠진 선택 칸에 기본값을 채운다', () => {
    expect(valueOf(doc())).toEqual({
      version: 1,
      commands: { fast: [] },
      ...defaults,
      ratchets: [],
    })
  })

  test('없는 선택 칸은 undefined 키로도 남기지 않는다', () => {
    const q = valueOf(doc({ commands: { fast: [{ id: 'lint', run: 'npm run lint' }] } }))
    expect(Object.keys(q)).not.toContain('setup')
    expect(Object.keys(q.commands)).toEqual(['fast'])
    expect(Object.keys(q.commands.fast[0] ?? {})).toEqual(['id', 'run'])
  })

  test('사용자가 준 test_globs는 기본값을 대신하고, 기본값은 사본이다', () => {
    const before = [...DEFAULT_TEST_GLOBS]
    valueOf(doc()).test_globs.push('x/**')
    expect(DEFAULT_TEST_GLOBS).toEqual(before)
    expect(valueOf(doc({ test_globs: ['spec/**'] })).test_globs).toEqual(['spec/**'])
    expect(valueOf(doc({ test_globs: [] })).test_globs).toEqual([])
  })

  test('세 래칫 종류와 선택 칸을 읽는다', () => {
    const ratchets = [
      { id: 'size', kind: 'file_lines', max: 400, include: ['src/**'], exclude: ['**/*.gen.ts'] },
      { id: 'tests', kind: 'test_count' },
      { id: 'cov', kind: 'command', run: 'node cov.js', better: 'higher', timeout_sec: 30 },
    ]
    expect(valueOf(doc({ ratchets })).ratchets).toEqual(ratchets)
  })

  test('앱이 재는 래칫 셋(V55~V57)과 선택 칸을 읽는다', () => {
    const ratchets = [
      { id: 'sup', kind: 'suppressions' },
      { id: 'dup', kind: 'duplication', include: ['src/**'], exclude: ['src/gen/**'] },
      { id: 'cov', kind: 'diff_coverage', report: 'coverage/lcov.info', format: 'lcov', min: 0.8 },
      { id: 'cob', kind: 'diff_coverage', report: 'c.xml', format: 'cobertura', min: 1 },
      { id: 'jac', kind: 'diff_coverage', report: 'j.xml', format: 'jacoco', min: 0.5 },
    ]
    const accept = { id: 'test', run: 'npm test', junit: 'junit.xml' }
    const q = valueOf(doc({ commands: { fast: [], acceptance: accept }, ratchets }))
    expect(q.ratchets).toEqual(ratchets)
  })

  test('full.local 명령과 setup.timeout_sec을 읽는다', () => {
    const setup = { run: 'npm ci', inputs: [], keep: [], timeout_sec: 600 }
    const full = { local: [{ id: 'e2e', run: 'npm run e2e', timeout_sec: 1.5 }] }
    const q = valueOf(doc({ setup, commands: { fast: [], full } }))
    expect(q.setup).toEqual(setup)
    expect(q.commands.full).toEqual(full)
  })

  test('크기나 범위 제한이 하나라도 있는 자동 조건은 받는다', () => {
    const auto = [
      { id: 'zero', max_changed_lines: 0 },
      { id: 'docs', paths: ['docs/**'] },
      { id: 'none', paths: [] },
      { id: 'deps', max_changed_lines: 10, no_new_dependencies: true, no_new_modules: false },
    ]
    expect(valueOf(doc({ auto })).auto).toEqual(auto)
  })

  test('같은 id라도 명령과 래칫과 조건 사이에서는 겹쳐도 된다', () => {
    const q = valueOf(
      doc({
        commands: { fast: [{ id: 'x', run: 'a' }] },
        ratchets: [{ id: 'x', kind: 'test_count' }],
        auto: [{ id: 'x', max_changed_lines: 1 }],
      }),
    )
    expect(q.ratchets[0]?.id).toBe('x')
  })

  test('파일 앞의 BOM을 무시한다', () => {
    expect(valueOf('\uFEFF' + doc()).version).toBe(1)
  })
})

describe('parseQuality: 잘못된 입력', () => {
  /** 최소 문서에 extra를 덮어쓴 것이 정확히 이 오류들을 내는지 */
  const fails = (extra: Record<string, unknown>, ...expected: string[]): void => {
    expect(errorsOf(doc(extra))).toEqual(expected)
  }
  const fast = (...cmds: unknown[]) => ({ commands: { fast: cmds } })
  const acceptance = (a: unknown) => ({ commands: { fast: [], acceptance: a } })

  test('JSON이 아니면 오류', () => {
    expect(errorsOf('{ version: 1 ')[0]).toMatch(/^JSON을 읽지 못함: /)
  })

  test.each(['[]', 'null', '"x"', '3'])('최상위가 객체가 아니면 오류 (%s)', (text) => {
    expect(errorsOf(text)).toEqual(['최상위: 객체여야 함'])
  })

  test('알 수 없는 키는 키 경로와 함께 오류', () => {
    const commands = {
      fast: [{ id: 'a', run: 'a', cmd: 'x' }],
      full: { ci_checks: [], other: [] },
      slow: [],
    }
    fails(
      {
        extra: true,
        setup: { run: 'npm ci', inputs: [], keep: [], cache: 1 },
        commands,
        ratchets: [{ id: 't', kind: 'test_count', max: 3 }],
        auto: [{ id: 's', max_changed_lines: 1, max_files: 3 }],
      },
      'extra: 알 수 없는 키',
      'setup.cache: 알 수 없는 키',
      'commands.slow: 알 수 없는 키',
      'commands.fast[0].cmd: 알 수 없는 키',
      'commands.full.other: 알 수 없는 키',
      'ratchets[0].max: 알 수 없는 키',
      'auto[0].max_files: 알 수 없는 키',
    )
  })

  test('version이 없거나 1이 아니면 오류', () => {
    expect(errorsOf(JSON.stringify({ commands: { fast: [] } }))).toEqual(['version: 필요함'])
    fails({ version: 2 }, 'version: 1이어야 함')
    fails({ version: '1' }, 'version: 1이어야 함')
  })

  test('commands와 commands.fast는 꼭 있어야 한다', () => {
    expect(errorsOf(JSON.stringify({ version: 1 }))).toEqual(['commands: 필요함'])
    fails({ commands: {} }, 'commands.fast: 필요함')
    fails({ commands: [] }, 'commands: 객체여야 함')
  })

  test('명령의 id와 run을 검사한다', () => {
    fails(
      fast({ id: 'type check', run: 'x' }, { id: '', run: '  ' }, { run: 'x' }, { id: 'ok' }),
      'commands.fast[0].id: 영문·숫자로 시작하고 영문·숫자·. _ -만 써야 함',
      'commands.fast[1].id: 비어 있으면 안 됨',
      'commands.fast[1].run: 비어 있으면 안 됨',
      'commands.fast[2].id: 필요함',
      'commands.fast[3].run: 필요함',
    )
  })

  test.each([0, -1, '10', null, 86_401, 1e9])(
    'timeout_sec이 0보다 크고 하루 이하인 수가 아니면 오류 (%s)',
    (t) => {
      fails(
        fast({ id: 'a', run: 'a', timeout_sec: t }),
        'commands.fast[0].timeout_sec: 0보다 크고 86400 이하인 수여야 함',
      )
    },
  )

  test('timeout_sec은 하루까지 받는다', () => {
    const q = valueOf(doc(fast({ id: 'a', run: 'a', timeout_sec: 86_400 })))
    expect(q.commands.fast[0]?.timeout_sec).toBe(86_400)
  })

  test('명령 글에 NUL 글자가 있으면 오류', () => {
    fails(fast({ id: 'a', run: 'echo a\u0000b' }), 'commands.fast[0].run: NUL 글자를 쓸 수 없음')
  })

  test.each([
    ['human_paths', '/src/auth/**', '레포 루트 기준이라 /로 시작하지 않는다'],
    ['guard_paths', 'src\\auth\\**', '경로 구분은 /를 쓴다'],
    ['test_globs', 'C:/repo/test/**', '레포 안의 상대 경로여야 함'],
    ['public_api', '/index.ts', '레포 루트 기준이라 /로 시작하지 않는다'],
  ])('%s에 맞는 파일이 없는 glob(%s)은 오류', (key, glob, why) => {
    fails({ [key]: [glob] }, `${key}[0]: ${why} (${glob})`)
  })

  test('자동 조건 paths와 래칫 include·exclude의 glob도 검사한다', () => {
    fails(
      {
        auto: [{ id: 'a', paths: ['/docs/**'] }],
        ratchets: [{ id: 'f', kind: 'file_lines', max: 1, include: ['\\x'], exclude: ['/y'] }],
      },
      'ratchets[0].include[0]: 경로 구분은 /를 쓴다 (\\x)',
      'ratchets[0].exclude[0]: 레포 루트 기준이라 /로 시작하지 않는다 (/y)',
      'auto[0].paths[0]: 레포 루트 기준이라 /로 시작하지 않는다 (/docs/**)',
    )
  })

  test('폴더처럼 쓴 사람 경로는 받는다(그 아래에 맞는다)', () => {
    const q = valueOf(doc({ human_paths: ['src/auth/', 'migrations'] }))
    expect(q.human_paths).toEqual(['src/auth/', 'migrations'])
    expect(matchAny('src/auth/login.ts', q.human_paths)).toBe(true)
    expect(matchAny('migrations/001.sql', q.human_paths)).toBe(true)
  })

  test('acceptance에 junit이 없으면 오류', () => {
    fails(acceptance({ id: 't', run: 'x' }), 'commands.acceptance.junit: 필요함')
  })

  test('시험 결과의 꼴(test_format, V65·V69): junit | go-test-json | cargo-test, junit 칸과 함께만', () => {
    const go = { id: 't', run: 'go test -json ./... > o.json', junit: 'o.json' }
    expect(
      valueOf(doc(acceptance({ ...go, test_format: 'go-test-json' }))).commands.acceptance,
    ).toEqual({ ...go, test_format: 'go-test-json' })
    const cargo = { id: 't', run: 'cargo test > o.txt', junit: 'o.txt', test_format: 'cargo-test' }
    expect(valueOf(doc(acceptance(cargo))).commands.acceptance).toEqual(cargo)
    // 칸이 없는 옛 명령은 읽은 값에도 칸이 없다
    expect(valueOf(doc(acceptance(go))).commands.acceptance).toEqual(go)
    fails(
      acceptance({ ...go, test_format: 'tap' }),
      "commands.acceptance.test_format: 'junit', 'go-test-json', 'cargo-test' 중 하나여야 함",
    )
    fails(
      { commands: { fast: [{ id: 'a', run: 'x', test_format: 'junit' }] } },
      'commands.fast[0].test_format: junit이 있어야 함',
    )
  })

  test.each(['/tmp/j.xml', '../j.xml', 'out/../../j.xml', 'C:\\j.xml', '\\\\srv\\j.xml'])(
    'junit 경로가 레포 밖이면 오류 (%s)',
    (junit) => {
      const msg = 'commands.acceptance.junit: 레포 안의 상대 경로여야 함'
      fails(acceptance({ id: 't', run: 'x', junit }), msg)
    },
  )

  test('setup의 필수 칸과 경로를 검사한다', () => {
    fails({ setup: { run: 'npm ci' } }, 'setup.inputs: 필요함', 'setup.keep: 필요함')
    fails(
      { setup: { run: 'npm ci', inputs: ['/etc/x'], keep: ['..'] } },
      'setup.inputs[0]: 레포 안의 상대 경로여야 함',
      'setup.keep[0]: 레포 안의 상대 경로여야 함',
    )
    fails({ setup: null }, 'setup: 객체여야 함')
  })

  test('glob 목록은 빈 문자열이 아닌 문자열의 배열이어야 한다', () => {
    fails({ human_paths: 'src/**' }, 'human_paths: 배열이어야 함')
    fails({ guard_paths: ['a', ''] }, 'guard_paths[1]: 비어 있으면 안 됨')
    fails({ public_api: [1] }, 'public_api[0]: 문자열이어야 함')
    fails({ rules: [null] }, 'rules[0]: 문자열이어야 함')
  })

  test('examples_dir가 레포 밖이면 오류', () => {
    fails({ examples_dir: '/abs' }, 'examples_dir: 레포 안의 상대 경로여야 함')
  })

  test('래칫의 종류별 칸을 검사한다', () => {
    const ratchets = [
      { id: 'a', kind: 'file_lines', max: -1 },
      { id: 'b', kind: 'file_lines', max: 1.5 },
      { id: 'c', kind: 'file_lines' },
      { id: 'd', kind: 'command', run: 'x', better: 'up' },
      { id: 'e', kind: 'speed' },
      { id: 'f' },
      'g',
    ]
    fails(
      { ratchets },
      'ratchets[0].max: 0 이상의 정수여야 함',
      'ratchets[1].max: 0 이상의 정수여야 함',
      'ratchets[2].max: 필요함',
      "ratchets[3].better: 'lower', 'higher' 중 하나여야 함",
      "ratchets[4].kind: 'file_lines', 'test_count', 'command', 'suppressions', 'duplication', 'diff_coverage' 중 하나여야 함",
      'ratchets[5].kind: 필요함',
      'ratchets[6]: 객체여야 함',
    )
  })

  test('앱이 재는 래칫 셋(V55~V57)의 칸을 검사한다', () => {
    const ratchets = [
      { id: 's', kind: 'suppressions', max: 3 },
      { id: 'd', kind: 'duplication', include: 'src/**', exclude: ['/abs'] },
      { id: 'c1', kind: 'diff_coverage', format: 'xml', min: 0 },
      { id: 'c2', kind: 'diff_coverage', report: '../out/lcov.info', format: 'lcov', min: 1.5 },
      { id: 'c3', kind: 'diff_coverage', report: 'lcov.info', format: 'lcov', min: '0.8' },
    ]
    fails(
      { ...acceptance({ id: 't', run: 'x', junit: 'j.xml' }), ratchets },
      'ratchets[0].max: 알 수 없는 키',
      'ratchets[1].include: 배열이어야 함',
      'ratchets[1].exclude[0]: 레포 루트 기준이라 /로 시작하지 않는다 (/abs)',
      'ratchets[2].report: 필요함',
      "ratchets[2].format: 'lcov', 'cobertura', 'jacoco' 중 하나여야 함",
      'ratchets[2].min: 0보다 크고 1 이하인 수여야 함',
      'ratchets[3].report: 레포 안의 상대 경로여야 함',
      'ratchets[3].min: 0보다 크고 1 이하인 수여야 함',
      'ratchets[4].min: 0보다 크고 1 이하인 수여야 함',
    )
  })

  test('바뀐 줄 커버리지는 수용 시험이 있어야 한다(보고서를 쓰는 명령)', () => {
    fails(
      {
        ratchets: [
          { id: 'cov', kind: 'diff_coverage', report: 'l.info', format: 'lcov', min: 0.8 },
        ],
      },
      'ratchets[0]: diff_coverage는 commands.acceptance가 쓴 보고서를 읽음: acceptance가 필요함',
    )
  })

  test('크기·범위 제한이 없는 자동 조건은 오류', () => {
    const msg = 'auto[0]: 자동 조건에 max_changed_lines나 paths 제한이 없음'
    fails({ auto: [{ id: 'all' }] }, msg)
    fails({ auto: [{ id: 'off', no_new_modules: false, no_new_dependencies: false }] }, msg)
    // 부울 제한은 관문 2단계가 이미 거르므로 그것만으로는 아무것도 막지 못한다
    fails({ auto: [{ id: 'any', require_all_lines_tested: true }] }, msg)
    fails({ auto: [{ id: 'any', no_new_modules: true, no_new_dependencies: true }] }, msg)
  })

  test('hasRealLimit은 max_changed_lines나 paths가 있을 때만 참', () => {
    expect(hasRealLimit({ id: 'a', max_changed_lines: 0 })).toBe(true)
    expect(hasRealLimit({ id: 'a', paths: [] })).toBe(true)
    expect(hasRealLimit({ id: 'a', require_all_lines_tested: true, no_new_modules: true })).toBe(
      false,
    )
  })

  test('자동 조건의 칸 타입을 검사한다', () => {
    fails(
      { auto: [{ id: 's', max_changed_lines: '50', no_new_modules: 'yes' }] },
      'auto[0].max_changed_lines: 0 이상의 정수여야 함',
      'auto[0].no_new_modules: true나 false여야 함',
    )
  })

  test('명령 id가 fast·acceptance·full.local 사이에서 겹치면 오류', () => {
    const lint = (run: string) => ({ id: 'lint', run })
    fails(
      {
        commands: {
          fast: [lint('a'), lint('b')],
          acceptance: { ...lint('c'), junit: 'j.xml' },
          full: { local: [lint('d')] },
        },
      },
      'commands.fast[1].id: id가 겹침 (lint)',
      'commands.acceptance.id: id가 겹침 (lint)',
      'commands.full.local[0].id: id가 겹침 (lint)',
    )
  })

  test('래칫 id와 조건 id가 각각 안에서 겹치면 오류', () => {
    const ratchets = [
      { id: 't', kind: 'test_count' },
      { id: 't', kind: 'file_lines', max: 1 },
    ]
    const auto = [
      { id: 's', max_changed_lines: 1 },
      { id: 's', paths: ['a/**'] },
    ]
    fails({ ratchets, auto }, 'ratchets[1].id: id가 겹침 (t)', 'auto[1].id: id가 겹침 (s)')
  })

  test('오류를 처음 하나에서 멈추지 않고 모두 모은다', () => {
    fails(
      { version: 3, commands: { fast: 'x' }, human_paths: [''], foo: 1 },
      'foo: 알 수 없는 키',
      'version: 1이어야 함',
      'commands.fast: 배열이어야 함',
      'human_paths[0]: 비어 있으면 안 됨',
    )
  })
})

describe('기본 목록', () => {
  const cases = (paths: string[], hit: boolean) =>
    paths
      .join(' ')
      .split(' ')
      .map((p) => [p, hit] as const)

  test.each([
    ...cases(
      [
        '.relay/quality.json .github/workflows/ci.yml .gitlab-ci.yml .circleci/config.yml',
        'eslint.config.mjs packages/web/.eslintrc.cjs tsconfig.json packages/a/tsconfig.build.json',
        '.prettierrc.json vitest.config.ts apps/x/vite.config.js jest.config.js pytest.ini',
        '.coveragerc CODEOWNERS .github/CODEOWNERS docs/CODEOWNERS',
        'vitest.workspace.ts vitest.unit.config.ts jest.setup.js .mocharc.yml',
        'playwright.config.ts tests/conftest.py tox.ini setup.cfg .gitattributes',
      ],
      true,
    ),
    ...cases(['src/index.ts .relay/debt/a.md docs/design.md src/CODEOWNERS package.json'], false),
  ])('지킴 파일 기본 목록과 %s: %s', (path, hit) => {
    expect(matchAny(path, DEFAULT_GUARD_PATHS)).toBe(hit)
  })

  test.each([
    ...cases(
      [
        'src/a.test.ts src/a.spec.js pkg/test_x.py pkg/x_test.py cmd/x_test.go',
        'test/fixtures/data.json tests/a.py __tests__/a.js spec/a.rb src/test/a.ts',
        'src/test/java/com/x/FooTest.java app/src/test/kotlin/FooTest.kt FooTests.java',
      ],
      true,
    ),
    ...cases(['src/testing.ts src/latest.ts contest.py src/main/java/Foo.java'], false),
  ])('시험 기본 목록과 %s: %s', (path, hit) => {
    expect(matchAny(path, DEFAULT_TEST_GLOBS)).toBe(hit)
  })
})

describe('effectiveGuardPaths', () => {
  test('기본 목록 뒤에 사용자 목록을 더한다', () => {
    const q = valueOf(doc({ guard_paths: ['Makefile', 'scripts/ci/**'] }))
    expect(effectiveGuardPaths(q)).toEqual([...DEFAULT_GUARD_PATHS, 'Makefile', 'scripts/ci/**'])
  })

  test('겹치는 항목은 한 번만 넣는다', () => {
    const q = valueOf(doc({ guard_paths: ['CODEOWNERS', 'x', 'x'] }))
    expect(effectiveGuardPaths(q)).toEqual([...DEFAULT_GUARD_PATHS, 'x'])
  })

  test('사용자 목록이 비어도 기본 목록은 남는다', () => {
    expect(effectiveGuardPaths(valueOf(doc()))).toEqual(DEFAULT_GUARD_PATHS)
  })

  test('결과를 고쳐도 기본 목록은 바뀌지 않는다', () => {
    const before = [...DEFAULT_GUARD_PATHS]
    effectiveGuardPaths(valueOf(doc())).push('x')
    expect(DEFAULT_GUARD_PATHS).toEqual(before)
  })
})

describe('qualityHash', () => {
  test('FNV-1a 64비트의 알려진 값과 같다', () => {
    expect(qualityHash('')).toBe('cbf29ce484222325')
    expect(qualityHash('a')).toBe('af63dc4c8601ec8c')
    expect(qualityHash('foobar')).toBe('85944171f73967e8')
  })

  test('늘 16자리 소문자 16진수', () => {
    for (const s of ['', 'x', '{}', '한글', '🙂'.repeat(50)]) {
      expect(qualityHash(s)).toMatch(/^[0-9a-f]{16}$/)
    }
  })

  test('같은 내용은 같은 해시, 한 글자만 달라도 다른 해시', () => {
    expect(qualityHash(doc())).toBe(qualityHash(doc()))
    expect(qualityHash('{"a":1}')).not.toBe(qualityHash('{"a":2}'))
    expect(qualityHash('a')).not.toBe(qualityHash('a\n'))
  })

  test('UTF-8 바이트 위에서 잰다 (한글, 이모지, 짝 없는 대리 문자)', () => {
    const reference = (text: string): string => {
      let h = 0xcbf29ce484222325n
      for (const b of new TextEncoder().encode(text)) {
        h = ((h ^ BigInt(b)) * 0x100000001b3n) & 0xffffffffffffffffn
      }
      return h.toString(16).padStart(16, '0')
    }
    for (const s of ['품질 기준', 'é', '€', '🙂 ok', 'a\uD800b', '\uDC00', '\u07FF\u0800\uFFFF']) {
      expect(qualityHash(s)).toBe(reference(s))
    }
  })
})

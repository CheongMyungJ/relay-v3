import { describe, expect, test } from 'vitest'
import { DEFAULT_TEST_GLOBS } from '../../src/core/quality.ts'
import { detectSignals, type ManifestPair } from '../../src/core/signals.ts'
import type { FileChange, QualityConfig, Signal } from '../../src/core/types.ts'

function quality(over: Partial<QualityConfig> = {}): QualityConfig {
  return {
    version: 1,
    commands: { fast: [] },
    human_paths: [],
    guard_paths: [],
    public_api: [],
    test_globs: DEFAULT_TEST_GLOBS,
    examples_dir: '.relay/examples',
    ratchets: [],
    rules: [],
    auto: [],
    ...over,
  }
}

function change(path: string, over: Partial<FileChange> = {}): FileChange {
  return {
    path,
    status: 'M',
    added: over.added_lines?.length ?? 0,
    deleted: over.removed_lines?.length ?? 0,
    binary: false,
    added_lines: [],
    removed_lines: [],
    ...over,
  }
}

interface Input {
  files?: FileChange[]
  quality?: QualityConfig
  baseDirs?: string[]
  manifests?: ManifestPair[]
}

function detect(input: Input) {
  return detectSignals({
    diff: { base: 'b', head: 'h', files: input.files ?? [] },
    quality: input.quality ?? quality(),
    baseDirs: new Set(input.baseDirs ?? ['src', 'src/core', 'test', 'docs']),
    manifests: input.manifests ?? [],
  })
}

function only(kind: Signal['kind'], input: Input): Signal[] {
  return detect(input).signals.filter((s) => s.kind === kind)
}

function weak(...files: FileChange[]): Signal[] {
  return only('test_weakening', { files })
}

describe('사람 경로', () => {
  const q = quality({ human_paths: ['migrations/**', 'src/auth/**'] })
  const human = (...files: FileChange[]) => only('human_path', { quality: q, files })

  test('human_paths에 맞는 바뀐 파일마다 신호를 낸다', () => {
    const signals = human(change('migrations/001.sql', { status: 'A' }), change('src/app.ts'))
    const detail = '사람 경로를 건드림 (migrations/**)'
    expect(signals).toEqual([{ kind: 'human_path', path: 'migrations/001.sql', detail }])
  })

  test('이름 바뀜은 옛 경로만 맞아도 신호를 낸다', () => {
    const signals = human(change('src/login.ts', { status: 'R', old_path: 'src/auth/login.ts' }))
    expect(signals).toEqual([
      { kind: 'human_path', path: 'src/auth/login.ts', detail: '사람 경로를 건드림 (src/auth/**)' },
    ])
  })

  test('옛 경로와 새 경로가 모두 맞아도 파일마다 하나다', () => {
    const signals = human(change('src/auth/b.ts', { status: 'R', old_path: 'src/auth/a.ts' }))
    expect(signals.map((s) => s.path)).toEqual(['src/auth/b.ts'])
  })

  test('지운 파일도 사람 경로면 신호를 낸다', () => {
    expect(human(change('migrations/001.sql', { status: 'D' }))).toHaveLength(1)
  })

  test('human_paths가 비면 신호가 없다', () => {
    expect(only('human_path', { files: [change('migrations/001.sql')] })).toEqual([])
  })
})

describe('지킴 파일', () => {
  const defaults = [
    '.relay/quality.json .github/workflows/ci.yml .gitlab-ci.yml .circleci/config.yml',
    'eslint.config.mjs packages/a/.eslintrc.json tsconfig.json packages/a/tsconfig.build.json',
    '.prettierrc.json vitest.config.ts web/vite.config.ts jest.config.js pytest.ini .coveragerc',
    'CODEOWNERS .github/CODEOWNERS docs/CODEOWNERS',
  ]
  test.each(defaults.join(' ').split(' '))('기본 목록의 %s를 바꾸면 신호를 낸다', (path) => {
    const signals = only('guard_path', { files: [change(path)] })
    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({ kind: 'guard_path', path })
    expect(signals[0]?.detail).toMatch(/^지킴 파일을 건드림 \(.+\)$/)
  })

  test('사용자 guard_paths를 기본 목록에 더한다', () => {
    const q = quality({ guard_paths: ['Makefile'] })
    const signals = only('guard_path', {
      quality: q,
      files: [change('Makefile'), change('tsconfig.json')],
    })
    expect(signals.map((s) => s.path)).toEqual(['Makefile', 'tsconfig.json'])
  })

  test('지킴 파일을 다른 이름으로 옮겨도 옛 경로로 신호를 낸다', () => {
    const signals = only('guard_path', {
      files: [change('old-ci.yml', { status: 'R', old_path: '.github/workflows/ci.yml' })],
    })
    expect(signals.map((s) => s.path)).toEqual(['.github/workflows/ci.yml'])
  })

  test('보통 소스 파일은 신호가 없다', () => {
    expect(only('guard_path', { files: [change('src/core/x.ts'), change('README.md')] })).toEqual(
      [],
    )
  })
})

describe('시험 약화: 시험 파일 지움', () => {
  test('시험 파일을 지우면 신호를 낸다', () => {
    expect(weak(change('src/a.test.ts', { status: 'D' }))).toEqual([
      { kind: 'test_weakening', path: 'src/a.test.ts', detail: '시험 파일을 지움' },
    ])
  })

  test('시험 파일을 지울 때는 단언 감소를 따로 세지 않는다', () => {
    const f = change('test/a.test.ts', { status: 'D', removed_lines: ['expect(1).toBe(1)'] })
    expect(weak(f)).toHaveLength(1)
  })

  test('시험 아닌 파일을 지우면 신호가 없다', () => {
    expect(weak(change('src/a.ts', { status: 'D' }))).toEqual([])
  })

  test('시험 파일을 시험 glob 밖으로 옮기면 지운 것으로 본다', () => {
    const f = change('src/a.ts', { status: 'R', old_path: 'src/a.test.ts' })
    const detail = '시험 파일을 시험 밖으로 옮김 (src/a.ts)'
    expect(weak(f)).toEqual([{ kind: 'test_weakening', path: 'src/a.test.ts', detail }])
  })

  test('시험 glob 안에서 이름만 바꾸면 신호가 없다', () => {
    const f = change('test/b.test.ts', { status: 'R', old_path: 'test/a.test.ts' })
    expect(weak(f)).toEqual([])
  })

  test.each(['src/a.test.ts.bak', 'src/a.test.ts.disabled', 'src/a.test.txt'])(
    '확장자를 바꿔 러너가 줍지 않게 하면 glob 안이어도 신호다 (%s)',
    (path) => {
      const f = change(path, { status: 'R', old_path: 'src/a.test.ts' })
      expect(weak(f)).toEqual([
        {
          kind: 'test_weakening',
          path: 'src/a.test.ts',
          detail: `시험 파일의 확장자를 바꿈 (${path})`,
        },
      ])
    },
  )

  test('test_globs를 따로 정하면 그것만 시험 파일로 본다', () => {
    const q = quality({ test_globs: ['checks/**'] })
    const signals = only('test_weakening', {
      quality: q,
      files: [change('checks/x.ts', { status: 'D' }), change('src/a.test.ts', { status: 'D' })],
    })
    expect(signals.map((s) => s.path)).toEqual(['checks/x.ts'])
  })

  test('test_globs가 비면 기본 시험 glob을 쓴다', () => {
    const q = quality({ test_globs: [] })
    const files = [change('pkg/foo_test.go', { status: 'D' })]
    expect(only('test_weakening', { quality: q, files })).toHaveLength(1)
  })
})

describe('시험 약화: 건너뛰기·하나만 표식', () => {
  test.each([
    "it.skip('a', () => {",
    "describe.only('b', () => {",
    "  xit('c', () => {",
    "xdescribe('d', () => {",
    "xtest('e', () => {",
    "fit('f', () => {",
    "fdescribe('g', () => {",
    "  it.todo('h')",
    '@pytest.mark.skip(reason="later")',
    '@pytest.mark.xfail',
    '@unittest.skip("later")',
    '\tt.Skip("flaky")',
    '#[ignore]',
    '  @Disabled',
    '  @Ignore',
    "it.skipIf(true)('x', () => {",
    "describe.skipIf(!hasNewApi)('d', () => {",
    "it.runIf(process.env.X)('y', () => {",
    "it.fails('예전 동작', () => {",
    "test.failing('z', () => {",
    "it.skip.each([1, 2])('n=%s', () => {",
    "it.only.each([1])('n', () => {",
    "test('c', { skip: true }, () => {",
    "it('c', { todo: '나중에' }, () => {",
    "test('c', { skip: typeof mod.newFn !== 'function' }, () => {",
    '    pytest.skip("later")',
    '    pytest.xfail("bug")',
    '        self.skipTest("later")',
    '@unittest.expectedFailure',
    '\tt.Skipf("flaky %d", n)',
    '\tt.SkipNow()',
    "test.fixme('x', async () => {",
  ])('더한 줄의 %s는 신호다', (line) => {
    const signals = weak(change('test/x.test.ts', { added_lines: [line] }))
    expect(signals).toHaveLength(1)
    expect(signals[0]?.detail).toBe(`건너뛰기·하나만 표식을 더함: ${line.trim()}`)
  })

  const lookalikes = [
    "exit('x')",
    'profit(1)',
    'arr.skipWhile(x)',
    "it('skip this', () => {",
    "test('c', { skip: false }, () => {",
    '  // todo: 이름 고치기',
    '  # todo: later',
    'run() // todo: 나중에',
    "  // it.skip('a')",
  ]
  test.each(lookalikes)('표식과 비슷한 %s는 신호가 아니다', (line) => {
    expect(weak(change('test/x.test.ts', { added_lines: [line] }))).toEqual([])
  })

  test('시험 아닌 파일의 표식은 신호가 아니다', () => {
    expect(weak(change('src/x.ts', { added_lines: ['it.skip('] }))).toEqual([])
  })

  test('표식을 지우기만 하면 신호가 아니다', () => {
    const f = change('test/x.test.ts', {
      removed_lines: ["it.skip('a', () => {"],
      added_lines: ["it('a', () => {"],
    })
    expect(weak(f)).toEqual([])
  })

  test('옮긴 줄(같은 줄을 지우고 더함)의 표식은 새 표식이 아니다', () => {
    const f = change('test/x.test.ts', {
      removed_lines: ["  it.skip('a', () => {"],
      added_lines: ["it.skip('a', () => {"],
    })
    expect(weak(f)).toEqual([])
  })

  test('새 시험 파일의 표식도 신호다', () => {
    const f = change('test/new.test.ts', { status: 'A', added_lines: ["it.only('a', () => {"] })
    expect(weak(f)).toHaveLength(1)
  })

  test('표식이 여러 줄이어도 파일마다 첫 줄만 적는다', () => {
    const f = change('test/x.test.ts', { added_lines: ["it.skip('a')", "it.only('b')"] })
    expect(weak(f).map((s) => s.detail)).toEqual(["건너뛰기·하나만 표식을 더함: it.skip('a')"])
  })

  test('긴 줄은 줄여서 적는다', () => {
    const line = `it.skip('${'x'.repeat(100)}')`
    const f = change('test/x.test.ts', { added_lines: [line] })
    const detail = weak(f)[0]?.detail ?? ''
    expect(detail.endsWith('…')).toBe(true)
    expect(detail.length).toBeLessThan(90)
  })
})

describe('시험 약화: 단언 줄 감소', () => {
  test('지운 단언 줄이 더한 것보다 많으면 신호를 낸다', () => {
    const f = change('test/x.test.ts', {
      removed_lines: ['  expect(a).toBe(1)', '  assert.equal(b, 2)', '  x.should.equal(3)'],
      added_lines: ['  expect(a).toBe(1)'],
    })
    const detail = '단언 줄이 줄어듦 (지움 3, 더함 1)'
    expect(weak(f)).toEqual([{ kind: 'test_weakening', path: 'test/x.test.ts', detail }])
  })

  test('같은 수로 바꾸면 신호가 없다', () => {
    const f = change('t/x.test.ts', { removed_lines: ['expect(a)'], added_lines: ['expect(b)'] })
    expect(weak(f)).toEqual([])
  })

  test('단언이 늘면 신호가 없다', () => {
    const f = change('test/x.test.ts', { added_lines: ['assert x == 1'] })
    expect(weak(f)).toEqual([])
  })

  test('시험 아닌 파일의 단언 감소는 신호가 아니다', () => {
    const f = change('src/x.ts', { removed_lines: ['assert(ok)'] })
    expect(weak(f)).toEqual([])
  })

  test('표식과 단언 감소가 한 파일에 있으면 둘 다 낸다', () => {
    const f = change('test/x.test.ts', {
      removed_lines: ["it('a', () => {", '  expect(1).toBe(1)'],
      added_lines: ["it.skip('a', () => {"],
    })
    expect(weak(f).map((s) => s.detail)).toEqual([
      "건너뛰기·하나만 표식을 더함: it.skip('a', () => {",
      '단언 줄이 줄어듦 (지움 1, 더함 0)',
    ])
  })
})

describe('시험 약화: 주석으로 끔', () => {
  test('시험 하나를 //로 끄면 단언 수가 같아 보여도 신호다', () => {
    const f = change('test/a.test.js', {
      removed_lines: ["test('더하기', () => {", '  assert.equal(add(2, 3), 5)', '})'],
      added_lines: [
        "// test('더하기', () => {",
        '//   assert.equal(add(2, 3), 5)',
        '// })',
        "test('빼기 [w:C1.1]', () => {",
        '  assert.equal(sub(5, 3), 2)',
        '})',
      ],
    })
    expect(weak(f).map((s) => s.detail)).toEqual([
      "시험 줄을 주석으로 끔: // test('더하기', () => {",
    ])
  })

  test('주석 줄의 단언은 단언으로 세지 않는다', () => {
    const f = change('test/a.test.js', {
      removed_lines: ['  expect(a).toBe(1)'],
      added_lines: ['  // expect(a).toBe(2)'],
    })
    expect(weak(f).map((s) => s.detail)).toEqual(['단언 줄이 줄어듦 (지움 1, 더함 0)'])
  })

  test('Python #과 블록 주석 줄(*)도 주석으로 본다', () => {
    const py = change('tests/test_a.py', {
      removed_lines: ['    assert add(2, 3) == 5'],
      added_lines: ['    # assert add(2, 3) == 5'],
    })
    expect(weak(py).map((s) => s.detail)).toEqual([
      '시험 줄을 주석으로 끔: # assert add(2, 3) == 5',
      '단언 줄이 줄어듦 (지움 1, 더함 0)',
    ])
  })

  test('닫지 않은 블록 주석을 열면 신호다', () => {
    const f = change('test/a.test.ts', { added_lines: ['/*', "it('x', () => {"] })
    expect(weak(f).map((s) => s.detail)).toEqual(['시험 파일에 블록 주석을 염: /*'])
  })

  test.each(['/**', ' * 설명', ' */', '/* 한 줄 주석 */', '// 설명'])(
    '문서 주석·한 줄 주석은 신호가 아니다 (%s)',
    (line) => {
      expect(weak(change('test/a.test.ts', { added_lines: [line] }))).toEqual([])
    },
  )

  test('시험·단언이 아닌 줄을 주석으로 끄는 것은 신호가 아니다', () => {
    const f = change('test/a.test.ts', {
      removed_lines: ["console.log('x')"],
      added_lines: ["// console.log('x')"],
    })
    expect(weak(f)).toEqual([])
  })
})

describe('구조 변경: 새 모듈', () => {
  test('base에 없는 디렉터리에 파일을 더하면 새 모듈이다', () => {
    const r = detect({ files: [change('src/feature/a.ts', { status: 'A' })] })
    expect(r.new_modules).toEqual(['src/feature'])
    expect(r.signals).toEqual([
      { kind: 'structure_change', path: 'src/feature', detail: '새 모듈: src/feature' },
    ])
  })

  test('가장 위의 새 디렉터리 하나로 센다', () => {
    const r = detect({
      files: [
        change('src/feature/a/x.ts', { status: 'A' }),
        change('src/feature/b/y.ts', { status: 'A' }),
        change('lib/deep/z.ts', { status: 'A' }),
      ],
    })
    expect(r.new_modules).toEqual(['src/feature', 'lib'])
  })

  test('있던 디렉터리나 루트에 더하면 새 모듈이 아니다', () => {
    const r = detect({
      files: [change('src/core/x.ts', { status: 'A' }), change('N.md', { status: 'A' })],
    })
    expect(r.new_modules).toEqual([])
  })

  test('이름 바뀜·복사로 새 디렉터리에 생겨도 새 모듈이다', () => {
    const r = detect({
      files: [
        change('src/moved/a.ts', { status: 'R', old_path: 'src/a.ts' }),
        change('pkg/b.ts', { status: 'C', old_path: 'src/b.ts' }),
      ],
    })
    expect(r.new_modules).toEqual(['src/moved', 'pkg'])
  })

  test('바꾸거나 지운 파일은 새 모듈로 세지 않는다', () => {
    const r = detect({ files: [change('gen/a.ts'), change('old/b.ts', { status: 'D' })] })
    expect(r.new_modules).toEqual([])
  })

  test('시험 파일, 예시 자료, .relay 아래는 새 모듈로 세지 않는다', () => {
    const r = detect({
      files: [
        change('test/new/a.test.ts', { status: 'A' }),
        change('newpkg/b.spec.ts', { status: 'A' }),
        change('.relay/examples/c1.json', { status: 'A' }),
        change('.relay/debt/x.md', { status: 'A' }),
      ],
    })
    expect(r.new_modules).toEqual([])
  })

  test('examples_dir의 ./ 앞머리와 끝 /를 무시한다', () => {
    const q = quality({ examples_dir: './fixtures/examples/' })
    const r = detect({ quality: q, files: [change('fixtures/examples/c1.json', { status: 'A' })] })
    expect(r.new_modules).toEqual([])
  })

  test('baseDirs가 비면 디렉터리 속 새 파일은 모두 새 모듈이다', () => {
    const r = detect({ baseDirs: [], files: [change('src/a.ts', { status: 'A' })] })
    expect(r.new_modules).toEqual(['src'])
  })
})

describe('구조 변경: 새 공개 이름', () => {
  const q = quality({ public_api: ['src/index.ts', 'lib.rs', 'pkg/__init__.py'] })
  function names(file: FileChange): Signal[] {
    return only('structure_change', { quality: q, files: [file] })
  }

  test('공개 API 파일에 새 export를 더하면 신호를 낸다', () => {
    const f = change('src/index.ts', {
      added_lines: [
        'export function run() {}',
        'export const enabled = true',
        '  export type Options = {}',
        'export { a, b as c } from "./x.ts"',
        'export default class {}',
        "export * from './y.ts'",
        'const internal = 1',
      ],
    })
    expect(names(f)).toEqual([
      {
        kind: 'structure_change',
        path: 'src/index.ts',
        detail: '새 공개 이름: run, enabled, Options, a, c 외 2개',
      },
    ])
  })

  test('여러 줄 export 목록에 이름 한 줄을 더해도 새 공개 이름이다', () => {
    const f = change('src/index.ts', { added_lines: ['  newThing,', '  type Opts,', '  a as b'] })
    expect(names(f).map((s) => s.detail)).toEqual(['새 공개 이름: newThing, Opts, b'])
  })

  test('식별자 한 줄이라도 키워드는 이름으로 세지 않는다', () => {
    const f = change('src/index.ts', { added_lines: ['    return', '  else', '  default,'] })
    expect(names(f)).toEqual([])
  })

  test('목록 안에서 줄만 옮긴 이름은 새 이름이 아니다', () => {
    const f = change('src/index.ts', { removed_lines: ['  a,'], added_lines: ['  a,'] })
    expect(names(f)).toEqual([])
  })

  test('같은 이름의 모양만 바꾸면 새 공개 이름이 아니다', () => {
    const f = change('src/index.ts', {
      removed_lines: ['export function run(a: string) {}'],
      added_lines: ['export async function run(a: string, b?: number) {}'],
    })
    expect(names(f)).toEqual([])
  })

  test('공개 API가 아닌 파일의 export는 신호가 아니다', () => {
    expect(names(change('src/other.ts', { added_lines: ['export const x = 1'] }))).toEqual([])
  })

  test('공개 API 파일을 지우면 새 이름으로 세지 않는다', () => {
    const f = change('src/index.ts', { status: 'D', added_lines: ['export const x = 1'] })
    expect(names(f)).toEqual([])
  })

  test('Rust는 줄 머리의 pub만 공개로 본다', () => {
    const f = change('lib.rs', {
      added_lines: ['pub fn open() {}', 'pub(crate) fn hidden() {}', '    pub fn method() {}'],
    })
    expect(names(f).map((s) => s.detail)).toEqual(['새 공개 이름: open'])
  })

  test('Python은 최상위 def·class 중 _로 시작하지 않는 것만 공개로 본다', () => {
    const f = change('pkg/__init__.py', {
      added_lines: ['def load():', 'class Store:', 'def _private():', '    def method(self):'],
    })
    expect(names(f).map((s) => s.detail)).toEqual(['새 공개 이름: load, Store'])
  })

  test('public_api가 비면 신호가 없다', () => {
    const r = detect({ files: [change('src/index.ts', { added_lines: ['export const x = 1'] })] })
    expect(r.signals).toEqual([])
  })
})

describe('detectSignals 전체', () => {
  test('바뀐 것이 없으면 아무것도 없다', () => {
    expect(detect({})).toEqual({ signals: [], new_dependencies: [], new_modules: [] })
  })

  test('신호는 사람 경로, 지킴 파일, 시험 약화, 구조 변경 순이다', () => {
    const q = quality({ human_paths: ['src/auth/**'], public_api: ['src/index.ts'] })
    const r = detect({
      quality: q,
      files: [
        change('src/index.ts', { added_lines: ['export const x = 1'] }),
        change('src/new/a.ts', { status: 'A' }),
        change('test/a.test.ts', { status: 'D' }),
        change('tsconfig.json'),
        change('src/auth/a.ts'),
      ],
      manifests: [
        { path: 'package.json', base: '{}', head: JSON.stringify({ dependencies: { a: '1' } }) },
      ],
    })
    const order = 'human_path guard_path test_weakening structure_change structure_change'
    expect(r.signals.map((s) => s.kind)).toEqual(`${order} structure_change`.split(' '))
    expect(r.signals.slice(3).map((s) => s.detail)).toEqual([
      '새 모듈: src/new',
      '새 의존성: a',
      '새 공개 이름: x',
    ])
  })
})

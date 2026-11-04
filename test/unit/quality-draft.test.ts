// relay init 초안(draftQuality)과 test 스크립트에서 수용 시험 명령 만들기(acceptanceRun).
import { describe, expect, test } from 'vitest'
import {
  acceptanceRun,
  DEFAULT_TEST_GLOBS,
  DRAFT_AUTO,
  draftQuality,
  parseQuality,
} from '../../src/core/quality.ts'
import type { QualityConfig } from '../../src/core/types.ts'

function valueOf(text: string): QualityConfig {
  const r = parseQuality(text)
  if (!r.ok) throw new Error(`통과를 기대함: ${r.errors.join(' / ')}`)
  return r.value
}

// 초안의 자동 조건(V19)
const SMALL = {
  id: 'small',
  max_changed_lines: 100,
  no_new_dependencies: true,
  no_new_modules: true,
  require_all_lines_tested: true,
}

// 선택 칸의 기본값 (ratchets 빼고)
const defaults = {
  ...{ human_paths: [], guard_paths: [], public_api: [], test_globs: DEFAULT_TEST_GLOBS },
  ...{ examples_dir: '.relay/examples', rules: [], auto: [SMALL] },
}

describe('draftQuality', () => {
  type Fields = Record<string, unknown>
  const pkg = (scripts: Fields, extra: Fields = {}): string =>
    JSON.stringify({ name: 'x', scripts, ...extra })
  const draft = (scripts: Fields, extra: Fields = {}, files: string[] = []) =>
    draftQuality({ packageJson: pkg(scripts, extra), files })

  test('npm, vitest, CI가 있는 레포의 초안', () => {
    const q = draftQuality({
      packageJson: pkg({ typecheck: 'tsc', lint: 'eslint .', test: 'vitest run', build: 'x' }),
      files: ['package.json', 'package-lock.json', 'src/a.ts', '.github/workflows/ci.yml'],
    })
    expect(q).toEqual({
      version: 1,
      setup: { run: 'npm ci', inputs: ['package-lock.json'], keep: ['node_modules'] },
      commands: {
        fast: [
          { id: 'typecheck', run: 'npm run typecheck' },
          { id: 'lint', run: 'npm run lint' },
        ],
        acceptance: {
          id: 'test',
          run: 'npx vitest run --reporter=junit --outputFile=.relay-out/junit.xml',
          junit: '.relay-out/junit.xml',
        },
        full: { ci_checks: [] },
      },
      ...defaults,
      ratchets: [
        { id: 'tests', kind: 'test_count' },
        { id: 'file-size', kind: 'file_lines', max: 600, exclude: ['**/package-lock.json'] },
      ],
    })
  })

  test('package.json도 파일도 없으면 줄 수 래칫만 있는 빈 초안', () => {
    expect(draftQuality({ files: [] })).toEqual({
      version: 1,
      commands: { fast: [] },
      ...defaults,
      ratchets: [{ id: 'file-size', kind: 'file_lines', max: 600 }],
    })
  })

  const NODE_JUNIT = '--test-reporter=junit --test-reporter-destination=.relay-out/junit.xml'
  const VITEST_JUNIT = '--reporter=junit --outputFile=.relay-out/junit.xml'

  test.each([
    ['node --test', `node --test ${NODE_JUNIT}`],
    [
      'node --experimental-strip-types --test test/',
      `node --experimental-strip-types --test ${NODE_JUNIT} test/`,
    ],
    ['/usr/bin/node --test', `/usr/bin/node --test ${NODE_JUNIT}`],
  ])('node:test 러너를 알아보고 인자를 남긴다 (%s)', (test, run) => {
    const q = draft({ test })
    expect(q.commands.acceptance).toEqual({ id: 'test', run, junit: '.relay-out/junit.xml' })
    expect(q.ratchets.map((r) => r.id)).toEqual(['tests', 'file-size'])
  })

  test.each([
    ['vitest', `npx vitest run ${VITEST_JUNIT}`],
    ['npx vitest run --project unit', `npx vitest run --project unit ${VITEST_JUNIT}`],
    ['./node_modules/.bin/vitest run', `./node_modules/.bin/vitest run ${VITEST_JUNIT}`],
  ])('vitest 러너를 알아보고 인자를 남긴다 (%s)', (test, run) => {
    const q = draft({ test })
    expect(q.commands.acceptance?.run).toBe(run)
    expect(q.commands.fast).toEqual([])
  })

  test.each(['jest', 'mocha', 'jest --config vitest.config.js', 'vitest run && playwright test'])(
    '알아보지 못한 test 스크립트는 fast 명령으로 넣는다 (%s)',
    (test) => {
      const q = draft({ test })
      expect(q.commands.fast).toEqual([{ id: 'test', run: 'npm run test' }])
      expect(q.commands.acceptance).toBeUndefined()
      expect(q.ratchets.map((r) => r.kind)).toEqual(['file_lines'])
    },
  )

  test('npm init의 자리표시 test 스크립트는 넣지 않는다', () => {
    const test = 'echo "Error: no test specified" && exit 1'
    const q = draft({ test })
    expect(q.commands).toEqual({ fast: [] })
  })

  test('scripts에 없는 명령은 넣지 않는다', () => {
    const q = draft({ lint: 'eslint .', build: 'tsc' })
    expect(q.commands.fast).toEqual([{ id: 'lint', run: 'npm run lint' }])
  })

  test('pnpm lockfile이면 pnpm으로 설치하고 돌린다', () => {
    const q = draft({ lint: 'eslint .', test: 'jest' }, {}, ['pnpm-lock.yaml'])
    expect(q.setup).toEqual({
      run: 'pnpm install --frozen-lockfile',
      inputs: ['pnpm-lock.yaml'],
      keep: ['node_modules'],
    })
    expect(q.commands.fast).toEqual([
      { id: 'lint', run: 'pnpm run lint' },
      { id: 'test', run: 'pnpm run test' },
    ])
  })

  test('yarn lockfile이면 yarn으로 설치한다', () => {
    const q = draft({ lint: 'x' }, {}, ['yarn.lock'])
    expect(q.setup?.run).toBe('yarn install --frozen-lockfile')
    expect(q.commands.fast).toEqual([{ id: 'lint', run: 'yarn run lint' }])
  })

  test('npm-shrinkwrap.json도 npm lockfile로 본다', () => {
    const q = draftQuality({ files: ['npm-shrinkwrap.json'] })
    expect(q.setup?.run).toBe('npm ci')
    expect(q.setup?.inputs).toEqual(['npm-shrinkwrap.json'])
  })

  test('lockfile이 여럿이면 packageManager가 가리키는 것을 쓴다', () => {
    const files = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']
    const q = draft({}, { packageManager: 'yarn@4.1.0' }, files)
    expect(q.setup?.inputs).toEqual(['yarn.lock'])
  })

  test('lockfile이 여럿이고 packageManager가 없으면 npm을 먼저 고른다', () => {
    const q = draft({}, {}, ['yarn.lock', 'package-lock.json'])
    expect(q.setup?.inputs).toEqual(['package-lock.json'])
  })

  test('lockfile이 없으면 setup은 없고 packageManager로 명령을 돌린다', () => {
    const q = draft({ typecheck: 'tsc' }, { packageManager: 'pnpm@9.0.0' }, ['package.json'])
    expect(q.setup).toBeUndefined()
    expect(q.commands.fast).toEqual([{ id: 'typecheck', run: 'pnpm run typecheck' }])
  })

  test('루트가 아닌 lockfile은 setup에 쓰지 않지만 줄 수 래칫에서는 뺀다', () => {
    const q = draftQuality({ files: ['packages/a/package-lock.json', 'packages/b/yarn.lock'] })
    expect(q.setup).toBeUndefined()
    const exclude = ['**/package-lock.json', '**/yarn.lock']
    expect(q.ratchets).toEqual([{ id: 'file-size', kind: 'file_lines', max: 600, exclude }])
  })

  test.each([
    ['.github/workflows/ci.yaml', true],
    ['.github/workflows/sub/ci.yml', false],
    ['.github/ci.yml', false],
    ['.gitlab-ci.yml', false],
  ])('CI 파일 %s이면 full.ci_checks를 비워 둔다: %s', (file, hasFull) => {
    const q = draftQuality({ files: [file] })
    expect(q.commands.full).toEqual(hasFull ? { ci_checks: [] } : undefined)
    expect(q.rules).toEqual([])
  })

  test('package.json을 읽지 못하면 scripts가 없는 것으로 본다', () => {
    const q = draftQuality({ packageJson: '{ not json', files: ['package-lock.json'] })
    expect(q.commands.fast).toEqual([])
    expect(q.setup?.run).toBe('npm ci')
    expect(draftQuality({ packageJson: '[1]', files: [] }).commands.fast).toEqual([])
  })

  test('문자열이 아닌 스크립트와 packageManager는 무시한다', () => {
    expect(draft({ lint: 3, test: null }, { packageManager: 7 }).commands.fast).toEqual([])
  })

  test('알 수 없는 packageManager는 무시하고 npm을 쓴다', () => {
    const q = draft({ lint: 'x' }, { packageManager: 'bun@1.0.0' })
    expect(q.commands.fast).toEqual([{ id: 'lint', run: 'npm run lint' }])
  })

  test('파일 목록의 순서와 앞의 ./에 상관없이 같은 초안', () => {
    const packageJson = pkg({ lint: 'x', test: 'vitest run' })
    const files = ['yarn.lock', '.github/workflows/a.yml', 'package-lock.json', 'src/a.ts']
    const a = draftQuality({ packageJson, files })
    const b = draftQuality({ packageJson, files: [...files].reverse().map((f) => `./${f}`) })
    expect(b).toEqual(a)
  })

  test('초안은 늘 자동 조건 small을 넣는다(V19: 스위치가 꺼져 있어도 그림자 실적이 첫날부터 쌓이게)', () => {
    expect(DRAFT_AUTO).toEqual(SMALL)
    expect(draftQuality({ files: [] }).auto).toEqual([SMALL])
    expect(draft({ test: 'vitest' }, {}, ['package-lock.json']).auto).toEqual([SMALL])
    // 돌려준 초안을 고쳐도 다음 초안이 바뀌지 않는다
    const first = draftQuality({ files: [] })
    if (first.auto[0]) first.auto[0].max_changed_lines = 1
    expect(draftQuality({ files: [] }).auto).toEqual([SMALL])
  })

  test('초안은 parseQuality를 그대로 통과한다', () => {
    const drafts = [
      draftQuality({ files: [] }),
      draftQuality({
        packageJson: pkg({ typecheck: 'tsc', lint: 'eslint .', test: 'node --test' }),
        files: ['package-lock.json', '.github/workflows/ci.yml', 'packages/x/yarn.lock'],
      }),
      draft({ test: 'jest' }, {}, ['pnpm-lock.yaml']),
    ]
    for (const d of drafts) expect(valueOf(JSON.stringify(d))).toEqual(d)
  })
})

describe('acceptanceRun', () => {
  const VITEST_JUNIT = '--reporter=junit --outputFile=.relay-out/junit.xml'
  const NODE_JUNIT = '--test-reporter=junit --test-reporter-destination=.relay-out/junit.xml'

  test.each([
    [
      'vitest --config vitest.unit.config.ts',
      `npx vitest run --config vitest.unit.config.ts ${VITEST_JUNIT}`,
    ],
    ['node --test test/unit/', `node --test ${NODE_JUNIT} test/unit/`],
    ['cross-env TZ=UTC vitest run', `npx cross-env TZ=UTC vitest run ${VITEST_JUNIT}`],
    ['TZ=UTC vitest', `TZ=UTC npx vitest run ${VITEST_JUNIT}`],
    ['TZ=UTC node --test', `TZ=UTC node --test ${NODE_JUNIT}`],
  ])('러너 뒤의 인자와 앞의 환경 변수를 남긴다 (%s)', (script, run) => {
    expect(acceptanceRun(script)).toBe(run)
  })

  test.each([
    'vitest run "a b"',
    "vitest run 'a'",
    'vitest run $DIR',
    'vitest run > out.txt',
    'vitest --reporter=dot',
    'node --test --test-reporter=spec',
    'vitest --watch',
    'vitest watch',
    'node test.js',
    'jest',
    '',
  ])('그대로 옮기기 어려운 스크립트는 null (%j)', (script) => {
    expect(acceptanceRun(script)).toBeNull()
  })
})

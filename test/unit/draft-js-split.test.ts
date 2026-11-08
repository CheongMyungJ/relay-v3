// [단위] JS 초안의 이어 붙인 test 스크립트(V64, engine/recipes.ts splitTestScript): 러너 마디만 JUnit 출력으로 수용 시험에 쓰고
// 나머지 마디는 이미 빠른 검사가 아닌 것만 둔다. defu·ufo는 시범(docs/experiments/quality-floor-pilot, 찾은 문제 1)의
// package.json 모양 그대로. 다른 JS 초안은 draft-recipes.test.ts.
import { describe, expect, test } from 'vitest'
import { parseQuality } from '../../src/core/quality.ts'
import type { QualityConfig } from '../../src/core/types.ts'
import { planDraft, type DraftPlan } from '../../src/engine/draft.ts'
import { splitTestScript } from '../../src/engine/recipes.ts'

function plan(files: Record<string, string | null>): DraftPlan {
  const texts = new Map<string, string>()
  for (const [p, t] of Object.entries(files)) if (t !== null) texts.set(p, t)
  const out = planDraft({ files: Object.keys(files), texts })
  const parsed = parseQuality(JSON.stringify(out.config))
  if (!parsed.ok) throw new Error(parsed.errors.join('; '))
  return out
}
const ids = (q: QualityConfig) => q.ratchets.map((r) => r.id)

describe('JS: 이어 붙인 test 스크립트(V64)', () => {
  // 시범의 defu·ufo package.json 그대로(scripts와 devDependencies의 커버리지 제공자)
  const defu = {
    scripts: {
      build: 'unbuild',
      dev: 'vitest',
      lint: 'oxlint src && oxfmt --check src test',
      test: 'pnpm lint && pnpm test:types && pnpm vitest run',
      'test:types': 'tsgo --noEmit',
    },
    devDependencies: { '@vitest/coverage-v8': '^4', vitest: '^4' },
  }
  const ufo = {
    scripts: {
      lint: 'eslint . && prettier -c src test',
      test: 'pnpm lint && vitest run --typecheck',
    },
    devDependencies: { '@vitest/coverage-v8': '^4', vitest: '^4' },
  }
  const COVERAGE =
    '--coverage.enabled --coverage.reporter=lcov --coverage.reportsDirectory=.relay-out/coverage'

  test('defu: vitest 마디가 수용 시험(pnpm 꼴 그대로), lint는 한 번, test:types는 빠른 검사', () => {
    const q = plan({ 'package.json': JSON.stringify(defu), 'pnpm-lock.yaml': null }).config
    expect(q.commands).toEqual({
      fast: [
        { id: 'lint', run: 'pnpm run lint' },
        { id: 'test-types', run: 'pnpm run test:types' },
      ],
      acceptance: {
        id: 'test',
        run: `pnpm vitest run --reporter=junit --outputFile=.relay-out/junit.xml ${COVERAGE}`,
        junit: '.relay-out/junit.xml',
      },
    })
    expect(ids(q)).toEqual(['tests', 'file-size', 'suppressions', 'duplication', 'diff-coverage'])
  })

  test('ufo: 맨 vitest 마디는 레포의 패키지 관리자 꼴로 부르고 인자(--typecheck)를 남긴다', () => {
    const q = plan({ 'package.json': JSON.stringify(ufo), 'pnpm-lock.yaml': null }).config
    expect(q.commands.fast).toEqual([{ id: 'lint', run: 'pnpm run lint' }])
    expect(q.commands.acceptance?.run).toBe(
      `pnpm vitest run --typecheck --reporter=junit --outputFile=.relay-out/junit.xml ${COVERAGE}`,
    )
    expect(ids(q)[0]).toBe('tests')
  })

  test('나누기: 다른 스크립트를 부르는 러너, 러너 앞의 build, 맨 명령, 이미 빠른 검사인 글', () => {
    const scripts = {
      lint: 'eslint .',
      build: 'tsc -b',
      'test:unit': 'vitest run --config vitest.unit.ts',
    }
    expect(
      splitTestScript(
        'npm run build && eslint . && tsc --noEmit && npm run test:unit',
        scripts,
        'npm',
        ['lint'],
      ),
    ).toEqual({
      acceptance:
        'npm run build && npx vitest run --config vitest.unit.ts --reporter=junit --outputFile=.relay-out/junit.xml',
      fast: [{ id: 'tsc', run: 'PATH="$PWD/node_modules/.bin:$PATH" tsc --noEmit' }],
    })
    // 러너 뒤의 build는 빠른 검사, node --test도 러너다
    expect(splitTestScript('node --test && yarn build', scripts, 'yarn', [])).toEqual({
      acceptance:
        'node --test --test-reporter=junit --test-reporter-destination=.relay-out/junit.xml',
      fast: [{ id: 'build', run: 'yarn run build' }],
    })
    expect(splitTestScript('vitest run && eslint .', {}, 'bun', [])?.acceptance).toBe(
      'bunx vitest run --reporter=junit --outputFile=.relay-out/junit.xml',
    )
  })

  test('나누지 않음: 러너가 없거나 둘, 셸 글자, 이어 붙이지 않은 스크립트(core 초안 그대로)', () => {
    expect(splitTestScript('eslint . && jest', {}, 'npm', [])).toBeNull()
    expect(splitTestScript('vitest run && vitest run --config e2e.ts', {}, 'npm', [])).toBeNull()
    expect(splitTestScript('eslint . && vitest run | tee out', {}, 'npm', [])).toBeNull()
    expect(splitTestScript("eslint 'src' && vitest run", {}, 'npm', [])).toBeNull()
    expect(splitTestScript('vitest run', {}, 'npm', [])).toBeNull()
    // 모르는 러너면 전처럼 test 스크립트 통째가 빠른 검사
    const q = plan({ 'package.json': JSON.stringify({ scripts: { test: 'eslint . && jest' } }) })
    expect(q.config.commands).toEqual({ fast: [{ id: 'test', run: 'npm run test' }] })
  })

  test('주 단위가 아니면 test 스크립트 통째가 빠른 검사(JUnit 없이)', () => {
    const p = plan({
      'web/package.json': JSON.stringify(ufo),
      'web/pnpm-lock.yaml': null,
      'web/src/a.ts': null,
      'api/go.mod': 'module api\n',
      'api/a.go': null,
      'api/b.go': null,
    })
    expect(p.config.commands.fast.map((c) => [c.id, c.run])).toEqual([
      ['web-lint', 'cd web && pnpm run lint'],
      ['web-test', 'cd web && pnpm run test'],
      ['api-vet', 'cd api && go vet ./...'],
    ])
    expect(p.config.commands.acceptance?.run).toBe(
      'cd api && go test -json ./... > .relay-out/go-test.json',
    )
  })
})

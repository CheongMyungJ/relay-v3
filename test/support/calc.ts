// [흐름] 시험의 바탕: 의존성 없는 작은 node 프로젝트(calc)와 그 품질 기준. 시험은 node:test로 돈다.
import { resolve } from 'node:path'

export const NOW = '2026-11-04T09:00:00.000Z'
export const MAIN = resolve(import.meta.dirname, '../../src/cli/main.ts')
export const JUNIT = '.relay-out/junit.xml'

export const QUALITY = {
  version: 1,
  commands: {
    fast: [{ id: 'unit', run: 'node --test' }],
    acceptance: {
      id: 'accept',
      run: `node --test --test-reporter=junit --test-reporter-destination=${JUNIT}`,
      junit: JUNIT,
    },
  },
  test_globs: ['**/*.test.js'],
  ratchets: [
    { id: 'tests', kind: 'test_count' },
    { id: 'file-size', kind: 'file_lines', max: 600 },
  ],
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
export const QUALITY_TEXT = `${JSON.stringify(QUALITY, null, 2)}\n`

export const calc = (overHi: 'lo' | 'hi') => `export function add(a, b) {
  return a + b
}

export function clamp(n, lo, hi) {
  return n < lo ? lo : n > hi ? ${overHi} : n
}
`

export const TESTS_BASE = `import { test } from 'node:test'
import assert from 'node:assert/strict'
import { add, clamp } from '../src/calc.js'

test('더하기 [fix-clamp:C2.1]', () => {
  assert.equal(add(2, 3), 5)
})

test('범위 안의 값은 그대로', () => {
  assert.equal(clamp(5, 0, 10), 5)
})
`

export const byId = <T extends { id: string }>(items: T[], id: string): T | undefined =>
  items.find((x) => x.id === id)

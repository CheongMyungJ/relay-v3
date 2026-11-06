// [단위] 빚 기록의 파일과 커밋 메시지(M3b, src/engine/debt-record.ts): debtFromRatchet 그대로, 이미 있는 id는 뒤에 수,
// 트레일러, request.md의 기록 안 된 나빠짐 절
import { describe, expect, test } from 'vitest'
import { parseDebt } from '../../src/core/debt.ts'
import type { DebtItem, RatchetResult } from '../../src/core/types.ts'
import {
  debtFiles,
  debtMessage,
  uncoveredWorse,
  UNRECORDED_TITLE,
  unrecordedSection,
  worseOf,
} from '../../src/engine/debt-record.ts'

const SIZE: RatchetResult = {
  id: 'file-size',
  status: 'worse',
  detail: '600줄을 넘음: src/a.js(500→640)',
  offenders: [{ path: 'src/a.js', base: 500, head: 640 }],
}
const TESTS: RatchetResult = {
  id: 'tests',
  status: 'worse',
  base: 5,
  head: 4,
  detail: '시험 수 5 → 4',
}

describe('debtFiles', () => {
  test('나빠진 래칫마다 .relay/debt/<id>.md, 되읽으면 같은 항목', () => {
    const { items, files } = debtFiles(
      [SIZE, TESTS],
      'https://x/pull/3',
      '2026-11-06T01:02:03Z',
      new Set(),
    )
    expect(items.map((i) => i.id)).toEqual(['r-file-size-src-a-js', 'r-tests'])
    expect(items[0]).toMatchObject({
      anchor: { path: 'src/a.js', metric: 'file-size' },
      kind: 'accepted_regression',
      source: 'https://x/pull/3',
      created: '2026-11-06',
    })
    expect(Object.keys(files)).toEqual([
      '.relay/debt/r-file-size-src-a-js.md',
      '.relay/debt/r-tests.md',
    ])
    const text = files['.relay/debt/r-tests.md'] ?? ''
    expect(parseDebt(text, 'r-tests')).toEqual({ ok: true, value: items[1] })
  })

  test('head에 이미 있는 id는 -2, -3을 붙여 앞 빚을 덮지 않는다', () => {
    const taken = new Set(['r-file-size-src-a-js', 'r-file-size-src-a-js-2'])
    const { items } = debtFiles([SIZE], 'w1', '2026-11-06', taken)
    expect(items.map((i) => i.id)).toEqual(['r-file-size-src-a-js-3'])
  })
})

test('debtMessage: 제목에 래칫, 항목마다 한 줄, 트레일러 Relay-Work와 항목마다 Relay-Debt', () => {
  const { items } = debtFiles([SIZE, TESTS], 'w1', '2026-11-06', new Set())
  const lines = debtMessage('w1', [SIZE, TESTS], items).split('\n')
  expect(lines[0]).toBe('relay: 받아들인 나빠짐을 빚으로 기록 (file-size, tests)')
  expect(lines.slice(-4)).toEqual([
    'Relay-Work: w1',
    'Relay-Debt: r-file-size-src-a-js',
    'Relay-Debt: r-tests',
    '',
  ])
})

test('worseOf와 unrecordedSection', () => {
  expect(worseOf([SIZE, { id: 'x', status: 'same', detail: '' }])).toEqual([SIZE])
  expect(unrecordedSection([])).toBe('')
  const text = unrecordedSection(['file-size: src/a.js 500 → 640 (앱 밖에서 머지됨)'])
  expect(text.startsWith(`\n${UNRECORDED_TITLE}\n\n`)).toBe(true)
  expect(text.endsWith('\n- file-size: src/a.js 500 → 640 (앱 밖에서 머지됨)\n')).toBe(true)
})

describe('uncoveredWorse', () => {
  const item = (
    id: string,
    path: string,
    metric: string,
    kind: DebtItem['kind'] = 'accepted_regression',
  ): DebtItem => ({
    id,
    anchor: { path, metric },
    kind,
    source: 'w1',
    reason: '나빠진 채 머지됨',
    created: '2026-11-06',
  })
  const TWO: RatchetResult = {
    ...SIZE,
    offenders: [
      { path: 'src/a.js', base: 500, head: 640 },
      { path: 'src/b.js', head: 700 },
    ],
  }

  test('같은 경로·래칫의 accepted_regression이 덮은 offender는 빼고, 모두 덮인 래칫은 뺀다', () => {
    const a = item('r-file-size-src-a-js', 'src/a.js', 'file-size')
    expect(uncoveredWorse([TWO, TESTS], [a])).toEqual([
      { ...TWO, offenders: [{ path: 'src/b.js', head: 700 }] },
      TESTS,
    ])
    const b = item('r-file-size-src-b-js', 'src/b.js', 'file-size')
    const t = item('r-tests', '.relay/quality.json', 'tests')
    expect(uncoveredWorse([TWO, TESTS], [a, b, t])).toEqual([])
  })

  test('다른 래칫, 다른 종류, 나빠지지 않은 래칫', () => {
    const other = item('x', 'src/a.js', 'dup')
    const tidy = item('y', 'src/a.js', 'file-size', 'tidy')
    expect(uncoveredWorse([SIZE], [other, tidy])).toEqual([SIZE])
    expect(uncoveredWorse([{ ...SIZE, status: 'same' }], [])).toEqual([])
  })
})

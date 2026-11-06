// [단위] 곁들일 정리(M3c, V41, src/engine/tidy.ts): request.md의 빚 목록(나이 순, 30개까지, 잡힘), 종류마다의 갚음, 묶음의
// tidy 칸(계약 tidy, 건드린 곳, 정리 몫과 상한), humanRequest가 목록을 자름, 품질 기준의 tidy_max_lines, 지침의 문단, [증거]의
// 묶음 나누기(renderer debt.ts). git을 읽는 쪽은 [흐름] check-tidy.test.ts.
import { describe, expect, test } from 'vitest'
import { instructionsText } from '../../src/core/instructions.ts'
import { parseQuality } from '../../src/core/quality.ts'
import type { DebtItem, DiffFacts, FileChange, QualityConfig } from '../../src/core/types.ts'
import { humanRequest } from '../../src/engine/judge.ts'
import {
  byAge,
  debtSection,
  payoff,
  TIDY_LIST_MAX,
  TIDY_TITLE,
  tidyEvidence,
  type TidyInput,
} from '../../src/engine/tidy.ts'
import { tidyGroups, tidyLinesText } from '../../src/renderer/src/debt.ts'
import { QUALITY } from '../support/calc.ts'

const item = (id: string, o: Partial<DebtItem> = {}): DebtItem => ({
  id,
  anchor: { path: `src/${id}.js` },
  kind: 'tidy',
  source: 'w0',
  reason: `${id}를 정리\n둘째 줄`,
  created: '2026-01-01',
  ...o,
})

const quality = (more: object = {}): QualityConfig => {
  const q = parseQuality(JSON.stringify({ ...QUALITY, ...more }))
  if (!q.ok) throw new Error(q.errors.join(', '))
  return q.value
}

const change = (path: string, added: number, deleted = 0, status: FileChange['status'] = 'M') =>
  ({
    path,
    status,
    added,
    deleted,
    binary: false,
    added_lines: [],
    removed_lines: [],
  }) satisfies FileChange

const diff = (files: FileChange[]): DiffFacts => ({ base: 'b', head: 'h', files })

describe('debtSection', () => {
  test('나이 순, 경로와 첫 줄, id·종류·날짜, 잡힘은 진행 중', () => {
    const items = [
      item('new', { created: '2026-03-01' }),
      item('old-b', { kind: 'test_gap' }),
      item('old-a', { anchor: { path: 'src/a.js', metric: 'file-size' } }),
    ]
    expect(byAge(items).map((i) => i.id)).toEqual(['old-a', 'old-b', 'new'])
    const text = debtSection(items, new Map([['new', 'w7']]))
    expect(text.startsWith(`\n${TIDY_TITLE}\n\n`)).toBe(true)
    expect(text).toContain('빚 3개')
    const lines = text.split('\n').filter((l) => l.startsWith('- '))
    expect(lines).toEqual([
      '- `src/a.js`: old-a를 정리 (old-a, tidy, 2026-01-01)',
      '- `src/old-b.js`: old-b를 정리 (old-b, test_gap, 2026-01-01)',
      '- `src/new.js`: new를 정리 (new, tidy, 2026-03-01, 진행 중: 잡힘(w7))',
    ])
    expect(text.endsWith('\n')).toBe(true)
  })

  test('없으면 빈 글, 30개가 넘으면 수만', () => {
    expect(debtSection([], new Map())).toBe('')
    const many = Array.from({ length: TIDY_LIST_MAX + 1 }, (_, n) => item(`d${n}`))
    const text = debtSection(many, new Map([['d3', 'w1']]))
    expect(text).toContain(`빚 ${TIDY_LIST_MAX + 1}개`)
    expect(text).toContain('진행 중 1개')
    expect(text).not.toMatch(/^- /m)
    const exact = debtSection(many.slice(1), new Map())
    expect(exact.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(TIDY_LIST_MAX)
  })

  test('humanRequest는 빚 목록 앞에서 자른다', () => {
    const request = `덧셈을 고쳐 줘\n${debtSection([item('a')], new Map())}`
    expect(humanRequest(request)).toBe('덧셈을 고쳐 줘\n\n')
  })
})

describe('payoff', () => {
  const q = quality()
  const kept = { deleted: false, lines: 10 }
  test('tidy·test_gap: 항목 파일을 지우면 갚음', () => {
    expect(payoff(item('a'), q, { deleted: true, lines: 10 })).toEqual({
      status: 'paid',
      detail: '항목 파일을 지움',
    })
    expect(payoff(item('a', { kind: 'test_gap' }), q, kept)).toEqual({
      status: 'open',
      detail: '항목 파일이 남음',
    })
  })

  test('rule_violation은 가르지 못함(M3d)', () => {
    expect(payoff(item('a', { kind: 'rule_violation' }), q, { deleted: true, lines: 1 })).toEqual({
      status: 'unknown',
      detail: '규칙 승격(M3d) 전이라 가르지 못함 (항목 파일을 지움)',
    })
  })

  test('accepted_regression(file_lines): max 이하이거나 없어지면 갚음, 넘으면 못 갚음', () => {
    const big = item('r', {
      kind: 'accepted_regression',
      anchor: { path: 'src/big.js', metric: 'file-size' },
    })
    expect(payoff(big, q, { deleted: true, lines: 600 })).toEqual({
      status: 'paid',
      detail: '600줄 ≤ 600 (항목 파일을 지움)',
    })
    expect(payoff(big, q, { deleted: false, lines: null }).status).toBe('paid')
    // 항목 파일만 지우고 파일은 그대로면 못 갚음
    expect(payoff(big, q, { deleted: true, lines: 700 })).toEqual({
      status: 'open',
      detail: '700줄 > 600 (항목 파일을 지움)',
    })
    expect(payoff(big, q, { deleted: false, lines: undefined }).status).toBe('unknown')
  })

  test('accepted_regression의 래칫이 파일 줄 수가 아니거나 품질 기준에 없으면 가르지 못함', () => {
    const tests = item('t', {
      kind: 'accepted_regression',
      anchor: { path: '.relay/quality.json', metric: 'tests' },
    })
    expect(payoff(tests, q, kept).detail).toBe(
      '래칫 tests은 파일 줄 수가 아니라 가르지 못함 (항목 파일이 남음)',
    )
    expect(payoff(tests, null, kept)).toMatchObject({ status: 'unknown' })
    const gone = { ...tests, anchor: { path: 'a', metric: 'gone' } }
    expect(payoff(gone, q, kept).detail).toBe(
      '래칫 gone이 품질 기준에 없어 가르지 못함 (항목 파일이 남음)',
    )
  })
})

describe('tidyEvidence', () => {
  const base: Omit<TidyInput, 'taken' | 'diff'> = {
    items: [
      item('calc', { anchor: { path: 'src/calc.js' } }),
      item('dir', { kind: 'test_gap', anchor: { path: 'src/util' }, created: '2026-02-01' }),
      item('far', { anchor: { path: 'lib/far.js' } }),
      item('rule', { kind: 'rule_violation', anchor: { path: 'src/calc.js' } }),
      item('gone', { anchor: { path: 'lib/gone.js' } }),
    ],
    broken: new Set(['bad']),
    q: quality({ tidy_max_lines: 20 }),
    // 지운 항목 파일: calc, gone
    exists: (p) => !['.relay/debt/calc.md', '.relay/debt/gone.md'].includes(p),
    lines: new Map(),
  }

  test('계약 tidy의 차례, 없는 id와 깨진 id, 건드린 곳과 항목 파일을 바꾼 것은 나이 순', () => {
    const t = tidyEvidence({
      ...base,
      taken: ['calc', 'nope', 'bad', 'calc'],
      diff: diff([
        change('src/calc.js', 15, 10),
        change('src/util/x.js', 3),
        change('.relay/debt/calc.md', 0, 6, 'D'),
        change('.relay/debt/gone.md', 0, 6, 'D'),
      ]),
    })
    expect(t.taken).toEqual(['calc', 'nope', 'bad'])
    expect(t.items.map((i) => [i.id, i.status, i.detail])).toEqual([
      ['calc', 'paid', '항목 파일을 지움'],
      ['nope', 'unknown', '기준의 빚 장부에 없음'],
      ['bad', 'unknown', '기준의 항목 파일을 읽지 못함(형식)'],
      ['gone', 'paid', '항목 파일을 지움'],
      ['rule', 'unknown', '규칙 승격(M3d) 전이라 가르지 못함 (항목 파일이 남음)'],
      ['dir', 'open', '항목 파일이 남음'],
    ])
    expect(t.items[0]).toMatchObject({ path: 'src/calc.js', kind: 'tidy', reason: 'calc를 정리' })
    expect(t.items[1]).toMatchObject({ path: '', kind: null })
    // 정리 몫: calc의 anchor(src/calc.js)에 닿은 바뀐 파일만. 빚 폴더는 세지 않는다
    expect(t.lines).toBe(25)
    expect(t.max).toBe(20)
  })

  test('계약 tidy가 없으면 정리 몫 0, 상한은 기본 100. 아무것도 닿지 않으면 항목이 없다', () => {
    const t = tidyEvidence({ ...base, q: null, taken: [], diff: diff([change('README.md', 1)]) })
    expect(t).toEqual({ taken: [], items: [], lines: 0, max: 100 })
  })

  test('옮긴 파일의 옛 자리도 건드린 곳이다', () => {
    const moved = { ...change('src/new.js', 0, 0, 'R'), old_path: 'lib/far.js' }
    const t = tidyEvidence({ ...base, taken: ['far'], diff: diff([moved]) })
    expect(t.items.map((i) => i.id)).toEqual(['far'])
    expect(t.lines).toBe(0)
  })
})

describe('[증거]의 빚 칸', () => {
  const t = tidyEvidence({
    items: [item('a'), item('b'), item('c')],
    broken: new Set(),
    taken: ['a', 'b'],
    diff: diff([change('src/a.js', 90), change('src/b.js', 20), change('src/c.js', 1)]),
    q: null,
    exists: (p) => p !== '.relay/debt/a.md',
    lines: new Map(),
  })

  test('갚은 빚, 못 갚은 빚(계약 tidy), 건드린 곳의 빚(계약 밖)', () => {
    const g = tidyGroups(t)
    expect(g.paid.map((i) => i.id)).toEqual(['a'])
    expect(g.unpaid.map((i) => i.id)).toEqual(['b'])
    expect(g.touched.map((i) => i.id)).toEqual(['c'])
    expect(g.over).toBe(true)
    expect(tidyLinesText(t)).toBe('곁들일 정리 2개 · 정리 몫 110줄 (상한 100줄을 넘음)')
  })

  test('계약 tidy가 없으면 상한을 말하지 않는다', () => {
    const none = { ...t, taken: [], lines: 0 }
    expect(tidyGroups(none).over).toBe(false)
    expect(tidyLinesText(none)).toBeNull()
    expect(tidyLinesText({ ...t, lines: 100 })).toBe('곁들일 정리 2개 · 정리 몫 100줄 (상한 100줄)')
  })
})

describe('품질 기준과 지침', () => {
  test('tidy_max_lines는 0 이상의 정수, 없으면 칸이 없다', () => {
    expect(quality({ tidy_max_lines: 40 }).tidy_max_lines).toBe(40)
    expect('tidy_max_lines' in quality()).toBe(false)
    const bad = parseQuality(JSON.stringify({ ...QUALITY, tidy_max_lines: -1 }))
    expect(bad.ok ? [] : bad.errors).toEqual(['tidy_max_lines: 0 이상의 정수여야 함'])
  })

  test('지침: 켜면 빚 목록·tidy·상한·갚는 법, 끄면 M3b까지와 같은 글', () => {
    const base = {
      workId: 'w',
      contractId: 'c',
      examplesDir: '.relay/examples',
      baseBranch: 'main',
      workBranch: 'relay/c',
      questionMode: 'confirm_each',
    } as const
    const on = instructionsText({ ...base, tidy: true })
    for (const s of [
      'The request file may end with the debt items of the repository (oldest first)',
      'Leave items marked as in progress',
      '`tidy_max_lines` changed lines',
      "bring the file down to the ratchet's max",
      "delete the item's file in `.relay/debt/`",
    ])
      expect(on, s).toContain(s)
    const off = instructionsText(base)
    expect(off).not.toContain('tidy_max_lines')
    expect(instructionsText({ ...base, tidy: false })).toBe(off)
  })
})

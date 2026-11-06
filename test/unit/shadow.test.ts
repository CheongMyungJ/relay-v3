// [단위] 조건별 그림자 실적의 숫자(M4c, docs/m4-design.md 5.1, src/engine/shadow.ts): 분모 갈래 하나마다(일치, 불일치 다섯,
// 분모 밖 여섯), met으로 고르기(여러 조건과 함께 센 표본), 판, 비교군과 lift, Wilson 하한, 머지 뒤 30일이 실적을 막음과 이의,
// 들어오는 빠르기, [실적] 표(지금 판, 판이 바뀐 자리, 판 모름, 사람 경로)와 그림자 표본의 끝(Q6)
import { describe, expect, test } from 'vitest'
import type { AfterLine, DisputeLine } from '../../src/engine/after-merge.ts'
import { GATE_VERSION } from '../../src/engine/gate-version.ts'
import type { EpochSource, LedgerEntry } from '../../src/engine/ledger.ts'
import {
  recordStats,
  shadowEnds,
  shadowStats,
  trackRecord,
  wilsonLow,
} from '../../src/engine/shadow.ts'

const EPOCH: Required<EpochSource> = {
  conds: { small: 'a1b2c3d4e5f6', docs: '0f9e8d7c6b5a' },
  model_observed: 'model-a',
  effort: 'medium',
  claude_version: '2.1.300 (Claude Code)',
  gate_version: GATE_VERSION,
  review_prompt: 4,
}
const NOW = '2026-11-30T00:00:00Z'
const DAY = 24 * 60 * 60 * 1000
const daysAgo = (n: number) => new Date(Date.parse(NOW) - n * DAY).toISOString()

/** 조건을 채운 그림자 결론 줄(met). met이 비면 사람 경로 */
function line(
  work: string,
  head: string,
  met: string[],
  more: Partial<LedgerEntry> = {},
): LedgerEntry {
  return {
    ts: daysAgo(1),
    project: 'p1',
    work,
    head,
    conclusion: 'human_merge',
    condition: met[0] ?? null,
    shadow: met.length > 0,
    met,
    ...EPOCH,
    relay_version: '0',
    ...more,
  }
}

/** 끝 줄 */
const fate = (work: string, head: string, more: Partial<LedgerEntry>): LedgerEntry => ({
  ...line(work, head, []),
  shadow: false,
  condition: null,
  met: undefined,
  ...more,
})
const merge = (work: string, head: string, more: Partial<LedgerEntry> = {}) =>
  fate(work, head, {
    merged_head: head,
    by: 'human',
    same_change: true,
    merge_commit: `m-${work}`,
    ...more,
  })

const stats = (
  entries: LedgerEntry[],
  o: { after?: AfterLine[]; disputes?: DisputeLine[]; epoch?: EpochSource | 'all' } = {},
) => shadowStats({ entries, scope: { project: 'p1' }, epoch: o.epoch ?? EPOCH, now: NOW, ...o })

describe('shadowStats: 분모 갈래', () => {
  test('일치, 불일치 다섯 갈래(더 커밋, 같은 변경 모름, 닫음, 버림, 90일 뒤 unmerged)', () => {
    const s = stats([
      line('a', 'h', ['small']),
      merge('a', 'h'),
      line('b', 'h', ['small']),
      merge('b', 'h', { merged_head: 'h2', same_change: false }),
      line('c', 'h', ['small']),
      merge('c', 'h', { merged_head: 'h2', same_change: null }),
      line('d', 'h', ['small']),
      fate('d', 'h', { closed: true }),
      line('e', 'h', ['small']),
      fate('e', 'h', { ended: 'discarded' }),
      line('f', 'h', ['small']),
      fate('f', 'h', { ended: 'no_pr' }),
      fate('f', 'h', { ended: 'unmerged' }),
      // 마지막이 아닌 head(중간 head가 조건을 채움)는 뒤 head로 머지됐으면 더 커밋
      line('g', 'h1', ['small']),
      line('g', 'h2', []),
      merge('g', 'h2'),
    ]).small
    expect(s).toMatchObject({
      n: 7,
      match: 1,
      miss: {
        more_unknown: 2,
        unknown_change: 1,
        closed: 1,
        discarded: 2,
        more_session: 0,
        more_human: 0,
      },
    })
    expect(s?.rate).toBeCloseTo(1 / 7)
  })

  test('분모 밖: 열림, 낡음(14일), 추적 잃음(90일), no_pr, 정책 머지, 판 다름', () => {
    const s = stats([
      line('open', 'h', ['small']),
      line('stale', 'h', ['small'], { ts: daysAgo(20) }),
      line('lost', 'h', ['small'], { ts: daysAgo(100) }),
      line('nopr', 'h', ['small']),
      fate('nopr', 'h', { ended: 'no_pr' }),
      line('policy', 'h', ['small']),
      merge('policy', 'h', { by: 'policy' }),
      line('old', 'h', ['small'], { model_observed: 'model-b' }),
      merge('old', 'h'),
    ]).small
    expect(s).toMatchObject({
      n: 0,
      match: 0,
      outside: { open: 2, stale: 1, lost: 1, policy: 1, preapproved: 0, other_epoch: 1 },
      rate: null,
      wilson_low: null,
    })
    // 모든 판이면 판 다름도 센다
    expect(
      stats([line('old', 'h', ['small'], { model_observed: 'model-b' }), merge('old', 'h')], {
        epoch: 'all',
      }).small?.match,
    ).toBe(1)
  })

  test('Work를 조건마다 한 건으로(V22): 내보내기가 여럿이어도 하나라도 분모 밖이면 분모 밖, 모두 일치여야 일치', () => {
    const u = (unit: string, head: string) => line('w', head, ['small'], { export: unit })
    const both = [
      u('a', 'h1'),
      merge('w', 'h1', { export: 'a' }),
      u('b', 'h2'),
      merge('w', 'h2', { export: 'b' }),
    ]
    expect(stats(both).small).toMatchObject({ n: 1, match: 1 })
    expect(stats([...both.slice(0, 3)]).small).toMatchObject({ n: 0, outside: { open: 1 } })
    const oneMiss = [...both.slice(0, 3), fate('w', 'h2', { export: 'b', closed: true })]
    expect(stats(oneMiss).small).toMatchObject({ n: 1, match: 0, miss: { closed: 1 } })
  })

  test('met으로 고른다: 두 조건을 채운 Work는 둘 다에 들고 함께 센 표본이다. 옛 줄은 condition으로', () => {
    const s = stats([
      line('w', 'h', ['small', 'docs']),
      merge('w', 'h'),
      line('x', 'h', ['small']),
      merge('x', 'h'),
    ])
    expect(s.small).toMatchObject({ n: 2, match: 2, correlated: 1 })
    expect(s.docs).toMatchObject({ n: 1, match: 1, correlated: 1 })
    const old = { ...line('o', 'h', []), met: undefined, condition: 'small', shadow: true }
    expect(stats([old, merge('o', 'h')]).small?.match).toBe(1)
  })
})

describe('비교군과 lift, Wilson', () => {
  test('비교군은 그 조건을 못 채우고(조건은 정책에 있었다) 끝이 정해진 Work. lift는 일치율의 차', () => {
    const entries = [
      line('a', 'h', ['small']),
      merge('a', 'h'),
      line('b', 'h', ['small']),
      fate('b', 'h', { closed: true }),
      line('c', 'h', []),
      merge('c', 'h'),
      line('d', 'h', []),
      merge('d', 'h', { merged_head: 'more', same_change: false }),
      line('e', 'h', []),
      merge('e', 'h'),
      line('f', 'h', []),
      merge('f', 'h', { by: 'policy' }),
      line('g', 'h', []),
    ]
    const s = stats(entries).small
    expect(s?.control).toMatchObject({ n: 3, as_is: 2 })
    expect(s?.lift).toBeCloseTo(0.5 - 2 / 3)
    // 비교군이 없으면 lift는 모름
    expect(stats(entries.slice(0, 4)).small?.lift).toBeNull()
  })

  test('Wilson 95% 하한: 20/20은 약 0.84, 0/n은 0, n 0은 null', () => {
    expect(wilsonLow(20, 20)).toBeCloseTo(0.839, 2)
    expect(wilsonLow(7, 9)).toBeCloseTo(0.453, 2)
    expect(wilsonLow(0, 10)).toBe(0)
    expect(wilsonLow(0, 0)).toBeNull()
  })

  test('들어오는 빠르기: 30일 안의 내보내기와 그 조건을 채운 것', () => {
    const s = stats([
      line('a', 'h', ['small']),
      line('b', 'h', []),
      line('c', 'h', ['small'], { ts: daysAgo(40) }),
    ]).small
    expect(s?.inflow).toEqual({ exports_30d: 2, met_30d: 1 })
  })
})

describe('머지 뒤 30일과 실적', () => {
  const closedAfter = (more: Partial<AfterLine>): AfterLine => ({
    kind: 'after',
    ts: NOW,
    project: 'p1',
    work: 'w0',
    merge_commit: 'm-w0',
    merged_at: daysAgo(40),
    window_end: daysAgo(10),
    closed: true,
    revert: null,
    main: 'clean',
    seen_until: NOW,
    ...more,
  })
  const twenty = Array.from({ length: 20 }, (_, i) => [
    line(`w${i}`, 'h', ['small']),
    merge(`w${i}`, 'h'),
  ]).flat()

  test('조건의 머지 무리: 창 닫힘과 지켜보는 중, 3의 규칙', () => {
    const s = stats(twenty, { after: [closedAfter({})] }).small
    expect(s?.after).toMatchObject({ merges: 20, closed: 1, watching: 19, reverts: 0, upper: 1 })
  })

  test('귀속 되돌림이나 귀속 main 실패가 있으면 trackRecord는 거짓, 이의를 달면 셈에서 빠진다', () => {
    expect(trackRecord(twenty, 'p1', 20, EPOCH)).toEqual({ small: true })
    const revert = closedAfter({ revert: { sha: 'r', form: 'this_reverts' } })
    expect(trackRecord(twenty, 'p1', 20, EPOCH, { after: [revert] })).toEqual({ small: false })
    const main = closedAfter({
      main: 'attributed',
      main_run: { name: 'ci', sha: 'm-w0', attempts: 2 },
    })
    expect(trackRecord(twenty, 'p1', 20, EPOCH, { after: [main] })).toEqual({ small: false })
    // 미정은 실적을 막지 않는다(M5 규칙이 따로 본다)
    expect(
      trackRecord(twenty, 'p1', 20, EPOCH, { after: [closedAfter({ main: 'pending' })] }),
    ).toEqual({ small: true })
    const dispute: DisputeLine = {
      kind: 'dispute',
      ts: NOW,
      project: 'p1',
      merge_commit: 'm-w0',
      event: 'revert',
    }
    expect(trackRecord(twenty, 'p1', 20, EPOCH, { after: [revert], disputes: [dispute] })).toEqual({
      small: true,
    })
    // 다른 프로젝트의 after 줄은 보지 않는다
    expect(trackRecord(twenty, 'p1', 20, EPOCH, { after: [{ ...revert, project: 'p2' }] })).toEqual(
      { small: true },
    )
  })
})

describe('recordStats', () => {
  test('지금 판은 마지막 결론 줄의 판, 판이 바뀐 자리와 판을 모르는 줄, 사람 경로 비교 줄', () => {
    const newer = { claude_version: '2.2.1 (Claude Code)' }
    const entries = [
      line('a', 'h', ['small'], { ts: daysAgo(5) }),
      merge('a', 'h'),
      { ...line('legacy', 'h', []), gate_version: undefined },
      line('b', 'h', ['small'], { ts: daysAgo(2), ...newer }),
      merge('b', 'h'),
      line('c', 'h', [], { ts: daysAgo(1), ...newer }),
      merge('c', 'h'),
    ]
    const r = recordStats({
      entries,
      scope: { project: 'p1' },
      now: NOW,
      allEpochs: false,
      broken: 2,
    })
    expect(r.epoch).toBe('current')
    expect(r.current).toEqual({
      model: 'model-a',
      effort: 'medium',
      claude: '2.2',
      gate_epoch: 1,
      review_prompt: 4,
    })
    expect(r.conditions.map((c) => [c.id, c.match, c.outside.other_epoch])).toEqual([
      ['small', 1, 1],
      ['docs', 0, 0],
    ])
    expect(r.human).toMatchObject({ n: 1, as_is: 1 })
    expect(r.changes).toEqual([{ ts: daysAgo(2), fields: ['Claude Code 2.1 → 2.2'] }])
    expect(r.unknown_epoch).toEqual({ lines: 1, of: 4 })
    expect(r.broken).toBe(2)
    const all = recordStats({
      entries,
      scope: { project: 'p1' },
      now: NOW,
      allEpochs: true,
      broken: 0,
    })
    expect(all.epoch).toBe('all')
    expect(all.conditions.find((c) => c.id === 'small')?.match).toBe(2)
    // legacy는 끝이 없어 분모 밖이다
    expect(all.human).toMatchObject({ n: 1, as_is: 1 })
  })

  test('여러 레포 합침(pool)은 프로젝트를 넘어 센다', () => {
    const entries = [
      line('a', 'h', ['small']),
      merge('a', 'h'),
      { ...line('b', 'h', ['small']), project: 'p2' },
      { ...merge('b', 'h'), project: 'p2' },
    ]
    const r = recordStats({ entries, scope: { pool: true }, now: NOW, allEpochs: false, broken: 0 })
    expect(r.conditions.find((c) => c.id === 'small')?.match).toBe(2)
  })
})

test('shadowEnds: 끝이 정해진 그림자 표본만(Q6)', () => {
  expect(shadowEnds([line('w', 'h', ['small'])], 'w')).toEqual([])
  expect(shadowEnds([line('w', 'h', ['small']), merge('w', 'h')], 'w')).toEqual([
    { unit: null, conditions: ['small'], result: 'match', why: null },
  ])
  const more = [
    line('w', 'h', ['small', 'docs']),
    merge('w', 'h', { merged_head: 'x', same_change: false }),
  ]
  expect(shadowEnds(more, 'w')).toEqual([
    { unit: null, conditions: ['small', 'docs'], result: 'miss', why: 'more_unknown' },
  ])
  // 조건을 채우지 않은 내보내기와 정책 머지는 표본이 아니다
  expect(shadowEnds([line('w', 'h', []), merge('w', 'h')], 'w')).toEqual([])
  expect(shadowEnds([line('w', 'h', ['small']), merge('w', 'h', { by: 'policy' })], 'w')).toEqual(
    [],
  )
  expect(
    shadowEnds(
      [line('w', 'h', ['small'], { export: 'u1' }), fate('w', 'h', { export: 'u1', closed: true })],
      'w',
    ),
  ).toEqual([{ unit: 'u1', conditions: ['small'], result: 'miss', why: 'closed' }])
})

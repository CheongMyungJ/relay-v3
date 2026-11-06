// [단위] 실적 장부(그림자): 일치·불일치, 판이 바뀌면 다시 잼(M4a 판 열쇠), Work를 조건마다 한 건으로(V22 내보내기), 장부
// 읽기(M4a 칸), 받아들였지만 빚으로 기록하지 않은 나빠짐의 수(M3b)
import { describe, expect, test } from 'vitest'
import { GATE_VERSION } from '../../src/engine/gate-version.ts'
import {
  acceptedUnrecorded,
  claudeMinor,
  epochKey,
  parseLedger,
  trackRecord,
  type EpochSource,
  type LedgerEntry,
} from '../../src/engine/ledger.ts'

/** 지금 판(판 열쇠의 재료). 결론 줄도 이 판으로 적는다 */
const EPOCH: Required<EpochSource> = {
  conds: { small: 'a1b2c3d4e5f6', docs: '0f9e8d7c6b5a' },
  model_observed: 'model-a',
  effort: 'medium',
  claude_version: '2.1.300 (Claude Code)',
  gate_version: GATE_VERSION,
  review_prompt: 4,
}
const NOW = { ...EPOCH, relay_version: '0.1.0' }

/** 조건 small을 채운 그림자 결론 하나 */
function shadow(work: string, head: string, more: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    ts: '2026-11-04T00:00:00Z',
    project: 'p1',
    work,
    head,
    conclusion: 'human_merge',
    condition: 'small',
    shadow: true,
    ...NOW,
    ...more,
  }
}

/** 그 Work의 머지 기록(같은 head를 그대로 머지했으면 일치) */
const merged = (work: string, head: string, by: LedgerEntry['by'] = 'human'): LedgerEntry =>
  shadow(work, head, { merged_head: head, by, conclusion: 'human_merge', condition: null })

/** n개 Work를 그림자 head 그대로 머지 */
function matches(n: number, prefix = 'w'): LedgerEntry[] {
  return Array.from({ length: n }, (_, i) => [
    shadow(`${prefix}${i}`, `h${i}`),
    merged(`${prefix}${i}`, `h${i}`),
  ]).flat()
}

describe('trackRecord', () => {
  test('그림자 head를 그대로 머지한 것이 minShadow 이상이고 일치율 95% 이상이면 true', () => {
    expect(trackRecord(matches(20), 'p1', 20, NOW)).toEqual({ small: true })
    expect(trackRecord(matches(19), 'p1', 20, NOW)).toEqual({ small: false })
  })

  test('불일치: head 뒤에 더 커밋해 머지함, 닫음', () => {
    const extra = [shadow('x', 'a'), merged('x', 'c')]
    const closed = [shadow('y', 'a'), shadow('y', 'a', { closed: true })]
    // 20 일치 + 불일치 1 = 95.2% → true, 불일치 2 = 90.9% → false
    expect(trackRecord([...matches(20), ...extra], 'p1', 20, NOW)).toEqual({ small: true })
    expect(trackRecord([...matches(20), ...extra, ...closed], 'p1', 20, NOW)).toEqual({
      small: false,
    })
  })

  test('머지 전 중간 head의 그림자는 불일치다(자동이었으면 그 head를 머지했을 것)', () => {
    const work = [shadow('z', 'h1'), shadow('z', 'h2'), merged('z', 'h2')]
    expect(trackRecord(work, 'p1', 1, NOW)).toEqual({ small: false })
    expect(trackRecord([...matches(40), ...work], 'p1', 1, NOW)).toEqual({ small: true })
  })

  test('같은 head를 여러 번 재도 하나로 센다', () => {
    const again = [shadow('w0', 'h0'), shadow('w0', 'h0'), merged('w0', 'h0')]
    expect(trackRecord(again, 'p1', 2, NOW)).toEqual({ small: false })
    expect(trackRecord(again, 'p1', 1, NOW)).toEqual({ small: true })
  })

  test('auto_merge_candidate도 세고, 정책이 머지한 것과 아직 열린 Work는 세지 않는다', () => {
    const candidate = [
      shadow('a', 'h', { conclusion: 'auto_merge_candidate', shadow: false }),
      merged('a', 'h', 'human-override'),
    ]
    expect(trackRecord(candidate, 'p1', 1, NOW)).toEqual({ small: true })
    const policy = [
      shadow('b', 'h', { conclusion: 'auto_merge_candidate', shadow: false }),
      merged('b', 'h', 'policy'),
    ]
    expect(trackRecord(policy, 'p1', 1, NOW)).toEqual({})
    expect(trackRecord([shadow('c', 'h')], 'p1', 0, NOW)).toEqual({})
  })

  test('그림자가 아닌 결론, 조건 없는 결론, 다른 프로젝트는 세지 않는다', () => {
    const other = [
      shadow('a', 'h', { shadow: false }),
      merged('a', 'h'),
      shadow('b', 'h', { condition: null }),
      merged('b', 'h'),
      shadow('c', 'h', { project: 'p2' }),
      merged('c', 'h'),
    ]
    expect(trackRecord(other, 'p1', 0, NOW)).toEqual({})
  })

  test('판 열쇠의 칸이 지금과 다른 결론은 세지 않는다(머지 기록의 판은 상관없음)', () => {
    const old = matches(20)
    const others: EpochSource[] = [
      { ...EPOCH, conds: { small: 'ffffffffffff' } },
      { ...EPOCH, model_observed: 'model-b' },
      { ...EPOCH, effort: 'high' },
      { ...EPOCH, claude_version: '2.2.0 (Claude Code)' },
      { ...EPOCH, gate_version: GATE_VERSION + 1 },
      { ...EPOCH, review_prompt: 5 },
    ]
    for (const current of others) expect(trackRecord(old, 'p1', 20, current)).toEqual({})
    const decidedNow = Array.from({ length: 20 }, (_, i) => [
      shadow(`w${i}`, `h${i}`),
      { ...merged(`w${i}`, `h${i}`), relay_version: '0.2.0', model_observed: 'model-b' },
    ]).flat()
    expect(trackRecord(decidedNow, 'p1', 20, NOW)).toEqual({ small: true })
  })

  test('Claude Code patch, relay 버전·빌드, 요청한 모델은 판 열쇠가 아니다', () => {
    const lines = matches(20).map((e) =>
      e.condition === null
        ? e
        : { ...e, relay_version: '9.9.9', relay_build: 'abc', model_requested: 'other' },
    )
    expect(
      trackRecord(lines, 'p1', 20, { ...EPOCH, claude_version: '2.1.999 (Claude Code)' }),
    ).toEqual({
      small: true,
    })
  })

  test('판을 모르는 결론은 지금 판과 같지 않다: M4a 앞의 줄, 리뷰 모델·effort를 모름(양쪽 다 몰라도)', () => {
    const without = (field: keyof EpochSource) =>
      matches(20).map((e) => ({ ...e, [field]: undefined }))
    expect(trackRecord(without('gate_version'), 'p1', 20, NOW)).toEqual({})
    for (const field of ['model_observed', 'effort', 'conds', 'review_prompt'] as const)
      expect(trackRecord(without(field), 'p1', 20, { ...EPOCH, [field]: undefined })).toEqual({})
  })

  test('Work를 조건마다 한 건으로 센다(V22): 그 조건을 채운 내보내기가 모두 그 head로 머지돼야 일치', () => {
    const unit = (u: string, head: string, more: Partial<LedgerEntry> = {}) =>
      shadow('u', head, { export: u, ...more })
    const fate = (u: string, head: string, more: Partial<LedgerEntry> = {}) =>
      unit(u, head, { merged_head: head, by: 'human', condition: null, ...more })
    // 내보내기 둘이 각자 조건을 채운 head 그대로 머지됨: Work 하나, 일치 하나
    const both = [unit('csv', 'a'), unit('money', 'b'), fate('csv', 'a'), fate('money', 'b')]
    expect(trackRecord(both, 'p1', 1, NOW)).toEqual({ small: true })
    expect(trackRecord(both, 'p1', 2, NOW)).toEqual({ small: false })
    // 하나가 더 커밋해 머지됨: 그 Work는 불일치
    const moved = [unit('csv', 'a'), unit('money', 'b'), fate('csv', 'a'), fate('money', 'c')]
    expect(trackRecord([...matches(19), ...moved], 'p1', 1, NOW)).toEqual({ small: true })
    expect(trackRecord([...matches(18), ...moved], 'p1', 1, NOW)).toEqual({ small: false })
    // 하나가 아직 열렸거나 정책이 머지함: 세지 않는다
    expect(
      trackRecord([unit('csv', 'a'), unit('money', 'b'), fate('csv', 'a')], 'p1', 0, NOW),
    ).toEqual({})
    const policy = [...both.slice(0, 3), fate('money', 'b', { by: 'policy' })]
    expect(trackRecord(policy, 'p1', 0, NOW)).toEqual({})
    // 조건을 채우지 않은 내보내기의 끝은 그 조건에 들지 않는다
    const one = [
      unit('csv', 'a'),
      fate('csv', 'a'),
      unit('money', 'b', { closed: true, condition: null }),
    ]
    expect(trackRecord(one, 'p1', 1, NOW)).toEqual({ small: true })
    // 내보내기의 끝은 내보내기마다: Work 브랜치의 머지(export 없음)는 단위 브랜치의 끝이 아니다
    expect(trackRecord([unit('csv', 'a'), merged('u', 'a')], 'p1', 0, NOW)).toEqual({})
  })

  test('조건마다 따로 잰다', () => {
    const big = [shadow('q', 'h', { condition: 'docs' }), shadow('q', 'h', { closed: true })]
    expect(trackRecord([...matches(20), ...big], 'p1', 20, NOW)).toEqual({
      small: true,
      docs: false,
    })
  })
})

describe('판 열쇠 (M4a)', () => {
  test('claudeMinor: major.minor만, 못 읽으면 null', () => {
    expect(claudeMinor('2.1.318 (Claude Code)')).toBe('2.1')
    expect(claudeMinor('10.20')).toBe('10.20')
    expect(claudeMinor(' 3.0.1')).toBe('3.0')
    expect(claudeMinor('0.0.0 (가짜 Claude Code)')).toBe('0.0')
    expect(claudeMinor('Claude Code 2.1')).toBeNull()
    expect(claudeMinor('2')).toBeNull()
    expect(claudeMinor(undefined)).toBeNull()
  })

  test('epochKey: 조건마다, 같은 판이면 같고 칸 하나라도 모르면 null', () => {
    expect(epochKey(EPOCH, 'small')).not.toBeNull()
    expect(epochKey(EPOCH, 'small')).toBe(epochKey({ ...EPOCH, claude_version: '2.1.5' }, 'small'))
    expect(epochKey(EPOCH, 'small')).not.toBe(epochKey(EPOCH, 'docs'))
    expect(epochKey(EPOCH, 'missing')).toBeNull()
    expect(epochKey({ ...EPOCH, effort: '' }, 'small')).toBeNull()
    expect(epochKey({ ...EPOCH, claude_version: 'unknown' }, 'small')).toBeNull()
    expect(epochKey({ ...EPOCH, gate_version: 0 }, 'small')).toBeNull()
  })
})

describe('parseLedger', () => {
  test('줄마다 JSON, 빈 줄·깨진 줄·모양이 다른 줄은 건너뛴다', () => {
    const a = shadow('w', 'h')
    const b = merged('w', 'h')
    const text = [
      JSON.stringify(a),
      '',
      '{"ts": "2026-11-04", "project": ',
      JSON.stringify({ ...a, conclusion: 'merge' }),
      JSON.stringify({ ...a, by: 'robot' }),
      JSON.stringify({ ...a, relay_version: undefined }),
      JSON.stringify({ ...a, export: 3 }),
      '[1,2]',
      JSON.stringify(b) + '\r',
    ].join('\n')
    expect(parseLedger(text)).toEqual([a, b])
  })

  test('M4a 칸을 읽고, 모양이 다르면 그 줄을 버린다(옛 줄은 그대로 읽힌다)', () => {
    const line = shadow('w', 'h', {
      met: ['small', 'docs'],
      model_requested: 'default',
      relay_build: 'abc123',
      pr: 7,
      base_sha: 'b'.repeat(40),
      approved_by: 'human',
    })
    const old: LedgerEntry = {
      ts: '2026-11-01T00:00:00Z',
      project: 'p1',
      work: 'w',
      head: 'h',
      conclusion: 'human_merge',
      condition: 'small',
      shadow: true,
      relay_version: '0.0.0',
    }
    const bad = [
      { met: 'small' },
      { met: [1] },
      { conds: ['x'] },
      { conds: { small: 3 } },
      { gate_version: '1' },
      { review_prompt: Number.NaN },
      { model_observed: 1 },
      { effort: false },
      { pr: '7' },
      { base_sha: null },
      { approved_by: 'robot' },
    ]
    const text = [line, old, ...bad.map((b) => ({ ...line, ...b }))]
      .map((e) => JSON.stringify(e))
      .join('\n')
    expect(parseLedger(text)).toEqual([line, old])
  })

  test('빈 글은 빈 장부', () => {
    expect(parseLedger('')).toEqual([])
  })
})

describe('acceptedUnrecorded (M3b)', () => {
  const accepted = (work: string, debt: string[], more: Partial<LedgerEntry> = {}) =>
    shadow(work, 'h', {
      merged_head: 'h',
      by: 'human',
      condition: null,
      shadow: false,
      accepted: { ratchets: ['file-size'], debt },
      ...more,
    })

  test('내보내기마다 마지막으로 받아들인 줄의 빚이 비면 하나로 센다', () => {
    const entries = [
      accepted('a', []),
      accepted('b', ['r-file-size-src-a-js']),
      // 같은 내보내기를 다시 받아들이면 마지막 것: 기록 없이 끝냈다가 앱 밖에서 머지됨
      accepted('c', ['r-file-size-src-a-js']),
      accepted('c', []),
      // 단위가 다르면 다른 내보내기다(V22)
      accepted('d', [], { export: 'api' }),
      accepted('d', [], { export: 'ui' }),
      // 받아들인 것이 없는 줄과 다른 프로젝트는 세지 않는다
      merged('e', 'h'),
      accepted('f', [], { project: 'p2' }),
    ]
    expect(acceptedUnrecorded(entries, 'p1')).toBe(4)
    expect(acceptedUnrecorded(entries, 'p2')).toBe(1)
    expect(acceptedUnrecorded([], 'p1')).toBe(0)
  })

  test('accepted와 worse 칸을 읽고, 모양이 다르면 그 줄을 버린다', () => {
    const worse = [
      { id: 'tests', status: 'worse' as const, base: 3, head: 2, detail: '시험 수 3 → 2' },
    ]
    const good = accepted('a', ['x'], { worse })
    const text = [
      JSON.stringify(good),
      JSON.stringify({ ...good, accepted: { ratchets: 'file-size', debt: [] } }),
      JSON.stringify({ ...good, accepted: { ratchets: [], debt: [1] } }),
      JSON.stringify({ ...good, worse: 'file-size' }),
    ].join('\n')
    expect(parseLedger(text)).toEqual([good])
  })
})

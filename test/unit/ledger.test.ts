// [단위] 실적 장부(그림자): 일치·불일치, 버전이 바뀌면 다시 잼, 장부 읽기
import { describe, expect, test } from 'vitest'
import { parseLedger, trackRecord, type LedgerEntry } from '../../src/core/ledger.ts'

const NOW = { model: 'opus', claude_version: '2.1.300', relay_version: '0.1.0' }

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

  test('모델·Claude Code·relay 버전이 지금과 다른 결론은 세지 않는다(머지 기록의 버전은 상관없음)', () => {
    const old = matches(20)
    for (const field of ['model', 'claude_version', 'relay_version'] as const) {
      expect(trackRecord(old, 'p1', 20, { ...NOW, [field]: 'new' })).toEqual({})
    }
    const decidedNow = Array.from({ length: 20 }, (_, i) => [
      shadow(`w${i}`, `h${i}`),
      { ...merged(`w${i}`, `h${i}`), relay_version: '0.2.0' },
    ]).flat()
    expect(trackRecord(decidedNow, 'p1', 20, NOW)).toEqual({ small: true })
  })

  test('조건마다 따로 잰다', () => {
    const big = [shadow('q', 'h', { condition: 'docs' }), shadow('q', 'h', { closed: true })]
    expect(trackRecord([...matches(20), ...big], 'p1', 20, NOW)).toEqual({
      small: true,
      docs: false,
    })
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
      '[1,2]',
      JSON.stringify(b) + '\r',
    ].join('\n')
    expect(parseLedger(text)).toEqual([a, b])
  })

  test('빈 글은 빈 장부', () => {
    expect(parseLedger('')).toEqual([])
  })
})

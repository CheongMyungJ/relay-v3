// [단위] 실적 장부(그림자): 일치·불일치, 버전이 바뀌면 다시 잼, Work를 조건마다 한 건으로(V22 내보내기), 장부 읽기,
// 받아들였지만 빚으로 기록하지 않은 나빠짐의 수(M3b)
import { describe, expect, test } from 'vitest'
import {
  acceptedUnrecorded,
  parseLedger,
  trackRecord,
  type LedgerEntry,
} from '../../src/engine/ledger.ts'

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

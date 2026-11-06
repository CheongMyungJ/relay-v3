// [단위] 끝까지 따라가기의 순수한 셈(M4b, docs/m4-design.md 4절): 같은 변경(sameChange)의 다섯 경우, 끝이 정해지지 않은
// 내보내기 고르기(unsettled), 90일, 그리고 실적(trackRecord)이 M4b 끝 줄(same_change, ended)을 읽는 것
import { describe, expect, test } from 'vitest'
import {
  isConclusionLine,
  lastConclusion,
  noPrExpired,
  sameChange,
  unsettled,
  type ChangeFacts,
} from '../../src/engine/follow.ts'
import { GATE_VERSION } from '../../src/engine/gate-version.ts'
import { parseLedger, type EpochSource, type LedgerEntry } from '../../src/engine/ledger.ts'
import { trackRecord } from '../../src/engine/shadow.ts'

const facts = (over: Partial<ChangeFacts> = {}): ChangeFacts => ({
  head: 'h',
  merged: 'm',
  ancestor: null,
  between: null,
  patch: { head: null, merged: null },
  ...over,
})

const commit = (author: string, baseUpdate = false, relay = false) => ({
  sha: 'c',
  author,
  baseUpdate,
  relay,
})

describe('sameChange', () => {
  test('(1) 같은 SHA면 같다(거울 없이)', () => {
    expect(sameChange(facts({ merged: 'h' }))).toBe(true)
  })

  test('(2) 사이 커밋이 깨끗한 기준 맞춤 머지(Update branch)나 relay 빚 커밋뿐이면 같다', () => {
    const between = [commit('x@example.com', true), commit('relay@localhost', false, true)]
    expect(sameChange(facts({ ancestor: true, between }))).toBe(true)
    // 작성자만 relay@localhost인 커밋(앱이 적은 빚 커밋이 아님: 세션도 그 작성자로 커밋할 수 있다)은 빚 커밋이 아니다
    const forged = [commit('relay@localhost')]
    expect(sameChange(facts({ ancestor: true, between: forged }))).toBe(false)
  })

  test('(3) 조상이 아니어도(rebase, squash) patch-id가 같으면 같다', () => {
    const patch = { head: 'p1', merged: 'p1' }
    expect(sameChange(facts({ ancestor: false, patch }))).toBe(true)
    // 사이에 사람 커밋이 있어도 변경이 같으면(되돌린 커밋 등) 같다
    const between = [commit('me@example.com')]
    expect(sameChange(facts({ ancestor: true, between, patch }))).toBe(true)
  })

  test('(4) 사이에 다른 커밋이 있거나 patch-id가 다르면 다르다(더 커밋)', () => {
    expect(sameChange(facts({ ancestor: true, between: [commit('me@example.com', false)] }))).toBe(
      false,
    )
    // 충돌을 손으로 푼 맞춤 머지(tree가 merge-tree와 다름)는 기준 맞춤이 아니다
    expect(sameChange(facts({ ancestor: false, patch: { head: 'p1', merged: 'p2' } }))).toBe(false)
  })

  test('(5) 객체를 못 읽으면 모름(null)', () => {
    expect(sameChange(facts())).toBeNull()
    expect(sameChange(facts({ ancestor: false, patch: { head: 'p1', merged: null } }))).toBeNull()
    // 사이 커밋이 너무 많아 읽지 않음
    expect(sameChange(facts({ ancestor: true, between: null }))).toBeNull()
  })
})

const EPOCH: Required<EpochSource> = {
  conds: { small: 'a1b2c3d4e5f6' },
  model_observed: 'model-a',
  effort: 'medium',
  claude_version: '2.1.300 (Claude Code)',
  gate_version: GATE_VERSION,
  review_prompt: 4,
}

function line(work: string, head: string, more: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    ts: '2026-11-04T00:00:00Z',
    project: 'p1',
    work,
    head,
    conclusion: 'human_merge',
    condition: 'small',
    shadow: true,
    relay_version: '0.1.0',
    ...EPOCH,
    ...more,
  }
}

/** 끝 줄(결론 칸은 비움) */
const fate = (work: string, head: string, more: Partial<LedgerEntry>) =>
  line(work, head, { condition: null, shadow: false, ...more })

describe('unsettled', () => {
  test('결론 줄이 있고 끝 줄이 없는 내보내기만, 마지막 결론 줄과 첫 때, PR 없이 끝난 때를 함께', () => {
    const entries = [
      line('w1', 'a', { ts: '2026-11-01T00:00:00Z' }),
      line('w1', 'b', { ts: '2026-11-02T00:00:00Z' }),
      line('w2', 'c'),
      fate('w2', 'c', { by: 'human', merged_head: 'c' }),
      line('w3', 'd'),
      fate('w3', 'd', { ended: 'no_pr', ts: '2026-11-05T00:00:00Z' }),
      line('w4', 'e'),
      fate('w4', 'e', { ended: 'discarded' }),
      line('w5', 'f', { export: 'u1' }),
      line('w5', 'g', { export: 'u2' }),
      fate('w5', 'g', { export: 'u2', closed: true }),
      // 받아들임 줄(M3b)은 결론 줄도 끝 줄도 아니다
      fate('w6', 'h', { accepted: { ratchets: ['r'], debt: [] } }),
      line('w7', 'i', { project: 'p2' }),
    ]
    const u = unsettled(entries, 'p1')
    expect(u.map((x) => [x.work, x.export, x.last.head, x.since, x.noPrAt])).toEqual([
      ['w1', null, 'b', '2026-11-01T00:00:00Z', null],
      ['w3', null, 'd', '2026-11-04T00:00:00Z', '2026-11-05T00:00:00Z'],
      ['w5', 'u1', 'f', '2026-11-04T00:00:00Z', null],
    ])
    expect(lastConclusion(entries, 'w1', null)?.head).toBe('b')
    expect(lastConclusion(entries, 'w5', 'u2')?.head).toBe('g')
    expect(isConclusionLine(entries[3] as LedgerEntry)).toBe(false)
  })

  test('PR 없이 끝난 뒤 90일이 지났나(때를 읽지 못하면 거짓)', () => {
    expect(noPrExpired('2026-01-01T00:00:00Z', '2026-03-31T23:59:59Z')).toBe(false)
    expect(noPrExpired('2026-01-01T00:00:00Z', '2026-04-01T00:00:01Z')).toBe(true)
    expect(noPrExpired('?', '2026-04-01T00:00:00Z')).toBe(false)
  })
})

describe('trackRecord가 M4b 끝 줄을 읽는다', () => {
  const merged = (work: string, head: string, merged_head: string, same: boolean | null) =>
    fate(work, head, { by: 'human-override', merged_head, same_change: same })

  test('같은 변경(Update branch 뒤 머지)은 일치, 모름과 다름은 불일치', () => {
    expect(trackRecord([line('w', 'h'), merged('w', 'h', 'u', true)], 'p1', 1, EPOCH)).toEqual({
      small: true,
    })
    expect(trackRecord([line('w', 'h'), merged('w', 'h', 'u', null)], 'p1', 1, EPOCH)).toEqual({
      small: false,
    })
    expect(trackRecord([line('w', 'h'), merged('w', 'h', 'u', false)], 'p1', 1, EPOCH)).toEqual({
      small: false,
    })
    // 같은 변경은 끝 줄의 head(마지막 결론 줄)에 대해서다: 앞 head는 merged_head와 같아야 일치
    const twice = [line('w', 'a'), line('w', 'h'), merged('w', 'h', 'u', true)]
    expect(trackRecord(twice, 'p1', 1, EPOCH)).toEqual({ small: false })
  })

  test('버림과 90일 동안 기준에 닿지 않음은 불일치, PR 없이 끝나 아직 모름은 세지 않음', () => {
    const ended = (e: LedgerEntry['ended']) => [line('w', 'h'), fate('w', 'h', { ended: e })]
    expect(trackRecord(ended('discarded'), 'p1', 0, EPOCH)).toEqual({ small: false })
    expect(trackRecord(ended('unmerged'), 'p1', 0, EPOCH)).toEqual({ small: false })
    expect(trackRecord(ended('no_pr'), 'p1', 0, EPOCH)).toEqual({})
    // PR 없이 끝난 뒤 로컬에서 기준에 합침(human-override 머지)은 일치
    const local = [...ended('no_pr'), merged('w', 'h', 'h', true)]
    expect(trackRecord(local, 'p1', 1, EPOCH)).toEqual({ small: true })
    // 머지는 뒤의 끝 줄에 지지 않는다
    expect(trackRecord([...local, fate('w', 'h', { ended: 'unmerged' })], 'p1', 1, EPOCH)).toEqual({
      small: true,
    })
  })
})

describe('parseLedger의 M4b 칸', () => {
  const text = (over: Record<string, unknown>) => JSON.stringify({ ...fate('w', 'h', {}), ...over })

  test('끝 줄의 칸을 읽고, 모양이 다르면 그 줄을 버린다', () => {
    const ok = {
      ended: 'no_pr',
      merge_commit: 'abc',
      merged_at: '2026-11-05T00:00:00Z',
      same_change: null,
    }
    expect(parseLedger(text(ok))).toMatchObject([ok])
    expect(parseLedger(text({ same_change: true }))).toHaveLength(1)
    for (const bad of [
      { ended: 'gone' },
      { merge_commit: 1 },
      { merged_at: false },
      { same_change: 'yes' },
    ])
      expect(parseLedger(text(bad))).toEqual([])
  })
})

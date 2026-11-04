// [단위] Work 상태 기계 (docs/m2-modules.md 1절 work.ts)
import { describe, expect, test } from 'vitest'
import type { Contract } from '../../src/core/types.ts'
import { canMerge, nextState, type WorkEvent, type WorkState } from '../../src/core/work.ts'

const contract: Contract = {
  version: 1,
  id: 'k1',
  goal: 'g',
  lines: [],
  non_goals: [],
  human_rules: [],
  examples: [],
  tidy: [],
}

const EVENTS: Record<WorkEvent['type'], WorkEvent> = {
  contract_submitted: { type: 'contract_submitted', contract },
  contract_approved: { type: 'contract_approved', contract, by: 'human', at: '2026-11-04T00:00Z' },
  contract_changes_asked: { type: 'contract_changes_asked', message: '예시를 더' },
  change_requested: { type: 'change_requested', reason: '범위가 넓음' },
  change_answered: { type: 'change_answered', approved: true, contract, message: '좋음' },
  pr_merged: { type: 'pr_merged' },
  pr_closed: { type: 'pr_closed' },
  ended: { type: 'ended' },
  abandoned: { type: 'abandoned' },
}

const STATES: WorkState[] = [
  'drafting',
  'awaiting_approval',
  'working',
  'recontract',
  'done',
  'abandoned',
]

/** 허용된 전이 전부. 여기에 없는 (상태, 사건)은 오류여야 한다 */
const ALLOWED: [WorkState, WorkEvent['type'], WorkState][] = [
  ['drafting', 'contract_submitted', 'awaiting_approval'],
  ['awaiting_approval', 'contract_submitted', 'awaiting_approval'],
  ['awaiting_approval', 'contract_approved', 'working'],
  ['awaiting_approval', 'contract_changes_asked', 'drafting'],
  ['working', 'change_requested', 'recontract'],
  ['recontract', 'change_requested', 'recontract'],
  ['recontract', 'change_answered', 'working'],
  ['working', 'ended', 'done'],
  ['recontract', 'ended', 'done'],
  ...(['drafting', 'awaiting_approval', 'working', 'recontract'] as const).flatMap(
    (s): [WorkState, WorkEvent['type'], WorkState][] => [
      [s, 'pr_merged', 'done'],
      [s, 'pr_closed', 'done'],
      [s, 'abandoned', 'abandoned'],
    ],
  ),
]

describe('nextState', () => {
  test('한 Work의 생애: 초안 → 고쳐 달라고 함 → 다시 제출 → 승인 → 계약 바꾸기 → 답 → 머지', () => {
    const steps: WorkEvent['type'][] = [
      'contract_submitted',
      'contract_changes_asked',
      'contract_submitted',
      'contract_approved',
      'change_requested',
      'change_answered',
      'pr_merged',
    ]
    let s: WorkState = 'drafting'
    const seen: WorkState[] = []
    for (const t of steps) {
      const r = nextState(s, EVENTS[t])
      if (!r.ok) throw new Error(r.errors.join())
      s = r.value
      seen.push(s)
    }
    expect(seen).toEqual([
      'awaiting_approval',
      'drafting',
      'awaiting_approval',
      'working',
      'recontract',
      'working',
      'done',
    ])
  })

  test.each(ALLOWED)('%s + %s → %s', (from, ev, to) => {
    expect(nextState(from, EVENTS[ev])).toEqual({ ok: true, value: to })
  })

  test('나머지 (상태, 사건)은 모두 오류이고 까닭을 한국어로 적는다', () => {
    const allowed = new Set(ALLOWED.map(([s, e]) => `${s} ${e}`))
    let rejected = 0
    for (const s of STATES)
      for (const ev of Object.values(EVENTS)) {
        if (allowed.has(`${s} ${ev.type}`)) continue
        const r = nextState(s, ev)
        expect(r.ok, `${s} ${ev.type}`).toBe(false)
        if (!r.ok) expect(r.errors[0]).toMatch(/상태에서는 .+을\(를\) 받을 수 없음/)
        rejected++
      }
    expect(rejected).toBe(STATES.length * Object.keys(EVENTS).length - ALLOWED.length)
  })

  test('끝난 Work는 어떤 사건도 받지 않는다', () => {
    for (const s of ['done', 'abandoned'] as const)
      for (const ev of Object.values(EVENTS)) expect(nextState(s, ev).ok).toBe(false)
  })

  test('승인 전에 구현 중으로 건너뛰지 않는다', () => {
    expect(nextState('drafting', EVENTS.contract_approved)).toEqual({
      ok: false,
      errors: ['계약 초안 상태에서는 계약 승인을(를) 받을 수 없음'],
    })
  })
})

describe('canMerge', () => {
  test('구현 중일 때만', () => {
    expect(STATES.filter(canMerge)).toEqual(['working'])
  })
})

// Work의 상태 기계 (docs/m2-modules.md 1절 work.ts, docs/m2-app.md 1절). 순수 함수다.
// drafting(계약 초안) → awaiting_approval(사람의 답을 기다림) → working(자율 구현) ⇄ recontract(계약 바꾸기 요청)
// → done(머지·닫힘·[끝]) 또는 abandoned(버림). 끝난 Work는 어떤 사건도 받지 않는다.

import { err, ok, type Result } from './result.ts'
import type { Contract } from './types.ts'

export type WorkState =
  'drafting' | 'awaiting_approval' | 'working' | 'recontract' | 'done' | 'abandoned'

export type SessionState = 'starting' | 'running' | 'idle' | 'stopped'

export type WorkEvent =
  /** 유효한 계약만. 기다리는 동안 다시 내면(재개 뒤) 그 계약으로 바꾼다 */
  | { type: 'contract_submitted'; contract: Contract }
  | { type: 'contract_approved'; contract: Contract; by: 'human' | 'caller'; at: string }
  /** 사람이 고쳐 달라고 함 → drafting */
  | { type: 'contract_changes_asked'; message: string }
  /** 세션이 계약 바꾸기를 요청함 → recontract */
  | { type: 'change_requested'; reason: string }
  /** 사람이 계약 바꾸기 요청에 답함(받아들임·거절) → working */
  | { type: 'change_answered'; approved: boolean; contract?: Contract; message: string }
  | { type: 'pr_merged' }
  | { type: 'pr_closed' }
  /** 사람이 [끝]을 누름 */
  | { type: 'ended' }
  | { type: 'abandoned' }

type EventType = WorkEvent['type']

const ACTIVE: readonly WorkState[] = ['drafting', 'awaiting_approval', 'working', 'recontract']

/** 사건마다 받을 수 있는 상태와 그 뒤 상태. PR의 머지·닫힘은 바깥의 사실이라 끝나지 않은 어느 상태에서나 받는다 */
const TRANSITIONS: Record<EventType, { from: readonly WorkState[]; to: WorkState }> = {
  contract_submitted: { from: ['drafting', 'awaiting_approval'], to: 'awaiting_approval' },
  contract_approved: { from: ['awaiting_approval'], to: 'working' },
  contract_changes_asked: { from: ['awaiting_approval'], to: 'drafting' },
  change_requested: { from: ['working', 'recontract'], to: 'recontract' },
  change_answered: { from: ['recontract'], to: 'working' },
  pr_merged: { from: ACTIVE, to: 'done' },
  pr_closed: { from: ACTIVE, to: 'done' },
  ended: { from: ['working', 'recontract'], to: 'done' },
  abandoned: { from: ACTIVE, to: 'abandoned' },
}

const STATE_NAME: Record<WorkState, string> = {
  drafting: '계약 초안',
  awaiting_approval: '승인 기다림',
  working: '구현 중',
  recontract: '계약 다시',
  done: '끝남',
  abandoned: '버림',
}

const EVENT_NAME: Record<EventType, string> = {
  contract_submitted: '계약 제출',
  contract_approved: '계약 승인',
  contract_changes_asked: '계약 고쳐 달라고 함',
  change_requested: '계약 바꾸기 요청',
  change_answered: '계약 바꾸기 답',
  pr_merged: 'PR 머지',
  pr_closed: 'PR 닫힘',
  ended: '끝',
  abandoned: '버림',
}

/** 사건을 받은 뒤의 상태. 허용되지 않은 전이는 오류다 */
export function nextState(state: WorkState, ev: WorkEvent): Result<WorkState> {
  const t = TRANSITIONS[ev.type]
  if (!t.from.includes(state))
    return err(`${STATE_NAME[state]} 상태에서는 ${EVENT_NAME[ev.type]}을(를) 받을 수 없음`)
  return ok(t.to)
}

/** [머지]는 구현 중일 때만 (계약 다시·승인 전·끝난 Work는 머지하지 않는다) */
export function canMerge(state: WorkState): boolean {
  return state === 'working'
}

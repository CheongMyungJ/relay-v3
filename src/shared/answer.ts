// 사람의 답이 필요한 Work인가 (V78). 메인의 독 배지·OS 알림(src/main/attention.ts)과 렌더러의 사이드바·탭의 점이 같은 판정을
// 쓴다: 규칙이 바뀌어도 배지의 수와 화면이 어긋나지 않게 여기 한 곳에만 둔다. 순수 함수만 둔다.

import type { WorkView } from './api.ts'

/** 답이 필요한 까닭: 계약 승인, 세션이 낸 계약 바꾸기, [끝내기]의 상자 */
export type AnswerReason = 'approval' | 'change' | 'end'

/** [끝내기]의 상자(V25)를 보일 때: 구현 중이고 지금 HEAD에 열린 것이 있는 상자가 있다(메인이 work.json에 둔다) */
export function showEndBox(v: WorkView): boolean {
  const ending = v.state === 'working' || v.state === 'recontract'
  return ending && v.endPending?.armed === false && v.endPending.handed !== true
}

/** 답이 필요한 까닭. 없으면 null. 계약을 다시 맞추는 동안 상자가 떠 있어도 계약이 먼저다 */
export function answerReason(v: WorkView): AnswerReason | null {
  if (v.state === 'awaiting_approval') return 'approval'
  if (v.state === 'recontract') return 'change'
  return showEndBox(v) ? 'end' : null
}

export const needsAnswer = (v: WorkView): boolean => answerReason(v) !== null

// 사람의 답이 필요해진 Work를 알린다 (V78, docs/m2-modules.md 3절): 승인을 기다림, 계약을 바꾸자고 함, [끝내기]의 상자가 뜸.
// 답이 필요한가는 화면과 같은 판정(src/shared/answer.ts)을 쓴다. 같은 까닭으로 두 번 알리지 않는다(Work가 바뀔 때마다 이벤트가
// 오므로). Electron을 모른다: index.ts가 OS 알림과 독 배지로 쓴다.

import { answerReason, type AnswerReason } from '../shared/answer.ts'
import type { WorkView } from '../shared/api.ts'

export interface Attention {
  id: string
  title: string
  body: string
}

const TITLE: Record<AnswerReason, string> = {
  approval: '계약이 승인을 기다립니다',
  change: '세션이 계약을 바꾸자고 합니다',
  end: '끝내기 전에 볼 것이 있습니다',
}

export class AttentionWatch {
  private last = new Map<string, AnswerReason | null>()
  private primed = false

  /**
   * 앱을 켜고 Work를 다 읽은 뒤 한 번 부른다. 그 전에 온 것(Works.init이 Work마다 내는 이벤트)과 여기서 받은 것은 이미 답을
   * 기다리던 Work라 알리지 않는다
   */
  prime(views: WorkView[]): void {
    for (const v of views) this.last.set(v.id, answerReason(v))
    this.primed = true
  }

  /** Work가 바뀔 때마다 부른다. 답이 필요한 까닭이 새로 생겼으면 알릴 글, 아니면 null. prime 전에는 적어 두기만 한다 */
  note(v: WorkView): Attention | null {
    const now = answerReason(v)
    const before = this.last.get(v.id) ?? null
    this.last.set(v.id, now)
    if (!this.primed || now === null || now === before) return null
    return { id: v.id, title: TITLE[now], body: v.title }
  }

  /** 이 Work가 지금 답을 기다리는가(마지막으로 본 모습) */
  waiting(id: string): boolean {
    return (this.last.get(id) ?? null) !== null
  }

  /** 답이 필요한 Work의 수(독 배지) */
  count(): number {
    let n = 0
    for (const x of this.last.values()) if (x !== null) n++
    return n
  }
}

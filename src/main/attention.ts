// 사람의 답이 필요해진 Work를 알린다 (V78, docs/m2-modules.md 3절): 승인을 기다림, 계약을 바꾸자고 함, [끝내기]의 상자가 뜸.
// 같은 까닭으로 두 번 알리지 않는다(Work가 바뀔 때마다 이벤트가 오므로). Electron을 모른다: index.ts가 OS 알림과 독 배지로 쓴다.

import type { WorkView } from '../shared/api.ts'

export interface Attention {
  id: string
  title: string
  body: string
}

/** 답이 필요한 까닭. 없으면 null */
export function attentionOf(v: WorkView): 'approval' | 'change' | 'end' | null {
  if (v.state === 'awaiting_approval') return 'approval'
  if (v.state === 'recontract') return 'change'
  const p = v.endPending
  if (v.state === 'working' && p !== null && !p.armed && p.handed !== true) return 'end'
  return null
}

const TITLE = {
  approval: '계약이 승인을 기다립니다',
  change: '세션이 계약을 바꾸자고 합니다',
  end: '끝내기 전에 볼 것이 있습니다',
} as const

export class AttentionWatch {
  private last = new Map<string, string | null>()

  /** 앱을 켤 때 이미 답을 기다리던 Work는 알리지 않는다 */
  prime(views: WorkView[]): void {
    for (const v of views) this.last.set(v.id, attentionOf(v))
  }

  /** Work가 바뀔 때마다 부른다. 답이 필요한 까닭이 새로 생겼으면 알릴 글, 아니면 null */
  note(v: WorkView): Attention | null {
    const now = attentionOf(v)
    const before = this.last.get(v.id) ?? null
    this.last.set(v.id, now)
    if (now === null || now === before) return null
    return { id: v.id, title: TITLE[now], body: v.title }
  }

  /** 답이 필요한 Work의 수(독 배지) */
  count(): number {
    let n = 0
    for (const x of this.last.values()) if (x !== null) n++
    return n
  }
}

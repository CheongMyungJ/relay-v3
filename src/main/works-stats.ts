// 실적을 보이기 (M4c, docs/m4-design.md 5.2). 설정 대화상자의 [실적](engine/shadow.ts recordStats), [증거]의 그림자 줄(Q6: 끝이
// 정해질 때까지 가리고 끝난 뒤 '그림자 표본: 일치·불일치'), [귀속이 틀림](M4d의 이의: 장부에 dispute 줄). 장부를 읽기만 하고
// dispute 줄만 덧붙인다. 진행 막대·남은 주·알림은 만들지 않는다(philosophy 6장).

import type { DisputeLine } from '../engine/after-merge.ts'
import { recordStats, shadowEnds } from '../engine/shadow.ts'
import type { AfterEvent, RecordStats, ShadowEnd } from '../shared/api.ts'
import type { Store } from './store.ts'

export interface RecordDeskDeps {
  store: Pick<Store, 'readRecord' | 'appendLedger'>
  now: () => string
}

export class RecordDesk {
  private readonly deps: RecordDeskDeps

  constructor(deps: RecordDeskDeps) {
    this.deps = deps
  }

  /** 이 프로젝트의 [실적]: 지금 판(마지막 결론 줄의 판) 또는 모든 판 */
  async record(projectId: string, allEpochs: boolean): Promise<RecordStats> {
    const r = await this.deps.store.readRecord()
    return recordStats({
      entries: r.entries,
      after: r.after,
      disputes: r.disputes,
      scope: { project: projectId },
      now: this.deps.now(),
      allEpochs,
      broken: r.broken,
    })
  }

  /** 이 Work의 내보내기마다 그림자 표본의 끝(끝이 정해진 것만) */
  async shadowEnds(workId: string): Promise<ShadowEnd[]> {
    return shadowEnds((await this.deps.store.readRecord()).entries, workId)
  }

  /**
   * [귀속이 틀림]: 장부의 after 줄에 귀속된 사건(되돌림, 귀속 main 실패)이 있는 머지에만 이의를 단다. 이미 단 이의는 다시 쓰지
   * 않는다. 사건이 없으면 던진다
   */
  async dispute(projectId: string, mergeCommit: string, event: AfterEvent['event']): Promise<void> {
    const r = await this.deps.store.readRecord()
    const has = r.after.some(
      (a) =>
        a.project === projectId &&
        a.merge_commit === mergeCommit &&
        (event === 'revert' ? a.revert !== null : a.main === 'attributed'),
    )
    if (!has) throw new Error(`귀속된 사건이 없음: ${mergeCommit} (${event})`)
    const already = r.disputes.some(
      (d) => d.project === projectId && d.merge_commit === mergeCommit && d.event === event,
    )
    if (already) return
    const line: DisputeLine = {
      kind: 'dispute',
      ts: this.deps.now(),
      project: projectId,
      merge_commit: mergeCommit,
      event,
    }
    await this.deps.store.appendLedger(line)
  }
}

// 화면에 보내는 Work (docs/m2-modules.md 3절 shared/api.ts의 WorkView). works.ts가 600줄을 넘지 않게 나눴다.
// one_branch는 Work 브랜치의 내보내기를 위 칸들(evidence, gate, pr, feedback)에 둔다. branch_per_unit(V22)은 위 칸들이 Work
// 브랜치의 통합 증거(관문·PR 없음)이고, 단위 브랜치의 내보내기는 exports에 하나씩, 통합 증거의 열린 것은 integration에 둔다.

import { openItems } from '../core/gate.ts'
import type { ExportView, WorkView } from '../shared/api.ts'
import type { ExportRecord, WorkRecord } from './store.ts'
import type { FeedbackDesk } from './works-feedback.ts'
import { isActive, perUnit, type WorkCtx } from './works-types.ts'

export function workView(ctx: WorkCtx, rec: WorkRecord, feedback: FeedbackDesk): WorkView {
  const rt = ctx.runtime(rec.id)
  const units = perUnit(rec)
  const main = units ? null : (rec.exports[0] ?? null)
  const evidence = rt.bundles.get(rec.branch) ?? null
  return {
    id: rec.id,
    project: rec.project,
    title: rec.title,
    state: rec.state,
    session: rt.session,
    branch: rec.branch,
    base: rec.base,
    contract: rt.contract,
    pendingContract: rec.pending_contract,
    pendingChange: rec.pending_change,
    evidence,
    gate: main?.gate ?? null,
    pr: main?.pr ?? null,
    evidenceRunning: rt.evidenceRunning,
    reviewRunning: rt.reviewRunning,
    reviewDisabled: ctx.deps.reviewDisabled === true,
    contractId: rec.contract_id,
    hint: rec.hint,
    groundings: rec.groundings,
    head: rt.head,
    createdAt: rec.created_at,
    error: rec.error,
    ...endView(ctx, rec),
    endMemos: rec.state === 'done' ? rec.end_memos : [],
    feedback: feedback.view(rec),
    exports: units ? rec.exports.flatMap((x) => exportView(ctx, rec, x, feedback)) : [],
    // 통합 칸의 열린 것: 마지막 재기의 커밋이 Work 브랜치에 다 있지 않은 단위 브랜치와 묶음의 열린 것(리뷰 빼고)
    integration:
      units && evidence
        ? [...rt.outside, ...openItems(evidence, rt.contract, rt.head, false)]
        : null,
    m3: { ...rec.m3 },
    unrecorded: rec.unrecorded,
  }
}

/** 단위 브랜치의 내보내기 하나(V22). 도는 재기·리뷰는 지금 재는 자리가 그 브랜치일 때만 보인다 */
function exportView(
  ctx: WorkCtx,
  rec: WorkRecord,
  x: ExportRecord,
  feedback: FeedbackDesk,
): ExportView[] {
  if (x.unit === null) return []
  const rt = ctx.runtime(rec.id)
  const here = rt.measuringAt === x.branch
  return [
    {
      unit: x.unit,
      branch: x.branch,
      head: rt.tips[x.branch] ?? null,
      missing: x.branch in rt.tips && rt.tips[x.branch] === null,
      evidence: rt.bundles.get(x.branch) ?? null,
      gate: x.gate,
      pr: x.pr,
      evidenceRunning: rt.evidenceRunning && here,
      reviewRunning: rt.reviewRunning && here,
      feedback: feedback.view(rec, { branch: x.branch, x }),
    },
  ]
}

/** 걸린 끝과 끝내기 상자(V25): 구현 중이고 지금 HEAD의 것만 보인다(HEAD를 모르면 보인다. [그래도 끝내기]가 다시 본다) */
function endView(ctx: WorkCtx, rec: WorkRecord): Pick<WorkView, 'endPending' | 'endMoved'> {
  const rt = ctx.runtime(rec.id)
  const p = rec.end_pending
  const live = isActive(rec.state)
  return {
    endPending: live && p !== null && (rt.head === null || p.head === rt.head) ? p : null,
    endMoved: live ? rt.endMoved : null,
  }
}

// 단위 브랜치의 내보내기(V22, docs/m2-modules.md 4절). DOM을 쓰지 않는 순수 함수만 둔다.
// branch_per_unit이면 [증거]는 Work 브랜치의 통합 증거 한 칸과 내보내기마다 한 칸이다. 내보내기의 칸은 그 내보내기의 증거,
// 관문, PR, 되먹임, 끝으로 바꾼 WorkView로 그린다: 결론, 다음 할 일, 낡음, 지적 같은 글은 one_branch와 같은 함수를 쓴다.

import type { ExportView, WorkView } from '../../shared/api.ts'
import { passableFindings } from './findings.ts'

/** 내보내기 칸의 WorkView: 증거·관문·PR·되먹임·도는 재기와 HEAD(그 단위 브랜치의 끝)를 그 내보내기의 것으로 */
export function exportSection(v: WorkView, x: ExportView): WorkView {
  return {
    ...v,
    evidence: x.evidence,
    gate: x.gate,
    pr: x.pr,
    head: x.head,
    evidenceRunning: x.evidenceRunning,
    reviewRunning: x.reviewRunning,
    feedback: x.feedback,
    exports: [],
    integration: null,
  }
}

/**
 * [끝내기]가 넘기는 화면의 단위 브랜치 끝(V22: 다르면 메인이 끝내지 않는다). 아직 읽지 못한 끝이 있으면 넘기지 않는다
 * (메인이 지금 끝으로 본다). one_branch는 없음
 */
export function endTips(v: Pick<WorkView, 'exports'>): { tips?: Record<string, string | null> } {
  if (v.exports.length === 0 || v.exports.some((x) => x.head === null && !x.missing)) return {}
  return { tips: Object.fromEntries(v.exports.map((x) => [x.branch, x.missing ? null : x.head])) }
}

/**
 * [끝내기] 상자의 [세션에 넘기기]가 보낼 지적(V24): one_branch는 지금 HEAD의 넘길 수 있는 올림, branch_per_unit은 내보내기마다
 * (단위와 함께). 넘길 것이 없는 내보내기는 뺀다
 */
export function passByExport(v: WorkView): { unit?: string; ids: string[] }[] {
  if (v.exports.length === 0) {
    const ids = passableFindings(v)
    return ids.length === 0 ? [] : [{ ids }]
  }
  return v.exports.flatMap((x) => {
    const ids = passableFindings(exportSection(v, x))
    return ids.length === 0 ? [] : [{ unit: x.unit, ids }]
  })
}

/** 통합 증거 칸의 첫 줄: 아직 재지 않음, 열린 것 없음, 열린 것 n개 */
export function integrationText(v: Pick<WorkView, 'evidence' | 'integration'>): string {
  if (v.evidence === null || v.integration === null) return '통합 증거를 아직 재지 않았습니다'
  return v.integration.length === 0
    ? '통합 증거: 열린 것 없음'
    : `통합 증거: 열린 것 ${v.integration.length}개`
}

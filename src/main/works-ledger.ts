// 장부의 판과 내보내기 결론 줄의 M4a 칸 (docs/m4-design.md 3절). works-exports.ts(정책, 장부 줄)와 works-review.ts(리뷰 뒤
// 실적 다시 읽기)가 쓴다. 판 열쇠(engine/ledger.ts epochKey)의 재료는 조건 hash, 리뷰가 본 모델, 세션의 effort, Claude Code
// major.minor, 관문 판, 리뷰 프롬프트 판이다. 지금 판은 정책을 만들 때 그 묶음으로 만든다: 리뷰 앞의 묶음은 리뷰 모델을 모르므로
// 실적이 어떤 판과도 같지 않고(엄격), 리뷰가 끝나면 그 모델로 다시 읽는다(refreshTrack).

import { REVIEW_PROMPT_VERSION } from '../core/review.ts'
import type { Contract, EvidenceBundle, GateResult, Integration, Policy } from '../core/types.ts'
import { GATE_VERSION } from '../engine/gate-version.ts'
import { trackRecord, type EpochSource, type LedgerEntry } from '../engine/ledger.ts'
import { condHashes, conditionsMet } from '../engine/track.ts'
import type { ExportRecord, ProjectRecord, WorkRecord } from './store.ts'
import type { WorkCtx, WorksDeps } from './works-types.ts'

/** 내보내기 결론 줄 하나를 만드는 재료(works-evidence.ts의 리뷰 일감과 같은 꼴) */
export interface ExportJob {
  rec: WorkRecord
  x: ExportRecord
  project: ProjectRecord
  /** 내보내기의 계약(단위 브랜치는 조각) */
  contract: Contract | null
  bundle: EvidenceBundle
  policy: Policy
  whole: Integration | undefined
}

/** 이 Work·묶음·조건의 판(판 열쇠의 재료) */
export function epochOf(
  deps: WorksDeps,
  rec: WorkRecord,
  bundle: EvidenceBundle,
  conditions: Policy['conditions'],
): Required<Pick<EpochSource, 'conds' | 'gate_version' | 'review_prompt'>> & EpochSource {
  const model = bundle.review?.model
  const effort = deps.sessionLog?.effort(rec.id)
  return {
    conds: condHashes(conditions),
    gate_version: GATE_VERSION,
    review_prompt: REVIEW_PROMPT_VERSION,
    ...(model === undefined ? {} : { model_observed: model }),
    ...(effort === undefined ? {} : { effort }),
    ...(deps.claudeVersion ? { claude_version: deps.claudeVersion } : {}),
  }
}

/** 조건마다 지금 판(이 묶음의 판)의 그림자 실적이 기준을 넘었나(관문의 track_record_ok) */
export async function trackFor(
  ctx: WorkCtx,
  rec: WorkRecord,
  project: ProjectRecord,
  conditions: Policy['conditions'],
  bundle: EvidenceBundle,
): Promise<Record<string, boolean>> {
  const ledger = await ctx.deps.store.readLedger()
  const current = epochOf(ctx.deps, rec, bundle, conditions)
  return trackRecord(ledger, project.id, project.settings.min_shadow, current)
}

/**
 * 리뷰가 끝난 묶음의 판으로 정책의 실적을 다시 읽는다(리뷰 모델은 리뷰가 끝나야 안다). 정책은 그 재기의 관문과 내보내기가 함께
 * 쓰는 것이라 그 자리에서 바꾼다(works-evidence.ts가 리뷰 뒤 관문에 같은 정책을 준다)
 */
export async function refreshTrack(
  ctx: WorkCtx,
  rec: WorkRecord,
  project: ProjectRecord,
  policy: Policy,
  bundle: EvidenceBundle,
): Promise<void> {
  // 장부를 읽지 못하면 실적이 없는 것으로 둔다(엄격). 리뷰 결과는 그대로 쓴다
  policy.track_record_ok = await trackFor(ctx, rec, project, policy.conditions, bundle).catch(
    (e: unknown) => {
      ctx.log(`실적을 다시 읽지 못함 (${rec.id})`, e)
      return {}
    },
  )
}

/**
 * 내보내기 결론 줄의 M4a 칸(m4-design 3.1): 채운 조건 전부, 조건 hash, 판 칸, PR·base, 승인 주체. met은 관문이 조건을 채웠을
 * 때만 조건마다 다시 본다(사람에게 보낼 사실이 있으면 모두 condition null이라 빈다). 관문은 그 head가 낡지 않았을 때만 조건을
 * 채우므로 묶음의 head와 통합 증거의 head로 다시 본다
 */
export function epochLine(
  deps: WorksDeps,
  j: ExportJob,
  result: Pick<GateResult, 'condition'>,
): Partial<LedgerEntry> {
  const { rec, x, contract, bundle, policy, whole } = j
  const integration = whole && { ...whole, head: whole.evidence?.head ?? null }
  const met =
    result.condition === null
      ? []
      : conditionsMet(bundle, contract, policy, bundle.head, integration)
  return {
    met,
    ...epochOf(deps, rec, bundle, policy.conditions),
    model_requested: deps.model ?? 'default',
    ...(deps.relayBuild ? { relay_build: deps.relayBuild } : {}),
    ...(x.pr ? { pr: x.pr.number } : {}),
    base_sha: bundle.base,
    ...(contract?.approved_by ? { approved_by: contract.approved_by } : {}),
  }
}

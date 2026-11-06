// 장부의 판과 내보내기 결론 줄의 M4a 칸 (docs/m4-design.md 3절), 장부 한 줄(ledgerEntry). works-exports.ts(정책, 장부 줄),
// works-review.ts(리뷰 뒤 실적 다시 읽기), works-record.ts(끝까지 따라가기, M4b)가 쓴다. 판 열쇠(engine/ledger.ts epochKey)의
// 재료는 조건 hash, 리뷰가 본 모델, 세션의 effort, Claude Code major.minor, 관문 판, 리뷰 프롬프트 판이다. 지금 판은 정책을
// 만들 때 그 묶음으로 만든다: 리뷰 앞의 묶음은 리뷰 모델을 모르므로 실적이 어떤 판과도 같지 않고(엄격), 리뷰가 끝나면 그
// 모델로 다시 읽는다(refreshTrack).

import { REVIEW_PROMPT_VERSION } from '../core/review.ts'
import type { Contract, EvidenceBundle, GateResult, Integration, Policy } from '../core/types.ts'
import { GATE_VERSION } from '../engine/gate-version.ts'
import type { EpochSource, LedgerEntry } from '../engine/ledger.ts'
import { trackRecord } from '../engine/shadow.ts'
import { condHashes, conditionsMet } from '../engine/track.ts'
import type { ExportRecord, ProjectRecord, WorkRecord } from './store.ts'
import type { WorkCtx, WorksDeps } from './works-types.ts'

/** 장부 줄을 쓰는 데 드는 의존(Works와 끝까지 따라가기, works-record.ts) */
export type LedgerDeps = Pick<WorksDeps, 'now' | 'model' | 'claudeVersion' | 'relayVersion'>

/** 장부 줄마다 적는 버전: 모델(deps.model), Claude Code, relay. 판 열쇠는 내보내기 결론 줄의 M4a 칸이다 */
export function versions(deps: LedgerDeps): {
  model?: string
  claude_version?: string
  relay_version: string
} {
  return {
    ...(deps.model ? { model: deps.model } : {}),
    ...(deps.claudeVersion ? { claude_version: deps.claudeVersion } : {}),
    relay_version: deps.relayVersion,
  }
}

/** 장부 한 줄. 단위 브랜치의 내보내기는 그 단위를 적는다(V22: 실적은 Work를 조건마다 한 건으로 센다) */
export function ledgerEntry(
  deps: LedgerDeps,
  rec: Pick<WorkRecord, 'id'>,
  x: Pick<ExportRecord, 'unit'>,
  project: Pick<ProjectRecord, 'id'>,
  head: string,
  result: Pick<GateResult, 'conclusion' | 'condition' | 'shadow'>,
  extra: Partial<LedgerEntry> = {},
): LedgerEntry {
  return {
    ts: deps.now(),
    project: project.id,
    work: rec.id,
    head,
    conclusion: result.conclusion,
    condition: result.condition,
    shadow: result.shadow,
    ...(x.unit === null ? {} : { export: x.unit }),
    ...versions(deps),
    ...extra,
  }
}

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

/** 조건마다 지금 판(이 묶음의 판)의 그림자 실적이 기준을 넘었나(관문의 track_record_ok, engine/shadow.ts) */
export async function trackFor(
  ctx: WorkCtx,
  rec: WorkRecord,
  project: ProjectRecord,
  conditions: Policy['conditions'],
  bundle: EvidenceBundle,
): Promise<Record<string, boolean>> {
  const { entries, after, disputes } = await ctx.deps.store.readRecord()
  const current = epochOf(ctx.deps, rec, bundle, conditions)
  // 이 조건의 머지에 귀속된 되돌림·main 실패(M4d)가 있으면 기준을 넘지 못한다(엄격하게만)
  return trackRecord(entries, project.id, project.settings.min_shadow, current, { after, disputes })
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

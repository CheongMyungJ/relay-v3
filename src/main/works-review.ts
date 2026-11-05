// 독립 리뷰 (V4, V23, docs/m2-modules.md 3절 works.ts의 review와 미리 리뷰). 언제 재는지는 works-evidence.ts가 정하고, 이
// 파일은 리뷰를 부르고 묶음에 붙인다: 기본 구현(claudeReview: 새 맥락의 읽기 전용 claude -p), 내보내기의 리뷰(같은 head·
// 계약의 끝난 리뷰를 다시 씀, 건너뜀), 미리 리뷰(세션이 쉬고 증거가 리뷰 준비인 head, Work마다 4번까지). 리뷰는 (head, 계약
// hash, 프롬프트 판)에 붙는다. 리뷰마다 AbortController를 따로 두고, 읽은 HEAD나 계약이 바뀌면 끊고 버린다. 앱을 닫을 때는
// Runtime.abort가 끊는다. 리뷰 결과는 세션에 넣지 않는다(V4, V8).

import { claudeJson } from '../adapters/claude.ts'
import { git } from '../adapters/exec.ts'
import { contractHash } from '../core/contract.ts'
import { gate } from '../core/gate.ts'
import {
  evidenceFacts,
  parseReview,
  REVIEW_PROMPT_VERSION,
  REVIEW_SCHEMA,
  reviewPrompt,
  reviewReady,
} from '../core/review.ts'
import type { Contract, EvidenceBundle, Policy } from '../core/types.ts'
import type { ProjectRecord, WorkRecord } from './store.ts'
import {
  workHead,
  type ExportTrigger,
  type ReviewInput,
  type ReviewResult,
  type Runtime,
  type WorkCtx,
} from './works-types.ts'

const REVIEW_TIMEOUT_MS = 15 * 60 * 1000
/** 리뷰어가 쓰는 읽기 도구 */
export const REVIEW_TOOLS = ['Read', 'Grep', 'Glob']

/** 미리 리뷰의 상한(V23): 처음 1번과 V24의 되먹임 3번. 그 뒤에는 PR과 [끝내기] 때만 돈다 */
export const PREPARED_MAX = 4

/** events.jsonl의 review 기록이 적는 계기 */
type Trigger = ExportTrigger | 'prepared'

/** 리뷰가 도는 동안 묶음(결정론적 증거와 리뷰 없는 관문)을 먼저 보인다. 리뷰는 사람을 막지 않는다 */
type Show = (bundle: EvidenceBundle) => Promise<unknown>

/** 독립 리뷰의 기본 구현: 새 맥락의 읽기 전용 claude -p (V4). 실패는 status 'failed'(지적 없음) */
export function claudeReview(o: {
  bin: string
  model?: string
  timeoutMs?: number
  log?: (message: string, error?: unknown) => void
}): (i: ReviewInput) => Promise<ReviewResult> {
  return async (i) => {
    const r = await claudeJson({
      bin: o.bin,
      cwd: i.cwd,
      prompt: reviewPrompt(i),
      schema: REVIEW_SCHEMA,
      allowedTools: REVIEW_TOOLS,
      timeoutMs: o.timeoutMs ?? REVIEW_TIMEOUT_MS,
      ...(o.model ? { model: o.model } : {}),
      ...(i.signal ? { signal: i.signal } : {}),
    })
    if (!r.ok) {
      o.log?.(`리뷰 실패: ${r.error}`)
      return { status: 'failed', findings: [] }
    }
    const usage = r.usage ? { usage: r.usage as Record<string, unknown> } : {}
    const parsed = parseReview(r.value)
    if (!parsed.ok) {
      o.log?.(`리뷰 결과를 읽지 못함: ${parsed.errors.join('; ')}`)
      return { status: 'failed', findings: [], ...usage }
    }
    return { status: 'done', findings: parsed.value, ...usage }
  }
}

/** 내보내기에 다시 쓸 수 있는 리뷰: 이 판의 프롬프트로 끝났다. 실패와 건너뜀은 내보내기가 다시 정한다 */
export function reusable(r: EvidenceBundle['review']): boolean {
  return r !== null && r.status === 'done' && r.prompt_version === REVIEW_PROMPT_VERSION
}

/** 도는 리뷰가 읽은 HEAD나 지금 계약의 것이 아니면 끊는다(V23). seeHead와 계약이 바뀐 곳이 부른다 */
export function followReview(rt: Runtime): void {
  const r = rt.review
  if (r === null) return
  const moved = rt.head !== null && rt.head !== r.head
  if (moved || rt.contract === null || contractHash(rt.contract) !== r.hash) r.abort.abort()
}

export class ReviewDesk {
  private readonly ctx: WorkCtx

  constructor(ctx: WorkCtx) {
    this.ctx = ctx
  }

  /**
   * 미리 리뷰할 때인가(V23): 구현 중이고, 세션이 쉬고(idle, 또는 세션이 끝남), 평가에서 리뷰를 빼지 않았고, 묶음에 리뷰가
   * 없고, Work의 미리 리뷰가 상한 아래이고, 묶음이 지금 HEAD와 계약으로 리뷰 준비다
   */
  preparable(rec: WorkRecord, bundle: EvidenceBundle | null, head: string): boolean {
    const rt = this.ctx.runtime(rec.id)
    return (
      bundle !== null &&
      rec.state === 'working' &&
      (rt.session === 'idle' || rt.session === 'stopped') &&
      this.ctx.deps.reviewDisabled !== true &&
      bundle.review === null &&
      rec.prepared_reviews < PREPARED_MAX &&
      reviewReady(bundle, rt.contract, head)
    )
  }

  /**
   * 내보내기의 리뷰를 붙인 묶음. 같은 head·계약에 이 판으로 끝난 리뷰가 있으면 그것을 쓴다(claude -p를 부르지 않는다).
   * 계약이 없으면 건너뜀. 프로젝트 설정 review가 'auto_only'면 리뷰가 됐다고 치고 관문을 먼저 돌려 자동 조건을 채웠을 때만
   * 리뷰한다(사람 머지 경로만 줄일 수 있다). 평가에서 리뷰를 뺀 쪽(reviewDisabled)은 리뷰할 자리에서 부르지 않고 건너뜀으로
   * 둔다(events.jsonl의 review 기록은 남긴다: 평가가 건너뛴 수를 센다). 리뷰가 끊겼으면 null(부른 쪽은 버린다)
   */
  async forExport(
    rec: WorkRecord,
    project: ProjectRecord,
    contract: Contract | null,
    bundle: EvidenceBundle,
    policy: Policy,
    trigger: ExportTrigger,
    show: Show,
  ): Promise<EvidenceBundle | null> {
    if (reusable(bundle.review)) {
      const findings = bundle.review?.findings.length ?? 0
      this.ctx.note(rec.id, { type: 'review', trigger, reused: true, status: 'done', findings })
      return bundle
    }
    const skipped: EvidenceBundle = { ...bundle, review: { status: 'skipped', findings: [] } }
    if (!contract || !this.needed(project, contract, bundle, policy)) return skipped
    if (this.ctx.deps.reviewDisabled) {
      this.ctx.note(rec.id, {
        type: 'review',
        trigger,
        status: 'skipped',
        findings: 0,
        disabled: true,
      })
      return skipped
    }
    // 실패한 리뷰는 다시 부른다. 도는 동안은 리뷰 없는 묶음을 보인다
    return this.run(rec, contract, { ...bundle, review: null }, trigger, show)
  }

  /**
   * 미리 리뷰(V23)를 붙인 묶음. 'auto_only'에서 자동 조건을 못 채우면 돌리지 않고 세지 않는다(내보내기가 건너뜀으로
   * 정한다). 리뷰어를 부르면 Work의 미리 리뷰 수를 올린다. 리뷰가 끊겼으면 null
   */
  async prepare(
    rec: WorkRecord,
    project: ProjectRecord,
    contract: Contract | null,
    bundle: EvidenceBundle,
    policy: Policy,
    show: Show,
  ): Promise<EvidenceBundle | null> {
    if (!contract || !this.needed(project, contract, bundle, policy)) return bundle
    return this.run(rec, contract, bundle, 'prepared', show)
  }

  /** 리뷰를 불러야 하나: 리뷰 범위가 'auto_only'면 리뷰가 됐다고 친 관문이 자동 조건을 채울 때만 */
  private needed(
    project: ProjectRecord,
    contract: Contract,
    bundle: EvidenceBundle,
    policy: Policy,
  ): boolean {
    if (project.settings.review !== 'auto_only') return true
    const done: EvidenceBundle = { ...bundle, review: { status: 'done', findings: [] } }
    // head는 묶음의 head: 낡음은 리뷰 뒤의 관문이 지금 HEAD로 다시 본다
    return gate(done, contract, policy, bundle.head).condition !== null
  }

  /**
   * 리뷰를 부른다(works-evidence.ts의 재기 안에서만). 묶음과 리뷰 없는 관문을 먼저 보인다. 이 리뷰의 AbortController는
   * Runtime.review에 두고, 앱을 닫는 Runtime.abort에도 끊긴다. 끝나면 HEAD를 다시 읽는다(훅 없이 한 커밋도 여기서 본다):
   * 그사이 HEAD나 계약이 바뀌었으면 버리고 null(events.jsonl에 aborted). 실패는 status 'failed'(지적 없음)
   */
  private async run(
    rec: WorkRecord,
    contract: Contract,
    bundle: EvidenceBundle,
    trigger: Trigger,
    show: Show,
  ): Promise<EvidenceBundle | null> {
    const id = rec.id
    const rt = this.ctx.runtime(id)
    await show(bundle)
    const own = new AbortController()
    rt.review = { head: bundle.head, hash: contractHash(contract), abort: own }
    // 보이는 사이 HEAD나 계약이 바뀌었으면 부르지 않는다
    followReview(rt)
    const signal = AbortSignal.any([rt.abort.signal, own.signal])
    rt.evidenceRunning = false
    rt.reviewRunning = true
    this.ctx.publish(id)
    const version = { prompt_version: REVIEW_PROMPT_VERSION }
    try {
      if (trigger === 'prepared' && !signal.aborted) {
        rec.prepared_reviews += 1
        await this.ctx.save(rec)
      }
      const range = [bundle.base, bundle.head]
      const [diffStat, diff] = await Promise.all([
        git(['diff', '--stat', '--no-color', ...range], rec.worktree),
        git(['diff', '--no-color', '--no-ext-diff', ...range], rec.worktree),
      ])
      const result = signal.aborted
        ? null
        : await this.ctx.deps.review({
            cwd: rec.worktree,
            contract,
            diffStat,
            diff,
            evidenceSummary: evidenceFacts(bundle),
            signal,
          })
      await this.ctx.seeHead(id, await workHead(rec).catch(() => null))
      if (signal.aborted) return this.aborted(id, trigger)
      this.ctx.note(id, {
        type: 'review',
        trigger,
        status: result?.status ?? null,
        findings: result?.findings.length ?? 0,
        ...(result?.usage ? { usage: result.usage } : {}),
      })
      return {
        ...bundle,
        review: result && { status: result.status, findings: result.findings, ...version },
      }
    } catch (e) {
      if (signal.aborted) return this.aborted(id, trigger)
      this.ctx.log(`리뷰 실패 (${id})`, e)
      return { ...bundle, review: { status: 'failed', findings: [], ...version } }
    } finally {
      // reviewRunning은 재기가 끝날 때(관문을 다시 보인 뒤) 내린다: 그 사이 화면과 시험이 리뷰 없는 묶음을 끝난 것으로 보지 않게
      if (rt.review?.abort === own) rt.review = null
    }
  }

  private aborted(id: string, trigger: Trigger): null {
    this.ctx.note(id, { type: 'review', trigger, aborted: true })
    return null
  }
}

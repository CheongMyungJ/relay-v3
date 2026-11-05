// 독립 리뷰 (V4, V23, docs/m2-modules.md 3절 works.ts의 review와 미리 리뷰). 언제 재는지는 works-evidence.ts가 정하고, 이
// 파일은 리뷰를 부르고 묶음에 붙인다: 기본 구현(claudeReview: 새 맥락의 읽기 전용 claude -p), 내보내기의 리뷰(같은 head·
// 계약의 끝난 리뷰를 다시 씀, 건너뜀), 미리 리뷰(세션이 쉬고 증거가 리뷰 준비인 head. 내보내기마다 4번까지: 처음 1번과
// 되먹임 라운드 상한 3, works-feedback.ts PREPARED_MAX). 리뷰는 내보내기(V22: Work 브랜치 하나, 또는 단위 브랜치마다 계약의
// 조각)의 (head, 계약 hash, 프롬프트 판)에 붙는다. 단위 브랜치의 리뷰어는 승인된 계약 전체를 받고, 증거 요약에 그 범위를
// 알린다(채울 줄, 제 브랜치로 가는 다른 단위의 줄). 리뷰마다 AbortController를 따로 두고, 읽은 그 브랜치의 끝이나 계약이
// 바뀌면 끊고 버린다. 앱을 닫을 때는 Runtime.abort가 끊는다. 리뷰어는 request.md를 받고, 받았으면 리뷰 결과에 request:
// true를 붙인다(V30. 없으면 관문이 '리뷰가 요청을 보지 않음'으로 사람 머지). 리뷰 결과 가운데 세션 몫은 works-feedback.ts가
// 쉬는 세션에 보낸다(V24).

import { claudeJson } from '../adapters/claude.ts'
import { git } from '../adapters/exec.ts'
import { showFile } from '../adapters/git.ts'
import { contractHash, sliceContract } from '../core/contract.ts'
import { gate } from '../core/gate.ts'
import { parseQuality } from '../core/quality.ts'
import {
  evidenceFacts,
  parseReview,
  REVIEW_PROMPT_VERSION,
  REVIEW_SCHEMA,
  reviewPrompt,
  reviewReady,
} from '../core/review.ts'
import type { Contract, EvidenceBundle, Integration, Policy } from '../core/types.ts'
import { QUALITY_PATH } from '../engine/check.ts'
import type { ExportRecord, ProjectRecord, WorkRecord } from './store.ts'
import { PREPARED_MAX } from './works-feedback.ts'
import {
  exportContract,
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

/** events.jsonl의 review 기록이 적는 계기 */
type Trigger = ExportTrigger | 'prepared'

/** 리뷰가 도는 동안 묶음(결정론적 증거와 리뷰 없는 관문)을 먼저 보인다. 리뷰는 사람을 막지 않는다 */
type Show = (bundle: EvidenceBundle) => Promise<unknown>

/** 리뷰할 내보내기(V22) 하나: 그 계약(단위 브랜치는 조각), 결정론 묶음, 관문의 정책, 통합 증거(branch_per_unit) */
export interface ReviewJob {
  rec: WorkRecord
  x: ExportRecord
  project: ProjectRecord
  contract: Contract | null
  bundle: EvidenceBundle
  policy: Policy
  show: Show
  whole: Integration | undefined
}

/**
 * 단위 브랜치의 리뷰어에게 주는 범위(영어, 증거 요약의 한 줄, V22·V30). 리뷰어는 승인된 계약 전체를 받는다(m2.1-design 11절):
 * 이 내보내기가 채울 줄(그 단위와 단위가 없는 줄)과 제 브랜치로 가는 다른 단위의 줄을 가른다. 요청 가운데 다른 단위의 줄이
 * 다루는 몫만 이 diff의 빈틈이 아니고, 어느 줄도 다루지 않는 몫은 request_gap이다
 */
export function unitScope(contract: Contract, x: ExportRecord): string[] {
  if (x.unit === null) return []
  const own = sliceContract(contract, x.unit).lines.map((l) => l.id)
  const others = contract.lines
    .filter((l) => l.unit !== undefined && l.unit !== x.unit)
    .map((l) => `${l.id} of ${l.unit ?? ''}`)
  return [
    `scope: this diff is the export of unit "${x.unit}" on branch ${x.branch}. Of the contract above, it must meet the lines of unit "${x.unit}" and the lines without a unit (${own.join(', ')}); a change for a line of another unit is out of contract here. The lines of the other units (${others.join(', ') || 'none'}) are delivered on their own branches: a part of the request that those lines cover is not a gap of this diff, but a part of the request that no line of the contract covers is a request_gap.`,
  ]
}

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

/** 묶음이 쓴 quality.json(묶음의 quality.from 쪽)의 자동 조건. 읽지 못하면 없음 */
export async function autoConditions(
  worktree: string,
  bundle: EvidenceBundle,
): Promise<Policy['conditions']> {
  if (bundle.quality.from === 'none') return []
  const sha = bundle.quality.from === 'base' ? bundle.base : bundle.head
  const text = await showFile(worktree, sha, QUALITY_PATH).catch(() => null)
  const parsed = text === null ? null : parseQuality(text)
  return parsed?.ok ? parsed.value.auto : []
}

/**
 * 도는 리뷰가 읽은 그 브랜치의 끝(Work 브랜치는 HEAD, 단위 브랜치는 tips)이나 지금 계약(단위 브랜치는 조각)의 것이 아니면
 * 끊는다(V23). seeHead와 계약이 바뀐 곳이 부른다
 */
export function followReview(rt: Runtime): void {
  const r = rt.review
  if (r === null) return
  const now = r.unit === null ? rt.head : r.branch in rt.tips ? rt.tips[r.branch] : r.head
  const c = rt.contract && (r.unit === null ? rt.contract : sliceContract(rt.contract, r.unit))
  if ((now !== null && now !== r.head) || (r.unit !== null && now === null)) r.abort.abort()
  else if (c === null || contractHash(c) !== r.hash) r.abort.abort()
}

export class ReviewDesk {
  private readonly ctx: WorkCtx

  constructor(ctx: WorkCtx) {
    this.ctx = ctx
  }

  /**
   * 미리 리뷰할 때인가(V23): 구현 중이고, 세션이 쉬고(idle, 또는 세션이 끝남), 평가에서 리뷰를 빼지 않았고, 묶음에 리뷰가
   * 없고, 내보내기의 미리 리뷰가 상한(처음 1번과 되먹임 라운드 상한 3) 아래이고, 묶음이 그 브랜치의 지금 끝과 계약(단위
   * 브랜치는 조각)으로 리뷰 준비다
   */
  preparable(
    rec: WorkRecord,
    x: ExportRecord,
    bundle: EvidenceBundle | null,
    head: string,
  ): boolean {
    const rt = this.ctx.runtime(rec.id)
    return (
      bundle !== null &&
      rec.state === 'working' &&
      (rt.session === 'idle' || rt.session === 'stopped') &&
      this.ctx.deps.reviewDisabled !== true &&
      bundle.review === null &&
      x.prepared_reviews < PREPARED_MAX &&
      reviewReady(bundle, exportContract(rt, x), head)
    )
  }

  /**
   * 이미 잰 묶음에 미리 리뷰를 붙일 때인가: preparable이고 리뷰어를 부를 것이다('auto_only'면 자동 조건을 채움). 아니면
   * 재기가 아무것도 하지 않는다(다시 보이기, 기록, gh). 조건은 묶음의 quality.json에서 읽는다
   */
  async prepares(
    rec: WorkRecord,
    x: ExportRecord,
    project: ProjectRecord,
    bundle: EvidenceBundle,
    head: string,
    whole: Integration | undefined,
  ): Promise<boolean> {
    if (!this.preparable(rec, x, bundle, head)) return false
    const conditions = await autoConditions(rec.worktree, bundle)
    const contract = exportContract(this.ctx.runtime(rec.id), x)
    return this.needed(project, contract, bundle, conditions, whole)
  }

  /**
   * 'auto_only'에서 건너뛴 내보내기 리뷰가 이제 필요한가(V22): 그 건너뜀은 그때의 통합 증거로 정했다. 단위 브랜치가 그대로여도
   * 통합 증거가 바뀌어 리뷰가 됐다고 친 관문이 자동 조건을 채우면 그 결정은 낡았다. one_branch의 건너뜀은 묶음만으로 정해져
   * 낡지 않는다. 평가에서 리뷰를 뺀 쪽은 늘 건너뛴다
   */
  async staleSkip(
    rec: WorkRecord,
    x: ExportRecord,
    project: ProjectRecord,
    bundle: EvidenceBundle,
    whole: Integration | undefined,
  ): Promise<boolean> {
    if (whole === undefined || bundle.review?.status !== 'skipped') return false
    if (this.ctx.deps.reviewDisabled === true) return false
    const conditions = await autoConditions(rec.worktree, bundle)
    const contract = exportContract(this.ctx.runtime(rec.id), x)
    return this.needed(project, contract, bundle, conditions, whole)
  }

  /**
   * 내보내기의 리뷰를 붙인 묶음. 같은 head·계약에 이 판으로 끝난 리뷰가 있으면 그것을 쓴다(claude -p를 부르지 않는다).
   * 계약이 없으면 건너뜀. 프로젝트 설정 review가 'auto_only'면 리뷰가 됐다고 치고 관문을 먼저 돌려 자동 조건을 채웠을 때만
   * 리뷰한다(사람 머지 경로만 줄일 수 있다). 평가에서 리뷰를 뺀 쪽(reviewDisabled)은 리뷰할 자리에서 부르지 않고 건너뜀으로
   * 둔다(events.jsonl의 review 기록은 남긴다: 평가가 건너뛴 수를 센다). 리뷰가 끊겼으면 null(부른 쪽은 버린다)
   */
  async forExport(j: ReviewJob, trigger: ExportTrigger): Promise<EvidenceBundle | null> {
    const { rec, x, contract, bundle } = j
    const unit = x.unit === null ? {} : { unit: x.unit }
    if (reusable(bundle.review)) {
      const findings = bundle.review?.findings.length ?? 0
      this.ctx.note(rec.id, {
        type: 'review',
        trigger,
        ...unit,
        reused: true,
        status: 'done',
        findings,
      })
      return bundle
    }
    const skipped: EvidenceBundle = { ...bundle, review: { status: 'skipped', findings: [] } }
    if (!contract || !this.needed(j.project, contract, bundle, j.policy.conditions, j.whole))
      return skipped
    if (this.ctx.deps.reviewDisabled) {
      this.ctx.note(rec.id, {
        type: 'review',
        trigger,
        ...unit,
        status: 'skipped',
        findings: 0,
        disabled: true,
      })
      return skipped
    }
    // 실패한 리뷰는 다시 부른다. 도는 동안은 리뷰 없는 묶음을 보인다
    return this.run({ ...j, contract, bundle: { ...bundle, review: null } }, trigger)
  }

  /**
   * 미리 리뷰(V23)를 붙인 묶음. 'auto_only'에서 자동 조건을 못 채우면 돌리지 않고 세지 않는다(내보내기가 건너뜀으로
   * 정한다). 리뷰어를 부르면 내보내기의 미리 리뷰 수를 올린다. 리뷰가 끊겼으면 null
   */
  async prepare(j: ReviewJob): Promise<EvidenceBundle | null> {
    const { contract } = j
    if (!contract || !this.needed(j.project, contract, j.bundle, j.policy.conditions, j.whole))
      return j.bundle
    return this.run({ ...j, contract }, 'prepared')
  }

  /**
   * 리뷰를 불러야 하나: 계약이 있고, 리뷰 범위가 'auto_only'면 리뷰가 됐다고 친 관문이 자동 조건을 채울 때만(V22: 통합 증거와
   * Work 전체 diff도). 관문이 채운 조건(condition)은 정책의 조건과 묶음만으로 정해진다(스위치, 서버 보호, 실적과 상관없다):
   * 그래서 조건만 받는다
   */
  private needed(
    project: ProjectRecord,
    contract: Contract | null,
    bundle: EvidenceBundle,
    conditions: Policy['conditions'],
    whole: Integration | undefined,
  ): boolean {
    if (contract === null) return false
    if (project.settings.review !== 'auto_only') return true
    // 리뷰가 됐다고 친다: 요청도 본 끝난 리뷰(V30)
    const done: EvidenceBundle = {
      ...bundle,
      review: { status: 'done', findings: [], request: true },
    }
    const policy: Policy = {
      auto_merge_enabled: false,
      conditions,
      server: null,
      track_record_ok: {},
    }
    // head는 묶음의 head: 낡음은 리뷰 뒤의 관문이 지금 HEAD로 다시 본다
    const integration = whole && { ...whole, head: whole.evidence?.head ?? null }
    return gate(done, contract, policy, bundle.head, integration).condition !== null
  }

  /**
   * 리뷰를 부른다(works-evidence.ts의 재기 안에서만). 묶음과 리뷰 없는 관문을 먼저 보인다. 이 리뷰의 AbortController는
   * Runtime.review에 두고, 앱을 닫는 Runtime.abort에도 끊긴다. 끝나면 HEAD(와 단위 브랜치의 끝)를 다시 읽는다(훅 없이 한
   * 커밋도 여기서 본다): 그사이 그 브랜치의 끝이나 계약이 바뀌었으면 버리고 null(events.jsonl에 aborted). 실패는 status
   * 'failed'(지적 없음)
   */
  private async run(
    j: ReviewJob & { contract: Contract },
    trigger: Trigger,
  ): Promise<EvidenceBundle | null> {
    const { rec, x, contract, bundle } = j
    const id = rec.id
    const rt = this.ctx.runtime(id)
    const unit = x.unit === null ? {} : { unit: x.unit }
    await j.show(bundle)
    const own = new AbortController()
    rt.review = {
      unit: x.unit,
      branch: x.branch,
      head: bundle.head,
      hash: contractHash(contract),
      abort: own,
    }
    // 보이는 사이 HEAD나 계약이 바뀌었으면 부르지 않는다
    followReview(rt)
    const signal = AbortSignal.any([rt.abort.signal, own.signal])
    rt.evidenceRunning = false
    rt.reviewRunning = true
    this.ctx.publish(id)
    const version = { prompt_version: REVIEW_PROMPT_VERSION }
    try {
      if (trigger === 'prepared' && !signal.aborted) {
        x.prepared_reviews += 1
        await this.ctx.save(rec)
      }
      const range = [bundle.base, bundle.head]
      const [diffStat, diff, request] = await Promise.all([
        git(['diff', '--stat', '--no-color', ...range], rec.worktree),
        git(['diff', '--no-color', '--no-ext-diff', ...range], rec.worktree),
        this.ctx.deps.store.readText(id, 'request.md'),
      ])
      const result = signal.aborted
        ? null
        : await this.ctx.deps.review({
            cwd: rec.worktree,
            // 단위 브랜치의 리뷰어도 승인된 계약 전체를 받는다(V30). 리뷰는 조각의 hash에 붙는다
            contract: x.unit !== null && rt.contract ? rt.contract : contract,
            request,
            diffStat,
            diff,
            evidenceSummary: [
              ...evidenceFacts(bundle),
              ...(rt.contract ? unitScope(rt.contract, x) : []),
            ],
            signal,
          })
      await this.ctx.seeHead(id, await workHead(rec).catch(() => null))
      if (signal.aborted) return this.aborted(id, trigger, unit)
      this.ctx.note(id, {
        type: 'review',
        trigger,
        ...unit,
        status: result?.status ?? null,
        findings: result?.findings.length ?? 0,
        ...(result?.usage ? { usage: result.usage } : {}),
      })
      // 리뷰어가 요청을 받았다(V30): 그런 리뷰만 자동 후보·그림자가 될 수 있다(V15)
      const saw = request === null ? {} : { request: true }
      return {
        ...bundle,
        review: result && { status: result.status, findings: result.findings, ...version, ...saw },
      }
    } catch (e) {
      if (signal.aborted) return this.aborted(id, trigger, unit)
      this.ctx.log(`리뷰 실패 (${id})`, e)
      return { ...bundle, review: { status: 'failed', findings: [], ...version } }
    } finally {
      // reviewRunning은 재기가 끝날 때(관문을 다시 보인 뒤) 내린다: 그 사이 화면과 시험이 리뷰 없는 묶음을 끝난 것으로 보지 않게
      if (rt.review?.abort === own) rt.review = null
    }
  }

  private aborted(id: string, trigger: Trigger, unit: { unit?: string }): null {
    this.ctx.note(id, { type: 'review', trigger, ...unit, aborted: true })
    return null
  }
}

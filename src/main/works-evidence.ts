// 증거 → (리뷰) → 관문 → 장부, 정책 머지 (docs/m2-modules.md 3절 works.ts, docs/m2-app.md 1절 5~9).
// 계기: Stop 뒤 지금 계약으로 재지 않았거나 미리 리뷰(V23)를 돌릴 head면 debounceMs 몰아서(내보내기 아님), 세션이 git push·
// gh pr 뒤(또는 PR 확인에서) PR이 내보내기의 끝을 가리키면 그 내보내기(리뷰 포함), [끝내기]·[그래도 끝내기](V25,
// works-end.ts)는 모든 내보내기. '이미 잰 것'은 (head, 계약 hash)이고 다시 재지 않는다. 내보내기는 같은 head·계약의 끝난
// 리뷰를 다시 쓴다(V23, works-review.ts). 재는 자리(V22): one_branch는 Work 브랜치 하나가 내보내기다. branch_per_unit은 먼저
// Work 브랜치를 계약 전체로 결정론만 재고(통합 증거, 리뷰 없음), 단위 브랜치마다 계약의 조각(contract.<단위>.json)으로 잰다.
// 내보내기의 관문은 통합 증거를 함께 본다(core gate의 whole). 선언한 단위 브랜치가 없으면 그 내보내기는 '단위 브랜치 없음'이다.
// 한 Work의 증거 재기는 한 번에 하나이고, 기다리는 요청은 하나로 합친다. 재기가 끝나면 다음 재기 전에 [끝내기]의 걸린 끝을
// 다시 본다. 리뷰는 결정론적 증거와 관문을 먼저 보인 뒤 돌고 끝나면 다시 정한다(리뷰는 사람을 막지 않는다, V4). 장부 줄,
// exported_head, 정책 머지는 내보내기 계기에서만 생긴다(V23). exported_head는 지금 묶음이 내보내기로 잰 묶음일 때만 그
// head다: 다른 재기가 묶음을 바꾸면 비운다(같은 head로 되돌아와 다시 잰 묶음이 내보내기로 보이지 않게). 머지와 PR 따라가기는
// works-exports.ts. 엔진 check는 in-process로 부른다. Stop 뒤 몰아 두기 끝과 재기가 끝날 때마다 되먹임(V24,
// works-feedback.ts)을 본다(세션이 쉴 때만 보낸다).

import { evidencePath, repoKey, writeJson } from '../adapters/store.ts'
import { contractHash } from '../core/contract.ts'
import { gate, openItems } from '../core/gate.ts'
import { trackRecord } from '../core/ledger.ts'
import type { Contract, EvidenceBundle, GateResult, Integration, Policy } from '../core/types.ts'
import type { PrInfo } from '../shared/api.ts'
import type { ExportRecord, ProjectRecord, WorkRecord } from './store.ts'
import { ExportDesk, exportable, ledgerEntry, unitOf, versions } from './works-exports.ts'
import { autoConditions, ReviewDesk, reusable } from './works-review.ts'
import {
  contractFile,
  delivered,
  exportContract,
  isActive,
  measures,
  message,
  perUnit,
  readTips,
  refHead,
  tipOf,
  type ExportTrigger,
  type MeasureJob,
  type Tips,
  type WorkCtx,
  workHead,
} from './works-types.ts'

export { blockingChecks, exportable, type MergeOutcome } from './works-exports.ts'

const DEBOUNCE_MS = 20_000

/** 세션이 PR을 열거나 갱신했을 수 있는 Bash 명령 */
const EXPORT_COMMAND = /\bgit\b[^;&|\n]*\bpush\b|\bgh\b[^;&|\n]*\bpr\b/

export function isExportCommand(command: string): boolean {
  return EXPORT_COMMAND.test(command)
}

/** 이 계약으로 만든 묶음인가(계약이 없으면 계약 없이 만든 묶음). 관문의 '증거를 만든 뒤 계약이 바뀜'과 같은 견줌이다 */
export function sameContract(e: EvidenceBundle, c: Contract | null): boolean {
  return c === null ? e.contract === null : e.contract?.hash === contractHash(c)
}

/** 선언한 단위 브랜치가 없는 내보내기의 사실(V22). [끝내기]의 열린 것이기도 하다 */
export const missingFact = (x: ExportRecord): string => `단위 브랜치 없음: ${x.branch}`

export class EvidenceRunner {
  private readonly ctx: WorkCtx
  private readonly reviews: ReviewDesk
  /** 내보내기의 머지와 PR(works-exports.ts) */
  readonly exports: ExportDesk

  constructor(ctx: WorkCtx) {
    this.ctx = ctx
    this.reviews = new ReviewDesk(ctx)
    this.exports = new ExportDesk(ctx, this)
  }

  private get debounceMs(): number {
    return this.ctx.deps.debounceMs ?? DEBOUNCE_MS
  }

  sameContract(e: EvidenceBundle, c: Contract | null): boolean {
    return sameContract(e, c)
  }

  /** 지금 계약(단위 브랜치는 조각)으로 이 끝을 이미 쟀나(내보내기라면 리뷰가 도는 동안 먼저 보인 묶음도 잰 것이다) */
  measured(id: string, x: ExportRecord, tip: string): boolean {
    const rt = this.ctx.runtime(id)
    const b = rt.bundles.get(x.branch)
    return b !== undefined && b.head === tip && sameContract(b, exportContract(rt, x))
  }

  /**
   * 지금 묶음이 이 끝을 지금 계약으로 내보내기(리뷰까지)로 잰 것인가. 리뷰가 도는 동안은 아직 아니다. 내보내기 묶음에는
   * 늘 리뷰(끝남, 실패, 건너뜀)가 있다: 앱을 닫아 엔진이 같은 head의 증거 파일을 리뷰 없는 묶음으로 덮었으면 아니다
   */
  exported(id: string, x: ExportRecord, tip: string): boolean {
    const b = this.ctx.runtime(id).bundles.get(x.branch)
    return x.exported_head === tip && this.measured(id, x, tip) && b?.review !== null
  }

  /** 통합 증거(V22)를 지금 Work 브랜치의 끝과 계약 전체로 쟀나. one_branch는 늘 참(통합이 따로 없다) */
  integrated(rec: WorkRecord, head: string): boolean {
    if (!perUnit(rec)) return true
    const rt = this.ctx.runtime(rec.id)
    const b = rt.bundles.get(rec.branch)
    return b !== undefined && b.head === head && sameContract(b, rt.contract)
  }

  /** 통합 증거(V22)와 머지되지 않은 내보내기(있는 브랜치)를 이 끝들로 모두 쟀나 */
  measuredAll(rec: WorkRecord, head: string, tips: Tips): boolean {
    return (
      this.integrated(rec, head) &&
      rec.exports.every((x) => {
        const tip = tipOf(x, head, tips)
        return delivered(x) || tip === null || this.measured(rec.id, x, tip)
      })
    )
  }

  /** 통합 증거와 머지되지 않은 내보내기(있는 브랜치)를 이 끝들로 모두 내보내기로 쟀나 */
  exportedAll(rec: WorkRecord, head: string, tips: Tips): boolean {
    return (
      this.integrated(rec, head) &&
      rec.exports.every((x) => {
        const tip = tipOf(x, head, tips)
        return delivered(x) || tip === null || this.exported(rec.id, x, tip)
      })
    )
  }

  /**
   * 이 끝들의 미리 리뷰(V23)가 모두 끝나 있어 내보내기가 다시 재지 않고 claude -p도 부르지 않는다. 아직 내보내기가 아닌 것이
   * 있고, 도는 재기도 줄 선 재기도 없다([끝내기]가 이것을 바로 내보내기로 잰다)
   */
  promotable(id: string, head: string, tips: Tips): boolean {
    const rec = this.ctx.record(id)
    const rt = this.ctx.runtime(id)
    if (rt.pending !== null || rt.measuring !== null || !this.integrated(rec, head)) return false
    let some = false
    for (const x of rec.exports) {
      const tip = tipOf(x, head, tips)
      if (delivered(x) || tip === null) continue
      if (!this.measured(id, x, tip) || !reusable(rt.bundles.get(x.branch)?.review ?? null))
        return false
      if (!this.exported(id, x, tip)) some = true
    }
    return some
  }

  /** 지금의 통합 증거(V22). one_branch는 없음(undefined). 지금 Work 브랜치의 끝으로 낡음을 본다 */
  whole(rec: WorkRecord, head: string | null): Integration | undefined {
    if (!perUnit(rec)) return undefined
    const rt = this.ctx.runtime(rec.id)
    const b = rt.bundles.get(rec.branch) ?? null
    return { evidence: b && sameContract(b, rt.contract) ? b : null, contract: rt.contract, head }
  }

  /** 정책 머지 직전(V22): 지금 끝들과 그때의 통합 증거로 이 내보내기가 아직 자동 머지 후보인가 */
  async stillAuto(rec: WorkRecord, x: ExportRecord): Promise<boolean> {
    const rt = this.ctx.runtime(rec.id)
    const bundle = rt.bundles.get(x.branch)
    const policy = rt.policies.get(x.branch)
    const head = await workHead(rec).catch(() => null)
    const tip = tipOf(x, head, await readTips(rec))
    if (!bundle || !policy || tip === null) return false
    const g = gate(bundle, exportContract(rt, x), policy, tip, this.whole(rec, head))
    return g.conclusion === 'auto_merge_candidate'
  }

  // ── 계기 ───────────────────────────────────────────────────────────────────

  /**
   * Stop: 지금 계약으로 재지 않은 끝, 또는 잰 묶음에 미리 리뷰(V23)를 돌릴 끝이 있으면 debounceMs 뒤 미리 리뷰를 허락한
   * 재기를 줄 세운다(그사이 Stop이 또 오면 다시 기다린다). 그때 이미 쟀고 미리 리뷰할 것도 없으면 재기가 바로 그만둔다. 잴
   * 것이 없으면 debounceMs 뒤 되먹임만 본다(V24: 세션이 그때도 쉬고 있어야 보낸다)
   */
  async onStop(id: string): Promise<void> {
    const rec = this.ctx.record(id)
    const rt = this.ctx.runtime(id)
    const head = await workHead(rec).catch(() => null)
    await this.ctx.seeHead(id, head)
    if (!measures(rec.state) || head === null) return
    const idle = this.idle(rec, head, await readTips(rec))
    this.cancelDebounce(id)
    rt.debounce = setTimeout(() => {
      rt.debounce = null
      const next = idle ? this.ctx.offerFeedback(id) : this.run(id, { prepare: true })
      void next.catch((e) => this.ctx.log('증거 실패', e))
    }, this.debounceMs)
  }

  /** 잴 것도 미리 리뷰할 것도 없다: 모두 쟀고, 없는 단위 브랜치는 이미 그렇게 적었다 */
  private idle(rec: WorkRecord, head: string, tips: Tips): boolean {
    const rt = this.ctx.runtime(rec.id)
    return (
      this.integrated(rec, head) &&
      rec.exports.every((x) => {
        const tip = tipOf(x, head, tips)
        if (delivered(x)) return true
        if (tip === null) return x.gate?.decisive === missingFact(x)
        const b = rt.bundles.get(x.branch) ?? null
        return this.measured(rec.id, x, tip) && !this.reviews.preparable(rec, x, b, tip)
      })
    )
  }

  cancelDebounce(id: string): void {
    const rt = this.ctx.runtime(id)
    if (rt.debounce) clearTimeout(rt.debounce)
    rt.debounce = null
  }

  /**
   * PostToolUse(셸)의 git push·gh pr: 내보내기마다 PR을 다시 읽고, PR이 그 내보내기의 지금 끝을 가리키고 Work의 기준 브랜치로
   * 가면 그 내보내기를 내보내기 후보로 잰다. 기준이 다른 PR은 재지 않고 알린다(증거와 서버 보호는 Work의 기준으로 읽는다).
   * 내보내기의 PR이 모두 머지되거나 닫혔으면 Work를 끝낸다
   */
  async onPush(id: string): Promise<void> {
    const rec = this.ctx.record(id)
    const prs: [ExportRecord, PrInfo | null][] = []
    for (const x of rec.exports)
      if (!delivered(x)) prs.push([x, await this.exports.refreshPr(rec, x)])
    await this.exports.settleWork(rec)
    if (!measures(rec.state) || !prs.some(([, pr]) => pr?.state === 'OPEN')) return
    const head = await workHead(rec).catch(() => null)
    await this.ctx.seeHead(id, head)
    const tips = await readTips(rec)
    const only: string[] = []
    for (const [x, pr] of prs) {
      if (pr?.state !== 'OPEN') continue
      if (pr.baseRefName !== rec.base) await this.exports.wrongBase(rec, pr)
      const tip = tipOf(x, head, tips)
      if (tip !== null && exportable(pr, rec.base, tip) && !this.exported(id, x, tip))
        only.push(x.branch)
    }
    if (only.length === 0) return
    // 다른 내보내기가 남으면 Stop 뒤 몰아 두기(미리 리뷰)는 그대로 둔다
    if (rec.exports.every((x) => delivered(x) || only.includes(x.branch))) this.cancelDebounce(id)
    await this.run(id, { export: 'pr', only })
  }

  // ── 증거 재기 ──────────────────────────────────────────────────────────────

  /**
   * check → (리뷰) → gate → (내보내기면 장부와 정책 머지). 돌고 있으면 그 뒤에 한 번 더 잰다(기다리는 요청은 합친다: 내보내기
   * 계기의 브랜치는 모은다). 차례가 와서 시작할 때 앞 재기가 이 끝을 이미 쟀으면(내보내기면 다시 쓸 리뷰까지) 재지 않는다:
   * 세션의 git push와 gh pr이 잇달아 와도, 내보내기 리뷰가 도는 동안 gh pr이 또 와도 같은 head의 리뷰는 한 번이다.
   * again([증거 다시 재기])이면 그래도 잰다. 내보내기 결론이 자동 머지 후보이고 PR이 있으면 바로 머지해 본다(by 'policy').
   * 재기가 끝나면 되먹임을 본다(V24): 세션이 쉬는데 재기가 돌아 보내지 못한 것이 있을 수 있다(PR을 연 차례의 Stop,
   * 내보내기의 [증거 다시 재기])
   */
  run(
    id: string,
    o: { export?: ExportTrigger; only?: string[]; prepare?: boolean; again?: boolean },
  ): Promise<void> {
    const rec = this.ctx.record(id)
    const rt = this.ctx.runtime(id)
    // 모든 내보내기를 고른 것은 null(모두)과 같다
    const only =
      o.only === undefined || rec.exports.every((x) => o.only?.includes(x.branch)) ? null : o.only
    const p = rt.pending
    if (p) {
      if (o.export !== undefined && p.export === null) [p.export, p.only] = [o.export, only]
      else if (o.export !== undefined)
        p.only = p.only === null || only === null ? null : [...new Set([...p.only, ...only])]
      p.prepare ||= o.prepare === true
      p.again ||= o.again === true
      return p.done
    }
    const pending: MeasureJob & { done: Promise<void> } = {
      export: o.export ?? null,
      only: o.export === undefined ? null : only,
      prepare: o.prepare === true,
      again: o.again === true,
      head: null,
      tips: null,
      done: Promise.resolve(),
    }
    // 재기가 끝나면 다음 재기 전에 [끝내기]의 걸린 끝을 다시 본다(V25)
    pending.done = rt.chain.then(async () => {
      rt.pending = null
      await this.measure(id, pending)
      await this.ctx.settleEnd(id, pending)
      await this.ctx.offerFeedback(id)
    })
    rt.pending = pending
    rt.chain = pending.done.catch(() => {})
    return pending.done
  }

  /**
   * 재기 하나: branch_per_unit이면 통합 증거를 먼저 재고, 머지되지 않은 내보내기마다 잰다. 도는 동안 measuring은 이 Work
   * 브랜치의 끝이다(되먹임, [끝내기], PR 확인이 기다린다)
   */
  private async measure(id: string, job: MeasureJob): Promise<void> {
    const rec = this.ctx.record(id)
    if (!isActive(rec.state)) return
    const rt = this.ctx.runtime(id)
    try {
      const head = await workHead(rec)
      job.head = head
      await this.ctx.seeHead(id, head)
      const tips = await readTips(rec)
      job.tips = tips
      rt.measuring = head
      const whole = perUnit(rec) ? await this.integrate(rec, head, job) : undefined
      for (const x of rec.exports) {
        if (whole === null || !isActive(rec.state) || rt.abort.signal.aborted) return
        if (!delivered(x)) await this.measureExport(rec, x, tipOf(x, head, tips), job, whole)
      }
    } catch (e) {
      rec.error = `증거를 재지 못함: ${message(e)}`
      this.ctx.log(`증거 실패 (${id})`, e)
      await this.ctx.save(rec)
    } finally {
      rt.measuring = null
      this.ctx.publish(id)
    }
  }

  /**
   * 통합 증거(V22): Work 브랜치를 계약 전체로, 결정론만(리뷰, 관문, 장부 없음). 같은 head·계약이면(again이 아니면) 다시 재지
   * 않는다. 재지 못했으면 evidence null(내보내기는 자동 조건을 채우지 못한다). 재는 사이 Work가 끝났거나 앱을 닫으면 null
   */
  private async integrate(
    rec: WorkRecord,
    head: string,
    job: MeasureJob,
  ): Promise<Integration | null> {
    const rt = this.ctx.runtime(rec.id)
    const contract = rt.contract
    const held = rt.bundles.get(rec.branch)
    if (!job.again && held?.head === head && sameContract(held, contract))
      return { evidence: held, contract, head }
    const { deps } = this.ctx
    rt.measuringAt = rec.branch
    rt.evidenceRunning = true
    this.ctx.publish(rec.id)
    try {
      const bundle = await deps.check({
        repo: rec.worktree,
        head,
        base: rec.base_ref,
        ...(contract ? { contractPath: deps.store.workPath(rec.id, 'contract.json') } : {}),
        requestPath: deps.store.workPath(rec.id, 'request.md'),
        home: deps.store.home,
        now: deps.now(),
      })
      if (!isActive(rec.state) || rt.abort.signal.aborted) return null
      rt.bundles.set(rec.branch, bundle)
      const path = deps.store.bundlePath(rec.id, 'integration')
      await writeJson(path, bundle)
      rec.integration_path = path
      rec.error = null
      await this.ctx.save(rec)
      const open = openItems(bundle, contract, head, false).length
      this.ctx.note(rec.id, { type: 'evidence', head, integration: true, open })
      return { evidence: bundle, contract, head }
    } catch (e) {
      rec.error = `통합 증거를 재지 못함: ${message(e)}`
      this.ctx.log(`증거 실패 (${rec.id})`, e)
      await this.ctx.save(rec)
      return { evidence: null, contract, head }
    } finally {
      rt.evidenceRunning = false
      rt.measuringAt = null
      this.ctx.publish(rec.id)
    }
  }

  /**
   * 내보내기 하나. 같은 끝·계약의 결정론 묶음이 있으면(again이 아니면) check를 다시 돌리지 않는다. 그 내보내기가 계기이면
   * 리뷰를 붙이고(다시 쓸 수 있으면 그대로), 아니면 미리 리뷰를 허락한 재기만 미리 리뷰를 붙인다(V23). 이미 잰 묶음에 붙일
   * 미리 리뷰가 없으면('auto_only'에서 자동 조건을 못 채움) 아무것도 하지 않는다(보이기, 기록, gh 모두. 통합 증거가 있으면
   * 관문만 다시 계산한다). 리뷰가 끊겼으면(끝·계약이 바뀜, 앱을 닫음) 그 결과를 버린다. 단위 브랜치가 없으면 그렇게 적는다
   */
  private async measureExport(
    rec: WorkRecord,
    x: ExportRecord,
    tip: string | null,
    job: MeasureJob,
    whole: Integration | undefined,
  ): Promise<void> {
    const id = rec.id
    const rt = this.ctx.runtime(id)
    const { deps } = this.ctx
    const project = this.ctx.projectOf(rec)
    const mine = job.export !== null && (job.only === null || job.only.includes(x.branch))
    const trigger = mine ? job.export : null
    if (tip === null) return this.missing(rec, x)
    const known =
      !job.again && this.measured(id, x, tip) ? (rt.bundles.get(x.branch) ?? null) : null
    if (known !== null) {
      const done =
        trigger !== null
          ? this.exported(id, x, tip) && reusable(known.review)
          : !job.prepare || !(await this.reviews.prepares(rec, x, project, known, tip, whole))
      if (done) return this.regate(rec, x, tip, whole)
    }
    rt.measuringAt = x.branch
    rt.evidenceRunning = true
    this.ctx.publish(id)
    try {
      const contract = exportContract(rt, x)
      let bundle = known ?? (await this.check(rec, x, tip, trigger === null))
      // 재는 사이 [버림]·[머지]로 끝났거나 앱을 닫았으면(명령이 끊김) 관문도 장부도 남기지 않는다
      if (!isActive(rec.state) || rt.abort.signal.aborted) return
      const policy = await this.policy(rec, project, bundle)
      // 리뷰가 도는 동안 보이는 리뷰 없는 묶음은 내보내기로 잰 것이 아니다
      const show = (b: EvidenceBundle) =>
        this.publishGate(rec, x, b, contract, policy, false, whole)
      const review = { rec, x, project, contract, bundle, policy, show, whole }
      if (trigger !== null) {
        const reviewed = await this.reviews.forExport(review, trigger)
        // 끊긴 리뷰(끝·계약이 바뀜, 앱을 닫음)는 내보내기로 남기지 않는다: 다시 켜고 [끝내기]하면 다시 잰다
        if (reviewed === null || !isActive(rec.state) || rt.abort.signal.aborted) return
        bundle = reviewed
      } else if (job.prepare && this.reviews.preparable(rec, x, bundle, tip)) {
        const reviewed = await this.reviews.prepare(review)
        if (reviewed === null || !isActive(rec.state) || rt.abort.signal.aborted) return
        bundle = reviewed
      }
      if (bundle.review !== null && !perUnit(rec))
        await writeJson(evidencePath(deps.store.home, repoKey(bundle.repo), bundle.head), bundle)
      const result = await this.publishGate(
        rec,
        x,
        bundle,
        contract,
        policy,
        trigger !== null,
        whole,
      )
      // 장부 줄과 정책 머지는 내보내기 계기에서만(V23): 중간 head가 그림자 실적이나 자동 머지에 닿지 않게
      if (trigger !== null)
        await deps.store.appendLedger(ledgerEntry(deps, rec, x, project, bundle.head, result))
      // 사람이 기본 브랜치에 품질 기준을 커밋했으면 알림(V20)을 거둔다
      this.ctx.refreshQuality(project.id)
      this.ctx.note(id, {
        type: 'evidence',
        head: bundle.head,
        export: trigger !== null,
        ...unitOf(x),
        ...(known !== null ? { reused: true } : {}),
        conclusion: result.conclusion,
        decisive: result.decisive,
        shadow: result.shadow,
      })
      if (
        trigger !== null &&
        result.conclusion === 'auto_merge_candidate' &&
        x.pr?.state === 'OPEN'
      )
        await this.exports.autoMerge(id, x)
    } catch (e) {
      rec.error = `증거를 재지 못함: ${message(e)}`
      this.ctx.log(`증거 실패 (${id})`, e)
      await this.ctx.save(rec)
    } finally {
      rt.evidenceRunning = false
      rt.reviewRunning = false
      rt.measuringAt = null
      this.ctx.publish(id)
    }
  }

  /** 선언한 단위 브랜치가 없다(V22): 증거 없이 '단위 브랜치 없음'(사람 머지, [끝내기]의 열린 것). 장부에는 쓰지 않는다 */
  private async missing(rec: WorkRecord, x: ExportRecord): Promise<void> {
    const rt = this.ctx.runtime(rec.id)
    const fact = missingFact(x)
    if (x.gate?.decisive === fact && !rt.bundles.has(x.branch)) return
    rt.bundles.delete(x.branch)
    rt.policies.delete(x.branch)
    x.gate = {
      conclusion: 'human_merge',
      decisive: fact,
      reasons: [fact],
      condition: null,
      shadow: false,
    }
    x.evidence_path = null
    x.exported_head = null
    await this.ctx.save(rec)
    this.ctx.note(rec.id, { type: 'export_missing', unit: x.unit, branch: x.branch })
  }

  /**
   * 통합 증거가 바뀌었을 수 있다(V22): 다시 재지 않은 내보내기의 관문을 마지막 정책으로 다시 계산한다(장부, exported_head는
   * 그대로). one_branch는 할 일이 없다
   */
  private async regate(
    rec: WorkRecord,
    x: ExportRecord,
    tip: string,
    whole: Integration | undefined,
  ): Promise<void> {
    const rt = this.ctx.runtime(rec.id)
    const bundle = rt.bundles.get(x.branch)
    const policy = rt.policies.get(x.branch)
    if (whole === undefined || !bundle || !policy) return
    const g = gate(bundle, exportContract(rt, x), policy, tip, whole)
    if (JSON.stringify(g) === JSON.stringify(x.gate)) return
    x.gate = g
    await this.ctx.save(rec)
  }

  /**
   * 엔진 check. 단위 브랜치는 조각(contract.<단위>.json)을 쓰고 예시 자료는 계약 전체로 얹고 견준다(V22, 세션이 커밋하는 예시
   * 자료는 파일 하나다). 내보내기가 아니면 같은 head·계약의 앞 묶음의 리뷰를 잇는다(again으로 다시 재도 지적이 사라지지
   * 않게. 실패한 리뷰도)
   */
  private async check(
    rec: WorkRecord,
    x: ExportRecord,
    head: string,
    carry: boolean,
  ): Promise<EvidenceBundle> {
    const { deps } = this.ctx
    const rt = this.ctx.runtime(rec.id)
    const before = rt.bundles.get(x.branch)
    const contract = exportContract(rt, x)
    const file = contractFile(x)
    if (contract !== null && x.unit !== null) await deps.store.writeJson(rec.id, file, contract)
    const bundle = await deps.check({
      repo: rec.worktree,
      head,
      base: rec.base_ref,
      ...(contract ? { contractPath: deps.store.workPath(rec.id, file) } : {}),
      ...(contract && x.unit !== null
        ? { examplesContractPath: deps.store.workPath(rec.id, 'contract.json') }
        : {}),
      requestPath: deps.store.workPath(rec.id, 'request.md'),
      home: deps.store.home,
      now: deps.now(),
    })
    if (carry && before?.review && before.head === bundle.head && sameContract(before, contract))
      return { ...bundle, review: before.review }
    return bundle
  }

  /**
   * 묶음과 그 관문을 내보내기에 두고 화면에 보인다. 관문의 head는 지금 그 브랜치의 끝이다(V6, V21). branch_per_unit은 그때의
   * 통합 증거를 지금 Work 브랜치의 끝으로 함께 보고(V22), 묶음을 Work 안의 파일에 둔다(단위 브랜치와 Work 브랜치가 같은 커밋을
   * 가리켜도 섞이지 않게). exported는 내보내기로 잰 묶음(리뷰까지)인가: exported_head는 지금 묶음이 그런 묶음일 때만 그
   * head이고 아니면 비운다
   */
  private async publishGate(
    rec: WorkRecord,
    x: ExportRecord,
    bundle: EvidenceBundle,
    contract: Contract | null,
    policy: Policy,
    exported: boolean,
    whole: Integration | undefined,
  ): Promise<GateResult> {
    const { deps } = this.ctx
    const rt = this.ctx.runtime(rec.id)
    const head = await workHead(rec).catch(() => null)
    const tip = x.unit === null ? head : await refHead(rec.worktree, x.branch).catch(() => null)
    const result = gate(bundle, contract, policy, tip, whole && { ...whole, head })
    rt.bundles.set(x.branch, bundle)
    rt.policies.set(x.branch, policy)
    x.exported_head = exported ? bundle.head : null
    await this.ctx.seeHead(rec.id, head ?? (x.unit === null ? bundle.head : null))
    x.gate = result
    if (perUnit(rec)) {
      x.evidence_path = deps.store.bundlePath(rec.id, `unit-${x.unit ?? ''}`)
      await writeJson(x.evidence_path, bundle)
    } else x.evidence_path = evidencePath(deps.store.home, repoKey(bundle.repo), bundle.head)
    rec.error = null
    await this.ctx.save(rec)
    return result
  }

  /** 관문의 정책: 프로젝트 설정, 묶음이 쓴 quality.json의 auto, 서버 보호, 그림자 실적 */
  private async policy(
    rec: WorkRecord,
    project: ProjectRecord,
    bundle: EvidenceBundle,
  ): Promise<Policy> {
    const { deps } = this.ctx
    const conditions = await autoConditions(rec.worktree, bundle)
    const server = await deps.gh.serverProtection(project.path, rec.base).catch(() => null)
    const ledger = await deps.store.readLedger()
    return {
      auto_merge_enabled: project.settings.auto_merge,
      conditions,
      server,
      track_record_ok: trackRecord(ledger, project.id, project.settings.min_shadow, versions(deps)),
    }
  }
}

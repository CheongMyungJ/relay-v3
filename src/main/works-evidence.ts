// 증거 → (리뷰) → 관문 → 장부, 머지, PR 상태 (docs/m2-modules.md 3절 works.ts, docs/m2-app.md 1절 5~9).
// 계기: Stop 뒤 지금 계약으로 재지 않았거나 미리 리뷰(V23)를 돌릴 head면 debounceMs 몰아서(내보내기 아님), 세션이 git push·
// gh pr 뒤(또는 PR 확인에서) PR이 그 head를 가리키면 내보내기(리뷰 포함), [끝내기]·[그래도 끝내기](V25, works-end.ts). '이미
// 잰 것'은 (head, 계약 hash)이고 다시 재지 않는다. 내보내기는 같은 head·계약의 끝난 리뷰를 다시 쓴다(V23, works-review.ts).
// 한 Work의 증거 재기는 한 번에 하나이고, 기다리는 요청은 하나로 합친다. 재기가 끝나면 다음 재기 전에 [끝내기]의 걸린 끝을
// 다시 본다. 리뷰는 결정론적 증거와 관문을 먼저 보인 뒤 돌고 끝나면 다시 정한다(리뷰는 사람을 막지 않는다, V4). 장부 줄,
// exported_head, 정책 머지는 내보내기 계기에서만 생긴다(V23). 엔진 check는 in-process로 부른다. 리뷰 결과는 세션에 넣지
// 않는다(V4, V8).

import { git } from '../adapters/exec.ts'
import type { PrCheck } from '../adapters/gh.ts'
import { showFile } from '../adapters/git.ts'
import { evidencePath, repoKey, writeJson } from '../adapters/store.ts'
import { contractHash } from '../core/contract.ts'
import { gate } from '../core/gate.ts'
import { trackRecord, type LedgerEntry } from '../core/ledger.ts'
import { parseQuality } from '../core/quality.ts'
import type { Contract, EvidenceBundle, GateResult, Policy } from '../core/types.ts'
import { canMerge, nextState, type WorkEvent } from '../core/work.ts'
import { QUALITY_PATH } from '../engine/check.ts'
import type { MergeResult, PrInfo } from '../shared/api.ts'
import type { ProjectRecord, WorkRecord } from './store.ts'
import { ReviewDesk, reusable } from './works-review.ts'
import {
  isActive,
  measures,
  message,
  type ExportTrigger,
  type MeasureJob,
  type WorkCtx,
} from './works-types.ts'

const DEBOUNCE_MS = 20_000
const PR_POLL_MS = 120_000

/** 세션이 PR을 열거나 갱신했을 수 있는 Bash 명령 */
const EXPORT_COMMAND = /\bgit\b[^;&|\n]*\bpush\b|\bgh\b[^;&|\n]*\bpr\b/

export async function headOf(worktree: string): Promise<string> {
  return (await git(['rev-parse', 'HEAD'], worktree)).trim()
}

export function isExportCommand(command: string): boolean {
  return EXPORT_COMMAND.test(command)
}

/** 이 계약으로 만든 묶음인가(계약이 없으면 계약 없이 만든 묶음). 관문의 '증거를 만든 뒤 계약이 바뀜'과 같은 견줌이다 */
export function sameContract(e: EvidenceBundle, c: Contract | null): boolean {
  return c === null ? e.contract === null : e.contract?.hash === contractHash(c)
}

/** PR이 이 Work를 내보낸 것인가: 열려 있고, 지금 head를 가리키고, Work의 기준 브랜치로 간다 */
export function exportable(pr: PrInfo | null, base: string, head: string | null): boolean {
  return (
    pr !== null &&
    pr.state === 'OPEN' &&
    head !== null &&
    pr.headRefOid === head &&
    pr.baseRefName === base
  )
}

/** 머지를 막는 CI 검사(statusCheckRollup): 실패·취소, 아직 도는 것 */
export function blockingChecks(checks: PrCheck[]): { failed: string[]; pending: string[] } {
  const names = (b: PrCheck['bucket'][]) =>
    checks.filter((c) => b.includes(c.bucket)).map((c) => c.name || c.state)
  return { failed: names(['fail', 'cancel']), pending: names(['pending']) }
}

/** merge의 답. wait는 정책 머지가 기다릴 일(CI가 도는 중 등)이라 PR 확인에서 다시 해 볼 것 */
export type MergeOutcome = MergeResult & { wait?: boolean }

const short = (sha: string | null) => (sha ? sha.slice(0, 7) : '?')

export class EvidenceRunner {
  private readonly ctx: WorkCtx
  private readonly reviews: ReviewDesk

  constructor(ctx: WorkCtx) {
    this.ctx = ctx
    this.reviews = new ReviewDesk(ctx)
  }

  private get debounceMs(): number {
    return this.ctx.deps.debounceMs ?? DEBOUNCE_MS
  }

  /** 지금 계약으로 이 head를 이미 쟀나(내보내기라면 리뷰가 도는 동안 먼저 보인 묶음도 잰 것이다) */
  measured(id: string, head: string): boolean {
    const rt = this.ctx.runtime(id)
    return (
      rt.evidence !== null && rt.evidence.head === head && sameContract(rt.evidence, rt.contract)
    )
  }

  /** 지금 계약으로 이 head를 내보내기(리뷰까지)로 쟀나. 리뷰가 도는 동안은 아직 아니다 */
  exported(id: string, head: string): boolean {
    return this.ctx.record(id).exported_head === head && this.measured(id, head)
  }

  /**
   * 이 head의 미리 리뷰(V23)가 끝나 있어 내보내기가 다시 재지 않고 claude -p도 부르지 않는다. 아직 내보내기가 아니고, 도는
   * 재기도 줄 선 재기도 없다([끝내기]가 이것을 바로 내보내기로 잰다)
   */
  promotable(id: string, head: string): boolean {
    const rt = this.ctx.runtime(id)
    return (
      this.measured(id, head) &&
      reusable(rt.evidence?.review ?? null) &&
      !this.exported(id, head) &&
      rt.pending === null &&
      rt.measuring === null
    )
  }

  // ── 계기 ───────────────────────────────────────────────────────────────────

  /**
   * Stop: 지금 계약으로 재지 않은 head, 또는 잰 묶음에 미리 리뷰(V23)를 돌릴 head면 debounceMs 뒤 미리 리뷰를 허락한
   * 재기를 줄 세운다(그사이 Stop이 또 오면 다시 기다린다). 그때 이미 쟀고 미리 리뷰할 것도 없으면 재기가 바로 그만둔다
   */
  async onStop(id: string): Promise<void> {
    const rec = this.ctx.record(id)
    const rt = this.ctx.runtime(id)
    const head = await headOf(rec.worktree).catch(() => null)
    await this.ctx.seeHead(id, head)
    if (!measures(rec.state) || head === null) return
    if (this.measured(id, head) && !this.reviews.preparable(rec, rt.evidence, head)) return
    this.cancelDebounce(id)
    rt.debounce = setTimeout(() => {
      rt.debounce = null
      void this.run(id, { prepare: true }).catch((e) => this.ctx.log('증거 실패', e))
    }, this.debounceMs)
  }

  cancelDebounce(id: string): void {
    const rt = this.ctx.runtime(id)
    if (rt.debounce) clearTimeout(rt.debounce)
    rt.debounce = null
  }

  /**
   * PostToolUse(셸)의 git push·gh pr: PR이 지금 head를 가리키고 Work의 기준 브랜치로 가면 내보내기 후보로 잰다.
   * 기준이 다른 PR은 재지 않고 알린다(증거와 서버 보호는 Work의 기준으로 읽는다)
   */
  async onPush(id: string): Promise<void> {
    const rec = this.ctx.record(id)
    const pr = await this.refreshPr(rec)
    if (!pr || pr.state !== 'OPEN' || !measures(rec.state)) return
    const head = await headOf(rec.worktree).catch(() => null)
    await this.ctx.seeHead(id, head)
    if (pr.baseRefName !== rec.base) return this.wrongBase(rec, pr)
    if (head === null || !exportable(pr, rec.base, head)) return
    if (this.exported(id, head)) return
    this.cancelDebounce(id)
    await this.run(id, { export: 'pr' })
  }

  private async wrongBase(rec: WorkRecord, pr: PrInfo): Promise<void> {
    const error = `PR #${pr.number}의 기준 브랜치(${pr.baseRefName})가 Work의 기준(${rec.base})과 다름: 증거는 ${rec.base} 기준으로 잽니다. PR의 기준을 ${rec.base}로 바꾸세요`
    if (rec.error === error) return
    rec.error = error
    await this.ctx.save(rec)
    this.ctx.note(rec.id, { type: 'pr_wrong_base', pr: pr.number, base: pr.baseRefName })
  }

  // ── 증거 재기 ──────────────────────────────────────────────────────────────

  /**
   * check → (리뷰) → gate → (내보내기면 장부와 정책 머지). 돌고 있으면 그 뒤에 한 번 더 잰다(기다리는 요청은 합친다). 차례가
   * 와서 시작할 때 앞 재기가 이 head를 이미 쟀으면(내보내기면 다시 쓸 리뷰까지) 재지 않는다: 세션의 git push와 gh pr이
   * 잇달아 와도, 내보내기 리뷰가 도는 동안 gh pr이 또 와도 같은 head의 리뷰는 한 번이다. again([증거 다시 재기])이면 그래도
   * 잰다. 내보내기 결론이 자동 머지 후보이고 PR이 있으면 바로 머지해 본다(by 'policy')
   */
  run(
    id: string,
    o: { export?: ExportTrigger; prepare?: boolean; again?: boolean },
  ): Promise<void> {
    const rt = this.ctx.runtime(id)
    if (rt.pending) {
      rt.pending.export ??= o.export ?? null
      rt.pending.prepare ||= o.prepare === true
      rt.pending.again ||= o.again === true
      return rt.pending.done
    }
    const pending: MeasureJob & { done: Promise<void> } = {
      export: o.export ?? null,
      prepare: o.prepare === true,
      again: o.again === true,
      done: Promise.resolve(),
    }
    // 재기가 끝나면 다음 재기 전에 [끝내기]의 걸린 끝을 다시 본다(V25)
    pending.done = rt.chain.then(async () => {
      rt.pending = null
      await this.measure(id, pending)
      await this.ctx.settleEnd(id, pending)
    })
    rt.pending = pending
    rt.chain = pending.done.catch(() => {})
    return pending.done
  }

  /**
   * 같은 head·계약의 결정론 묶음이 있으면(again이 아니면) check를 다시 돌리지 않는다. 내보내기는 리뷰를 붙이고(다시 쓸 수
   * 있으면 그대로), 아니면 미리 리뷰를 허락한 재기만 미리 리뷰를 붙인다(V23). 리뷰가 끊겼으면(HEAD·계약이 바뀜, 앱을 닫음)
   * 그 결과를 버린다
   */
  private async measure(id: string, job: MeasureJob): Promise<void> {
    const rec = this.ctx.record(id)
    if (!isActive(rec.state)) return
    const rt = this.ctx.runtime(id)
    const { deps } = this.ctx
    const project = this.ctx.projectOf(rec)
    const trigger = job.export
    try {
      const head = await headOf(rec.worktree)
      await this.ctx.seeHead(id, head)
      const known = !job.again && this.measured(id, head) ? rt.evidence : null
      if (known !== null) {
        const done =
          trigger !== null
            ? this.exported(id, head) && reusable(known.review)
            : !job.prepare || !this.reviews.preparable(rec, known, head)
        if (done) return
      }
      rt.measuring = head
      rt.evidenceRunning = true
      this.ctx.publish(id)
      const contract = rt.contract
      let bundle = known ?? (await this.check(rec, head, trigger === null))
      // 재는 사이 [버림]·[머지]로 끝났거나 앱을 닫았으면(명령이 끊김) 관문도 장부도 남기지 않는다
      if (!isActive(rec.state) || rt.abort.signal.aborted) return
      const policy = await this.policy(rec, project, bundle)
      const show = (b: EvidenceBundle) => this.publishGate(rec, b, contract, policy)
      if (trigger !== null) {
        const reviewed = await this.reviews.forExport(
          rec,
          project,
          contract,
          bundle,
          policy,
          trigger,
          show,
        )
        // 끊긴 리뷰(HEAD·계약이 바뀜, 앱을 닫음)는 내보내기로 남기지 않는다: 다시 켜고 [끝내기]하면 다시 잰다
        if (reviewed === null || !isActive(rec.state) || rt.abort.signal.aborted) return
        bundle = reviewed
        rec.exported_head = bundle.head
      } else if (job.prepare && this.reviews.preparable(rec, bundle, head)) {
        const reviewed = await this.reviews.prepare(rec, project, contract, bundle, policy, show)
        if (reviewed === null || !isActive(rec.state) || rt.abort.signal.aborted) return
        bundle = reviewed
      }
      if (bundle.review !== null)
        await writeJson(evidencePath(deps.store.home, repoKey(bundle.repo), bundle.head), bundle)
      const result = await this.publishGate(rec, bundle, contract, policy)
      // 장부 줄과 정책 머지는 내보내기 계기에서만(V23): 중간 head가 그림자 실적이나 자동 머지에 닿지 않게
      if (trigger !== null)
        await deps.store.appendLedger(this.ledgerEntry(rec, project, bundle.head, result))
      // 사람이 기본 브랜치에 품질 기준을 커밋했으면 알림(V20)을 거둔다
      this.ctx.refreshQuality(project.id)
      this.ctx.note(id, {
        type: 'evidence',
        head: bundle.head,
        export: trigger !== null,
        ...(known !== null ? { reused: true } : {}),
        conclusion: result.conclusion,
        decisive: result.decisive,
        shadow: result.shadow,
      })
      if (
        trigger !== null &&
        result.conclusion === 'auto_merge_candidate' &&
        rec.pr?.state === 'OPEN'
      )
        await this.autoMerge(id)
    } catch (e) {
      rec.error = `증거를 재지 못함: ${message(e)}`
      this.ctx.log(`증거 실패 (${id})`, e)
      await this.ctx.save(rec)
    } finally {
      rt.evidenceRunning = false
      rt.reviewRunning = false
      rt.measuring = null
      this.ctx.publish(id)
    }
  }

  /**
   * 엔진 check. 내보내기가 아니면 같은 head·계약의 앞 묶음의 리뷰를 잇는다(again으로 다시 재도 지적이 사라지지 않게. 실패한
   * 리뷰도)
   */
  private async check(rec: WorkRecord, head: string, carry: boolean): Promise<EvidenceBundle> {
    const { deps } = this.ctx
    const rt = this.ctx.runtime(rec.id)
    const before = rt.evidence
    const contract = rt.contract
    const bundle = await deps.check({
      repo: rec.worktree,
      head,
      base: rec.base_ref,
      ...(contract ? { contractPath: deps.store.workPath(rec.id, 'contract.json') } : {}),
      requestPath: deps.store.workPath(rec.id, 'request.md'),
      home: deps.store.home,
      now: deps.now(),
    })
    if (carry && before?.review && before.head === bundle.head && sameContract(before, contract))
      return { ...bundle, review: before.review }
    return bundle
  }

  /** 묶음과 그 관문을 Work에 두고 화면에 보인다. 관문의 head는 지금 worktree의 HEAD다(V6) */
  private async publishGate(
    rec: WorkRecord,
    bundle: EvidenceBundle,
    contract: Contract | null,
    policy: Policy,
  ): Promise<GateResult> {
    const { deps } = this.ctx
    const rt = this.ctx.runtime(rec.id)
    const now = await headOf(rec.worktree).catch(() => null)
    const result = gate(bundle, contract, policy, now)
    rt.evidence = bundle
    await this.ctx.seeHead(rec.id, now ?? bundle.head)
    rec.gate = result
    rec.evidence_path = evidencePath(deps.store.home, repoKey(bundle.repo), bundle.head)
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
    let conditions: Policy['conditions'] = []
    if (bundle.quality.from !== 'none') {
      const sha = bundle.quality.from === 'base' ? bundle.base : bundle.head
      const text = await showFile(rec.worktree, sha, QUALITY_PATH).catch(() => null)
      const parsed = text === null ? null : parseQuality(text)
      if (parsed?.ok) conditions = parsed.value.auto
    }
    const server = await deps.gh.serverProtection(project.path, rec.base).catch(() => null)
    const ledger = await deps.store.readLedger()
    return {
      auto_merge_enabled: project.settings.auto_merge,
      conditions,
      server,
      track_record_ok: trackRecord(
        ledger,
        project.id,
        project.settings.min_shadow,
        this.versions(),
      ),
    }
  }

  private versions(): { model?: string; claude_version?: string; relay_version: string } {
    const { deps } = this.ctx
    return {
      ...(deps.model ? { model: deps.model } : {}),
      ...(deps.claudeVersion ? { claude_version: deps.claudeVersion } : {}),
      relay_version: deps.relayVersion,
    }
  }

  private ledgerEntry(
    rec: WorkRecord,
    project: ProjectRecord,
    head: string,
    result: Pick<GateResult, 'conclusion' | 'condition' | 'shadow'>,
    extra: Partial<LedgerEntry> = {},
  ): LedgerEntry {
    return {
      ts: this.ctx.deps.now(),
      project: project.id,
      work: rec.id,
      head,
      conclusion: result.conclusion,
      condition: result.condition,
      shadow: result.shadow,
      ...this.versions(),
      ...extra,
    }
  }

  /** 머지·닫힘을 장부에 남긴다. 실적에 다시 세지 않게 condition은 비우고 shadow는 거짓이다 */
  private async ledgerFate(
    rec: WorkRecord,
    head: string,
    fate: Pick<LedgerEntry, 'by' | 'merged_head' | 'closed'>,
  ): Promise<void> {
    const conclusion = rec.gate?.conclusion ?? 'human_merge'
    const entry = this.ledgerEntry(
      rec,
      this.ctx.projectOf(rec),
      head,
      { conclusion, condition: null, shadow: false },
      fate,
    )
    await this.ctx.deps.store.appendLedger(entry)
  }

  // ── 머지 ───────────────────────────────────────────────────────────────────

  /**
   * [머지]와 정책 머지: 구현 중이고, 관문이 지금 계약으로 계산됐고, PR이 Work의 기준으로 가고 그 head가 묶음의 head와 같고,
   * CI(statusCheckRollup)가 실패·진행 중이 아니고, gh가 머지할 수 있다고 할 때만 `gh pr merge --match-head-commit`.
   * 장부에 누가 어느 head를 머지했는지 남기고 Work를 끝낸다. 한 Work의 머지는 한 번에 하나다
   */
  async merge(id: string, by: 'human' | 'policy' = 'human'): Promise<MergeOutcome> {
    const rec = this.ctx.record(id)
    const rt = this.ctx.runtime(id)
    if (rt.merging) return { ok: false, error: '이미 머지하는 중' }
    rt.merging = true
    try {
      return await this.mergeOnce(rec, by)
    } finally {
      rt.merging = false
    }
  }

  private async mergeOnce(rec: WorkRecord, by: 'human' | 'policy'): Promise<MergeOutcome> {
    const id = rec.id
    const rt = this.ctx.runtime(id)
    const { gh } = this.ctx.deps
    const project = this.ctx.projectOf(rec)
    // wait: 정책 머지가 기다릴 일이면 실패로 적지 않는다(PR 확인에서 다시 해 본다)
    const fail = async (error: string, wait = false): Promise<MergeOutcome> => {
      if (wait && by === 'policy') return { ok: false, error, wait: true }
      rec.error = `머지하지 못함: ${error}`
      await this.ctx.save(rec)
      if (by === 'human') this.ctx.note(id, { type: 'merge_failed', by, error })
      return { ok: false, error }
    }
    if (!canMerge(rec.state)) return fail('구현 중인 Work만 머지할 수 있음')
    const bundle = rt.evidence
    if (!rec.gate || !bundle) return fail('관문이 아직 계산되지 않음: 증거를 먼저 재세요')
    if (!sameContract(bundle, rt.contract))
      return fail('증거를 만든 뒤 계약이 바뀜: 증거를 다시 재세요')
    const pr = await this.refreshPr(rec)
    if (!pr) return fail('PR이 없음')
    if (pr.state !== 'OPEN') return fail(`PR이 열려 있지 않음 (${pr.state})`)
    if (pr.baseRefName !== rec.base)
      return fail(`PR의 기준 브랜치(${pr.baseRefName})가 Work의 기준(${rec.base})과 다름`)
    if (pr.headRefOid !== bundle.head) return fail(this.headMismatch(id, pr.headRefOid))
    const status = await gh.prStatus(project.path, pr.number)
    if (!status.ok) return fail(status.error, true)
    if (status.headRefOid && status.headRefOid !== bundle.head)
      return fail(this.headMismatch(id, status.headRefOid))
    const ci = blockingChecks(status.checks)
    if (ci.failed.length > 0) return fail(`CI 실패 (${ci.failed.join(', ')})`)
    if (ci.pending.length > 0)
      return fail(`CI가 아직 돎 (${ci.pending.join(', ')}): 끝난 뒤 머지하세요`, true)
    if (status.mergeable === 'UNKNOWN')
      return fail('GitHub가 아직 머지할 수 있는지 정하지 않음: 잠시 뒤 다시 하세요', true)
    if (status.mergeable !== 'MERGEABLE')
      return fail(`GitHub가 머지할 수 없다고 함 (${status.mergeable}, ${status.mergeStateStatus})`)
    const r = await gh.mergePr(project.path, pr.number, bundle.head, project.settings.merge_method)
    if (!r.ok) return fail(r.error ?? 'gh pr merge 실패')
    await this.ledgerFate(rec, bundle.head, { by, merged_head: bundle.head })
    rec.pr = { ...pr, state: 'MERGED', mergedAt: this.ctx.deps.now() }
    rec.error = null
    this.ctx.note(id, { type: 'merged', by, head: bundle.head, pr: pr.number })
    await this.close(rec, { type: 'pr_merged' })
    return { ok: true }
  }

  /** PR의 head가 증거의 head와 다를 때 할 일: PR이 지금 HEAD를 가리키지 않으면 push, 가리키면 다시 재기 */
  private headMismatch(id: string, prHead: string): string {
    const rt = this.ctx.runtime(id)
    if (rt.head !== null && prHead !== rt.head)
      return `PR의 head(${short(prHead)})가 지금 HEAD(${short(rt.head)})가 아님: 세션에게 push를 요청하세요`
    return `PR의 head(${short(prHead)})가 증거의 head(${short(rt.evidence?.head ?? null)})와 다름: 증거를 다시 재세요`
  }

  /**
   * 정책의 자동 머지. 기다릴 일(CI가 도는 중, GitHub가 아직 정하지 않음, gh 오류)이면 오류로 적지 않는다. 열린 PR의 확인이
   * 결론이 그대로인 동안 다시 해 본다. 같은 까닭은 기록에 한 번만 남긴다
   */
  private async autoMerge(id: string): Promise<void> {
    if (!canMerge(this.ctx.record(id).state)) return
    const rt = this.ctx.runtime(id)
    const r = await this.merge(id, 'policy')
    if (r.ok || r.error === rt.autoMergeNote) return
    rt.autoMergeNote = r.error ?? null
    this.ctx.note(id, { type: r.wait ? 'auto_merge_waiting' : 'auto_merge_failed', error: r.error })
  }

  // ── PR 상태 ────────────────────────────────────────────────────────────────

  /** PR을 다시 읽어 Work에 둔다. 열려 있으면 120초마다 다시 읽는다 */
  async refreshPr(rec: WorkRecord): Promise<PrInfo | null> {
    const project = this.ctx.projectOf(rec)
    const pr = await this.ctx.deps.gh.findPr(project.path, rec.branch).catch(() => null)
    if (pr && JSON.stringify(pr) !== JSON.stringify(rec.pr)) {
      rec.pr = pr
      await this.ctx.save(rec)
    }
    if (pr?.state === 'OPEN' && isActive(rec.state)) this.startPoll(rec.id)
    return pr ?? rec.pr
  }

  startPoll(id: string): void {
    const rt = this.ctx.runtime(id)
    if (rt.poll) return
    rt.poll = setInterval(() => {
      void this.poll(id).catch((e) => this.ctx.log(`PR 확인 실패 (${id})`, e))
    }, this.ctx.deps.prPollMs ?? PR_POLL_MS)
  }

  stopPoll(id: string): void {
    const rt = this.ctx.runtime(id)
    if (rt.poll) clearInterval(rt.poll)
    rt.poll = null
  }

  /**
   * PR이 앱 밖(GitHub)에서 머지되거나 닫혔으면 Work를 끝내고 장부에 남긴다. 열려 있으면 followPr. 머지가 도는 동안은
   * 건너뛴다(정책 머지가 human-override로 남지 않게)
   */
  async poll(id: string): Promise<void> {
    const rec = this.ctx.record(id)
    if (!isActive(rec.state)) return this.stopPoll(id)
    const rt = this.ctx.runtime(id)
    if (rt.merging) return
    const pr = await this.refreshPr(rec)
    if (!pr || !isActive(rec.state) || rt.merging) return
    if (pr.state === 'MERGED') {
      await this.ledgerFate(rec, pr.headRefOid, {
        by: 'human-override',
        merged_head: pr.headRefOid,
      })
      this.ctx.note(id, { type: 'merged_outside', head: pr.headRefOid, pr: pr.number })
      await this.close(rec, { type: 'pr_merged' })
    } else if (pr.state === 'CLOSED') {
      await this.ledgerFate(rec, pr.headRefOid, { closed: true })
      this.ctx.note(id, { type: 'pr_closed', pr: pr.number })
      await this.close(rec, { type: 'pr_closed' })
    } else await this.followPr(rec, pr)
  }

  /**
   * 열린 PR: PR이 지금 HEAD를 가리키게 됐는데 그 head를 내보내기로 재지 않았으면 잰다(push 뒤 GitHub가 PR을 늦게 갱신한
   * 경우). 이미 쟀고 결론이 자동 머지 후보면 다시 머지해 본다(CI가 리뷰보다 늦게 끝난 경우)
   */
  private async followPr(rec: WorkRecord, pr: PrInfo): Promise<void> {
    const rt = this.ctx.runtime(rec.id)
    if (rec.state !== 'working' || rt.measuring !== null || rt.pending) return
    if (pr.baseRefName !== rec.base) return this.wrongBase(rec, pr)
    const head = await headOf(rec.worktree).catch(() => null)
    if (head === null || !exportable(pr, rec.base, head)) return
    if (!this.exported(rec.id, head)) return this.run(rec.id, { export: 'pr' })
    if (rec.gate?.conclusion === 'auto_merge_candidate') await this.autoMerge(rec.id)
  }

  /** Work를 끝낸다. 그사이 다른 길로 이미 끝났으면 그대로 둔다 */
  private async close(rec: WorkRecord, ev: WorkEvent): Promise<void> {
    if (!isActive(rec.state)) return
    const next = nextState(rec.state, ev)
    if (!next.ok) throw new Error(next.errors.join('; '))
    rec.state = next.value
    await this.ctx.save(rec)
    await this.ctx.finish(rec.id)
  }
}

// 내보내기의 머지와 PR 따라가기 (V22, docs/m2-modules.md 3절 works.ts의 merge·PR 확인). works-evidence.ts가 600줄을 넘지
// 않게 나눴다. 내보내기(one_branch는 Work 브랜치 하나, branch_per_unit은 단위 브랜치마다)마다 PR을 읽고(gh pr list --head
// <브랜치>), 열린 PR이 있으면 120초마다 다시 읽는다. PR이 앱 밖에서 머지되거나 닫힌 것을 처음 본 때 장부에 그 내보내기의
// 끝을 남긴다. [머지]와 정책 머지는 내보내기마다 하고, 정책 머지는 그때의 통합 증거로 관문을 다시 본다(V22). Work는
// 내보내기의 PR이 모두 머지되거나 닫히면 끝난다(철학 3장 9 'PR이 모두'). 열린 PR이 내보내기의 지금 끝을 가리키는데 그 끝을
// 내보내기로 재지 않았으면 잰다(push 뒤 GitHub가 PR을 늦게 갱신한 경우).

import type { PrCheck } from '../adapters/gh.ts'
import type { EvidenceBundle, GateResult, Policy } from '../core/types.ts'
import type { LedgerEntry } from '../engine/ledger.ts'
import { canMerge, nextState, type WorkEvent } from '../core/work.ts'
import { worseOf } from '../engine/debt-record.ts'
import { exportHeads, lastConclusion } from '../engine/follow.ts'
import { NO_COMMITS } from '../engine/session-commits.ts'
import type { MergeResult, PrInfo } from '../shared/api.ts'
import type { ExportRecord, ProjectRecord, WorkRecord } from './store.ts'
import type { EvidenceRunner } from './works-evidence.ts'
import { acceptedOf, debtable, recordDebt } from './works-debt.ts'
import { epochLine, ledgerEntry, trackFor, type ExportJob } from './works-ledger.ts'
import { earlierAfter } from './works-change.ts'
import { mergedFields, mergeOf } from './works-record.ts'
import { sessionLedger, sessionOf } from './works-session-log.ts'
import { autoConditions } from './works-review.ts'
import {
  delivered,
  exportContract,
  isActive,
  message,
  perUnit,
  readTips,
  tipOf,
  type WorkCtx,
  type WorksDeps,
  workHead,
} from './works-types.ts'

/** merge의 답. wait는 정책 머지가 기다릴 일(CI가 도는 중 등)이라 PR 확인에서 다시 해 볼 것 */
export type MergeOutcome = MergeResult & { wait?: boolean }

const PR_POLL_MS = 120_000

/** 빚 기록 커밋을 push한 뒤 PR이 그 head를 가리키기를 기다리는 횟수와 간격(M3b) */
const PR_WAIT_TRIES = 5
const PR_WAIT_MS = 1_000

const short = (sha: string | null) => (sha ? sha.slice(0, 7) : '?')

/** PR이 이 내보내기를 내보낸 것인가: 열려 있고, 그 브랜치의 지금 끝을 가리키고, Work의 기준 브랜치로 간다 */
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

/**
 * 내보내기 계기의 결론 줄. 나빠진 래칫(M3b)을 함께 남긴다: 다음 Work가 기록 안 된 나빠짐을 찾는 앞 기록이다. M4a의 칸(채운
 * 조건 전부, 조건 hash, 판, PR·base, 승인 주체)은 works-ledger.ts epochLine
 */
export function exportLine(
  deps: WorksDeps,
  j: ExportJob,
  result: Pick<GateResult, 'conclusion' | 'condition' | 'shadow'>,
): LedgerEntry {
  const { rec, x, project, bundle } = j
  const worse = worseOf(bundle.ratchets)
  const extra = { ...epochLine(deps, j, result), ...(worse.length > 0 ? { worse } : {}) }
  return ledgerEntry(deps, rec, x, project, bundle.head, result, extra)
}

/** 관문의 정책: 프로젝트 설정, 묶음이 쓴 quality.json의 auto, 서버 보호, 이 묶음의 판(M4a)의 그림자 실적 */
export async function policyFor(
  ctx: WorkCtx,
  rec: WorkRecord,
  project: ProjectRecord,
  bundle: EvidenceBundle,
): Promise<Policy> {
  const { deps } = ctx
  const conditions = await autoConditions(rec.worktree, bundle)
  const server = await deps.gh.serverProtection(project.path, rec.base).catch(() => null)
  return {
    auto_merge_enabled: project.settings.auto_merge,
    conditions,
    server,
    track_record_ok: await trackFor(ctx, rec, project, conditions, bundle),
  }
}

/** events.jsonl에 단위를 붙인다(V22). Work 브랜치의 내보내기는 붙이지 않는다 */
export const unitOf = (x: ExportRecord): { unit?: string } =>
  x.unit === null ? {} : { unit: x.unit }

export class ExportDesk {
  private readonly ctx: WorkCtx
  private readonly runner: EvidenceRunner

  constructor(ctx: WorkCtx, runner: EvidenceRunner) {
    this.ctx = ctx
    this.runner = runner
  }

  // ── 머지 ───────────────────────────────────────────────────────────────────

  /**
   * [머지]와 정책 머지(내보내기 하나): 구현 중이고, 관문이 지금 계약으로 계산됐고, PR이 Work의 기준으로 가고 그 head가
   * 묶음의 head와 같고, CI(statusCheckRollup)가 실패·진행 중이 아니고, gh가 머지할 수 있다고 할 때만 `gh pr merge
   * --match-head-commit`. 장부에 누가 어느 head를 머지했는지 남기고, 내보내기의 PR이 모두 끝났으면 Work를 끝낸다. 한 Work의
   * 머지는 한 번에 하나다. debt는 사람의 [빚으로 남기고 머지](M3b): 머지할 수 있는 PR이면 먼저 빚을 커밋하고 push한다
   */
  async merge(
    id: string,
    unit: string | null,
    by: 'human' | 'policy' = 'human',
    debt = false,
  ): Promise<MergeOutcome> {
    const rec = this.ctx.record(id)
    const rt = this.ctx.runtime(id)
    if (rt.merging) return { ok: false, error: '이미 머지하는 중' }
    // 단위의 내보내기. 단위가 없으면 Work 브랜치의 내보내기(one_branch)
    const x = rec.exports.find((e) => e.unit === unit)
    if (!x)
      return { ok: false, error: unit === null ? '단위를 골라 주세요' : `단위가 없음: ${unit}` }
    rt.merging = true
    try {
      if (debt && by === 'human') {
        const r = await this.recordFirst(rec, x).catch((e: unknown) => message(e))
        if (typeof r === 'string') return { ok: false, error: `빚을 기록하지 못함: ${r}` }
      }
      return await this.mergeOnce(rec, x, by)
    } finally {
      rt.merging = false
    }
  }

  private async mergeOnce(
    rec: WorkRecord,
    x: ExportRecord,
    by: 'human' | 'policy',
  ): Promise<MergeOutcome> {
    const id = rec.id
    const rt = this.ctx.runtime(id)
    const { gh } = this.ctx.deps
    const project = this.ctx.projectOf(rec)
    // wait: 정책 머지가 기다릴 일이면 실패로 적지 않는다(PR 확인에서 다시 해 본다)
    const fail = async (error: string, wait = false): Promise<MergeOutcome> => {
      if (wait && by === 'policy') return { ok: false, error, wait: true }
      rec.error = `머지하지 못함: ${error}`
      await this.ctx.save(rec)
      if (by === 'human') this.ctx.note(id, { type: 'merge_failed', by, error, ...unitOf(x) })
      return { ok: false, error }
    }
    if (!canMerge(rec.state)) return fail('구현 중인 Work만 머지할 수 있음')
    const bundle = rt.bundles.get(x.branch) ?? null
    if (!x.gate || !bundle) return fail('관문이 아직 계산되지 않음: 증거를 먼저 재세요')
    if (!this.runner.sameContract(bundle, exportContract(rt, x)))
      return fail('증거를 만든 뒤 계약이 바뀜: 증거를 다시 재세요')
    // 정책 머지는 그때의 통합 증거로 다시 본다(V22): 내보내기를 잰 뒤 Work 브랜치가 바뀌었을 수 있다
    if (by === 'policy' && perUnit(rec) && !(await this.runner.stillAuto(rec, x)))
      return fail('통합 증거가 자동 조건을 채우지 않음: 다시 잰 뒤 정합니다', true)
    const pr = await this.refreshPr(rec, x, true)
    if (!pr) return fail('PR이 없음')
    if (pr.state !== 'OPEN') return fail(`PR이 열려 있지 않음 (${pr.state})`)
    if (pr.baseRefName !== rec.base)
      return fail(`PR의 기준 브랜치(${pr.baseRefName})가 Work의 기준(${rec.base})과 다름`)
    if (pr.headRefOid !== bundle.head) return fail(this.headMismatch(rec, x, pr.headRefOid))
    const status = await gh.prStatus(project.path, pr.number)
    if (!status.ok) return fail(status.error, true)
    if (status.headRefOid && status.headRefOid !== bundle.head)
      return fail(this.headMismatch(rec, x, status.headRefOid))
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
    const accepted = by === 'human' ? acceptedOf(bundle) : {}
    // 앱이 묶음의 head를 --match-head-commit으로 머지했다: 같은 변경이고, 머지 커밋과 때를 읽어 둔다(M4b)
    const merged = await mergeOf(this.ctx.deps, project.path, pr.number)
    // 앞 결론 줄의 head 뒤 커밋의 갈래(M4e): 머지한 head는 Work 브랜치에 있으니 worktree에서 읽는다
    const earlier = await earlierAfter(rec.worktree, rec.base_ref, {
      heads: exportHeads(await this.ctx.deps.store.readLedger(), rec.id, x.unit),
      merged: bundle.head,
      exclude: rec.base_ref,
      session: await sessionOf(this.ctx.deps.store, rec.id),
      work: rec.id,
    }).catch(() => ({}))
    const fate = {
      by,
      merged_head: bundle.head,
      same_change: true,
      pr: pr.number,
      after_commits: { ...NO_COMMITS },
      ...(Object.keys(earlier).length > 0 ? { after_heads: earlier } : {}),
      ...merged,
    }
    await this.ledgerFate(rec, x, bundle.head, { ...fate, ...accepted })
    if (accepted.accepted) this.ctx.refreshQuality(project.id)
    x.pr = { ...pr, state: 'MERGED', mergedAt: this.ctx.deps.now() }
    rec.error = null
    this.ctx.note(id, { type: 'merged', by, head: bundle.head, pr: pr.number, ...unitOf(x) })
    await this.ctx.save(rec)
    await this.settleWork(rec)
    return { ok: true }
  }

  /**
   * [빚으로 남기고 머지](M3b): 구현 중이고, 지금 계약의 묶음이 기록할 빚을 지녔고, 열린 PR이 Work의 기준으로 가며 묶음의
   * head를 가리키고, CI가 실패하지 않았고 GitHub가 머지할 수 없다고 하지 않을 때만 빚을 커밋하고 push한다(아니면 그대로 두고
   * 머지가 까닭을 말한다). push 뒤 PR이 새 head를 가리킬 때까지
   * 잠깐 다시 읽는다(GitHub가 늦게 갱신한다)
   */
  private async recordFirst(rec: WorkRecord, x: ExportRecord): Promise<void> {
    const rt = this.ctx.runtime(rec.id)
    const bundle = rt.bundles.get(x.branch)
    if (!canMerge(rec.state) || !x.gate || !bundle || !debtable(rec, x, bundle)) return
    if (!this.runner.sameContract(bundle, exportContract(rt, x))) return
    const pr = await this.refreshPr(rec, x, true)
    if (pr?.state !== 'OPEN' || pr.baseRefName !== rec.base || pr.headRefOid !== bundle.head) return
    // 머지가 실패할 것이 이미 보이면(CI 실패, 충돌 등) 사람의 브랜치에 커밋하지 않는다. 도는 CI는 push가 어차피 다시 돌린다
    const status = await this.ctx.deps.gh.prStatus(this.ctx.projectOf(rec).path, pr.number)
    if (!status.ok || blockingChecks(status.checks).failed.length > 0) return
    if (status.mergeable !== 'MERGEABLE' && status.mergeable !== 'UNKNOWN') return
    const head = await recordDebt(this.ctx, rec, x)
    for (let i = 0; head !== null && i < PR_WAIT_TRIES; i++) {
      if ((await this.refreshPr(rec, x, true))?.headRefOid === head) return
      await new Promise((r) => setTimeout(r, PR_WAIT_MS))
    }
  }

  /** [그래도 끝내기](M3b): 머지되지 않은 내보내기마다 받아들인 나빠진 래칫을 장부에 남긴다(빚을 기록했으면 그 id) */
  async ledgerAccepted(rec: WorkRecord): Promise<void> {
    const rt = this.ctx.runtime(rec.id)
    for (const x of rec.exports) {
      const b = rt.bundles.get(x.branch)
      const accepted = acceptedOf(b)
      if (!b || delivered(x) || !accepted.accepted) continue
      const result = {
        conclusion: x.gate?.conclusion ?? 'human_merge',
        condition: null,
        shadow: false,
      }
      const project = this.ctx.projectOf(rec)
      await this.ctx.deps.store.appendLedger(
        ledgerEntry(this.ctx.deps, rec, x, project, b.head, result, accepted),
      )
    }
    this.ctx.refreshQuality(rec.project)
  }

  /** PR의 head가 증거의 head와 다를 때 할 일: PR이 지금 끝을 가리키지 않으면 push, 가리키면 다시 재기 */
  private headMismatch(rec: WorkRecord, x: ExportRecord, prHead: string): string {
    const rt = this.ctx.runtime(rec.id)
    const tip = tipOf(x, rt.head, rt.tips)
    if (tip !== null && prHead !== tip)
      return `PR의 head(${short(prHead)})가 지금 HEAD(${short(tip)})가 아님: 세션에게 push를 요청하세요`
    const head = rt.bundles.get(x.branch)?.head ?? null
    return `PR의 head(${short(prHead)})가 증거의 head(${short(head)})와 다름: 증거를 다시 재세요`
  }

  /**
   * 정책의 자동 머지. 기다릴 일(CI가 도는 중, GitHub가 아직 정하지 않음, gh 오류)이면 오류로 적지 않는다. 열린 PR의 확인이
   * 결론이 그대로인 동안 다시 해 본다. 같은 까닭은 기록에 한 번만 남긴다
   */
  async autoMerge(id: string, x: ExportRecord): Promise<void> {
    if (!canMerge(this.ctx.record(id).state)) return
    const rt = this.ctx.runtime(id)
    const r = await this.merge(id, x.unit, 'policy')
    if (r.ok || r.error === rt.autoMergeNote) return
    rt.autoMergeNote = r.error ?? null
    this.ctx.note(id, {
      type: r.wait ? 'auto_merge_waiting' : 'auto_merge_failed',
      error: r.error,
      ...unitOf(x),
    })
  }

  // ── 장부 ───────────────────────────────────────────────────────────────────

  /**
   * 머지·닫힘을 장부에 남긴다. 실적에 다시 세지 않게 condition은 비우고 shadow는 거짓이다. head는 내보낸 head(같은 변경을 그
   * head에 대해 적는다, M4b)
   */
  async ledgerFate(
    rec: WorkRecord,
    x: ExportRecord,
    head: string,
    fate: Partial<LedgerEntry>,
  ): Promise<void> {
    const conclusion = x.gate?.conclusion ?? 'human_merge'
    // 세션 커밋 집합의 셈(M4e). 머지 칸이 갈래를 가져오면 그것을 쓴다
    const session = sessionLedger(await sessionOf(this.ctx.deps.store, rec.id), null)
    const entry = ledgerEntry(
      this.ctx.deps,
      rec,
      x,
      this.ctx.projectOf(rec),
      head,
      { conclusion, condition: null, shadow: false },
      { ...session, ...fate },
    )
    await this.ctx.deps.store.appendLedger(entry)
  }

  // ── PR 상태 ────────────────────────────────────────────────────────────────

  /**
   * 내보내기의 PR을 다시 읽어 둔다. 앱 밖에서 머지되거나 닫힌 것을 처음 보면 장부와 기록에 남긴다. 머지가 도는 동안은 그
   * 머지가 남긴다(정책 머지가 human-override로 남지 않게): own은 그 머지가 gh를 부르기 전에 읽는 것이다. 열려 있으면 120초마다
   * 다시 읽는다
   */
  async refreshPr(rec: WorkRecord, x: ExportRecord, own = false): Promise<PrInfo | null> {
    const project = this.ctx.projectOf(rec)
    const pr = await this.ctx.deps.gh.findPr(project.path, x.branch).catch(() => null)
    if (pr && JSON.stringify(pr) !== JSON.stringify(x.pr)) {
      const before = x.pr?.state ?? null
      x.pr = pr
      await this.ctx.save(rec)
      if (pr.state !== before && (own || !this.ctx.runtime(rec.id).merging))
        await this.fate(rec, x, pr)
    }
    if (pr?.state === 'OPEN' && isActive(rec.state)) this.startPoll(rec.id)
    return pr ?? x.pr
  }

  /**
   * 앱 밖에서 머지되거나 닫힌 PR을 장부와 기록에 남긴다. 끝난 Work는 끝까지 따라가기(works-record.ts)가 맡는다. 머지 끝 줄의
   * head는 그 내보내기의 마지막 결론 줄의 head이고, 머지 커밋·때와 같은 변경을 함께 적는다(M4b)
   */
  private async fate(rec: WorkRecord, x: ExportRecord, pr: PrInfo): Promise<void> {
    if (!isActive(rec.state)) return
    if (pr.state === 'MERGED') {
      // 잰 head를 앱 밖에서 머지했으면 그 나빠진 래칫도 받아들였다(M3b: 빚으로 기록하지 못함)
      const b = this.ctx.runtime(rec.id).bundles.get(x.branch)
      const { deps } = this.ctx
      const ledger = await deps.store.readLedger()
      const last = lastConclusion(ledger, rec.id, x.unit)
      const earlier = exportHeads(ledger, rec.id, x.unit)
      const project = this.ctx.projectOf(rec)
      const fields = await mergedFields(deps, { project, rec, x, pr, last, earlier })
      await this.ledgerFate(rec, x, last?.head ?? pr.headRefOid, {
        by: 'human-override',
        merged_head: pr.headRefOid,
        ...fields,
        ...(b?.head === pr.headRefOid ? acceptedOf(b) : {}),
      })
      this.ctx.note(rec.id, {
        type: 'merged_outside',
        head: pr.headRefOid,
        pr: pr.number,
        ...unitOf(x),
      })
    } else if (pr.state === 'CLOSED') {
      await this.ledgerFate(rec, x, pr.headRefOid, { closed: true, pr: pr.number })
      this.ctx.note(rec.id, { type: 'pr_closed', pr: pr.number, ...unitOf(x) })
    }
  }

  startPoll(id: string): void {
    const rt = this.ctx.runtime(id)
    if (rt.poll) return
    rt.poll = setInterval(() => {
      if (rt.polling) return
      rt.polling = true
      void this.poll(id)
        .catch((e) => this.ctx.log(`PR 확인 실패 (${id})`, e))
        .finally(() => {
          rt.polling = false
        })
    }, this.ctx.deps.prPollMs ?? PR_POLL_MS)
  }

  stopPoll(id: string): void {
    const rt = this.ctx.runtime(id)
    if (rt.poll) clearInterval(rt.poll)
    rt.poll = null
  }

  /**
   * 내보내기마다 PR을 다시 읽는다(머지된 것은 빼고). 열려 있으면 followPr. 내보내기의 PR이 모두 머지되거나 닫혔으면 Work를
   * 끝낸다. 머지가 도는 동안은 건너뛴다
   */
  async poll(id: string): Promise<void> {
    const rec = this.ctx.record(id)
    if (!isActive(rec.state)) return this.stopPoll(id)
    const rt = this.ctx.runtime(id)
    for (const x of rec.exports) {
      if (rt.merging || !isActive(rec.state)) return
      if (x.pr?.state === 'MERGED') continue
      const pr = await this.refreshPr(rec, x)
      if (pr?.state === 'OPEN' && !rt.merging && isActive(rec.state))
        await this.followPr(rec, x, pr)
    }
    if (!rt.merging) await this.settleWork(rec)
  }

  /**
   * 열린 PR: PR이 내보내기의 지금 끝을 가리키게 됐는데 지금 묶음이 그 끝을 내보내기로 잰 것이 아니면 잰다(push 뒤 GitHub가
   * PR을 늦게 갱신한 경우. 미리 리뷰만 있는 묶음은 내보내기가 다시 써서 장부에 남긴다). 내보내기 묶음이고 결론이 자동 머지
   * 후보면 다시 머지해 본다(CI가 리뷰보다 늦게 끝난 경우)
   */
  private async followPr(rec: WorkRecord, x: ExportRecord, pr: PrInfo): Promise<void> {
    const rt = this.ctx.runtime(rec.id)
    if (rec.state !== 'working' || rt.measuring !== null || rt.pending) return
    if (pr.baseRefName !== rec.base) return this.wrongBase(rec, pr)
    const head = await workHead(rec).catch(() => null)
    const tip = tipOf(x, head, await readTips(rec))
    if (tip === null || !exportable(pr, rec.base, tip)) return
    if (!this.runner.exported(rec.id, x, tip))
      return this.runner.run(rec.id, { export: 'pr', only: [x.branch] })
    if (x.gate?.conclusion === 'auto_merge_candidate') await this.autoMerge(rec.id, x)
  }

  /** 기준이 다른 PR은 재지 않고 알린다(증거와 서버 보호는 Work의 기준으로 읽는다) */
  async wrongBase(rec: WorkRecord, pr: PrInfo): Promise<void> {
    const error = `PR #${pr.number}의 기준 브랜치(${pr.baseRefName})가 Work의 기준(${rec.base})과 다름: 증거는 ${rec.base} 기준으로 잽니다. PR의 기준을 ${rec.base}로 바꾸세요`
    if (rec.error === error) return
    rec.error = error
    await this.ctx.save(rec)
    this.ctx.note(rec.id, { type: 'pr_wrong_base', pr: pr.number, base: pr.baseRefName })
  }

  /**
   * 내보내기의 PR이 모두 머지되거나 닫혔으면 Work를 끝낸다(하나라도 머지됐으면 PR 머지, 아니면 PR 닫힘). 그사이 다른 길로
   * 이미 끝났으면 그대로 둔다
   */
  async settleWork(rec: WorkRecord): Promise<void> {
    if (!isActive(rec.state)) return
    const states = rec.exports.map((x) => x.pr?.state)
    if (!states.every((s) => s === 'MERGED' || s === 'CLOSED')) return
    const ev: WorkEvent = { type: states.includes('MERGED') ? 'pr_merged' : 'pr_closed' }
    const next = nextState(rec.state, ev)
    if (!next.ok) throw new Error(next.errors.join('; '))
    rec.state = next.value
    await this.ctx.save(rec)
    await this.ctx.finish(rec.id)
  }
}

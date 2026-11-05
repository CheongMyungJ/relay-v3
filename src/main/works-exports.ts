// 내보내기의 머지와 PR 따라가기 (V22, docs/m2-modules.md 3절 works.ts의 merge·PR 확인). works-evidence.ts가 600줄을 넘지
// 않게 나눴다. 내보내기(one_branch는 Work 브랜치 하나, branch_per_unit은 단위 브랜치마다)마다 PR을 읽고(gh pr list --head
// <브랜치>), 열린 PR이 있으면 120초마다 다시 읽는다. PR이 앱 밖에서 머지되거나 닫힌 것을 처음 본 때 장부에 그 내보내기의
// 끝을 남긴다. [머지]와 정책 머지는 내보내기마다 하고, 정책 머지는 그때의 통합 증거로 관문을 다시 본다(V22). Work는
// 내보내기의 PR이 모두 머지되거나 닫히면 끝난다(철학 3장 9 'PR이 모두'). 열린 PR이 내보내기의 지금 끝을 가리키는데 그 끝을
// 내보내기로 재지 않았으면 잰다(push 뒤 GitHub가 PR을 늦게 갱신한 경우).

import type { PrCheck } from '../adapters/gh.ts'
import type { EvidenceBundle, GateResult, Policy } from '../core/types.ts'
import { trackRecord, type LedgerEntry } from '../core/ledger.ts'
import { canMerge, nextState, type WorkEvent } from '../core/work.ts'
import type { MergeResult, PrInfo } from '../shared/api.ts'
import type { ExportRecord, ProjectRecord, WorkRecord } from './store.ts'
import type { EvidenceRunner } from './works-evidence.ts'
import { autoConditions } from './works-review.ts'
import {
  exportContract,
  isActive,
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

/** 장부의 판: 결론을 낼 때의 모델·Claude Code·relay 버전 */
export function versions(deps: WorksDeps): {
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
  deps: WorksDeps,
  rec: WorkRecord,
  x: ExportRecord,
  project: ProjectRecord,
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

/** 관문의 정책: 프로젝트 설정, 묶음이 쓴 quality.json의 auto, 서버 보호, 그림자 실적 */
export async function policyFor(
  ctx: WorkCtx,
  rec: WorkRecord,
  project: ProjectRecord,
  bundle: EvidenceBundle,
): Promise<Policy> {
  const { deps } = ctx
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
   * 머지는 한 번에 하나다
   */
  async merge(
    id: string,
    unit: string | null,
    by: 'human' | 'policy' = 'human',
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
    await this.ledgerFate(rec, x, bundle.head, { by, merged_head: bundle.head })
    x.pr = { ...pr, state: 'MERGED', mergedAt: this.ctx.deps.now() }
    rec.error = null
    this.ctx.note(id, { type: 'merged', by, head: bundle.head, pr: pr.number, ...unitOf(x) })
    await this.ctx.save(rec)
    await this.settleWork(rec)
    return { ok: true }
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

  /** 머지·닫힘을 장부에 남긴다. 실적에 다시 세지 않게 condition은 비우고 shadow는 거짓이다 */
  async ledgerFate(
    rec: WorkRecord,
    x: ExportRecord,
    head: string,
    fate: Pick<LedgerEntry, 'by' | 'merged_head' | 'closed'>,
  ): Promise<void> {
    const conclusion = x.gate?.conclusion ?? 'human_merge'
    const entry = ledgerEntry(
      this.ctx.deps,
      rec,
      x,
      this.ctx.projectOf(rec),
      head,
      { conclusion, condition: null, shadow: false },
      fate,
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

  /** 앱 밖에서 머지되거나 닫힌 PR을 장부와 기록에 남긴다 */
  private async fate(rec: WorkRecord, x: ExportRecord, pr: PrInfo): Promise<void> {
    if (!isActive(rec.state)) return
    if (pr.state === 'MERGED') {
      await this.ledgerFate(rec, x, pr.headRefOid, {
        by: 'human-override',
        merged_head: pr.headRefOid,
      })
      this.ctx.note(rec.id, {
        type: 'merged_outside',
        head: pr.headRefOid,
        pr: pr.number,
        ...unitOf(x),
      })
    } else if (pr.state === 'CLOSED') {
      await this.ledgerFate(rec, x, pr.headRefOid, { closed: true })
      this.ctx.note(rec.id, { type: 'pr_closed', pr: pr.number, ...unitOf(x) })
    }
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

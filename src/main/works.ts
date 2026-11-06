// Work 조율 (docs/m2-modules.md 3절 works.ts, docs/m2-app.md). Electron을 모른다: [흐름] 시험이 Node에서 조립해 돌린다.
// 프로젝트와 Work를 저장소에 두고, Work마다 worktree·작업 브랜치·세션(PTY의 claude)을 만든다. 훅과 MCP 도구 호출을 받아
// 상태 기계(core/work.ts)를 움직인다. 계약 창구는 works-contract.ts, 증거·관문은 works-evidence.ts, 내보내기(V22)의 머지·PR은
// works-exports.ts, 리뷰(미리 리뷰 포함)는 works-review.ts, [끝내기]는 works-end.ts, 쉬는 세션에 주는 되먹임(V24)은
// works-feedback.ts, 화면의 모양은 works-view.ts, worktree와 세션 띄우기는 works-worktree.ts, 프로젝트와 품질 기준 상태는
// works-projects.ts.

import { killActive } from '../adapters/exec.ts'
import { killRunFiles } from '../adapters/pty.ts'
import { readJson } from '../adapters/store.ts'
import { parseContract } from '../core/contract.ts'
import { guardCommand } from '../core/git-guard.ts'
import { TOOL_CHANGE, TOOL_CHECK, TOOL_SUBMIT, type HookEvent } from '../core/instructions.ts'
import type { DebtItem, EvidenceBundle } from '../core/types.ts'
import { nextState, type WorkEvent } from '../core/work.ts'
import {
  EVENTS,
  type ChangeAnswer,
  type DraftQualityResult,
  type EndInput,
  type MergeResult,
  type NewWorkInput,
  type PreparedEnd,
  type ProjectSettings,
  type ProjectView,
  type WorkList,
  type WorkView,
} from '../shared/api.ts'
import { toolCommand, type HookReply } from './hooks.ts'
import { upgradeWork, type ProjectRecord, type WorkRecord } from './store.ts'
import { ContractDesk } from './works-contract.ts'
import { dropEnd, EndDesk } from './works-end.ts'
import { EvidenceRunner, exportable, isExportCommand } from './works-evidence.ts'
import { ASK_TOOL, checkReplies, FeedbackDesk } from './works-feedback.ts'
import { ProjectDesk } from './works-projects.ts'
import { followReview } from './works-review.ts'
import {
  delivered,
  isActive,
  measures,
  outsideBranches,
  perUnit,
  readTips,
  tipOf,
  type MeasureJob,
  type Runtime,
  type WorkCtx,
  type WorksDeps,
  workHead,
} from './works-types.ts'
import { workView } from './works-view.ts'
import { launch, newWork, workDebt, workDiff } from './works-worktree.ts'

export type { ReviewInput, WorksDeps } from './works-types.ts'
export { claudeReview } from './works-review.ts'
export { shortName } from './works-worktree.ts'

/** 앱이 끝날 때 증거 재기를 기다리는 상한 */
const SHUTDOWN_WAIT_MS = 10_000

export class Works implements WorkCtx {
  readonly deps: WorksDeps
  private readonly projects: ProjectDesk
  private readonly works = new Map<string, WorkRecord>()
  private readonly rts = new Map<string, Runtime>()
  private readonly desk: ContractDesk
  private readonly evidence: EvidenceRunner
  private readonly ending: EndDesk
  private readonly feedback: FeedbackDesk
  private closing = false

  constructor(deps: WorksDeps) {
    this.deps = deps
    this.projects = new ProjectDesk(deps)
    this.desk = new ContractDesk(this)
    this.evidence = new EvidenceRunner(this)
    this.ending = new EndDesk(this, this.evidence)
    this.feedback = new FeedbackDesk(this)
  }

  /**
   * 저장소에서 프로젝트와 Work를 읽는다. 세션은 모두 멈춘 것으로 보이고 [다시 열기]로 --resume 한다. [끝내기]가 걸려
   * 있던 Work는 이어 잰다(V25)
   */
  async init(): Promise<void> {
    const { store } = this.deps
    await this.projects.load()
    for (const id of await store.listWorkIds()) {
      const raw = await store.readWork(id)
      if (!raw || !this.projects.get(raw.project)) continue
      // 옛 기록의 빈 칸을 채우고, V22 앞의 PR·증거·관문은 Work 브랜치의 내보내기 하나로 옮긴다
      const rec = upgradeWork(raw)
      this.works.set(id, rec)
      const rt = this.runtime(id)
      const text = await store.readText(id, 'contract.json')
      const parsed = text === null ? null : parseContract(text)
      rt.contract = parsed?.ok ? parsed.value : null
      const paths: [string, string | null][] = [
        ...rec.exports.map((x) => [x.branch, x.evidence_path] as [string, string | null]),
        [rec.branch, perUnit(rec) ? rec.integration_path : null],
      ]
      for (const [branch, path] of paths) {
        const bundle = path ? await readJson<EvidenceBundle>(path) : null
        if (bundle) rt.bundles.set(branch, bundle)
      }
      await this.seeHead(id, await workHead(rec).catch(() => null))
      if (rec.exports.some((x) => x.pr?.state === 'OPEN') && isActive(rec.state))
        this.evidence.exports.startPoll(id)
      this.ending.resume(id)
    }
  }

  // ── WorkCtx ────────────────────────────────────────────────────────────────

  find(id: string): WorkRecord | null {
    return this.works.get(id) ?? null
  }

  record(id: string): WorkRecord {
    const rec = this.works.get(id)
    if (!rec) throw new Error(`Work가 없음: ${id}`)
    return rec
  }

  runtime(id: string): Runtime {
    let rt = this.rts.get(id)
    if (!rt) {
      rt = {
        token: null,
        controlToken: null,
        session: 'stopped',
        contract: null,
        bundles: new Map(),
        policies: new Map(),
        evidenceRunning: false,
        reviewRunning: false,
        head: null,
        tips: {},
        outside: [],
        measuring: null,
        measuringAt: null,
        debounce: null,
        poll: null,
        pending: null,
        chain: Promise.resolve(),
        wired: false,
        merging: false,
        noticeSent: false,
        abort: new AbortController(),
        review: null,
        autoMergeNote: null,
        endMoved: null,
        lastHumanInputAt: null,
        draft: false,
        feedbackHeld: null,
        feeding: Promise.resolve(),
        telling: Promise.resolve(),
      }
      this.rts.set(id, rt)
    }
    return rt
  }

  projectOf(rec: WorkRecord): ProjectRecord {
    const p = this.projects.get(rec.project)
    if (!p) throw new Error(`프로젝트가 없음: ${rec.project}`)
    return p
  }

  async save(rec: WorkRecord): Promise<void> {
    // 끝난 Work에는 걸린 끝도 끝내기 상자도 없다(V25)
    if (!isActive(rec.state)) rec.end_pending = null
    rec.updated_at = this.deps.now()
    await this.deps.store.writeWork(rec)
    this.publish(rec.id)
  }

  publish(id: string): void {
    if (this.works.has(id)) this.deps.emit(EVENTS.work, this.view(id))
  }

  note(id: string, event: Record<string, unknown>): void {
    void this.deps.store.appendEvent(id, event).catch((e) => this.log('기록 실패', e))
  }

  log(text: string, error?: unknown): void {
    if (this.deps.log) this.deps.log(text, error)
    else console.error(text, error ?? '')
  }

  async tell(id: string, text: string): Promise<void> {
    if (this.deps.sessions.isRunning(id)) {
      // 한 줄씩 차례로: 앞 줄의 Enter 전에 다음 글이 들어가면 두 줄이 하나로 붙는다(되먹임과 [세션에 넘기기], V24)
      const rt = this.runtime(id)
      const turn = rt.telling.then(async () => {
        this.deps.sessions.write(id, text)
        // 붙여 넣은 글과 Enter가 한 조각이면 TUI가 Enter를 줄바꿈으로 읽을 수 있다
        await new Promise((r) => setTimeout(r, 150))
        this.deps.sessions.write(id, '\r')
      })
      rt.telling = turn.catch(() => {})
      return turn
    }
    const rec = this.record(id)
    rec.notice = rec.notice ? `${rec.notice}\n\n${text}` : text
    await this.save(rec)
  }

  async finish(id: string): Promise<void> {
    this.evidence.cancelDebounce(id)
    this.evidence.exports.stopPoll(id)
    // 돌고 있는 리뷰(claude -p)를 그만둔다
    this.runtime(id).abort.abort()
    this.runtime(id).endMoved = null
    this.desk.cancel(id, { status: 'cancelled', message: 'The Work has ended.' })
    await this.deps.sessions.kill(id)
  }

  async transition(
    rec: WorkRecord,
    ev: WorkEvent,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    const next = nextState(rec.state, ev)
    if (!next.ok) throw new Error(next.errors.join('; '))
    rec.state = next.value
    await this.save(rec)
    this.note(rec.id, { type: ev.type, ...extra })
    await this.finish(rec.id)
  }

  async seeHead(id: string, head: string | null): Promise<void> {
    const rec = this.works.get(id)
    if (!rec || head === null) return
    const rt = this.runtime(id)
    // 단위 브랜치의 끝(V22)도 함께 읽는다: 그 브랜치의 리뷰와 걸린 끝·상자가 그것을 본다
    const tips = await readTips(rec)
    const moved = rt.head !== head || JSON.stringify(rt.tips) !== JSON.stringify(tips)
    rt.head = head
    rt.tips = tips
    // 다른 head의 리뷰는 멈춘다(V23)
    followReview(rt)
    if (this.ending.follow(rec, head, tips)) await this.save(rec)
    else if (moved) this.publish(id)
  }

  async settleEnd(id: string, job: MeasureJob): Promise<void> {
    await this.ending.settle(id, job).catch((e) => this.log(`끝내기 실패 (${id})`, e))
  }

  async offerFeedback(id: string): Promise<void> {
    await this.feedback.offer(id).catch((e) => this.log(`되먹임 실패 (${id})`, e))
  }

  refreshQuality(projectId: string): void {
    void this.projects.refresh(projectId).catch((e) => this.log('품질 기준 확인 실패', e))
  }

  // ── 프로젝트 (works-projects.ts) ───────────────────────────────────────────

  addProject(path: string): Promise<ProjectView> {
    return this.projects.add(path)
  }

  updateSettings(projectId: string, s: Partial<ProjectSettings>): Promise<ProjectView> {
    return this.projects.updateSettings(projectId, s)
  }

  /** 기본 브랜치의 품질 기준 상태를 다시 잰다(V20, 목록을 다시 읽을 때) */
  refreshProjects(): Promise<void> {
    return this.projects.refresh()
  }

  /** [초안 만들기](V20): 품질 기준 초안을 프로젝트의 작업 트리에 쓴다. 이미 있으면 덮지 않는다. 커밋은 사람이 한다 */
  draftQuality(projectId: string): Promise<DraftQualityResult> {
    return this.projects.draft(projectId)
  }

  // ── Work 만들기와 세션 ─────────────────────────────────────────────────────

  async createWork(o: NewWorkInput): Promise<WorkView> {
    const project = this.projects.get(o.project)
    if (!project) throw new Error(`프로젝트가 없음: ${o.project}`)
    const rec = await newWork(this.deps, project, o)
    this.refreshQuality(project.id)
    this.works.set(rec.id, rec)
    this.runtime(rec.id).head = await workHead(rec).catch(() => null)
    await this.save(rec)
    this.note(rec.id, { type: 'created', branch: rec.branch, base: rec.base_ref })
    await launch(this, rec, false)
    return this.view(rec.id)
  }

  /** 멈춘 세션을 --resume으로 다시 연다. 기다리던 도구가 끊겼으면 다시 부르라고 프롬프트로 알린다 */
  async resumeWork(id: string): Promise<void> {
    const rec = this.record(id)
    if (!isActive(rec.state)) throw new Error('끝난 Work는 다시 열 수 없음')
    if (this.deps.sessions.isRunning(id)) return
    await launch(this, rec, true)
  }

  // ── 훅과 control ───────────────────────────────────────────────────────────

  /** HookServer가 묻는다: 이 Work의 훅 토큰(세션이 떠 있는 동안만) */
  hookToken(id: string): string | null {
    return this.rts.get(id)?.token ?? null
  }

  /** HookServer가 묻는다: 이 Work의 /control 토큰(세션이 떠 있는 동안만) */
  controlToken(id: string): string | null {
    return this.rts.get(id)?.controlToken ?? null
  }

  /** 바닥 막기의 지킬 브랜치: 기준 브랜치 */
  protectedBranches(id: string): string[] {
    const rec = this.works.get(id)
    return rec ? [rec.base] : []
  }

  async onHook(
    workId: string,
    event: HookEvent,
    body: Record<string, unknown>,
  ): Promise<HookReply> {
    const rec = this.works.get(workId)
    if (!rec) return null
    const rt = this.runtime(workId)
    const before = rt.session
    const tool = typeof body.tool_name === 'string' ? body.tool_name : undefined
    const command = toolCommand(body)
    this.note(workId, {
      type: 'hook',
      event,
      ...(tool ? { tool } : {}),
      ...(command ? { command } : {}),
    })
    // 훅이 왔으면 이 session_id의 대화가 있다: 다음 [다시 열기]는 --resume
    if (!rec.session_started) {
      rec.session_started = true
      await this.save(rec)
    }
    switch (event) {
      case 'UserPromptSubmit': {
        rt.session = 'running'
        // 입력 칸의 글은 이 프롬프트로 함께 갔다(V24)
        rt.draft = false
        this.evidence.cancelDebounce(workId)
        // 재개 프롬프트로 전한 사람의 답을 세션이 받았다
        if (rt.noticeSent) {
          rt.noticeSent = false
          rec.notice = null
          await this.save(rec)
        }
        // /clear 뒤에는 새 대화다. 재개는 가장 최근 대화로 한다
        const sid = body.session_id
        if (typeof sid === 'string' && /^[0-9a-f-]{36}$/i.test(sid) && sid !== rec.session_id) {
          rec.session_id = sid
          await this.save(rec)
        }
        break
      }
      case 'PreToolUse': {
        rt.session = 'running'
        const g = command === null ? null : guardCommand(command, this.protectedBranches(workId))
        if (g?.blocked) this.note(workId, { type: 'blocked', command, reason: g.reason })
        break
      }
      case 'PostToolUse':
      case 'PostToolUseFailure':
        rt.session = 'running'
        // 질문 메뉴가 사람의 입력을 받았다: 입력 칸의 글이 아니다(V24)
        if (tool === ASK_TOOL) this.feedback.menuAnswered(workId)
        // 셸 명령은 차례 안에서 커밋할 수 있다: 화면의 HEAD를 바로 고친다(낡은 head의 걸린 끝과 끝내기 상자를 지운다, V25)
        if (command !== null) void this.followHead(workId)
        if (event === 'PostToolUse' && command !== null && isExportCommand(command))
          void this.evidence.onPush(workId).catch((e) => this.log('PR 확인 실패', e))
        break
      case 'Stop':
        rt.session = 'idle'
        void this.evidence.onStop(workId).catch((e) => this.log('증거 계기 실패', e))
        break
      case 'SessionEnd':
        if (body.reason !== 'clear') rt.session = 'stopped'
        break
    }
    if (rt.session !== before) this.publish(workId)
    return null
  }

  /** relay MCP 도구 호출(/control) */
  async onControl(
    workId: string,
    tool: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    const rec = this.works.get(workId)
    if (!rec) return { status: 'error', error: `Unknown Work: ${workId}` }
    if (!isActive(rec.state))
      return { status: 'error', error: `The Work has ended (${rec.state}).` }
    switch (tool) {
      case TOOL_SUBMIT:
        return this.desk.submit(rec, args, signal)
      case TOOL_CHANGE:
        return this.desk.requestChange(rec, args, signal)
      case TOOL_CHECK:
        return this.checkForSession(rec)
      default:
        return { status: 'error', error: `Unknown tool: ${tool}` }
    }
  }

  /**
   * relay_check: 지금 head의 증거(영어, works-feedback.ts checkReply: 되먹임과 같은 세션 몫의 사실과 지적, V24). 지금 계약으로
   * 재지 않았으면 잰다: 재고 있거나 재기가 줄 서 있으면 그것을 기다리고 새로 줄 세우지 않는다(내보내기 증거의 리뷰를 덮지
   * 않게). 관문 결론과 사람에게만 가는 지적은 주지 않는다. branch_per_unit(V22)은 통합 증거와 단위 브랜치마다 답한다
   */
  private async checkForSession(rec: WorkRecord): Promise<unknown> {
    const rt = this.runtime(rec.id)
    const head = await workHead(rec)
    const tips = await readTips(rec)
    if (!this.evidence.measuredAll(rec, head, tips)) {
      if (rt.measuring !== null || rt.pending) await rt.chain
      if (!this.evidence.measuredAll(rec, head, tips)) await this.evidence.run(rec.id, {})
    }
    return checkReplies(rec, rt.bundles, head, tips, await outsideBranches(rec, head, tips))
  }

  // ── 사람의 동작 ────────────────────────────────────────────────────────────

  approveContract(id: string): Promise<void> {
    return this.desk.approve(id)
  }

  askChanges(id: string, text: string): Promise<void> {
    return this.desk.askChanges(id, text)
  }

  /**
   * 계약 바꾸기에 답한다. 도는 리뷰는 앞 계약의 것이라 멈춘다(V23). 지금 head를 바뀐 계약으로 재지 않았으면 다시 잰다(앞
   * 묶음이 이 head의 내보내기였으면 내보내기로): 관문과 [머지]가 옛 계약의 결론으로 남지 않게. 그사이 세션이 커밋한 새
   * head는 아무도 내보내지 않았으니 내보내기 계기를 기다린다(V23)
   */
  async answerChange(id: string, o: ChangeAnswer): Promise<void> {
    await this.desk.answerChange(id, o)
    const rec = this.record(id)
    const rt = this.runtime(id)
    followReview(rt)
    if (rec.end_pending !== null) {
      dropEnd(this, rec)
      await this.save(rec)
    }
    const head = await workHead(rec).catch(() => null)
    if (!measures(rec.state) || head === null || rt.bundles.size === 0) return
    const tips = await readTips(rec)
    if (this.evidence.measuredAll(rec, head, tips)) return
    // 지금 끝을 내보내기로 쟀던 내보내기만 내보내기로 다시 잰다(V22: 내보내기마다)
    const was = rec.exports.filter((x) => {
      const tip = tipOf(x, head, tips)
      return !delivered(x) && tip !== null && x.exported_head === tip
    })
    const pr = was.some((x) => exportable(x.pr, rec.base, tipOf(x, head, tips)))
    const only = was.map((x) => x.branch)
    void this.evidence
      .run(id, only.length > 0 ? { export: pr ? 'pr' : 'end', only } : {})
      .catch((e) => this.log('증거 실패', e))
  }

  /**
   * [증거 다시 재기]: 이미 잰 head도 다시 잰다(흔들린 명령, 바깥이 바뀐 CI). 내보내기 후보면 리뷰도 다시 부르고(V22: 열린 PR이
   * 지금 끝을 가리키는 내보내기만), 아니면 미리 리뷰(V23)를 허락한다
   */
  runEvidence(id: string, o: { exportCandidate: boolean }): Promise<void> {
    const rec = this.record(id)
    if (!isActive(rec.state)) throw new Error('끝난 Work는 증거를 재지 않음')
    this.evidence.cancelDebounce(id)
    if (!o.exportCandidate) return this.evidence.run(id, { prepare: true, again: true })
    const rt = this.runtime(id)
    const only = rec.exports
      .filter((x) => exportable(x.pr, rec.base, tipOf(x, rt.head, rt.tips)))
      .map((x) => x.branch)
    const which = perUnit(rec) ? { only } : {}
    return this.evidence.run(id, { export: 'pr', again: true, prepare: true, ...which })
  }

  /** [세션에 넘기기](V24): 지금 HEAD의 리뷰 지적을 되먹임 파일로 세션에 보낸다. unit은 단위 브랜치의 내보내기(V22) */
  sendFindings(id: string, ids: string[], unit?: string): Promise<void> {
    return this.feedback.sendFindings(id, ids, unit)
  }

  /**
   * 사람이 화면에서 터미널에 친 글(ipc terminalWrite). 되먹임은 그 뒤 60초 동안, 그리고 입력 칸에 쓰다 둔 글이 있을 수 있는
   * 동안 보내지 않는다(V24)
   */
  typed(id: string, data: string): void {
    if (this.works.has(id)) this.feedback.typed(id, data)
  }

  /** [머지]: 내보내기 하나. unit은 단위 브랜치의 내보내기(V22) */
  async merge(id: string, unit?: string): Promise<MergeResult> {
    const r = await this.evidence.exports.merge(id, unit ?? null, 'human')
    return r.ok ? { ok: true } : { ok: false, error: r.error ?? '머지하지 못함' }
  }

  /**
   * [끝내기](V25, works-end.ts): 지금 HEAD의 내보내기 증거에 열린 것이 없으면 끝내고, 아직 재지 않았으면 걸어 두고 재며,
   * 열린 것이 있으면 상자로 둔다. force는 [그래도 끝내기](head는 상자의 head)
   */
  end(id: string, o: EndInput = {}): Promise<PreparedEnd> {
    return this.ending.end(id, o)
  }

  /** [취소]·[더 고치기]: 걸린 끝이나 끝내기 상자를 지운다 */
  cancelEnd(id: string): Promise<void> {
    return this.ending.cancel(id)
  }

  /** 지금 HEAD를 화면에 보인다(Stop을 기다리지 않고). 걸린 끝이나 상자의 head가 아니면 그것을 지운다 */
  private async followHead(id: string): Promise<void> {
    const rec = this.works.get(id)
    if (!rec) return
    await this.seeHead(id, await workHead(rec).catch(() => null))
  }

  async abandon(id: string): Promise<void> {
    await this.transition(this.record(id), { type: 'abandoned' })
  }

  diff(id: string): Promise<string> {
    return workDiff(this.record(id))
  }

  debt(id: string): Promise<DebtItem[]> {
    return workDebt(this.record(id))
  }

  // ── 보기 ───────────────────────────────────────────────────────────────────

  view(id: string): WorkView {
    const rec = this.record(id)
    return workView(this, rec, this.feedback)
  }

  list(): WorkList {
    return {
      projects: this.projects.views(),
      works: [...this.works.values()]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((w) => this.view(w.id)),
    }
  }

  /** 앱이 끝날 때: 타이머를 멈추고, 기다리는 도구를 끝내고, 세션을 끝낸다. 돌던 레포 명령도 끝낸다 */
  async shutdown(): Promise<void> {
    if (this.closing) return
    this.closing = true
    for (const id of this.works.keys()) {
      this.evidence.cancelDebounce(id)
      this.evidence.exports.stopPoll(id)
    }
    this.desk.cancel(null, { status: 'cancelled', message: 'relay is shutting down.' })
    for (const rt of this.rts.values()) rt.abort.abort()
    await this.deps.sessions.killAll()
    killActive()
    // 리뷰의 claude -p와 gh는 detached라 앱이 끝나도 남는다
    killRunFiles()
    const running = [...this.rts.values()].map((rt) => rt.chain)
    await Promise.race([
      Promise.all(running),
      new Promise((r) => setTimeout(r, SHUTDOWN_WAIT_MS).unref()),
    ])
  }

  /** 증거 재기가 모두 끝날 때까지(시험) */
  async idle(): Promise<void> {
    await Promise.all([...this.rts.values()].map((rt) => rt.chain))
  }

  /** 기다리는 사람의 답(화면용): 'submit' | 'change' | null */
  waiting(id: string): 'submit' | 'change' | null {
    return this.desk.waiting(id)
  }
}

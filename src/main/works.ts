// Work 조율 (docs/m2-modules.md 3절 works.ts, docs/m2-app.md). Electron을 모른다: [흐름] 시험이 Node에서 조립해 돌린다.
// 프로젝트와 Work를 저장소에 두고, Work마다 worktree·작업 브랜치·세션(PTY의 claude)을 만든다. 훅과 MCP 도구 호출을 받아
// 상태 기계(core/work.ts)를 움직인다. 계약 창구는 works-contract.ts, 증거·관문·머지·PR은 works-evidence.ts,
// worktree와 세션 띄우기는 works-worktree.ts.

import { basename } from 'node:path'
import { git, killActive } from '../adapters/exec.ts'
import { killRunFiles } from '../adapters/pty.ts'
import { defaultBase, repoRoot } from '../adapters/git.ts'
import { readJson, repoKey } from '../adapters/store.ts'
import { parseContract } from '../core/contract.ts'
import { guardCommand } from '../core/git-guard.ts'
import { TOOL_CHANGE, TOOL_CHECK, TOOL_SUBMIT, type HookEvent } from '../core/instructions.ts'
import { evidenceFacts } from '../core/review.ts'
import type { DebtItem, EvidenceBundle } from '../core/types.ts'
import { nextState, type WorkEvent } from '../core/work.ts'
import {
  DEFAULT_SETTINGS,
  EVENTS,
  type ChangeAnswer,
  type MergeResult,
  type NewWorkInput,
  type ProjectSettings,
  type ProjectView,
  type WorkList,
  type WorkView,
} from '../shared/api.ts'
import { toolCommand, type HookReply } from './hooks.ts'
import type { ProjectRecord, WorkRecord } from './store.ts'
import { ContractDesk } from './works-contract.ts'
import { EvidenceRunner, headOf, isExportCommand } from './works-evidence.ts'
import { isActive, measures, type Runtime, type WorkCtx, type WorksDeps } from './works-types.ts'
import { launch, newWork, workDebt, workDiff } from './works-worktree.ts'

export type { ReviewInput, WorksDeps } from './works-types.ts'
export { claudeReview } from './works-evidence.ts'
export { shortName } from './works-worktree.ts'

/** 앱이 끝날 때 증거 재기를 기다리는 상한 */
const SHUTDOWN_WAIT_MS = 10_000

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function settingsOf(raw: unknown): ProjectSettings {
  const s = isObject(raw) ? raw : {}
  const pick = <K extends keyof ProjectSettings>(k: K, ok: (v: unknown) => boolean) =>
    (ok(s[k]) ? s[k] : DEFAULT_SETTINGS[k]) as ProjectSettings[K]
  return {
    auto_merge: pick('auto_merge', (v) => typeof v === 'boolean'),
    min_shadow: pick('min_shadow', (v) => Number.isInteger(v) && (v as number) >= 0),
    review: pick('review', (v) => v === 'all' || v === 'auto_only'),
    merge_method: pick('merge_method', (v) => v === 'merge' || v === 'squash' || v === 'rebase'),
    question_mode: pick('question_mode', (v) => v === 'confirm_each' || v === 'draft_first'),
  }
}

export class Works implements WorkCtx {
  readonly deps: WorksDeps
  private readonly projects = new Map<string, ProjectRecord>()
  private readonly works = new Map<string, WorkRecord>()
  private readonly rts = new Map<string, Runtime>()
  private readonly desk: ContractDesk
  private readonly evidence: EvidenceRunner
  private closing = false

  constructor(deps: WorksDeps) {
    this.deps = deps
    this.desk = new ContractDesk(this)
    this.evidence = new EvidenceRunner(this)
  }

  /** 저장소에서 프로젝트와 Work를 읽는다. 세션은 모두 멈춘 것으로 보이고 [다시 열기]로 --resume 한다 */
  async init(): Promise<void> {
    const { store } = this.deps
    for (const p of await store.readProjects())
      this.projects.set(p.id, { ...p, settings: settingsOf(p.settings) })
    for (const id of await store.listWorkIds()) {
      const rec = await store.readWork(id)
      if (!rec || !this.projects.has(rec.project)) continue
      // session_started가 없는 옛 기록은 세션이 떴던 것으로 본다(--resume)
      this.works.set(id, {
        ...rec,
        notice: rec.notice ?? null,
        session_started: rec.session_started ?? true,
      })
      const rt = this.runtime(id)
      const text = await store.readText(id, 'contract.json')
      const parsed = text === null ? null : parseContract(text)
      rt.contract = parsed?.ok ? parsed.value : null
      if (rec.evidence_path) rt.evidence = await readJson<EvidenceBundle>(rec.evidence_path)
      rt.head = await headOf(rec.worktree).catch(() => null)
      if (rec.pr?.state === 'OPEN' && isActive(rec.state)) this.evidence.startPoll(id)
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
        evidence: null,
        evidenceRunning: false,
        reviewRunning: false,
        head: null,
        measuring: null,
        debounce: null,
        poll: null,
        pending: null,
        chain: Promise.resolve(),
        wired: false,
        merging: false,
        noticeSent: false,
        abort: new AbortController(),
        autoMergeNote: null,
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
      this.deps.sessions.write(id, text)
      // 붙여 넣은 글과 Enter가 한 조각이면 TUI가 Enter를 줄바꿈으로 읽을 수 있다
      await new Promise((r) => setTimeout(r, 150))
      this.deps.sessions.write(id, '\r')
      return
    }
    const rec = this.record(id)
    rec.notice = rec.notice ? `${rec.notice}\n\n${text}` : text
    await this.save(rec)
  }

  async finish(id: string): Promise<void> {
    this.evidence.cancelDebounce(id)
    this.evidence.stopPoll(id)
    // 돌고 있는 리뷰(claude -p)를 그만둔다
    this.runtime(id).abort.abort()
    this.desk.cancel(id, { status: 'cancelled', message: 'The Work has ended.' })
    await this.deps.sessions.kill(id)
  }

  // ── 프로젝트 ───────────────────────────────────────────────────────────────

  private projectView(p: ProjectRecord): ProjectView {
    return {
      id: p.id,
      path: p.path,
      name: p.name,
      defaultBranch: p.defaultBranch,
      settings: { ...p.settings },
    }
  }

  private async saveProjects(): Promise<void> {
    await this.deps.store.writeProjects([...this.projects.values()])
    this.deps.emit(
      EVENTS.projects,
      [...this.projects.values()].map((p) => this.projectView(p)),
    )
  }

  async addProject(path: string): Promise<ProjectView> {
    let root: string
    try {
      root = await repoRoot(path)
    } catch {
      throw new Error(`git 레포가 아님: ${path}`)
    }
    const id = repoKey(root)
    const existing = this.projects.get(id)
    if (existing) return this.projectView(existing)
    const base = await defaultBase(root).catch(() => null)
    const p: ProjectRecord = {
      id,
      path: root,
      name: basename(root),
      defaultBranch: base === null ? null : base.replace(/^origin\//, '').replace(/^HEAD$/, ''),
      settings: { ...DEFAULT_SETTINGS },
      added_at: this.deps.now(),
    }
    if (base === 'origin/HEAD') {
      const ref = await git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], root).catch(
        () => '',
      )
      p.defaultBranch = ref.trim().replace(/^origin\//, '') || null
    }
    this.projects.set(id, p)
    await this.saveProjects()
    return this.projectView(p)
  }

  async updateSettings(projectId: string, s: Partial<ProjectSettings>): Promise<ProjectView> {
    const p = this.projects.get(projectId)
    if (!p) throw new Error(`프로젝트가 없음: ${projectId}`)
    const merged = { ...p.settings, ...s }
    const checked = settingsOf(merged)
    const bad = (Object.keys(s) as (keyof ProjectSettings)[]).filter(
      (k) => k in checked && checked[k] !== merged[k],
    )
    if (bad.length > 0) throw new Error(`설정 값이 잘못됨: ${bad.join(', ')}`)
    p.settings = checked
    await this.saveProjects()
    return this.projectView(p)
  }

  // ── Work 만들기와 세션 ─────────────────────────────────────────────────────

  async createWork(o: NewWorkInput): Promise<WorkView> {
    const project = this.projects.get(o.project)
    if (!project) throw new Error(`프로젝트가 없음: ${o.project}`)
    const rec = await newWork(this.deps, project, o)
    this.works.set(rec.id, rec)
    this.runtime(rec.id).head = await headOf(rec.worktree).catch(() => null)
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
   * relay_check: 지금 head의 증거(결정론적 사실만, 영어). 지금 계약으로 재지 않았으면 잰다: 이 head를 재고 있거나 재기가
   * 줄 서 있으면 그것을 기다리고 새로 줄 세우지 않는다(내보내기 증거의 리뷰를 덮지 않게). 리뷰 지적과 관문 결론은 주지
   * 않는다(V4, V8)
   */
  private async checkForSession(rec: WorkRecord): Promise<unknown> {
    const rt = this.runtime(rec.id)
    const head = await headOf(rec.worktree)
    if (!this.evidence.measured(rec.id, head)) {
      if (head === rt.measuring || rt.pending) await rt.chain
      if (!this.evidence.measured(rec.id, head))
        await this.evidence.run(rec.id, { exportCandidate: false })
    }
    const bundle = rt.evidence
    if (!bundle) return { status: 'error', error: rec.error ?? 'No evidence.' }
    return {
      status: 'ok',
      head: bundle.head,
      stale: bundle.head !== head,
      summary: evidenceFacts(bundle),
      commands: bundle.commands.map((c) => ({
        id: c.id,
        outcome: c.outcome,
        stderr_tail: c.head[c.head.length - 1]?.stderr_tail.slice(-2_000) ?? '',
      })),
      lines: bundle.lines?.map((l) => ({ line: l.line, status: l.status, examples: l.examples })),
      missing: bundle.missing,
    }
  }

  // ── 사람의 동작 ────────────────────────────────────────────────────────────

  approveContract(id: string): Promise<void> {
    return this.desk.approve(id)
  }

  askChanges(id: string, text: string): Promise<void> {
    return this.desk.askChanges(id, text)
  }

  /**
   * 계약 바꾸기에 답한다. 지금 head를 바뀐 계약으로 재지 않았으면 다시 잰다(앞 묶음이 내보내기였으면 내보내기로): 관문과
   * [머지]가 옛 계약의 결론으로 남지 않게
   */
  async answerChange(id: string, o: ChangeAnswer): Promise<void> {
    await this.desk.answerChange(id, o)
    const rec = this.record(id)
    const rt = this.runtime(id)
    const head = await headOf(rec.worktree).catch(() => null)
    if (!measures(rec.state) || head === null || rt.evidence === null) return
    if (this.evidence.measured(id, head)) return
    const exportCandidate = rec.exported_head === rt.evidence.head
    void this.evidence.run(id, { exportCandidate }).catch((e) => this.log('증거 실패', e))
  }

  runEvidence(id: string, o: { exportCandidate: boolean }): Promise<void> {
    const rec = this.record(id)
    if (!isActive(rec.state)) throw new Error('끝난 Work는 증거를 재지 않음')
    this.evidence.cancelDebounce(id)
    return this.evidence.run(id, o)
  }

  async merge(id: string): Promise<MergeResult> {
    const r = await this.evidence.merge(id, 'human')
    return r.ok ? { ok: true } : { ok: false, error: r.error ?? '머지하지 못함' }
  }

  /** [끝]: 내보내기 후보로 재고(리뷰, 장부) Work를 끝낸다. 세션도 끝낸다 */
  async end(id: string): Promise<void> {
    const rec = this.record(id)
    const ok = nextState(rec.state, { type: 'ended' })
    if (!ok.ok) throw new Error(ok.errors.join('; '))
    const head = await headOf(rec.worktree).catch(() => null)
    const exported = head !== null && rec.exported_head === head && this.evidence.measured(id, head)
    if (measures(rec.state) && head !== null && !exported)
      await this.evidence.run(id, { exportCandidate: true })
    // 그 증거로 정책이 머지했으면 이미 끝났다
    if (!isActive(rec.state)) return
    await this.transition(rec, { type: 'ended' })
  }

  async abandon(id: string): Promise<void> {
    await this.transition(this.record(id), { type: 'abandoned' })
  }

  private async transition(rec: WorkRecord, ev: WorkEvent): Promise<void> {
    const next = nextState(rec.state, ev)
    if (!next.ok) throw new Error(next.errors.join('; '))
    rec.state = next.value
    await this.save(rec)
    this.note(rec.id, { type: ev.type })
    await this.finish(rec.id)
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
    const rt = this.runtime(id)
    return {
      id,
      project: rec.project,
      title: rec.title,
      state: rec.state,
      session: rt.session,
      branch: rec.branch,
      base: rec.base,
      contract: rt.contract,
      pendingContract: rec.pending_contract,
      pendingChange: rec.pending_change,
      evidence: rt.evidence,
      gate: rec.gate,
      pr: rec.pr,
      evidenceRunning: rt.evidenceRunning,
      reviewRunning: rt.reviewRunning,
      contractId: rec.contract_id,
      hint: rec.hint,
      groundings: rec.groundings,
      head: rt.head,
      createdAt: rec.created_at,
      error: rec.error,
    }
  }

  list(): WorkList {
    return {
      projects: [...this.projects.values()].map((p) => this.projectView(p)),
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
      this.evidence.stopPoll(id)
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

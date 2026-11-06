// 세션 기록 (M4, docs/m4-design.md 3.1·7절). 훅 서버(hooks.ts)가 본문을 Works에 넘기기 전에 noteHook을 부르고 기다린다.
// - M4a: 세션 훅 본문의 effort.level(relay-v2 녹화본의 PreToolUse·PostToolUse·PostToolUseFailure·Stop 본문에 있음)의 마지막
//   값을 Work마다 메모리에 둔다: 내보내기 결론 줄의 effort 칸과 지금 판(판 열쇠)이 읽는다. 앱을 다시 켜면 다음 훅까지 모른다.
// - M4e 첫 겹(세션 커밋 집합): 셸 도구의 PreToolUse에서 Work 브랜치·단위 브랜치·worktree HEAD의 끝을 읽고, 그 도구의
//   PostToolUse(실패도)나 Stop에서 그 뒤 새로 닿는 커밋(기준 ref에서 닿는 것과 창을 열기 전의 커미터 시각인 것은 뺌: 받은
//   커밋)을 works/<id>/session-commits.jsonl에 적는다.
//   도구 경계에서 보지 못한 커밋은 세션 밖이다(사람이 직접, GitHub 웹 고침, 다른 곳의 push). 셸 도구가 겹치면 하나의 창으로 본다.
// - M4e 둘째 겹(트레일러, Q7): 세션을 띄울 때 심을 $RELAY_HOME/git-hooks에 쓰고 세션 PTY 환경에만 core.hooksPath를 준다
//   (prepareLaunch, engine/session-commits.ts trailerEnv). 집합에 든 커밋에 이 Work의 트레일러가 없으면 events.jsonl에
//   trailer_missing. 심이 사고(원래 훅 자리를 찾지 못함, 트레일러를 더하지 못함)를 works/<id>/hooks.log에 남기면 hook_incident를
//   적고 그 프로젝트의 트레일러를 끈다(devices.md 끄는 조건 (가): 다음에 띄우는 세션부터. 집합은 남긴다).

import { gitCommonDir, gitVersionText, writeShims } from '../adapters/git-hooks.ts'
import { newCommits, refTips } from '../adapters/git.ts'
import type { HookEvent } from '../core/instructions.ts'
import type { AfterCommits, LedgerEntry } from '../engine/ledger.ts'
import {
  classifyCommits,
  parseSessionLog,
  sessionSummary,
  shimFiles,
  trailerEnv,
  trailerGitOk,
  workTrailers,
  type ClassifyCommit,
  type SessionSet,
} from '../engine/session-commits.ts'
import { toolCommand } from './hooks.ts'
import type { Store, WorkRecord } from './store.ts'

/** 한 창(셸 도구 사이)에서 적는 새 커밋의 상한. 넘으면 적지 않는다(끝 모음을 잃고 이력 전부를 읽지 않게) */
const WINDOW_MAX = 500
/** 창을 연 때보다 이만큼 앞의 커미터 시각까지 창 안에서 만든 커밋으로 본다(git 시각은 초 단위) */
const WINDOW_SLACK_MS = 2000

const SESSION_FILE = 'session-commits.jsonl'

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** 훅 본문의 effort.level. 없거나 글이 아니면 null */
export function effortOf(body: Record<string, unknown>): string | null {
  const level = isObject(body['effort']) ? body['effort']['level'] : undefined
  return typeof level === 'string' && level.trim() !== '' ? level.trim() : null
}

/** 세션 기록이 보는 Work의 칸 */
export type SessionWork = Pick<
  WorkRecord,
  'id' | 'project' | 'worktree' | 'branch' | 'base_ref' | 'exports'
>

export interface SessionLogDeps {
  store: Pick<Store, 'home' | 'appendLine' | 'readText' | 'workPath'>
  /** 지금 Work 기록. 모르는 Work면 null */
  work: (id: string) => SessionWork | null
  /** events.jsonl에 한 줄 */
  note: (id: string, event: Record<string, unknown>) => void
  /** 훅 위임 사고: 그 프로젝트의 트레일러를 끈다(다음에 띄우는 세션부터) */
  disableTrailer?: (projectId: string) => Promise<unknown>
  log?: (message: string, error?: unknown) => void
}

/** 세션을 띄울 때의 트레일러: 켰나, 끈 까닭, 세션 PTY 환경에 더할 변수 */
export interface TrailerSetup {
  on: boolean
  why?: 'setting' | 'git' | 'error'
  env: Record<string, string>
}

/** 심과 환경 변수의 경로: Windows의 git sh가 읽게 /로 쓴다 */
const shPath = (p: string) => (process.platform === 'win32' ? p.replace(/\\/g, '/') : p)

/** 끝 모음을 읽는 ref: worktree의 HEAD, Work 브랜치, 단위 브랜치 */
function refsOf(w: SessionWork): string[] {
  const branches = new Set([w.branch, ...w.exports.map((x) => x.branch)])
  return ['HEAD', ...[...branches].map((b) => `refs/heads/${b}`)]
}

export class SessionLog {
  private readonly efforts = new Map<string, string>()
  private readonly deps: SessionLogDeps | null
  /** Work마다 열린 창: 창을 연 때(실제 시계, 커밋의 커미터 시각과 견줌)와 그때의 끝 모음, 열린 셸 도구(tool_use_id) */
  private readonly open = new Map<string, { at: number; tips: string[]; tools: Set<string> }>()
  /** Work마다 지금 세션의 트레일러가 켜졌나(띄울 때 정함) */
  private readonly trailerOn = new Map<string, boolean>()
  /** Work마다 다룬 hooks.log 줄 수 */
  private readonly seen = new Map<string, number>()
  private readonly chains = new Map<string, Promise<void>>()
  private gitOk: Promise<boolean> | null = null

  constructor(deps?: SessionLogDeps) {
    this.deps = deps ?? null
  }

  /**
   * 훅 하나를 본다. effort가 없는 본문(UserPromptSubmit, SessionEnd 등)은 마지막 값을 그대로 둔다. denied는 바닥 막기가 거절한
   * PreToolUse(도구가 돌지 않는다). 세션 커밋 집합의 일이 끝나면 풀린다(실패는 log하고 삼킨다)
   */
  noteHook(
    workId: string,
    event: HookEvent,
    body: Record<string, unknown>,
    denied = false,
  ): Promise<void> {
    const effort = effortOf(body)
    if (effort !== null) this.efforts.set(workId, effort)
    if (this.deps === null) return Promise.resolve()
    const shell = toolCommand(body) !== null
    const tool = typeof body['tool_use_id'] === 'string' ? body['tool_use_id'] : ''
    if (event === 'PreToolUse' && shell && !denied)
      return this.queue(workId, () => this.openTool(workId, tool))
    if ((event === 'PostToolUse' || event === 'PostToolUseFailure') && shell)
      return this.queue(workId, () => this.closeTool(workId, tool))
    if (event === 'Stop') return this.queue(workId, () => this.closeTool(workId, null))
    return Promise.resolve()
  }

  /** 이 Work의 세션이 마지막으로 알린 effort. 이 앱이 켜진 뒤 훅이 없었으면 없다 */
  effort(workId: string): string | undefined {
    return this.efforts.get(workId)
  }

  /** 이 Work의 세션 기록 일이 다 끝날 때(시험) */
  async settled(workId: string): Promise<void> {
    await this.chains.get(workId)
  }

  /**
   * 세션을 띄우기 전에: 트레일러를 켤지 정하고(프로젝트 설정 wanted, git 2.31 이상, 심을 씀), 세션 커밋 집합 파일에 띄움 한 줄을
   * 쓴다. 열린 창은 버린다(새 세션)
   */
  async prepareLaunch(work: SessionWork, wanted: boolean): Promise<TrailerSetup> {
    const deps = this.deps
    if (deps === null) return { on: false, why: 'error', env: {} }
    let setup: TrailerSetup
    if (!wanted) setup = { on: false, why: 'setting', env: {} }
    else if (!(await this.gitSupports())) setup = { on: false, why: 'git', env: {} }
    else
      setup = await (async (): Promise<TrailerSetup> => {
        const dir = await writeShims(deps.store.home, shimFiles())
        const env = trailerEnv({
          inherited: process.env,
          shimDir: shPath(dir),
          gitCommon: await gitCommonDir(work.worktree),
          hookLog: shPath(deps.store.workPath(work.id, 'hooks.log')),
        })
        return { on: true, env }
      })().catch((e: unknown) => {
        deps.log?.(`세션 커밋 트레일러를 켜지 못함 (${work.id})`, e)
        return { on: false, why: 'error', env: {} }
      })
    await this.queue(work.id, async () => {
      this.open.delete(work.id)
      this.trailerOn.set(work.id, setup.on)
      const why = setup.why ? { why: setup.why } : {}
      await deps.store.appendLine(work.id, SESSION_FILE, {
        kind: 'launch',
        trailer: setup.on,
        ...why,
      })
    })
    return setup
  }

  private gitSupports(): Promise<boolean> {
    this.gitOk ??= gitVersionText()
      .then(trailerGitOk)
      .catch(() => false)
    return this.gitOk
  }

  private queue(workId: string, job: () => Promise<void>): Promise<void> {
    const next = (this.chains.get(workId) ?? Promise.resolve())
      .then(job)
      .catch((e: unknown) => this.deps?.log?.(`세션 기록 실패 (${workId})`, e))
    this.chains.set(workId, next)
    return next
  }

  private async openTool(workId: string, tool: string): Promise<void> {
    const work = this.deps?.work(workId)
    if (!work) return
    const w = this.open.get(workId)
    if (w) {
      w.tools.add(tool)
      return
    }
    const at = Date.now()
    const tips = await refTips(work.worktree, refsOf(work))
    this.open.set(workId, { at, tips, tools: new Set([tool]) })
  }

  /** 셸 도구 하나가 끝났다(tool null이면 Stop: 열린 창을 모두 닫는다). 창 사이의 새 커밋을 적는다 */
  private async closeTool(workId: string, tool: string | null): Promise<void> {
    const deps = this.deps
    const work = deps?.work(workId)
    if (!deps || !work) return
    const w = this.open.get(workId)
    if (w) {
      const now = await refTips(work.worktree, refsOf(work))
      const found = await newCommits(work.worktree, {
        tips: now,
        not: [...w.tips, work.base_ref],
        max: WINDOW_MAX,
      })
      // 창을 열기 전에 만든 커밋은 세션이 받은 것이다(git pull로 받은 사람의 GitHub 웹 고침, 다른 브랜치 checkout): 세션 밖
      const made = found?.filter((c) => c.time * 1000 >= w.at - WINDOW_SLACK_MS) ?? null
      if (made === null) deps.log?.(`세션 커밋이 너무 많아 적지 않음 (${workId})`)
      else if (made.length > 0) {
        const on = this.trailerOn.get(workId) ?? false
        const commits = made.map((c) => ({
          sha: c.sha,
          trailer: workTrailers(c.body).includes(workId),
        }))
        await deps.store.appendLine(workId, SESSION_FILE, {
          kind: 'commits',
          on,
          tool: tool || null,
          commits,
        })
        const missing = on ? commits.filter((c) => !c.trailer).map((c) => c.sha) : []
        if (missing.length > 0) deps.note(workId, { type: 'trailer_missing', commits: missing })
      }
      if (tool !== null) w.tools.delete(tool)
      if (tool === null || w.tools.size === 0) this.open.delete(workId)
      else w.tips = now
    }
    await this.incidents(work)
  }

  /** 심이 hooks.log에 남긴 새 사고: hook_incident를 적고 그 프로젝트의 트레일러를 끈다 */
  private async incidents(work: SessionWork): Promise<void> {
    const deps = this.deps
    if (!deps) return
    const lines = ((await deps.store.readText(work.id, 'hooks.log')) ?? '')
      .split(/\r?\n/)
      .filter((l) => l.trim() !== '')
    const seen = this.seen.get(work.id) ?? (await sessionOf(deps.store, work.id)).handled
    if (lines.length <= seen) return
    this.seen.set(work.id, lines.length)
    const fresh = lines.slice(seen)
    deps.note(work.id, { type: 'hook_incident', lines: fresh })
    await deps.store.appendLine(work.id, SESSION_FILE, { kind: 'incidents', handled: lines.length })
    await deps.disableTrailer?.(work.project)
  }
}

// ── 끝 줄의 칸(works-record.ts, works-exports.ts) ───────────────────────────

/** events.jsonl에서 앱이 쓴 빚 커밋(V40)의 SHA: debt_recorded의 head */
function debtHeads(events: string): Set<string> {
  const out = new Set<string>()
  for (const line of events.split(/\r?\n/)) {
    if (!line.includes('"debt_recorded"')) continue
    try {
      const v: unknown = JSON.parse(line)
      if (isObject(v) && v['type'] === 'debt_recorded' && typeof v['head'] === 'string')
        out.add(v['head'])
    } catch {
      // 끊긴 줄
    }
  }
  return out
}

/**
 * 이 Work의 세션 커밋 집합과 심의 사고 수, 다룬 사고 줄 수, 앱이 쓴 빚 커밋의 SHA(머지 뒤 커밋을 가를 때 relay 빚 커밋은 작성자가
 * 아니라 이 SHA로 정한다)
 */
export async function sessionOf(
  store: Pick<Store, 'readText'>,
  workId: string,
): Promise<{ set: SessionSet; incidents: number; handled: number; debts: Set<string> }> {
  const text = (await store.readText(workId, SESSION_FILE)) ?? ''
  const log = (await store.readText(workId, 'hooks.log')) ?? ''
  const events = (await store.readText(workId, 'events.jsonl')) ?? ''
  let handled = 0
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes('"incidents"')) continue
    try {
      const v: unknown = JSON.parse(line)
      if (isObject(v) && typeof v['handled'] === 'number') handled = Math.max(handled, v['handled'])
    } catch {
      // 끊긴 줄
    }
  }
  return {
    set: parseSessionLog(text),
    incidents: log.split(/\r?\n/).filter((l) => l.trim() !== '').length,
    handled,
    debts: debtHeads(events),
  }
}

/** 머지 뒤 커밋의 갈래. 세션 커밋 집합을 모르면(M4e 앞의 Work) null */
export function afterOf(
  s: { set: SessionSet },
  workId: string,
  commits: readonly ClassifyCommit[],
): AfterCommits | null {
  if (!s.set.launched) return null
  return classifyCommits(commits, {
    set: new Set(s.set.commits.keys()),
    work: workId,
    trailer: !s.set.trailerOff,
  })
}

/** 끝 줄의 M4e 칸: 머지 뒤 커밋의 갈래(있으면), 집합만으로 가름, 집합의 셈. 집합을 모르면 갈래만 */
export function sessionLedger(
  s: { set: SessionSet; incidents: number },
  after: AfterCommits | null,
): Pick<LedgerEntry, 'after_commits' | 'trailer' | 'session_set'> {
  const commits = after ? { after_commits: after } : {}
  if (!s.set.launched) return commits
  return {
    ...commits,
    ...(s.set.trailerOff ? { trailer: false } : {}),
    session_set: sessionSummary(s.set, s.incidents),
  }
}

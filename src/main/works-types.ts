// Works의 의존과 안쪽 모양 (docs/m2-modules.md 3절 works.ts). works.ts가 600줄을 넘지 않게 계약 창구(works-contract.ts),
// 증거·머지(works-evidence.ts), 리뷰(works-review.ts), [끝내기](works-end.ts), 되먹임(works-feedback.ts)을 나눴다. 이 파일의 WorkCtx로 Works를 본다.
// 모두가 읽는 Work의 head(Work 브랜치의 끝, V21)도 여기에 둔다. Electron을 모른다.

import { revParse } from '../adapters/git.ts'
import type { Contract, EvidenceBundle } from '../core/types.ts'
import type { SessionState, WorkEvent } from '../core/work.ts'
import type { HookEvent } from '../core/instructions.ts'
import type { SessionHost } from './sessions.ts'
import type { ProjectRecord, Store, WorkRecord } from './store.ts'

/** 독립 리뷰(V4)에 주는 것. 기본 구현은 works-review.ts의 claudeReview(claude -p, 읽기 도구만) */
export interface ReviewInput {
  /** Work의 worktree. 리뷰어가 파일을 읽는 곳 */
  cwd: string
  contract: Contract
  diffStat: string
  diff: string
  /** 앱이 잰 증거의 사실(영어, 리뷰 없이: core/review.ts evidenceFacts) */
  evidenceSummary: string[]
  /** Work가 끝나거나 앱이 끝나면 끊긴다. 리뷰는 그때 그만둔다 */
  signal?: AbortSignal
}

/**
 * 리뷰의 결과. usage는 claude -p가 알려 준 토큰 사용량이다. 리뷰는 대화 기록을 남기지 않으므로(--no-session-persistence)
 * events.jsonl의 review 기록에 남긴다(평가가 리뷰 토큰을 센다). 증거 묶음에는 넣지 않는다
 */
export type ReviewResult =
  (NonNullable<EvidenceBundle['review']> & { usage?: Record<string, unknown> }) | null

export interface WorksDeps {
  store: Store
  sessions: SessionHost
  hooksPort: number
  /** http://127.0.0.1:<port>/control. 토큰은 Work마다 세션을 띄울 때 만든다(Works.controlToken) */
  controlUrl: string
  /** MCP 브리지를 띄우는 명령. 앱은 ELECTRON_RUN_AS_NODE=1로 자기 실행 파일을 쓴다 */
  bridgeCommand: { command: string; args: string[]; env: Record<string, string> }
  claudeBin: string
  check: typeof import('../engine/check.ts').check
  review: (o: ReviewInput) => Promise<ReviewResult>
  gh: typeof import('../adapters/gh.ts')
  now: () => string
  /** UUID를 돌려준다(Work id, claude의 --session-id) */
  newId: () => string
  emit: (event: string, payload: unknown) => void
  relayVersion: string
  /** Stop 뒤 증거를 재기까지 몰아서 기다리는 시간. 기본 20,000ms */
  debounceMs?: number
  /** 사람이 터미널에 입력한 뒤 되먹임(V24)을 보내지 않는 시간. 기본 60,000ms */
  humanQuietMs?: number
  // ── m2-modules 3절의 목록에 더한 것 ──
  /** 열린 PR을 다시 읽는 간격. 기본 120,000ms */
  prPollMs?: number
  /** 장부에 남기고 실적을 가르는 Claude Code 버전(`claude --version`) */
  claudeVersion?: string
  /** 세션과 리뷰의 모델. 없으면 CLI 기본값 */
  model?: string
  /** 처리 실패를 알린다. 기본 console.error */
  log?: (message: string, error?: unknown) => void
  /**
   * 평가에서 독립 리뷰를 뺀 쪽(RELAY_ABLATE=review, docs/experiments/m2/protocol.md). 제품 설정이 아니다. 리뷰를 부르지
   * 않고 status 'skipped'로 두며, 화면은 '리뷰가 꺼져 있음(평가 설정)'으로 보인다
   */
  reviewDisabled?: boolean
}

/** Work마다 메모리에만 두는 것 */
export interface Runtime {
  /** 훅 토큰. 세션을 띄울 때마다 새로 */
  token: string | null
  /** /control 토큰(mcp.json의 RELAY_CONTROL_TOKEN). 세션을 띄울 때마다 새로, 세션이 끝나면 null */
  controlToken: string | null
  session: SessionState
  /** 승인된 계약(contract.json) */
  contract: Contract | null
  evidence: EvidenceBundle | null
  evidenceRunning: boolean
  reviewRunning: boolean
  /** Work 브랜치의 끝(V21, 마지막으로 읽은 것). 화면과 기록은 HEAD라 부른다 */
  head: string | null
  /** 지금 재고 있는 head */
  measuring: string | null
  debounce: ReturnType<typeof setTimeout> | null
  poll: ReturnType<typeof setInterval> | null
  /**
   * 차례를 기다리는 증거 재기(아직 시작하지 않음). 겹친 요청은 하나로 합친다. export는 내보내기 계기(PR, [끝내기]),
   * prepare는 미리 리뷰(V23)를 허락함, again은 [증거 다시 재기]: 이미 잰 head도 다시 잰다(아니면 시작할 때 앞 재기가 이미
   * 잰 head는 건너뛴다)
   */
  pending: (MeasureJob & { done: Promise<void> }) | null
  /** 마지막 증거 재기가 끝나는 때 */
  chain: Promise<void>
  /** sessions.onData·onExit을 걸었나 */
  wired: boolean
  /** 머지(사람·정책)가 도는 중. 둘이 겹치거나 PR 확인이 그사이 끼어들지 않게 */
  merging: boolean
  /** 재개 프롬프트로 rec.notice를 보냈다. 세션의 UserPromptSubmit이 오면 지운다(재개가 바로 실패해도 남게) */
  noticeSent: boolean
  /** Work가 끝나거나 앱이 끝나면 끊는다(돌고 있는 리뷰를 그만둔다) */
  abort: AbortController
  /**
   * 도는 리뷰(V23): 그 head와 계약 hash, 리뷰마다 따로 두는 AbortController. 읽은 HEAD나 계약이 바뀌면 끊는다
   * (works-review.ts followReview). 앱을 닫을 때는 abort가 끊는다
   */
  review: { head: string; hash: string; abort: AbortController } | null
  /** 마지막으로 기록한 자동 머지의 기다림·실패 까닭(같은 까닭을 PR 확인마다 다시 적지 않게) */
  autoMergeNote: string | null
  /** HEAD가 바뀌어 지운 걸린 끝이나 상자의 head(V25, 화면의 한 줄). 다시 [끝내기]·[취소]하거나 Work가 끝나면 null */
  endMoved: string | null
  /** 사람이 화면에서 터미널에 마지막으로 입력한 때(ms, ipc terminalWrite. 앱의 tell은 세지 않는다, V24) */
  lastHumanInputAt: number | null
  /**
   * 보내지 않고 둔 되먹임(V24): 그 head와 까닭(사람이 최근 입력함, 라운드 상한). 같은 까닭을 쉴 때마다 다시 적지 않게. 사람이
   * 입력해 둔 것은 다음에 쉴 때 다시 본다
   */
  feedbackHeld: { head: string; reason: 'human_input' | 'cap' } | null
  /** 터미널에 넣는 마지막 줄(tell)이 끝나는 때. 줄이 서로 섞이지 않게 차례로 넣는다 */
  telling: Promise<void>
}

/** 내보내기 계기(V23의 review 기록 trigger): PR 열기·갱신과 그 확인, [끝내기]·[그래도 끝내기] */
export type ExportTrigger = 'pr' | 'end'

/**
 * 증거 재기 하나: export는 내보내기 계기(아니면 null), prepare는 미리 리뷰를 허락함(V23), again은 이미 잰 head도 다시 잼.
 * head는 재기가 시작할 때 읽은 head다(줄 설 때는 모른다. 읽지 못했으면 null): 걸린 끝(V25)은 끝난 재기가 어느 head를
 * 쟀는지로 다음 일을 정한다
 */
export interface MeasureJob {
  export: ExportTrigger | null
  prepare: boolean
  again: boolean
  head: string | null
}

/** works-contract.ts와 works-evidence.ts가 보는 Works */
export interface WorkCtx {
  readonly deps: WorksDeps
  /** 없으면 던진다 */
  record(id: string): WorkRecord
  /** 없으면 null */
  find(id: string): WorkRecord | null
  runtime(id: string): Runtime
  projectOf(rec: WorkRecord): ProjectRecord
  /** updated_at을 새로 하고 work.json에 쓰고 화면에 알린다 */
  save(rec: WorkRecord): Promise<void>
  /** 화면에 알린다 */
  publish(id: string): void
  /** events.jsonl에 한 줄(실패는 삼킨다) */
  note(id: string, event: Record<string, unknown>): void
  /** 세션에 한 줄을 전한다: 돌고 있으면 터미널에 입력하고, 아니면 다음 재개의 프롬프트로 남긴다 */
  tell(id: string, text: string): Promise<void>
  /** Work가 끝났다(done, abandoned): 타이머를 멈추고 세션을 끝낸다 */
  finish(id: string): Promise<void>
  /** 상태 기계의 사건을 받아 저장하고 기록한다(extra는 events.jsonl에 더할 칸). 끝났으면 finish */
  transition(rec: WorkRecord, ev: WorkEvent, extra?: Record<string, unknown>): Promise<void>
  /**
   * 읽은 HEAD를 화면에 둔다. 걸린 끝이나 끝내기 상자의 head가 아니면 그것을 지우고 저장한다(V25). null이면 아무것도 하지
   * 않는다
   */
  seeHead(id: string, head: string | null): Promise<void>
  /** 증거 재기 job이 하나 끝났다(works-evidence.ts의 줄 안에서): 걸린 끝을 다시 본다(V25, works-end.ts) */
  settleEnd(id: string, job: MeasureJob): Promise<void>
  /** 세션이 쉰다(Stop 뒤 몰아 두기, 미리 리뷰를 허락한 재기 뒤): 세션 몫의 사실이 있으면 되먹임을 보낸다(V24) */
  offerFeedback(id: string): Promise<void>
  /** 프로젝트의 품질 기준 상태(V20)를 뒤에서 다시 잰다(실패는 삼킨다) */
  refreshQuality(projectId: string): void
  log(message: string, error?: unknown): void
}

/** 끝나지 않은 상태 */
export const ACTIVE_STATES = ['drafting', 'awaiting_approval', 'working', 'recontract'] as const

export function isActive(state: string): boolean {
  return (ACTIVE_STATES as readonly string[]).includes(state)
}

/** 증거를 재는 상태: 승인된 계약이 있는 동안 */
export function measures(state: string): boolean {
  return state === 'working' || state === 'recontract'
}

/**
 * Work 브랜치의 끝(V21): worktree의 checkout(HEAD)이 아니라 `refs/heads/<branch>`를 읽는다. 세션이 worktree에서 다른 브랜치로
 * 옮기거나 거기에 커밋해도 재는 대상(증거, 관문의 낡음, [끝내기]의 head)은 바뀌지 않는다. 브랜치가 없으면 던진다
 */
export function refHead(worktree: string, branch: string): Promise<string> {
  return revParse(worktree, `refs/heads/${branch}`)
}

/** Work의 지금 head: Work 브랜치의 끝(refHead) */
export function workHead(rec: Pick<WorkRecord, 'worktree' | 'branch'>): Promise<string> {
  return refHead(rec.worktree, rec.branch)
}

export type { HookEvent }

export const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

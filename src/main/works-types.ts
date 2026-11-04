// Works의 의존과 안쪽 모양 (docs/m2-modules.md 3절 works.ts). works.ts가 600줄을 넘지 않게 계약 창구(works-contract.ts)와
// 증거·머지(works-evidence.ts)를 나눴다. 둘은 이 파일의 WorkCtx로 Works를 본다. Electron을 모른다.

import type { Contract, EvidenceBundle } from '../core/types.ts'
import type { SessionState } from '../core/work.ts'
import type { HookEvent } from '../core/instructions.ts'
import type { SessionHost } from './sessions.ts'
import type { ProjectRecord, Store, WorkRecord } from './store.ts'

/** 독립 리뷰(V4)에 주는 것. 기본 구현은 works-evidence.ts의 claudeReview(claude -p, 읽기 도구만) */
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
  // ── m2-modules 3절의 목록에 더한 것 ──
  /** 열린 PR을 다시 읽는 간격. 기본 120,000ms */
  prPollMs?: number
  /** 장부에 남기고 실적을 가르는 Claude Code 버전(`claude --version`) */
  claudeVersion?: string
  /** 세션과 리뷰의 모델. 없으면 CLI 기본값 */
  model?: string
  /** 처리 실패를 알린다. 기본 console.error */
  log?: (message: string, error?: unknown) => void
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
  /** worktree의 HEAD(마지막으로 읽은 것) */
  head: string | null
  /** 지금 재고 있는 head */
  measuring: string | null
  debounce: ReturnType<typeof setTimeout> | null
  poll: ReturnType<typeof setInterval> | null
  /** 차례를 기다리는 증거 재기(아직 시작하지 않음). 겹친 요청은 하나로 합친다 */
  pending: { exportCandidate: boolean; done: Promise<void> } | null
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
  /** 마지막으로 기록한 자동 머지의 기다림·실패 까닭(같은 까닭을 PR 확인마다 다시 적지 않게) */
  autoMergeNote: string | null
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

export type { HookEvent }

export const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

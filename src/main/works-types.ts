// Works의 의존과 안쪽 모양 (docs/m2-modules.md 3절 works.ts). works.ts가 600줄을 넘지 않게 계약 창구(works-contract.ts),
// 증거(works-evidence.ts), 머지·PR(works-exports.ts), 리뷰(works-review.ts), [끝내기](works-end.ts), 되먹임(works-feedback.ts),
// 화면(works-view.ts)을 나눴다. 이 파일의 WorkCtx로 Works를 본다. 모두가 읽는 Work의 head(Work 브랜치의 끝, V21)와 재는
// 자리(V22: 내보내기와 통합 증거)도 여기에 둔다. Electron을 모른다.

import { containsTip, revParse } from '../adapters/git.ts'
import { contractHash, sliceContract, unitBranch, unitsOf } from '../core/contract.ts'
import type { Contract, EvidenceBundle, Policy } from '../core/types.ts'
import type { SessionState, WorkEvent } from '../core/work.ts'
import type { HookEvent } from '../core/instructions.ts'
import type { FeedbackHold } from '../shared/api.ts'
import type { SessionHost } from './sessions.ts'
import type { SessionLog } from './works-session-log.ts'
import {
  branchExport,
  type ExportRecord,
  type ProjectRecord,
  type Store,
  type WorkFile,
  type WorkRecord,
} from './store.ts'

/** 독립 리뷰(V4)에 주는 것. 기본 구현은 works-review.ts의 claudeReview(claude -p, 읽기 도구만) */
export interface ReviewInput {
  /** Work의 worktree. 리뷰어가 파일을 읽는 곳 */
  cwd: string
  contract: Contract
  /** 요청(works/<id>/request.md, V30). 프롬프트에 인용한 자료로 넣는다. 읽지 못하면 null(리뷰는 요청을 보지 않은 것) */
  request: string | null
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
  /** Stop 뒤 증거를 재기까지 몰아서 기다리는 시간. 기본 5,000ms(V36) */
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
  /** 세션 기록(M4a: 훅 본문의 effort). 훅 서버의 noteHook과 같은 것을 준다. 없으면 effort를 모른다 */
  sessionLog?: SessionLog
  /** 앱 checkout의 git commit(M4a 장부의 relay_build, 감사용). 모르면 없다 */
  relayBuild?: string
  /** 처리 실패를 알린다. 기본 console.error */
  log?: (message: string, error?: unknown) => void
  /**
   * 평가에서 독립 리뷰를 뺀 쪽(RELAY_ABLATE=review, docs/experiments/m2/protocol.md). 제품 설정이 아니다. 리뷰를 부르지
   * 않고 status 'skipped'로 두며, 화면은 '리뷰가 꺼져 있음(평가 설정)'으로 보인다
   */
  reviewDisabled?: boolean
  /** 환경 변수 RELAY_M3(V38, engine/m3.ts). 있으면 프로젝트 설정 m3을 덮는다: 장기 평가의 relay3-m2 쪽은 off */
  m3?: string
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
  /**
   * 자리(브랜치)마다 마지막 묶음(V22): 내보내기는 그 브랜치, branch_per_unit의 통합 증거는 Work 브랜치. one_branch는 Work
   * 브랜치 하나가 내보내기다
   */
  bundles: Map<string, EvidenceBundle>
  /** 자리마다 마지막으로 계산한 관문의 정책(통합 증거가 바뀌면 내보내기의 관문을 다시 계산한다, V22) */
  policies: Map<string, Policy>
  evidenceRunning: boolean
  reviewRunning: boolean
  /** Work 브랜치의 끝(V21, 마지막으로 읽은 것). 화면과 기록은 HEAD라 부른다 */
  head: string | null
  /** 단위 브랜치(V22)의 끝(마지막으로 읽은 것). 브랜치가 없으면 null */
  tips: Tips
  /** 마지막 재기에서 커밋이 Work 브랜치에 다 있지 않던 단위 브랜치의 사실(V22, 화면의 통합 칸) */
  outside: string[]
  /** 지금 재고 있는 head */
  measuring: string | null
  /** 지금 재고 있는 자리(브랜치) */
  measuringAt: string | null
  /**
   * Stop 뒤 몰아 두기의 타이머. 되먹임(V24)을 사람의 최근 입력으로 미뤘으면 창이 끝날 때 다시 보는 타이머도 여기에 둔다:
   * 세션이 다시 움직이면(UserPromptSubmit, push 등 cancelDebounce) 함께 지운다. 이것이 있는 동안은 아직 쉬는 때가 아니다
   */
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
   * 도는 리뷰(V23): 그 내보내기(V22)의 단위와 브랜치, head와 계약 hash, 리뷰마다 따로 두는 AbortController. 읽은 그 브랜치의
   * 끝이나 계약이 바뀌면 끊는다(works-review.ts followReview). 앱을 닫을 때는 abort가 끊는다
   */
  review: {
    unit: string | null
    branch: string
    head: string
    hash: string
    abort: AbortController
  } | null
  /** 마지막으로 기록한 자동 머지의 기다림·실패 까닭(같은 까닭을 PR 확인마다 다시 적지 않게) */
  autoMergeNote: string | null
  /** HEAD가 바뀌어 지운 걸린 끝이나 상자의 head(V25, 화면의 한 줄). 다시 [끝내기]·[취소]하거나 Work가 끝나면 null */
  endMoved: string | null
  /** 사람이 화면에서 터미널에 마지막으로 입력한 때(ms, ipc terminalWrite. 앱의 tell은 세지 않는다, V24) */
  lastHumanInputAt: number | null
  /**
   * 상자의 [세션에 넘기기](V35)를 누른 때(ms). 그 뒤 사람이 터미널에 친 프롬프트는 넘긴 고침이 아니라 사람의 새 일이라 넘긴
   * 끝을 푼다(EndDesk.busy). 앱을 다시 켜면 null(그 뒤의 입력은 모두 그 뒤다)
   */
  handedAt: number | null
  /**
   * 사람이 화면에서 터미널에 마지막으로 친 글이 Enter(나 입력 칸을 비우는 Ctrl+C)로 끝나지 않았다: 입력 칸에 보내지 않은 글이
   * 있을 수 있다(V24). UserPromptSubmit, 질문 메뉴(AskUserQuestion)의 PostToolUse·PostToolUseFailure, 세션을 띄울 때 거짓
   */
  draft: boolean
  /**
   * 보내지 않고 둔 되먹임(V24): 그 head와 까닭. 같은 까닭을 쉴 때마다 다시 적지 않게. 사람의 최근 입력은 창이 끝날 때, 쓰다 둔
   * 글은 사람이 Enter를 친 뒤 창이 끝날 때 다시 본다
   */
  feedbackHeld: { head: string; reason: FeedbackHold } | null
  /** 되먹임 보내기(relay와 [세션에 넘기기])가 끝나는 때. 번호와 '이 head에 보낸 것'이 겹치지 않게 차례로 */
  feeding: Promise<void>
  /** 터미널에 넣는 마지막 줄(tell)이 끝나는 때. 줄이 서로 섞이지 않게 차례로 넣는다 */
  telling: Promise<void>
}

/** 내보내기 계기(V23의 review 기록 trigger): PR 열기·갱신과 그 확인, [끝내기]·[그래도 끝내기] */
export type ExportTrigger = 'pr' | 'end'

/**
 * 증거 재기 하나: export는 내보내기 계기(아니면 null), only는 그 계기로 잴 내보내기의 브랜치(null이면 모두, V22), prepare는
 * 미리 리뷰를 허락함(V23), again은 이미 잰 head도 다시 잼. 계기가 없는 내보내기와 통합 증거는 재지 않았을 때만 잰다. head와
 * tips는 재기가 시작할 때 읽은 Work 브랜치와 단위 브랜치의 끝이다(줄 설 때는 모른다. 읽지 못했으면 null): 걸린 끝(V25)은
 * 끝난 재기가 어느 head를 쟀는지로 다음 일을 정한다
 */
export interface MeasureJob {
  export: ExportTrigger | null
  only: string[] | null
  prepare: boolean
  again: boolean
  head: string | null
  tips: Tips | null
}

/** 단위 브랜치(V22)마다 끝. 브랜치가 없으면 null. one_branch는 빈 것 */
export type Tips = Record<string, string | null>

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
  /** 세션이 쉰다(Stop 뒤 몰아 두기 끝): 세션에 넘겨 다시 건 끝(V35, works-end.ts)을 지금 head로 정한다. 실패는 삼킨다 */
  restEnd(id: string): Promise<void>
  /**
   * 세션이 쉴 수 있는 때(Stop 뒤 몰아 두기 끝, 재기가 끝날 때마다, [끝내기]를 거둔 뒤, 사람의 입력 창이 끝날 때): 세션 몫의
   * 사실이 있으면 되먹임을 보낸다(V24). 실패는 삼킨다
   */
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

// ── 재는 자리(V22) ─────────────────────────────────────────────────────────

/** 단위 브랜치로 내보내는 Work(branch_per_unit): Work 브랜치는 통합 증거이고 내보내기가 아니다 */
export function perUnit(rec: Pick<WorkRecord, 'exports'>): boolean {
  return rec.exports.some((x) => x.unit !== null)
}

/** 승인된 계약의 내보내기: 같은 브랜치의 기록(PR, 증거, 미리 리뷰 수)은 잇는다 */
export function planExports(rec: WorkRecord, contract: Contract): ExportRecord[] {
  const units = contract.delivery === 'branch_per_unit' ? unitsOf(contract) : []
  const branches = units.length === 0 ? [rec.branch] : units.map((u) => unitBranch(rec.branch, u))
  return branches.map((branch, i) => {
    const kept = rec.exports.find((x) => x.branch === branch)
    return kept ?? { ...branchExport(branch), unit: units[i] ?? null }
  })
}

/** 내보내기를 잴 계약: Work 브랜치는 계약 전체, 단위 브랜치는 조각(V22) */
export function exportContract(rt: Pick<Runtime, 'contract'>, x: ExportRecord): Contract | null {
  return rt.contract === null || x.unit === null ? rt.contract : sliceContract(rt.contract, x.unit)
}

/** 엔진에 줄 계약 파일: Work 브랜치는 contract.json, 단위 브랜치는 조각(contract.<단위>.json) */
export function contractFile(x: Pick<ExportRecord, 'unit'>): WorkFile {
  return x.unit === null ? 'contract.json' : `contract.${x.unit}.json`
}

/** 이 계약으로 만든 묶음인가(계약이 없으면 계약 없이 만든 묶음). 관문의 '증거를 만든 뒤 계약이 바뀜'과 같은 견줌이다 */
export function sameContract(e: EvidenceBundle, c: Contract | null): boolean {
  return c === null ? e.contract === null : e.contract?.hash === contractHash(c)
}

/** 선언한 단위 브랜치가 없는 내보내기의 사실(V22). [끝내기]의 열린 것이기도 하다 */
export const missingFact = (x: ExportRecord): string => `단위 브랜치 없음: ${x.branch}`

/** 머지된 내보내기는 다 갔다(V22): 다시 재지 않고 [끝내기]의 열린 것에 넣지 않는다 */
export const delivered = (x: ExportRecord): boolean => x.pr?.state === 'MERGED'

/** 단위 브랜치의 끝(V22). one_branch는 빈 것 */
export async function readTips(rec: WorkRecord): Promise<Tips> {
  const out: Tips = {}
  for (const x of rec.exports)
    if (x.unit !== null) out[x.branch] = await refHead(rec.worktree, x.branch).catch(() => null)
  return out
}

/** 커밋이 Work 브랜치에 다 있지 않은 단위 브랜치의 사실(V22, 통합 증거의 열린 것) */
export const outsideFact = (branch: string): string =>
  `단위 브랜치의 커밋이 Work 브랜치에 없음: ${branch}`

/**
 * 머지되지 않았고 있는 단위 브랜치 가운데 그 끝의 변경이 Work 브랜치의 끝(head)에 다 있지 않은 것(V22). 통합 증거는 그 커밋을
 * 재지 않았다: Work 브랜치가 통합 브랜치라는 약속이 깨졌다. 확인하지 못하면 없는 것으로 본다(엄격한 쪽)
 */
export async function outsideBranches(
  rec: WorkRecord,
  head: string,
  tips: Tips,
): Promise<string[]> {
  const out: string[] = []
  for (const x of rec.exports) {
    const tip = tipOf(x, head, tips)
    if (x.unit === null || delivered(x) || tip === null) continue
    if (!(await containsTip(rec.worktree, head, tip).catch(() => false))) out.push(x.branch)
  }
  return out
}

/** 두 끝 모음이 같다(없으면 빈 것) */
export function sameTips(a: Tips | null | undefined, b: Tips | null | undefined): boolean {
  const x = a ?? {}
  const y = b ?? {}
  const keys = new Set([...Object.keys(x), ...Object.keys(y)])
  return [...keys].every((k) => x[k] === y[k])
}

/** 내보내기의 지금 끝: Work 브랜치는 head, 단위 브랜치는 tips(없으면 null) */
export function tipOf(x: ExportRecord, head: string | null, tips: Tips): string | null {
  return x.unit === null ? head : (tips[x.branch] ?? null)
}

export type { HookEvent }

/**
 * 세션에 넘긴 끝(V35)이 세션의 쉼을 기다린다. 그동안 Stop 뒤 몰아 두기의 타이머가 그 끝을 정하는(rest) 길이므로, 내보내기
 * 재기가 미리 리뷰를 대신하는 계기(PR 확인, [증거 다시 재기])도 그 타이머를 지우지 않는다(rest는 도는 재기에 합친다)
 */
export function handedWaiting(rec: Pick<WorkRecord, 'end_pending'>): boolean {
  const p = rec.end_pending
  return p?.handed === true && !p.armed
}

export const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

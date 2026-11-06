// 메인과 렌더러가 주고받는 모양 (docs/m2-modules.md 3절 shared/api.ts). 타입과 상수만 둔다(런타임 코드 없음).
// 렌더러도 가져가므로 core는 'import type'만 쓴다. Node 내장·electron·adapters는 가져오지 않는다.

import type { SessionState, WorkState } from '../core/work.ts'
import type {
  Contract,
  DebtItem,
  EvidenceBundle,
  GateResult,
  GroundingCheck,
  M3Switches,
  ReviewFinding,
} from '../core/types.ts'

export type { SessionState, WorkState }

// ── 프로젝트 ─────────────────────────────────────────────────────────────────

export interface ProjectSettings {
  /** 자동 머지 스위치(V3). 켜도 조건·서버 보호·그림자 실적을 모두 채울 때만 자동으로 머지한다 */
  auto_merge: boolean
  /** 자동 머지에 필요한 그림자 일치 수 */
  min_shadow: number
  /** 리뷰 범위(V4): 'all' 내보내기 후보마다, 'auto_only' 자동 조건을 채운 후보에만 */
  review: 'all' | 'auto_only'
  merge_method: 'merge' | 'squash' | 'rebase'
  /** 세션이 묻는 방식: 결정마다 확인(첫 기본값, philosophy 원칙 1) 또는 초안 먼저 */
  question_mode: 'confirm_each' | 'draft_first'
  /**
   * M3 장치(docs/m3-design.md, V38)를 장치마다 켜고 끈다. 새로 만드는 Work에 적용되고 Work는 만들 때의 값을 지닌다. 환경 변수
   * RELAY_M3이 있으면 그것이 덮는다(engine/m3.ts)
   */
  m3: M3Switches
}

/** 설정 바꾸기의 입력: 준 칸만 바뀐다. m3은 준 장치만(V39) */
export type SettingsInput = Partial<Omit<ProjectSettings, 'm3'>> & { m3?: Partial<M3Switches> }

export const DEFAULT_SETTINGS: Readonly<ProjectSettings> = {
  auto_merge: false,
  min_shadow: 20,
  review: 'all',
  merge_method: 'squash',
  question_mode: 'confirm_each',
  m3: { knowledge: true, debt: true, tidy: true, promote: true },
}

/**
 * 기본 브랜치(origin/<기본>이 있으면 그것)의 품질 기준 `.relay/quality.json`(V20): 있음, 없음(브랜치를 모를 때도), 깨짐
 * (읽지 못함). 없거나 깨졌으면 앱이 명령을 돌리지 못해 증거가 비고 결론은 늘 사람 머지다
 */
export type QualityState = 'present' | 'missing' | 'invalid'

export interface ProjectView {
  /** 레포 키(폴더 이름 + 경로 해시) */
  id: string
  /** 레포 루트 */
  path: string
  name: string
  /** origin의 기본 브랜치(없으면 로컬 main·master). 모르면 null */
  defaultBranch: string | null
  settings: ProjectSettings
  quality: QualityState
  /**
   * 기본 브랜치에는 품질 기준이 없는데(missing) 프로젝트의 작업 트리에는 .relay/quality.json이 있다: [초안 만들기]로 썼거나
   * 사람이 만들고 아직 기본 브랜치에 커밋하지 않았다
   */
  qualityDraft: boolean
  /**
   * 품질 기준 상태를 읽는 ref: origin/<기본>이 있으면 그것, 없으면 로컬 기본 브랜치. 모르면 null. origin/이면 기본 브랜치에
   * 커밋하고 push해야 쓰인다
   */
  qualityRef: string | null
  /** 실적 장부에서 사람이 나빠진 래칫을 받아들였지만 빚으로 기록하지 않은 내보내기의 수(M3b, core acceptedUnrecorded) */
  unrecordedDebt: number
}

/** [초안 만들기]의 답(V20). 이미 파일이 있으면 덮지 않고 written false. path는 작업 트리의 .relay/quality.json */
export interface DraftQualityResult {
  written: boolean
  path: string
}

// ── PR (adapters/gh.ts의 PrInfo와 같은 모양. shared는 adapters를 가져오지 않는다) ─────────

export type PrState = 'OPEN' | 'CLOSED' | 'MERGED'

export interface PrInfo {
  number: number
  url: string
  state: PrState
  headRefOid: string
  baseRefName: string
  isDraft: boolean
  /** 머지된 시각. 머지되지 않았으면 null */
  mergedAt: string | null
}

// ── Work ─────────────────────────────────────────────────────────────────────

export interface WorkView {
  id: string
  /** 프로젝트 id */
  project: string
  /** 요청의 첫 줄 */
  title: string
  state: WorkState
  session: SessionState
  /** 작업 브랜치 relay/<짧은 이름>-<4자> */
  branch: string
  /** 기준 브랜치 이름(예: main) */
  base: string
  /** 승인된 계약 */
  contract: Contract | null
  /** 승인을 기다리는 계약(awaiting_approval), 또는 계약 바꾸기 요청에 딸린 새 계약(recontract) */
  pendingContract: Contract | null
  /** 세션의 계약 바꾸기 요청 까닭(recontract) */
  pendingChange: string | null
  /**
   * 마지막 증거 묶음. Work 브랜치의 것이다: one_branch는 내보내기, branch_per_unit은 통합 증거(V22: 계약 전체, 결정론만)
   */
  evidence: EvidenceBundle | null
  /** 마지막 관문 결론(Work 브랜치의 내보내기). branch_per_unit은 null(내보내기마다 exports에) */
  gate: GateResult | null
  /** Work 브랜치의 내보내기의 PR. branch_per_unit은 null(내보내기마다 exports에) */
  pr: PrInfo | null
  evidenceRunning: boolean
  reviewRunning: boolean
  /** 평가 설정(RELAY_ABLATE=review)으로 독립 리뷰가 꺼져 있다. 제품 설정이 아니다 */
  reviewDisabled: boolean
  // ── 아래는 m2-modules 3절의 목록에 더한 칸(화면에 필요한 것) ──
  /** 지침이 세션에 준 계약 id(시험 태그 [<id>:C1.1]) */
  contractId: string
  /** 사람이 제안한 일의 성격(V1) */
  hint: string | null
  /** 보이는 계약(pendingContract, 없으면 contract)의 근거 확인. 확인되지 않은 근거는 추정으로 보인다 */
  groundings: GroundingCheck[] | null
  /** 지금 HEAD: Work 브랜치의 끝(V21, worktree의 checkout이 아님). 증거의 head와 다르면 증거가 낡았다(V6). 모르면 null */
  head: string | null
  createdAt: string
  /** 마지막으로 실패한 일(세션 시작, 증거, 머지 등)의 까닭. 없으면 null */
  error: string | null
  /** 지금 HEAD의 걸린 끝이나 끝내기 상자(V25). 다른 Work로 갔다 오거나 앱을 다시 켜도 남는다. 없으면 null */
  endPending: EndPending | null
  /** HEAD가 바뀌어 지운 걸린 끝이나 상자의 head(화면이 '[끝내기] 뒤 세션이 새로 커밋'을 보인다). 다시 누르면 null */
  endMoved: string | null
  /**
   * [끝내기]로 끝난 Work(done)가 끝낼 때 남긴 리뷰 메모(V37: 관문 사실이 아닌 지적, 머지되지 않은 내보내기마다). 끝을 막지
   * 않았으므로 끝난 Work의 [증거]에 접어 보인다. 끝나지 않았거나 다른 길로 끝났으면(PR 머지·닫힘, 버림) 빈 것
   */
  endMemos: EndMemo[]
  /** 쉬는 세션에 준 되먹임(V24) */
  feedback: FeedbackView
  /** 단위 브랜치의 내보내기(V22, branch_per_unit). one_branch는 빈 목록이다(위 칸들이 Work 브랜치의 내보내기다) */
  exports: ExportView[]
  /**
   * branch_per_unit의 통합 증거(evidence)의 열린 것(core openItems, 리뷰를 빼고 지금 HEAD로). 아직 재지 않았으면 null.
   * one_branch는 null
   */
  integration: string[] | null
  /** M3 장치의 스위치(V39): Work를 만들 때 정한 값. 화면은 debt(M3b)로 [머지]·[그래도 끝내기]의 빚 확인을 띄운다 */
  m3: M3Switches
  /** 기록 안 된 나빠짐(M3b): Work를 만들 때 실적 장부의 앞 기록과 기준 브랜치를 견줘 찾은 것. [계약]이 위에 알린다 */
  unrecorded: string[]
}

/**
 * 단위 브랜치의 내보내기 하나(V22): 그 브랜치의 끝, 계약의 조각으로 잰 증거, 관문, PR, 되먹임. head가 null이면 아직 읽지
 * 못했고, missing이면 브랜치가 없다(관문은 '단위 브랜치 없음')
 */
export interface ExportView {
  unit: string
  branch: string
  head: string | null
  missing: boolean
  evidence: EvidenceBundle | null
  gate: GateResult | null
  pr: PrInfo | null
  evidenceRunning: boolean
  reviewRunning: boolean
  feedback: FeedbackView
}

/** 세션에 보낸 되먹임 파일 하나(V24, works/<id>/feedback/<n>.md) */
export interface FeedbackRound {
  n: number
  head: string
  at: string
  /** relay: 쉬는 세션에 저절로(라운드로 센다). human: 사람이 [세션에 넘기기](세지 않는다) */
  by: 'relay' | 'human'
  /** 보낸 사실의 이름(core FeedbackFact.key, 지적은 findingKey). 같은 head에 다시 보내지 않는다 */
  keys: string[]
  /** 결정론 사실과 리뷰 지적의 수 */
  facts: number
  findings: number
}

/**
 * 쉬는 세션에 되먹임(V24)을 저절로 보내지 않은 까닭: 라운드 상한에 닿음, 사람 몫의 리뷰 올림을 사람이 아직 넘기지 않음(세션이
 * 고쳐 head가 움직이면 다음 리뷰가 그것을 다시 올리지 않을 수 있다), 사람이 입력 칸에 쓰다 둔 글이 있을 수 있음(그 글에 붙어
 * 함께 보내진다), 사람이 최근 터미널에 입력함(창이 끝나면 다시 본다)
 */
export type FeedbackHold = 'cap' | 'human_findings' | 'draft' | 'human_input'

/**
 * [증거]의 되먹임 상태(V24). rounds는 relay가 저절로 보낸 라운드(Work마다 max까지, 두 종류를 합쳐). sent는 지금 HEAD에 보낸
 * 파일(path는 그 파일). findings는 지금 HEAD의 묶음에 있는 리뷰 지적마다 갈래(session: 쉬는 세션에 저절로 감, human: 사람에게만,
 * [세션에 넘기기])와 이 head에 보냈는지. pending은 지금 HEAD의 세션 몫 사실 가운데 아직 보내지 않은 수, held는 그 까닭
 * (세션이 일하는 중이면 null: 쉬면 보낸다)
 */
export interface FeedbackView {
  rounds: number
  max: number
  sent: (FeedbackRound & { path: string })[]
  findings: Record<string, { route: 'session' | 'human'; sent: boolean }>
  pending: number
  held: FeedbackHold | null
}

/**
 * [끝내기](V25)가 Work에 남긴 것. armed면 걸린 끝: 이 head의 내보내기 증거(리뷰 포함)가 끝나면 열린 것을 보고 끝내거나
 * 상자로 바꾼다. 아니면 상자: open은 열린 것(core openItems, 관문이 사람 머지로 보내는 사실). head가 바뀌거나 계약이
 * 바뀌거나 Work가 끝나면 지운다. handed면 상자의 [세션에 넘기기](V35)가 다시 건 끝('고친 뒤 끝냄')이다: armed가 아니면
 * 세션이 고치고 쉬기를 기다리고(head가 바뀌어도 지우지 않고 새 head로 옮긴다), 세션이 쉬면 그 head로 걸린 끝(armed)이 된다.
 * 열린 것이 있으면 handed 없는 상자로 돌아간다. open은 늘 빈 것
 */
export interface EndPending {
  head: string
  armed: boolean
  open: string[]
  /** branch_per_unit(V22)의 단위 브랜치마다 끝(없으면 null). 이것이 바뀌어도 지운다 */
  tips?: Record<string, string | null>
  /** 상자에서 세션에 넘겨 다시 건 끝(V35). 없으면 거짓 */
  handed?: true
}

/** [끝내기]가 끝낼 때 남긴 리뷰 메모 하나(V37). unit은 그 내보내기의 단위(V22 branch_per_unit), one_branch는 없다 */
export interface EndMemo {
  unit?: string
  finding: ReviewFinding
}

/** 상자의 [세션에 넘기기](V35)가 보낼 리뷰 지적: 내보내기마다(unit은 단위 브랜치의 내보내기, V22) */
export interface HandPick {
  unit?: string
  ids: string[]
}

/**
 * 상자의 [세션에 넘기기](V35)의 입력. head는 상자의 head(지금 HEAD가 다르면 넘기지 않는다). picks는 보낼 리뷰 지적이고,
 * 세션 몫의 사실 가운데 이 head에 아직 보내지 않은 것은 메인이 함께 보낸다
 */
export interface HandInput {
  head: string
  picks: HandPick[]
}

export interface WorkList {
  projects: ProjectView[]
  works: WorkView[]
}

export interface NewWorkInput {
  /** 프로젝트 id */
  project: string
  /** 요청 글(여러 줄) */
  request: string
  /** 일의 성격 제안(선택, V1): 예 '버그 고침', '리팩터링' */
  hint?: string
  /** 기준 브랜치. 없으면 프로젝트의 기본 브랜치 */
  base?: string
}

export interface ChangeAnswer {
  approved: boolean
  /** 세션에게 줄 말 */
  message: string
}

export interface MergeResult {
  ok: boolean
  error?: string
}

/**
 * [머지]의 입력(M3b). debt는 확인에서 [빚으로 남기고 머지]: 증거의 나빠진 래칫을 .relay/debt/에 커밋하고 push한 뒤
 * 머지한다. 없거나 거짓이면 [그냥 머지](장부에 '받아들였지만 기록하지 않음')
 */
export interface MergeInput {
  debt?: boolean
}

/**
 * [끝내기](V25)의 답: 끝남(ended), 걸림(armed: 내보내기 증거와 리뷰를 기다림), 상자(open: 열린 것) 가운데 하나. head는 본
 * HEAD이고, [그래도 끝내기]가 재는 사이 정책이 머지해 끝났으면 null
 */
export interface PreparedEnd {
  head: string | null
  ended: boolean
  armed: boolean
  open: string[]
}

/**
 * [끝내기]의 입력. force는 [그래도 끝내기]이고 head는 상자의 head다. 아니면 head는 화면의 HEAD(다르면 끝내지 않는다)이고
 * tips는 화면의 단위 브랜치의 끝(V22, 다르면 끝내지 않는다)
 */
export interface EndInput {
  head?: string
  force?: boolean
  tips?: Record<string, string | null>
  /** [그래도 끝내기]의 빚 확인(M3b)에서 [빚으로 남기고 끝내기]. MergeInput.debt와 같다 */
  debt?: boolean
}

/** terminal.attach의 답: 최근 출력(최대 200KB)과 그다음 조각의 번호. 이후 조각은 seq ≥ 이 값만 받는다 */
export interface TerminalBacklog {
  data: string
  seq: number
  /** 세션이 돌고 있나 */
  live: boolean
}

// ── 이벤트 (메인 → 렌더러) ───────────────────────────────────────────────────

export const EVENTS = {
  /** Work 하나가 바뀜. payload: WorkView */
  work: 'relay:work',
  /** 프로젝트 목록이 바뀜. payload: ProjectView[] */
  projects: 'relay:projects',
  /** 세션 출력 조각. payload: TerminalData */
  terminalData: 'relay:terminal-data',
  /** 세션이 끝남. payload: TerminalExit */
  terminalExit: 'relay:terminal-exit',
} as const

export type RelayEvent = (typeof EVENTS)[keyof typeof EVENTS]

export interface TerminalData {
  id: string
  data: string
  seq: number
}

export interface TerminalExit {
  id: string
  code: number
}

export interface RelayEventPayload {
  'relay:work': WorkView
  'relay:projects': ProjectView[]
  'relay:terminal-data': TerminalData
  'relay:terminal-exit': TerminalExit
}

// ── preload가 내놓는 API (window.relay) ─────────────────────────────────────

export interface RelayApi {
  list(): Promise<WorkList>
  /** 폴더 고르기 대화상자. 고르지 않으면 null */
  addProject(): Promise<ProjectView | null>
  updateSettings(projectId: string, s: SettingsInput): Promise<ProjectView>
  createWork(o: NewWorkInput): Promise<WorkView>
  /** 멈춘 세션을 --resume으로 다시 연다 */
  resumeWork(id: string): Promise<void>
  approveContract(id: string): Promise<void>
  askChanges(id: string, message: string): Promise<void>
  answerChange(id: string, o: ChangeAnswer): Promise<void>
  /** [머지]: 내보내기 하나. unit은 단위 브랜치의 내보내기(V22, branch_per_unit에서는 꼭 준다). o는 빚 확인(M3b) */
  merge(id: string, unit?: string, o?: MergeInput): Promise<MergeResult>
  /**
   * [끝내기](V25): 지금 HEAD의 내보내기 증거(리뷰 포함)에 열린 것이 없으면 끝낸다. 아직 재지 않았으면 걸어 두고 재며, 열린
   * 것이 있으면 상자로 둔다. force([그래도 끝내기])는 head(상자의 head)가 지금 HEAD일 때만 끝낸다. 다르면 던진다
   */
  end(id: string, o: EndInput): Promise<PreparedEnd>
  /** [취소]·[더 고치기]: 걸린 끝이나 상자(V35: 세션에 넘겨 다시 건 끝도)를 지운다 */
  cancelEnd(id: string): Promise<void>
  /**
   * 상자의 [세션에 넘기기](V35): 리뷰 지적(picks)과 아직 보내지 않은 세션 몫의 사실을 되먹임 파일로 세션에 보내고(V24 꼴, 라운드로
   * 세지 않는다) 끝을 '고친 뒤 끝냄'으로 다시 건다. 세션이 쉬면 그 head의 내보내기 증거와 리뷰를 재서 열린 것이 없으면 끝내고,
   * 있으면 상자를 다시 띄운다. 상자가 없거나 head가 지금 HEAD가 아니면 던진다
   */
  handEnd(id: string, o: HandInput): Promise<void>
  abandon(id: string): Promise<void>
  /** [증거 다시 재기]. 열린 PR이 있으면 내보내기 후보로(리뷰 포함) 잰다 */
  runEvidence(id: string): Promise<void>
  /**
   * [세션에 넘기기](V24): 지금 HEAD의 리뷰 지적(id)을 되먹임 파일로 세션에 보낸다. 사람에게만 보이는 지적(계약 밖 변경, 메모
   * 등)도 보낸다. 라운드 상한에 세지 않는다. unit은 그 지적의 내보내기(V22, branch_per_unit에서는 꼭 준다)
   */
  sendFindings(id: string, ids: string[], unit?: string): Promise<void>
  terminal: {
    attach(id: string): Promise<TerminalBacklog>
    write(id: string, data: string): void
    resize(id: string, cols: number, rows: number): void
  }
  /** `git diff --stat`과 파일별 diff(기준과 HEAD의 공통 조상부터) */
  diff(id: string): Promise<string>
  /** 이 Work가 건드린 경로의 빚 항목 */
  debt(id: string): Promise<DebtItem[]>
  /** [초안 만들기](V20): 품질 기준 초안을 프로젝트의 작업 트리에 쓴다. 커밋은 사람이 한다 */
  draftQuality(projectId: string): Promise<DraftQualityResult>
  /** 이벤트를 받는다. 돌려준 함수를 부르면 그만 받는다 */
  on<E extends RelayEvent>(event: E, cb: (payload: RelayEventPayload[E]) => void): () => void
}

/** ipcMain.handle 채널(렌더러 → 메인). terminalWrite·terminalResize는 답 없이 보낸다(ipcRenderer.send) */
export const IPC = {
  list: 'relay:list',
  addProject: 'relay:add-project',
  updateSettings: 'relay:update-settings',
  createWork: 'relay:create-work',
  resumeWork: 'relay:resume-work',
  approveContract: 'relay:approve-contract',
  askChanges: 'relay:ask-changes',
  answerChange: 'relay:answer-change',
  merge: 'relay:merge',
  end: 'relay:end',
  cancelEnd: 'relay:cancel-end',
  handEnd: 'relay:hand-end',
  abandon: 'relay:abandon',
  runEvidence: 'relay:run-evidence',
  sendFindings: 'relay:send-findings',
  terminalAttach: 'relay:terminal-attach',
  terminalWrite: 'relay:terminal-write',
  terminalResize: 'relay:terminal-resize',
  diff: 'relay:diff',
  debt: 'relay:debt',
  draftQuality: 'relay:draft-quality',
} as const

/** ipcMain.handle의 답. 메인은 던지지 않고 이것으로 돌려주고, preload가 실패를 Error로 바꾼다 */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string }

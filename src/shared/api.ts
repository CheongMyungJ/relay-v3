// 메인과 렌더러가 주고받는 모양 (docs/m2-modules.md 3절 shared/api.ts). 타입과 상수만 둔다(런타임 코드 없음).
// 렌더러도 가져가므로 core는 'import type'만 쓴다. Node 내장·electron·adapters는 가져오지 않는다.

import type { SessionState, WorkState } from '../core/work.ts'
import type {
  Contract,
  DebtItem,
  EvidenceBundle,
  GateResult,
  GroundingCheck,
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
}

export const DEFAULT_SETTINGS: Readonly<ProjectSettings> = {
  auto_merge: false,
  min_shadow: 20,
  review: 'all',
  merge_method: 'squash',
  question_mode: 'confirm_each',
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
  /** 마지막 증거 묶음 */
  evidence: EvidenceBundle | null
  /** 마지막 관문 결론 */
  gate: GateResult | null
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
  /** worktree의 지금 HEAD. 증거의 head와 다르면 증거가 낡았다(V6). 모르면 null */
  head: string | null
  createdAt: string
  /** 마지막으로 실패한 일(세션 시작, 증거, 머지 등)의 까닭. 없으면 null */
  error: string | null
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
 * [끝내기]의 첫 단계(prepareEnd, V18)의 답: 내보내기 증거(리뷰 포함)를 잰 지금 HEAD. 화면은 HEAD가 이것인 동안만 확인
 * 상자를 보인다. 재는 사이 Work가 끝났으면(정책 머지) null
 */
export interface PreparedEnd {
  head: string | null
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
  updateSettings(projectId: string, s: Partial<ProjectSettings>): Promise<ProjectView>
  createWork(o: NewWorkInput): Promise<WorkView>
  /** 멈춘 세션을 --resume으로 다시 연다 */
  resumeWork(id: string): Promise<void>
  approveContract(id: string): Promise<void>
  askChanges(id: string, message: string): Promise<void>
  answerChange(id: string, o: ChangeAnswer): Promise<void>
  merge(id: string): Promise<MergeResult>
  /** [끝내기](V18): 지금 HEAD의 내보내기 증거(리뷰 포함)가 없으면 잰다. Work는 끝내지 않는다 */
  prepareEnd(id: string): Promise<PreparedEnd>
  /**
   * [끝 확정]: head(확인 상자의 head, prepareEnd의 답)가 지금 HEAD일 때만 Work를 끝낸다. 다르면 던진다([끝내기]를 다시).
   * 지금 HEAD의 내보내기 증거가 없으면 먼저 잰다(안전망)
   */
  end(id: string, head: string): Promise<void>
  abandon(id: string): Promise<void>
  /** [증거 다시 재기]. 열린 PR이 있으면 내보내기 후보로(리뷰 포함) 잰다 */
  runEvidence(id: string): Promise<void>
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
  prepareEnd: 'relay:prepare-end',
  end: 'relay:end',
  abandon: 'relay:abandon',
  runEvidence: 'relay:run-evidence',
  terminalAttach: 'relay:terminal-attach',
  terminalWrite: 'relay:terminal-write',
  terminalResize: 'relay:terminal-resize',
  diff: 'relay:diff',
  debt: 'relay:debt',
  draftQuality: 'relay:draft-quality',
} as const

/** ipcMain.handle의 답. 메인은 던지지 않고 이것으로 돌려주고, preload가 실패를 Error로 바꾼다 */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string }

// relay-v3 핵심 타입. 정본이다. 바꾸면 docs/design.md와 docs/m1-modules.md를 함께 고친다.

// ── 품질 기준 (.relay/quality.json, 사람 소유) ────────────────────────────────

export interface CommandSpec {
  id: string
  run: string
  timeout_sec?: number
  /** 이 명령이 JUnit XML을 쓰는 경로(worktree 기준). 있으면 시험 결과를 읽는다 */
  junit?: string
}

export interface SetupSpec {
  run: string
  /** 이 파일들의 해시가 바뀔 때만 setup을 다시 돈다 (V10) */
  inputs: string[]
  /** git clean에서 지우지 않을 경로 (예: node_modules) */
  keep: string[]
  timeout_sec?: number
}

export type RatchetSpec =
  | {
      id: string
      kind: 'file_lines'
      /** 이 줄 수를 넘는 파일이 새로 생기거나, 이미 넘은 파일이 더 커지면 나빠짐 */
      max: number
      include?: string[]
      exclude?: string[]
    }
  | {
      id: string
      /** JUnit 결과의 testcase 수(건너뜀 제외). 줄면 나빠짐 */
      kind: 'test_count'
    }
  | {
      id: string
      kind: 'command'
      /** 표준 출력의 마지막 숫자 줄을 지표 값으로 읽는다 */
      run: string
      better: 'lower' | 'higher'
      timeout_sec?: number
    }

export interface AutoCondition {
  id: string
  /** 더한 줄 + 뺀 줄의 합 상한 */
  max_changed_lines?: number
  /** 바뀐 파일이 모두 이 glob 안에 있어야 한다 */
  paths?: string[]
  no_new_dependencies?: boolean
  no_new_modules?: boolean
  /** 계약의 모든 줄이 시험으로 확인되고 met이어야 한다 */
  require_all_lines_tested?: boolean
}

export interface QualityConfig {
  version: 1
  setup?: SetupSpec
  commands: {
    fast: CommandSpec[]
    acceptance?: CommandSpec
    full?: { ci_checks?: string[]; local?: CommandSpec[] }
  }
  /** 보호 경로 glob. 건드리면 늘 사람 */
  human_paths: string[]
  /** 지킴 파일 glob. 기본 목록(DEFAULT_GUARD_PATHS)에 더한다 */
  guard_paths: string[]
  /** 공개 API 파일 glob. 새 export가 생기면 구조 변경 신호 */
  public_api: string[]
  /** 시험 파일 glob. 시험 약화 신호와 수용 시험 얹기에 쓴다 */
  test_globs: string[]
  /** 승인된 예시 자료 폴더 */
  examples_dir: string
  ratchets: RatchetSpec[]
  /** 지식에서 승격된 검사의 위치(설명용, 판정에 쓰지 않음) */
  rules: string[]
  auto: AutoCondition[]
}

// ── 계약 ────────────────────────────────────────────────────────────────────

/** change 바뀜, new 새로, keep 지킴, remove 없앰, observe 문서·화면, human 사람 */
export type LineKind = 'change' | 'new' | 'keep' | 'remove' | 'observe' | 'human'

export type Grounding =
  | { type: 'code'; path: string; line: number; name?: string }
  | { type: 'request'; quote: string }
  | { type: 'knowledge'; id: string }
  | { type: 'guess' }

export interface ContractLine {
  id: string
  kind: LineKind
  text: string
  grounds: Grounding[]
  examples: string[]
  check: 'test' | 'observe' | 'human'
  /**
   * 단위(V21): 이 줄이 속한 요청 안의 한 부분(버그 하나, 모듈 하나). 꼴은 `^[a-z][a-z0-9-]{0,20}$`. 없으면 모든 단위에 걸친
   * 줄이다. 한 요청은 한 Work와 한 계약이고, 단위는 그 안의 줄 묶음이다
   */
  unit?: string
}

export interface Example {
  id: string
  input: unknown
  output?: unknown
  error?: unknown
  note?: string
}

/**
 * 단위를 내보내는 방식(V21). one_branch: 모든 단위가 Work 브랜치 하나에 있고 단위마다 커밋을 따로 한다. branch_per_unit(V22):
 * 단위마다 브랜치 `<Work 브랜치>--<단위>`(내보내기)를 두고, Work 브랜치에도 모든 단위를 둔다(통합)
 */
export type Delivery = 'one_branch' | 'branch_per_unit'

export interface Contract {
  version: 1
  id: string
  goal: string
  lines: ContractLine[]
  non_goals: string[]
  human_rules: string[]
  examples: Example[]
  /** 사람이 제안한 일의 성격 (V1) */
  hint?: string
  /** 곁들일 정리로 받은 빚 id */
  tidy: string[]
  /** 단위의 전달 방식(V21). 없으면 one_branch */
  delivery?: Delivery
  approved_by?: 'human' | 'caller'
  approved_at?: string
  /** 세션이 계약을 바꾸자고 요청했고 아직 풀리지 않음 */
  change_requested?: string
}

// ── 시험과 명령 결과 ─────────────────────────────────────────────────────────

export type TestStatus = 'passed' | 'failed' | 'error' | 'skipped'

export interface TestCase {
  name: string
  /** 감싼 testsuite 이름들(' > '로 이음). node:test는 describe 이름을 여기에만 낸다 */
  suite?: string
  classname?: string
  file?: string
  status: TestStatus
  message?: string
}

export interface CommandRun {
  id: string
  sha: string
  exit: number | null
  timed_out: boolean
  duration_ms: number
  stdout_tail: string
  stderr_tail: string
  /** junit이 지정됐고 읽혔으면 */
  tests?: TestCase[]
}

/**
 * pass: head 통과. fail: head 두 번 실패, base 통과.
 * pre_existing: head와 base 모두 실패. unstable: head 첫 실패 뒤 다시 통과.
 * not_run: 돌리지 못함(명령 없음, worktree 실패 등)
 */
export type CommandOutcome = 'pass' | 'fail' | 'pre_existing' | 'unstable' | 'not_run'

export interface CommandEvidence {
  id: string
  outcome: CommandOutcome
  head: CommandRun[]
  base?: CommandRun
}

// ── diff ────────────────────────────────────────────────────────────────────

export type ChangeStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T'

export interface FileChange {
  path: string
  old_path?: string
  status: ChangeStatus
  added: number
  deleted: number
  binary: boolean
  added_lines: string[]
  removed_lines: string[]
}

export interface DiffFacts {
  base: string
  head: string
  files: FileChange[]
}

// ── 신호, 래칫, 줄 판정 ──────────────────────────────────────────────────────

export type SignalKind = 'human_path' | 'guard_path' | 'test_weakening' | 'structure_change'

export interface Signal {
  kind: SignalKind
  path?: string
  detail: string
}

export interface RatchetResult {
  id: string
  status: 'better' | 'same' | 'worse' | 'unknown'
  base?: number
  head?: number
  detail: string
  offenders?: { path: string; base?: number; head: number }[]
}

export type LineStatus = 'met' | 'not_met' | 'missing_evidence' | 'human' | 'observe'

export interface ExampleEvidence {
  id: string
  head: TestStatus | 'missing'
  base?: TestStatus | 'missing' | 'not_run'
}

/**
 * 줄 판정에 붙는 고칠 길(V33). keep_base_api: 지킴 줄의 예시(examples) 시험이 기준에서 결과가 없고 기준에서 시험 파일을
 * 불러오지 못했다. 지킴 시험은 기준에 있는 API만 불러야 한다. 판정은 바꾸지 않고 글만 붙인다
 */
export interface LineFix {
  kind: 'keep_base_api'
  examples: string[]
}

export interface LineVerdict {
  line: string
  kind: LineKind
  status: LineStatus
  detail: string
  examples: ExampleEvidence[]
  fix?: LineFix
}

export type GroundingCheck = { line: string; ground: Grounding; ok: boolean; detail: string }

// ── 예시 자료 (V27) ─────────────────────────────────────────────────────────

/**
 * 커밋된 예시 자료와 승인본(앱이 계약에서 쓴 정규 파일)의 차이 하나. field가 있으면 그 예시의 한 칸(input, output, error,
 * note, 또는 더 붙은 칸)이 다르다. 없으면 예시가 통째로 다르다: found가 없으면 파일에 없는 예시, expected가 없으면 승인본에 없는
 * 예시다. 없는 쪽의 값은 칸을 비운다
 */
export interface ExampleFileDiff {
  id: string
  field?: string
  expected?: unknown
  found?: unknown
}

/** head에 커밋된 예시 자료(examples_dir/<계약 id>.json)를 승인본과 값으로 견준 결과 */
export interface ExamplesFileCheck {
  /** 레포 기준 경로 */
  path: string
  /** absent: 커밋되지 않음, unreadable: JSON이 아니거나 예시 id를 열쇠로 하는 객체가 아님 */
  status: 'same' | 'absent' | 'differs' | 'unreadable'
  diffs: ExampleFileDiff[]
  /** unreadable의 까닭 */
  error?: string
}

// ── 리뷰 (M2) ───────────────────────────────────────────────────────────────

/** 리뷰 올림의 갈래. request_gap(V30): 요청이 알리거나 바라는 것을 diff가 설명하지 않음, 또는 알린 증상의 다른 원인 */
export type RaiseReason =
  'example_test_mismatch' | 'security' | 'out_of_contract' | 'structure' | 'request_gap'

export interface ReviewFinding {
  id: string
  severity: 'high' | 'medium' | 'low'
  raise?: RaiseReason
  file?: string
  line?: number
  text: string
}

/**
 * 쉬는 세션에 보낼 결정론 사실 하나(V24, core/review.ts feedbackFacts). text는 영어 마크다운이고 시험 메시지·명령 출력은
 * 울타리로 감싼 자료다. key는 같은 head에 같은 사실을 다시 보내지 않으려고 견주는 이름이다(예: `line:C1:not_met`)
 */
export interface FeedbackFact {
  key: string
  text: string
}

// ── M3 장치 (docs/m3-design.md) ──────────────────────────────────────────────

/** M3 장치. 프로젝트 설정 m3과 환경 변수 RELAY_M3(engine/m3.ts)가 켜고 끈다. 장치를 더하면 이름을 더한다 */
export type M3Device = 'knowledge' | 'debt'
export type M3Switches = Record<M3Device, boolean>

/** 지식 확인 문제(V38). format은 형식 오류(사람 머지 사실), anchor·not_yet은 알림 */
export interface KnowledgeIssue {
  path: string
  kind: 'format' | 'anchor' | 'not_yet'
  detail: string
}

// ── 증거 묶음 ────────────────────────────────────────────────────────────────

export interface EvidenceBundle {
  version: 1
  repo: string
  base: string
  head: string
  created_at: string
  /** 판정에 쓴 quality.json의 내용 해시와 출처(base|head) (V9) */
  quality: { hash: string; from: 'base' | 'head' | 'none' }
  /** 줄 판정에 쓴 계약의 id와 내용 해시(contractHash). 계약 없이 만들었으면 null */
  contract: { id: string; hash: string } | null
  commands: CommandEvidence[]
  lines: LineVerdict[] | null
  /**
   * 커밋된 예시 자료를 승인본과 견준 것(V27). 계약·품질 기준이 없거나 계약에 예시가 없으면 null. V27 앞의 묶음에는 칸이 없다
   */
  examples_file?: ExamplesFileCheck | null
  groundings: GroundingCheck[] | null
  ratchets: RatchetResult[]
  signals: Signal[]
  diff: {
    files: number
    added: number
    deleted: number
    new_dependencies: string[]
    new_modules: string[]
    paths: string[]
    /** 줄 수를 셀 수 없는 바이너리 파일의 경로 */
    binary: string[]
  }
  /**
   * 독립 리뷰(V4). prompt_version은 리뷰어를 부른 리뷰 프롬프트의 판(review.ts REVIEW_PROMPT_VERSION)이다. 미리 리뷰(V23)를
   * 내보내기에 다시 쓸 때 견준다. 건너뜀과 V23 앞의 묶음에는 없다. request는 리뷰어가 요청(request.md)을 받았는가(V30): 참이
   * 아닌 끝난 리뷰는 '리뷰가 요청을 보지 않음'으로 사람 머지다(V15)
   */
  review: {
    status: 'done' | 'failed' | 'skipped'
    findings: ReviewFinding[]
    prompt_version?: number
    request?: boolean
  } | null
  /** 지식 확인(M3a, V38): 이 diff가 바꾼 지식 파일과 문제. 장치를 껐거나 M3 앞의 묶음은 null이거나 칸이 없다 */
  knowledge?: { changed: string[]; issues: KnowledgeIssue[] } | null
  /** 빚 기록 커밋(M3b): 앱이 from(잰 head) 위에 .relay/debt/의 items만 더해 head로 옮겼다. 다시 재지 않은 묶음이다 */
  debt_commit?: { from: string; items: string[] } | null
  /**
   * 이 diff가 이미 둔 빚(M3b): .relay/debt/의 accepted_regression 가운데 나빠진 래칫을 덮는 항목(items)과 모두 덮인
   * 래칫(ratchets). 덮인 래칫은 다시 묻지 않는다. 장치를 껐거나 M3b 앞의 묶음은 null이거나 칸이 없다
   */
  debt_covered?: { ratchets: string[]; items: string[] } | null
  /** 세션이 PR 본문 등에 쓴 주장. 관문에 들어가지 않는다 */
  claims: string | null
  contract_change_requested: boolean
  /** 없는 증거의 이름 (예: 'quality.json', 'acceptance', 'ci') */
  missing: string[]
}

// ── 관문 ─────────────────────────────────────────────────────────────────────

export interface ServerProtection {
  branch_protected: boolean
  required_checks: boolean
  merge_queue: boolean
  up_to_date_required: boolean
}

export interface Policy {
  /** 프로젝트 설정의 자동 머지 스위치 (V3) */
  auto_merge_enabled: boolean
  conditions: AutoCondition[]
  /** gh로 읽은 서버 쪽 보호. 모르면 null */
  server: ServerProtection | null
  /** 조건 id → 그림자 실적이 기준을 넘었나 */
  track_record_ok: Record<string, boolean>
}

export type Conclusion = 'human_merge' | 'auto_merge_candidate' | 'recontract'

/** 통합 증거(V22): Work 브랜치를 계약 전체로 잰 결정론 증거(리뷰 없음, 재지 못했으면 null), 그 계약, 지금 Work 브랜치의 끝 */
export interface Integration {
  evidence: EvidenceBundle | null
  contract: Contract | null
  head: string | null
  /** 앱이 본 통합의 사실(커밋이 Work 브랜치에 다 있지 않은 단위 브랜치). 통합 증거의 열린 것이다 */
  facts?: string[]
}

export interface GateResult {
  conclusion: Conclusion
  /** 결론을 정한 사실 한 줄 */
  decisive: string
  /** 사람 머지로 보낸 까닭 전부(순서는 엄격한 것부터) */
  reasons: string[]
  /** 자동 조건을 채웠으면 그 id */
  condition: string | null
  /** 자동 조건은 채웠지만 스위치·서버·실적 때문에 자동으로 가지 않고 기록만 함 */
  shadow: boolean
}

// ── 빚 장부 (.relay/debt/<id>.md) ────────────────────────────────────────────

export type DebtKind = 'tidy' | 'accepted_regression' | 'rule_violation' | 'test_gap'

export interface DebtItem {
  id: string
  anchor: { path: string; name?: string; metric?: string }
  kind: DebtKind
  /** 출처 Work id나 PR 주소 */
  source: string
  reason: string
  /** YYYY-MM-DD */
  created: string
}

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
}

export interface Example {
  id: string
  input: unknown
  output?: unknown
  error?: unknown
  note?: string
}

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

export interface LineVerdict {
  line: string
  kind: LineKind
  status: LineStatus
  detail: string
  examples: ExampleEvidence[]
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

export type RaiseReason = 'example_test_mismatch' | 'security' | 'out_of_contract' | 'structure'

export interface ReviewFinding {
  id: string
  severity: 'high' | 'medium' | 'low'
  raise?: RaiseReason
  file?: string
  line?: number
  text: string
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
   * 내보내기에 다시 쓸 때 견준다. 건너뜀과 V23 앞의 묶음에는 없다
   */
  review: {
    status: 'done' | 'failed' | 'skipped'
    findings: ReviewFinding[]
    prompt_version?: number
  } | null
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

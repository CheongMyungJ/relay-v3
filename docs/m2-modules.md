# M2 모듈 약속

M2는 Electron 앱에서 한 Work의 생애를 끝까지 잇는다([m2-app.md](m2-app.md)). 타입의 정본은 `src/core/types.ts`(M1)와 `src/shared/api.ts`(M2)다. 아래 함수 모양은 모듈 사이의 약속이다. 바꾸려면 이 문서를 먼저 고친다. M1의 공통 규칙(`m1-modules.md` 머리)을 그대로 따른다.

## 0. 배치와 층

```
src/core        순수 (M1 + work.ts, ledger.ts, git-guard.ts, instructions.ts, review.ts)
src/adapters    git·프로세스·PTY·gh·claude (M1 + pty.ts, claude.ts, gh.ts)
src/engine      check 흐름 (M1)
src/cli         relay CLI (M1)
src/shared      메인·렌더러가 함께 쓰는 IPC 타입 (api.ts). 런타임 코드 없음(타입과 상수만)
src/main        Electron 메인. index.ts와 ipc.ts만 'electron'을 가져온다. 나머지는 Node에서도 돈다(시험)
src/preload     contextBridge
src/renderer    React. shared와 core의 'import type'만
```

- ESLint 층: renderer는 shared와 `import type`만. main은 'electron'을 index.ts·ipc.ts에서만. core·adapters·engine은 'electron' 금지(M1 규칙에 더함).
- 빌드: electron-vite. main은 `src/main/index.ts`, preload는 `src/preload/index.ts`, 렌더러는 `src/renderer/index.html`. MCP 브리지는 main의 두 번째 입력 `src/main/mcp-bridge.ts`로 같은 `out/main/`에 빌드한다. 상대 import의 `.ts`는 Vite가 푼다.
- 개발: `npm run dev`(electron-vite dev), `npm run build`, `npm run start`(빌드 뒤 `electron .`). `package.json`의 `main`은 `out/main/index.js`.
- tsconfig: `tsconfig.json`(node: src/core·adapters·engine·cli·shared·main·preload, test, scripts)과 `tsconfig.web.json`(DOM, jsx: react-jsx, src/renderer, src/shared). `npm run typecheck`은 둘 다.
- 시험 층에 [스모크] `test/smoke/`(Playwright `_electron`, Linux는 `xvfb-run -a`)를 더한다. `npm test`에는 넣지 않고 `npm run test:smoke`.

## 1. core (순수)

### `src/core/work.ts` — Work 상태 기계

```ts
type WorkState = 'drafting' | 'awaiting_approval' | 'working' | 'recontract' | 'done' | 'abandoned'
type SessionState = 'starting' | 'running' | 'idle' | 'stopped'
type WorkEvent =
  | { type: 'contract_submitted'; contract: Contract }      // 유효한 계약만
  | { type: 'contract_approved'; contract: Contract; by: 'human' | 'caller'; at: string }
  | { type: 'contract_changes_asked'; message: string }    // 사람이 고쳐 달라고 함 → drafting
  | { type: 'change_requested'; reason: string }           // 세션이 계약 바꾸기 요청 → recontract
  | { type: 'change_answered'; approved: boolean; contract?: Contract; message: string } // → working
  | { type: 'pr_merged' } | { type: 'pr_closed' } | { type: 'ended' } | { type: 'abandoned' }
function nextState(state: WorkState, ev: WorkEvent): Result<WorkState>  // 허용되지 않은 전이는 오류
function canMerge(state: WorkState): boolean   // working일 때만
```

### `src/core/git-guard.ts`
v2 `app/src/core/git-guard.ts`를 옮긴다(가져오는 v2 모듈은 같은 동작의 순수 함수로). 모양: `guardCommand(command: string, protectedBranches: string[]): { blocked: boolean; reason: string }`. 지킬 브랜치 = 기준 브랜치, `main`, `master`. v2 시험(`app/test/unit/git-guard*.test.ts`)의 경우를 옮긴다.

### `src/core/instructions.ts` — 세션에 주는 글과 파일
- `instructionsText(o: { workId: string; contractId: string; examplesDir: string; baseBranch: string; workBranch: string; questionMode: 'confirm_each' | 'draft_first' }): string` — 영어로(모델용), 사실만. 담는 것: ① 먼저 계약을 쓴다(목표, 줄: kind change|new|keep|remove|observe|human, 줄마다 근거 code path:line | request 인용 | knowledge id | guess, 예시 입력→출력·오류, check test|observe|human, 비목표, 사람만 아는 규칙). ② 사람만 아는 사실은 AskUserQuestion으로 묻는다. confirm_each면 범위와 결정마다 하나씩, 입출력 예시와 오류 동작을 따로(v2 D563, D564의 뜻). draft_first면 초안을 먼저 보이고 남은 것만. ③ `submit_contract`로 제출하고 답을 기다린다. 오류가 오면 고쳐 다시 낸다. ④ 승인 뒤에는 방식이 자유다. 예시 자료는 relay가 `<examplesDir>/<contractId>.json`에 쓴다(V27: 제출이 받아들여지면 초안, 승인과 받아들인 계약 바꾸기 때 승인본). 그 파일은 바꾸지 말고 시험과 함께 커밋하고, 시험은 예시를 그 파일에서 읽는다. relay는 수용 시험을 승인본을 얹어 돌리고, 커밋된 파일이 없거나 다르면 사람에게 보낸다. 시험 이름에 `[<contractId>:C1.1]` 태그를 넣는다. ①의 예시 설명에 'JSON에 없는 값(NaN, Infinity, undefined)은 문자열로 쓰고 note에 바꿔 읽는 법을 적는다'를 둔다. ⑤ `relay_check`로 앱이 잰 증거를 당겨 볼 수 있다. ⑥ 계약을 바꿔야 하면 `request_contract_change`에 까닭과 바꾼 계약 전체를 준다. ⑦ 작업 브랜치 push와 PR 열기는 해도 된다. 막히는 동작(지킬 브랜치 push, 강제 push, 원격 브랜치 삭제, PR 머지). ⑧ 끝나면 무엇을 했고 어디 있는지 터미널에 말한다. 리뷰·시험을 '하라'는 지시는 넣지 않는다.
- `firstPrompt(requestPath: string): string`.
- `sessionSettings(o: { port: number; workId: string }): object` — v2 `hookSettings`와 같은 모양의 http 훅(UserPromptSubmit, Stop, SessionEnd, PreToolUse, PostToolUse, PostToolUseFailure), 머리글 `Authorization: Bearer $RELAY_HOOK_TOKEN`, `allowedEnvVars: ['RELAY_HOOK_TOKEN']`, `disableAllHooks: false`(레포 설정이 relay 훅을 끄지 못하게), `autoMemoryEnabled: false`. URL `http://127.0.0.1:<port>/hook/<workId>/<Event>`.
- `mcpConfig(o: { command: string; args: string[]; env: Record<string, string> }): object` — `{ mcpServers: { relay_work: { type: 'stdio', command, args, env } } }`.
- `launchArgs(o: { sessionId: string; resume: boolean; settingsPath: string; instructionsPath: string; mcpConfigPath: string; prompt: string | null; model?: string; effort?: string }): string[]` — `--dangerously-skip-permissions`, 새 세션은 `--session-id`, 재개는 `--resume`, `--mcp-config <path>`, `--settings <path>`, `--append-system-prompt-file <path>`, 모델·effort, 마지막에 prompt(있으면). `--mcp-config`는 값을 여럿 먹으므로 늘 `--settings` 앞(v2 확인).
- 도구 이름 상수: `MCP_SERVER = 'relay_work'`, `TOOL_SUBMIT = 'submit_contract'`, `TOOL_CHANGE = 'request_contract_change'`, `TOOL_CHECK = 'relay_check'`.

### `src/core/review.ts` — 독립 리뷰(V4)
- `REVIEW_SCHEMA`: `{ findings: [{ severity: 'high'|'medium'|'low', raise?: RaiseReason, file?, line?, text }] }` JSON Schema.
- `reviewPrompt(o: { contract: Contract; diffStat: string; diff: string; evidenceSummary: string[] }): string` — 영어. 읽기 전용, 계약·예시와 수용 시험 대조, 시험이 못 보는 구조·경계값, 계약 밖 변경, 보안. raise는 그 넷일 때만. 예시 대조에는 '예시 자료는 relay가 승인본에서 쓴 파일(증거 요약의 examples file)이고 시험은 그것을 읽어야 한다. 값을 박아 쓴 태그 시험도 불일치'를 담는다(V27). diff는 앞쪽 60,000자까지(잘렸으면 알림).
- `evidenceFacts(e): string[]` — 모델(리뷰어, 세션의 `relay_check`)에게 주는 증거 사실(영어). 상태·id·경로만, 결론과 리뷰 지적은 넣지 않는다. 예외로 예시 자료(V27)는 다르면 어느 예시의 어느 칸이 어떻게 다른지 셋까지 값을 담는다(`examples file <경로>: differs from the approved examples: C1.2 output (expected 10, found 8)`; same·not committed·unreadable). 값은 사람용 글이 아니라 자료라서 넣는다: 예시 id만 알려 세션이 멈췄다(m2.1-design 8절).
- `parseReview(json: unknown): Result<ReviewFinding[]>` — id는 `R1…`로 매긴다.
- `REVIEW_PROMPT_VERSION: number` — 리뷰 프롬프트·스키마의 판. 바꾸면 올린다. 앱이 리뷰 결과를 묶음에 붙일 때 `review.prompt_version`에 적고, 미리 리뷰(V23)를 내보내기에 다시 쓸 때 견준다.
- `reviewReady(e: EvidenceBundle, contract: Contract | null, head: string | null): boolean` — 리뷰 준비(V23): 계약이 있고, 묶음이 이 계약(hash)과 이 head로 만든 것이고(낡지 않음), 못 미침·증거 없음 줄이 없고(줄 판정이 없으면 준비가 아님), 명령이 모두 pass이고, 풀리지 않은 계약 변경 요청(`contract.change_requested`, `e.contract_change_requested`)이 없다. 앱은 쉬는 세션의 이 head에 리뷰를 미리 돌린다.

### `src/core/ledger.ts` — 실적 장부(그림자)
```ts
interface LedgerEntry {
  ts: string; project: string; work: string; head: string
  conclusion: Conclusion; condition: string | null; shadow: boolean
  by?: 'human' | 'policy' | 'human-override'   // 머지했으면 누가
  merged_head?: string; closed?: boolean
  model?: string; claude_version?: string; relay_version: string
}
function trackRecord(entries: LedgerEntry[], project: string, minShadow: number, current: { model?: string; claude_version?: string; relay_version: string }): Record<string, boolean>
```
- 조건마다, 같은 project이고 모델·Claude Code·relay 버전이 지금과 같은 기록만 센다(philosophy 원칙 4: 버전이 바뀌면 다시 잰다).
- 일치: 그림자(shadow true 또는 auto_merge_candidate)였던 head를 사람이 고치지 않고 그대로 머지함(`merged_head === head`). 불일치: 그 Work에서 head 뒤에 더 커밋해 머지했거나 닫음.
- 일치 수 ≥ minShadow이고 일치율 ≥ 95%이면 true.
- `parseLedger(text: string): LedgerEntry[]` — 줄마다 JSON, 깨진 줄은 건너뜀.

## 2. adapters

### `src/adapters/pty.ts`
v2 `app/src/adapters/pty.ts`를 옮긴다(`startPty(opts): PtySession`, DA1 답, 트리 종료: 묶음 뒤 세션에 남은 배경 작업까지). `spawnSpec`(Windows의 .cmd 실행: 명령 줄을 앱이 만들어 `cmd /d /s /c "<줄>"`, cross-spawn처럼 ^로 막음, verbatim)도 함께. `runFile(bin, args, { cwd, timeoutMs, env?, input?, signal? })`(셸 없는 실행, detached 묶음)과 `killRunFiles()`(돌고 있는 runFile을 모두 끝냄, 앱 종료).

### `src/adapters/claude.ts`
- `findClaude(env): string | null` — `CLAUDE_BIN` 먼저, 그다음 PATH.
- `claudeVersion(bin): Promise<string>`.
- `claudeJson(o: { bin: string; cwd: string; prompt: string; schema: object; model?: string; allowedTools: string[]; timeoutMs: number; env?: Record<string,string>; signal?: AbortSignal }): Promise<{ ok: true; value: unknown; usage?: object } | { ok: false; error: string }>` — `claude -p --output-format json --json-schema <schema> --tools ... --allowedTools ... --permission-mode default --setting-sources user`(v2 `claudeJson`을 옮김. 레포의 프로젝트·로컬 설정을 읽지 않는다). 결과의 `structured_output`을 돌려준다. signal을 끊으면 그만둔다.

### `src/adapters/gh.ts`
모두 `gh`를 `exec.run`으로 부르고(인자는 배열, 셸 문자열에 끼우지 않음), 실패는 결과로 돌려준다.
- `ghAvailable(): Promise<boolean>` — `gh auth status`.
- `findPr(repoDir, branch): Promise<PrInfo | null>` — `gh pr list --head <branch> --state all --json number,url,state,headRefOid,baseRefName,isDraft,mergedAt`.
- `prStatus(repoDir, number): Promise<PrStatus>` — `gh pr view --json mergeable,mergeStateStatus,statusCheckRollup,headRefOid,state`.
- `mergePr(repoDir, number, headSha, method: 'merge'|'squash'|'rebase'): Promise<{ ok: boolean; error?: string }>` — `--match-head-commit`.
- `serverProtection(repoDir, baseBranch): Promise<ServerProtection | null>` — `gh api repos/{owner}/{repo}/branches/<b>`(protected, required_status_checks, strict)와 `gh api repos/{owner}/{repo}/rules/branches/<b>`(required_status_checks, merge_queue, pull_request 규칙)를 합친다. 못 읽으면 null.
- 가짜 gh: `test/support/fake-gh/gh.mjs`. 위 명령만, 상태는 `FAKE_GH_STATE` JSON 파일, 받은 인자는 `FAKE_GH_LOG`에 한 줄씩.

## 3. main (Node에서 시험할 수 있게)

### `src/shared/api.ts`
렌더러와 메인이 주고받는 모양: `ProjectView`(더해 `quality: 'present' | 'missing' | 'invalid'`(V20: 기본 브랜치의 `.relay/quality.json`), `qualityDraft: boolean`(기본 브랜치에는 없고 작업 트리에 있음), `qualityRef: string | null`(상태를 읽은 ref: origin/<기본>이 있으면 그것)), `ProjectSettings { auto_merge: boolean; min_shadow: number; review: 'all' | 'auto_only'; merge_method: 'merge'|'squash'|'rebase'; question_mode: 'confirm_each'|'draft_first' }`(기본 false, 20, 'all', 'squash', 'confirm_each'), `WorkView { id, project, title, state, session, branch, base, contract: Contract|null, pendingContract: Contract|null, pendingChange: string|null, evidence: EvidenceBundle|null, gate: GateResult|null, pr: PrInfo|null, evidenceRunning: boolean, reviewRunning: boolean, reviewDisabled: boolean }`(reviewDisabled: 평가 설정 `RELAY_ABLATE=review`로 리뷰를 끔), `EndPending { head: string; armed: boolean; open: string[] }`(V25: [끝내기]의 걸린 끝(armed, 내보내기 증거와 리뷰를 기다림) 또는 상자(open: 열린 것)), `PreparedEnd { head: string | null; ended: boolean; armed: boolean; open: string[] }`(`end`의 답: 끝남, 걸림, 상자 가운데 하나), WorkView에 더해 `endPending: EndPending | null`(지금 HEAD의 걸린 끝이나 상자. work.json에 남는다), `endMoved: string | null`(HEAD가 바뀌어 지운 걸린 끝이나 상자의 head. 화면이 '세션이 새로 커밋했다'를 보인다), `DraftQualityResult { written: boolean; path: string }`, `RelayApi`(preload가 내놓는 함수 목록, 4절), 이벤트 이름.

### `src/main/store.ts`
`$RELAY_HOME`(기본 `~/.relay-v3`). `projects.json`, `works/<id>/{work.json, request.md, contract.json, events.jsonl, settings.json, instructions.md, mcp.json}`, `ledger.jsonl`. 쓰기는 임시 파일 뒤 rename. 같은 파일의 쓰기는 차례로, 읽기는 그 파일에 앞서 줄 선 쓰기 뒤에 한다(Works는 events.jsonl 기록을 기다리지 않고 남기므로 바로 뒤에 읽어도 놓치지 않게). 시계와 id는 주입(`now()`, `newId()`).

### `src/main/hooks.ts`
127.0.0.1 임의 포트 HTTP. `/hook/<workId>/<Event>`(Work마다 토큰), `/control`(머리글 `X-Relay-Work`의 Work id와 그 Work의 control 토큰이 맞아야 한다. 토큰은 세션을 띄울 때마다 새로: `controlTokenFor(workId)`). 본문 8MB 상한. 토큰이 틀리면 401. 핸들러는 주입. v2 `adapters/hooks.ts`에서 필요한 만큼.
- PreToolUse에서 `tool_input.command`가 글인 도구(Bash, PowerShell 등)에 `guardCommand`가 blocked면 `{ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason } }`로 답한다.

### `src/main/mcp-bridge.ts`
stdio MCP 서버(JSON-RPC 2.0, `initialize`, `tools/list`, `tools/call`; 외부 SDK 없이). env `RELAY_CONTROL_URL`, `RELAY_CONTROL_TOKEN`, `RELAY_WORK_ID`. 도구 셋(`submit_contract`의 입력 스키마는 Contract 모양). 호출은 `/control`에 `{ tool, args }`로 POST하고 답을 그대로 도구 결과(text)로. 기다리는 도구는 앱이 답할 때까지 HTTP가 열려 있다. Electron이 Node로 돈다(`ELECTRON_RUN_AS_NODE=1`). 개발·시험에서는 `node src/main/mcp-bridge.ts`.

### `src/main/sessions.ts`
`SessionHost`: Work마다 PTY 하나. `start(workId, { bin, args, cwd, env })`, `write`, `resize`, `kill`, `onData(workId, cb)`, 최근 출력 버퍼(200KB, 다시 붙을 때 보냄), `onExit`.

### `src/main/works.ts` — 조율 (Electron을 모름)
```ts
class Works {
  constructor(deps: {
    store; sessions: SessionHost; hooksPort: number; controlUrl: string
    bridgeCommand: { command: string; args: string[]; env: Record<string,string> }
    claudeBin: string; check: typeof import('../engine/check.ts').check
    review: (o: ReviewInput) => Promise<(EvidenceBundle['review'] & { usage? }) | null>  // usage: 토큰(events.jsonl에만)
    gh: typeof import('../adapters/gh.ts'); now: () => string; newId: () => string
    emit: (event: string, payload: unknown) => void; relayVersion: string
    debounceMs?: number   // 기본 20,000
    reviewDisabled?: boolean   // 평가에서 리뷰를 뺀 쪽(RELAY_ABLATE=review). 제품 설정이 아니다
  })
  addProject(path): Promise<ProjectView>; updateSettings(projectId, s): Promise<ProjectView>
  refreshProjects(): Promise<void>   // 기본 브랜치의 품질 기준 상태를 다시 잰다(V20)
  draftQuality(projectId): Promise<DraftQualityResult>   // [초안 만들기](V20)
  createWork(o: { project; request; hint?; base? }): Promise<WorkView>   // worktree, 브랜치, 파일, 세션 시작
  resumeWork(id): Promise<void>
  onHook(workId, event, body): Promise<HookReply>
  onControl(workId, tool, args, signal): Promise<unknown>   // submit_contract, request_contract_change, relay_check
  approveContract(id): Promise<void>; askChanges(id, message): Promise<void>
  answerChange(id, o: { approved: boolean; message: string }): Promise<void>
  runEvidence(id, o: { exportCandidate: boolean }): Promise<void>   // check → (리뷰) → gate → 장부
  merge(id): Promise<{ ok: boolean; error?: string }>
  hookToken(id): string | null; controlToken(id): string | null   // 세션이 떠 있는 동안만
  end(id, o: { head?: string; force?: boolean }): Promise<PreparedEnd>   // [끝내기](V25): 끝남, 걸림, 상자. force는 [그래도 끝내기](head는 상자의 head)
  cancelEnd(id): Promise<void>   // [취소]·[더 고치기]: 걸린 끝이나 상자를 지운다
  abandon(id): Promise<void>
  view(id): WorkView; list(): { projects: ProjectView[]; works: WorkView[] }
}
```
- 프로젝트(`works-projects.ts`): 품질 기준 상태는 기본 브랜치(origin/<기본>이 있으면 그것)의 `.relay/quality.json`을 `parseQuality`로 읽어 정한다(없음·깨짐·있음, V20). 프로젝트를 더할 때, 목록을 다시 읽을 때(IPC `list`), 새 Work, 증거를 잰 뒤 다시 재고 바뀌면 `EVENTS.projects`. `draftQuality`는 engine `writeDraft`로 프로젝트의 작업 트리에 쓴다(이미 있으면 덮지 않고 `written: false`). 커밋은 사람이 한다.
- createWork: 작업 브랜치 `relay/<짧은 이름>-<4자>`(영문 낱말에 글자가 없으면(한국어로만 쓴 요청, '청구서 합계가 3원 크다'처럼 숫자만 섞인 요청) 한글을 로마자로 옮김. 숫자만으로 된 이름은 짓지 않는다), worktree는 `$RELAY_HOME/worktrees/<workId>`(git worktree add --no-track -b: 기준 브랜치를 upstream으로 두지 않는다). `request.md`에 요청과 hint(`## 일의 성격 제안`). `$RELAY_HOME` 아래 파일은 0600, 폴더는 0700. worktree를 만든 뒤 기준 ref의 quality.json이 적은 명령의 JUnit 출력 경로(`junit`, `junitExcludes`)를 레포의 exclude 파일(`git rev-parse --git-path info/exclude`. linked worktree에서는 공통 git 폴더의 것이라 레포의 다른 worktree에도 걸린다)에 더한다(M2.1 13절). 세션이 수용 시험을 직접 돌려 생긴 출력이 untracked로 보여 `.gitignore`를 고치지 않게 한다. 폴더가 아니라 파일을 `/`로 시작해 쓴다(무시된 파일만 든 폴더는 git status에 보이지 않고, 폴더를 빼면 `test/junit.xml`처럼 커밋할 파일과 같은 폴더일 때 새 파일이 `git add -A`에서 빠진다). 이미 있는 줄은 더하지 않고, 쓰지 못해도 Work는 만든다(로그만).
- submit_contract: `parseContract` 실패나 지침이 준 것과 다른 계약 id(V11)면 바로 `{ status: 'invalid', errors }`. 근거 확인(engine의 근거 확인 함수 또는 core 함수)으로 확인 못 한 근거는 계약 화면에 표시만 한다. 유효하면 예시 자료 초안을 worktree에 쓰고(V27) `awaiting_approval`로 두고 사람의 답(승인 → `{ status: 'approved', contract, examples_file?, note? }`, 고쳐 달라고 함 → `{ status: 'changes', message }`)을 기다린다. 승인하면 `contract.approved_by = 'human'`, `approved_at`, `contract.json`에 쓴다.
- 예시 자료(V27): 계약에 예시가 있으면 `examplesFile(<기준 ref의 quality.json의 examples_dir>, 계약 id)`에 `examplesFileText(계약)`을 Work의 worktree에 `writeInside`로 쓴다(커밋하지 않는다, V20). 쓰는 때는 제출이 형식 검사를 지날 때(초안), 승인(승인본), 받아들인 계약 바꾸기(새 승인본), 재개한 세션이 승인된 계약을 다시 낼 때(승인본)다. 계약 바꾸기 요청과 거절 때는 쓰지 않는다(앞 승인본 그대로). 승인본을 썼으면 approved 답에 `examples_file`(경로)과 `note`('relay wrote the approved examples to <경로>. Do not edit this file; commit it with the tests that read it.')를 붙인다. 기다리는 호출이 없으면 같은 안내를 세션에 전하는 글 끝에 붙인다. events.jsonl에 `{ type: 'examples_written', path, kind: 'draft' | 'approved' }`. 쓰지 못하면(링크·폴더 자리 등) 로그와 `examples_write_failed`만 남기고 계약은 받는다: 증거가 '예시 자료 파일이 커밋되지 않음'으로 사람에게 보낸다.
- 증거 계기(m2-app 1절): '이미 잰 것'은 (head, 지금 계약의 hash)다. Stop 훅이 오면 세션 idle, 지금 HEAD를 지금 계약으로 재지 않았거나 잰 묶음에 미리 리뷰(V23)를 돌릴 때면 debounceMs 뒤(그때 다시 보고) 미리 리뷰를 허락한 내보내기 아닌 재기. PostToolUse(셸 명령)에서 `git push`·`gh pr`이면 `findPr` 뒤 PR이 지금 HEAD를 가리키고 Work의 기준 브랜치로 가면 `runEvidence({ exportCandidate: true })`(기준이 다르면 재지 않고 알림). [끝내기]·[그래도 끝내기]도 export(V25). 계약 바꾸기에 답한 뒤 같은 head도 다시 잰다(앞 묶음이 내보내기였으면 export). `relay_check`는 그 head를 재는 중이면 기다리고 새로 줄 세우지 않는다. 계기가 겹치면 합친다: 한 Work의 재기는 한 번에 하나이고 기다리는 요청은 하나로 합치며, 줄 선 재기는 시작할 때 앞 재기가 이미 잰 head(내보내기면 리뷰까지)면 재지 않는다. 그래서 세션의 git push와 gh pr create가 잇달아 오거나 내보내기 리뷰가 도는 동안 gh pr이 또 와도 같은 head의 리뷰는 한 번이다. [증거 다시 재기](IPC `runEvidence`)만 이미 잰 head도 다시 잰다.
- runEvidence: `check({ repo: worktree, head: HEAD, base: base SHA, contractPath, requestPath, home })`. 같은 head·계약의 결정론 묶음이 있으면(again이 아니면) 다시 재지 않는다. export면 그 묶음에 이 판(`REVIEW_PROMPT_VERSION`)으로 끝난 리뷰가 있을 때 그것을 쓰고 claude -p를 부르지 않는다(events.jsonl `{ type: 'review', trigger, reused: true }`). 아니면 결정론적 묶음과 리뷰 없는 관문을 먼저 보이고(리뷰는 사람을 막지 않는다) 리뷰(프로젝트 설정 review가 'auto_only'면 gate를 리뷰가 됐다고 치고 묶음의 head로 먼저 돌려 자동 조건을 채웠을 때만. `reviewDisabled`면 부르지 않고 skipped, events.jsonl에 `{ type: 'review', status: 'skipped', disabled: true }`)를 붙여 묶음에 넣고 다시 쓴다. 리뷰의 기본 구현은 `works-review.ts`의 `claudeReview`. export가 아니면 같은 head·계약의 리뷰를 잇는다(실패도).
- 미리 리뷰(V23, `works-review.ts`): 미리 리뷰를 허락한 재기(Stop 뒤, 내보내기가 아닌 [증거 다시 재기])에서, 재기가 끝났을 때 세션이 쉬고(idle·stopped) Work가 구현 중(working)이고 묶음에 리뷰가 없고 `reviewReady(묶음, 계약, 지금 HEAD)`이고 `WorkRecord.prepared_reviews`가 4보다 작으면 리뷰한다('auto_only'에서 자동 조건을 못 채우면, `reviewDisabled`면 돌리지 않고 세지 않는다). 부를 때 `prepared_reviews`를 하나 올린다. 리뷰마다 AbortController를 따로 두고(`Runtime.review {head, hash, abort}`, 앱을 닫는 `rt.abort`도 끊는다) 읽은 HEAD(`seeHead`)나 계약(계약 바꾸기 요청과 답)이 그 리뷰의 것과 다르면 끊는다. 리뷰가 끝나면 HEAD를 다시 읽어 그사이 바뀌었으면 끊는다. 끊긴 리뷰는 버린다(묶음·관문·장부에 남기지 않고 events.jsonl에 `{ type: 'review', trigger, aborted: true }`). 내보내기 리뷰도 같다. events.jsonl의 review 기록에 `trigger: prepared | pr | end`. 리뷰 결과의 `prompt_version`은 앱이 붙인다.
- 관문: `gate(bundle, contract, policy, head)`, policy는 프로젝트 설정, quality.json(묶음의 quality.from 쪽)의 auto, `gh.serverProtection`, `trackRecord`. 재는 사이 Work가 끝났으면 관문을 남기지 않는다. 장부 줄, `exported_head`, 정책 머지(결론이 auto_merge_candidate이고 PR이 있으면 바로 `merge`(by 'policy'))는 export에서만 한다(V23): 내보내기가 아닌 재기는 미리 리뷰로 자동 조건을 채워도 장부에 쓰지 않고 머지하지 않는다.
- merge: 한 Work에 한 번에 하나(사람·정책). `canMerge`, gate가 계산됐고 묶음의 계약 hash가 지금 계약과 같은지, PR이 Work의 기준 브랜치로 가고 그 head가 묶음 head와 같은지, `prStatus`의 CI(statusCheckRollup: 실패·취소·진행 중이면 거절, m2-app 1절 8의 머지 게이트)와 mergeable. 그다음 `gh.mergePr`. 장부의 그 Work 기록에 `by`, `merged_head`. 정책 머지는 기다릴 일(CI 진행 중, mergeable UNKNOWN, gh 오류)이면 오류로 적지 않는다.
- PR 상태: PR이 열려 있으면 120초마다 `findPr`(머지가 도는 동안은 건너뜀). 머지되면 `pr_merged`, 닫히면 `pr_closed`. 앱 밖(GitHub)에서 머지됐으면 by 'human-override'로 장부에. 열려 있고 지금 HEAD를 가리키는데 그 head를 내보내기로 재지 않았으면 잰다. 이미 쟀고 결론이 auto_merge_candidate면 정책 머지를 다시 해 본다.
- 앱을 다시 켜면 working·drafting Work의 세션은 stopped로 보이고 [다시 열기]로 `--resume`. 그 session id로 훅을 받은 적이 없으면(대화가 없음) 새 session id와 첫 프롬프트로 새로 띄운다. 멈춘 사이 사람의 답(notice)은 재개한 세션의 UserPromptSubmit이 온 뒤에 지운다.
- `relay_check`의 답: 영어 사실(`evidenceFacts`), 명령의 outcome, 줄의 status와 예시, 없는 증거. 리뷰와 관문 결론은 주지 않는다.
- 끝내기(V25, `works-end.ts`): `end(id, { head? })`([끝내기])는 `canEnd`(working·recontract)를 확인하고 지금 HEAD를 읽는다. head(화면의 HEAD)를 넘겼는데 지금 HEAD가 다르면 끝내지 않고 던진다(화면의 HEAD를 고친다). 지금 계약으로 이 head를 내보내기(리뷰까지)로 쟀고 리뷰가 실패하지 않았으면 core `openItems(묶음, 계약, 지금 HEAD)`를 본다: 비면 `ended`로 끝내고(`{ ended: true }`), 있으면 `end_pending = { head, armed: false, open }`(상자)으로 두고 돌려준다. 이 head의 미리 리뷰(V23)가 끝나 있고 도는 재기가 없으면 그 자리에서 내보내기로 잰 뒤(결정론 증거와 리뷰를 다시 쓴다) 위처럼 본다. 아직 재지 않았거나 리뷰가 돌고 있거나 실패했으면 `end_pending = { head, armed: true, open: [] }`(걸린 끝)으로 두고, 도는 재기가 없으면 내보내기 재기를 줄 세운 뒤 바로 돌려준다(`{ armed: true }`. 실패한 리뷰는 내보내기가 다시 부른다. 미리 리뷰처럼 도는 재기가 있으면 그것이 끝난 뒤 아래에서 줄 세운다: 그사이 HEAD가 바뀌면 재지 않는다). 증거 재기가 하나 끝날 때마다(`run`의 줄 안, 다음 재기 전에. `settleEnd(id, 끝난 재기)`) 걸린 끝을 다시 본다: 줄 선 재기가 남았거나 앱을 닫는 중이면 그대로, HEAD가 바뀌었으면 지우고(`endMoved`), 그 head를 내보내기로 쟀으면 위처럼 끝내거나 상자로 바꾸고, 끝난 재기가 내보내기가 아니었으면(미리 리뷰, V23) 내보내기 재기를 줄 세우고, 내보내기였는데 재지 못했으면(재기 실패) 푼다. `end(id, { head, force: true })`([그래도 끝내기])는 V18의 [끝 확정] 그대로다: 지금 HEAD가 head가 아니면 던지고, 같으면 지금 HEAD의 내보내기 증거가 없을 때 먼저 재고(안전망) 그사이 HEAD가 그대로면 열린 것이 있어도 끝낸다. `cancelEnd`는 걸린 끝이나 상자를 지운다(도는 재기는 그대로 끝난다). `end_pending`은 HEAD가 바뀐 것을 볼 때(Stop, 셸 명령의 PostToolUse·PostToolUseFailure, push 뒤 PR 확인, 재기, 앱 시작), 계약 바꾸기 요청과 답, Work가 끝날 때 지운다. 앱을 다시 켰을 때 걸린 끝이 남아 있으면 이어 잰다. events.jsonl에 `end_armed {head}`, `end_box {head, open}`, `end_cancelled {head, armed}`, `end_moved {from, to, armed}`, `end_failed {head}`, `ended {how: once | armed | box}`(한 번, 걸렸다 끝남, 상자에서 [그래도 끝내기]). 앱을 닫아 끊긴 리뷰(abort)는 `exported_head`·장부·evidence 기록으로 남기지 않는다(재는 사이 끊긴 명령도). 리뷰 결과는 세션에 넣지 않는다(V4, V8).

### `src/main/ipc.ts`, `src/main/index.ts`, `src/preload/index.ts`
`RelayApi`: `list()`(품질 기준 상태를 다시 잰 뒤), `addProject()`(폴더 고르기 대화상자), `updateSettings(id, s)`, `createWork(o)`, `resumeWork(id)`, `approveContract(id)`, `askChanges(id, msg)`, `answerChange(id, o)`, `merge(id)`, `end(id, { head?, force? })`([끝내기], [그래도 끝내기]), `cancelEnd(id)`([취소], [더 고치기]), `abandon(id)`, `runEvidence(id)`, `draftQuality(projectId)`([초안 만들기]), `terminal.attach(id)`(버퍼를 돌려주고 이후 데이터는 이벤트), `terminal.write(id, data)`, `terminal.resize(id, cols, rows)`, `diff(id): Promise<string>`, `debt(id): Promise<DebtItem[]>`, `on(event, cb)`. 창 하나, `contextIsolation: true`, `nodeIntegration: false`.

## 4. renderer

- 레이아웃: 왼쪽 사이드바(프로젝트 → Work, 상태 점, [+ 새 Work], 프로젝트 설정 톱니, 품질 기준이 없거나 깨진 프로젝트는 그 줄에 알림과 [초안 만들기]), 가운데 터미널(xterm + fit), 오른쪽 패널 탭 [계약] [증거] [변경] [빚].
- [계약]: 목표, 줄 표(종류 꼬리표, 글, 근거와 확인됨/추정 표시, 예시 입력→출력, 확인 방법), 비목표, 사람만 아는 규칙, hint. `awaiting_approval`이면 [승인]과, 그 밑에 늘 보이는 글 칸 '고칠 점'과 [보내기](M2.1 13절: 고쳐 달라기를 여는 단계 없이 쓰고 보낸다. 글이 비면 [보내기]를 누를 수 없다). `recontract`면 세션의 요청, 승인본과 제안의 차이(`contractDelta(승인본, 제안)`: 줄과 예시마다 더함·뺌·고침. 고침은 바뀐 칸 이름을 붙인다. 목표·비목표·사람만 아는 규칙·곁들일 정리가 바뀌었으면 그 이름. 승인 표시와 계약 변경 요청 칸은 견주지 않는다), [받아들임]/[거절](글).
- 품질 기준 알림(V20): '이 레포에는 품질 기준(.relay/quality.json)이 없습니다. 앱이 명령을 돌리지 못해 증거가 비고, 결론은 늘 사람 머지입니다.'(깨졌으면 '…이 깨져 읽지 못합니다. …'). [초안 만들기] → '초안을 썼습니다. 검토하고 기본 브랜치에 커밋하면 다음 Work부터 쓰입니다(V9: 기준은 base에서 읽음).'(이미 있으면 덮지 않았다고. 기준을 origin/<기본>에서 읽으면(qualityRef) '…기본 브랜치에 커밋한 뒤 origin에 push하면…'). 작업 트리에 초안이 있으면(qualityDraft) 단추 대신 커밋하라는 글(push도 같다).
- [끝내기](V25): 머리줄의 [끝내기]는 [증거] 탭으로 옮기고 `end(id, { head: 화면의 HEAD })`를 부른다. 열린 것이 없으면 Work가 바로 끝난다. 걸리면(`endPending.armed`) [증거] 맨 위에 '끝내기가 걸려 있습니다: 내보내기 증거와 리뷰가 끝나고 열린 것이 없으면 Work를 끝냅니다. 열린 것이 있으면 여기에 보입니다.'와 [취소](`cancelEnd`)를 보이고 머리줄 단추는 '끝내기 걸림'(누를 수 없음)이다. 열린 것이 있으면 상자 '열린 것이 있습니다. 보고 끝낼지 정하세요. 고칠 것이 있으면 터미널에서 세션에게 말하세요.', 열린 것 목록(리뷰 실패면 '끝내기를 다시 누르면 리뷰를 다시 돌립니다'를 붙임), [그래도 끝내기](`end(id, { head: 상자의 head, force: true })`), [더 고치기](`cancelEnd`). 상자와 걸린 끝은 `view.endPending`이라 다른 Work로 갔다 와도 남는다. HEAD가 바뀌어 지웠으면(`view.endMoved`) 그 자리에 '[끝내기] 뒤 세션이 새로 커밋했습니다(앞 → 지금). 새 커밋의 증거와 리뷰를 보려면 끝내기를 다시 누르세요'를 보인다. 리뷰를 끈 앱(reviewDisabled)은 걸린 끝·[끝내기] 설명·다음 할 일에서 리뷰를 말하지 않는다('내보내기 증거…').
- [증거]: 맨 위(알림과 걸린 끝·끝내기 상자 아래) 결론 한 줄(사람 머지 / 자동 머지 후보 / 계약 다시, 그림자면 '그림자: 자동이었으면 머지했을 것'), 그 아래 decisive 한 줄(리뷰 중이면 그렇게). 메타 줄의 리뷰 한 마디는 지금 HEAD의 리뷰가 끝났으면 '리뷰 끝(이 head): 지적 n개'(V23)이고, 리뷰가 도는 동안은 '리뷰 도는 중…'을 보인다. 리뷰를 평가용으로 껐으면(reviewDisabled) 리뷰 없음·건너뜀을 모두 '리뷰가 꺼져 있음(평가 설정)'으로 쓴다(다른 까닭의 건너뜀 문구와 섞지 않는다). 끝난 Work는 결과(머지됨·머지 없이 끝남·버림)를 먼저 쓴다. 구현 중이면 다음 할 일 한 줄(PR이 지금 HEAD를 가리키지 않음, PR 없음(리뷰가 이미 돌았으면 머지만 PR을 기다림), 품질 기준 없음(위에 알림이 보이면 되풀이하지 않음). 걸린 끝이나 끝내기 상자가 보이면 없음). 펼침: reasons, 명령, 줄 판정, 래칫, 신호, 리뷰 지적(리뷰의 status를 말함), 없는 증거(품질 기준이 없으면 quality.json 먼저), 낡음. [증거 다시 재기]. PR이 있으면 [머지](gate가 계산됐고 state가 working이고 PR이 증거의 head를 가리키며 Work의 기준으로 갈 때. 리뷰 중에도 누를 수 있다). 탭이나 상태가 바뀌면 패널을 맨 위로.
- [변경]: `git diff base..HEAD --stat`과 파일별 diff(접기). 5파일 이하이고 바뀐 줄(더한 줄과 뺀 줄의 합)이 400 이하면 모두 펼친 채로 연다(`diffOpen`, M2.1 13절).
- [빚]: 이 Work가 건드린 경로의 빚 항목.
- 새 Work 대화상자: 프로젝트, 요청(여러 줄), 일의 성격 제안(선택: 버그 고침, 기능, 리팩터링, 문서 칩 + 자유 글), 기준 브랜치(기본 origin의 기본 브랜치).
- 프로젝트 설정: 자동 머지 스위치(설명: 조건·서버 보호·그림자 실적을 모두 채울 때만), min_shadow, 리뷰 범위, 머지 방식, 질문 방식.
- 글은 한국어. 밝은·어두운 테마는 시스템을 따른다.

## 5. 시험

- [단위]: work 상태 기계, git-guard(v2 경우), instructions(인자 순서, 설정 모양), review(스키마, 파싱, 프롬프트 자르기, 리뷰 준비(V23)), ledger(일치·불일치·버전 바뀜).
- [어댑터]: pty(실제 node-pty로 echo, resize, killTree), claude(가짜 `claude -p`), gh(가짜 gh), hooks 서버(토큰, 상한), mcp-bridge(실제 프로세스로 initialize → tools/list → tools/call이 control에 닿음).
- [흐름] `test/flow/works-review.test.ts`(V23): 미리 리뷰가 끝난 head의 [끝내기]는 한 번에 끝남(claude -p 한 번, 장부는 내보내기 한 줄), 미리 리뷰가 도는 동안의 [끝내기]는 걸렸다가 그 리뷰로 끝남, 미리 리뷰로 자동 조건을 채워도 열린 PR을 머지하지 않고 장부에 쓰지 않음(push 뒤 내보내기가 미리 리뷰를 다시 써서 정책이 머지), 셸 커밋과 계약 바꾸기 요청은 도는 리뷰를 멈춤, 리뷰 준비가 아니면(시험 실패) 돌리지 않음과 Work마다 4번까지.
- [흐름] `test/flow/works-end.test.ts`(V25): 열린 것이 없으면 [끝내기] 한 번(걸렸다가 리뷰 뒤 끝남, 이미 잰 head면 바로 끝남), 올림이 있으면 상자(work.json에 남음) → [더 고치기] → 세션이 더 커밋 → 다시 [끝내기] → [그래도 끝내기](다시 재지 않음), 상자 뒤 Stop 없이 커밋 → [그래도 끝내기](앞 head)는 거절·셸 커밋은 Stop 전에 상자를 지움(endMoved), 걸린 끝의 [취소]와 리뷰 중 커밋, 화면의 head가 지금 HEAD가 아니면 [끝내기]도 거절, 리뷰 실패는 상자의 열린 것이고 다시 [끝내기]는 리뷰를 다시 부름, 앱을 닫아 끊긴 리뷰는 내보내기로 남지 않고 다시 켜면 걸린 끝을 이어 잼, 리뷰를 끈 앱은 늘 상자(건너뜀), 품질 기준 상태(missing → 초안 → invalid → present)와 덮지 않는 초안. `works-merge.test.ts`: 같은 head의 내보내기가 도는 동안 또 온 git push·gh pr은 합친다(리뷰 한 번).
- [흐름] `test/flow/works.test.ts`: 가짜 claude(`test/support/fake-claude/fake-claude.mjs`, 시나리오 JSON: 훅 보내기, 파일 쓰기, 커밋, MCP 도구 부르기(브리지 대신 mcp.json의 env로 `/control`에 직접 POST), 기다리기, 끝내기)로 Works를 Node에서 돌린다: 새 Work → 계약 제출(틀린 것 → invalid → 고친 것) → 승인 → 커밋·Stop → 증거(debounce를 짧게) → 관문 human_merge('리뷰 없음' 아님: export면 가짜 리뷰) → 가짜 gh PR → [머지] → done, 장부 기록. 다른 경우: 계약 바꾸기 요청과 답, git-guard 막기(PreToolUse 응답), 앱 재시작 뒤 resume 인자.
- [스모크] `test/smoke/app.spec.ts`: 빌드한 앱을 Playwright `_electron`으로 띄워 프로젝트 추가(대화상자는 메인에서 바꿔 끼움) → 새 Work → 가짜 claude가 계약 제출 → 고칠 점을 쓰고 [보내기](세션이 changes 답을 받고 다시 냄) → [승인] → 증거 패널에 결론 → PR·그림자 → [변경](작은 diff라 펼친 채로) → [머지]. 둘째 프로젝트(품질 기준 없음): 사이드바 알림 → [초안 만들기] → 새 Work → [끝내기] → 걸린 끝 → 상자(열린 것: 품질 기준 없음 등) → 다른 Work로 갔다 와도 상자가 남음 → [더 고치기] → [끝내기] → [그래도 끝내기]. 스크린샷 `test-results/`.

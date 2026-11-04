// 세션에 주는 글과 파일 (docs/m2-modules.md 1절 instructions.ts, docs/m2-app.md 3절).
// 지침은 모델이 읽으므로 영어로, 사실만 담는다. 리뷰·시험을 '하라'는 지시는 넣지 않는다(증거 의무는 앱이 잰다).
// 훅은 Claude Code 내장 HTTP 훅으로 앱의 127.0.0.1 서버에 보낸다. 자동 메모리는 끈다.

/** relay MCP 서버 이름과 도구 이름 (mcp-bridge, Works.onControl과 같이 쓴다) */
export const MCP_SERVER = 'relay_work'
export const TOOL_SUBMIT = 'submit_contract'
export const TOOL_CHANGE = 'request_contract_change'
export const TOOL_CHECK = 'relay_check'

/** 앱이 받는 훅 */
export const HOOK_EVENTS = [
  'UserPromptSubmit',
  'Stop',
  'SessionEnd',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
] as const

export type HookEvent = (typeof HOOK_EVENTS)[number]

/** 훅 토큰을 넘기는 PTY 환경 변수. 설정 파일에는 변수 이름만 적는다 */
export const HOOK_TOKEN_ENV = 'RELAY_HOOK_TOKEN'

/**
 * submit_contract와 request_contract_change는 사람이 답할 때까지 기다린다. Claude Code의 MCP 도구 제한 시간을 하루로 늘린다
 * (v2 ASK_TIMEOUT_MS와 같은 값)
 */
export const MCP_TOOL_TIMEOUT_MS = 24 * 60 * 60 * 1000

/** 세션 PTY에 더하는 환경 변수 */
export function sessionEnv(o: { hookToken: string; workId: string }): Record<string, string> {
  return {
    [HOOK_TOKEN_ENV]: o.hookToken,
    RELAY_WORK_ID: o.workId,
    MCP_TOOL_TIMEOUT: String(MCP_TOOL_TIMEOUT_MS),
  }
}

/** 훅 요청의 제한 시간(초) */
const HOOK_TIMEOUT_SEC = 30

export interface HttpHook {
  type: 'http'
  url: string
  headers: Record<string, string>
  allowedEnvVars: string[]
  timeout: number
}

export interface SessionSettings {
  hooks: Record<HookEvent, { hooks: HttpHook[] }[]>
  /** 레포의 .claude/settings.json이 disableAllHooks: true여도 relay의 훅(바닥 막기, 증거 계기)이 꺼지지 않게 */
  disableAllHooks: false
  autoMemoryEnabled: false
}

export interface InstructionsInput {
  workId: string
  contractId: string
  examplesDir: string
  baseBranch: string
  workBranch: string
  questionMode: 'confirm_each' | 'draft_first'
}

const QUESTIONS: Record<InstructionsInput['questionMode'], string> = {
  confirm_each: `Ask before you submit. Ask one decision per question: the scope (what is in, what is out) and each decision point separately. For each thing to build or change, ask separately (a) what goes in and what comes out, with a concrete example the human can confirm or correct, and (b) what happens on bad input or errors. A question about scope alone gets only a list back; output formats and error rules stay unknown.`,
  draft_first: `Draft the contract first with the most plausible values and show the draft in the terminal. Then ask only what you could not draft without.`,
}

/** a, b or c */
function orList(items: string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`
}

/** 세션의 시스템 프롬프트 끝에 붙이는 지침 (instructions.md) */
export function instructionsText(o: InstructionsInput): string {
  const tag = `[${o.contractId}:C1.1]`
  const examplesFile = `${o.examplesDir.replace(/\/+$/, '')}/${o.contractId}.json`
  const guarded = [...new Set([o.baseBranch, 'main', 'master'])].map((b) => `\`${b}\``)
  return `# relay Work ${o.workId}

You work on one relay Work in this repository. Work branch: \`${o.workBranch}\`. Base branch: \`${o.baseBranch}\`. The request is in the file the first prompt names. relay is the app that shows your terminal to the human, next to the contract and the evidence.

## 1. Contract first

Before you change code, write a contract and submit it with \`${TOOL_SUBMIT}\` (MCP server \`${MCP_SERVER}\`). Read the code, the debt items in \`.relay/debt/\` and \`.relay/quality.json\` as you need.

The contract is JSON:
- \`version\`: 1. \`id\`: \`${o.contractId}\`.
- \`goal\`: what the Work achieves, in a sentence or two.
- \`lines\`: one fact per line that is true when the Work is done. Each line has:
  - \`id\`: \`C1\`, \`C2\`, …
  - \`kind\`: \`change\` (an existing behavior changes), \`new\` (a new behavior), \`keep\` (a behavior that must stay as it is), \`remove\` (a behavior or code goes away), \`observe\` (docs or screens a human looks at), \`human\` (only a human can judge).
  - \`text\`.
  - \`grounds\`: why the line holds, one or more of \`{type: "code", path, line, name?}\` (a path:line at the head), \`{type: "request", quote}\` (words copied exactly from the request), \`{type: "knowledge", id}\`, \`{type: "guess"}\`. relay checks code and request grounds and shows a ground it cannot confirm as a guess.
  - \`examples\`: example ids (\`C1.1\`, \`C1.2\`, …).
  - \`check\`: \`test\`, \`observe\` or \`human\`. A \`human\` line has \`check: "human"\`. A \`test\` line of kind change, new or keep needs at least one example.
- \`examples\`: each \`{id, input, output?, error?, note?}\`, id \`C1.1\` for the first example of line C1: a concrete input and the output or the error it gives.
- \`non_goals\`: what this Work does not do.
- \`human_rules\`: rules only the human knows (business rules, time zones, compatibility promises, who uses the behavior).
- \`hint\`: the human's suggestion about the kind of work, if the request has one.
- \`tidy\`: ids of debt items you take on as a tidy-up, or \`[]\`.

## 2. Questions

Ask the human with \`AskUserQuestion\` for facts only the human knows. Do not ask what the code or the request already answers. ${QUESTIONS[o.questionMode]}

## 3. Submit

\`${TOOL_SUBMIT}\` checks the contract. If it returns errors, fix the contract and call it again. A valid contract waits for the human: the result is \`approved\` with the approved contract, or \`changes\` with the human's message, after which you revise and submit again. If this session was resumed while a call was waiting, call it again.

## 4. After approval

How you do the work is up to you. Commit the approved examples to \`${examplesFile}\` (an object from example id to \`{input, output?, error?, note?}\`, or the contract's \`examples\` array). Put the tag \`${tag}\` in the name of a test (or of its describe block) that shows example C1.1: relay matches tests to contract lines by these tags only.

## 5. Evidence

relay measures evidence on commits, not on uncommitted changes: it runs the commands in \`.relay/quality.json\` on the base and the head, judges contract lines from the tagged tests (a \`change\` line needs its test to fail on the base and pass on the head), and checks ratchets and signals. Call \`${TOOL_CHECK}\` to get the evidence for the current head.

## 6. Changing the contract

If the approved contract has to change, call \`${TOOL_CHANGE}\` with the reason. It waits until the human answers.

## 7. Git and GitHub

You may push \`${o.workBranch}\` and open a PR against \`${o.baseBranch}\`. relay blocks: pushing to ${orList(guarded)}; force pushes; deleting remote branches; pushing all branches; merging PRs (\`gh pr merge\`, or through \`gh api\`). The human merges.

## 8. When you are done

Say in the terminal what you did and where it is (branch, commits, PR), and end your turn.
`
}

/** 첫 프롬프트: 요청 파일의 경로만 담는다. 할 일은 지침에 있다 */
export function firstPrompt(requestPath: string): string {
  return `The request for this Work is in ${requestPath}. Read it and start with the contract.`
}

/** 훅 URL: http://127.0.0.1:<port>/hook/<workId>/<Event> */
export function hookUrl(port: number, workId: string, event: HookEvent): string {
  return `http://127.0.0.1:${port}/hook/${workId}/${event}`
}

/**
 * --settings로 줄 파일의 내용. 이벤트마다 묶음 하나에 http 훅 하나(matcher 없이 모든 도구). 토큰은 PTY 환경 변수
 * $RELAY_HOOK_TOKEN에서 풀리게 allowedEnvVars에 둔다. 재개할 때도 새로 쓴다(포트가 바뀔 수 있음)
 */
export function sessionSettings(o: { port: number; workId: string }): SessionSettings {
  const group = (event: HookEvent) => [
    {
      hooks: [
        {
          type: 'http' as const,
          url: hookUrl(o.port, o.workId, event),
          headers: { Authorization: `Bearer $${HOOK_TOKEN_ENV}` },
          allowedEnvVars: [HOOK_TOKEN_ENV],
          timeout: HOOK_TIMEOUT_SEC,
        },
      ],
    },
  ]
  return {
    hooks: {
      UserPromptSubmit: group('UserPromptSubmit'),
      Stop: group('Stop'),
      SessionEnd: group('SessionEnd'),
      PreToolUse: group('PreToolUse'),
      PostToolUse: group('PostToolUse'),
      PostToolUseFailure: group('PostToolUseFailure'),
    },
    disableAllHooks: false,
    autoMemoryEnabled: false,
  }
}

export interface McpConfig {
  mcpServers: Record<
    string,
    { type: 'stdio'; command: string; args: string[]; env: Record<string, string> }
  >
}

/** --mcp-config로 줄 relay 서버. command는 앱 실행 파일(ELECTRON_RUN_AS_NODE)이나 node다 */
export function mcpConfig(o: {
  command: string
  args: string[]
  env: Record<string, string>
}): McpConfig {
  return {
    mcpServers: {
      [MCP_SERVER]: { type: 'stdio', command: o.command, args: [...o.args], env: { ...o.env } },
    },
  }
}

/**
 * claude 실행 인자. 새 세션은 --session-id, 재개는 --resume(설정·지침·MCP는 --resume이 되살리지 않아 다시 준다).
 * --mcp-config는 값을 여럿 먹어 뒤의 첫 프롬프트까지 값으로 먹으므로 늘 --settings 앞에 둔다(v2에서 확인)
 */
export function launchArgs(o: {
  sessionId: string
  resume: boolean
  settingsPath: string
  instructionsPath: string
  mcpConfigPath: string
  prompt: string | null
  model?: string
  effort?: string
}): string[] {
  return [
    '--dangerously-skip-permissions',
    ...(o.resume ? ['--resume', o.sessionId] : ['--session-id', o.sessionId]),
    '--mcp-config',
    o.mcpConfigPath,
    '--settings',
    o.settingsPath,
    '--append-system-prompt-file',
    o.instructionsPath,
    ...(o.model ? ['--model', o.model] : []),
    ...(o.effort ? ['--effort', o.effort] : []),
    ...(o.prompt ? [o.prompt] : []),
  ]
}

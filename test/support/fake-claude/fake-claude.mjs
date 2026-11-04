#!/usr/bin/env node
// 가짜 claude (docs/m2-modules.md 5절). 실제와 같은 인자를 받는다. 출처: v2 app/test/support/fake-claude/fake-claude.mjs
//
// - `--version`: FAKE_CLAUDE_VERSION(기본 `0.0.0 (가짜 Claude Code)`)을 찍는다.
// - `-p`(리뷰 흉내, src/adapters/claude.ts claudeJson): 표준 입력의 프롬프트를 읽고 FAKE_CLAUDE_REVIEW 파일의 JSON(없으면
//   `{ "findings": [] }`)을 structured_output으로 낸다. --output-format json과 JSON인 --json-schema가 없으면 실패한다.
//   FAKE_CLAUDE_REVIEW_FAIL: exit(종료 코드 1), error(is_error true), garbage(JSON이 아닌 출력),
//   empty(structured_output 없음), hang(끝나지 않음). FAKE_CLAUDE_REVIEW_MS만큼 기다린 뒤 답한다.
// - 그 밖(PTY 대화형): ARGS, FAKE-CLAUDE READY, PID, SIZE를 찍고, 크기가 바뀌면 SIZE를 다시 찍는다.
//   FAKE_CLAUDE_SCENARIO의 JSON이 있으면 단계를 차례로 한다(아래). 단계가 끝나면 끝나지 않고 기다린다(실제처럼 입력 대기).
//   첫 프롬프트(마지막 위치 인자)가 있으면 단계 전에 UserPromptSubmit을 보낸다.
// - 훅: --settings 파일(또는 JSON 글)의 hooks[이벤트]의 http 훅에 본문을 POST한다. 머리글의 $VAR, ${VAR}는
//   allowedEnvVars에 있는 이름만 환경(RELAY_HOOK_TOKEN)에서 푼다. 본문 필드는 v2 녹화본의 모양이다.
// - MCP 도구: --mcp-config 파일의 mcpServers.relay_work.env(RELAY_CONTROL_URL, RELAY_CONTROL_TOKEN, RELAY_WORK_ID)로
//   control에 { tool, args }를 POST한다(브리지 대신). 머리글 Authorization: Bearer <토큰>, X-Relay-Work: <Work id>.
//   RELAY_CONTROL_URL의 경로가 비었으면 /control을 붙인다. 도구 앞뒤로 PreToolUse·PostToolUse(mcp__relay_work__<도구>).
// - --mcp-config는 실제처럼 값을 여럿 먹는다: 다음 '-' 인자까지. 그래서 그 뒤에 바로 첫 프롬프트가 오면 프롬프트가 없다.
// - SIGHUP을 받으면 SessionEnd(reason: other)를 보내고 끝난다(v2 D231).
// - FAKE_CLAUDE_LOG 파일이 있으면 한 줄에 하나씩 JSON을 남긴다: start, hook, bash, denied, mcp, input, review, error.
//
// 시나리오 JSON: 배열이면 새 세션의 단계, 객체면 { "start": [단계…], "resume": [단계…] }(--resume이면 resume).
// 글 값의 {workId} {sessionId} {branch} {head} {cwd} {contractId}(작업 브랜치에서 relay/를 뗀 것)는 지금 값으로 바꾼다.
// 파일 이름에도 쓴다. 단계(do):
//   prompt   { text? }                     UserPromptSubmit (text가 없으면 첫 프롬프트)
//   hook     { event, fields?, tool? }     훅 하나를 그대로 보낸다
//   write    { files: { 경로: 글|null } }   worktree(cwd)에 쓴다(null은 지움). 커밋하지 않는다
//   commit   { files?, message? }          files를 쓰고 git add -A, git commit (훅 없음)
//   bash     { command }                   PreToolUse(Bash). deny면 돌리지 않는다. 아니면 셸로 돌리고 PostToolUse
//                                           (종료 코드가 0이 아니면 PostToolUseFailure)
//   mcp      { tool, args }                control에 POST하고 답을 기록한다(답이 올 때까지 기다린다)
//   ask      { question? }                 AskUserQuestion: PreToolUse, Enter를 기다림, PostToolUse
//   waitInput                              터미널에서 한 줄을 받아 UserPromptSubmit으로 보낸다
//   stop     { message? }                  Stop (stop_hook_active false)
//   sleep    { ms }                        기다린다
//   print    { text }                      터미널에 한 줄
//   exit     { reason?, code? }            SessionEnd를 보내고 끝난다
import { execFileSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const argv = process.argv.slice(2)
const env = process.env
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function record(entry) {
  if (!env.FAKE_CLAUDE_LOG) return
  fs.appendFileSync(env.FAKE_CLAUDE_LOG, `${JSON.stringify({ pid: process.pid, ...entry })}\n`)
}

if (argv[0] === '--version') {
  process.stdout.write(`${env.FAKE_CLAUDE_VERSION || '0.0.0 (가짜 Claude Code)'}\n`)
  process.exit(0)
}

// ── claude -p (리뷰) ─────────────────────────────────────────────────────────

/** 값을 하나 받는 옵션의 값 */
function value(name) {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

async function review() {
  const prompt = fs.readFileSync(0, 'utf8')
  record({ type: 'review', args: argv, prompt, cwd: process.cwd() })
  const failWith = (message) => {
    process.stderr.write(`${message}\n`)
    process.exit(1)
  }
  if (value('--output-format') !== 'json') failWith('가짜 claude: --output-format json이 아님')
  try {
    JSON.parse(value('--json-schema') ?? '')
  } catch {
    failWith('가짜 claude: --json-schema가 JSON이 아님')
  }
  if (!prompt.trim()) {
    failWith(
      'Error: Input must be provided either through stdin or as a prompt argument when using --print',
    )
  }
  const wait = Number(env.FAKE_CLAUDE_REVIEW_MS ?? 0)
  if (wait > 0) await sleep(wait)
  const mode = env.FAKE_CLAUDE_REVIEW_FAIL
  if (mode === 'hang') await new Promise(() => setInterval(() => {}, 60_000))
  if (mode === 'exit') failWith('가짜 리뷰 실패')
  if (mode === 'garbage') {
    process.stdout.write('this is not json\n')
    process.exit(0)
  }
  const file = env.FAKE_CLAUDE_REVIEW
  const data =
    file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { findings: [] }
  process.stdout.write(
    JSON.stringify({
      type: 'result',
      subtype: mode === 'error' ? 'error_during_execution' : 'success',
      is_error: mode === 'error',
      result: mode === 'error' ? '가짜 오류' : '',
      session_id: randomUUID(),
      ...(mode === 'error' || mode === 'empty' ? {} : { structured_output: data }),
      total_cost_usd: 0.0123,
      duration_ms: 42,
      usage: {
        input_tokens: 1000,
        output_tokens: 50,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    }),
  )
  process.exit(0)
}

if (argv.includes('-p') || argv.includes('--print')) await review()

// ── 대화형: 인자 ─────────────────────────────────────────────────────────────

const opts = {
  skip: false,
  sessionId: randomUUID(),
  resume: false,
  settings: null,
  mcpConfig: null,
  instructions: null,
  model: null,
  effort: null,
  prompt: null,
}
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--dangerously-skip-permissions') opts.skip = true
  else if (a === '--session-id') opts.sessionId = argv[++i]
  else if (a === '--resume') {
    opts.sessionId = argv[++i]
    opts.resume = true
  } else if (a === '--settings') opts.settings = argv[++i]
  else if (a === '--append-system-prompt-file') opts.instructions = argv[++i]
  else if (a === '--model') opts.model = argv[++i]
  else if (a === '--effort') opts.effort = argv[++i]
  else if (a === '--mcp-config') {
    // 실제 claude처럼 값을 여럿 먹는다: 다음 옵션 앞까지
    const values = []
    while (i + 1 < argv.length && !argv[i + 1].startsWith('-')) values.push(argv[++i])
    opts.mcpConfig = values[0] ?? null
  } else if (!a.startsWith('-')) opts.prompt = a
}

const out = (s) => process.stdout.write(`${s}\r\n`)
const size = () => `${process.stdout.columns}x${process.stdout.rows}`

// 긴 ARGS 줄을 먼저 쓴다. 뒤에 쓰면 터미널이 좁을 때 접혀 시작 표식을 보이는 줄 밖으로 민다
out(`ARGS ${JSON.stringify(argv)}`)
out('FAKE-CLAUDE READY')
out(`PID ${process.pid}`)
out(`SIZE ${size()}`)
out('한글 출력 확인')
process.stdout.on('resize', () => out(`SIZE ${size()}`))

// 실제 claude처럼 stdin을 raw 모드로 읽는다. Windows의 libuv는 이때만 콘솔 크기 변경을 알아챈다.
// 받은 글은 줄로 모은다: Enter마다 한 줄. 기다리는 단계가 없으면 쌓아 둔다
let typing = ''
const lines = []
const lineWaiters = []
if (process.stdin.isTTY) process.stdin.setRawMode(true)
process.stdin.resume()
process.stdin.on('data', (d) => {
  for (const ch of d.toString('utf8')) {
    if (ch !== '\r' && ch !== '\n') {
      typing += ch
      continue
    }
    const line = typing
    typing = ''
    if (line.trim()) record({ type: 'input', text: line })
    const w = lineWaiters.shift()
    if (w) w(line)
    else lines.push(line)
  }
})
const readLine = () =>
  lines.length > 0 ? Promise.resolve(lines.shift()) : new Promise((r) => lineWaiters.push(r))

// ── 훅 ──────────────────────────────────────────────────────────────────────

function loadSettings() {
  if (!opts.settings) return { hooks: {} }
  const text = opts.settings.trim().startsWith('{')
    ? opts.settings
    : fs.readFileSync(opts.settings, 'utf8')
  return JSON.parse(text)
}

/** 머리글 값의 $VAR, ${VAR}를 푼다. allowedEnvVars에 없는 이름은 빈 글이다 (Claude Code 문서 hooks) */
function interpolate(text, allowed) {
  return text.replace(/\$\{(\w+)\}|\$(\w+)/g, (_m, a, b) => {
    const name = a ?? b
    return allowed.includes(name) ? (env[name] ?? '') : ''
  })
}

function matches(matcher, toolName) {
  if (!matcher || matcher === '*' || toolName === undefined) return true
  try {
    return new RegExp(`^(?:${matcher})$`).test(toolName)
  } catch {
    return matcher === toolName
  }
}

let promptId = null
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop'])

/** 훅을 보내고 마지막 2xx JSON 답을 돌려준다. 연결 실패는 막지 않는 오류다 (v2 S2) */
async function hook(event, fields = {}, toolName) {
  const groups = loadSettings().hooks?.[event] ?? []
  const body = {
    session_id: opts.sessionId,
    ...(promptId ? { prompt_id: promptId } : {}),
    transcript_path: path.join(os.tmpdir(), 'fake-claude', `${opts.sessionId}.jsonl`),
    cwd: process.cwd(),
    // 실제 SessionEnd에는 permission_mode가 없다 (v2 녹화본)
    ...(event === 'SessionEnd'
      ? {}
      : { permission_mode: opts.skip ? 'bypassPermissions' : 'default' }),
    ...(TOOL_EVENTS.has(event) ? { effort: { level: opts.effort ?? 'medium' } } : {}),
    hook_event_name: event,
    ...fields,
  }
  let reply = null
  for (const group of groups) {
    if (!matches(group.matcher, toolName)) continue
    for (const h of group.hooks ?? []) {
      if (h.type !== 'http') continue
      const headers = { 'Content-Type': 'application/json' }
      for (const [k, v] of Object.entries(h.headers ?? {})) {
        headers[k] = interpolate(String(v), h.allowedEnvVars ?? [])
      }
      let status = 0
      let text
      try {
        const res = await fetch(h.url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout((h.timeout ?? 600) * 1000),
        })
        status = res.status
        text = await res.text()
      } catch (e) {
        text = `연결 실패: ${e?.message ?? e}`
      }
      const trimmed = text.trim()
      let json = null
      if (status >= 200 && status < 300 && trimmed.startsWith('{')) {
        try {
          json = JSON.parse(trimmed)
        } catch {
          json = null
        }
      }
      record({ type: 'hook', event, body, status, response: json })
      if (json) reply = json
    }
  }
  return reply
}

const toolUseId = () => `toolu_${randomUUID().replaceAll('-', '').slice(0, 24)}`

// 실제 claude는 SIGHUP을 받으면 SessionEnd 훅을 보내고 끝난다 (v2 D231)
process.on('SIGHUP', () => {
  void hook('SessionEnd', { reason: 'other' }).finally(() => process.exit(129))
})

// ── MCP 도구 (control에 직접) ────────────────────────────────────────────────

function relayEnv() {
  if (!opts.mcpConfig) throw new Error('--mcp-config가 없음')
  const text = opts.mcpConfig.trim().startsWith('{')
    ? opts.mcpConfig
    : fs.readFileSync(opts.mcpConfig, 'utf8')
  const server = JSON.parse(text).mcpServers?.relay_work
  if (!server) throw new Error('--mcp-config에 relay_work가 없음')
  return server.env ?? {}
}

function controlUrl(raw) {
  const u = new URL(raw)
  if (u.pathname === '/' || u.pathname === '') u.pathname = '/control'
  return u.toString()
}

/**
 * control에 POST하고 답을 기다린다. 사람의 답을 기다리는 도구(submit_contract)는 오래 열려 있으므로 fetch(undici의
 * 머리글 시간 제한 300초) 대신 시간 제한 없는 node:http를 쓴다
 */
function callTool(tool, args) {
  const e = relayEnv()
  const body = JSON.stringify({ tool, args })
  return new Promise((resolve, reject) => {
    const req = http.request(
      controlUrl(e.RELAY_CONTROL_URL),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Authorization: `Bearer ${e.RELAY_CONTROL_TOKEN ?? ''}`,
          'X-Relay-Work': e.RELAY_WORK_ID ?? '',
        },
      },
      (res) => {
        let text = ''
        res.setEncoding('utf8')
        res.on('data', (d) => (text += d))
        res.on('end', () => {
          let result = text
          try {
            result = JSON.parse(text)
          } catch {
            // 글 그대로
          }
          resolve({ status: res.statusCode ?? 0, result })
        })
        res.on('error', reject)
      },
    )
    req.on('error', reject)
    req.end(body)
  })
}

// ── 단계 ────────────────────────────────────────────────────────────────────

function gitOut(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

function vars() {
  let workId = ''
  try {
    workId = opts.mcpConfig ? (relayEnv().RELAY_WORK_ID ?? '') : ''
  } catch {
    // MCP 설정이 없다
  }
  return {
    workId,
    sessionId: opts.sessionId,
    cwd: process.cwd(),
    get branch() {
      return gitOut('rev-parse', '--abbrev-ref', 'HEAD')
    },
    get head() {
      return gitOut('rev-parse', 'HEAD')
    },
    // relay가 지침에 준 계약 id: 작업 브랜치 relay/<계약 id>
    get contractId() {
      return gitOut('rev-parse', '--abbrev-ref', 'HEAD').replace(/^relay\//, '')
    },
  }
}

/** 글 값의 {이름}을 바꾼다. 객체와 배열은 안까지 */
function fill(v, vs) {
  if (typeof v === 'string') return v.replace(/\{(\w+)\}/g, (m, k) => (k in vs ? String(vs[k]) : m))
  if (Array.isArray(v)) return v.map((x) => fill(x, vs))
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x, vs)]))
  }
  return v
}

function writeFiles(files, vs) {
  for (const [name, text] of Object.entries(files ?? {})) {
    const file = path.resolve(process.cwd(), fill(name, vs))
    if (text === null) {
      fs.rmSync(file, { force: true, recursive: true })
      continue
    }
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, fill(text, vs))
  }
}

async function prompt(text) {
  promptId = randomUUID()
  await hook('UserPromptSubmit', { prompt: text })
}

async function bash(command) {
  const input = { command, description: 'fake' }
  const fields = { tool_name: 'Bash', tool_input: input, tool_use_id: toolUseId() }
  const pre = await hook('PreToolUse', fields, 'Bash')
  const decision = pre?.hookSpecificOutput?.permissionDecision
  if (decision === 'deny') {
    const reason = pre.hookSpecificOutput.permissionDecisionReason ?? ''
    record({ type: 'denied', command, reason })
    out(`[가짜 claude] 막힘: ${reason}`)
    return
  }
  const started = Date.now()
  const r = spawnSync(command, { shell: true, encoding: 'utf8', cwd: process.cwd() })
  const code = r.status ?? 1
  record({ type: 'bash', command, code, stdout: r.stdout, stderr: r.stderr })
  const duration_ms = Date.now() - started
  if (code === 0) {
    await hook(
      'PostToolUse',
      {
        ...fields,
        tool_response: { stdout: r.stdout, stderr: r.stderr, interrupted: false },
        duration_ms,
      },
      'Bash',
    )
  } else {
    await hook(
      'PostToolUseFailure',
      { ...fields, error: `Exit code ${code}\n${r.stderr}`, is_interrupt: false, duration_ms },
      'Bash',
    )
  }
}

async function mcp(tool, args) {
  const name = `mcp__relay_work__${tool}`
  const fields = { tool_name: name, tool_input: args, tool_use_id: toolUseId() }
  await hook('PreToolUse', fields, name)
  const started = Date.now()
  let called
  try {
    called = await callTool(tool, args)
  } catch (e) {
    // 실제 claude처럼 도구 실패로 보고 다음 단계로 간다
    const error = `연결 실패: ${e?.message ?? e}`
    record({ type: 'mcp', tool, status: 0, error })
    out(`[가짜 claude] ${tool} → ${error}`)
    const failed = { ...fields, error, is_interrupt: false, duration_ms: Date.now() - started }
    return void (await hook('PostToolUseFailure', failed, name))
  }
  const { status, result } = called
  record({ type: 'mcp', tool, status, result })
  const shown = typeof result === 'object' && result !== null ? (result.status ?? status) : status
  out(`[가짜 claude] ${tool} → ${shown}`)
  const content = [
    { type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) },
  ]
  await hook(
    'PostToolUse',
    { ...fields, tool_response: content, duration_ms: Date.now() - started },
    name,
  )
}

async function step(s) {
  const vs = vars()
  switch (s.do) {
    case 'prompt':
      return prompt(fill(s.text, vs) ?? opts.prompt ?? '')
    case 'hook':
      return void (await hook(s.event, fill(s.fields ?? {}, vs), s.tool))
    case 'write':
      return writeFiles(s.files, vs)
    case 'commit': {
      writeFiles(s.files, vs)
      const id = ['-c', 'user.name=fake claude', '-c', 'user.email=fake@relay.invalid']
      execFileSync('git', ['add', '-A'], { stdio: 'ignore' })
      execFileSync(
        'git',
        [
          ...id,
          'commit',
          '-q',
          '--allow-empty',
          '--no-verify',
          '-m',
          fill(s.message ?? 'fake commit', vs),
        ],
        { stdio: 'ignore' },
      )
      return
    }
    case 'bash':
      return bash(fill(s.command, vs))
    case 'mcp':
      return mcp(s.tool, fill(s.args ?? {}, vs))
    case 'ask': {
      const tool_input = { questions: [{ question: fill(s.question ?? '질문', vs), options: [] }] }
      const fields = { tool_name: 'AskUserQuestion', tool_input, tool_use_id: toolUseId() }
      await hook('PreToolUse', fields, 'AskUserQuestion')
      out('질문 대기: Enter를 누르세요')
      await readLine()
      const tool_response = { answers: {} }
      return void (await hook('PostToolUse', { ...fields, tool_response }, 'AskUserQuestion'))
    }
    case 'waitInput': {
      out('입력 대기')
      return prompt(await readLine())
    }
    case 'stop':
      return void (await hook('Stop', {
        stop_hook_active: false,
        last_assistant_message: fill(s.message ?? '끝', vs),
        background_tasks: [],
        session_crons: [],
      }))
    case 'sleep':
      return sleep(s.ms ?? 100)
    case 'print':
      return out(fill(s.text ?? '', vs))
    case 'exit':
      await hook('SessionEnd', { reason: s.reason ?? 'prompt_input_exit' })
      process.exit(s.code ?? 0)
      return
    default:
      throw new Error(`모르는 단계: ${s.do}`)
  }
}

async function run() {
  const file = env.FAKE_CLAUDE_SCENARIO
  const scenario = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : []
  const steps = Array.isArray(scenario)
    ? opts.resume
      ? []
      : scenario
    : ((opts.resume ? scenario.resume : scenario.start) ?? [])
  record({
    type: 'start',
    args: argv,
    sessionId: opts.sessionId,
    resume: opts.resume,
    // 인자에서 읽은 첫 프롬프트. --mcp-config가 먹었으면 null
    prompt: opts.prompt,
    cwd: process.cwd(),
    settings: opts.settings,
    mcpConfig: opts.mcpConfig,
    model: opts.model,
    instructions: opts.instructions ? fs.readFileSync(opts.instructions, 'utf8') : null,
    token: Boolean(env.RELAY_HOOK_TOKEN),
  })
  if (opts.prompt !== null) await prompt(opts.prompt)
  for (const s of steps) {
    out(`[가짜 claude] ${s.do}`)
    await step(s)
  }
  out('[가짜 claude] 대기')
}

run().catch((e) => {
  out(`[가짜 claude] 오류: ${e?.stack ?? e}`)
  record({ type: 'error', error: String(e?.stack ?? e) })
})

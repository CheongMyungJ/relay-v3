import { existsSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  answerDa1,
  cmdArg,
  cmdCommand,
  killRunFiles,
  runFile,
  spawnSpec,
  startPty,
  type PtySession,
} from '../../src/adapters/pty.ts'
import { FAKE_CLAUDE } from '../support/fakes.ts'
import { cleanupAll, makeRepo, makeTempDir } from '../support/repo.ts'

const isWindows = process.platform === 'win32'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let tmp: string

beforeAll(async () => {
  tmp = await makeTempDir('relay-pty-')
})
afterAll(cleanupAll)

function collect(s: PtySession) {
  let out = ''
  let exitCode: number | null = null
  s.onData((d) => {
    out += d
  })
  s.onExit((c) => (exitCode = c))
  const until = async (pred: () => boolean, label: string, ms = 20_000) => {
    const end = Date.now() + ms
    while (!pred()) {
      if (Date.now() > end) throw new Error(`시간 초과: ${label}\n--- 출력 ---\n${out}`)
      await sleep(50)
    }
  }
  return { out: () => out, exited: () => exitCode !== null, code: () => exitCode, until }
}

/** 좀비도 죽은 것으로 본다 */
async function alive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0)
  } catch {
    return false
  }
  try {
    return !/^\d+ \(.*\) Z/.test(await readFile(`/proc/${pid}/stat`, 'utf8'))
  } catch {
    return true
  }
}

async function waitDead(pid: number, ms = 10_000): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (!(await alive(pid))) return true
    await sleep(100)
  }
  return false
}

describe('spawnSpec', () => {
  test('.cmd는 cmd.exe /d /s /c "<명령 줄>"로 감싸고(앱이 만든 줄, verbatim) 나머지는 그대로', () => {
    expect(spawnSpec('C:\\npm\\claude.CMD', ['-p', 'x'])).toEqual({
      file: 'cmd.exe',
      args: ['/d', '/s', '/c', '"C:\\npm\\claude.CMD ^^^"-p^^^" ^^^"x^^^""'],
      verbatim: true,
    })
    expect(spawnSpec('/usr/bin/claude', ['a'])).toEqual({
      file: '/usr/bin/claude',
      args: ['a'],
      verbatim: false,
    })
  })

  test('경로의 빈칸과 인자의 따옴표·&는 cmd가 끊지 못하게 막는다(npm cmd-shim은 %*로 한 번 더 읽어 두 번)', () => {
    expect(cmdCommand('C:\\Program Files\\nodejs\\claude.cmd')).toBe(
      'C:\\Program^ Files\\nodejs\\claude.cmd',
    )
    // MSVC 규칙: 따옴표 앞 \는 두 배로, 따옴표는 \"로, 끝의 \는 두 배로
    const once = (a: string) =>
      cmdArg(a)
        .replace(/\^\^\^/g, '')
        .replace(/\^\^/g, '^')
        .replace(/\^/g, '')
    expect(once('출력은 "A & B"로')).toBe('"출력은 \\"A & B\\"로"')
    expect(once('a\\')).toBe('"a\\\\"')
    expect(once('')).toBe('""')
    // 바깥 줄을 cmd가 한 번 읽은 뒤에도(^ 한 겹 벗김) 따옴표와 &는 모두 ^로 막혀 있다
    const afterOuter = cmdArg('x "y" & z').replace(/\^(.)/g, '$1')
    expect(afterOuter).toBe('^"x^ \\^"y\\^"^ ^&^ z^"')
  })
})

describe('answerDa1', () => {
  test('질의마다 답하고 출력에서 뺀다', () => {
    const replies: string[] = []
    expect(answerDa1('a\x1b[cb\x1b[0cc\x1b[c', (r) => replies.push(r))).toBe('abc')
    expect(replies).toEqual(['\x1b[?1;2c', '\x1b[?1;2c', '\x1b[?1;2c'])
    expect(answerDa1('plain', () => replies.push('x'))).toBe('plain')
    expect(replies).toHaveLength(3)
  })
})

describe('startPty', () => {
  test('가짜 claude의 출력이 오고, 인자와 크기가 전달되고, 크기 변경이 닿고, 트리 종료로 끝난다', async () => {
    const s = startPty({
      bin: FAKE_CLAUDE,
      args: ['--hello', '한글 인자'],
      cwd: tmp,
      cols: 90,
      rows: 25,
    })
    const c = collect(s)
    await c.until(() => c.out().includes('FAKE-CLAUDE READY'), '시작 표식')
    await c.until(() => c.out().includes('SIZE 90x25'), '처음 크기')
    expect(c.out()).toContain('["--hello","한글 인자"]')
    expect(c.out()).toContain('한글 출력 확인')
    s.resize(120, 40)
    await c.until(() => c.out().includes('SIZE 120x40'), '바뀐 크기')
    await s.killTree()
    expect(c.exited()).toBe(true)
    // 끝난 뒤의 쓰기와 크기 변경, 두 번째 종료는 아무것도 하지 않는다
    s.write('x')
    s.resize(80, 24)
    await s.killTree()
  })

  test('환경 변수를 덧붙이고 입력을 받아 되돌려 준다(echo)', async () => {
    const code = [
      "process.stdout.write('ENV ' + process.env.RELAY_PTY_TEST + ' ' + (process.env.PATH ? 'path' : 'nopath') + '\\n')",
      'process.stdin.setRawMode(true)',
      "process.stdin.on('data', (d) => { process.stdout.write('ECHO ' + JSON.stringify(d.toString()) + '\\n'); process.exit(7) })",
    ].join(';')
    const s = startPty({
      bin: process.execPath,
      args: ['-e', code],
      cwd: tmp,
      env: { RELAY_PTY_TEST: '값' },
      cols: 80,
      rows: 24,
    })
    const c = collect(s)
    await c.until(() => c.out().includes('ENV 값 path'), '환경 변수')
    s.write('hi')
    await c.until(() => c.out().includes('ECHO "hi"'), '되돌린 입력')
    await c.until(c.exited, '종료')
    expect(c.code()).toBe(7)
  })

  // ConPTY는 자식의 DA1을 스스로 다룰 수 있어 POSIX에서만 본다(답하는 논리는 위 answerDa1)
  test.runIf(!isWindows)('answerQueries면 DA1 질의를 빼고 xterm처럼 답한다', async () => {
    const code = [
      'process.stdin.setRawMode(true)',
      "process.stdin.on('data', (d) => { process.stdout.write('GOT ' + JSON.stringify(d.toString()) + '\\n'); process.exit(0) })",
      "process.stdout.write('Q\\x1b[cQ\\n')",
    ].join(';')
    const s = startPty({
      bin: process.execPath,
      args: ['-e', code],
      cwd: tmp,
      cols: 80,
      rows: 24,
      answerQueries: true,
    })
    const c = collect(s)
    await c.until(() => c.out().includes('GOT'), '답')
    expect(c.out()).toContain('QQ')
    expect(c.out()).toContain('GOT "\\u001b[?1;2c"')
    expect(c.out()).not.toContain('\x1b[c')
  })

  /** SIGHUP을 무시하는 자식을 둔 트리. leadIgnores면 맨 앞도 무시한다 */
  async function tree(leadIgnores: boolean) {
    // 자식은 SIGHUP 처리를 건 뒤에 KID를 찍는다(그 전에 끝내면 시험이 뜻이 없다)
    const child =
      "process.on('SIGHUP', () => {}); process.stdout.write('KID ' + process.pid + '\\n'); setInterval(() => {}, 1000)"
    const code = [
      "const { spawn } = require('node:child_process')",
      leadIgnores ? "process.on('SIGHUP', () => {})" : '',
      `const c = spawn(process.execPath, ['-e', ${JSON.stringify(child)}], { stdio: 'inherit' })`,
      "process.stdout.write('TREE ' + process.pid + '\\n')",
      'setInterval(() => {}, 1000)',
    ].join(';')
    const s = startPty({ bin: process.execPath, args: ['-e', code], cwd: tmp, cols: 80, rows: 24 })
    const c = collect(s)
    await c.until(() => /TREE \d+/.test(c.out()) && /KID \d+/.test(c.out()), '시작')
    const lead = Number(/TREE (\d+)/.exec(c.out())?.[1])
    const kid = Number(/KID (\d+)/.exec(c.out())?.[1])
    return { s, c, lead, kid }
  }

  test.runIf(!isWindows)('SIGHUP을 무시하는 트리도 유예 뒤 묶음째 끝낸다', async () => {
    const { s, c, lead, kid } = await tree(true)
    const started = Date.now()
    await s.killTree(300)
    expect(Date.now() - started).toBeGreaterThanOrEqual(250)
    expect(c.exited()).toBe(true)
    expect(await waitDead(lead)).toBe(true)
    expect(await waitDead(kid)).toBe(true)
  })

  test.runIf(!isWindows)('다른 프로세스 묶음으로 간 배경 작업(같은 세션)도 끝낸다', async () => {
    const code = [
      "const { spawn } = require('node:child_process')",
      "spawn('/bin/sh', ['-c', 'set -m; sleep 300 & echo BG $!; wait'], { stdio: 'inherit' })",
      "process.stdout.write('TREE ' + process.pid + '\\n')",
      'setInterval(() => {}, 1000)',
    ].join(';')
    const s = startPty({ bin: process.execPath, args: ['-e', code], cwd: tmp, cols: 80, rows: 24 })
    const c = collect(s)
    await c.until(() => /TREE \d+/.test(c.out()) && /BG \d+/.test(c.out()), '시작')
    const bg = Number(/BG (\d+)/.exec(c.out())?.[1])
    await s.killTree(300)
    expect(c.exited()).toBe(true)
    expect(await waitDead(bg, 3_000)).toBe(true)
  })

  test.runIf(!isWindows)('맨 앞이 SIGHUP으로 끝나도 묶음에 남은 자식을 끝낸다', async () => {
    const { s, c, lead, kid } = await tree(false)
    await s.killTree(5_000)
    expect(c.exited()).toBe(true)
    expect(await waitDead(lead)).toBe(true)
    expect(await waitDead(kid, 3_000)).toBe(true)
  })
})

describe('runFile', () => {
  test('셸 없이 인자를 그대로 넘기고 표준 입력을 준다', async () => {
    const code =
      "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{process.stdout.write(JSON.stringify({args:process.argv.slice(1),input:s,env:process.env.RELAY_RUN_TEST}));process.stderr.write('err');process.exit(3)})"
    const r = await runFile(process.execPath, ['-e', code, '$HOME', 'a b', '"q"', '*'], {
      cwd: tmp,
      timeoutMs: 20_000,
      input: '입력 글',
      env: { RELAY_RUN_TEST: 'ok' },
    })
    expect(r.exit).toBe(3)
    expect(r.timed_out).toBe(false)
    expect(r.stderr).toBe('err')
    expect(JSON.parse(r.stdout)).toEqual({
      args: ['$HOME', 'a b', '"q"', '*'],
      input: '입력 글',
      env: 'ok',
    })
  })

  test('큰 출력도 자르지 않는다', async () => {
    const r = await runFile(process.execPath, ['-e', "process.stdout.write('x'.repeat(300000))"], {
      cwd: tmp,
      timeoutMs: 20_000,
    })
    expect(r.exit).toBe(0)
    expect(r.stdout).toHaveLength(300_000)
  })

  test('출력 상한을 넘으면 끝내고 실패로 돌려준다', async () => {
    const r = await runFile(
      process.execPath,
      ['-e', "process.stdout.write('x'.repeat(100000)); setInterval(() => {}, 1000)"],
      { cwd: tmp, timeoutMs: 20_000, maxBytes: 1000 },
    )
    expect(r.exit).toBeNull()
    expect(r.stderr).toContain('상한')
  })

  test('시간이 넘으면 묶음째 끝내고, 없는 실행 파일과 없는 폴더는 던지지 않는다', async () => {
    const r = await runFile(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      cwd: tmp,
      timeoutMs: 300,
    })
    expect(r).toMatchObject({ exit: null, timed_out: true })
    expect(r.stderr).toContain('시간 초과')

    const missing = await runFile(join(tmp, 'no-such-bin'), [], { cwd: tmp, timeoutMs: 5_000 })
    expect(missing.exit).toBeNull()
    expect(missing.stderr).toContain('실행하지 못함')

    const noDir = await runFile(process.execPath, ['-e', ''], {
      cwd: join(tmp, 'no-such-dir'),
      timeoutMs: 5_000,
    })
    expect(noDir.exit).toBeNull()
  })

  test('signal을 끊으면 묶음째 끝내고 그만둠으로 돌려준다. 이미 끊긴 signal이면 띄우지 않는다', async () => {
    const marker = join(tmp, 'aborted-child')
    const code = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'alive'), 1500)`
    const ac = new AbortController()
    const started = Date.now()
    const pending = runFile(process.execPath, ['-e', code], {
      cwd: tmp,
      timeoutMs: 20_000,
      signal: ac.signal,
    })
    setTimeout(() => ac.abort(), 200)
    const r = await pending
    expect(r).toMatchObject({ exit: null, timed_out: false })
    expect(r.stderr).toContain('그만둠')
    expect(Date.now() - started).toBeLessThan(1_500)
    await new Promise((res) => setTimeout(res, 1_800))
    expect(existsSync(marker)).toBe(false)

    const before = await runFile(process.execPath, ['-e', ''], {
      cwd: tmp,
      timeoutMs: 5_000,
      signal: ac.signal,
    })
    expect(before.exit).toBeNull()
    expect(before.stderr).toContain('그만둠')
  })

  test('killRunFiles는 돌고 있는 runFile을 묶음째 끝낸다(앱이 끝날 때: detached 자식이 남지 않게)', async () => {
    const marker = join(tmp, 'killed-child')
    const code = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'alive'), 1500)`
    const pending = runFile(process.execPath, ['-e', code], { cwd: tmp, timeoutMs: 20_000 })
    await new Promise((res) => setTimeout(res, 200))
    killRunFiles()
    const r = await pending
    expect(r.exit).toBeNull()
    await new Promise((res) => setTimeout(res, 1_800))
    expect(existsSync(marker)).toBe(false)
  })
})

// 가짜 claude의 대화형 시나리오: [흐름]이 Works를 이것으로 돌린다. 훅·control 요청의 모양을 여기서 한 번 본다
describe('가짜 claude 시나리오', () => {
  interface Got {
    url: string
    headers: IncomingMessage['headers']
    body: Record<string, unknown>
  }
  let server: Server
  let base: string
  const got: Got[] = []

  beforeAll(async () => {
    server = createServer((req, res) => {
      let text = ''
      req.on('data', (d: Buffer) => (text += d.toString('utf8')))
      req.on('end', () => {
        const body = JSON.parse(text) as Record<string, unknown>
        got.push({ url: req.url ?? '', headers: req.headers, body })
        res.setHeader('Content-Type', 'application/json')
        const tool = (body.tool_input as { command?: string } | undefined)?.command ?? ''
        if (req.url?.endsWith('/PreToolUse') && tool.includes('push --force')) {
          res.end(
            JSON.stringify({
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'deny',
                permissionDecisionReason: '강제 push는 막힘',
              },
            }),
          )
        } else if (req.url === '/control') res.end(JSON.stringify({ status: 'approved' }))
        else res.end('{}')
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => new Promise<void>((r) => server.close(() => r())))

  test('훅을 머리글의 토큰으로 보내고, 쓰고 커밋하고, 막힌 명령은 돌리지 않고, control에 도구를 POST한다', async () => {
    const repo = await makeRepo({ files: { 'a.txt': 'a\n' } })
    const events = [
      'UserPromptSubmit',
      'Stop',
      'SessionEnd',
      'PreToolUse',
      'PostToolUse',
      'PostToolUseFailure',
    ]
    const hooks = Object.fromEntries(
      events.map((e) => [
        e,
        [
          {
            hooks: [
              {
                type: 'http',
                url: `${base}/hook/w1/${e}`,
                headers: {
                  Authorization: 'Bearer $RELAY_HOOK_TOKEN',
                  'X-Other': '$SECRET_NOT_ALLOWED',
                },
                allowedEnvVars: ['RELAY_HOOK_TOKEN'],
              },
            ],
          },
        ],
      ]),
    )
    const settings = join(tmp, 'settings.json')
    const mcp = join(tmp, 'mcp.json')
    const scenario = join(tmp, 'scenario.json')
    const log = join(tmp, 'fake-claude.jsonl')
    await writeFile(settings, JSON.stringify({ hooks, autoMemoryEnabled: false }))
    await writeFile(
      mcp,
      JSON.stringify({
        mcpServers: {
          relay_work: {
            type: 'stdio',
            command: 'node',
            args: ['bridge'],
            env: {
              RELAY_CONTROL_URL: `${base}/control`,
              RELAY_CONTROL_TOKEN: 'ctl',
              RELAY_WORK_ID: 'w1',
            },
          },
        },
      }),
    )
    await writeFile(
      scenario,
      JSON.stringify({
        start: [
          { do: 'commit', files: { 'b.txt': 'b\n' }, message: 'b 더함' },
          { do: 'write', files: { 'draft.txt': '{workId}' } },
          { do: 'bash', command: 'git push --force origin main' },
          { do: 'bash', command: 'git status --short' },
          { do: 'mcp', tool: 'submit_contract', args: { id: 'c-{workId}' } },
          { do: 'stop' },
          { do: 'exit' },
        ],
      }),
    )
    const s = startPty({
      bin: FAKE_CLAUDE,
      args: [
        '--dangerously-skip-permissions',
        '--session-id',
        'sid-1',
        '--mcp-config',
        mcp,
        '--settings',
        settings,
        '첫 프롬프트',
      ],
      cwd: repo.dir,
      env: {
        RELAY_HOOK_TOKEN: 'tok',
        SECRET_NOT_ALLOWED: 'leak',
        FAKE_CLAUDE_SCENARIO: scenario,
        FAKE_CLAUDE_LOG: log,
      },
      cols: 100,
      rows: 30,
    })
    const c = collect(s)
    await c.until(c.exited, '시나리오 끝')
    expect(c.code()).toBe(0)

    const hookCalls = got.filter((g) => g.url.startsWith('/hook/'))
    expect(hookCalls.map((g) => g.url.split('/').pop())).toEqual([
      'UserPromptSubmit',
      'PreToolUse', // push --force: 막힘, PostToolUse 없음
      'PreToolUse',
      'PostToolUse',
      'PreToolUse', // mcp__relay_work__submit_contract
      'PostToolUse',
      'Stop',
      'SessionEnd',
    ])
    for (const h of hookCalls) {
      expect(h.headers.authorization).toBe('Bearer tok')
      expect(h.headers['x-other']).toBe('')
      expect(h.body).toMatchObject({ session_id: 'sid-1', cwd: repo.dir })
    }
    expect(hookCalls[0]?.body).toMatchObject({
      prompt: '첫 프롬프트',
      permission_mode: 'bypassPermissions',
    })
    expect(hookCalls[3]?.body).toMatchObject({
      tool_name: 'Bash',
      tool_input: { command: 'git status --short' },
      tool_response: { stdout: '?? draft.txt\n' },
    })
    expect(hookCalls[4]?.body).toMatchObject({ tool_name: 'mcp__relay_work__submit_contract' })

    const control = got.find((g) => g.url === '/control')
    expect(control?.headers.authorization).toBe('Bearer ctl')
    expect(control?.headers['x-relay-work']).toBe('w1')
    expect(control?.body).toEqual({ tool: 'submit_contract', args: { id: 'c-w1' } })

    expect(await repo.git('log', '-1', '--format=%s')).toBe('b 더함')
    expect(await repo.read('draft.txt')).toBe('w1')
    const entries = (await readFile(log, 'utf8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>)
    expect(entries[0]).toMatchObject({
      type: 'start',
      sessionId: 'sid-1',
      resume: false,
      prompt: '첫 프롬프트',
      token: true,
    })
    expect(entries.find((e) => e.type === 'denied')).toMatchObject({ reason: '강제 push는 막힘' })
    expect(entries.find((e) => e.type === 'mcp')).toMatchObject({
      status: 200,
      result: { status: 'approved' },
    })
  })

  test('--mcp-config는 값을 여럿 먹는다: 바로 뒤의 프롬프트는 없어진다. --resume은 resume 단계를 한다', async () => {
    const log = join(tmp, 'resume.jsonl')
    const scenario = join(tmp, 'resume.json')
    await writeFile(
      scenario,
      JSON.stringify({ start: [], resume: [{ do: 'print', text: 'RESUMED {sessionId}' }] }),
    )
    const s = startPty({
      bin: FAKE_CLAUDE,
      args: ['--resume', 'sid-2', '--mcp-config', join(tmp, 'mcp.json'), '프롬프트'],
      cwd: tmp,
      env: { FAKE_CLAUDE_SCENARIO: scenario, FAKE_CLAUDE_LOG: log },
      cols: 100,
      rows: 30,
    })
    const c = collect(s)
    await c.until(() => c.out().includes('RESUMED sid-2'), 'resume 단계')
    await s.killTree()
    const start = JSON.parse((await readFile(log, 'utf8')).split('\n')[0] ?? '{}') as Record<
      string,
      unknown
    >
    expect(start).toMatchObject({ resume: true, sessionId: 'sid-2', prompt: null })
  })
})

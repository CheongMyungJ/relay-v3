// [어댑터] 훅·control HTTP 서버 (src/main/hooks.ts): 실제 127.0.0.1 포트에 HTTP로 보낸다.
// 토큰(훅과 control 모두 Work마다), 본문 상한(8MB), PreToolUse(셸 명령)의 바닥 막기, 끊긴 control 호출을 본다.
import { afterEach, describe, expect, test } from 'vitest'
import type { HookEvent } from '../../src/core/instructions.ts'
import {
  guardReply,
  HookServer,
  toolCommand,
  type HookServerOptions,
} from '../../src/main/hooks.ts'

let server: HookServer | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
})

interface Seen {
  hooks: { workId: string; event: HookEvent; body: Record<string, unknown> }[]
  controls: { workId: string; tool: string; args: Record<string, unknown> }[]
  logs: string[]
}

async function start(over: Partial<HookServerOptions> = {}): Promise<{ port: number; seen: Seen }> {
  const seen: Seen = { hooks: [], controls: [], logs: [] }
  const tokens: Record<string, string> = { w1: 'tok-1', w2: 'tok-2' }
  const controls: Record<string, string> = { w1: 'ctl', w2: 'ctl', w3: 'ctl-3' }
  server = new HookServer({
    controlTokenFor: (id) => controls[id] ?? null,
    tokenFor: (id) => tokens[id] ?? null,
    protectedBranches: (id) => (id === 'w1' ? ['develop'] : []),
    onHook: async (workId, event, body) => {
      seen.hooks.push({ workId, event, body })
      return null
    },
    onControl: async (workId, tool, args) => {
      seen.controls.push({ workId, tool, args })
      return { status: 'ok', tool }
    },
    log: (message) => void seen.logs.push(message),
    ...over,
  })
  return { port: await server.listen(), seen }
}

async function post(
  port: number,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; text: string }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  return { status: res.status, text: await res.text() }
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })
const bash = (command: string) => ({
  session_id: 's',
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command, description: 'x' },
})

describe('훅', () => {
  test('127.0.0.1 임의 포트에 뜨고, Work의 토큰이 맞는 요청만 처리에 넘긴다', async () => {
    const { port, seen } = await start()
    expect(port).toBeGreaterThan(0)
    expect(server?.port).toBe(port)
    const ok = await post(port, '/hook/w1/UserPromptSubmit', { prompt: '안녕' }, auth('tok-1'))
    expect(ok).toEqual({ status: 200, text: '' })
    expect(seen.hooks).toEqual([
      { workId: 'w1', event: 'UserPromptSubmit', body: { prompt: '안녕' } },
    ])

    // 토큰이 없거나, 틀리거나, 다른 Work의 것이거나, 모르는 Work면 401
    expect((await post(port, '/hook/w1/Stop', {})).status).toBe(401)
    expect((await post(port, '/hook/w1/Stop', {}, auth('tok-x'))).status).toBe(401)
    expect((await post(port, '/hook/w1/Stop', {}, auth('tok-2'))).status).toBe(401)
    expect((await post(port, '/hook/nope/Stop', {}, auth('tok-1'))).status).toBe(401)
    // 모르는 이벤트와 경로, POST가 아닌 요청은 404. 깨진 JSON과 객체가 아닌 본문은 400
    expect((await post(port, '/hook/w1/Other', {}, auth('tok-1'))).status).toBe(404)
    expect((await post(port, '/other', {}, auth('tok-1'))).status).toBe(404)
    expect((await fetch(`http://127.0.0.1:${port}/hook/w1/Stop`)).status).toBe(404)
    expect((await post(port, '/hook/w1/Stop', '{', auth('tok-1'))).status).toBe(400)
    expect((await post(port, '/hook/w1/Stop', '[1]', auth('tok-1'))).status).toBe(400)
    expect(seen.hooks).toHaveLength(1)
  })

  test('처리의 답을 JSON 본문으로 돌려주고, 처리가 던지면 빈 본문(결정 없음)으로 CLI를 막지 않는다', async () => {
    const { port, seen } = await start({
      onHook: async (_w, event) => {
        if (event === 'Stop') throw new Error('처리 실패')
        return { decision: 'block', reason: '형식 오류' }
      },
    })
    const r = await post(port, '/hook/w1/UserPromptSubmit', {}, auth('tok-1'))
    expect(r.status).toBe(200)
    expect(JSON.parse(r.text)).toEqual({ decision: 'block', reason: '형식 오류' })
    expect(await post(port, '/hook/w1/Stop', {}, auth('tok-1'))).toEqual({ status: 200, text: '' })
    expect(seen.logs).toEqual(['훅 처리 실패 (w1 Stop)'])
  })

  test('PreToolUse(Bash)의 막을 명령은 처리와 상관없이 deny로 답한다: 기준 브랜치와 main·master', async () => {
    const { port, seen } = await start({
      onHook: async () => {
        throw new Error('처리 실패')
      },
    })
    const denied = async (workId: string, token: string, command: string) => {
      const r = await post(port, `/hook/${workId}/PreToolUse`, bash(command), auth(token))
      expect(r.status).toBe(200)
      return r.text ? (JSON.parse(r.text) as { hookSpecificOutput: Record<string, string> }) : null
    }
    const force = await denied('w1', 'tok-1', 'git push --force origin relay/x')
    expect(force?.hookSpecificOutput).toMatchObject({
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
    })
    expect(force?.hookSpecificOutput.permissionDecisionReason).toMatch(/강제 push/)
    // w1의 기준 브랜치는 develop. w2는 기준 브랜치가 없어도 main·master는 지킨다
    expect(await denied('w1', 'tok-1', 'git push origin HEAD:develop')).not.toBeNull()
    expect(await denied('w2', 'tok-2', 'git push origin HEAD:develop')).toBeNull()
    expect(await denied('w2', 'tok-2', 'git push origin main')).not.toBeNull()
    expect(await denied('w2', 'tok-2', 'gh pr merge 3 --squash')).not.toBeNull()
    // 작업 브랜치 push와 PR 열기는 된다
    expect(await denied('w1', 'tok-1', 'git push -u origin relay/fix-ab12')).toBeNull()
    expect(await denied('w1', 'tok-1', 'gh pr create --title t --body b')).toBeNull()
    expect(seen.logs).toHaveLength(7)
  })

  test('guardReply는 PreToolUse에서 명령(tool_input.command)이 있는 도구를 모두 본다: Bash, PowerShell', () => {
    const cmd = 'git push --force origin main'
    expect(guardReply('PreToolUse', bash(cmd), [])).not.toBeNull()
    expect(guardReply('PostToolUse', bash(cmd), [])).toBeNull()
    const powershell = {
      tool_name: 'PowerShell',
      tool_input: { command: 'git push origin HEAD:main' },
    }
    expect(guardReply('PreToolUse', powershell, [])).toMatchObject({
      hookSpecificOutput: { permissionDecision: 'deny' },
    })
    expect(
      guardReply('PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'x' } }, []),
    ).toBeNull()
    expect(guardReply('PreToolUse', { tool_name: 'Bash' }, [])).toBeNull()
    expect(toolCommand({ tool_name: 'PowerShell', tool_input: { command: 'ls' } })).toBe('ls')
    expect(toolCommand({ tool_name: 'Bash', tool_input: { command: 3 } })).toBeNull()
  })

  test('본문 상한(기본 8MB)을 넘으면 413이고 처리에 넘기지 않는다', async () => {
    const { port, seen } = await start()
    const big = JSON.stringify({ prompt: 'x'.repeat(8 * 1024 * 1024) })
    expect((await post(port, '/hook/w1/UserPromptSubmit', big, auth('tok-1'))).status).toBe(413)
    const near = JSON.stringify({ prompt: 'x'.repeat(8 * 1024 * 1024 - 100) })
    expect((await post(port, '/hook/w1/UserPromptSubmit', near, auth('tok-1'))).status).toBe(200)
    expect(seen.hooks).toHaveLength(1)
    // control도 같은 상한
    const r = await post(port, '/control', big, { ...auth('ctl'), 'X-Relay-Work': 'w1' })
    expect(r.status).toBe(413)
    expect(seen.controls).toHaveLength(0)
  })
})

describe('control', () => {
  test('X-Relay-Work의 Work와 그 Work의 control 토큰이 맞는 { tool, args }만 처리에 넘기고 답을 JSON으로 돌려준다', async () => {
    const { port, seen } = await start()
    const headers = { ...auth('ctl'), 'X-Relay-Work': 'w1' }
    const ok = await post(port, '/control', { tool: 'relay_check', args: { a: 1 } }, headers)
    expect(ok.status).toBe(200)
    expect(JSON.parse(ok.text)).toEqual({ status: 'ok', tool: 'relay_check' })
    expect(seen.controls).toEqual([{ workId: 'w1', tool: 'relay_check', args: { a: 1 } }])

    // Work의 훅 토큰으로는 못 부른다
    expect(
      (await post(port, '/control', { tool: 'x' }, { ...auth('tok-1'), 'X-Relay-Work': 'w1' }))
        .status,
    ).toBe(401)
    expect((await post(port, '/control', { tool: 'x' }, { 'X-Relay-Work': 'w1' })).status).toBe(401)
    // 한 Work의 토큰으로 다른 Work(w3)의 이름을 대지 못한다. 모르는 Work도 401
    expect(
      (await post(port, '/control', { tool: 'x' }, { ...auth('ctl'), 'X-Relay-Work': 'w3' }))
        .status,
    ).toBe(401)
    expect(
      (await post(port, '/control', { tool: 'x' }, { ...auth('ctl'), 'X-Relay-Work': 'w9' }))
        .status,
    ).toBe(401)
    expect((await post(port, '/control', { tool: 'x' }, auth('ctl'))).status).toBe(400)
    expect((await post(port, '/control', { args: {} }, headers)).status).toBe(400)
    // args가 객체가 아니면 빈 객체
    await post(port, '/control', { tool: 'y', args: [1] }, headers)
    expect(seen.controls.at(-1)).toEqual({ workId: 'w1', tool: 'y', args: {} })
  })

  test('처리가 던지면 500과 { error }', async () => {
    const { port } = await start({
      onControl: async () => {
        throw new Error('터짐')
      },
    })
    const r = await post(port, '/control', { tool: 'x' }, { ...auth('ctl'), 'X-Relay-Work': 'w1' })
    expect(r).toEqual({ status: 500, text: JSON.stringify({ error: '터짐' }) })
  })

  test('부른 쪽이 끊거나 서버를 닫으면 기다리는 처리의 signal이 끊긴다', async () => {
    const aborted: string[] = []
    const { port } = await start({
      onControl: (workId, _tool, _args, signal) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => {
            aborted.push(workId)
            resolve(null)
          })
        }),
    })
    const call = (workId: string, signal?: AbortSignal) =>
      fetch(`http://127.0.0.1:${port}/control`, {
        method: 'POST',
        headers: { ...auth('ctl'), 'X-Relay-Work': workId },
        body: JSON.stringify({ tool: 'submit_contract' }),
        ...(signal ? { signal } : {}),
      }).catch(() => null)
    const controller = new AbortController()
    const first = call('w1', controller.signal)
    await waitFor(() => aborted.length === 0 && controller !== null, 100)
    controller.abort()
    await first
    await waitFor(() => aborted.includes('w1'))
    const second = call('w2')
    await new Promise((r) => setTimeout(r, 100))
    await server?.close()
    await second
    await waitFor(() => aborted.includes('w2'))
    expect(aborted.sort()).toEqual(['w1', 'w2'])
  })
})

async function waitFor(ok: () => boolean, minMs = 0): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < 5_000) {
    if (Date.now() - started >= minMs && ok()) return
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error('기다리던 일이 일어나지 않음')
}

// [어댑터] relay MCP 브리지 (src/main/mcp-bridge.ts)를 실제 프로세스(node, 타입 지우기)로 띄워 stdio JSON-RPC로 부른다:
// initialize → tools/list → tools/call이 훅 서버의 /control(처리는 가짜)에 닿는다. 기다리는 도구와 취소도 본다.
import { spawn, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { afterEach, describe, expect, test } from 'vitest'
import { HookServer } from '../../src/main/hooks.ts'

const BRIDGE = resolve(import.meta.dirname, '../../src/main/mcp-bridge.ts')

let server: HookServer | undefined
let bridge: ChildProcess | undefined

afterEach(async () => {
  bridge?.kill()
  bridge = undefined
  await server?.close()
  server = undefined
})

type Msg = Record<string, unknown>
type Control = (
  tool: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
) => Promise<unknown>

interface Call {
  workId: string
  tool: string
  args: Record<string, unknown>
}

async function control(handler: Control): Promise<{ url: string; calls: Call[] }> {
  const calls: Call[] = []
  server = new HookServer({
    controlTokenFor: () => 'ctl-token',
    tokenFor: () => null,
    protectedBranches: () => [],
    onHook: async () => null,
    onControl: async (workId, tool, args, signal) => {
      calls.push({ workId, tool, args })
      return handler(tool, args, signal)
    },
  })
  const port = await server.listen()
  return { url: `http://127.0.0.1:${port}/control`, calls }
}

/** 브리지를 띄우고 JSON-RPC 요청을 보내는 함수. 답이 없는 알림은 send로 */
function start(env: Record<string, string>) {
  const child = spawn(process.execPath, [BRIDGE], {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  bridge = child
  let stderr = ''
  child.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
  const replies = new Map<unknown, (m: Msg) => void>()
  const loose: Msg[] = []
  createInterface({ input: child.stdout }).on('line', (line) => {
    const m = JSON.parse(line) as Msg
    const done = replies.get(m.id)
    if (done) done(m)
    else loose.push(m)
  })
  let next = 0
  const send = (m: Msg) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`)
  const request = (method: string, params: unknown = {}, id: number = ++next) => {
    const p = new Promise<Msg>((resolveReply, reject) => {
      const t = setTimeout(() => reject(new Error(`답 없음: ${method}\n${stderr}`)), 15_000)
      replies.set(id, (m) => {
        clearTimeout(t)
        resolveReply(m)
      })
    })
    send({ id, method, params })
    return p
  }
  return { child, send, request, loose, raw: (line: string) => child.stdin.write(`${line}\n`) }
}

const result = (m: Msg) =>
  m.result as { content: { type: string; text: string }[]; isError: boolean }

describe('MCP 브리지', () => {
  test('initialize → tools/list → tools/call이 control에 { tool, args }로 닿고 답을 text로 돌려준다', async () => {
    const { url, calls } = await control(async (tool) =>
      tool === 'submit_contract'
        ? { status: 'invalid', errors: ['lines: 줄이 하나 이상 있어야 함'] }
        : { status: 'ok', summary: ['명령 test: 통과'] },
    )
    const b = start({
      RELAY_CONTROL_URL: url,
      RELAY_CONTROL_TOKEN: 'ctl-token',
      RELAY_WORK_ID: 'work-1',
    })

    const init = await b.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    })
    expect(init.result).toEqual({
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'relay_work', version: expect.any(String) },
    })
    // 알림에는 답하지 않는다
    b.send({ method: 'notifications/initialized' })
    expect((await b.request('ping')).result).toEqual({})

    const list = await b.request('tools/list')
    const tools = (list.result as { tools: { name: string; inputSchema: Msg }[] }).tools
    expect(tools.map((t) => t.name)).toEqual([
      'submit_contract',
      'request_contract_change',
      'relay_check',
    ])
    expect(tools[0]?.inputSchema).toMatchObject({
      type: 'object',
      required: expect.arrayContaining(['version', 'id', 'goal', 'lines']),
    })
    expect(tools[1]?.inputSchema).toMatchObject({ required: ['reason', 'contract'] })

    const contract = { version: 1, id: 'c', goal: 'g', lines: [] }
    const invalid = result(
      await b.request('tools/call', { name: 'submit_contract', arguments: contract }),
    )
    expect(invalid.isError).toBe(true)
    expect(JSON.parse(invalid.content[0]?.text ?? '')).toEqual({
      status: 'invalid',
      errors: ['lines: 줄이 하나 이상 있어야 함'],
    })
    const ok = result(await b.request('tools/call', { name: 'relay_check' }))
    expect(ok).toEqual({
      content: [
        { type: 'text', text: JSON.stringify({ status: 'ok', summary: ['명령 test: 통과'] }) },
      ],
      isError: false,
    })
    expect(calls).toEqual([
      { workId: 'work-1', tool: 'submit_contract', args: contract },
      { workId: 'work-1', tool: 'relay_check', args: {} },
    ])
    expect(b.loose).toEqual([])
  })

  test('사람의 답을 기다리는 도구는 control이 답할 때까지 열려 있고, 취소하면 control의 signal이 끊긴다', async () => {
    let answer: ((v: unknown) => void) | undefined
    let aborted = false
    const { url } = await control(
      (tool, _args, signal) =>
        new Promise((resolveAnswer) => {
          if (tool === 'submit_contract') answer = resolveAnswer
          signal.addEventListener('abort', () => {
            aborted = true
            resolveAnswer(null)
          })
        }),
    )
    const b = start({
      RELAY_CONTROL_URL: url,
      RELAY_CONTROL_TOKEN: 'ctl-token',
      RELAY_WORK_ID: 'w',
    })
    await b.request('initialize', {})
    const waiting = b.request('tools/call', { name: 'submit_contract', arguments: {} }, 10)
    await until(() => answer !== undefined)
    await new Promise((r) => setTimeout(r, 300))
    answer?.({ status: 'approved', contract: { id: 'c' } })
    const r = result(await waiting)
    expect(r.isError).toBe(false)
    expect(JSON.parse(r.content[0]?.text ?? '')).toEqual({
      status: 'approved',
      contract: { id: 'c' },
    })

    // 클라이언트가 취소하면 HTTP를 끊는다
    const cancelled = b.request(
      'tools/call',
      { name: 'request_contract_change', arguments: {} },
      11,
    )
    await new Promise((r) => setTimeout(r, 200))
    b.send({ method: 'notifications/cancelled', params: { requestId: 11 } })
    await until(() => aborted)
    expect(result(await cancelled).isError).toBe(true)
  })

  test('틀린 토큰, 닿지 않는 앱, 모르는 도구는 isError인 도구 결과. 모르는 메서드와 깨진 줄은 JSON-RPC 오류', async () => {
    const { url, calls } = await control(async () => ({ status: 'ok' }))
    const b = start({ RELAY_CONTROL_URL: url, RELAY_CONTROL_TOKEN: 'wrong', RELAY_WORK_ID: 'w' })
    const denied = result(await b.request('tools/call', { name: 'relay_check' }))
    expect(denied.isError).toBe(true)
    expect(denied.content[0]?.text).toMatch(/401/)
    const unknown = result(await b.request('tools/call', { name: 'rm_rf' }))
    expect(unknown).toMatchObject({ isError: true, content: [{ text: 'Unknown tool: rm_rf' }] })
    expect(calls).toEqual([])

    const missing = await b.request('resources/list')
    expect(missing.error).toMatchObject({ code: -32601 })
    b.raw('{not json')
    await until(() => b.loose.length > 0)
    expect(b.loose[0]).toMatchObject({ id: null, error: { code: -32700 } })

    await server?.close()
    server = undefined
    const gone = result(await b.request('tools/call', { name: 'relay_check' }))
    expect(gone.isError).toBe(true)
    expect(gone.content[0]?.text).toMatch(/not reachable/)
  })

  test('표준 입력이 닫히면 끝난다', async () => {
    const { url } = await control(async () => ({}))
    const b = start({
      RELAY_CONTROL_URL: url,
      RELAY_CONTROL_TOKEN: 'ctl-token',
      RELAY_WORK_ID: 'w',
    })
    await b.request('initialize', {})
    const exited = new Promise<number | null>((r) => b.child.once('exit', (code) => r(code)))
    b.child.stdin?.end()
    expect(await exited).toBe(0)
  })
})

async function until(ok: () => boolean): Promise<void> {
  const started = Date.now()
  while (!ok()) {
    if (Date.now() - started > 10_000) throw new Error('기다리던 일이 일어나지 않음')
    await new Promise((r) => setTimeout(r, 20))
  }
}

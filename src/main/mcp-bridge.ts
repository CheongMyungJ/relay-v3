// relay MCP 브리지 (docs/m2-modules.md 3절 mcp-bridge.ts). 세션의 claude가 --mcp-config로 띄우는 stdio MCP 서버다.
// JSON-RPC 2.0을 줄마다 하나씩 읽고 쓴다(외부 SDK 없음): initialize, ping, tools/list, tools/call.
// tools/call은 앱의 /control에 { tool, args }를 POST하고 답을 그대로 도구 결과(text)로 돌려준다. 사람의 답을 기다리는
// 도구(submit_contract, request_contract_change)는 앱이 답할 때까지 HTTP가 열려 있다(시간 제한 없음).
// env: RELAY_CONTROL_URL(http://127.0.0.1:<port>/control), RELAY_CONTROL_TOKEN, RELAY_WORK_ID.
// 앱에서는 Electron을 Node로 돌린다(ELECTRON_RUN_AS_NODE=1 <앱> out/main/mcp-bridge.js). 개발·시험은 node로 바로 돈다.
// 도구 설명과 오류는 모델이 읽으므로 영어다.

import http from 'node:http'
import { createInterface } from 'node:readline'
import { MCP_SERVER, TOOL_CHANGE, TOOL_CHECK, TOOL_SUBMIT } from '../core/instructions.ts'

const VERSION = '0.0.0'
/** 응답 본문 상한 */
const MAX_RESPONSE = 32 * 1024 * 1024

const KINDS = ['change', 'new', 'keep', 'remove', 'observe', 'human']
const strings = { type: 'array', items: { type: 'string' } }

/** Contract(src/core/types.ts)의 모양. 자세한 검사는 앱의 parseContract가 한다 */
const CONTRACT_SCHEMA = {
  type: 'object',
  properties: {
    version: { type: 'integer', enum: [1] },
    id: { type: 'string', description: 'The contract id given in the instructions.' },
    goal: { type: 'string' },
    lines: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'C1, C2, …' },
          kind: { type: 'string', enum: KINDS },
          text: { type: 'string' },
          grounds: {
            type: 'array',
            items: {
              type: 'object',
              description:
                '{type:"code",path,line,name?} | {type:"request",quote} | {type:"knowledge",id} | {type:"guess"}',
              properties: {
                type: { type: 'string', enum: ['code', 'request', 'knowledge', 'guess'] },
                path: { type: 'string' },
                line: { type: 'integer' },
                name: { type: 'string' },
                quote: { type: 'string' },
                id: { type: 'string' },
              },
              required: ['type'],
            },
          },
          examples: { ...strings, description: 'Example ids of this line: C1.1, C1.2, …' },
          check: { type: 'string', enum: ['test', 'observe', 'human'] },
        },
        required: ['id', 'kind', 'text', 'grounds', 'examples', 'check'],
      },
    },
    examples: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          input: {},
          output: {},
          error: {},
          note: { type: 'string' },
        },
        required: ['id', 'input'],
      },
    },
    non_goals: strings,
    human_rules: strings,
    hint: { type: 'string' },
    tidy: { ...strings, description: 'Debt item ids taken on as a tidy-up.' },
  },
  required: ['version', 'id', 'goal', 'lines', 'examples', 'non_goals', 'human_rules', 'tidy'],
}

const TOOLS = [
  {
    name: TOOL_SUBMIT,
    description:
      'Submit the contract for this Work. Errors come back at once (status "invalid"): fix them and call again. A valid contract waits until the human answers: status "approved" with the approved contract, or "changes" with the human\'s message.',
    inputSchema: CONTRACT_SCHEMA,
  },
  {
    name: TOOL_CHANGE,
    description:
      'Ask the human to change the approved contract. Give the reason and the whole revised contract (checked like submit_contract; errors come back at once as status "invalid"). If the human approves, the revised contract replaces the approved one. Waits until the human answers: status "approved" or "rejected", with the contract now in force and a message.',
    inputSchema: {
      type: 'object',
      properties: {
        reason: { type: 'string' },
        contract: {
          ...CONTRACT_SCHEMA,
          description: 'The whole revised contract, same id. Not a diff.',
        },
      },
      required: ['reason', 'contract'],
    },
  },
  {
    name: TOOL_CHECK,
    description:
      'Get the evidence relay measured for the current head (commits only, not uncommitted changes): commands, contract lines, ratchets, signals and missing evidence. Measures again if the head changed, which can take minutes.',
    inputSchema: { type: 'object', properties: {} },
  },
]

// ── control로 보내기 ─────────────────────────────────────────────────────────

interface Reply {
  status: number
  text: string
}

function post(body: unknown, signal: AbortSignal): Promise<Reply> {
  const url = process.env.RELAY_CONTROL_URL ?? ''
  const data = JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          Authorization: `Bearer ${process.env.RELAY_CONTROL_TOKEN ?? ''}`,
          'X-Relay-Work': process.env.RELAY_WORK_ID ?? '',
        },
        signal,
      },
      (res) => {
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (c: Buffer) => {
          size += c.length
          if (size > MAX_RESPONSE) req.destroy(new Error('relay response is too large'))
          else chunks.push(c)
        })
        res.on('error', reject)
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }),
        )
      },
    )
    req.on('error', reject)
    req.end(data)
  })
}

/** 앱의 답이 실패를 뜻하나: invalid·error 상태나 ok false */
function failed(text: string): boolean {
  try {
    const v: unknown = JSON.parse(text)
    if (typeof v !== 'object' || v === null) return false
    const r = v as Record<string, unknown>
    return r.ok === false || r.status === 'invalid' || r.status === 'error'
  } catch {
    return false
  }
}

const textResult = (text: string, isError: boolean) => ({
  content: [{ type: 'text', text }],
  isError,
})

async function callTool(name: unknown, args: unknown, signal: AbortSignal) {
  if (typeof name !== 'string' || !TOOLS.some((t) => t.name === name))
    return textResult(`Unknown tool: ${String(name)}`, true)
  if (!process.env.RELAY_CONTROL_URL) return textResult('RELAY_CONTROL_URL is not set', true)
  try {
    const r = await post({ tool: name, args: args ?? {} }, signal)
    if (r.status !== 200) {
      return textResult(`relay control answered ${r.status}: ${r.text || '(empty)'}`, true)
    }
    return textResult(r.text, failed(r.text))
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e)
    return textResult(`relay is not reachable (${why}). If relay restarted, call again.`, true)
  }
}

// ── JSON-RPC ─────────────────────────────────────────────────────────────────

type Message = { jsonrpc?: string; id?: string | number | null; method?: string; params?: unknown }

function send(m: object): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`)
}

const calls = new Map<string | number, AbortController>()

function params(m: Message): Record<string, unknown> {
  return typeof m.params === 'object' && m.params !== null
    ? (m.params as Record<string, unknown>)
    : {}
}

async function handle(m: Message): Promise<void> {
  const p = params(m)
  if (m.method === 'notifications/cancelled') {
    const id = p.requestId
    if (typeof id === 'string' || typeof id === 'number') calls.get(id)?.abort()
    return
  }
  // 알림(id 없음)에는 답하지 않는다
  if (m.id === undefined || m.id === null) return
  const id = m.id
  switch (m.method) {
    case 'initialize':
      return send({
        id,
        result: {
          protocolVersion: typeof p.protocolVersion === 'string' ? p.protocolVersion : '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: MCP_SERVER, version: VERSION },
        },
      })
    case 'ping':
      return send({ id, result: {} })
    case 'tools/list':
      return send({ id, result: { tools: TOOLS } })
    case 'tools/call': {
      const controller = new AbortController()
      calls.set(id, controller)
      try {
        return send({ id, result: await callTool(p.name, p.arguments, controller.signal) })
      } finally {
        calls.delete(id)
      }
    }
    default:
      return send({ id, error: { code: -32601, message: `Method not found: ${m.method}` } })
  }
}

function main(): void {
  const lines = createInterface({ input: process.stdin })
  lines.on('line', (line) => {
    if (!line.trim()) return
    let m: unknown
    try {
      m = JSON.parse(line)
    } catch {
      return send({ id: null, error: { code: -32700, message: 'Parse error' } })
    }
    if (typeof m !== 'object' || m === null || Array.isArray(m))
      return send({ id: null, error: { code: -32600, message: 'Invalid Request' } })
    void handle(m as Message).catch((e: unknown) => {
      const id = (m as Message).id
      if (id !== undefined && id !== null)
        send({ id, error: { code: -32603, message: e instanceof Error ? e.message : String(e) } })
    })
  })
  // 클라이언트가 끝나면 기다리는 호출을 끊고 끝낸다
  lines.on('close', () => {
    for (const c of calls.values()) c.abort()
    process.exit(0)
  })
}

main()

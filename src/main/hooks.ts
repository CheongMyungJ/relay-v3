// 훅·control HTTP 서버 (docs/m2-modules.md 3절 hooks.ts). v2 app/src/adapters/hooks.ts에서 필요한 만큼 옮겼다
// (task 대신 Work, 질문·자식 경로는 뺌). 127.0.0.1의 임의 포트 하나에:
//   POST /hook/<workId>/<Event>   Claude Code의 http 훅. Work마다 토큰(Authorization: Bearer)
//   POST /control                 relay MCP 브리지의 도구 호출 { tool, args }. X-Relay-Work의 Work id와 그 Work의 control 토큰
//                                 (세션을 띄울 때마다 새로)이 맞아야 한다: 한 Work의 세션이 다른 Work의 이름으로 부르지 못하게
// 토큰이 틀리면 401, 본문이 8MB를 넘으면 413. 훅 응답은 명령 훅과 같은 JSON 출력이고 비면 결정 없음이다(Claude Code 문서
// hooks). 처리가 실패해도 CLI를 막지 않는다(빈 본문). 다만 PreToolUse(셸 명령)의 바닥 막기(git-guard)는 처리보다 먼저 돈다.

import { timingSafeEqual } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { guardCommand } from '../core/git-guard.ts'
import { HOOK_EVENTS, type HookEvent } from '../core/instructions.ts'

/** 훅 응답 본문. null이면 빈 본문(결정 없음) */
export type HookReply = Record<string, unknown> | null

export interface HookServerOptions {
  /** Work의 control 토큰(세션을 띄울 때마다 새로). 모르는 Work면 null */
  controlTokenFor: (workId: string) => string | null
  /** Work의 훅 토큰. 모르는 Work면 null */
  tokenFor: (workId: string) => string | null
  /** 바닥 막기에 쓰는 이 Work의 지킬 브랜치(기준 브랜치. main·master는 guardCommand가 늘 더한다) */
  protectedBranches: (workId: string) => string[]
  onHook: (workId: string, event: HookEvent, body: Record<string, unknown>) => Promise<HookReply>
  /**
   * 본문을 onHook에 넘기기 전에 보고 기다린다(M4a: 세션 기록 works-session-log.ts. M4e: 셸 도구 앞뒤의 Work 브랜치 끝을 도구가
   * 돌기 전에 읽는다). denied는 바닥 막기가 거절한 PreToolUse. 던져도 훅 처리는 이어 간다
   */
  noteHook?: (
    workId: string,
    event: HookEvent,
    body: Record<string, unknown>,
    denied: boolean,
  ) => void | Promise<void>
  /** 돌려준 값을 JSON으로 답한다. 던지면 500과 { error } */
  onControl: (
    workId: string,
    tool: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ) => Promise<unknown>
  /** 본문 상한(바이트). 기본 8MB */
  maxBody?: number
  /** 처리 실패를 알린다. 기본 console.error */
  log?: (message: string, error: unknown) => void
}

const MAX_BODY = 8 * 1024 * 1024
const HOOK_PATH = /^\/hook\/([^/?#]+)\/([^/?#]+)$/
const CONTROL_PATH = '/control'

class BodyTooLarge extends Error {}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function isHookEvent(s: string): s is HookEvent {
  return (HOOK_EVENTS as readonly string[]).includes(s)
}

/** 같은 글인가(시간으로 토큰을 알아내지 못하게) */
function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y)
}

function bearer(req: http.IncomingMessage): string {
  return /^Bearer\s+(\S+)$/.exec(req.headers.authorization ?? '')?.[1] ?? ''
}

/**
 * 도구 호출의 셸 명령: tool_input.command가 글인 도구(Bash, Windows의 PowerShell 등). 아니면 null.
 * 셸 도구의 이름 목록을 두지 않는다: 이름을 모르는 셸 도구도 바닥 막기를 지나가지 못하게
 */
export function toolCommand(body: Record<string, unknown>): string | null {
  const input = isObject(body.tool_input) ? body.tool_input : null
  return typeof input?.command === 'string' ? input.command : null
}

/**
 * PreToolUse의 셸 명령(toolCommand)이 바닥 막기에 걸리면 거절 응답, 아니면 null. 세션은 permissionDecisionReason을
 * 읽는다(Claude Code 문서 hooks의 PreToolUse 결정)
 */
export function guardReply(
  event: string,
  body: Record<string, unknown>,
  protectedBranches: string[],
): HookReply {
  const command = event === 'PreToolUse' ? toolCommand(body) : null
  if (command === null) return null
  const g = guardCommand(command, protectedBranches)
  if (!g.blocked) return null
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: g.reason,
    },
  }
}

export class HookServer {
  private server: http.Server | null = null
  private readonly pending = new Set<AbortController>()
  private readonly o: HookServerOptions
  port = 0

  constructor(o: HookServerOptions) {
    this.o = o
  }

  /** 127.0.0.1의 임의 포트에 띄우고 포트를 돌려준다 */
  async listen(): Promise<number> {
    const server = http.createServer((req, res) => void this.handle(req, res))
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    this.server = server
    this.port = (server.address() as AddressInfo).port
    return this.port
  }

  /** 서버를 닫는다. 기다리는 호출(사람의 답을 기다리는 도구)은 끊긴다 */
  async close(): Promise<void> {
    const server = this.server
    this.server = null
    for (const c of this.pending) c.abort()
    if (!server) return
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private log(message: string, e: unknown): void {
    if (this.o.log) this.o.log(message, e)
    else console.error(message, e)
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.method !== 'POST') return end(res, 404)
    if (req.url === CONTROL_PATH) return this.handleControl(req, res)
    const m = HOOK_PATH.exec(req.url ?? '')
    if (!m) return end(res, 404)
    let workId: string
    try {
      workId = decodeURIComponent(m[1] ?? '')
    } catch {
      return end(res, 400)
    }
    const event = m[2] ?? ''
    const token = this.o.tokenFor(workId)
    if (token === null || !sameToken(bearer(req), token)) return end(res, 401)
    if (!isHookEvent(event)) return end(res, 404)
    const body = await this.body(req, res)
    if (body === null) return

    // 바닥 막기는 처리와 상관없이 먼저 정한다(처리가 실패해도 막는다)
    let reply: HookReply = null
    try {
      reply = guardReply(event, body, this.o.protectedBranches(workId))
    } catch (e) {
      this.log(`바닥 막기 실패 (${workId})`, e)
    }
    try {
      await this.o.noteHook?.(workId, event, body, reply !== null)
    } catch (e) {
      this.log(`세션 기록 실패 (${workId} ${event})`, e)
    }
    try {
      const handled = await this.o.onHook(workId, event, body)
      reply ??= handled
    } catch (e) {
      this.log(`훅 처리 실패 (${workId} ${event})`, e)
    }
    if (res.destroyed) return
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(reply ? JSON.stringify(reply) : '')
  }

  private async handleControl(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const header = req.headers['x-relay-work']
    const workId = typeof header === 'string' ? header.trim() : ''
    if (!workId) return end(res, 400)
    const token = this.o.controlTokenFor(workId)
    if (token === null || !sameToken(bearer(req), token)) return end(res, 401)
    const body = await this.body(req, res)
    if (body === null) return
    const tool = body.tool
    if (typeof tool !== 'string' || !tool) return json(res, 400, { error: 'tool이 없음' })
    const args = isObject(body.args) ? body.args : {}

    const controller = new AbortController()
    this.pending.add(controller)
    // 응답을 쓰기 전에 연결이 닫히면(브리지가 끝남, 세션이 죽음) 기다림을 그만둔다
    const closed = () => controller.abort()
    res.once('close', closed)
    let status = 200
    let out: unknown
    try {
      out = await this.o.onControl(workId, tool, args, controller.signal)
    } catch (e) {
      status = 500
      out = { error: e instanceof Error ? e.message : String(e) }
    } finally {
      res.removeListener('close', closed)
      this.pending.delete(controller)
    }
    if (res.destroyed) return
    json(res, status, out ?? null)
  }

  /** JSON 본문. 실패하면 답을 쓰고 null(상한을 넘으면 413, 깨졌으면 400) */
  private async body(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<Record<string, unknown> | null> {
    try {
      return await readJsonBody(req, this.o.maxBody ?? MAX_BODY)
    } catch (e) {
      if (e instanceof BodyTooLarge) {
        // 본문을 다 받기 전에 답하고 닫으면 남은 바이트 때문에 RST가 나가고, Windows의 클라이언트는 413을 읽기 전에
        // ECONNRESET을 받는다. 남은 본문을 버리며 다 받은 뒤(길어도 DRAIN_MS) 답하고 닫는다
        await drained(req)
        res.writeHead(413, { Connection: 'close' })
        res.end()
      } else end(res, 400)
      return null
    }
  }
}

/** 상한을 넘은 본문을 버리며 기다리는 시간. 넘으면 그대로 닫는다 */
const DRAIN_MS = 2_000

/** 요청 본문을 버리며 끝까지 받는다(끝났거나, 끊겼거나, DRAIN_MS가 지나면 돌아온다) */
function drained(req: http.IncomingMessage): Promise<void> {
  if (req.readableEnded || req.destroyed) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(done, DRAIN_MS)
    for (const event of ['end', 'close', 'error']) req.once(event, done)
    req.resume()
  })
}

function end(res: http.ServerResponse, status: number): void {
  res.writeHead(status)
  res.end()
}

function json(res: http.ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(value))
}

function readJsonBody(req: http.IncomingMessage, max: number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0)
    if (declared > max) {
      req.resume()
      return reject(new BodyTooLarge())
    }
    const chunks: Buffer[] = []
    let size = 0
    let over = false
    req.on('data', (c: Buffer) => {
      if (over) return
      size += c.length
      if (size > max) {
        over = true
        reject(new BodyTooLarge())
      } else chunks.push(c)
    })
    req.on('error', reject)
    req.on('end', () => {
      if (over) return
      const text = Buffer.concat(chunks).toString('utf8')
      try {
        const data: unknown = text.trim() ? JSON.parse(text) : {}
        if (isObject(data)) resolve(data)
        else reject(new Error('본문이 객체가 아님'))
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
  })
}

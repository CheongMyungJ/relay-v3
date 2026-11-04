// 세션 호스트 (docs/m2-modules.md 3절 sessions.ts). Work마다 PTY 하나에 claude를 띄운다.
// 렌더러의 터미널은 나중에 붙으므로 최근 출력(기본 200KB)을 남겨 붙을 때 넘긴다. 조각마다 seq를 붙여 겹치거나 빠지지 않게
// 한다(v2 main/terminals.ts의 뜻). 세션이 끝나도 출력은 남고, 다시 열면 이어 붙는다.

import { startPty, type PtyOptions, type PtySession } from '../adapters/pty.ts'
import type { TerminalBacklog } from '../shared/api.ts'

export interface SessionStart {
  bin: string
  args: string[]
  cwd: string
  /** process.env에 덧붙일 환경 변수 */
  env: Record<string, string>
  cols?: number
  rows?: number
}

/** 다시 붙을 때 보낼 최근 출력의 상한(글자 수) */
const BUFFER_CHARS = 200 * 1024
const DEFAULT_COLS = 120
const DEFAULT_ROWS = 32

interface Slot {
  pty: PtySession | null
  chunks: string[]
  size: number
  seq: number
  cols: number
  rows: number
  data: Set<(data: string, seq: number) => void>
  exit: Set<(code: number) => void>
}

export class SessionHost {
  private readonly slots = new Map<string, Slot>()
  private readonly spawn: (o: PtyOptions) => PtySession
  private readonly bufferChars: number

  constructor(o: { spawn?: (o: PtyOptions) => PtySession; bufferChars?: number } = {}) {
    this.spawn = o.spawn ?? startPty
    this.bufferChars = o.bufferChars ?? BUFFER_CHARS
  }

  private slot(workId: string): Slot {
    let s = this.slots.get(workId)
    if (!s) {
      s = {
        pty: null,
        chunks: [],
        size: 0,
        seq: 0,
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
        data: new Set(),
        exit: new Set(),
      }
      this.slots.set(workId, s)
    }
    return s
  }

  /** 세션을 띄운다. 이미 돌고 있으면 던진다 */
  start(workId: string, o: SessionStart): void {
    const s = this.slot(workId)
    if (s.pty) throw new Error('세션이 이미 돌고 있음')
    if (o.cols) s.cols = o.cols
    if (o.rows) s.rows = o.rows
    const pty = this.spawn({
      bin: o.bin,
      args: o.args,
      cwd: o.cwd,
      env: o.env,
      cols: s.cols,
      rows: s.rows,
      answerQueries: process.platform === 'win32',
    })
    s.pty = pty
    pty.onData((data) => this.push(s, data))
    pty.onExit((code) => {
      if (s.pty === pty) s.pty = null
      for (const cb of [...s.exit]) cb(code)
    })
  }

  private push(s: Slot, data: string): void {
    const seq = s.seq++
    s.chunks.push(data)
    s.size += data.length
    while (s.size > this.bufferChars && s.chunks.length > 1) s.size -= s.chunks.shift()?.length ?? 0
    if (s.size > this.bufferChars && s.chunks.length === 1) {
      const only = (s.chunks[0] ?? '').slice(-this.bufferChars)
      s.chunks[0] = only
      s.size = only.length
    }
    for (const cb of [...s.data]) cb(data, seq)
  }

  isRunning(workId: string): boolean {
    return this.slots.get(workId)?.pty != null
  }

  write(workId: string, data: string): void {
    this.slots.get(workId)?.pty?.write(data)
  }

  resize(workId: string, cols: number, rows: number): void {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2) return
    const s = this.slot(workId)
    s.cols = cols
    s.rows = rows
    s.pty?.resize(cols, rows)
  }

  /** 세션을 프로세스 트리째 끝내고 끝날 때까지 기다린다. 돌고 있지 않으면 바로 돌아온다 */
  async kill(workId: string, graceMs?: number): Promise<void> {
    const pty = this.slots.get(workId)?.pty
    if (pty) await pty.killTree(graceMs)
  }

  async killAll(graceMs?: number): Promise<void> {
    await Promise.all([...this.slots.keys()].map((id) => this.kill(id, graceMs)))
  }

  /** 출력 조각을 받는다(세션을 다시 열어도 이어서). 돌려준 함수로 그만 받는다 */
  onData(workId: string, cb: (data: string, seq: number) => void): () => void {
    const s = this.slot(workId)
    s.data.add(cb)
    return () => void s.data.delete(cb)
  }

  /** 세션이 끝날 때마다 */
  onExit(workId: string, cb: (code: number) => void): () => void {
    const s = this.slot(workId)
    s.exit.add(cb)
    return () => void s.exit.delete(cb)
  }

  /** 최근 출력과 그다음 조각의 번호 */
  backlog(workId: string): TerminalBacklog {
    const s = this.slots.get(workId)
    if (!s) return { data: '', seq: 0, live: false }
    return { data: s.chunks.join(''), seq: s.seq, live: s.pty !== null }
  }
}

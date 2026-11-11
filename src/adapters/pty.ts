// PTY 세션과 셸 없는 실행 (docs/m2-modules.md 2절).
// v2 app/src/adapters/pty.ts의 startPty(DA1 답, 트리 종료)와 exec.ts의 spawnSpec을 옮겼다.
// runFile: gh와 claude -p를 셸 없이 인자 배열로 돌린다. exec.run은 셸 문자열만 받으므로 따로 둔다.

import { execFile, spawn } from 'node:child_process'
import * as nodePty from 'node-pty'
import type { RunOutput } from './exec.ts'

const isWindows = process.platform === 'win32'

export interface SpawnSpec {
  file: string
  args: string[]
  /**
   * true면 args를 따옴표를 더하지 않고 빈칸으로 잇는다(spawn의 windowsVerbatimArguments, node-pty에는 명령 줄 글).
   * .cmd를 감쌀 때 앱이 명령 줄을 직접 만들었다는 뜻이다
   */
  verbatim: boolean
}

// cmd.exe가 따로 읽는 글자. 출처: cross-spawn lib/util/escape.js
const CMD_META = /([()\][%!^"`<>&|;, *?])/g

/** .cmd 경로를 cmd의 명령 이름으로: 특수 글자와 빈칸을 ^로 막는다 */
export function cmdCommand(bin: string): string {
  return bin.replace(CMD_META, '^$1')
}

/**
 * 인자 하나를 MSVC 규칙으로 따옴표로 감싸고 cmd 특수 글자를 ^로 두 번 막는다. npm의 cmd-shim(claude.cmd)은 받은
 * 인자를 %*로 한 번 더 cmd가 읽으므로 두 번이다(cross-spawn의 shim 처리와 같다)
 */
export function cmdArg(arg: string): string {
  const quoted = `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`
  return quoted.replace(CMD_META, '^$1').replace(CMD_META, '^$1')
}

/**
 * npm 전역 설치의 claude.cmd처럼 .cmd는 ConPTY와 셸 없는 실행이 바로 돌리지 못해 cmd.exe로 감싼다. 명령 줄은 Node의
 * shell: true처럼 앱이 만들어 바깥 따옴표 한 쌍으로 감싼다(/s가 그것만 벗긴다). 경로의 빈칸, 인자의 따옴표와 & 같은
 * 글자가 명령을 끊지 않게 한다. 출처: v2 app/src/adapters/exec.ts spawnSpec, cross-spawn
 */
export function spawnSpec(bin: string, args: string[], comspec = 'cmd.exe'): SpawnSpec {
  if (bin.toLowerCase().endsWith('.cmd')) {
    const line = [cmdCommand(bin), ...args.map(cmdArg)].join(' ')
    return { file: comspec, args: ['/d', '/s', '/c', `"${line}"`], verbatim: true }
  }
  return { file: bin, args, verbatim: false }
}

/** process.env에 덧붙인다. 값이 없는 이름은 뺀다(node-pty와 spawn은 글만 받는다) */
function mergedEnv(extra?: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries({ ...process.env, ...extra })) {
    if (v !== undefined) out[k] = v
  }
  return out
}

// ── PTY ─────────────────────────────────────────────────────────────────────

export interface PtyOptions {
  bin: string
  args?: string[]
  cwd: string
  /** process.env에 덧붙일 환경 변수 */
  env?: NodeJS.ProcessEnv
  cols: number
  rows: number
  /**
   * 터미널에 묻는 DA1(ESC [ c)에 앱이 답하고 출력에서 뺀다. ConPTY는 시작할 때 이것을 묻고, 답이 없으면 크기 변경을
   * 처리하지 않는 것으로 보였다(v2 M0). 렌더러의 xterm이 붙기 전에 시작하므로 앱이 xterm과 같은 답을 보낸다
   */
  answerQueries?: boolean
}

export interface PtySession {
  readonly pid: number
  onData(cb: (data: string) => void): void
  onExit(cb: (exitCode: number) => void): void
  write(data: string): void
  resize(cols: number, rows: number): void
  /**
   * 프로세스 트리를 끝내고 끝날 때까지 기다린다. POSIX는 SIGHUP(실제 claude는 SessionEnd 훅을 보내고 끝난다),
   * graceMs 안에 끝나지 않으면 프로세스 묶음에 SIGKILL, 그다음 세션에 남은 것(배경 작업)에 SIGKILL. Windows는
   * taskkill /T /F. 이미 끝났으면 바로 돌아온다
   */
  killTree(graceMs?: number): Promise<void>
}

/** DA1 질의(ESC [ c, ESC [ 0 c)와 xterm.js의 답 */
const DA1_QUERIES = ['\x1b[c', '\x1b[0c']
const DA1_REPLY = '\x1b[?1;2c'

/** 출력에서 DA1 질의를 빼고, 질의마다 답을 보낸다 */
export function answerDa1(data: string, reply: (answer: string) => void): string {
  let out = data
  for (const q of DA1_QUERIES) {
    const parts = out.split(q)
    for (let i = 1; i < parts.length; i++) reply(DA1_REPLY)
    out = parts.join('')
  }
  return out
}

/**
 * Windows: node-pty는 콘솔 입력 파이프의 소켓에 'error' 처리를 두지 않는다. claude가 끝난 뒤 'exit'가 오기 전에 쓴 글은
 * 닫히는 파이프에 닿아 실패하고(ERROR_NO_DATA: write EAGAIN·EPIPE), 그 오류가 잡히지 않은 예외로 앱을 끝낸다. 끝나는
 * 터미널에 쓴 글은 POSIX처럼 그냥 버린다. 소켓은 node-pty의 안쪽 칸(_agent.inSocket)이라 없으면 아무것도 하지 않는다
 */
function quietInput(p: nodePty.IPty): void {
  if (!isWindows) return
  const agent = (p as unknown as { _agent?: { inSocket?: { on?: unknown } } })._agent
  const socket = agent?.inSocket
  if (socket && typeof socket.on === 'function')
    (socket as { on(event: 'error', cb: () => void): void }).on('error', () => {})
}

/** killTree가 SIGHUP 뒤 SIGKILL까지 기다리는 기본 시간 */
const KILL_GRACE_MS = 5_000

export function startPty(opts: PtyOptions): PtySession {
  const spec = spawnSpec(opts.bin, opts.args ?? [])
  // 출처: v2 spikes/lib/session.mjs start (name, useConpty). useConptyDll은 v2 I32
  const p = nodePty.spawn(spec.file, spec.verbatim ? spec.args.join(' ') : spec.args, {
    name: 'xterm-256color',
    cols: opts.cols,
    rows: opts.rows,
    cwd: opts.cwd,
    env: mergedEnv(opts.env),
    useConpty: true,
    useConptyDll: true,
  })
  let exited = false
  // killTree를 부른 뒤: 끝나는 콘솔에는 쓰지 않는다
  let closing = false
  quietInput(p)
  const exitWaiters: (() => void)[] = []
  p.onExit(() => {
    exited = true
    for (const w of exitWaiters.splice(0)) w()
  })
  const waitExit = (ms: number) =>
    new Promise<boolean>((resolve) => {
      if (exited) return resolve(true)
      const t = setTimeout(() => resolve(false), ms)
      exitWaiters.push(() => {
        clearTimeout(t)
        resolve(true)
      })
    })
  const listeners: ((data: string) => void)[] = []
  p.onData((data) => {
    const answer = (a: string) => {
      if (!exited && !closing) p.write(a)
    }
    const out = opts.answerQueries ? answerDa1(data, answer) : data
    if (out) for (const cb of listeners) cb(out)
  })
  return {
    pid: p.pid,
    onData: (cb) => void listeners.push(cb),
    onExit: (cb) => void p.onExit((e) => cb(e.exitCode)),
    write: (d) => {
      if (!exited && !closing) p.write(d)
    },
    resize: (c, r) => {
      if (!exited && !closing) p.resize(c, r)
    },
    killTree: async (graceMs = KILL_GRACE_MS) => {
      if (exited) return
      closing = true
      await killTree(p.pid, () => p.kill())
      const ended = await waitExit(graceMs)
      // 맨 앞이 끝났어도 SIGHUP을 무시한 자식이 묶음에 남을 수 있다. 다른 묶음으로 간 배경 작업(셸의 job control)은
      // 같은 세션에 남는다: node-pty의 자식은 세션의 맨 앞이라 세션 id가 그 pid다
      if (!isWindows) {
        signalGroup(p.pid, 'SIGKILL', !ended)
        await killSession(p.pid)
      }
      if (!ended) await waitExit(graceMs)
    },
  }
}

/**
 * POSIX에서 프로세스 묶음(과 lead면 맨 앞 프로세스)에 신호를 보낸다. node-pty의 자식과 runFile의 detached 자식은
 * 묶음의 맨 앞이다
 */
function signalGroup(pid: number, signal: NodeJS.Signals, lead = true): void {
  for (const target of lead ? [-pid, pid] : [-pid]) {
    try {
      process.kill(target, signal)
    } catch {
      // 이미 끝났다
    }
  }
}

/** POSIX: 세션 id가 sid인 프로세스를 모두 SIGKILL로 끝낸다(pkill -s). pkill이 없거나 남은 것이 없으면 그냥 돌아온다 */
function killSession(sid: number): Promise<void> {
  return new Promise((resolve) => {
    execFile('pkill', ['-KILL', '-s', String(sid)], { windowsHide: true }, () => resolve())
  })
}

// Windows에서는 node-pty의 kill() 대신 taskkill로 트리째 끝낸다. kill()은 이미 끝난 콘솔에 붙으려다 보조 프로세스가
// 죽는 일이 있었다. 출처: v2 spikes/lib/session.mjs kill, util.mjs killTree
function killTree(pid: number, fallback: () => void): Promise<void> {
  return new Promise((resolve) => {
    const rest = () => {
      try {
        fallback()
      } catch {
        // 이미 끝난 프로세스
      }
      resolve()
    }
    if (!isWindows) return rest()
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, (error) => {
      // 이미 끝났으면 taskkill이 실패한다. kill()로 넘어간다
      if (error) rest()
      else resolve()
    })
  })
}

// ── 셸 없는 실행 ─────────────────────────────────────────────────────────────

export interface RunFileOptions {
  cwd: string
  timeoutMs: number
  /** process.env에 덧붙일 환경 변수 */
  env?: NodeJS.ProcessEnv
  /** 표준 입력에 쓰고 닫는다. 없으면 표준 입력은 비어 있다 */
  input?: string
  /** 표준 출력의 상한(바이트). 넘으면 끝내고 실패로 돌려준다. 기본 32MB */
  maxBytes?: number
  /** 끊으면 프로세스 묶음째 끝내고 exit null, stderr 끝에 '그만둠'으로 돌려준다 */
  signal?: AbortSignal
}

const RUN_MAX_BYTES = 32 * 1024 * 1024

/** 돌고 있는 runFile의 맨 앞 pid(POSIX에서는 detached 묶음의 맨 앞) */
const runningFiles = new Set<number>()
/** killRunFiles가 끝낸 pid. Windows의 taskkill은 종료 코드 1을 남기므로 따로 적어 exit null로 돌려준다 */
const killedFiles = new Set<number>()

function stopTree(pid: number): void {
  if (isWindows) {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {})
  } else signalGroup(pid, 'SIGKILL')
}

/**
 * 돌고 있는 runFile(리뷰의 claude -p, gh, claude --version)을 모두 묶음째 끝낸다. detached라 앱이 끝나도 살아남으므로
 * 앱이 끝날 때 exec.ts의 killActive 옆에서 부른다
 */
export function killRunFiles(): void {
  for (const pid of runningFiles) {
    killedFiles.add(pid)
    stopTree(pid)
  }
  runningFiles.clear()
}
const MAX_TIMER_MS = 2 ** 31 - 1
/** 맨 앞 프로세스가 끝난 뒤 출력이 닫히기를 기다리는 시간 (묶음 밖으로 빠진 자식이 파이프를 쥔 경우) */
const CLOSE_WAIT_MS = 5_000

/**
 * 실행 파일을 셸 없이 인자 배열로 돌린다(.cmd는 spawnSpec). 던지지 않는다: 돌리지 못했거나 시간이 넘으면 exit null과
 * stderr 끝의 까닭(killRunFiles가 끝낸 것은 까닭 없이 exit null). 시간이 넘으면 프로세스 묶음째(Windows는 taskkill /T)
 * 끝낸다. 출력은 상한까지 자르지 않는다
 */
export function runFile(bin: string, args: string[], opts: RunFileOptions): Promise<RunOutput> {
  const started = performance.now()
  const limit = opts.maxBytes ?? RUN_MAX_BYTES
  return new Promise((resolve) => {
    const out: Buffer[] = []
    const err: Buffer[] = []
    let size = 0
    let timedOut = false
    let overflow = false
    let aborted = false
    let settled = false
    // spawn 뒤에 정해진다. finish·stop이 그 전에도 부를 수 있다
    const proc: { pid?: number } = {}
    const timers: ReturnType<typeof setTimeout>[] = []
    const onAbort = () => {
      aborted = true
      stop()
    }

    const finish = (code: number | null, spawnError?: string) => {
      if (settled) return
      settled = true
      for (const t of timers) clearTimeout(t)
      if (proc.pid !== undefined) runningFiles.delete(proc.pid)
      const killed = proc.pid !== undefined && killedFiles.delete(proc.pid)
      opts.signal?.removeEventListener('abort', onAbort)
      const why = timedOut
        ? `시간 초과 (${opts.timeoutMs}ms)`
        : overflow
          ? `출력이 상한(${limit}바이트)을 넘음`
          : aborted
            ? '그만둠'
            : spawnError
      const stderr = Buffer.concat(err).toString('utf8')
      resolve({
        exit: why === undefined && !killed ? code : null,
        timed_out: timedOut,
        duration_ms: Math.round(performance.now() - started),
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: why === undefined ? stderr : `${stderr}${stderr ? '\n' : ''}${why}`,
      })
    }
    const stop = () => {
      if (proc.pid !== undefined) stopTree(proc.pid)
    }
    if (opts.signal?.aborted) {
      aborted = true
      finish(null)
      return
    }
    const spec = spawnSpec(bin, args)
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(spec.file, spec.args, {
        cwd: opts.cwd,
        env: mergedEnv(opts.env),
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: !isWindows,
        windowsHide: true,
        windowsVerbatimArguments: spec.verbatim,
      })
    } catch (e) {
      // 환경 값의 NUL처럼 spawn이 바로 던지는 경우
      finish(null, `실행하지 못함: ${e instanceof Error ? e.message : String(e)}`)
      return
    }
    const pid = child.pid
    proc.pid = pid
    if (pid !== undefined) runningFiles.add(pid)
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    timers.push(
      setTimeout(
        () => {
          timedOut = true
          stop()
        },
        Math.min(Math.max(opts.timeoutMs, 1), MAX_TIMER_MS),
      ),
    )
    child.stdout?.on('data', (c: Buffer) => {
      size += c.length
      if (size <= limit) out.push(c)
      else if (!overflow) {
        overflow = true
        stop()
      }
    })
    child.stderr?.on('data', (c: Buffer) => err.push(c))
    child.on('error', (e) => finish(null, `실행하지 못함: ${e.message}`))
    child.on('exit', (code) => {
      // 묶음에 남은 자식을 끝낸다
      if (!isWindows && pid !== undefined) signalGroup(pid, 'SIGKILL', false)
      timers.push(
        setTimeout(() => {
          child.stdout?.destroy()
          child.stderr?.destroy()
          finish(code)
        }, CLOSE_WAIT_MS),
      )
    })
    child.on('close', (code) => finish(code))
    // 받는 쪽이 표준 입력을 읽지 않고 끝나도(EPIPE) 던지지 않는다
    child.stdin?.on('error', () => {})
    child.stdin?.end(opts.input ?? '')
  })
}

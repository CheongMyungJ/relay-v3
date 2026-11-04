// 프로세스 실행 (docs/m1-modules.md adapters/exec.ts).
// run: 레포 명령을 셸로 돌린다. 시간이 넘으면 프로세스 묶음째 끝내고 출력은 뒤쪽만 남긴다.
// git: git을 셸 없이 돌린다. 실패하면 던진다.

import { spawn, spawnSync } from 'node:child_process'
import { stat } from 'node:fs/promises'

export interface RunOptions {
  cwd: string
  timeoutMs: number
  /** 주면 이 환경 변수만 쓴다(합치지 않는다). 없으면 지금 프로세스의 것 */
  env?: Record<string, string>
}

export interface RunOutput {
  /** 종료 코드. 신호로 끝났거나, 시간이 넘었거나, 돌리지 못했으면 null */
  exit: number | null
  timed_out: boolean
  duration_ms: number
  stdout: string
  stderr: string
}

/** run이 남기는 출력의 크기(바이트). 넘으면 뒤쪽만 남긴다 */
export const OUTPUT_TAIL_BYTES = 64 * 1024

/** setTimeout이 받는 가장 큰 값(약 24.8일). 넘기면 Node가 1ms로 바꿔 바로 끝내 버린다 */
const MAX_TIMER_MS = 2 ** 31 - 1

/** 시간 초과로 SIGTERM을 보낸 뒤 SIGKILL까지 기다리는 시간 */
const KILL_GRACE_MS = 2_000

/** 맨 앞 프로세스가 끝난 뒤 출력이 닫히기를 기다리는 시간 (묶음 밖으로 빠진 자식이 파이프를 쥔 경우) */
const CLOSE_WAIT_MS = 5_000

const isWindows = process.platform === 'win32'

function shellSpec(cmd: string, env: NodeJS.ProcessEnv): { file: string; args: string[] } {
  if (isWindows) {
    // Node의 shell: true와 같은 모양. /s가 바깥 따옴표만 벗긴다
    const comspec = env.ComSpec ?? process.env.ComSpec ?? 'cmd.exe'
    return { file: comspec, args: ['/d', '/s', '/c', `"${cmd}"`] }
  }
  return { file: '/bin/sh', args: ['-c', cmd] }
}

/** 프로세스 묶음을 끝낸다. POSIX는 detached로 만든 묶음(-pid), Windows는 taskkill /T */
function killTree(pid: number, signal: 'SIGTERM' | 'SIGKILL', sync = false): void {
  if (isWindows) {
    const args = ['/PID', String(pid), '/T', '/F']
    // 이미 끝났으면 실패한다
    if (sync) spawnSync('taskkill', args, { stdio: 'ignore', windowsHide: true })
    else spawn('taskkill', args, { stdio: 'ignore', windowsHide: true }).on('error', () => {})
    return
  }
  try {
    process.kill(-pid, signal)
  } catch {
    // 묶음이 이미 없다
  }
}

/** 뒤쪽 limit 바이트만 모은다 */
function tailCollector(limit: number): { push(chunk: Buffer): void; text(): string } {
  const chunks: Buffer[] = []
  let size = 0
  return {
    push(chunk) {
      chunks.push(chunk)
      size += chunk.length
      while (chunks.length > 1 && size - (chunks[0]?.length ?? 0) >= limit) {
        size -= chunks.shift()?.length ?? 0
      }
    },
    text() {
      let buf = Buffer.concat(chunks)
      if (buf.length > limit) {
        buf = buf.subarray(buf.length - limit)
        // 잘린 UTF-8 글자의 남은 바이트(10xxxxxx)를 버린다
        let start = 0
        while (start < buf.length && start < 3 && ((buf[start] ?? 0) & 0xc0) === 0x80) start++
        buf = buf.subarray(start)
      }
      return buf.toString('utf8')
    },
  }
}

/** 돌고 있는 run의 맨 앞 pid */
const active = new Set<number>()
let exitHookInstalled = false

/**
 * 돌고 있는 run을 모두 묶음째 끝낸다. POSIX의 묶음은 터미널의 Ctrl+C를 받지 않으므로
 * cli가 SIGINT·SIGTERM 처리에서 부른다. 프로세스가 'exit'로 끝날 때도 저절로 부른다.
 */
export function killActive(): void {
  for (const pid of active) killTree(pid, 'SIGKILL', true)
  active.clear()
}

function failed(stderr: string): RunOutput {
  return { exit: null, timed_out: false, duration_ms: 0, stdout: '', stderr }
}

/**
 * 명령을 셸(`sh -c`, Windows는 `cmd /d /s /c`)로 돌린다. 던지지 않는다.
 * 맨 앞 프로세스가 끝나면 묶음에 남은 자식도 끝낸다. check worktree에 떠도는 프로세스를 남기지 않는다.
 */
export async function run(cmd: string, opts: RunOptions): Promise<RunOutput> {
  if (!(opts.timeoutMs > 0)) return failed(`시간 제한이 잘못됨: ${String(opts.timeoutMs)}`)
  try {
    if (!(await stat(opts.cwd)).isDirectory()) return failed(`작업 폴더가 아님: ${opts.cwd}`)
  } catch {
    return failed(`작업 폴더가 없음: ${opts.cwd}`)
  }
  if (cmd.includes('\0')) return failed('명령에 NUL 글자가 있음')
  const env = opts.env ?? process.env
  const spec = shellSpec(cmd, env)
  const started = performance.now()
  // setTimeout은 2^31-1ms를 넘지 못한다. 더 긴 제한은 그 값으로 자른다(제한 없이 돌지 않게)
  const timeoutMs = Math.min(opts.timeoutMs, MAX_TIMER_MS)

  return new Promise((resolve) => {
    const stdout = tailCollector(OUTPUT_TAIL_BYTES)
    const stderr = tailCollector(OUTPUT_TAIL_BYTES)
    let timedOut = false
    let settled = false
    let exited = false
    let exitCode: number | null = null
    const timers: ReturnType<typeof setTimeout>[] = []

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(spec.file, spec.args, {
        cwd: opts.cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: !isWindows,
        windowsHide: true,
        windowsVerbatimArguments: isWindows,
      })
    } catch (e) {
      // 환경 변수 값의 NUL처럼 spawn이 바로 던지는 경우
      resolve(failed(`실행하지 못함: ${e instanceof Error ? e.message : String(e)}`))
      return
    }
    const pid = child.pid
    if (pid !== undefined) active.add(pid)
    if (!exitHookInstalled) {
      exitHookInstalled = true
      process.on('exit', killActive)
    }

    const finish = (spawnError?: string) => {
      if (settled) return
      settled = true
      if (pid !== undefined) active.delete(pid)
      for (const t of timers) clearTimeout(t)
      const err = stderr.text()
      resolve({
        exit: timedOut || spawnError !== undefined ? null : exitCode,
        timed_out: timedOut,
        duration_ms: Math.round(performance.now() - started),
        stdout: stdout.text(),
        stderr: spawnError === undefined ? err : `${err}${err ? '\n' : ''}${spawnError}`,
      })
    }

    const out = child.stdout
    const err = child.stderr
    out?.on('data', (c: Buffer) => stdout.push(c))
    err?.on('data', (c: Buffer) => stderr.push(c))
    child.on('error', (e) => finish(`실행하지 못함: ${e.message}`))
    child.on('exit', (code) => {
      exited = true
      exitCode = code
      if (settled) return
      if (pid !== undefined && !isWindows) killTree(pid, 'SIGKILL')
      timers.push(
        setTimeout(() => {
          out?.destroy()
          err?.destroy()
          finish()
        }, CLOSE_WAIT_MS),
      )
    })
    child.on('close', () => finish())

    if (pid !== undefined) {
      timers.push(
        setTimeout(() => {
          if (exited) return
          timedOut = true
          killTree(pid, 'SIGTERM')
          timers.push(setTimeout(() => killTree(pid, 'SIGKILL'), KILL_GRACE_MS))
        }, timeoutMs),
      )
    }
  })
}

// 레포 명령(세션이 쓴 시험 코드 포함)에 넘기지 않을 이름. 대문자로 바꿔 견준다.
// HOME 아래 설정 파일(~/.npmrc, gh 설정 등)에 든 자격 증명은 막지 못한다.
const SECRET_NAMES = new Set([
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'NPM_TOKEN',
  'SSH_AUTH_SOCK',
  'SSH_AGENT_PID',
  'GPG_AGENT_INFO',
])
const SECRET_PATTERNS = [
  /TOKEN/,
  /SECRET/,
  /PASSW(?:OR)?D/,
  /PASSPHRASE/,
  /CREDENTIAL/,
  /API_?KEY/,
  /(?:ACCESS|PRIVATE|SIGNING|ENCRYPTION|DEPLOY|SSH)_KEY/,
  /(?:^|_)KEY$/,
  /(?:^|_)AUTH(?!OR)/,
  /_PAT$/,
  /ASKPASS/,
  /^NPM_CONFIG_.*AUTH/,
]

// 이 값들이 있으면 git이 cwd가 아닌 다른 레포를 본다 (훅 안에서 relay를 부른 경우 등).
// relay의 git 호출과 레포 명령 모두에서 뺀다
const GIT_LOCATION_ENV = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_NAMESPACE',
  'GIT_PREFIX',
]

const isGitLocation = (name: string): boolean => GIT_LOCATION_ENV.includes(name.toUpperCase())

function isSecret(name: string): boolean {
  const upper = name.toUpperCase()
  return SECRET_NAMES.has(upper) || SECRET_PATTERNS.some((re) => re.test(upper))
}

/**
 * 레포 명령에 줄 환경 변수. 자격 증명과 git 위치 변수를 빼고 `CI=1`을 넣는다.
 * 이름은 대소문자를 가리지 않는다
 */
export function scrubbedEnv(base: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(base)) {
    if (value === undefined || isSecret(name) || isGitLocation(name)) continue
    if (name.toUpperCase() === 'CI') continue
    out[name] = value
  }
  out.CI = '1'
  return out
}

/** git이 0이 아닌 코드로 끝났거나 돌지 못함 */
export class GitError extends Error {
  readonly args: string[]
  readonly exit: number | null
  readonly stderr: string
  constructor(args: string[], exit: number | null, stderr: string) {
    const why = stderr.trim().slice(0, 2_000) || '출력 없음'
    // 메시지가 잘려도 까닭이 남게 -c 설정과 긴 SHA는 줄여 보인다
    const plain = args.filter((a, i) => a !== '-c' && args[i - 1] !== '-c')
    const short = plain.map((a) => (/^[0-9a-f]{40,64}$/.test(a) ? a.slice(0, 12) : a))
    const shown = short.length > 6 ? [...short.slice(0, 6), '…'] : short
    super(`git ${shown.join(' ')} 실패 (종료 ${String(exit)}): ${why}`)
    this.name = 'GitError'
    this.args = args
    this.exit = exit
    this.stderr = stderr
  }
}

function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  for (const name of Object.keys(env)) if (isGitLocation(name)) env[name] = undefined
  return env
}

/** git을 셸 없이 돌려 표준 출력을 바이트로 돌려준다. 실패하면 GitError를 던진다 */
export function gitBytes(args: string[], cwd: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const out: Buffer[] = []
    const err: Buffer[] = []
    const child = spawn('git', args, {
      cwd,
      env: gitEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    child.stdout.on('data', (c: Buffer) => out.push(c))
    child.stderr.on('data', (c: Buffer) => err.push(c))
    child.on('error', (e) => reject(new GitError(args, null, e.message)))
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out))
      else reject(new GitError(args, code, Buffer.concat(err).toString('utf8')))
    })
  })
}

/** git을 셸 없이 돌려 표준 출력을 돌려준다. 실패하면 GitError(stderr 포함)를 던진다 */
export async function git(args: string[], cwd: string): Promise<string> {
  return (await gitBytes(args, cwd)).toString('utf8')
}

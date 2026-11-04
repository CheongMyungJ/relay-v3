// claude 실행 파일 찾기, 버전, 짧은 구조화 호출 (docs/m2-modules.md 2절).
// v2 app/src/adapters/claude.ts의 findClaude, claudeVersion, claudeJson을 옮겼다. claudeJson은 독립 리뷰(V4)에 맞춰
// 읽기 도구만 주고, 프롬프트는 표준 입력으로 넘긴다(긴 diff가 명령줄 상한에 걸리지 않게).

import { accessSync, constants, statSync } from 'node:fs'
import path from 'node:path'
import { runFile } from './pty.ts'

export interface FindClaudeOptions {
  platform?: NodeJS.Platform
  /** 실행할 수 있는 파일인가. 시험이 바꿔 끼운다 */
  exists?: (file: string) => boolean
}

function isExecutable(file: string): boolean {
  try {
    if (process.platform !== 'win32') accessSync(file, constants.X_OK)
    return statSync(file).isFile()
  } catch {
    return false
  }
}

/** PATH의 폴더들. Windows는 이름의 대소문자를 가리지 않아 Path도 읽는다. 빈 항목은 뺀다 */
function pathDirs(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const value = env.PATH ?? env.Path ?? ''
  return value.split(platform === 'win32' ? ';' : ':').filter((dir) => dir !== '')
}

/**
 * claude 실행 파일. `CLAUDE_BIN`이 먼저다: 경로면 있어야 하고, 경로가 아닌 이름이면 그대로 쓴다(실행할 때 PATH에서
 * 찾는다). 그다음 PATH(Windows는 claude.exe, claude.cmd), 마지막으로 네이티브 설치 자리(~/.local/bin/claude,
 * %USERPROFILE%\.local\bin\claude.exe). 메뉴로 켠 앱은 로그인 뒤에 생긴 ~/.local/bin이 PATH에 없을 수 있다(v2 I119).
 * 못 찾으면 null
 */
export function findClaude(
  env: NodeJS.ProcessEnv = process.env,
  o: FindClaudeOptions = {},
): string | null {
  const platform = o.platform ?? process.platform
  const exists = o.exists ?? isExecutable
  const p = platform === 'win32' ? path.win32 : path.posix

  const bin = env.CLAUDE_BIN
  if (bin) return !/[\\/]/.test(bin) || exists(bin) ? bin : null

  const names = platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude']
  const candidates = pathDirs(env, platform).flatMap((dir) => names.map((n) => p.join(dir, n)))
  const home = platform === 'win32' ? env.USERPROFILE : env.HOME
  if (home) candidates.push(p.join(home, '.local', 'bin', names[0] ?? 'claude'))
  return candidates.find(exists) ?? null
}

/** `claude --version`의 첫 줄(예: `2.1.318 (Claude Code)`). 실패하면 던진다 */
export async function claudeVersion(bin: string, env?: Record<string, string>): Promise<string> {
  const r = await runFile(bin, ['--version'], {
    cwd: process.cwd(),
    timeoutMs: 60_000,
    ...(env ? { env } : {}),
  })
  const first = r.stdout.trim().split(/\r?\n/)[0] ?? ''
  if (r.exit !== 0 || !first) {
    throw new Error(`claude --version 실패 (종료 ${String(r.exit)}): ${tail(r.stderr || r.stdout)}`)
  }
  return first
}

export interface ClaudeJsonInput {
  bin: string
  /** 작업 폴더. 리뷰는 Work의 worktree다 */
  cwd: string
  /** 표준 입력으로 넘긴다 */
  prompt: string
  /** 구조화된 출력의 JSON Schema (--json-schema) */
  schema: object
  /** 없으면 CLI의 기본 모델 */
  model?: string
  /** 허락할 도구. 리뷰는 읽기 도구만(Read, Grep, Glob). 비면 도구 없음 */
  allowedTools: string[]
  timeoutMs: number
  /** process.env에 덧붙일 환경 변수 */
  env?: Record<string, string>
  /** 끊으면 claude -p를 프로세스 묶음째 끝내고 실패로 돌려준다(Work를 버림, 앱 종료) */
  signal?: AbortSignal
}

export type ClaudeJsonResult =
  { ok: true; value: unknown; usage?: object } | { ok: false; error: string }

/**
 * claudeJson의 실행 인자. `--tools`로 쓸 수 있는 도구 자체를 allowedTools의 도구로 줄인다: `--allowedTools`만으로는
 * 레포의 .claude/settings.json이 허락한 도구(세션이 써 둔 것 포함)가 남는다. `--setting-sources user`로 레포의
 * 프로젝트·로컬 설정(세션이 써 둔 훅, env 포함)을 읽지 않는다(리뷰의 독립, V4). 세션을 남기지 않는다(재개 목록에 섞이지 않게)
 */
export function claudeJsonArgs(
  o: Pick<ClaudeJsonInput, 'schema' | 'model' | 'allowedTools'>,
): string[] {
  const tools = [...new Set(o.allowedTools.map((t) => t.replace(/\(.*$/s, '').trim()))].filter(
    (t) => t !== '',
  )
  return [
    '-p',
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(o.schema),
    '--tools',
    tools.join(','),
    ...(o.allowedTools.length > 0 ? ['--allowedTools', o.allowedTools.join(',')] : []),
    '--permission-mode',
    'default',
    '--setting-sources',
    'user',
    ...(o.model ? ['--model', o.model] : []),
    '--no-session-persistence',
  ]
}

function tail(text: string, max = 2_000): string {
  const t = text.trim()
  return (t.length > max ? `…${t.slice(-max)}` : t) || '출력 없음'
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * `claude -p`를 한 번 부르고 결과의 `structured_output`을 돌려준다. 던지지 않는다: 돌리지 못함, 시간 초과, 종료 코드,
 * 읽지 못한 출력, `is_error`, 구조화된 출력 없음은 모두 `{ ok: false, error }`
 */
export async function claudeJson(o: ClaudeJsonInput): Promise<ClaudeJsonResult> {
  const r = await runFile(o.bin, claudeJsonArgs(o), {
    cwd: o.cwd,
    timeoutMs: o.timeoutMs,
    input: o.prompt,
    ...(o.env ? { env: o.env } : {}),
    ...(o.signal ? { signal: o.signal } : {}),
  })
  if (o.signal?.aborted) return { ok: false, error: 'claude -p를 그만둠' }
  if (r.timed_out) return { ok: false, error: `claude -p 시간 초과 (${o.timeoutMs}ms)` }
  if (r.exit !== 0) {
    return {
      ok: false,
      error: `claude -p 실패 (종료 ${String(r.exit)}): ${tail(r.stderr || r.stdout)}`,
    }
  }
  let j: unknown
  try {
    j = JSON.parse(r.stdout)
  } catch {
    return { ok: false, error: `claude -p의 출력을 읽지 못함: ${tail(r.stdout, 200)}` }
  }
  if (!isObject(j))
    return { ok: false, error: `claude -p의 출력이 객체가 아님: ${tail(r.stdout, 200)}` }
  if (j.is_error === true) {
    return { ok: false, error: `claude -p 오류: ${tail(String(j.result ?? '까닭 없음'), 500)}` }
  }
  const value = j.structured_output
  if (value === undefined || value === null) return { ok: false, error: '구조화된 출력 없음' }
  return isObject(j.usage) ? { ok: true, value, usage: j.usage } : { ok: true, value }
}

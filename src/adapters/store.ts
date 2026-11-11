// 앱 저장소 (docs/m1-modules.md adapters/store.ts, docs/design.md 4절).
// $RELAY_HOME/evidence/<레포 키>/<head SHA>.json, $RELAY_HOME/cache/<레포 키>/base/<SHA>/...

import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import type { CommandRun } from '../core/types.ts'

/** `RELAY_HOME`(절대 경로로 바꿈) 또는 `~/.relay-v3` */
export function relayHome(env: NodeJS.ProcessEnv): string {
  const home = env.RELAY_HOME?.trim()
  return home ? resolve(home) : join(homedir(), '.relay-v3')
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** 경로 조각에 쓸 수 있게 글자를 바꾼다. 글자·숫자·`._-`만 남긴다 */
function slug(text: string, max: number): string {
  const s = text
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^[-.]+|-+$/g, '')
    .slice(0, max)
  return s || 'x'
}

/** 같은 폴더를 같은 키로 보게 경로를 고른다 */
function normalizeRoot(repoRoot: string): string {
  let p = resolve(repoRoot).replace(/\\/g, '/')
  if (p.length > 1) p = p.replace(/\/+$/, '')
  return process.platform === 'win32' ? p.toLowerCase() : p
}

/** 레포 키: `<폴더 이름>-<경로 해시 12자리>` */
export function repoKey(repoRoot: string): string {
  const norm = normalizeRoot(repoRoot)
  const name = slug(basename(norm) || 'repo', 40)
  return `${name}-${sha256(norm).slice(0, 12)}`
}

const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/

function checkSha(sha: string): string {
  const lower = sha.toLowerCase()
  if (!SHA.test(lower)) throw new Error(`잘못된 SHA: '${sha}'`)
  return lower
}

/** 경로 조각 하나로 안전한가 (구분자, '..' 없음) */
function checkSegment(text: string, what: string): string {
  if (text === '' || text === '.' || text === '..' || /[/\\\0]/.test(text)) {
    throw new Error(`잘못된 ${what}: '${text}'`)
  }
  return text
}

/** 실적 장부의 자리: $RELAY_HOME/ledger.jsonl(앱이 덧붙이고 앱과 `relay record`가 읽는다) */
export function ledgerPath(home: string): string {
  return join(home, 'ledger.jsonl')
}

/** 실적 장부의 글. 없으면 빈 글(줄을 읽는 것은 engine/after-merge.ts parseRecord) */
export async function readLedgerText(home: string): Promise<string> {
  try {
    return await readFile(ledgerPath(home), 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw e
  }
}

/** 증거 묶음의 자리 */
export function evidencePath(home: string, key: string, sha: string): string {
  return join(home, 'evidence', checkSegment(key, '레포 키'), `${checkSha(sha)}.json`)
}

/** Windows의 rename이 대상을 다른 손이 쥐고 있을 때(겹친 쓰기의 rename, 읽는 중, 백신) 내는 오류 */
const RENAME_BUSY = new Set(['EPERM', 'EACCES', 'EBUSY'])
/** 그 오류에 다시 해 보는 시간 */
const RENAME_RETRY_MS = 5_000

/**
 * 임시 파일을 제자리에 바꿔 넣는다. Windows는 대상이 잠깐 잡혀 있으면 rename이 실패하므로(POSIX는 그냥 덮는다) 잠깐씩
 * 쉬며 다시 한다. 출처: graceful-fs의 rename
 */
async function replaceFile(tmp: string, path: string): Promise<void> {
  if (process.platform !== 'win32') return rename(tmp, path)
  const until = Date.now() + RENAME_RETRY_MS
  for (let wait = 1; ; wait = Math.min(wait * 2, 100)) {
    try {
      return await rename(tmp, path)
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code === undefined || !RENAME_BUSY.has(code) || Date.now() >= until) throw e
      await new Promise((r) => setTimeout(r, wait))
    }
  }
}

/** JSON을 쓴다. 폴더를 만들고, 임시 파일에 쓴 뒤 바꿔 넣어 반쯤 쓴 파일이 남지 않게 한다 */
export async function writeJson(path: string, value: unknown): Promise<void> {
  const text = JSON.stringify(value, null, 2)
  if (text === undefined) throw new Error('JSON으로 쓸 수 없는 값')
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  try {
    await writeFile(tmp, `${text}\n`, 'utf8')
    await replaceFile(tmp, path)
  } catch (e) {
    await rm(tmp, { force: true })
    throw e
  }
}

/** JSON을 읽는다. 파일이 없거나 JSON이 깨졌으면 null */
export async function readJson<T>(path: string): Promise<T | null> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

interface BaseCacheEntry {
  version: 1
  command_id: string
  run_hash: string
  run: CommandRun
}

function isCommandRun(v: unknown): v is CommandRun {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    typeof r.id === 'string' &&
    typeof r.sha === 'string' &&
    (typeof r.exit === 'number' || r.exit === null) &&
    typeof r.timed_out === 'boolean' &&
    typeof r.duration_ms === 'number' &&
    typeof r.stdout_tail === 'string' &&
    typeof r.stderr_tail === 'string'
  )
}

/**
 * base에서 돌린 명령 결과의 캐시. 열쇠는 (레포 키, base SHA, 명령 id, 실행 해시).
 * 실행 해시는 부르는 쪽이 정한다(명령 글, setup 등). 명령 id는 사용자가 정한 글이라 해시로 파일 이름을 만든다.
 */
export const baseCache = {
  path(home: string, key: string, sha: string, commandId: string, runHash: string): string {
    const file = `${slug(commandId, 40)}.${sha256(`${commandId}\0${runHash}`).slice(0, 16)}.json`
    return join(home, 'cache', checkSegment(key, '레포 키'), 'base', checkSha(sha), file)
  },

  /** 없거나, 열쇠가 맞지 않거나, 모양이 깨졌으면 null */
  async read(
    home: string,
    key: string,
    sha: string,
    commandId: string,
    runHash: string,
  ): Promise<CommandRun | null> {
    const entry = await readJson<BaseCacheEntry>(baseCache.path(home, key, sha, commandId, runHash))
    if (
      entry === null ||
      entry.command_id !== commandId ||
      entry.run_hash !== runHash ||
      !isCommandRun(entry.run) ||
      entry.run.sha.toLowerCase() !== sha.toLowerCase()
    ) {
      return null
    }
    return entry.run
  },

  /** run.sha가 sha와 다르면 던진다(다른 커밋의 결과를 base로 저장하지 않는다) */
  async write(
    home: string,
    key: string,
    sha: string,
    commandId: string,
    runHash: string,
    run: CommandRun,
  ): Promise<void> {
    if (run.sha.toLowerCase() !== sha.toLowerCase()) {
      throw new Error(`결과의 SHA가 다름: ${run.sha} ≠ ${sha}`)
    }
    const entry: BaseCacheEntry = { version: 1, command_id: commandId, run_hash: runHash, run }
    await writeJson(baseCache.path(home, key, sha, commandId, runHash), entry)
  },
}

// check worktree (docs/design.md V10, docs/m1-modules.md adapters/worktrees.ts).
// 레포마다 base·head 둘을 $RELAY_HOME/worktrees/<레포 키>/<slot>에 두고 다시 쓴다.

import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { matchAny } from '../core/glob.ts'
import type { SetupSpec } from '../core/types.ts'
import { git, run, scrubbedEnv } from './exec.ts'
import { dirsOf, lsTree } from './git.ts'
import { readJson, writeJson } from './store.ts'

export type Slot = 'base' | 'head'

export interface Checkout {
  dir: string
  setupRan: boolean
  setupError?: string
}

/** setup.timeout_sec가 없을 때 */
export const DEFAULT_SETUP_TIMEOUT_SEC = 600

interface SetupState {
  hash: string
  sha: string
  /** setup 뒤에 있던 keep 경로. 다음에 하나라도 없으면 setup을 다시 돈다 */
  kept?: string[]
}

function checkSha(sha: string): void {
  if (sha === '' || sha.startsWith('-')) throw new Error(`잘못된 SHA: '${sha}'`)
}

function checkKey(key: string): void {
  if (key === '' || key === '.' || key === '..' || /[/\\\0]/.test(key)) {
    throw new Error(`잘못된 레포 키: '${key}'`)
  }
}

async function samePath(a: string, b: string): Promise<boolean> {
  const norm = async (p: string) => {
    const real = await realpath(resolve(p)).catch(() => resolve(p))
    return process.platform === 'win32' ? real.toLowerCase() : real
  }
  return (await norm(a)) === (await norm(b))
}

async function commonDir(dir: string): Promise<string> {
  return resolve(dir, (await git(['rev-parse', '--git-common-dir'], dir)).trim())
}

/** dir가 repoRoot에 딸린 worktree의 루트인가 */
async function isOurWorktree(dir: string, repoRoot: string): Promise<boolean> {
  try {
    if (!(await stat(join(dir, '.git'))).isFile()) return false
    const top = (await git(['rev-parse', '--show-toplevel'], dir)).trim()
    if (!(await samePath(top, dir))) return false
    return await samePath(await commonDir(dir), await commonDir(repoRoot))
  } catch {
    return false
  }
}

/** 레포의 훅(post-checkout 등)을 check worktree에서 돌리지 않는다 */
async function noHooks(home: string): Promise<string[]> {
  const empty = join(home, 'worktrees', '.no-hooks')
  await mkdir(empty, { recursive: true })
  return ['-c', `core.hooksPath=${empty}`]
}

/** dir 안의 경로면 절대 경로, 밖이면 null */
function inside(dir: string, rel: string): string | null {
  if (rel === '' || isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) return null
  const full = resolve(dir, rel)
  const back = relative(dir, full)
  if (back === '' || back === '..' || back.startsWith(`..${sep}`) || isAbsolute(back)) return null
  return full
}

/** setup을 다시 돌아야 하는지 가리는 해시: run, keep, inputs 파일 내용 */
async function setupHash(dir: string, setup: SetupSpec): Promise<string> {
  const h = createHash('sha256')
  h.update(`run\0${setup.run}\0keep\0${setup.keep.join('\0')}\0`)
  for (const input of [...setup.inputs].sort()) {
    h.update(`input\0${input}\0`)
    const full = inside(dir, input)
    const bytes = full === null ? null : await readFile(full).catch(() => null)
    if (bytes === null) {
      h.update('missing\0')
    } else {
      h.update(`${bytes.length}\0`)
      h.update(bytes)
    }
  }
  return h.digest('hex')
}

function lastLines(text: string, n: number): string {
  return text.trim().split(/\r?\n/).slice(-n).join('\n')
}

async function runSetup(dir: string, setup: SetupSpec): Promise<string | undefined> {
  const sec = setup.timeout_sec ?? DEFAULT_SETUP_TIMEOUT_SEC
  const r = await run(setup.run, { cwd: dir, timeoutMs: sec * 1000, env: scrubbedEnv(process.env) })
  if (r.timed_out) return `setup 시간 초과 (${sec}초)`
  if (r.exit === 0) return undefined
  const tail = lastLines(r.stderr || r.stdout, 5)
  const code = r.exit === null ? '없음' : String(r.exit)
  return `setup 실패 (종료 코드 ${code})${tail ? `: ${tail}` : ''}`
}

/**
 * slot의 check worktree를 sha로 맞춘다 (V10).
 * 처음이면 `git worktree add --detach`, 아니면 강제 체크아웃 + `git clean -ffdx`(keep은 남김).
 * setup이 있으면 inputs 내용 해시가 지난번 성공한 setup과 다를 때만 돈다.
 * git이 실패하면 던진다. setup이 실패하면 setupError에 적는다.
 */
export async function prepareCheckout(
  home: string,
  repoKey: string,
  repoRoot: string,
  slot: Slot,
  sha: string,
  setup?: SetupSpec,
): Promise<Checkout> {
  if (slot !== 'base' && slot !== 'head') throw new Error(`잘못된 slot: '${String(slot)}'`)
  checkKey(repoKey)
  checkSha(sha)
  const root = join(home, 'worktrees', repoKey)
  const dir = join(root, slot)
  const statePath = join(root, `${slot}.setup.json`)
  const hooks = await noHooks(home)
  const keep = setup?.keep ?? []

  let reused = false
  if (await isOurWorktree(dir, repoRoot)) {
    try {
      await git([...hooks, 'checkout', '--force', '--detach', sha], dir)
      await git(['clean', '-ffdx', ...keep.flatMap((k) => ['-e', k])], dir)
      reused = true
    } catch {
      // 지난 git이 남긴 index.lock 같은 것으로 막히면 새로 만든다(아래)
    }
  }
  if (!reused) {
    await rm(dir, { recursive: true, force: true })
    await rm(statePath, { force: true })
    await mkdir(root, { recursive: true })
    // 폴더가 없는데 등록만 남은 자리는 -f로 다시 쓴다. 다른 worktree는 건드리지 않는다(prune 안 함)
    await git([...hooks, 'worktree', 'add', '--force', '--detach', dir, sha], repoRoot)
  }

  if (setup === undefined) {
    // keep 없이 clean했으니 지난 setup의 결과물은 없다
    await rm(statePath, { force: true })
    return { dir, setupRan: false }
  }
  const hash = await setupHash(dir, setup)
  const last = await readJson<SetupState>(statePath)
  if (last !== null && last.hash === hash && (await allExist(dir, last.kept))) {
    return { dir, setupRan: false }
  }

  await rm(statePath, { force: true })
  const setupError = await runSetup(dir, setup)
  if (setupError !== undefined) return { dir, setupRan: true, setupError }
  // keep 밖에 남은 결과물은 다음 clean이 지운다. 그때는 상태를 남기지 않아 늘 다시 돈다
  if (keep.length > 0 && (await outsideKeep(dir, keep)).length === 0) {
    const kept: string[] = []
    for (const k of keep) if (await exists(dir, k)) kept.push(k)
    const state: SetupState = { hash, sha, kept }
    await writeJson(statePath, state)
  }
  return { dir, setupRan: true }
}

async function exists(dir: string, rel: string): Promise<boolean> {
  const full = inside(dir, rel)
  return (
    full !== null &&
    (await lstat(full)
      .then(() => true)
      .catch(() => false))
  )
}

/** 지난 상태에 적힌 keep 경로가 모두 남았나. 적힌 것이 없으면(옛 상태) 다시 돈다 */
async function allExist(dir: string, kept: string[] | undefined): Promise<boolean> {
  if (kept === undefined) return false
  for (const k of kept) if (!(await exists(dir, k))) return false
  return true
}

/** setup 뒤 keep 밖에 생긴 추적하지 않는 파일·폴더 */
async function outsideKeep(dir: string, keep: string[]): Promise<string[]> {
  const out = await git(
    ['status', '--porcelain', '--ignored=matching', '-z', '--untracked-files=normal'],
    dir,
  )
  // clean -e처럼 읽는다: '/'가 없는 이름은 어느 깊이에서나 맞는다
  const globs = keep.flatMap((k) => {
    const g = k
      .replace(/\\/g, '/')
      .replace(/^\.?\//, '')
      .replace(/\/+$/, '')
    return g.includes('/') ? [g, `${g}/**`] : [`**/${g}`, `**/${g}/**`]
  })
  return out
    .split('\0')
    .filter((e) => e.startsWith('?? ') || e.startsWith('!! '))
    .map((e) => e.slice(3).replace(/\/+$/, ''))
    .filter((p) => !matchAny(p, globs))
}

// ── 레포마다 하나의 check (V10의 worktree를 함께 쓰지 않게) ──────────────────

/** 잠금 파일이 비었거나 깨졌을 때 버려진 것으로 볼 때까지(밀리초) */
const LOCK_UNREADABLE_MS = 10_000

function alive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * 레포 키의 check worktree를 잠근다. 다른 check가 쥐고 있으면 waitMs까지 기다리고 그래도 못 잡으면 던진다.
 * 잡은 프로세스가 죽었으면 넘겨받는다. 돌려주는 함수로 푼다.
 */
export async function lockWorktrees(
  home: string,
  repoKey: string,
  waitMs: number,
  pollMs = 200,
): Promise<() => Promise<void>> {
  checkKey(repoKey)
  const root = join(home, 'worktrees', repoKey)
  await mkdir(root, { recursive: true })
  const path = join(root, '.lock')
  const token = `${process.pid} ${randomUUID()}`
  const deadline = Date.now() + waitMs
  for (;;) {
    try {
      await writeFile(path, `${token}\n`, { flag: 'wx' })
      return async () => {
        const now = await readFile(path, 'utf8').catch(() => '')
        if (now.trim() === token) await rm(path, { force: true })
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
    }
    const holder = await readFile(path, 'utf8').catch(() => null)
    if (holder === null) continue
    const pid = Number(holder.trim().split(' ')[0])
    const age = await stat(path).then(
      (st) => Date.now() - st.mtimeMs,
      () => 0,
    )
    const abandoned = Number.isInteger(pid) && pid > 0 ? !alive(pid) : age > LOCK_UNREADABLE_MS
    if (abandoned) {
      // 그 사이에 다른 프로세스가 새로 잡았으면 지우지 않는다
      const again = await readFile(path, 'utf8').catch(() => null)
      if (again === holder) await unlink(path).catch(() => {})
      continue
    }
    if (Date.now() >= deadline) {
      throw new Error(`다른 check가 worktree를 쓰는 중 (pid ${Number.isNaN(pid) ? '?' : pid})`)
    }
    await sleep(pollMs)
  }
}

const OVERLAY_CHUNK = 100

/**
 * dir(보통 base worktree)의 paths를 fromSha의 것으로 바꾼다 (바뀜 줄의 base 실행용, V11).
 * fromSha에 없는 경로는 dir에서도 지운다. 폴더를 주면 그 아래를 통째로 fromSha와 같게 한다.
 * 경로는 레포 루트 기준이고 글자 그대로 본다(glob이 아님). 레포 밖 경로는 던진다.
 */
export async function overlay(
  home: string,
  dir: string,
  repoRoot: string,
  fromSha: string,
  paths: string[],
): Promise<void> {
  checkSha(fromSha)
  const wanted = [
    ...new Set(paths.map((p) => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, ''))),
  ]
  for (const p of wanted) {
    if (inside(dir, p) === null || p.split('/').some((s) => s === '..' || s === '.git')) {
      throw new Error(`얹을 수 없는 경로: '${p}'`)
    }
  }
  if (wanted.length === 0) return

  const files = new Set(await lsTree(repoRoot, fromSha))
  const dirs = dirsOf([...files])
  const present = wanted.filter((p) => files.has(p) || dirs.has(p))

  for (const p of wanted) await removeInside(dir, p)
  const hooks = await noHooks(home)
  for (let i = 0; i < present.length; i += OVERLAY_CHUNK) {
    const chunk = present.slice(i, i + OVERLAY_CHUNK)
    await git([...hooks, '--literal-pathspecs', 'checkout', fromSha, '--', ...chunk], dir)
  }
}

/**
 * dir 안의 경로 p를 지운다. 위쪽 조각이 심볼릭 링크면 링크만 지우고 그 너머로 가지 않는다
 * (base에 레포 밖을 가리키는 링크가 있어도 바깥 파일을 지우지 않게).
 */
async function removeInside(dir: string, p: string): Promise<void> {
  const parts = p.split('/')
  let at = dir
  for (let i = 0; i < parts.length - 1; i++) {
    at = join(at, parts[i] ?? '')
    const st = await lstat(at).catch(() => null)
    if (st === null) return
    if (st.isSymbolicLink() || !st.isDirectory()) {
      await rm(at, { force: true })
      return
    }
  }
  await rm(join(dir, p), { recursive: true, force: true })
}

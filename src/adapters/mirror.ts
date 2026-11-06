// 앱 로컬 거울 (M4b, docs/m4-design.md 4.4, 설계자 결정 Q5 (가)). 끝까지 따라가기와 같은 변경은 기준 브랜치의 이력과 PR의
// 커밋이 로컬에 있어야 하는데, 앱은 사용자 레포에서 fetch하지 않는다(사용자 레포의 ref·설정·객체를 바꾸지 않는다, V9·V20의
// base 읽기도 그대로). 그래서 $RELAY_HOME/mirror/<레포 키>.git에 origin의 blobless bare clone을 두고 이것만 fetch한다:
//   git clone --bare --filter=blob:none <origin url>
//   git fetch origin +refs/heads/<기준>:refs/heads/<기준>, +refs/pull/<N>/head:refs/relay/pr/<N>(따라가는 PR만, 하나씩)
//   git fetch <사용자 레포> +refs/heads/<Work 브랜치>:refs/relay/work/<Work 브랜치>(내보낸 head. 사용자 레포는 읽기만)
// 사용자의 git 자격을 그대로 쓴다(묻지 않는다: GIT_TERMINAL_PROMPT=0). blob은 patch-id가 부를 때만 git이 받는다.

import { existsSync } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { git, GitError } from './exec.ts'
import { repoKey } from './store.ts'

/** 거울의 자리: $RELAY_HOME/mirror/<레포 키>.git(레포 키는 adapters/store.ts repoKey) */
export function mirrorDir(home: string, repo: string): string {
  return join(home, 'mirror', `${repoKey(repo)}.git`)
}

/** URL 꼴(scheme://, user@host:path)이 아니면 로컬 경로다 */
const isUrl = (u: string) => /^[a-z][a-z0-9+.-]*:\/\//i.test(u) || /^[^/\\]+@[^/\\]+:/.test(u)

/** 사용자 레포의 origin URL(`git remote get-url origin`, 읽기만). 로컬 경로는 그 레포 기준의 절대 경로로. 없으면 null */
export async function originUrl(repo: string): Promise<string | null> {
  const url = await git(['remote', 'get-url', 'origin'], repo)
    .then((o) => o.trim())
    .catch(() => '')
  if (url === '') return null
  return isUrl(url) || isAbsolute(url) ? url : resolve(repo, url)
}

/**
 * 거울이 없으면 만든다(임시 자리에 clone한 뒤 이름을 바꾼다: 반쯤 받은 거울이 남지 않게). origin이 없으면 던진다. 거울의
 * 자리를 돌려준다
 */
export async function ensureMirror(home: string, repo: string): Promise<string> {
  const dir = mirrorDir(home, repo)
  if (existsSync(join(dir, 'HEAD'))) return dir
  const url = await originUrl(repo)
  if (url === null) throw new Error(`origin이 없음: ${repo}`)
  await mkdir(join(home, 'mirror'), { recursive: true, mode: 0o700 })
  const tmp = `${dir}.${String(process.pid)}.tmp`
  await rm(tmp, { recursive: true, force: true })
  try {
    // 로컬 경로 origin은 git이 filter를 무시하고 모두 받는다(시험의 bare origin)
    await git(['clone', '--quiet', '--bare', '--filter=blob:none', '--no-tags', url, tmp], home)
    await rename(tmp, dir)
  } catch (e) {
    await rm(tmp, { recursive: true, force: true })
    throw e
  }
  return dir
}

const BRANCH = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]+$/

function checkBranch(name: string): string {
  if (!BRANCH.test(name)) throw new Error(`잘못된 브랜치 이름: '${name}'`)
  return name
}

/** 거울에서 PR의 head ref 이름 */
export const prRef = (n: number) => `refs/relay/pr/${String(n)}`

/** 거울에서 Work 브랜치(사용자 레포에서 받은 것)의 ref 이름 */
export const workRef = (branch: string) => `refs/relay/work/${checkBranch(branch)}`

/** 거울의 기준 브랜치를 origin에서 갱신한다. 실패하면 던진다 */
export async function fetchBase(dir: string, base: string): Promise<void> {
  const b = checkBranch(base)
  await git(['fetch', '--quiet', '--no-tags', 'origin', `+refs/heads/${b}:refs/heads/${b}`], dir)
}

/** PR의 refs/pull/<N>/head를 거울로 받는다(GitHub가 머지·닫힘 뒤에도 남긴다). 없거나 실패하면 거짓 */
export async function fetchPr(dir: string, n: number): Promise<boolean> {
  if (!Number.isSafeInteger(n) || n <= 0) return false
  const spec = `+refs/pull/${String(n)}/head:${prRef(n)}`
  return git(['fetch', '--quiet', '--no-tags', 'origin', spec], dir).then(
    () => true,
    () => false,
  )
}

/**
 * 사용자 레포의 Work 브랜치를 거울로 받는다(내보낸 head가 PR에 없을 수 있다: force push, squash 뒤 지운 브랜치). 사용자
 * 레포는 읽기만 한다. 브랜치가 없으면 거짓
 */
export async function fetchWork(dir: string, repo: string, branch: string): Promise<boolean> {
  const b = checkBranch(branch)
  return git(
    ['fetch', '--quiet', '--no-tags', resolve(repo), `+refs/heads/${b}:${workRef(b)}`],
    dir,
  )
    .then(() => true)
    .catch(() => false)
}

/** 거울에 이 커밋이 있나 */
export async function hasCommit(dir: string, sha: string): Promise<boolean> {
  if (!/^[0-9a-f]{4,64}$/.test(sha)) return false
  try {
    await git(['cat-file', '-e', `${sha}^{commit}`], dir)
    return true
  } catch (e) {
    if (e instanceof GitError) return false
    throw e
  }
}

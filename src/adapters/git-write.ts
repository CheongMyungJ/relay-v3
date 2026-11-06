// git 쓰기 (M3b 빚 기록, docs/m3-design.md 3절). git.ts는 읽기만 한다.
// commitFiles는 작업 트리를 건드리지 않고(임시 index와 commit-tree) 브랜치 끝에 파일을 더한 커밋 하나를 만들고, 브랜치를
// 그 끝에서만 옮긴다(update-ref의 옛 값: 그사이 세션이 커밋했으면 실패). 그 브랜치를 checkout한 worktree가 있으면 브랜치를
// 옮기기 전에 그 파일만 index와 작업 트리에 둔다(세션의 다른 변경은 그대로): 옮긴 뒤 세션의 커밋이 그 파일을 지우지 않고,
// index가 잠겼으면(세션의 git) 브랜치가 그대로인 채 던진다. 옮기지 못하면 둔 것을 되돌린다.

import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { git, GitError } from './exec.ts'

/** 커밋의 작성자·커미터 */
export interface GitIdent {
  name: string
  email: string
}

export interface CommitFilesInput {
  /** 브랜치 이름(refs/heads/ 뒤) */
  branch: string
  /** 브랜치가 지금 가리켜야 하는 커밋. 아니면 던진다 */
  expect: string
  /** 레포 루트 기준 경로(`/` 구분) → 내용(UTF-8) */
  files: Record<string, string>
  message: string
  author: GitIdent
  /** 이 브랜치를 checkout했을 수 있는 worktree. 그렇다면 더한 파일을 index와 작업 트리에 맞춘다 */
  worktree?: string
  /** 시험용: 브랜치를 옮긴 바로 뒤에 부른다 */
  onMoved?: () => Promise<void>
}

const validPath = (p: string) =>
  p !== '' && !p.startsWith('/') && !p.split('/').some((s) => s === '' || s === '.' || s === '..')

/** 파일을 더한 커밋 하나를 만들고 브랜치를 옮긴다. 새 커밋의 SHA */
export async function commitFiles(repo: string, o: CommitFilesInput): Promise<string> {
  const paths = Object.keys(o.files)
  if (paths.length === 0) throw new Error('커밋할 파일이 없음')
  for (const p of paths) if (!validPath(p)) throw new Error(`잘못된 경로: ${p}`)
  if (o.branch.startsWith('-')) throw new Error(`잘못된 브랜치: ${o.branch}`)
  const ref = `refs/heads/${o.branch}`
  const tip = (await git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], repo)).trim()
  if (tip !== o.expect) throw new Error(`브랜치 끝이 바뀜: ${o.branch}`)
  const dir = await mkdtemp(join(tmpdir(), 'relay-index-'))
  try {
    const env = { GIT_INDEX_FILE: join(dir, 'index') }
    await git(['read-tree', tip], repo, { env })
    const blobs = new Map<string, string>()
    for (const p of paths) {
      const blob = (await git(['hash-object', '-w', '--stdin'], repo, { input: o.files[p] })).trim()
      blobs.set(p, blob)
      await git(['update-index', '--add', '--cacheinfo', `100644,${blob},${p}`], repo, { env })
    }
    const tree = (await git(['write-tree'], repo, { env })).trim()
    const who = {
      GIT_AUTHOR_NAME: o.author.name,
      GIT_AUTHOR_EMAIL: o.author.email,
      GIT_COMMITTER_NAME: o.author.name,
      GIT_COMMITTER_EMAIL: o.author.email,
    }
    const args = ['commit-tree', tree, '-p', tip, '-F', '-']
    const sha = (await git(args, repo, { input: o.message, env: who })).trim()
    const wt = o.worktree !== undefined && (await checkedOut(o.worktree, ref)) ? o.worktree : null
    const created: string[] = []
    try {
      if (wt !== null) await placeFiles(wt, o.files, blobs, created)
      await git(['update-ref', '-m', 'relay: debt', ref, sha, tip], repo)
    } catch (e) {
      if (wt !== null) await unplace(wt, paths, created).catch(() => {})
      throw e
    }
    await o.onMoved?.()
    return sha
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** worktree가 그 브랜치를 checkout했나 */
async function checkedOut(worktree: string, ref: string): Promise<boolean> {
  const head = await git(['symbolic-ref', '--quiet', 'HEAD'], worktree).catch((e: unknown) => {
    if (e instanceof GitError && e.exit === 1) return ''
    throw e
  })
  return head.trim() === ref
}

/**
 * 파일을 worktree의 index(blob)와 작업 트리에 둔다. index를 먼저 고친다: 잠겼으면 아무것도 바꾸지 않고 던진다. 새로 만든
 * 작업 트리 파일의 경로는 created에 더한다(되돌릴 때 지운다)
 */
async function placeFiles(
  worktree: string,
  files: Record<string, string>,
  blobs: Map<string, string>,
  created: string[],
): Promise<void> {
  const paths = Object.keys(files)
  const info = paths.flatMap((p) => ['--cacheinfo', `100644,${blobs.get(p) ?? ''},${p}`])
  await git(['update-index', '--add', ...info], worktree)
  for (const p of paths) {
    const file = join(worktree, ...p.split('/'))
    if (!(await exists(file))) created.push(p)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, files[p] ?? '')
  }
}

/** placeFiles를 되돌린다: index는 지금 HEAD의 것으로, 새로 만든 파일은 HEAD에 없으면 지운다 */
async function unplace(worktree: string, paths: string[], created: string[]): Promise<void> {
  await git(['reset', '-q', '--', ...paths], worktree)
  const tracked = new Set(
    (await git(['ls-files', '-z', '--', ...created], worktree)).split('\0').filter(Boolean),
  )
  for (const p of created)
    if (!tracked.has(p)) await rm(join(worktree, ...p.split('/')), { force: true })
}

const exists = (file: string) =>
  stat(file).then(
    () => true,
    () => false,
  )

/** 브랜치를 remote의 같은 이름으로 push한다(빨리 감기만). 실패하면 던진다 */
export async function pushBranch(repo: string, branch: string, remote = 'origin'): Promise<void> {
  if (branch.startsWith('-') || remote.startsWith('-')) throw new Error(`잘못된 이름: ${branch}`)
  await git(['push', '--quiet', remote, `refs/heads/${branch}:refs/heads/${branch}`], repo)
}

// git 읽기 (docs/m1-modules.md adapters/git.ts).
// 레포를 바꾸지 않는다(containsTip의 merge-tree는 트리 객체만 쓴다). 사용자 설정(diff.noprefix, color.ui 등)에 흔들리지 않게 옵션을 못 박는다.

import { resolve } from 'node:path'
import { git, gitBytes, GitError } from './exec.ts'

/** '-'로 시작하는 ref는 git이 옵션으로 읽는다 */
function checkRef(ref: string): void {
  if (ref === '' || ref.startsWith('-')) throw new Error(`잘못된 ref: '${ref}'`)
}

/** cwd가 든 레포의 루트(이 플랫폼의 절대 경로) */
export async function repoRoot(cwd: string): Promise<string> {
  const out = await git(['rev-parse', '--show-toplevel'], cwd)
  return resolve(out.trim())
}

async function tryRevParse(repo: string, ref: string): Promise<string | null> {
  try {
    const out = await git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], repo)
    return out.trim() || null
  } catch (e) {
    if (e instanceof GitError && e.exit === 1) return null
    throw e
  }
}

/** ref의 커밋 SHA. 없으면 던진다 */
export async function revParse(repo: string, ref: string): Promise<string> {
  checkRef(ref)
  const sha = await tryRevParse(repo, ref)
  if (sha === null) throw new Error(`ref를 찾지 못함: ${ref}`)
  return sha
}

/** 두 ref의 공통 조상. 없으면 던진다 */
export async function mergeBase(repo: string, a: string, b: string): Promise<string> {
  checkRef(a)
  checkRef(b)
  try {
    return (await git(['merge-base', a, b], repo)).trim()
  } catch (e) {
    if (e instanceof GitError && e.exit === 1) {
      throw new Error(`공통 조상이 없음: ${a}, ${b}`, { cause: e })
    }
    throw e
  }
}

/**
 * head가 tip의 변경을 모두 담나(V22: 단위 브랜치가 Work 브랜치에 있나). tip이 head의 조상이거나, tip을 head에 합쳐도 head의
 * 트리가 그대로면(같은 변경을 옮겨 심은 커밋) 참. 합칠 수 없거나(충돌) git이 `merge-tree --write-tree`(2.38부터)를 모르면 거짓.
 * merge-tree는 합친 트리 객체만 쓰고 ref와 작업 트리는 바꾸지 않는다
 */
export async function containsTip(repo: string, head: string, tip: string): Promise<boolean> {
  checkRef(head)
  checkRef(tip)
  try {
    await git(['merge-base', '--is-ancestor', tip, head], repo)
    return true
  } catch (e) {
    if (!(e instanceof GitError && e.exit === 1)) throw e
  }
  try {
    const [tree] = (await git(['merge-tree', '--write-tree', head, tip], repo)).split('\n')
    return tree?.trim() === (await git(['rev-parse', `${head}^{tree}`], repo)).trim()
  } catch {
    return false
  }
}

const BASE_CANDIDATES: [name: string, ref: string][] = [
  ['origin/HEAD', 'refs/remotes/origin/HEAD'],
  ['origin/main', 'refs/remotes/origin/main'],
  ['main', 'refs/heads/main'],
  ['master', 'refs/heads/master'],
]

/** 기준 브랜치: origin/HEAD → origin/main → main → master 중 처음 있는 것의 이름 */
export async function defaultBase(repo: string): Promise<string> {
  for (const [name, ref] of BASE_CANDIDATES) {
    if ((await tryRevParse(repo, ref)) !== null) return name
  }
  throw new Error('기준 브랜치를 찾지 못함 (origin/HEAD, origin/main, main, master)')
}

// 사용자 설정이 출력 모양을 바꾸지 않게 한다 (core/diff.ts가 읽는 모양)
const DIFF_FIXED = ['--no-ext-diff', '--no-textconv', '--no-color', '--no-relative', '-M']

/** base..head의 git diff 세 가지 출력. core/diff.ts의 buildDiffFacts에 넘긴다 */
export async function diffRaw(
  repo: string,
  base: string,
  head: string,
): Promise<{ nameStatus: string; numstat: string; patch: string }> {
  checkRef(base)
  checkRef(head)
  const [nameStatus, numstat, patch] = await Promise.all([
    git(['diff', ...DIFF_FIXED, '--name-status', '-z', base, head, '--'], repo),
    git(['diff', ...DIFF_FIXED, '--numstat', '-z', base, head, '--'], repo),
    git(
      [
        'diff',
        ...DIFF_FIXED,
        '--unified=0',
        '--src-prefix=a/',
        '--dst-prefix=b/',
        base,
        head,
        '--',
      ],
      repo,
    ),
  ])
  return { nameStatus, numstat, patch }
}

/** 두 커밋 사이에 바뀐 파일(옮김은 지움과 새로 생김으로 본다). 기록 안 된 나빠짐(M3b)이 앞 기록과 기준을 견준다 */
export async function changedPaths(repo: string, a: string, b: string): Promise<string[]> {
  checkRef(a)
  checkRef(b)
  const out = await git(
    ['diff', ...DIFF_FIXED, '--name-only', '-z', '--no-renames', a, b, '--'],
    repo,
  )
  return splitNul(out)
}

/** sha의 파일 바이트. 파일이 없거나 파일이 아니면 null. sha가 없으면 던진다 */
async function blobBytes(repo: string, sha: string, path: string): Promise<Buffer | null> {
  checkRef(sha)
  try {
    return await gitBytes(['cat-file', 'blob', `${sha}:${path}`], repo)
  } catch (e) {
    if (!(e instanceof GitError)) throw e
    await revParse(repo, sha)
    return null
  }
}

/** sha의 파일 내용(UTF-8). 없으면 null */
export async function showFile(repo: string, sha: string, path: string): Promise<string | null> {
  const bytes = await blobBytes(repo, sha, path)
  return bytes === null ? null : bytes.toString('utf8')
}

function splitNul(out: string): string[] {
  return out.split('\0').filter((p) => p !== '')
}

/** sha의 모든 파일 경로(레포 루트 기준, `/` 구분) */
export async function lsTree(repo: string, sha: string): Promise<string[]> {
  checkRef(sha)
  return splitNul(await git(['ls-tree', '-r', '--name-only', '-z', '--full-tree', sha], repo))
}

/**
 * sha의 파일에 낱말 word가 있나(`git grep -w -F`, 바이너리와 exclude 아래는 뺀다). 지식 항목의 anchor가 코드에 있는지 본다
 * (V38). repo는 레포 루트다(경로 조각이 그 기준)
 */
export async function hasWord(
  repo: string,
  sha: string,
  word: string,
  exclude: string,
): Promise<boolean> {
  checkRef(sha)
  const args = ['grep', '-q', '-I', '-w', '-F', '-e', word, sha, '--', '.', `:(exclude)${exclude}`]
  try {
    await git(args, repo)
    return true
  } catch (e) {
    if (e instanceof GitError && e.exit === 1) return false
    throw e
  }
}

/** 파일 목록의 모든 조상 디렉터리. 루트('')는 넣지 않는다 */
export function dirsOf(files: string[]): Set<string> {
  const dirs = new Set<string>()
  for (const file of files) {
    let slash = file.lastIndexOf('/')
    while (slash > 0) {
      const dir = file.slice(0, slash)
      if (dirs.has(dir)) break
      dirs.add(dir)
      slash = dir.lastIndexOf('/')
    }
  }
  return dirs
}

/** git의 판단처럼 앞 8000바이트에 NUL이 있으면 바이너리 */
function isBinary(bytes: Buffer): boolean {
  return bytes.subarray(0, 8000).includes(0)
}

/** 줄 수: 줄바꿈 수, 마지막 줄에 줄바꿈이 없으면 하나 더. 빈 파일은 0 */
export function countLines(bytes: Buffer): number {
  let n = 0
  for (const b of bytes) if (b === 0x0a) n++
  if (bytes.length > 0 && bytes[bytes.length - 1] !== 0x0a) n++
  return n
}

const LINE_COUNT_PARALLEL = 8

/** sha에서 파일마다 줄 수. 없는 파일은 null, 바이너리 파일은 넣지 않는다 */
export async function lineCounts(
  repo: string,
  sha: string,
  paths: string[],
): Promise<Map<string, number | null>> {
  checkRef(sha)
  await revParse(repo, sha)
  const unique = [...new Set(paths)]
  const results = new Map<string, number | null | 'binary'>()
  let next = 0
  const worker = async () => {
    while (next < unique.length) {
      const path = unique[next++] as string
      const bytes = await blobBytes(repo, sha, path)
      results.set(path, bytes === null ? null : isBinary(bytes) ? 'binary' : countLines(bytes))
    }
  }
  await Promise.all(Array.from({ length: Math.min(LINE_COUNT_PARALLEL, unique.length) }, worker))
  const out = new Map<string, number | null>()
  for (const path of unique) {
    const v = results.get(path)
    if (v !== undefined && v !== 'binary') out.set(path, v)
  }
  return out
}

// ── 거울에서 읽기 (M4b, m4-design 4.3·4.4). 모두 읽기만 한다(merge-tree는 트리 객체만 쓴다) ──

/** logRange의 커밋 하나 */
export interface LogCommit {
  sha: string
  parents: string[]
  /** 작성자 이메일 */
  author: string
  tree: string
  /** 커미터 시각(유닉스 초) */
  time: number
  /** 메시지 전체 */
  body: string
}

/** ISO 때를 git이 그대로 읽는 `@<유닉스 초>`로(git의 날짜 읽기는 먼 해를 틀리게 읽는다). 읽지 못하면 던진다 */
function gitTime(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) throw new Error(`때를 읽지 못함: '${iso}'`)
  return `@${String(Math.floor(ms / 1000))}`
}

/** 필드 사이(US)와 커밋 사이(-z의 NUL) */
const LOG_FORMAT = '--format=%H%x1f%P%x1f%ae%x1f%T%x1f%ct%x1f%B'

/**
 * from..to의 커밋(새 것부터, `git log -z`). from이 없으면 to의 조상 전부. since·until은 커미터 시각(ISO), firstParent는
 * `--first-parent`, max는 `--max-count`, exclude는 그 ref들에서 닿는 커밋을 뺀다
 */
export async function logRange(
  repo: string,
  o: {
    from?: string
    to: string
    since?: string
    until?: string
    firstParent?: boolean
    max?: number
    /** 이 ref들에서 닿는 커밋은 뺀다(`^<ref>`) */
    exclude?: string[]
  },
): Promise<LogCommit[]> {
  checkRef(o.to)
  if (o.from !== undefined) checkRef(o.from)
  for (const ref of o.exclude ?? []) checkRef(ref)
  const args = ['log', '-z', LOG_FORMAT, '--no-color']
  if (o.firstParent) args.push('--first-parent')
  if (o.since) args.push(`--since=${gitTime(o.since)}`)
  if (o.until) args.push(`--until=${gitTime(o.until)}`)
  if (o.max !== undefined) args.push(`--max-count=${String(o.max)}`)
  args.push(o.from === undefined ? o.to : `${o.from}..${o.to}`)
  for (const ref of o.exclude ?? []) args.push(`^${ref}`)
  args.push('--')
  const out: LogCommit[] = []
  for (const record of splitNul(await git(args, repo))) {
    const [sha = '', parents = '', author = '', tree = '', time = '', ...body] =
      record.split('\x1f')
    out.push({
      sha: sha.trim(),
      parents: parents.split(' ').filter(Boolean),
      author,
      tree,
      time: Number(time),
      body: body.join('\x1f'),
    })
  }
  return out
}

/** a가 b의 조상인가(같으면 참). 객체가 없거나 다른 실패는 던진다 */
export async function isAncestor(repo: string, a: string, b: string): Promise<boolean> {
  checkRef(a)
  checkRef(b)
  try {
    await git(['merge-base', '--is-ancestor', a, b], repo)
    return true
  } catch (e) {
    if (e instanceof GitError && e.exit === 1) return false
    throw e
  }
}

/** a와 b를 합친 트리(`git merge-tree --write-tree`, git 2.38부터). 충돌하면 null. 다른 실패는 던진다 */
export async function mergeTree(repo: string, a: string, b: string): Promise<string | null> {
  checkRef(a)
  checkRef(b)
  try {
    const [tree] = (await git(['merge-tree', '--write-tree', a, b], repo)).split('\n')
    return tree?.trim() || null
  } catch (e) {
    if (e instanceof GitError && e.exit === 1) return null
    throw e
  }
}

/**
 * from..to 변경의 `git patch-id --stable`(같은 변경을 옮겨 심은 커밋은 같다). 바뀐 것이 없으면 null. blob이 없는 거울은
 * git이 그때 받는다
 */
export async function patchId(repo: string, from: string, to: string): Promise<string | null> {
  checkRef(from)
  checkRef(to)
  const diff = await git(
    ['diff', ...DIFF_FIXED, '--full-index', '--src-prefix=a/', '--dst-prefix=b/', from, to, '--'],
    repo,
  )
  if (diff.trim() === '') return null
  const out = await git(['patch-id', '--stable'], repo, { input: diff })
  return out.trim().split(/\s+/)[0] || null
}

/**
 * 있는 ref들의 커밋(M4e 세션 커밋 집합의 끝 모음). 없는 ref는 건너뛴다: 브랜치는 `refs/heads/<이름>`, 그 밖은 `git rev-parse
 * --verify`로 읽는다
 */
export async function refTips(repo: string, refs: readonly string[]): Promise<string[]> {
  const out = new Set<string>()
  for (const ref of refs) {
    checkRef(ref)
    const sha = await git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], repo).catch(
      () => '',
    )
    if (sha.trim()) out.add(sha.trim())
  }
  return [...out]
}

/**
 * tips에서 닿고 not에서 닿지 않는 커밋과 그 메시지, 커미터 시각(유닉스 초)(새 것부터). max개가 넘으면 null(끝 모음을 모른 채
 * 레포 이력 전부를 읽지 않게). tips가 비면 빈 것
 */
export async function newCommits(
  repo: string,
  o: { tips: readonly string[]; not: readonly string[]; max: number },
): Promise<{ sha: string; body: string; time: number }[] | null> {
  if (o.tips.length === 0) return []
  for (const ref of [...o.tips, ...o.not]) checkRef(ref)
  const args = [
    'log',
    '-z',
    '--format=%H%x1f%ct%x1f%B',
    '--no-color',
    `--max-count=${String(o.max + 1)}`,
  ]
  args.push(...o.tips, ...o.not.map((r) => `^${r}`), '--')
  const out = splitNul(await git(args, repo)).map((record) => {
    const [sha = '', time = '', ...body] = record.split('\x1f')
    return { sha: sha.trim(), body: body.join('\x1f'), time: Number(time) }
  })
  return out.length > o.max ? null : out
}

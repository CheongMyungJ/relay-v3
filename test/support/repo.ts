// 시험용 임시 git 레포와 임시 폴더. [어댑터]와 [흐름]이 함께 쓴다.
// 이 파일은 src/adapters에 기대지 않는다(어댑터를 시험할 때 같은 코드로 같은 코드를 확인하지 않게).
//
//   const repo = await makeRepo({ files: { 'a.txt': 'a\n' } })   // main에 첫 커밋
//   await repo.branch('feature')
//   const head = await repo.commit('바꿈', { 'a.txt': 'b\n', 'old.txt': null })
//   const fail = await nodeCommand('process.exit(1)')            // sh·cmd 모두에서 도는 가짜 명령
//   afterAll(cleanupAll)

import { execFile } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** 파일 이름 → 내용. null이면 지운다 */
export type Files = Record<string, string | Uint8Array | null>

export interface TestRepo {
  /** 레포 루트. 실제 경로(심볼릭 링크, Windows 짧은 이름을 푼 것) */
  dir: string
  /** 레포 기준 경로('/' 구분)를 절대 경로로 */
  path(rel: string): string
  /** 파일을 쓰거나(폴더를 만든다) 지운다. 커밋하지 않는다 */
  write(files: Files): Promise<void>
  read(rel: string): Promise<string>
  /** files를 쓰고(선택) 모두 add해서 커밋한다. 바뀐 것이 없어도 커밋한다. 새 SHA */
  commit(message: string, files?: Files): Promise<string>
  /** 새 브랜치를 만들어 옮겨 간다. from을 주면 거기서 */
  branch(name: string, from?: string): Promise<void>
  /** 브랜치나 SHA로 옮겨 간다 */
  checkout(ref: string): Promise<void>
  /** git 명령의 표준 출력(끝 공백 뺌). 실패하면 던진다 */
  git(...args: string[]): Promise<string>
  /** ref의 SHA. 기본 HEAD */
  sha(ref?: string): Promise<string>
  cleanup(): Promise<void>
}

export interface MakeRepoOptions {
  /** 주면 첫 커밋으로 넣는다 */
  files?: Files
  message?: string
  /** 처음 브랜치. 기본 main */
  branch?: string
}

const made = new Set<string>()

// 바깥(훅, 사용자 설정)이 시험 레포를 흔들지 않게 한다
const GIT_LOCATION_ENV = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']

function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  for (const name of GIT_LOCATION_ENV) env[name] = undefined
  return env
}

/** cwd에서 git을 돌린다. 실패하면 stderr를 담아 던진다 */
export function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, env: gitEnv(), maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) reject(new Error(`git ${args.join(' ')}: ${stderr || error.message}`))
        else resolve(stdout.trimEnd())
      },
    )
  })
}

/** 지워질 임시 폴더를 만든다(실제 경로). cleanupAll이나 removeDir로 지운다 */
export async function makeTempDir(prefix = 'relay-test-'): Promise<string> {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), prefix)))
  made.add(dir)
  return dir
}

/** 폴더를 지운다. Windows에서 잠깐 잠긴 파일은 몇 번 다시 해 본다 */
export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  made.delete(dir)
}

/** 이 파일에서 만든 임시 폴더(레포 포함)를 모두 지운다. afterAll에 건다 */
export async function cleanupAll(): Promise<void> {
  for (const dir of [...made]) await removeDir(dir)
}

/** 명령 글 속 인자 하나. sh와 cmd 모두에서 된다(값에 `"`, `$`, `%`, 역따옴표가 없을 때) */
export function shellArg(value: string): string {
  if (/["$`%]/.test(value)) throw new Error(`따옴표로 감쌀 수 없는 글자: ${value}`)
  return `"${value}"`
}

let scripts: string | null = null
let scriptCount = 0

/**
 * node 스크립트를 임시 파일(.cjs)로 쓰고, 그것을 돌리는 명령 글을 돌려준다.
 * `sh -c`와 `cmd /d /s /c` 모두에서 돌아 quality.json의 가짜 명령으로 쓴다.
 * 스크립트의 작업 폴더는 명령을 돌린 곳이다. args는 process.argv[2]부터 온다.
 */
export async function nodeCommand(code: string, ...args: string[]): Promise<string> {
  if (scripts === null || !existsSync(scripts)) scripts = await makeTempDir('relay-scripts-')
  const file = join(scripts, `s${++scriptCount}.cjs`)
  await writeFile(file, code)
  return [process.execPath, file, ...args].map(shellArg).join(' ')
}

/** 레포 기준 경로에 파일을 쓰거나 지운다 */
export async function writeFiles(root: string, files: Files): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, ...rel.split('/'))
    if (content === null) {
      await rm(full, { recursive: true, force: true })
    } else {
      await mkdir(dirname(full), { recursive: true })
      await writeFile(full, content)
    }
  }
}

/** 임시 git 레포를 만든다. 서명·훅·줄바꿈 바꾸기 같은 사용자 설정을 끈다 */
export async function makeRepo(opts: MakeRepoOptions = {}): Promise<TestRepo> {
  const dir = await makeTempDir('relay-repo-')
  const g = (...args: string[]) => runGit(dir, args)
  await g('init', '--quiet', '--initial-branch', opts.branch ?? 'main')
  const config: [string, string][] = [
    ['user.name', 'relay test'],
    ['user.email', 'test@relay.invalid'],
    ['commit.gpgsign', 'false'],
    ['tag.gpgsign', 'false'],
    ['core.autocrlf', 'false'],
    ['core.safecrlf', 'false'],
    // 전역 hooksPath를 막는다. 기본 자리를 절대 경로로 적는다
    ['core.hooksPath', join(dir, '.git', 'hooks')],
    ['init.defaultBranch', opts.branch ?? 'main'],
  ]
  for (const [key, value] of config) await g('config', key, value)

  const repo: TestRepo = {
    dir,
    path: (rel) => join(dir, ...rel.split('/')),
    write: (files) => writeFiles(dir, files),
    read: (rel) => readFile(join(dir, ...rel.split('/')), 'utf8'),
    async commit(message, files) {
      if (files) await writeFiles(dir, files)
      await g('add', '--all')
      await g('commit', '--quiet', '--allow-empty', '--no-verify', '-m', message)
      return g('rev-parse', 'HEAD')
    },
    async branch(name, from) {
      await g('checkout', '--quiet', '-b', name, ...(from === undefined ? [] : [from]))
    },
    async checkout(ref) {
      await g('checkout', '--quiet', ref)
    },
    git: g,
    sha: (ref = 'HEAD') => g('rev-parse', '--verify', `${ref}^{commit}`),
    cleanup: () => removeDir(dir),
  }
  if (opts.files) await repo.commit(opts.message ?? '처음', opts.files)
  return repo
}

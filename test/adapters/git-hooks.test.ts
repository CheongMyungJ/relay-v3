// [어댑터] 세션 커밋 트레일러의 심(M4e, docs/m4-design.md 7.2, src/adapters/git-hooks.ts와 engine/session-commits.ts의 심 글):
// 실제 git으로, 세션 환경(GIT_CONFIG_*)을 준 커밋에만 트레일러가 붙는다(-m, --no-verify, -F, 편집기, amend, merge). 빈 메시지는
// 그대로 그만둔다. 원래 훅(레포의 core.hooksPath, husky식 상대 경로)에 같은 인자와 표준 입력으로 넘기고 원래 훅이 실패하면
// 커밋도 실패한다. 다른 레포의 커밋에는 붙이지 않고 그 레포의 훅에 넘긴다. 심은 $RELAY_HOME/git-hooks에만 생기고 사용자 레포의
// 설정과 훅 파일은 그대로다. 원래 훅 자리를 찾지 못하면 사고를 적고 커밋을 그만둔다
import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { readdir, readFile, writeFile, chmod, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { gitCommonDir, gitVersionText, hooksDir, writeShims } from '../../src/adapters/git-hooks.ts'
import {
  GIT_HOOK_NAMES,
  shimFiles,
  trailerEnv,
  trailerGitOk,
  workTrailers,
} from '../../src/engine/session-commits.ts'
import { cleanupAll, makeRepo, makeTempDir, type TestRepo } from '../support/repo.ts'

afterAll(cleanupAll)

const WINDOWS = process.platform === 'win32'
const sh = (p: string) => (WINDOWS ? p.replace(/\\/g, '/') : p)

let home = ''
let shims = ''
let repo: TestRepo
let other: TestRepo
let env: NodeJS.ProcessEnv = {}
let hookLog = ''

/** 세션 환경으로 git을 돌린다. 실패하면 { code, stderr } */
function sessionGit(
  cwd: string,
  args: string[],
  extra: NodeJS.ProcessEnv = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, env: { ...process.env, ...env, ...extra }, windowsHide: true },
      (error, stdout, stderr) =>
        resolve({ code: error ? Number(error.code ?? 1) : 0, stdout, stderr }),
    )
  })
}

const body = (r: TestRepo, ref = 'HEAD') => r.git('log', '-1', '--format=%B', ref)

/** 레포 안의 실행 파일 하나를 쓴다 */
async function hook(r: TestRepo, rel: string, text: string): Promise<void> {
  const path = r.path(rel)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, `#!/bin/sh\n${text}\n`)
  await chmod(path, 0o755)
}

/** 사용자 레포의 설정과 훅 폴더(심이 바꾸면 안 되는 것) */
const userState = async (r: TestRepo) => ({
  config: await r.git('config', '--local', '--list'),
  hooks: (await readdir(r.path('.git/hooks')).catch(() => [])).sort(),
})

beforeAll(async () => {
  expect(trailerGitOk(await gitVersionText())).toBe(true)
  home = await makeTempDir('relay-home-')
  shims = await writeShims(home, shimFiles())
  repo = await makeRepo({ files: { 'a.txt': 'a\n' } })
  other = await makeRepo({ files: { 'o.txt': 'o\n' } })
  hookLog = join(home, 'hooks.log')
  env = {
    ...trailerEnv({
      inherited: {},
      shimDir: sh(shims),
      gitCommon: await gitCommonDir(repo.dir),
      hookLog: sh(hookLog),
    }),
    RELAY_WORK_ID: 'w1',
  }
})

beforeEach(async () => {
  await writeFile(hookLog, '')
})

describe('심 폴더', () => {
  test('$RELAY_HOME/git-hooks에 이름마다 실행 파일, 같은 글이면 그대로', async () => {
    expect(shims).toBe(hooksDir(home))
    expect((await readdir(shims)).sort()).toEqual([...GIT_HOOK_NAMES].sort())
    if (!WINDOWS) expect(statSync(join(shims, 'pre-commit')).mode & 0o111).toBe(0o111)
    const before = statSync(join(shims, 'pre-commit')).mtimeMs
    await writeShims(home, shimFiles())
    expect(statSync(join(shims, 'pre-commit')).mtimeMs).toBe(before)
  })

  test('gitCommonDir는 worktree에서도 레포의 공통 git 폴더', async () => {
    const wt = join(await makeTempDir('relay-wt-'), 'w')
    await repo.git('worktree', 'add', '--quiet', '-b', 'wt-branch', wt)
    expect(await gitCommonDir(wt)).toBe(await gitCommonDir(repo.dir))
    await repo.git('worktree', 'remove', '--force', wt)
  })
})

describe('트레일러', () => {
  test('-m, --no-verify, -F, amend: 한 번만 붙는다. 사용자 레포의 설정과 훅은 그대로', async () => {
    const before = await userState(repo)
    await repo.write({ 'a.txt': 'b\n' })
    await repo.git('add', '-A')
    expect((await sessionGit(repo.dir, ['commit', '-q', '-m', 'one'])).code).toBe(0)
    expect(await body(repo)).toBe('one\n\nRelay-Work: w1')
    expect(
      (await sessionGit(repo.dir, ['commit', '-q', '--allow-empty', '--no-verify', '-m', 'two']))
        .code,
    ).toBe(0)
    expect(workTrailers(await body(repo))).toEqual(['w1'])
    const msg = join(await makeTempDir(), 'msg.txt')
    await writeFile(msg, 'three\n\nbody line\n')
    expect((await sessionGit(repo.dir, ['commit', '-q', '--allow-empty', '-F', msg])).code).toBe(0)
    expect(await body(repo)).toBe('three\n\nbody line\n\nRelay-Work: w1')
    expect(
      (await sessionGit(repo.dir, ['commit', '-q', '--allow-empty', '--amend', '--no-edit'])).code,
    ).toBe(0)
    expect(workTrailers(await body(repo))).toEqual(['w1'])
    expect(await userState(repo)).toEqual(before)
    // 세션 환경이 없는 커밋(사람의 셸)에는 붙지 않는다
    expect(workTrailers(await body(repo, await repo.commit('human')))).toEqual([])
    expect(await readFile(hookLog, 'utf8')).toBe('')
  })

  test('편집기로 쓴 메시지는 commit-msg에서 붙는다. 빈 메시지는 git이 그대로 그만둔다', async () => {
    const editor = join(await makeTempDir(), 'editor.sh')
    await writeFile(editor, '#!/bin/sh\nprintf "edited\\n" > "$1"\n')
    await chmod(editor, 0o755)
    const ok = await sessionGit(repo.dir, ['commit', '-q', '--allow-empty'], {
      GIT_EDITOR: sh(editor),
    })
    expect(ok.code).toBe(0)
    expect(await body(repo)).toBe('edited\n\nRelay-Work: w1')
    const head = await repo.sha()
    const empty = await sessionGit(repo.dir, ['commit', '-q', '--allow-empty'], {
      GIT_EDITOR: 'true',
    })
    expect(empty.code).not.toBe(0)
    expect(await repo.sha()).toBe(head)
  })

  test('merge 커밋에도 붙는다', async () => {
    const main = await repo.git('branch', '--show-current')
    await repo.branch('side')
    await repo.commit('side', { 's.txt': 's\n' })
    await repo.checkout(main)
    await repo.commit('main', { 'm.txt': 'm\n' })
    expect((await sessionGit(repo.dir, ['merge', '-q', '--no-edit', 'side'])).code).toBe(0)
    expect(workTrailers(await body(repo))).toEqual(['w1'])
  })

  test('다른 레포(세션이 시험에서 만든 레포)의 커밋에는 붙이지 않고 그 레포의 훅에 넘긴다', async () => {
    await hook(
      other,
      '.git/hooks/post-commit',
      'echo ran > "$(git rev-parse --git-dir)/post-commit-ran"',
    )
    expect((await sessionGit(other.dir, ['commit', '-q', '--allow-empty', '-m', 'x'])).code).toBe(0)
    expect(workTrailers(await body(other))).toEqual([])
    expect(existsSync(other.path('.git/post-commit-ran'))).toBe(true)
  })
})

describe('원래 훅에 넘김', () => {
  test('pre-commit·prepare-commit-msg는 같은 인자로 돌고, 실패하면 커밋도 실패한다', async () => {
    await hook(repo, '.git/hooks/pre-commit', 'echo "pre $#" >> "$(git rev-parse --git-dir)/ran"')
    await hook(
      repo,
      '.git/hooks/prepare-commit-msg',
      'echo "prepare $2" >> "$(git rev-parse --git-dir)/ran"\nprintf "\\nfrom hook\\n" >> "$1"',
    )
    expect(
      (await sessionGit(repo.dir, ['commit', '-q', '--allow-empty', '-m', 'delegated'])).code,
    ).toBe(0)
    expect(await repo.read('.git/ran')).toBe('pre 0\nprepare message\n')
    expect(await body(repo)).toBe('delegated\n\nfrom hook\n\nRelay-Work: w1')
    const head = await repo.sha()
    await hook(repo, '.git/hooks/pre-commit', 'echo "막음" >&2\nexit 3')
    const r = await sessionGit(repo.dir, ['commit', '-q', '--allow-empty', '-m', 'refused'])
    expect(r.code).not.toBe(0)
    expect(r.stderr).toContain('막음')
    expect(await repo.sha()).toBe(head)
    // --no-verify는 원래 pre-commit을 건너뛴다(git 그대로). 트레일러는 붙는다
    expect(
      (await sessionGit(repo.dir, ['commit', '-q', '--allow-empty', '--no-verify', '-m', 'nv']))
        .code,
    ).toBe(0)
    expect(workTrailers(await body(repo))).toEqual(['w1'])
    await writeFile(repo.path('.git/hooks/pre-commit'), '#!/bin/sh\nexit 0\n')
  })

  test('표준 입력을 받는 훅(reference-transaction)에 그대로 넘긴다', async () => {
    await hook(
      repo,
      '.git/hooks/reference-transaction',
      'cat >> "$(git rev-parse --git-dir)/refs-seen"',
    )
    expect(
      (await sessionGit(repo.dir, ['commit', '-q', '--allow-empty', '-m', 'stdin'])).code,
    ).toBe(0)
    expect(await repo.read('.git/refs-seen')).toContain(await repo.sha())
    await writeFile(repo.path('.git/hooks/reference-transaction'), '#!/bin/sh\ncat > /dev/null\n')
  })

  test('husky식 상대 core.hooksPath의 훅에 넘긴다(레포 설정은 사람이 둔 그대로)', async () => {
    const r = await makeRepo({ files: { 'a.txt': 'a\n' } })
    await r.git('config', 'core.hooksPath', '.husky/_')
    await hook(r, '.husky/_/pre-commit', 'echo husky > .husky-ran')
    const common = await gitCommonDir(r.dir)
    const e = {
      ...trailerEnv({ inherited: {}, shimDir: sh(shims), gitCommon: common, hookLog: sh(hookLog) }),
      RELAY_WORK_ID: 'w9',
    }
    const res = await sessionGit(r.dir, ['commit', '-q', '--allow-empty', '-m', 'h'], e)
    expect(res.code).toBe(0)
    expect(await r.read('.husky-ran')).toBe('husky\n')
    expect(workTrailers(await body(r))).toEqual(['w9'])
    expect(await r.git('config', '--local', 'core.hooksPath')).toBe('.husky/_')
  })

  test('relay 세션 안에서 띄운 세션(겹친 세션 환경): 끝없이 돌지 않고 레포의 훅에 넘기며 안쪽 트레일러만 붙는다', async () => {
    const r = await makeRepo({ files: { 'a.txt': 'a\n' } })
    await hook(r, '.git/hooks/pre-commit', 'echo pre >> "$(git rev-parse --git-dir)/ran"')
    // 바깥 세션(다른 RELAY_HOME, 다른 레포)의 환경을 물려받은 앱이 안쪽 세션의 환경을 만든다
    const outerHome = await makeTempDir('relay-home-outer-')
    const outerShims = await writeShims(outerHome, shimFiles())
    const outerEnv = trailerEnv({
      inherited: process.env,
      shimDir: sh(outerShims),
      gitCommon: await gitCommonDir(other.dir),
      hookLog: sh(join(outerHome, 'hooks.log')),
    })
    const outer = { ...outerEnv, RELAY_WORK_ID: 'outer' }
    const innerEnv = trailerEnv({
      inherited: { ...process.env, ...outer },
      shimDir: sh(shims),
      gitCommon: await gitCommonDir(r.dir),
      hookLog: sh(hookLog),
    })
    const inner = { ...innerEnv, RELAY_WORK_ID: 'inner' }
    const res = await new Promise<number>((resolve) => {
      execFile(
        'git',
        ['commit', '-q', '--allow-empty', '-m', 'nested'],
        {
          cwd: r.dir,
          env: { ...process.env, ...outer, ...inner },
          timeout: 15_000,
          windowsHide: true,
        },
        (error) => resolve(error ? Number(error.code ?? 1) || 1 : 0),
      )
    })
    expect(res).toBe(0)
    expect(innerEnv['GIT_CONFIG_COUNT']).toBe(outerEnv['GIT_CONFIG_COUNT'])
    expect(await r.read('.git/ran')).toBe('pre\n')
    expect(workTrailers(await body(r))).toEqual(['inner'])
    expect(await readFile(hookLog, 'utf8')).toBe('')
  }, 30_000)

  test('원래 훅 자리를 찾지 못하면(심 폴더를 가리킴) 사고를 적고 커밋을 그만둔다', async () => {
    const head = await repo.sha()
    // 앞 설정의 수를 하나 많게 주면 원래 자리를 찾는 git도 심 폴더를 본다
    const r = await sessionGit(repo.dir, ['commit', '-q', '--allow-empty', '-m', 'loop'], {
      RELAY_GIT_CONFIG_BASE: '1',
    })
    expect(r.code).not.toBe(0)
    expect(await repo.sha()).toBe(head)
    expect(await readFile(hookLog, 'utf8')).toContain('pre-commit: 원래 훅 자리를 찾지 못함')
  })
})

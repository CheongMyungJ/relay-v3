import { chmod, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { lockWorktrees, overlay, prepareCheckout } from '../../src/adapters/worktrees.ts'
import type { SetupSpec } from '../../src/core/types.ts'
import {
  cleanupAll,
  makeRepo,
  makeTempDir,
  nodeCommand,
  runGit,
  type TestRepo,
} from '../support/repo.ts'

const KEY = 'proj-0123456789ab'

afterAll(cleanupAll)

/** 돌 때마다 counter에 한 줄을 더하고 node_modules/.installed를 만드는 setup */
async function countingSetup(counter: string, extra: Partial<SetupSpec> = {}): Promise<SetupSpec> {
  const run = await nodeCommand(
    `const fs = require('fs')
fs.appendFileSync(process.argv[2], 'ran\\n')
fs.mkdirSync('node_modules', { recursive: true })
fs.writeFileSync('node_modules/.installed', 'yes')`,
    counter,
  )
  return { run, inputs: ['package-lock.json'], keep: ['node_modules'], ...extra }
}

async function runs(counter: string): Promise<number> {
  if (!existsSync(counter)) return 0
  return (await readFile(counter, 'utf8')).split('\n').filter(Boolean).length
}

const read = (dir: string, rel: string) => readFile(join(dir, rel), 'utf8')

describe('prepareCheckout', () => {
  let repo: TestRepo
  let c1: string
  let c2: string
  let c3: string
  let home: string

  beforeAll(async () => {
    repo = await makeRepo({
      files: {
        'package-lock.json': '{"v":1}\n',
        'src/a.ts': 'a1\n',
        '.gitignore': 'ignored.log\nnode_modules/\n',
      },
    })
    c1 = await repo.sha()
    c2 = await repo.commit('둘', { 'src/a.ts': 'a2\n', 'src/b.ts': 'b\n' })
    c3 = await repo.commit('잠금 파일', { 'package-lock.json': '{"v":2}\n' })
  })

  beforeEach(async () => {
    home = await makeTempDir('relay-wt-home-')
  })

  test('처음이면 worktree를 만들어 그 SHA를 떼어 낸 HEAD로 꺼낸다', async () => {
    const r = await prepareCheckout(home, KEY, repo.dir, 'head', c2)
    expect(r).toEqual({ dir: join(home, 'worktrees', KEY, 'head'), setupRan: false })
    expect(await read(r.dir, 'src/a.ts')).toBe('a2\n')
    expect(await runGit(r.dir, ['rev-parse', 'HEAD'])).toBe(c2)
    await expect(runGit(r.dir, ['symbolic-ref', '-q', 'HEAD'])).rejects.toThrow()
    expect(await repo.git('worktree', 'list', '--porcelain')).toContain(r.dir.replace(/\\/g, '/'))
    // 레포 자신의 체크아웃은 그대로다
    expect(await repo.git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('main')
  })

  test('다시 부르면 같은 폴더를 새 SHA로 바꾸고 바뀐 것·추적 안 된 것·무시된 것을 지운다', async () => {
    const first = await prepareCheckout(home, KEY, repo.dir, 'head', c2)
    await writeFile(join(first.dir, 'src/a.ts'), '고침\n')
    await writeFile(join(first.dir, 'untracked.txt'), 'u')
    await writeFile(join(first.dir, 'ignored.log'), 'i')
    await mkdir(join(first.dir, 'nested/inner'), { recursive: true })
    await runGit(join(first.dir, 'nested/inner'), ['init', '--quiet'])

    const second = await prepareCheckout(home, KEY, repo.dir, 'head', c1)
    expect(second.dir).toBe(first.dir)
    expect(await read(second.dir, 'src/a.ts')).toBe('a1\n')
    for (const gone of ['src/b.ts', 'untracked.txt', 'ignored.log', 'nested']) {
      expect(existsSync(join(second.dir, gone))).toBe(false)
    }
    expect(await runGit(second.dir, ['rev-parse', 'HEAD'])).toBe(c1)
    // 새로 만들지 않고 다시 썼다: 이 home 아래 worktree는 하나다
    const list = await repo.git('worktree', 'list', '--porcelain')
    const mine = list
      .split('\n')
      .filter((l) => l.startsWith(`worktree ${home.replace(/\\/g, '/')}`))
    expect(mine).toEqual([`worktree ${second.dir.replace(/\\/g, '/')}`])
  })

  test('setup.keep에 있는 것은 지우지 않는다', async () => {
    const setup: SetupSpec = { run: 'exit 0', inputs: [], keep: ['node_modules'] }
    const first = await prepareCheckout(home, KEY, repo.dir, 'head', c1, setup)
    await mkdir(join(first.dir, 'node_modules/pkg'), { recursive: true })
    await writeFile(join(first.dir, 'node_modules/pkg/index.js'), 'x')
    await mkdir(join(first.dir, 'dist'), { recursive: true })
    await writeFile(join(first.dir, 'dist/out.js'), 'x')

    await prepareCheckout(home, KEY, repo.dir, 'head', c2, setup)
    expect(await read(first.dir, 'node_modules/pkg/index.js')).toBe('x')
    expect(existsSync(join(first.dir, 'dist'))).toBe(false)
  })

  test('base와 head는 서로 다른 폴더에 함께 있다', async () => {
    const base = await prepareCheckout(home, KEY, repo.dir, 'base', c1)
    const head = await prepareCheckout(home, KEY, repo.dir, 'head', c2)
    expect(base.dir).not.toBe(head.dir)
    expect(await read(base.dir, 'src/a.ts')).toBe('a1\n')
    expect(await read(head.dir, 'src/a.ts')).toBe('a2\n')
  })

  test('setup은 처음에 돌고, inputs 내용이 같으면 다시 돌지 않는다', async () => {
    const counter = join(home, 'count.txt')
    const setup = await countingSetup(counter)
    const a = await prepareCheckout(home, KEY, repo.dir, 'head', c1, setup)
    expect(a).toMatchObject({ setupRan: true })
    expect(a.setupError).toBeUndefined()
    expect(await read(a.dir, 'node_modules/.installed')).toBe('yes')

    // c2는 package-lock.json이 c1과 같다
    const b = await prepareCheckout(home, KEY, repo.dir, 'head', c2, setup)
    expect(b.setupRan).toBe(false)
    expect(await runs(counter)).toBe(1)
    expect(await read(b.dir, 'node_modules/.installed')).toBe('yes')
  })

  test('inputs 내용이 바뀌면 setup을 다시 돈다', async () => {
    const counter = join(home, 'count.txt')
    const setup = await countingSetup(counter)
    await prepareCheckout(home, KEY, repo.dir, 'head', c2, setup)
    expect((await prepareCheckout(home, KEY, repo.dir, 'head', c3, setup)).setupRan).toBe(true)
    expect((await prepareCheckout(home, KEY, repo.dir, 'head', c3, setup)).setupRan).toBe(false)
    expect((await prepareCheckout(home, KEY, repo.dir, 'head', c1, setup)).setupRan).toBe(true)
    expect(await runs(counter)).toBe(3)
  })

  test('setup.run이나 keep이 바뀌어도 다시 돈다', async () => {
    const counter = join(home, 'count.txt')
    const setup = await countingSetup(counter)
    await prepareCheckout(home, KEY, repo.dir, 'head', c1, setup)
    const changedRun = { ...setup, run: `${setup.run} --again` }
    expect((await prepareCheckout(home, KEY, repo.dir, 'head', c1, changedRun)).setupRan).toBe(true)
    const changedKeep = { ...changedRun, keep: ['node_modules', '.venv'] }
    expect((await prepareCheckout(home, KEY, repo.dir, 'head', c1, changedKeep)).setupRan).toBe(
      true,
    )
    expect(await runs(counter)).toBe(3)
  })

  test('base와 head의 setup 기록은 따로다', async () => {
    const counter = join(home, 'count.txt')
    const setup = await countingSetup(counter)
    expect((await prepareCheckout(home, KEY, repo.dir, 'head', c1, setup)).setupRan).toBe(true)
    expect((await prepareCheckout(home, KEY, repo.dir, 'base', c1, setup)).setupRan).toBe(true)
    expect((await prepareCheckout(home, KEY, repo.dir, 'base', c2, setup)).setupRan).toBe(false)
  })

  test('setup 없이 한 번 비운 뒤에는 setup을 다시 돈다', async () => {
    const counter = join(home, 'count.txt')
    const setup = await countingSetup(counter)
    await prepareCheckout(home, KEY, repo.dir, 'head', c1, setup)
    const bare = await prepareCheckout(home, KEY, repo.dir, 'head', c1)
    expect(existsSync(join(bare.dir, 'node_modules'))).toBe(false)
    const again = await prepareCheckout(home, KEY, repo.dir, 'head', c1, setup)
    expect(again.setupRan).toBe(true)
    expect(await read(again.dir, 'node_modules/.installed')).toBe('yes')
  })

  test('없는 inputs 파일도 해시에 들어가고, 생기면 다시 돈다', async () => {
    const counter = join(home, 'count.txt')
    const setup = await countingSetup(counter, { inputs: ['src/b.ts', '../outside.txt'] })
    expect((await prepareCheckout(home, KEY, repo.dir, 'head', c1, setup)).setupRan).toBe(true)
    expect((await prepareCheckout(home, KEY, repo.dir, 'head', c1, setup)).setupRan).toBe(false)
    expect((await prepareCheckout(home, KEY, repo.dir, 'head', c2, setup)).setupRan).toBe(true)
  })

  test('setup이 실패하면 setupError에 까닭을 적고 다음에 다시 돈다', async () => {
    const fail = await nodeCommand(
      `process.stdout.write('설치 중\\n'); process.stderr.write('npm 오류: 망가짐\\n'); process.exit(2)`,
    )
    const setup: SetupSpec = { run: fail, inputs: ['package-lock.json'], keep: [] }
    const a = await prepareCheckout(home, KEY, repo.dir, 'head', c1, setup)
    expect(a.setupRan).toBe(true)
    expect(a.setupError).toContain('setup 실패 (종료 코드 2)')
    expect(a.setupError).toContain('npm 오류: 망가짐')
    const b = await prepareCheckout(home, KEY, repo.dir, 'head', c1, setup)
    expect(b.setupRan).toBe(true)

    // 고친 setup은 성공하고 기록된다
    const counter = join(home, 'count.txt')
    const fixed = await countingSetup(counter)
    expect((await prepareCheckout(home, KEY, repo.dir, 'head', c1, fixed)).setupError).toBe(
      undefined,
    )
    expect((await prepareCheckout(home, KEY, repo.dir, 'head', c1, fixed)).setupRan).toBe(false)
  })

  test('setup 시간이 넘으면 setupError에 시간 초과를 적는다', async () => {
    const slow = await nodeCommand(`setTimeout(() => {}, 30000)`)
    const setup: SetupSpec = { run: slow, inputs: [], keep: [], timeout_sec: 0.5 }
    const r = await prepareCheckout(home, KEY, repo.dir, 'head', c1, setup)
    expect(r.setupRan).toBe(true)
    expect(r.setupError).toBe('setup 시간 초과 (0.5초)')
  })

  test('worktree 폴더가 지워졌으면 다시 만들고 setup도 다시 돈다', async () => {
    const counter = join(home, 'count.txt')
    const setup = await countingSetup(counter)
    const first = await prepareCheckout(home, KEY, repo.dir, 'head', c1, setup)
    await rm(first.dir, { recursive: true, force: true })
    const again = await prepareCheckout(home, KEY, repo.dir, 'head', c2, setup)
    expect(again).toEqual({ dir: first.dir, setupRan: true })
    expect(await read(again.dir, 'src/a.ts')).toBe('a2\n')
    expect(await runs(counter)).toBe(2)
  })

  test('폴더 자리에 worktree가 아닌 것이 있으면 지우고 새로 만든다', async () => {
    const dir = join(home, 'worktrees', KEY, 'base')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'junk.txt'), 'junk')
    const r = await prepareCheckout(home, KEY, repo.dir, 'base', c1)
    expect(r.dir).toBe(dir)
    expect(existsSync(join(dir, 'junk.txt'))).toBe(false)
    expect(await read(dir, 'src/a.ts')).toBe('a1\n')
  })

  test('다른 레포의 worktree가 그 자리에 있으면 이 레포 것으로 바꾼다', async () => {
    const other = await makeRepo({ files: { 'other.txt': 'o\n' } })
    const dir = join(home, 'worktrees', KEY, 'head')
    await prepareCheckout(home, KEY, other.dir, 'head', await other.sha())
    expect(existsSync(join(dir, 'other.txt'))).toBe(true)
    await prepareCheckout(home, KEY, repo.dir, 'head', c1)
    expect(existsSync(join(dir, 'other.txt'))).toBe(false)
    expect(await read(dir, 'src/a.ts')).toBe('a1\n')
  })

  test('keep이 비면 setup 결과물을 clean이 지우므로 setup을 늘 다시 돈다', async () => {
    const counter = join(home, 'count.txt')
    const setup = await countingSetup(counter, { keep: [] })
    await prepareCheckout(home, KEY, repo.dir, 'head', c1, setup)
    const b = await prepareCheckout(home, KEY, repo.dir, 'head', c2, setup)
    expect(b.setupRan).toBe(true)
    expect(await read(b.dir, 'node_modules/.installed')).toBe('yes')
    expect(await runs(counter)).toBe(2)
  })

  test('setup이 keep 밖에도 결과물을 만들면 다음에도 다시 돈다', async () => {
    const counter = join(home, 'count.txt')
    const run = await nodeCommand(
      `const fs = require('fs')
fs.appendFileSync(process.argv[2], 'ran\\n')
fs.mkdirSync('deps', { recursive: true })
fs.writeFileSync('deps/x', 'ok')
fs.writeFileSync('generated.txt', 'gen')`,
      counter,
    )
    const setup: SetupSpec = { run, inputs: ['package-lock.json'], keep: ['deps'] }
    await prepareCheckout(home, KEY, repo.dir, 'head', c1, setup)
    const b = await prepareCheckout(home, KEY, repo.dir, 'head', c2, setup)
    expect(b.setupRan).toBe(true)
    expect(await read(b.dir, 'generated.txt')).toBe('gen')
    expect(await read(b.dir, 'deps/x')).toBe('ok')
  })

  test('keep 경로가 사라졌으면 해시가 같아도 setup을 다시 돈다', async () => {
    const counter = join(home, 'count.txt')
    const setup = await countingSetup(counter)
    const a = await prepareCheckout(home, KEY, repo.dir, 'head', c1, setup)
    await rm(join(a.dir, 'node_modules'), { recursive: true, force: true })
    const b = await prepareCheckout(home, KEY, repo.dir, 'head', c2, setup)
    expect(b.setupRan).toBe(true)
    expect(await read(b.dir, 'node_modules/.installed')).toBe('yes')
  })

  test("keep의 '/' 없는 이름은 아래 폴더의 같은 이름도 남긴다(git clean -e처럼)", async () => {
    const counter = join(home, 'count.txt')
    const run = await nodeCommand(
      `const fs = require('fs')
fs.appendFileSync(process.argv[2], 'ran\\n')
fs.mkdirSync('pkg/node_modules', { recursive: true })
fs.writeFileSync('pkg/node_modules/x', 'ok')`,
      counter,
    )
    const setup: SetupSpec = { run, inputs: ['package-lock.json'], keep: ['node_modules'] }
    await prepareCheckout(home, KEY, repo.dir, 'head', c1, setup)
    const b = await prepareCheckout(home, KEY, repo.dir, 'head', c2, setup)
    expect(b.setupRan).toBe(false)
    expect(await read(b.dir, 'pkg/node_modules/x')).toBe('ok')
  })

  test('지난 git이 남긴 index.lock이 있어도 새로 만들어 이어 간다', async () => {
    const first = await prepareCheckout(home, KEY, repo.dir, 'head', c1)
    const gitDir = await runGit(first.dir, ['rev-parse', '--absolute-git-dir'])
    await writeFile(join(gitDir, 'index.lock'), '')
    const again = await prepareCheckout(home, KEY, repo.dir, 'head', c2)
    expect(await read(again.dir, 'src/a.ts')).toBe('a2\n')
    expect(await runGit(again.dir, ['rev-parse', 'HEAD'])).toBe(c2)
  })

  test('사용자의 다른 worktree는 폴더가 잠시 없어도 지우지 않는다(prune 안 함)', async () => {
    const other = await makeRepo({ files: { 'a.txt': 'a\n' } })
    const place = join(await makeTempDir('relay-user-wt-'), 'feature')
    await other.git('worktree', 'add', '--quiet', '-b', 'feature', place)
    const away = `${place}-away`
    await rename(place, away)
    await prepareCheckout(home, KEY, other.dir, 'head', await other.sha())
    await rename(away, place)
    expect(await other.git('worktree', 'list', '--porcelain')).toContain(
      'branch refs/heads/feature',
    )
    expect(await runGit(place, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('feature')
  })

  test('없는 SHA면 던진다', async () => {
    const missing = '0123456789abcdef0123456789abcdef01234567'
    await expect(prepareCheckout(home, KEY, repo.dir, 'head', missing)).rejects.toThrow()
    await prepareCheckout(home, KEY, repo.dir, 'head', c1)
    await expect(prepareCheckout(home, KEY, repo.dir, 'head', missing)).rejects.toThrow()
  })

  test('잘못된 slot, 키, SHA는 git을 부르기 전에 던진다', async () => {
    await expect(prepareCheckout(home, KEY, repo.dir, 'other' as 'head', c1)).rejects.toThrow(
      '잘못된 slot',
    )
    await expect(prepareCheckout(home, '../x', repo.dir, 'head', c1)).rejects.toThrow(
      '잘못된 레포 키',
    )
    await expect(prepareCheckout(home, KEY, repo.dir, 'head', '--orphan')).rejects.toThrow(
      '잘못된 SHA',
    )
    expect(existsSync(join(home, 'worktrees', KEY))).toBe(false)
  })
})

describe('훅', () => {
  test('overlay(파일 체크아웃)에서도 post-checkout 훅을 돌리지 않는다', async () => {
    const repo = await makeRepo({ files: { 'a.test.js': '1\n' } })
    const c1 = await repo.sha()
    const c2 = await repo.commit('둘', { 'a.test.js': '2\n' })
    const home = await makeTempDir('relay-wt-hook-')
    const marker = join(home, 'hook-ran').replace(/\\/g, '/')
    const { dir } = await prepareCheckout(home, KEY, repo.dir, 'base', c1)
    const hook = repo.path('.git/hooks/post-checkout')
    await writeFile(hook, `#!/bin/sh\necho "flag=$3" >> "${marker}"\n`)
    await chmod(hook, 0o755)
    await overlay(home, dir, repo.dir, c2, ['a.test.js'])
    expect(await read(dir, 'a.test.js')).toBe('2\n')
    expect(existsSync(marker)).toBe(false)
  })

  test('레포의 post-checkout 훅을 check worktree에서 돌리지 않는다', async () => {
    const repo = await makeRepo({ files: { 'a.txt': '1\n' } })
    const c1 = await repo.sha()
    const c2 = await repo.commit('둘', { 'a.txt': '2\n' })
    const home = await makeTempDir('relay-wt-hook-')
    const marker = join(home, 'hook-ran').replace(/\\/g, '/')
    const hook = repo.path('.git/hooks/post-checkout')
    await writeFile(hook, `#!/bin/sh\necho ran >> "${marker}"\n`)
    await chmod(hook, 0o755)
    // 훅이 실제로 도는 레포인지 먼저 본다
    await repo.checkout(c1)
    await repo.checkout('main')
    expect(existsSync(marker)).toBe(true)
    await rm(marker)

    await prepareCheckout(home, KEY, repo.dir, 'head', c1)
    await prepareCheckout(home, KEY, repo.dir, 'head', c2)
    expect(existsSync(marker)).toBe(false)
  })
})

describe('lockWorktrees', () => {
  test('잡은 동안 다른 check는 기다리다가 시간이 넘으면 던진다', async () => {
    const home = await makeTempDir('relay-lock-')
    const release = await lockWorktrees(home, KEY, 0)
    await expect(lockWorktrees(home, KEY, 100, 20)).rejects.toThrow(
      `다른 check가 worktree를 쓰는 중 (pid ${process.pid})`,
    )
    await release()
    const again = await lockWorktrees(home, KEY, 0)
    await again()
  })

  test('풀리기를 기다렸다가 잡는다', async () => {
    const home = await makeTempDir('relay-lock-')
    const release = await lockWorktrees(home, KEY, 0)
    setTimeout(() => void release(), 100)
    const second = await lockWorktrees(home, KEY, 5_000, 20)
    await second()
  })

  test('잡은 프로세스가 죽었으면 넘겨받는다', async () => {
    const home = await makeTempDir('relay-lock-')
    await mkdir(join(home, 'worktrees', KEY), { recursive: true })
    await writeFile(join(home, 'worktrees', KEY, '.lock'), '2147483646 dead\n')
    const release = await lockWorktrees(home, KEY, 0)
    await release()
    expect(existsSync(join(home, 'worktrees', KEY, '.lock'))).toBe(false)
  })

  test('다른 잠금으로 바뀐 뒤에는 옛 해제가 새 잠금을 지우지 않는다', async () => {
    const home = await makeTempDir('relay-lock-')
    const release = await lockWorktrees(home, KEY, 0)
    const path = join(home, 'worktrees', KEY, '.lock')
    await writeFile(path, `${process.pid} other\n`)
    await release()
    expect(await readFile(path, 'utf8')).toBe(`${process.pid} other\n`)
  })

  test('잘못된 키는 던진다', async () => {
    const home = await makeTempDir('relay-lock-')
    await expect(lockWorktrees(home, '../x', 0)).rejects.toThrow('잘못된 레포 키')
  })
})

describe('overlay', () => {
  let repo: TestRepo
  let base: string
  let head: string
  let home: string

  beforeAll(async () => {
    repo = await makeRepo({
      files: {
        'src/a.ts': 'base src\n',
        'test/a.test.ts': 'base a\n',
        'test/del.test.ts': 'base del\n',
        'test/x.test.ts': 'base x\n',
        '.relay/examples/w1.json': '{"base":1}\n',
        '.relay/examples/old.json': '{}\n',
      },
    })
    base = await repo.sha()
    head = await repo.commit('head', {
      'src/a.ts': 'head src\n',
      'test/a.test.ts': 'head a\n',
      'test/del.test.ts': null,
      'test/new.test.ts': 'head new\n',
      'test/x.test.ts': 'head x\n',
      'test/[x].test.ts': 'head bracket\n',
      'test/..dots.test.ts': 'head dots\n',
      '.relay/examples/w1.json': '{"head":1}\n',
      '.relay/examples/old.json': null,
      '.relay/examples/w2.json': '{"head":2}\n',
    })
  })

  beforeEach(async () => {
    home = await makeTempDir('relay-wt-overlay-')
  })

  test('base worktree에 head의 시험 파일을 얹고, head에서 지운 파일은 지운다', async () => {
    const { dir } = await prepareCheckout(home, KEY, repo.dir, 'base', base)
    await overlay(home, dir, repo.dir, head, [
      'test/a.test.ts',
      'test/del.test.ts',
      'test/new.test.ts',
    ])
    expect(await read(dir, 'test/a.test.ts')).toBe('head a\n')
    expect(await read(dir, 'test/new.test.ts')).toBe('head new\n')
    expect(existsSync(join(dir, 'test/del.test.ts'))).toBe(false)
    // 얹지 않은 소스는 base 그대로다
    expect(await read(dir, 'src/a.ts')).toBe('base src\n')
    expect(await read(dir, 'test/x.test.ts')).toBe('base x\n')
    expect(await runGit(dir, ['rev-parse', 'HEAD'])).toBe(base)
  })

  test('폴더를 얹으면 그 아래를 head와 똑같이 맞춘다', async () => {
    const { dir } = await prepareCheckout(home, KEY, repo.dir, 'base', base)
    await overlay(home, dir, repo.dir, head, ['.relay/examples/'])
    expect(await read(dir, '.relay/examples/w1.json')).toBe('{"head":1}\n')
    expect(await read(dir, '.relay/examples/w2.json')).toBe('{"head":2}\n')
    expect(existsSync(join(dir, '.relay/examples/old.json'))).toBe(false)
  })

  test('head에 없는 폴더를 얹으면 base에서도 없앤다', async () => {
    const { dir } = await prepareCheckout(home, KEY, repo.dir, 'head', head)
    await overlay(home, dir, repo.dir, base, ['test/new.test.ts', 'nowhere'])
    expect(existsSync(join(dir, 'test/new.test.ts'))).toBe(false)
    expect(await read(dir, 'test/a.test.ts')).toBe('head a\n')
  })

  test('경로의 glob 글자는 글자 그대로 본다', async () => {
    const { dir } = await prepareCheckout(home, KEY, repo.dir, 'base', base)
    await overlay(home, dir, repo.dir, head, ['test/[x].test.ts'])
    expect(await read(dir, 'test/[x].test.ts')).toBe('head bracket\n')
    expect(await read(dir, 'test/x.test.ts')).toBe('base x\n')
  })

  test('..으로 시작하는 이름도 레포 안 경로로 받는다', async () => {
    const { dir } = await prepareCheckout(home, KEY, repo.dir, 'base', base)
    await overlay(home, dir, repo.dir, head, ['test/..dots.test.ts'])
    expect(await read(dir, 'test/..dots.test.ts')).toBe('head dots\n')
  })

  test('경로가 많아도 모두 얹는다', async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 250; i++) files[`t/${i}.test.ts`] = `${i}\n`
    const many = await makeRepo({ files: { 'a.txt': 'a' } })
    const b = await many.sha()
    const h = await many.commit('많음', files)
    const { dir } = await prepareCheckout(home, 'many-key', many.dir, 'base', b)
    await overlay(home, dir, many.dir, h, Object.keys(files))
    expect(await read(dir, 't/0.test.ts')).toBe('0\n')
    expect(await read(dir, 't/249.test.ts')).toBe('249\n')
  })

  test('얹은 뒤 다시 prepareCheckout하면 깨끗한 base로 돌아온다', async () => {
    const { dir } = await prepareCheckout(home, KEY, repo.dir, 'base', base)
    await overlay(home, dir, repo.dir, head, [
      'test/a.test.ts',
      'test/new.test.ts',
      'test/del.test.ts',
    ])
    await prepareCheckout(home, KEY, repo.dir, 'base', base)
    expect(await read(dir, 'test/a.test.ts')).toBe('base a\n')
    expect(await read(dir, 'test/del.test.ts')).toBe('base del\n')
    expect(existsSync(join(dir, 'test/new.test.ts'))).toBe(false)
  })

  test('빈 목록이면 아무것도 바꾸지 않는다', async () => {
    const { dir } = await prepareCheckout(home, KEY, repo.dir, 'base', base)
    await overlay(home, dir, repo.dir, head, [])
    expect(await runGit(dir, ['status', '--porcelain'])).toBe('')
  })

  test.each(['../escape.txt', '/etc/passwd', 'C:/x.txt', '.git/config', 'a/../../b', '.', ''])(
    '레포 밖이나 .git을 가리키는 경로(%s)면 아무것도 바꾸지 않고 던진다',
    async (bad) => {
      const { dir } = await prepareCheckout(home, KEY, repo.dir, 'base', base)
      await expect(overlay(home, dir, repo.dir, head, ['test/a.test.ts', bad])).rejects.toThrow(
        '얹을 수 없는 경로',
      )
      expect(await read(dir, 'test/a.test.ts')).toBe('base a\n')
    },
  )

  test('base의 위쪽 조각이 레포 밖을 가리키는 링크여도 바깥 파일을 지우지 않는다', async () => {
    const outside = await makeTempDir('relay-outside-')
    await writeFile(join(outside, 'x.test.js'), 'outside\n')
    const linked = await makeRepo({ files: { 'a.txt': 'a\n' } })
    await symlink(outside, linked.path('link'))
    const b = await linked.commit('링크')
    await rm(linked.path('link'))
    const h = await linked.commit('폴더', { 'link/x.test.js': 'head\n' })
    const { dir } = await prepareCheckout(home, 'link-key', linked.dir, 'base', b)
    await overlay(home, dir, linked.dir, h, ['link/x.test.js'])
    expect(await readFile(join(outside, 'x.test.js'), 'utf8')).toBe('outside\n')
    expect(await read(dir, 'link/x.test.js')).toBe('head\n')
  })

  test('없는 SHA면 던진다', async () => {
    const { dir } = await prepareCheckout(home, KEY, repo.dir, 'base', base)
    const missing = '0123456789abcdef0123456789abcdef01234567'
    await expect(overlay(home, dir, repo.dir, missing, ['test/a.test.ts'])).rejects.toThrow()
    expect(await read(dir, 'test/a.test.ts')).toBe('base a\n')
  })
})

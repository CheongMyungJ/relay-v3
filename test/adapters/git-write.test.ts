// [어댑터] git 쓰기(M3b 빚 기록, src/adapters/git-write.ts): 작업 트리를 건드리지 않는 커밋, checkout한 worktree의 맞추기,
// 브랜치 끝의 확인, push. 그리고 두 커밋 사이 바뀐 파일(git.ts changedPaths)
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { changedPaths } from '../../src/adapters/git.ts'
import { commitFiles, pushBranch } from '../../src/adapters/git-write.ts'
import { cleanupAll, makeRepo, makeTempDir, runGit } from '../support/repo.ts'

afterAll(cleanupAll)

const RELAY = { name: 'relay', email: 'relay@localhost' }
const DEBT = '.relay/debt/r-file-size-src-a-js.md'

describe('commitFiles', () => {
  test('checkout한 브랜치: 파일만 더한 커밋, 작성자 relay, 세션의 다른 변경(staged·unstaged)은 그대로', async () => {
    const repo = await makeRepo({ files: { 'src/a.js': 'a\n', 'src/b.js': 'b\n' } })
    const tip = await repo.sha()
    await repo.write({ 'src/a.js': 'staged\n' })
    await repo.git('add', 'src/a.js')
    await repo.write({ 'src/b.js': 'unstaged\n' })
    const sha = await commitFiles(repo.dir, {
      branch: 'main',
      expect: tip,
      files: { [DEBT]: '---\nkind: x\n---\n' },
      message: '빚 기록\n\nRelay-Work: w1\nRelay-Debt: r-file-size-src-a-js\n',
      author: RELAY,
      worktree: repo.dir,
    })
    expect(await repo.sha()).toBe(sha)
    expect(await repo.git('rev-parse', `${sha}^`)).toBe(tip)
    expect(await repo.git('log', '-1', '--format=%an <%ae>|%cn', sha)).toBe(
      'relay <relay@localhost>|relay',
    )
    expect(await repo.git('diff-tree', '--no-commit-id', '--name-only', '-r', sha)).toBe(DEBT)
    expect(await repo.git('log', '-1', '--format=%(trailers:key=Relay-Debt,valueonly)', sha)).toBe(
      'r-file-size-src-a-js',
    )
    // 빚 파일은 index·작업 트리와 맞고, 세션의 변경은 남는다
    expect(await repo.git('status', '--porcelain')).toBe('M  src/a.js\n M src/b.js')
    expect(await readFile(repo.path(DEBT), 'utf8')).toBe('---\nkind: x\n---\n')
  })

  test('checkout하지 않은 브랜치는 작업 트리를 건드리지 않는다. 끝이 다르면 던지고 브랜치는 그대로', async () => {
    const repo = await makeRepo({ files: { 'a.txt': 'a\n' } })
    const tip = await repo.sha()
    await repo.git('branch', 'side')
    const files = { 'x/y.md': 'y\n' }
    const msg = 'm\n'
    await expect(
      commitFiles(repo.dir, {
        branch: 'side',
        expect: 'f'.repeat(40),
        files,
        message: msg,
        author: RELAY,
      }),
    ).rejects.toThrow(/브랜치 끝이 바뀜/)
    expect(await repo.sha('side')).toBe(tip)
    const sha = await commitFiles(repo.dir, {
      branch: 'side',
      expect: tip,
      files,
      message: msg,
      author: RELAY,
      worktree: repo.dir,
    })
    expect(await repo.sha('side')).toBe(sha)
    expect(await repo.sha()).toBe(tip)
    expect(await repo.git('status', '--porcelain')).toBe('')
    await expect(
      commitFiles(repo.dir, {
        branch: 'side',
        expect: sha,
        files: { '../x': 'y' },
        message: msg,
        author: RELAY,
      }),
    ).rejects.toThrow(/잘못된 경로/)
  })

  test('worktree의 index가 잠겼으면(세션의 git) 브랜치를 옮기기 전에 던진다: 빚 파일이 지움으로 staged되지 않는다', async () => {
    const repo = await makeRepo({ files: { 'a.txt': 'a\n' } })
    const tip = await repo.sha()
    const lock = repo.path('.git/index.lock')
    await writeFile(lock, '')
    await expect(
      commitFiles(repo.dir, {
        branch: 'main',
        expect: tip,
        files: { [DEBT]: 'd\n' },
        message: 'm\n',
        author: RELAY,
        worktree: repo.dir,
      }),
    ).rejects.toThrow()
    await rm(lock)
    expect(await repo.sha()).toBe(tip)
    expect(await repo.git('status', '--porcelain')).toBe('')
  })

  test('브랜치를 옮긴 때 worktree의 index에는 이미 빚 파일이 있다: 바로 뒤 세션의 커밋이 그것을 지우지 않는다', async () => {
    const repo = await makeRepo({ files: { 'a.txt': 'a\n' } })
    const tip = await repo.sha()
    // 브랜치를 옮긴 바로 그때 세션이 커밋한다(onMoved)
    const sha = await commitFiles(repo.dir, {
      branch: 'main',
      expect: tip,
      files: { [DEBT]: 'd\n' },
      message: 'm\n',
      author: RELAY,
      worktree: repo.dir,
      onMoved: async () => {
        await repo.write({ 'a.txt': 'session\n' })
        await repo.git('commit', '-q', '-am', '세션')
      },
    })
    expect(await repo.git('rev-parse', 'HEAD~1')).toBe(sha)
    expect(await repo.git('show', `HEAD:${DEBT}`)).toBe('d')
    expect(await repo.git('status', '--porcelain')).toBe('')
  })

  test('pushBranch는 그 브랜치를 origin의 같은 이름으로 보낸다', async () => {
    const tmp = await makeTempDir('relay-origin-')
    const origin = join(tmp, 'origin.git')
    await runGit(tmp, ['init', '--quiet', '--bare', origin])
    const repo = await makeRepo({ files: { 'a.txt': 'a\n' } })
    await repo.git('remote', 'add', 'origin', origin)
    const tip = await repo.sha()
    const sha = await commitFiles(repo.dir, {
      branch: 'main',
      expect: tip,
      files: { 'b.txt': 'b\n' },
      message: 'b\n',
      author: RELAY,
      worktree: repo.dir,
    })
    await pushBranch(repo.dir, 'main')
    expect(await runGit(origin, ['rev-parse', 'refs/heads/main'])).toBe(sha)
  })
})

test('changedPaths: 두 커밋 사이 바뀐 파일(옮김은 지움과 새로 생김)', async () => {
  const repo = await makeRepo({ files: { 'a.txt': 'a\n', 'old.txt': 'o\n'.repeat(20) } })
  const a = await repo.sha()
  const b = await repo.commit('바꿈', {
    'a.txt': 'b\n',
    'old.txt': null,
    'new.txt': 'o\n'.repeat(20),
  })
  expect((await changedPaths(repo.dir, a, b)).sort()).toEqual(['a.txt', 'new.txt', 'old.txt'])
  expect(await changedPaths(repo.dir, a, a)).toEqual([])
})

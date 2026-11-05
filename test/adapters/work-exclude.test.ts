// [어댑터] 새 Work의 worktree에서 JUnit 출력을 뺀다(M2.1 13절): src/main/works-worktree.ts addExcludes를 실제 git의 linked
// worktree에서. 세션이 수용 시험을 직접 돌려 생긴 출력이 untracked로 보이지 않아야 .gitignore를 고치지 않는다(07 relay3#4).
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, expect, test } from 'vitest'
import { addExcludes } from '../../src/main/works-worktree.ts'
import { cleanupAll, makeRepo, makeTempDir, runGit, writeFiles } from '../support/repo.ts'

afterAll(cleanupAll)

async function worktree() {
  const repo = await makeRepo({ files: { 'src/a.js': 'a\n', 'test/a.test.js': 't\n' } })
  const dir = join(await makeTempDir('relay-wt-'), 'w')
  await repo.git('worktree', 'add', '--quiet', '-b', 'relay/w', dir)
  const status = () => runGit(dir, ['status', '--porcelain', '--untracked-files=all'])
  return { repo, dir, status }
}

test('linked worktree에서 쓴 줄은 레포의 exclude에 들고, JUnit 출력과 그것만 든 폴더가 보이지 않는다', async () => {
  const { repo, dir, status } = await worktree()
  await writeFiles(dir, { '.relay-out/junit.xml': '<testsuites/>', 'test/junit.xml': '<x/>' })
  expect(await status()).toContain('.relay-out/junit.xml')

  expect(await addExcludes(dir, ['/.relay-out/junit.xml', '/test/junit.xml'])).toEqual([
    '/.relay-out/junit.xml',
    '/test/junit.xml',
  ])
  expect(await status()).toBe('')
  // 공통 git 폴더의 info/exclude다
  expect(await readFile(join(repo.dir, '.git', 'info', 'exclude'), 'utf8')).toContain(
    '\n/.relay-out/junit.xml\n/test/junit.xml\n',
  )
  // 폴더가 아니라 파일만 뺀다: 같은 폴더의 세션의 새 시험 파일은 보이고 git add -A에 든다
  await writeFiles(dir, { 'test/b.test.js': 'b\n' })
  expect(await status()).toBe('?? test/b.test.js')
  await runGit(dir, ['add', '-A'])
  expect(await runGit(dir, ['diff', '--cached', '--name-only'])).toBe('test/b.test.js')
})

test('이미 있는 줄은 더하지 않고, 끝 줄바꿈이 없는 파일 뒤에 줄을 바꿔 붙인다', async () => {
  const { repo, dir } = await worktree()
  const file = join(repo.dir, '.git', 'info', 'exclude')
  await writeFile(file, '# 사람이 쓴 것\n*.log')
  expect(await addExcludes(dir, ['/.relay-out/junit.xml'])).toEqual(['/.relay-out/junit.xml'])
  expect(await addExcludes(dir, ['/.relay-out/junit.xml'])).toEqual([])
  expect(await addExcludes(dir, [])).toEqual([])
  const text = await readFile(file, 'utf8')
  expect(text.startsWith('# 사람이 쓴 것\n*.log\n')).toBe(true)
  expect(text.split('\n').filter((l) => l === '/.relay-out/junit.xml')).toHaveLength(1)
})

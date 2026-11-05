// [어댑터] writeInside: 예시 자료의 정규 파일(V27)을 check worktree와 Work의 worktree에 쓴다. 링크 너머(레포 밖)에 쓰지 않는다.
import { existsSync } from 'node:fs'
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { writeInside } from '../../src/adapters/worktrees.ts'
import { cleanupAll, makeTempDir } from '../support/repo.ts'

afterAll(cleanupAll)

const read = (dir: string, rel: string) => readFile(join(dir, rel), 'utf8')

describe('writeInside (V27: 예시 자료의 정규 파일)', () => {
  let dir: string

  beforeEach(async () => {
    dir = await makeTempDir('relay-write-inside-')
  })

  test('없는 폴더를 만들어 쓰고 쓰기 전 내용(없었으면 null)을 돌려준다', async () => {
    expect(await writeInside(dir, '.relay/examples/w1.json', '{"a":1}\n')).toBeNull()
    expect(await read(dir, '.relay/examples/w1.json')).toBe('{"a":1}\n')
    const before = await writeInside(dir, '.relay/examples/w1.json', '{"a":2}\n')
    expect(before?.toString('utf8')).toBe('{"a":1}\n')
    expect(await read(dir, '.relay/examples/w1.json')).toBe('{"a":2}\n')
  })

  test('./ 앞머리와 겹친 /는 버리고 레포 안에 쓴다', async () => {
    await writeInside(dir, './fixtures//ex/w1.json', 'x')
    expect(await read(dir, 'fixtures/ex/w1.json')).toBe('x')
  })

  test.each(['../escape.json', '/etc/x.json', 'C:/x.json', '.git/x.json', 'a/../../b.json', ''])(
    '레포 밖이나 .git을 가리키는 경로(%s)면 던진다',
    async (bad) => {
      await expect(writeInside(dir, bad, 'x')).rejects.toThrow('쓸 수 없는 경로')
    },
  )

  test.skipIf(process.platform === 'win32')(
    '위쪽 조각이 링크면 그 너머(레포 밖)에 쓰지 않고 던진다',
    async () => {
      const outside = await makeTempDir('relay-outside-')
      await mkdir(join(dir, '.relay'))
      await symlink(outside, join(dir, '.relay/examples'))
      await expect(writeInside(dir, '.relay/examples/w1.json', 'x')).rejects.toThrow('폴더가 아님')
      expect(existsSync(join(outside, 'w1.json'))).toBe(false)
    },
  )

  test.skipIf(process.platform === 'win32')(
    '그 자리가 링크나 폴더면 따라가거나 지우지 않고 던진다',
    async () => {
      const outside = await makeTempDir('relay-outside-')
      await writeFile(join(outside, 'target.json'), 'outside\n')
      await symlink(join(outside, 'target.json'), join(dir, 'link.json'))
      await expect(writeInside(dir, 'link.json', 'x')).rejects.toThrow('파일이 아님')
      expect(await readFile(join(outside, 'target.json'), 'utf8')).toBe('outside\n')
      await mkdir(join(dir, 'folder.json'))
      await expect(writeInside(dir, 'folder.json', 'x')).rejects.toThrow('파일이 아님')
    },
  )

  test('위쪽 조각이 파일이면 던진다', async () => {
    await writeFile(join(dir, 'file'), 'f')
    await expect(writeInside(dir, 'file/w1.json', 'x')).rejects.toThrow('폴더가 아님')
    expect(await read(dir, 'file')).toBe('f')
  })
})

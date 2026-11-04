import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import {
  baseCache,
  evidencePath,
  readJson,
  relayHome,
  repoKey,
  writeJson,
} from '../../src/adapters/store.ts'
import type { CommandRun } from '../../src/core/types.ts'
import { cleanupAll, makeTempDir } from '../support/repo.ts'

afterAll(cleanupAll)

const SHA = 'a'.repeat(40)
const SHA2 = 'b'.repeat(40)

describe('relayHome', () => {
  test('RELAY_HOME이 있으면 그것을 절대 경로로 쓴다', () => {
    expect(relayHome({ RELAY_HOME: '/srv/relay' })).toBe(resolve('/srv/relay'))
    expect(relayHome({ RELAY_HOME: 'rel/home' })).toBe(resolve('rel/home'))
  })

  test('없거나 비었으면 ~/.relay-v3', () => {
    const def = join(homedir(), '.relay-v3')
    expect(relayHome({})).toBe(def)
    expect(relayHome({ RELAY_HOME: '' })).toBe(def)
    expect(relayHome({ RELAY_HOME: '   ' })).toBe(def)
  })
})

describe('repoKey', () => {
  test('폴더 이름과 경로 해시 12자리로 만든다', () => {
    expect(repoKey('/home/u/proj')).toMatch(/^proj-[0-9a-f]{12}$/)
  })

  test('같은 경로는 같은 키, 이름이 같아도 다른 경로는 다른 키', () => {
    expect(repoKey('/home/u/proj')).toBe(repoKey('/home/u/proj'))
    expect(repoKey('/home/u/proj')).toBe(repoKey('/home/u/proj/'))
    expect(repoKey('/home/u/proj')).toBe(repoKey('/home/u/x/../proj'))
    expect(repoKey('/home/u/proj')).not.toBe(repoKey('/home/v/proj'))
  })

  test('경로에 쓸 수 없는 글자는 바꾸고 한글은 남긴다', () => {
    const key = repoKey('/home/u/내 프로젝트: 시험*1')
    expect(key).toMatch(/^내-프로젝트-시험-1-[0-9a-f]{12}$/)
    expect(key).not.toMatch(/[/\\:* ]/)
  })

  test('점으로 시작하거나 이름이 없는 폴더도 안전한 키가 된다', () => {
    expect(repoKey('/home/u/..hidden')).toMatch(/^hidden-[0-9a-f]{12}$/)
    expect(repoKey('/')).toMatch(/^repo-[0-9a-f]{12}$/)
    expect(repoKey('/home/u/...')).toMatch(/^x-[0-9a-f]{12}$/)
  })

  test('아주 긴 이름은 40자에서 자른다', () => {
    const key = repoKey(`/home/u/${'n'.repeat(100)}`)
    expect(key).toBe(`${'n'.repeat(40)}-${key.slice(-12)}`)
  })
})

describe('evidencePath', () => {
  test('<home>/evidence/<키>/<SHA>.json', () => {
    expect(evidencePath('/h', 'proj-1', SHA)).toBe(join('/h', 'evidence', 'proj-1', `${SHA}.json`))
  })

  test('SHA-256 레포의 64자리 SHA도 받고 대문자는 소문자로 바꾼다', () => {
    const long = 'c'.repeat(64)
    expect(evidencePath('/h', 'k', long)).toBe(join('/h', 'evidence', 'k', `${long}.json`))
    expect(evidencePath('/h', 'k', SHA.toUpperCase())).toBe(evidencePath('/h', 'k', SHA))
  })

  test.each(['abc1234', '', '../../etc/passwd', 'g'.repeat(40), `${SHA}.json`])(
    '전체 SHA가 아닌 값(%s)이면 던진다',
    (sha) => {
      expect(() => evidencePath('/h', 'k', sha)).toThrow('잘못된 SHA')
    },
  )

  test.each(['', '.', '..', 'a/b', 'a\\b'])('경로 조각이 아닌 키(%s)면 던진다', (key) => {
    expect(() => evidencePath('/h', key, SHA)).toThrow('잘못된 레포 키')
  })
})

describe('writeJson / readJson', () => {
  let dir: string
  beforeEach(async () => {
    dir = await makeTempDir('relay-store-')
  })

  test('쓴 것을 그대로 읽고, 없는 폴더는 만든다', async () => {
    const path = join(dir, 'a', 'b', 'c.json')
    const value = { n: 1, s: '한글', list: [null, true], nested: { x: 'y' } }
    await writeJson(path, value)
    expect(await readJson(path)).toEqual(value)
  })

  test('사람이 읽을 수 있게 들여 쓰고 줄바꿈으로 끝낸다', async () => {
    const path = join(dir, 'p.json')
    await writeJson(path, { a: 1 })
    expect(await readFile(path, 'utf8')).toBe('{\n  "a": 1\n}\n')
  })

  test('다시 쓰면 덮어쓰고 임시 파일을 남기지 않는다', async () => {
    const path = join(dir, 'o.json')
    await writeJson(path, { v: 1 })
    await writeJson(path, { v: 2 })
    expect(await readJson(path)).toEqual({ v: 2 })
    expect(await readdir(dir)).toEqual(['o.json'])
  })

  test('동시에 써도 깨진 파일이 남지 않는다', async () => {
    const path = join(dir, 'race.json')
    await Promise.all(Array.from({ length: 10 }, (_, i) => writeJson(path, { i })))
    const got = await readJson<{ i: number }>(path)
    expect(got?.i).toBeGreaterThanOrEqual(0)
    expect(await readdir(dir)).toEqual(['race.json'])
  })

  test('JSON으로 쓸 수 없는 값이면 던진다', async () => {
    await expect(writeJson(join(dir, 'u.json'), undefined)).rejects.toThrow('JSON')
  })

  test('파일이 없으면 null', async () => {
    expect(await readJson(join(dir, 'none.json'))).toBeNull()
    expect(await readJson(join(dir, 'no', 'dir.json'))).toBeNull()
  })

  test('JSON이 깨졌으면 null', async () => {
    const path = join(dir, 'broken.json')
    await writeFile(path, '{"a":')
    expect(await readJson(path)).toBeNull()
    await writeFile(path, '')
    expect(await readJson(path)).toBeNull()
  })

  test('파일 자리에 폴더가 있으면 던진다(없음과 구별)', async () => {
    const path = join(dir, 'isdir.json')
    await mkdir(path)
    await expect(readJson(path)).rejects.toThrow()
  })
})

describe('baseCache', () => {
  let home: string
  beforeEach(async () => {
    home = await makeTempDir('relay-cache-')
  })

  const sample = (over: Partial<CommandRun> = {}): CommandRun => ({
    id: 'lint',
    sha: SHA,
    exit: 1,
    timed_out: false,
    duration_ms: 1234,
    stdout_tail: '오류 2개',
    stderr_tail: '',
    tests: [{ name: 't [C1.1]', status: 'failed' }],
    ...over,
  })

  test('쓴 결과를 같은 열쇠로 읽는다', async () => {
    await baseCache.write(home, 'proj-1', SHA, 'lint', 'h1', sample())
    expect(await baseCache.read(home, 'proj-1', SHA, 'lint', 'h1')).toEqual(sample())
  })

  test('열쇠(키, SHA, 명령 id, 실행 해시) 중 하나라도 다르면 null', async () => {
    await baseCache.write(home, 'proj-1', SHA, 'lint', 'h1', sample())
    expect(await baseCache.read(home, 'proj-2', SHA, 'lint', 'h1')).toBeNull()
    expect(await baseCache.read(home, 'proj-1', SHA2, 'lint', 'h1')).toBeNull()
    expect(await baseCache.read(home, 'proj-1', SHA, 'test', 'h1')).toBeNull()
    expect(await baseCache.read(home, 'proj-1', SHA, 'lint', 'h2')).toBeNull()
  })

  test('명령 id에 경로 글자가 있어도 캐시 폴더 밖으로 나가지 않는다', async () => {
    const id = '../../../evil'
    const path = baseCache.path(home, 'proj-1', SHA, id, 'h')
    const rel = relative(join(home, 'cache', 'proj-1', 'base', SHA), path)
    expect(rel).not.toContain('..')
    expect(dirname(rel)).toBe('.')
    await baseCache.write(home, 'proj-1', SHA, id, 'h', sample({ id }))
    expect(await baseCache.read(home, 'proj-1', SHA, id, 'h')).toEqual(sample({ id }))
  })

  test('글자를 바꾸면 같아지는 명령 id끼리도 섞이지 않는다', async () => {
    await baseCache.write(home, 'k', SHA, 'a/b', 'h', sample({ id: 'a/b', exit: 1 }))
    await baseCache.write(home, 'k', SHA, 'a b', 'h', sample({ id: 'a b', exit: 0 }))
    expect((await baseCache.read(home, 'k', SHA, 'a/b', 'h'))?.exit).toBe(1)
    expect((await baseCache.read(home, 'k', SHA, 'a b', 'h'))?.exit).toBe(0)
  })

  test('결과의 SHA가 열쇠의 SHA와 다르면 쓰지 않고 던진다', async () => {
    await expect(
      baseCache.write(home, 'k', SHA, 'lint', 'h', sample({ sha: SHA2 })),
    ).rejects.toThrow('SHA가 다름')
    expect(await baseCache.read(home, 'k', SHA, 'lint', 'h')).toBeNull()
  })

  test('캐시 파일이 깨졌거나 모양이 다르면 null', async () => {
    const path = baseCache.path(home, 'k', SHA, 'lint', 'h')
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, 'not json')
    expect(await baseCache.read(home, 'k', SHA, 'lint', 'h')).toBeNull()
    await writeFile(
      path,
      JSON.stringify({ version: 1, command_id: 'lint', run_hash: 'h', run: {} }),
    )
    expect(await baseCache.read(home, 'k', SHA, 'lint', 'h')).toBeNull()
    await writeFile(path, 'null')
    expect(await baseCache.read(home, 'k', SHA, 'lint', 'h')).toBeNull()
  })

  test('잘못된 SHA나 키면 던진다', async () => {
    await expect(baseCache.read(home, 'k', 'short', 'lint', 'h')).rejects.toThrow('잘못된 SHA')
    expect(() => baseCache.path(home, '../k', SHA, 'lint', 'h')).toThrow('잘못된 레포 키')
  })
})

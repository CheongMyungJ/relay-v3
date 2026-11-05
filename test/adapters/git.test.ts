import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  containsTip,
  defaultBase,
  diffRaw,
  dirsOf,
  lineCounts,
  lsTree,
  mergeBase,
  repoRoot,
  revParse,
  showFile,
} from '../../src/adapters/git.ts'
import { cleanupAll, makeRepo, makeTempDir, type TestRepo } from '../support/repo.ts'

afterAll(cleanupAll)

const MISSING_SHA = '0123456789abcdef0123456789abcdef01234567'

describe('repoRoot', () => {
  test('하위 폴더에서도 레포 루트를 돌려준다', async () => {
    const repo = await makeRepo({ files: { 'src/deep/a.ts': 'a' } })
    expect(await repoRoot(repo.path('src/deep'))).toBe(repo.dir)
    expect(await repoRoot(repo.dir)).toBe(repo.dir)
  })

  test('레포 밖이면 던진다', async () => {
    const outside = await makeTempDir('relay-norepo-')
    const saved = process.env.GIT_CEILING_DIRECTORIES
    process.env.GIT_CEILING_DIRECTORIES = dirname(outside)
    try {
      await expect(repoRoot(outside)).rejects.toThrow()
    } finally {
      if (saved === undefined) delete process.env.GIT_CEILING_DIRECTORIES
      else process.env.GIT_CEILING_DIRECTORIES = saved
    }
  })
})

describe('revParse', () => {
  let repo: TestRepo
  let first: string
  let second: string
  beforeAll(async () => {
    repo = await makeRepo({ files: { 'a.txt': '1\n' } })
    first = await repo.sha()
    second = await repo.commit('둘', { 'a.txt': '2\n' })
    await repo.git('tag', '-a', 'v1', '-m', '표시', first)
  })

  test('브랜치·HEAD·상대 ref·짧은 SHA를 커밋 SHA로 바꾼다', async () => {
    expect(await revParse(repo.dir, 'main')).toBe(second)
    expect(await revParse(repo.dir, 'HEAD')).toBe(second)
    expect(await revParse(repo.dir, 'HEAD~1')).toBe(first)
    expect(await revParse(repo.dir, first.slice(0, 10))).toBe(first)
    expect(second).toMatch(/^[0-9a-f]{40}$/)
  })

  test('주석 달린 태그는 커밋으로 벗긴다', async () => {
    expect(await revParse(repo.dir, 'v1')).toBe(first)
  })

  test('없는 ref면 던진다', async () => {
    await expect(revParse(repo.dir, 'no-such-branch')).rejects.toThrow('ref를 찾지 못함')
    await expect(revParse(repo.dir, MISSING_SHA)).rejects.toThrow('ref를 찾지 못함')
  })

  test('커밋이 아닌 객체(tree)면 던진다', async () => {
    const tree = await repo.git('rev-parse', 'HEAD^{tree}')
    await expect(revParse(repo.dir, tree)).rejects.toThrow('ref를 찾지 못함')
  })

  test('비었거나 -로 시작하는 ref는 옵션으로 읽히지 않게 막는다', async () => {
    await expect(revParse(repo.dir, '--all')).rejects.toThrow('잘못된 ref')
    await expect(revParse(repo.dir, '')).rejects.toThrow('잘못된 ref')
  })
})

describe('mergeBase', () => {
  test('갈라진 두 브랜치의 공통 조상을 돌려준다', async () => {
    const repo = await makeRepo({ files: { 'a.txt': '0\n' } })
    const root = await repo.sha()
    await repo.branch('feature')
    await repo.commit('기능', { 'f.txt': 'f\n' })
    await repo.checkout('main')
    await repo.commit('본류', { 'm.txt': 'm\n' })
    expect(await mergeBase(repo.dir, 'main', 'feature')).toBe(root)
  })

  test('공통 조상이 없으면 던진다', async () => {
    const repo = await makeRepo({ files: { 'a.txt': '0\n' } })
    await repo.git('checkout', '--quiet', '--orphan', 'lonely')
    await repo.commit('따로', { 'b.txt': 'b\n' })
    await expect(mergeBase(repo.dir, 'main', 'lonely')).rejects.toThrow('공통 조상이 없음')
  })

  test('-로 시작하는 ref는 막는다', async () => {
    const repo = await makeRepo({ files: { 'a.txt': '0\n' } })
    await expect(mergeBase(repo.dir, '--all', 'main')).rejects.toThrow('잘못된 ref')
  })
})

describe('containsTip', () => {
  const lines = (first: string, last: string) => `${first}\n2\n3\n4\n5\n6\n7\n${last}\n`

  test('끝이 head의 조상이거나 옮겨 심은 커밋이라 head가 그 변경을 다 담으면 참, 더 고쳤거나 충돌하면 거짓', async () => {
    const repo = await makeRepo({ files: { 'a.txt': lines('1', '8'), 'b.txt': 'b\n' } })
    // Work 브랜치: 단위 둘의 변경(같은 파일의 다른 곳)
    await repo.branch('work')
    const csv = await repo.commit('csv', { 'a.txt': lines('one', '8') })
    await repo.commit('money', { 'a.txt': lines('one', 'eight') })
    // 단위 브랜치 money는 기준에서 그 변경만 옮겨 심었다
    await repo.branch('money', 'main')
    await repo.commit('money', { 'a.txt': lines('1', 'eight') })
    expect(await containsTip(repo.dir, 'work', csv)).toBe(true)
    expect(await containsTip(repo.dir, 'work', 'money')).toBe(true)
    // 단위 브랜치에만 고침을 더함
    await repo.commit('고침', { 'b.txt': 'fixed\n' })
    expect(await containsTip(repo.dir, 'work', 'money')).toBe(false)
    // Work 브랜치와 같은 곳을 다르게 고침(합칠 수 없음)
    await repo.branch('clash', 'main')
    await repo.commit('충돌', { 'a.txt': lines('ONE', '8') })
    expect(await containsTip(repo.dir, 'work', 'clash')).toBe(false)
  })

  test('-로 시작하는 ref는 막는다', async () => {
    const repo = await makeRepo({ files: { 'a.txt': '0\n' } })
    await expect(containsTip(repo.dir, 'main', '--all')).rejects.toThrow('잘못된 ref')
  })
})

describe('defaultBase', () => {
  test('origin/HEAD → origin/main → main → master 순으로 처음 있는 것', async () => {
    const repo = await makeRepo({ files: { 'a.txt': '0\n' }, branch: 'master' })
    const sha = await repo.sha()
    expect(await defaultBase(repo.dir)).toBe('master')
    await repo.git('branch', 'main')
    expect(await defaultBase(repo.dir)).toBe('main')
    await repo.git('update-ref', 'refs/remotes/origin/main', sha)
    expect(await defaultBase(repo.dir)).toBe('origin/main')
    await repo.git('update-ref', 'refs/remotes/origin/dev', sha)
    await repo.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/dev')
    expect(await defaultBase(repo.dir)).toBe('origin/HEAD')
  })

  test('가리키는 곳이 없는 origin/HEAD는 건너뛴다', async () => {
    const repo = await makeRepo({ files: { 'a.txt': '0\n' } })
    await repo.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/gone')
    expect(await defaultBase(repo.dir)).toBe('main')
  })

  test('main이라는 태그가 아니라 브랜치를 본다', async () => {
    const repo = await makeRepo({ files: { 'a.txt': '0\n' }, branch: 'trunk' })
    await repo.git('tag', 'main')
    await repo.git('branch', 'master')
    expect(await defaultBase(repo.dir)).toBe('master')
  })

  test('후보가 하나도 없으면 던진다', async () => {
    const repo = await makeRepo({ files: { 'a.txt': '0\n' }, branch: 'trunk' })
    await expect(defaultBase(repo.dir)).rejects.toThrow('기준 브랜치를 찾지 못함')
  })
})

describe('diffRaw', () => {
  let repo: TestRepo
  let base: string
  let head: string
  beforeAll(async () => {
    repo = await makeRepo({
      files: {
        'mod.txt': 'one\ntwo\n',
        'gone.txt': 'bye\n',
        'src/old.ts': 'export const a = 1\nexport const b = 2\nexport const c = 3\n',
        'space dir/x.txt': 'x\n',
      },
    })
    base = await repo.sha()
    head = await repo.commit('바꿈', {
      'mod.txt': 'one\nTWO\n',
      'gone.txt': null,
      'src/old.ts': null,
      'src/new.ts': 'export const a = 1\nexport const b = 2\nexport const c = 3\n',
      '한글 파일.txt': '새\n',
    })
    // 출력 모양을 바꾸는 사용자 설정
    for (const [k, v] of [
      ['diff.noprefix', 'true'],
      ['diff.mnemonicPrefix', 'true'],
      ['color.ui', 'always'],
      ['color.diff', 'always'],
      ['diff.renames', 'false'],
      ['diff.relative', 'true'],
    ]) {
      await repo.git('config', k as string, v as string)
    }
  })

  test('name-status를 NUL로 나누고 이름 바뀜을 찾는다', async () => {
    const { nameStatus } = await diffRaw(repo.dir, base, head)
    const parts = nameStatus.split('\0')
    expect(parts).toContain('gone.txt')
    expect(nameStatus).toContain('M\0mod.txt\0')
    expect(nameStatus).toContain('D\0gone.txt\0')
    expect(nameStatus).toContain('A\0한글 파일.txt\0')
    expect(nameStatus).toMatch(/R\d{3}\0src\/old\.ts\0src\/new\.ts\0/)
  })

  test('numstat은 줄 수를 NUL로 나누어 준다', async () => {
    const { numstat } = await diffRaw(repo.dir, base, head)
    expect(numstat).toContain('1\t1\tmod.txt\0')
    expect(numstat).toContain('0\t1\tgone.txt\0')
    expect(numstat).toContain('0\t0\t\0src/old.ts\0src/new.ts\0')
  })

  test('patch는 a/·b/ 머리, 색 없음, 앞뒤 줄 없음', async () => {
    const { patch } = await diffRaw(repo.dir, base, head)
    expect(patch).not.toContain('\x1b[')
    expect(patch).toMatch(/--- a\/mod\.txt\n\+\+\+ b\/mod\.txt\n@@ -2 \+2 @@[^\n]*\n-two\n\+TWO\n/)
    expect(patch).toContain('--- a/gone.txt\n+++ /dev/null\n')
    expect(patch).toContain('rename from src/old.ts')
    expect(patch.split('\n')).not.toContain(' one')
  })

  test('같은 커밋끼리는 빈 출력', async () => {
    expect(await diffRaw(repo.dir, head, head)).toEqual({ nameStatus: '', numstat: '', patch: '' })
  })

  test('없는 ref나 -로 시작하는 ref면 던진다', async () => {
    await expect(diffRaw(repo.dir, MISSING_SHA, head)).rejects.toThrow()
    await expect(diffRaw(repo.dir, '--output=x', head)).rejects.toThrow('잘못된 ref')
  })
})

describe('showFile', () => {
  let repo: TestRepo
  let first: string
  let second: string
  beforeAll(async () => {
    repo = await makeRepo({ files: { 'package.json': '{"a":1}\n', 'dir/한글.txt': '내용\n' } })
    first = await repo.sha()
    second = await repo.commit('둘', { 'package.json': '{"a":2}\n', 'later.txt': 'l\n' })
  })

  test('그 SHA의 파일 내용을 돌려준다', async () => {
    expect(await showFile(repo.dir, first, 'package.json')).toBe('{"a":1}\n')
    expect(await showFile(repo.dir, second, 'package.json')).toBe('{"a":2}\n')
    expect(await showFile(repo.dir, first, 'dir/한글.txt')).toBe('내용\n')
  })

  test('그 SHA에 없는 파일이나 폴더면 null', async () => {
    expect(await showFile(repo.dir, first, 'later.txt')).toBeNull()
    expect(await showFile(repo.dir, first, 'nope/x.txt')).toBeNull()
    expect(await showFile(repo.dir, first, 'dir')).toBeNull()
  })

  test('SHA가 없으면 던진다', async () => {
    await expect(showFile(repo.dir, MISSING_SHA, 'package.json')).rejects.toThrow()
  })
})

describe('lsTree', () => {
  test('모든 파일을 레포 루트 기준 경로로 돌려준다(따옴표 없이)', async () => {
    const repo = await makeRepo({
      files: { 'a.txt': 'a', 'src/x/b.ts': 'b', 'space dir/c d.txt': 'c', '한글/파일.md': 'd' },
    })
    const files = await lsTree(repo.dir, await repo.sha())
    expect(files.sort()).toEqual(['a.txt', 'space dir/c d.txt', 'src/x/b.ts', '한글/파일.md'])
  })

  test('하위 폴더에서 불러도 전체 목록이다', async () => {
    const repo = await makeRepo({ files: { 'a.txt': 'a', 'src/b.ts': 'b' } })
    const files = await lsTree(repo.path('src'), await repo.sha())
    expect(files.sort()).toEqual(['a.txt', 'src/b.ts'])
  })

  test('빈 커밋이면 빈 목록, 없는 SHA면 던진다', async () => {
    const repo = await makeRepo()
    const sha = await repo.commit('빈')
    expect(await lsTree(repo.dir, sha)).toEqual([])
    await expect(lsTree(repo.dir, MISSING_SHA)).rejects.toThrow()
  })
})

describe('dirsOf', () => {
  test('모든 조상 디렉터리를 모은다', () => {
    expect([...dirsOf(['a/b/c.ts', 'a/d.ts', 'x/y/z/w.txt', 'root.txt'])].sort()).toEqual([
      'a',
      'a/b',
      'x',
      'x/y',
      'x/y/z',
    ])
  })

  test('루트의 파일만 있거나 목록이 비면 빈 집합', () => {
    expect(dirsOf(['a.txt', 'b.txt']).size).toBe(0)
    expect(dirsOf([]).size).toBe(0)
  })
})

describe('lineCounts', () => {
  let repo: TestRepo
  let sha: string
  beforeAll(async () => {
    const bin = Buffer.from([0x50, 0x4e, 0x47, 0x00, 0x0a, 0x0a])
    repo = await makeRepo({
      files: {
        'three.txt': 'a\nb\nc\n',
        'nonl.txt': 'a\nb',
        'empty.txt': '',
        'crlf.txt': 'a\r\nb\r\n',
        'one.txt': 'only',
        'img.png': bin,
        'dir/deep.ts': 'x\n'.repeat(700),
      },
    })
    sha = await repo.sha()
  })

  test('파일마다 줄 수를 센다(끝 줄바꿈이 없으면 마지막 줄도 센다)', async () => {
    const counts = await lineCounts(repo.dir, sha, [
      'three.txt',
      'nonl.txt',
      'empty.txt',
      'crlf.txt',
      'one.txt',
      'dir/deep.ts',
    ])
    expect(Object.fromEntries(counts)).toEqual({
      'three.txt': 3,
      'nonl.txt': 2,
      'empty.txt': 0,
      'crlf.txt': 2,
      'one.txt': 1,
      'dir/deep.ts': 700,
    })
  })

  test('없는 파일은 null, 바이너리는 넣지 않는다', async () => {
    const counts = await lineCounts(repo.dir, sha, ['missing.txt', 'img.png', 'dir', 'three.txt'])
    expect(counts.get('missing.txt')).toBeNull()
    expect(counts.get('dir')).toBeNull()
    expect(counts.has('img.png')).toBe(false)
    expect(counts.get('three.txt')).toBe(3)
  })

  test('경로가 겹치거나 비어도 된다', async () => {
    expect((await lineCounts(repo.dir, sha, [])).size).toBe(0)
    const counts = await lineCounts(repo.dir, sha, ['one.txt', 'one.txt'])
    expect([...counts]).toEqual([['one.txt', 1]])
  })

  test('파일이 많아도 모두 센다', async () => {
    const many = await makeRepo()
    const files: Record<string, string> = {}
    for (let i = 0; i < 40; i++) files[`f/${i}.txt`] = 'x\n'.repeat(i)
    await mkdir(many.path('f'), { recursive: true })
    const s = await many.commit('많음', files)
    const counts = await lineCounts(many.dir, s, Object.keys(files))
    expect(counts.size).toBe(40)
    for (let i = 0; i < 40; i++) expect(counts.get(`f/${i}.txt`)).toBe(i)
  })

  test('SHA가 없으면 던진다', async () => {
    await expect(lineCounts(repo.dir, MISSING_SHA, ['three.txt'])).rejects.toThrow()
  })
})

test('하위 폴더 경로를 줘도 파일 경로는 레포 루트 기준', async () => {
  const repo = await makeRepo({ files: { 'src/a.ts': 'a\n', 'b.ts': 'b\nb\n' } })
  const sha = await repo.sha()
  expect(await showFile(join(repo.dir, 'src'), sha, 'b.ts')).toBe('b\nb\n')
})

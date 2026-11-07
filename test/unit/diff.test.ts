import { describe, expect, test } from 'vitest'
import { buildDiffFacts, parseNameStatus, parseNumstat, parsePatch } from '../../src/core/diff.ts'

// 고정 자료: 임시 레포에서 git 2.43으로 뜬 실제 출력이다.
// base → head: 이름 바뀜(79%, 100%), 공백·탭·한글 경로, 바이너리 수정·추가, 지운 파일,
// 끝 줄바꿈 없음, `-- `·`++`로 시작하는 내용 줄.
const NAME_STATUS =
  'A\0added file.txt\0M\0dir with space/file one.txt\0R100\0docs/moved.md\0docs2/moved.md\0' +
  'D\0gone.txt\0M\0img.bin\0M\0mod.txt\0A\0newbin.bin\0M\0nonl.txt\0M\0sql.txt\0' +
  'R079\0src/old.ts\0src/new.ts\0A\0tab\tname.txt\0M\0test/a.test.ts\0A\0한글 파일.txt\0'

const NUMSTAT =
  '1\t0\tadded file.txt\x001\t0\tdir with space/file one.txt\x000\t0\t\0docs/moved.md\0docs2/moved.md\0' +
  '0\t2\tgone.txt\0-\t-\timg.bin\x002\t1\tmod.txt\0-\t-\tnewbin.bin\x001\t1\tnonl.txt\0' +
  '1\t2\tsql.txt\x001\t1\t\0src/old.ts\0src/new.ts\x001\t0\ttab\tname.txt\0' +
  '1\t2\ttest/a.test.ts\x001\t0\t한글 파일.txt\0'

const HANGUL_QUOTED = '\\355\\225\\234\\352\\270\\200 \\355\\214\\214\\354\\235\\274.txt'

const PATCH = [
  'diff --git a/added file.txt b/added file.txt',
  'new file mode 100644',
  'index 0000000..3e75765',
  '--- /dev/null',
  '+++ b/added file.txt\t',
  '@@ -0,0 +1 @@',
  '+new',
  'diff --git a/dir with space/file one.txt b/dir with space/file one.txt',
  'index 422c2b7..de98044 100644',
  '--- a/dir with space/file one.txt\t',
  '+++ b/dir with space/file one.txt\t',
  '@@ -2,0 +3 @@ b',
  '+c',
  'diff --git a/docs/moved.md b/docs2/moved.md',
  'similarity index 100%',
  'rename from docs/moved.md',
  'rename to docs2/moved.md',
  'diff --git a/gone.txt b/gone.txt',
  'deleted file mode 100644',
  'index ce0fdac..0000000',
  '--- a/gone.txt',
  '+++ /dev/null',
  '@@ -1,2 +0,0 @@',
  '-del1',
  '-del2',
  'diff --git a/img.bin b/img.bin',
  'index 6772730..10c66b3 100644',
  'Binary files a/img.bin and b/img.bin differ',
  'diff --git a/mod.txt b/mod.txt',
  'index 587be6b..2795c87 100644',
  '--- a/mod.txt',
  '+++ b/mod.txt',
  '@@ -1 +1,2 @@',
  '-x',
  '+y',
  '+z',
  'diff --git a/newbin.bin b/newbin.bin',
  'new file mode 100644',
  'index 0000000..00ffac9',
  'Binary files /dev/null and b/newbin.bin differ',
  'diff --git a/nonl.txt b/nonl.txt',
  'index 1a9d148..7adf2e5 100644',
  '--- a/nonl.txt',
  '+++ b/nonl.txt',
  '@@ -1 +1 @@',
  '-nonl',
  '\\ No newline at end of file',
  '+nonl2',
  '\\ No newline at end of file',
  'diff --git a/sql.txt b/sql.txt',
  'index 956993e..16c5e4c 100644',
  '--- a/sql.txt',
  '+++ b/sql.txt',
  '@@ -1,2 +0,0 @@',
  '--- sql comment',
  '-++plus',
  '@@ -3,0 +2 @@ keep',
  '+++new',
  'diff --git a/src/old.ts b/src/new.ts',
  'similarity index 79%',
  'rename from src/old.ts',
  'rename to src/new.ts',
  'index 4083766..9928863 100644',
  '--- a/src/old.ts',
  '+++ b/src/new.ts',
  '@@ -5 +5 @@ line4',
  '-line5',
  '+line5 changed',
  'diff --git "a/tab\\tname.txt" "b/tab\\tname.txt"',
  'new file mode 100644',
  'index 0000000..383ba0a',
  '--- /dev/null',
  '+++ "b/tab\\tname.txt"',
  '@@ -0,0 +1 @@',
  '+tab\there',
  'diff --git a/test/a.test.ts b/test/a.test.ts',
  'index 1464cc8..9e39c04 100644',
  '--- a/test/a.test.ts',
  '+++ b/test/a.test.ts',
  '@@ -1,2 +1 @@',
  "-it('a', () => {",
  '-  expect(1).toBe(1)',
  "+it.skip('a', () => {",
  `diff --git "a/${HANGUL_QUOTED}" "b/${HANGUL_QUOTED}"`,
  'new file mode 100644',
  'index 0000000..b68fde2',
  '--- /dev/null',
  `+++ "b/${HANGUL_QUOTED}"\t`,
  '@@ -0,0 +1 @@',
  '+k',
  '',
].join('\n')

// 심볼릭 링크를 보통 파일로 바꾼 유형 바뀜(T). 패치에는 같은 경로가 지움·추가 두 번 나온다.
const TYPECHANGE_PATCH = [
  'diff --git a/link b/link',
  'deleted file mode 120000',
  'index d550755..0000000',
  '--- a/link',
  '+++ /dev/null',
  '@@ -1 +0,0 @@',
  '-mod.txt',
  '\\ No newline at end of file',
  'diff --git a/link b/link',
  'new file mode 100644',
  'index 0000000..6ae26cf',
  '--- /dev/null',
  '+++ b/link',
  '@@ -0,0 +1 @@',
  '+nowfile',
  '',
].join('\n')

describe('parseNameStatus', () => {
  test('실제 git 출력에서 상태와 경로를 읽는다', () => {
    expect(parseNameStatus(NAME_STATUS)).toEqual([
      { status: 'A', path: 'added file.txt' },
      { status: 'M', path: 'dir with space/file one.txt' },
      { status: 'R', path: 'docs2/moved.md', old_path: 'docs/moved.md' },
      { status: 'D', path: 'gone.txt' },
      { status: 'M', path: 'img.bin' },
      { status: 'M', path: 'mod.txt' },
      { status: 'A', path: 'newbin.bin' },
      { status: 'M', path: 'nonl.txt' },
      { status: 'M', path: 'sql.txt' },
      { status: 'R', path: 'src/new.ts', old_path: 'src/old.ts' },
      { status: 'A', path: 'tab\tname.txt' },
      { status: 'M', path: 'test/a.test.ts' },
      { status: 'A', path: '한글 파일.txt' },
    ])
  })

  test('빈 출력은 빈 목록이다', () => {
    expect(parseNameStatus('')).toEqual([])
  })

  test('복사는 옛 경로와 새 경로를 함께 읽는다', () => {
    expect(parseNameStatus('C075\0a.ts\0b.ts\0')).toEqual([
      { status: 'C', path: 'b.ts', old_path: 'a.ts' },
    ])
  })

  test('유형 바뀜(T)을 읽는다', () => {
    expect(parseNameStatus('T\0link\0')).toEqual([{ status: 'T', path: 'link' }])
  })

  test('모르는 상태 글자는 바뀐 파일(M)로 본다', () => {
    expect(parseNameStatus('U\0conflict.ts\0X\0odd.ts\0')).toEqual([
      { status: 'M', path: 'conflict.ts' },
      { status: 'M', path: 'odd.ts' },
    ])
  })

  test('끝 NUL이 없어도 읽는다', () => {
    expect(parseNameStatus('M\0a.ts')).toEqual([{ status: 'M', path: 'a.ts' }])
  })

  test('경로가 잘린 출력은 온전한 항목까지만 읽는다', () => {
    expect(parseNameStatus('M\0a.ts\0R090\0old.ts\0')).toEqual([{ status: 'M', path: 'a.ts' }])
    expect(parseNameStatus('A\0')).toEqual([])
  })
})

describe('parseNumstat', () => {
  test('실제 git 출력에서 줄 수와 바이너리를 읽는다', () => {
    expect(parseNumstat(NUMSTAT)).toEqual([
      { path: 'added file.txt', added: 1, deleted: 0, binary: false },
      { path: 'dir with space/file one.txt', added: 1, deleted: 0, binary: false },
      { path: 'docs2/moved.md', added: 0, deleted: 0, binary: false },
      { path: 'gone.txt', added: 0, deleted: 2, binary: false },
      { path: 'img.bin', added: 0, deleted: 0, binary: true },
      { path: 'mod.txt', added: 2, deleted: 1, binary: false },
      { path: 'newbin.bin', added: 0, deleted: 0, binary: true },
      { path: 'nonl.txt', added: 1, deleted: 1, binary: false },
      { path: 'sql.txt', added: 1, deleted: 2, binary: false },
      { path: 'src/new.ts', added: 1, deleted: 1, binary: false },
      { path: 'tab\tname.txt', added: 1, deleted: 0, binary: false },
      { path: 'test/a.test.ts', added: 1, deleted: 2, binary: false },
      { path: '한글 파일.txt', added: 1, deleted: 0, binary: false },
    ])
  })

  test('빈 출력은 빈 목록이다', () => {
    expect(parseNumstat('')).toEqual([])
  })

  test('바이너리 이름 바뀜은 새 경로로 읽는다', () => {
    expect(parseNumstat('-\t-\t\0a.png\0b.png\0')).toEqual([
      { path: 'b.png', added: 0, deleted: 0, binary: true },
    ])
  })

  test('큰 줄 수를 읽는다', () => {
    expect(parseNumstat('12345\t678\tbig.ts\0')).toEqual([
      { path: 'big.ts', added: 12345, deleted: 678, binary: false },
    ])
  })

  test('모양이 틀린 칸은 건너뛴다', () => {
    expect(parseNumstat('garbage\0x\ty\tz.ts\x001\t1\tok.ts\0')).toEqual([
      { path: 'ok.ts', added: 1, deleted: 1, binary: false },
    ])
  })

  test('경로가 잘린 이름 바뀜은 버린다', () => {
    expect(parseNumstat('1\t1\t\0old.ts\0')).toEqual([])
  })
})

describe('parsePatch', () => {
  const files = parsePatch(PATCH)

  test('파일마다 더한 줄과 지운 줄을 모은다', () => {
    expect(files.get('mod.txt')).toEqual({ added: ['y', 'z'], removed: ['x'], added_at: [1, 2] })
  })

  test('공백 든 경로 뒤에 git이 붙인 탭을 뗀다', () => {
    expect(files.get('added file.txt')).toEqual({ added: ['new'], removed: [], added_at: [1] })
    expect(files.get('dir with space/file one.txt')).toEqual({
      added: ['c'],
      removed: [],
      added_at: [3],
    })
  })

  test('지운 파일은 옛 경로로 모은다', () => {
    expect(files.get('gone.txt')).toEqual({ added: [], removed: ['del1', 'del2'], added_at: [] })
  })

  test('이름 바뀜은 새 경로로 모은다', () => {
    expect(files.get('src/new.ts')).toEqual({
      added: ['line5 changed'],
      removed: ['line5'],
      added_at: [5],
    })
    expect(files.has('src/old.ts')).toBe(false)
  })

  test('따옴표로 감싼 탭·한글 경로를 푼다', () => {
    expect(files.get('tab\tname.txt')).toEqual({ added: ['tab\there'], removed: [], added_at: [1] })
    expect(files.get('한글 파일.txt')).toEqual({ added: ['k'], removed: [], added_at: [1] })
  })

  test('머리처럼 생긴 내용 줄(---, +++)도 줄 수대로 읽는다', () => {
    expect(files.get('sql.txt')).toEqual({
      added: ['++new'],
      removed: ['-- sql comment', '++plus'],
      added_at: [2],
    })
  })

  test('끝 줄바꿈 없음 표시는 줄로 세지 않는다', () => {
    expect(files.get('nonl.txt')).toEqual({ added: ['nonl2'], removed: ['nonl'], added_at: [1] })
  })

  test('바이너리와 내용이 같은 이름 바뀜은 줄이 없어 빠진다', () => {
    expect(files.has('img.bin')).toBe(false)
    expect(files.has('newbin.bin')).toBe(false)
    expect(files.has('docs2/moved.md')).toBe(false)
    expect(files.size).toBe(10)
  })

  test('같은 경로가 두 번 나오면(유형 바뀜) 합친다', () => {
    expect(parsePatch(TYPECHANGE_PATCH).get('link')).toEqual({
      added: ['nowfile'],
      removed: ['mod.txt'],
      added_at: [1],
    })
  })

  test('문맥 줄은 더한 줄로도 지운 줄로도 세지 않는다', () => {
    const patch = [
      'diff --git a/f.txt b/f.txt',
      '--- a/f.txt',
      '+++ b/f.txt',
      '@@ -1,3 +1,3 @@',
      ' a',
      '-b',
      '+B',
      ' c',
      'diff --git a/g.txt b/g.txt',
      '--- a/g.txt',
      '+++ b/g.txt',
      '@@ -1 +1 @@',
      '-1',
      '+2',
    ].join('\n')
    const map = parsePatch(patch)
    expect(map.get('f.txt')).toEqual({ added: ['B'], removed: ['b'], added_at: [2] })
    expect(map.get('g.txt')).toEqual({ added: ['2'], removed: ['1'], added_at: [1] })
  })

  test('따옴표와 역슬래시를 이스케이프한 경로를 푼다', () => {
    const patch = [
      'diff --git "a/quo\\"te\\\\back.txt" "b/quo\\"te\\\\back.txt"',
      '--- /dev/null',
      '+++ "b/quo\\"te\\\\back.txt"',
      '@@ -0,0 +1 @@',
      '+q',
    ].join('\n')
    expect([...parsePatch(patch).keys()]).toEqual(['quo"te\\back.txt'])
  })

  test('따옴표로 감싼 지운 파일은 옛 경로를 풀어 쓴다', () => {
    const patch = [
      `diff --git "a/${HANGUL_QUOTED}" "b/${HANGUL_QUOTED}"`,
      'deleted file mode 100644',
      `--- "a/${HANGUL_QUOTED}"\t`,
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-k',
    ].join('\n')
    expect(parsePatch(patch).get('한글 파일.txt')).toEqual({
      added: [],
      removed: ['k'],
      added_at: [],
    })
  })

  test('빈 줄을 더하고 지운 것도 줄로 센다', () => {
    const patch = ['--- a/e.txt', '+++ b/e.txt', '@@ -1 +1,2 @@', '-', '+', '+x'].join('\n')
    expect(parsePatch(patch).get('e.txt')).toEqual({
      added: ['', 'x'],
      removed: [''],
      added_at: [1, 2],
    })
  })

  test('더한 줄의 head 줄 번호: 덩어리 머리의 + 시작에서 세고 문맥 줄도 센다', () => {
    const patch = [
      '--- a/n.txt',
      '+++ b/n.txt',
      '@@ -2 +2,3 @@',
      '-o',
      '+a',
      ' k',
      '+b',
      '@@ -9,0 +11 @@',
      '+c',
    ].join('\n')
    expect(parsePatch(patch).get('n.txt')?.added_at).toEqual([2, 4, 11])
  })

  test('빈 출력은 빈 지도다', () => {
    expect(parsePatch('').size).toBe(0)
  })

  test('파일 머리 없는 덩어리는 버린다', () => {
    expect(parsePatch('@@ -1 +1 @@\n-a\n+b\n').size).toBe(0)
  })
})

describe('buildDiffFacts', () => {
  const facts = buildDiffFacts('base1', 'head1', NAME_STATUS, NUMSTAT, PATCH)
  const byPath = (path: string) => facts.files.find((f) => f.path === path)

  test('base와 head를 그대로 담고 name-status 순서를 따른다', () => {
    expect(facts.base).toBe('base1')
    expect(facts.head).toBe('head1')
    expect(facts.files.map((f) => f.path)).toEqual(parseNameStatus(NAME_STATUS).map((e) => e.path))
  })

  test('이름 바뀜에 옛 경로, 줄 수, 줄 내용을 붙인다', () => {
    expect(byPath('src/new.ts')).toEqual({
      path: 'src/new.ts',
      old_path: 'src/old.ts',
      status: 'R',
      added: 1,
      deleted: 1,
      binary: false,
      added_lines: ['line5 changed'],
      removed_lines: ['line5'],
      added_at: [5],
    })
  })

  test('이름 바뀜이 아니면 old_path 칸이 없다', () => {
    expect(byPath('mod.txt')).not.toHaveProperty('old_path')
  })

  test('지운 파일은 지운 줄을 담는다', () => {
    expect(byPath('gone.txt')).toMatchObject({
      status: 'D',
      added: 0,
      deleted: 2,
      added_lines: [],
      removed_lines: ['del1', 'del2'],
    })
  })

  test('바이너리는 줄 없이 binary로 표시한다', () => {
    expect(byPath('newbin.bin')).toMatchObject({
      status: 'A',
      binary: true,
      added: 0,
      deleted: 0,
      added_lines: [],
      removed_lines: [],
    })
  })

  test('내용이 같은 이름 바뀜은 0줄이다', () => {
    expect(byPath('docs2/moved.md')).toMatchObject({
      status: 'R',
      old_path: 'docs/moved.md',
      added: 0,
      deleted: 0,
      added_lines: [],
    })
  })

  test('numstat에 없는 파일은 패치 줄 수로 센다', () => {
    const f = buildDiffFacts('b', 'h', 'M\0mod.txt\0', '', PATCH).files[0]
    expect(f).toMatchObject({ added: 2, deleted: 1, binary: false })
  })

  test('세 출력이 모두 비면 파일이 없다', () => {
    expect(buildDiffFacts('b', 'h', '', '', '')).toEqual({ base: 'b', head: 'h', files: [] })
  })
})

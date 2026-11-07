// [단위] 억누름 래칫(V55, engine/suppressions.ts): 확장자별 무늬표, 한 줄 글 안의 표식, 빼는 곳, 기준과의 비교(같음·나아짐·
// 나빠짐, 새 파일, 옮긴 파일). 실제 git의 base·head에서 세는 것은 [어댑터] ratchets.test.ts.
import { describe, expect, test } from 'vitest'
import type { FileChange } from '../../src/core/types.ts'
import {
  codePart,
  GREP_NEEDLES,
  MARKERS,
  suppressionsIn,
  suppressionsRatchet,
  type Suppression,
  type SuppressionsSpec,
} from '../../src/engine/suppressions.ts'

const spec: SuppressionsSpec = { id: 'suppressions', kind: 'suppressions' }
const markers = (path: string, text: string) => suppressionsIn(path, text).map((s) => s.marker)

const change = (path: string, status: FileChange['status'] = 'M', old_path?: string) =>
  ({
    path,
    status,
    added: 1,
    deleted: 0,
    binary: false,
    added_lines: [],
    removed_lines: [],
    ...(old_path === undefined ? {} : { old_path }),
  }) as FileChange

describe('무늬표', () => {
  test.each([
    ['src/a.ts', '// eslint-disable-next-line no-console', ['eslint-disable']],
    ['src/a.tsx', '/* eslint-disable */', ['eslint-disable']],
    ['src/a.js', '  // @ts-ignore', ['@ts-ignore']],
    ['src/a.mts', '// @ts-expect-error 옛 타입', ['@ts-expect-error']],
    ['test/a.test.ts', "it.skip('x', () => {})", ['.skip(']],
    ['test/a.test.js', "describe.skip('x', () => {})", ['.skip(']],
    ['test/a.spec.cjs', "xit('x', () => {})", ['xit(']],
    ['test/a.spec.mjs', "xdescribe('x', () => {})", ['xdescribe(']],
    ['app/a.py', 'import os  # noqa: F401', ['# noqa']],
    ['app/a.py', 'x = f()  # NOQA', ['# noqa']],
    ['app/a.pyi', 'y: int = g()  # type: ignore[assignment]', ['# type: ignore']],
    ['tests/test_a.py', '@pytest.mark.skip(reason="느림")', ['@pytest.mark.skip']],
    [
      'tests/test_a.py',
      '@pytest.mark.skipif(sys.platform == "win32", reason="x")',
      ['@pytest.mark.skip'],
    ],
    ['pkg/a.go', 'x := f() //nolint:errcheck', ['//nolint']],
    ['pkg/a_test.go', '\tt.Skip("나중에")', ['t.Skip(']],
    ['src/A.java', '@SuppressWarnings("unchecked")', ['@SuppressWarnings']],
    ['src/A.kt', '@Suppress("UNCHECKED_CAST")', ['@Suppress']],
    ['src/ATest.java', '@Disabled', ['@Disabled']],
    ['src/ATest.kt', '@Ignore fun old() {}', ['@Ignore']],
    ['src/lib.rs', '#[allow(dead_code)]', ['#[allow(']],
    ['src/lib.rs', '#![allow(clippy::all)]', ['#[allow(']],
    ['tests/a.rs', '#[ignore = "느림"]', ['#[ignore]']],
  ])('%s: %s', (path, line, expected) => {
    expect(markers(path, line)).toEqual(expected)
  })

  test('표식은 그 언어에서만 센다(# noqa는 JS에서, .skip(은 Python에서 세지 않는다)', () => {
    expect(markers('src/a.ts', 'const x = 1 // # noqa')).toEqual([])
    expect(markers('app/a.py', 'df.skip(3)  # @ts-ignore')).toEqual([])
    expect(markers('src/A.java', '#[allow(x)]')).toEqual([])
  })

  test('표에 없는 확장자는 세지 않는다', () => {
    expect(markers('README.md', '// @ts-ignore')).toEqual([])
    expect(markers('Makefile', '# noqa')).toEqual([])
  })

  test('한 줄에 둘이면 둘', () => {
    expect(markers('src/a.ts', '// @ts-ignore eslint-disable-line')).toEqual([
      'eslint-disable',
      '@ts-ignore',
    ])
  })

  test('이름의 일부는 표식이 아니다(@SuppressWarnings는 @Suppress가 아니고, @Ignored는 @Ignore가 아니다)', () => {
    expect(markers('src/A.kt', '@SuppressWarnings("x")')).toEqual(['@SuppressWarnings'])
    expect(markers('src/A.java', '@Ignored')).toEqual([])
    expect(markers('src/a.ts', 'exit(0); maxit(1)')).toEqual([])
  })

  test('무늬표의 모든 표식은 git grep이 먼저 거르는 글 가운데 하나를 담는다', () => {
    const samples = [
      'eslint-disable',
      '@ts-ignore',
      '@ts-expect-error',
      'a.skip(',
      'xit(',
      'xdescribe(',
      'xtest(',
      '# noqa',
      '# type: ignore',
      '@pytest.mark.skip',
      '//nolint',
      't.Skip(',
      '@SuppressWarnings',
      '@Suppress',
      '@Disabled',
      '@Ignore',
      '#[allow(',
      '#[ignore]',
    ]
    for (const s of samples)
      expect(
        GREP_NEEDLES.some((n) => s.toLowerCase().includes(n.toLowerCase())),
        s,
      ).toBe(true)
    const all = Object.values(MARKERS).flat().length
    expect(all).toBe(16)
  })
})

describe('글 안의 표식 (결정: 한 줄 글 안은 세지 않는다)', () => {
  test('따옴표 안의 표식은 세지 않는다', () => {
    expect(markers('src/a.ts', "const hint = 'add // @ts-ignore here'")).toEqual([])
    expect(markers('src/a.ts', 'const re = "it.skip(" + `xit(`')).toEqual([])
    expect(markers('app/a.py', "msg = '# noqa is bad'")).toEqual([])
    expect(markers('src/lib.rs', 'let s = "#[allow(x)]";')).toEqual([])
  })

  test('주석 속 따옴표는 표식을 가리지 않는다', () => {
    expect(markers('src/a.ts', "f() // don't @ts-ignore")).toEqual(['@ts-ignore'])
    expect(markers('app/a.py', "x = 'a'  # it's fine: noqa")).toEqual([])
    expect(markers('app/a.py', "x = 'a'  # noqa: don't")).toEqual(['# noqa'])
  })

  test('글 뒤의 표식은 센다. 이스케이프한 따옴표는 글을 닫지 않는다', () => {
    expect(markers('src/a.ts', "f('x') // @ts-ignore")).toEqual(['@ts-ignore'])
    expect(markers('src/a.ts', "f('it\\'s // @ts-ignore')")).toEqual([])
    expect(codePart("a('b') // 'c'", 'js')).toBe("a('') // 'c'")
  })

  test("Rust의 수명('a)은 글이 아니다", () => {
    expect(markers('src/lib.rs', "fn f<'a>(x: &'a str) {} #[allow(unused)]")).toEqual(['#[allow('])
  })
})

describe('기준과 견줌', () => {
  const at = (path: string, line: number, marker = '@ts-ignore', text = '// @ts-ignore') =>
    ({ path, line, marker, text }) as Suppression

  test('같으면 그대로, 줄면 나아짐(수와 함께)', () => {
    const base = [at('src/a.ts', 3), at('src/b.ts', 9)]
    expect(suppressionsRatchet(spec, base, [...base], { files: [] })).toEqual({
      id: 'suppressions',
      status: 'same',
      base: 2,
      head: 2,
      detail: '억누름 2 → 2',
    })
    const r = suppressionsRatchet(spec, base, [at('src/a.ts', 3)], { files: [change('src/b.ts')] })
    expect(r).toMatchObject({ status: 'better', base: 2, head: 1, detail: '억누름 2 → 1' })
  })

  test('늘면 나빠짐: 늘어난 파일과 새 표식(파일:줄 표식)을 알린다. 옮겨진 줄은 새 표식이 아니다', () => {
    const base = [at('src/api.ts', 10)]
    const head = [at('src/api.ts', 12), at('src/api.ts', 41, '@ts-ignore', '// @ts-ignore 새로')]
    const r = suppressionsRatchet(spec, base, head, { files: [change('src/api.ts')] })
    expect(r).toEqual({
      id: 'suppressions',
      status: 'worse',
      base: 1,
      head: 2,
      detail: '억누름 1 → 2: src/api.ts:41 @ts-ignore',
      offenders: [{ path: 'src/api.ts', base: 1, head: 2 }],
      where: ['src/api.ts:41 @ts-ignore'],
    })
  })

  test('새 파일의 표식은 base 없이 알리고, 옮긴 파일은 옛 자리와 견준다', () => {
    const base = [at('old/x.ts', 1)]
    const head = [at('new/x.ts', 1), at('src/n.ts', 2, '.skip(', "it.skip('a')")]
    const r = suppressionsRatchet(spec, base, head, {
      files: [change('new/x.ts', 'R', 'old/x.ts'), change('src/n.ts', 'A')],
    })
    expect(r.status).toBe('worse')
    expect(r.offenders).toEqual([{ path: 'src/n.ts', head: 1 }])
    expect(r.where).toEqual(['src/n.ts:2 .skip('])
  })

  test('새 표식이 여섯 넘으면 다섯과 남은 수만 보인다', () => {
    const head = Array.from({ length: 8 }, (_, i) =>
      at('src/m.ts', i + 1, '@ts-ignore', `// @ts-ignore ${i}`),
    )
    const r = suppressionsRatchet(spec, [], head, { files: [change('src/m.ts', 'A')] })
    expect(r.where).toHaveLength(6)
    expect(r.where?.at(-1)).toBe('+3 more')
    expect(r.detail).toBe(
      '억누름 0 → 8: src/m.ts:1 @ts-ignore, src/m.ts:2 @ts-ignore, src/m.ts:3 @ts-ignore 외 5개',
    )
  })

  test('늘 빼는 곳(node_modules, vendor, dist, build, target, .relay)과 exclude 밖, include 안만 센다', () => {
    const head = [
      at('node_modules/x/a.js', 1),
      at('vendor/y/a.go', 1, 't.Skip('),
      at('web/dist/a.js', 1),
      at('build/a.js', 1),
      at('rs/target/a.rs', 1),
      at('.relay/x.ts', 1),
      at('src/gen/a.ts', 1),
      at('lib/a.ts', 1),
      at('src/a.ts', 1),
    ]
    const r = suppressionsRatchet(
      { ...spec, include: ['src/**'], exclude: ['src/gen/**'] },
      [],
      head,
      { files: [change('src/a.ts')] },
    )
    expect(r).toMatchObject({ status: 'worse', base: 0, head: 1, where: ['src/a.ts:1 @ts-ignore'] })
  })
})

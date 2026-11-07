// [단위] 중복 래칫(V56, engine/duplication.ts): 토큰(이름·글·수를 지움, 공백·주석 버림, import 묶음 버림), 토큰 창으로 찾은
// 쌍(이름만 바꾼 복사, 짧은 복사와 '}'만 있는 줄은 세지 않음), 결정론, 기준과의 비교(같음·나아짐·나빠짐, 새 파일, ε).
// 실제 git의 base·head에서 재는 것은 [어댑터] ratchets.test.ts.
import { describe, expect, test } from 'vitest'
import type { FileChange } from '../../src/core/types.ts'
import {
  duplication,
  duplicationRatchet,
  EPSILON,
  scoped,
  tokenize,
  type DuplicationSpec,
} from '../../src/engine/duplication.ts'

const spec: DuplicationSpec = { id: 'duplication', kind: 'duplication' }

const ORIGINAL = `export function total(items, rate) {
  let sum = 0
  for (const item of items) {
    if (item.price > 100) {
      sum += item.price * rate
    } else {
      sum += item.price
    }
  }
  const rounded = Math.round(sum * 100) / 100
  return { sum: rounded, count: items.length }
}
`

// 이름, 글·수, 공백, 주석만 바꾼 복사
const RENAMED = `/** 다른 이름 */
export function amount(rows, factor) {
  let acc = 0 // 더한다
  for (const row of rows) {
    if (row.cost > 250) {
      acc += row.cost * factor
    }   else {
      acc   += row.cost
    }
  }
  const r = Math.floor(acc * 10) / 10
  return { sum: r, count: rows.length }
}
`

const OTHER = `export function parse(text) {
  const parts = text.split(',')
  return parts.map((p) => p.trim()).filter(Boolean)
}
`

const files = (o: Record<string, string>) => new Map(Object.entries(o))
const change = (path: string, status: FileChange['status'], added_at: number[]) =>
  ({
    path,
    status,
    added: added_at.length,
    deleted: 0,
    binary: false,
    added_lines: [],
    removed_lines: [],
    added_at,
  }) as FileChange

describe('토큰', () => {
  test('이름은 I, 글·수는 L, 낱말표는 그대로. 공백과 주석은 버린다', () => {
    const t = tokenize("const x = 'a' + 12 // 주석\n/* 블록\n주석 */ return y", 'js')
    expect(t.map((k) => k.t)).toEqual(['const', 'I', '=', 'L', '+', 'L', 'return', 'I'])
    expect(t.at(-1)?.line).toBe(3)
  })

  test('Python은 #이 주석이고 세 겹 따옴표 글은 여러 줄이다', () => {
    const t = tokenize('x = """a\nb"""  # c\ndef f(): pass', 'py')
    expect(t.map((k) => [k.t, k.line])).toEqual([
      ['I', 1],
      ['=', 1],
      ['L', 1],
      ['def', 3],
      ['I', 3],
      ['(', 3],
      [')', 3],
      [':', 3],
      ['I', 3],
    ])
  })

  test('import 묶음(여러 줄 포함)은 버린다', () => {
    const js = "import {\n  a,\n  b,\n} from './x.ts'\nimport c from 'c'\nconst y = a"
    expect(tokenize(js, 'js').map((k) => k.t)).toEqual(['const', 'I', '=', 'I'])
    const go = 'package main\n\nimport (\n  "fmt"\n  "os"\n)\n\nfunc f() {}'
    expect(tokenize(go, 'go').map((k) => k.t)).toEqual(['func', 'I', '(', ')', '{', '}'])
    expect(tokenize('from a import (\n  b,\n)\nx = 1', 'py').map((k) => k.t)).toEqual([
      'I',
      '=',
      'L',
    ])
  })
})

describe('중복 재기', () => {
  test('이름·글·수만 바꾼 복사를 찾는다', () => {
    const r = duplication(files({ 'src/a.js': ORIGINAL, 'src/b.js': RENAMED, 'src/c.js': OTHER }))
    expect(r.pairs).toEqual([
      { a: { path: 'src/b.js', from: 2, to: 12 }, b: { path: 'src/a.js', from: 1, to: 11 } },
    ])
    // '}'만 있는 줄은 코드 줄이 아니다: a.js 12줄 가운데 9줄, c.js 4줄 가운데 3줄
    expect(r.perFile).toEqual(
      new Map([
        ['src/a.js', 9],
        ['src/b.js', 9],
      ]),
    )
    expect(r).toMatchObject({ code: 21, dup: 18 })
    expect(r.share).toBeCloseTo(18 / 21)
  })

  test('짧은 복사(창보다 적은 토큰, 다섯 코드 줄 아래)는 중복이 아니다', () => {
    const short = 'export function f(a) {\n  return a + 1\n}\n'
    const r = duplication(files({ 'src/a.js': short, 'src/b.js': short }))
    expect(r).toMatchObject({ dup: 0, pairs: [] })
    // 토큰은 창보다 많지만 한 줄에 몰린 복사도 다섯 줄이 안 되면 세지 않는다
    const wide = `${Array.from({ length: 30 }, (_, i) => `f(x${i})`).join('; ')}\n`
    expect(duplication(files({ 'src/a.js': wide, 'src/b.js': wide })).dup).toBe(0)
  })

  test('import만 같은 파일은 중복이 아니다', () => {
    const imports = Array.from({ length: 12 }, (_, i) => `import { n${i} } from './m${i}.ts'`)
    const a = `${imports.join('\n')}\nexport const a = n0\n`
    const b = `${imports.join('\n')}\nexport const b = n1\n`
    expect(duplication(files({ 'src/a.ts': a, 'src/b.ts': b })).dup).toBe(0)
  })

  test('한 파일 안의 반복도 찾는다(겹치지 않는 자리만)', () => {
    const r = duplication(files({ 'src/a.js': `${ORIGINAL}\n${ORIGINAL}` }))
    expect(r.pairs).toEqual([
      { a: { path: 'src/a.js', from: 14, to: 24 }, b: { path: 'src/a.js', from: 1, to: 11 } },
    ])
  })

  test('같은 입력이면 넣은 차례와 상관없이 같은 값이다', () => {
    const one = duplication(files({ 'src/b.js': RENAMED, 'src/a.js': ORIGINAL }))
    const two = duplication(files({ 'src/a.js': ORIGINAL, 'src/b.js': RENAMED }))
    expect(one).toEqual(two)
  })

  test('범위: 시험 파일 glob, 늘 빼는 곳, exclude 밖, include 안, 표에 있는 언어만', () => {
    const all = files({
      'src/a.js': '',
      'src/a.test.js': '',
      'node_modules/x/a.js': '',
      'src/gen/a.js': '',
      'lib/a.js': '',
      'src/a.md': '',
    })
    const s = scoped(all, { ...spec, include: ['src/**'], exclude: ['src/gen/**'] }, [
      '**/*.test.*',
    ])
    expect([...s.keys()]).toEqual(['src/a.js'])
  })
})

describe('기준과 견줌', () => {
  const base = duplication(files({ 'src/a.js': ORIGINAL, 'src/c.js': OTHER }))

  test('같으면 그대로(값은 백분율)', () => {
    expect(duplicationRatchet(spec, base, base, { files: [] })).toEqual({
      id: 'duplication',
      status: 'same',
      base: 0,
      head: 0,
      detail: '중복 0.0% → 0.0% (중복 줄 0/12 → 0/12)',
    })
  })

  test('새 파일이 복사면 나빠짐: 새 쌍과 그 파일을 알린다', () => {
    const head = duplication(
      files({ 'src/a.js': ORIGINAL, 'src/b.js': RENAMED, 'src/c.js': OTHER }),
    )
    const r = duplicationRatchet(spec, base, head, {
      files: [
        change(
          'src/b.js',
          'A',
          Array.from({ length: 13 }, (_, i) => i + 1),
        ),
      ],
    })
    expect(r).toEqual({
      id: 'duplication',
      status: 'worse',
      base: 0,
      head: 85.7,
      detail: '중복 0.0% → 85.7% (중복 줄 0/12 → 18/21): src/b.js:2-12 ↔ src/a.js:1-11',
      offenders: [{ path: 'src/b.js', head: 9 }],
      where: ['src/b.js:2-12 duplicates src/a.js:1-11'],
    })
  })

  test('중복을 없애면 나아짐', () => {
    const head = duplication(files({ 'src/a.js': ORIGINAL, 'src/b.js': RENAMED }))
    const after = duplication(files({ 'src/a.js': ORIGINAL }))
    expect(duplicationRatchet(spec, head, after, { files: [] }).status).toBe('better')
  })

  test(`몫이 ε(${EPSILON * 100}%p) 넘게 올라도 중복 줄이 늘지 않으면(코드를 지우기만 함) 그대로`, () => {
    const big = duplication(files({ 'src/a.js': ORIGINAL, 'src/b.js': RENAMED, 'src/c.js': OTHER }))
    const fewer = duplication(files({ 'src/a.js': ORIGINAL, 'src/b.js': RENAMED }))
    expect(fewer.share).toBeGreaterThan(big.share + EPSILON)
    expect(duplicationRatchet(spec, big, fewer, { files: [] }).status).toBe('same')
  })

  test('ε 안의 오름은 그대로', () => {
    const at = (share: number, dup: number) => ({ ...base, share, dup })
    expect(duplicationRatchet(spec, at(0.02, 20), at(0.0205, 21), { files: [] }).status).toBe(
      'same',
    )
    expect(duplicationRatchet(spec, at(0.02, 20), at(0.0211, 22), { files: [] }).status).toBe(
      'worse',
    )
  })
})

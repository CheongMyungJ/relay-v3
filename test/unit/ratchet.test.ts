import { describe, expect, test } from 'vitest'
import {
  commandRatchet,
  fileLinesRatchet,
  lastNumber,
  testCountRatchet,
  type CommandRatchetSpec,
  type FileLinesSpec,
} from '../../src/core/ratchet.ts'
import type { TestCase, TestStatus } from '../../src/core/types.ts'

const size: FileLinesSpec = { id: 'file-size', kind: 'file_lines', max: 600 }

function file(path: string, base: number | null, head: number | null) {
  return { path, base, head }
}

describe('파일 크기 상한', () => {
  test.each([
    ['새 파일이 상한을 넘음', null, 601, 'worse'],
    ['상한 안이던 파일이 넘음', 590, 610, 'worse'],
    ['이미 넘은 파일이 더 커짐', 700, 701, 'worse'],
    ['이미 넘은 파일이 그대로', 700, 700, 'same'],
    ['이미 넘은 파일이 줄었지만 아직 넘음', 700, 650, 'better'],
    ['넘던 파일이 상한 안으로 들어옴', 700, 600, 'better'],
    ['넘던 파일을 지움', 700, null, 'better'],
    ['상한과 같은 줄 수는 넘지 않음', 500, 600, 'same'],
    ['상한 안에서 커짐', 100, 599, 'same'],
    ['상한 안의 파일을 지움', 100, null, 'same'],
  ] as const)('%s → %s', (_name, base, head, status) => {
    expect(fileLinesRatchet(size, [file('src/a.ts', base, head)]).status).toBe(status)
  })

  test('나빠진 파일을 offender로 알리고 새 파일에는 base를 적지 않는다', () => {
    const r = fileLinesRatchet(size, [
      file('src/new.ts', null, 650),
      file('src/old.ts', 700, 720),
      file('src/ok.ts', 10, 20),
    ])
    expect(r).toEqual({
      id: 'file-size',
      status: 'worse',
      detail: '600줄을 넘음: src/new.ts(650), src/old.ts(700→720)',
      offenders: [
        { path: 'src/new.ts', head: 650 },
        { path: 'src/old.ts', base: 700, head: 720 },
      ],
    })
  })

  test('한 파일이 나빠지면 다른 파일이 좋아져도 나빠짐이다', () => {
    const r = fileLinesRatchet(size, [file('a.ts', 900, 500), file('b.ts', 10, 700)])
    expect(r.status).toBe('worse')
    expect(r.offenders?.map((o) => o.path)).toEqual(['b.ts'])
  })

  test('좋아진 파일을 detail에 적는다', () => {
    const r = fileLinesRatchet(size, [file('a.ts', 900, 650), file('b.ts', 800, null)])
    expect(r).toEqual({
      id: 'file-size',
      status: 'better',
      detail: '600줄을 넘던 파일이 줄어듦: a.ts(900→650), b.ts(800→지움)',
    })
  })

  test('바뀐 파일이 없으면 그대로다', () => {
    expect(fileLinesRatchet(size, [])).toEqual({
      id: 'file-size',
      status: 'same',
      detail: '600줄을 새로 넘은 파일 없음',
    })
  })

  test('include에 맞는 파일만 본다', () => {
    const spec: FileLinesSpec = { ...size, include: ['src/**'] }
    expect(fileLinesRatchet(spec, [file('docs/big.md', null, 2000)]).status).toBe('same')
    expect(fileLinesRatchet(spec, [file('src/big.ts', null, 2000)]).status).toBe('worse')
  })

  test('빈 include는 모든 파일을 본다', () => {
    const spec: FileLinesSpec = { ...size, include: [] }
    expect(fileLinesRatchet(spec, [file('docs/big.md', null, 2000)]).status).toBe('worse')
  })

  test('exclude에 맞는 파일은 include에 맞아도 뺀다', () => {
    const spec: FileLinesSpec = { ...size, include: ['src/**'], exclude: ['**/*.gen.ts'] }
    expect(fileLinesRatchet(spec, [file('src/api.gen.ts', null, 5000)]).status).toBe('same')
  })

  test('셀 수 없는 줄 수(NaN, 음수, 소수)는 지운 것이 아니라 모름이다', () => {
    expect(fileLinesRatchet(size, [file('big.ts', 900, Number.NaN)])).toEqual({
      id: 'file-size',
      status: 'unknown',
      detail: '줄 수를 셀 수 없음: big.ts',
    })
    expect(fileLinesRatchet(size, [file('a.ts', Number.NaN, 700)]).status).toBe('unknown')
    expect(fileLinesRatchet(size, [file('a.ts', 10, -1)]).status).toBe('unknown')
    expect(fileLinesRatchet(size, [file('a.ts', 10, 1.5)]).status).toBe('unknown')
  })

  test('셀 수 없는 파일이 있어도 나빠진 파일이 있으면 나빠짐이다', () => {
    const r = fileLinesRatchet(size, [file('a.ts', 900, Number.NaN), file('b.ts', null, 700)])
    expect(r.status).toBe('worse')
  })

  test('범위 밖 파일은 셀 수 없어도 보지 않는다', () => {
    const spec: FileLinesSpec = { ...size, exclude: ['**/*.lock'] }
    expect(fileLinesRatchet(spec, [file('a.lock', 1, Number.NaN)]).status).toBe('same')
  })

  test('나빠진 파일이 많으면 다섯 개까지 이름을 쓴다', () => {
    const files = [1, 2, 3, 4, 5, 6, 7].map((n) => file(`f${n}.ts`, null, 700))
    const r = fileLinesRatchet(size, files)
    expect(r.detail).toBe(
      '600줄을 넘음: f1.ts(700), f2.ts(700), f3.ts(700), f4.ts(700), f5.ts(700) 외 2개',
    )
    expect(r.offenders).toHaveLength(7)
  })
})

function cases(...statuses: TestStatus[]): TestCase[] {
  return statuses.map((status, i) => ({ name: `t${i}`, status }))
}

describe('시험 수', () => {
  const spec = { id: 'tests', kind: 'test_count' } as const

  test('건너뜀을 뺀 수가 줄면 나빠짐이다', () => {
    const r = testCountRatchet(
      spec,
      cases('passed', 'passed', 'failed'),
      cases('passed', 'skipped'),
    )
    expect(r).toEqual({
      id: 'tests',
      status: 'worse',
      base: 3,
      head: 1,
      detail: '기준에서 돌던 시험이 사라짐: t1, t2 (시험 수 3 → 1)',
    })
  })

  test('수가 같아도 기준에서 돌던 시험이 사라지면 나빠짐이다(주석으로 끄고 하나 더함)', () => {
    const base = [{ name: '더하기', status: 'passed' as const }]
    const head = [{ name: '빼기 [w:C1.1]', status: 'passed' as const }]
    expect(testCountRatchet(spec, base, head)).toEqual({
      id: 'tests',
      status: 'worse',
      base: 1,
      head: 1,
      detail: '기준에서 돌던 시험이 사라짐: 더하기 (시험 수 1 → 1)',
    })
  })

  test('head에서 건너뛴 시험도 사라진 것으로 본다', () => {
    const r = testCountRatchet(spec, cases('passed', 'passed'), [
      ...cases('passed', 'skipped'),
      { name: 'new', status: 'passed' },
    ])
    expect(r).toMatchObject({
      status: 'worse',
      detail: '기준에서 돌던 시험이 사라짐: t1 (시험 수 2 → 2)',
    })
  })

  test('파일을 옮겨 classname이 달라져도 같은 이름이면 사라진 것이 아니다', () => {
    const base = [{ name: 'x', classname: 'test/a.test.ts', status: 'passed' as const }]
    const head = [{ name: 'x', classname: 'test/b.test.ts', status: 'passed' as const }]
    expect(testCountRatchet(spec, base, head).status).toBe('same')
  })

  test('suite가 다르면 다른 시험이다', () => {
    const base = [{ name: 'x', suite: '묶음 A', status: 'passed' as const }]
    const head = [{ name: 'x', suite: '묶음 B', status: 'passed' as const }]
    expect(testCountRatchet(spec, base, head).detail).toBe(
      '기준에서 돌던 시험이 사라짐: 묶음 A > x (시험 수 1 → 1)',
    )
  })

  test('기준에서 건너뛴 시험은 head에 없어도 된다', () => {
    const r = testCountRatchet(spec, cases('passed', 'skipped'), cases('passed'))
    expect(r.status).toBe('same')
  })

  test('실패와 오류도 센다', () => {
    const r = testCountRatchet(spec, cases('passed'), cases('failed', 'error'))
    expect(r).toMatchObject({ status: 'better', base: 1, head: 2 })
  })

  test('같으면 그대로다', () => {
    const r = testCountRatchet(spec, cases('passed', 'skipped'), cases('passed'))
    expect(r).toMatchObject({ status: 'same', base: 1, head: 1 })
  })

  test('시험을 건너뛰게 바꾸면 줄어든 것으로 센다', () => {
    const r = testCountRatchet(spec, cases('passed', 'passed'), cases('passed', 'skipped'))
    expect(r.status).toBe('worse')
  })

  test('양쪽 모두 비어 있으면 그대로다', () => {
    expect(testCountRatchet(spec, [], []).status).toBe('same')
  })

  test.each([
    ['기준', null, cases('passed'), '기준 시험 결과가 없음'],
    ['head', cases('passed'), null, 'head 시험 결과가 없음'],
    ['양쪽', null, null, '양쪽 시험 결과가 없음'],
  ] as const)('%s 결과가 없으면 모름이다', (_name, base, head, detail) => {
    expect(testCountRatchet(spec, base, head)).toEqual({ id: 'tests', status: 'unknown', detail })
  })
})

describe('명령 지표', () => {
  const lower: CommandRatchetSpec = {
    id: 'lint-errors',
    kind: 'command',
    run: 'x',
    better: 'lower',
  }
  const higher: CommandRatchetSpec = { ...lower, id: 'coverage', better: 'higher' }

  test.each([
    [lower, '3', '5', 'worse'],
    [lower, '5', '3', 'better'],
    [lower, '4', '4', 'same'],
    [higher, '80.5', '79.9', 'worse'],
    [higher, '80', '81', 'better'],
  ] as const)('%# 방향에 따라 판정한다 (%s → %s)', (spec, base, head, status) => {
    expect(commandRatchet(spec, base, head).status).toBe(status)
  })

  test('값과 방향을 detail에 적는다', () => {
    expect(commandRatchet(lower, 'errors:\n3\n', 'errors:\n5\n')).toEqual({
      id: 'lint-errors',
      status: 'worse',
      base: 3,
      head: 5,
      detail: 'lint-errors(낮을수록 좋음) 3 → 5',
    })
  })

  test('기준 출력이 없으면 모름이다', () => {
    expect(commandRatchet(lower, null, '3')).toEqual({
      id: 'lint-errors',
      status: 'unknown',
      head: 3,
      detail: '기준 출력이 없음',
    })
  })

  test('숫자를 읽지 못하면 모름이고 읽은 쪽 값은 남긴다', () => {
    expect(commandRatchet(lower, '2', 'error: crashed')).toEqual({
      id: 'lint-errors',
      status: 'unknown',
      base: 2,
      detail: 'head 출력에서 숫자를 읽지 못함',
    })
  })

  test('양쪽 모두 읽지 못하면 둘 다 적는다', () => {
    expect(commandRatchet(lower, '', null).detail).toBe(
      '기준 출력에서 숫자를 읽지 못함, head 출력이 없음',
    )
  })
})

describe('마지막 숫자 줄', () => {
  test.each([
    ['42', 42],
    ['a\n12\nb\n7\n', 7],
    ['  -3  \r\n', -3],
    ['1.5e3', 1500],
    ['.5', 0.5],
    ['+2', 2],
    ['found 3 errors\n4\nsummary: 9 files', 4],
  ])('%j → %d', (out, n) => {
    expect(lastNumber(out)).toBe(n)
  })

  test.each([[''], ['no numbers'], ['3 errors'], ['1,000'], ['0x10'], ['Infinity'], ['1e999']])(
    '숫자 줄이 없으면 null (%j)',
    (out) => {
      expect(lastNumber(out)).toBeNull()
    },
  )
})

import { describe, expect, test } from 'vitest'
import { classify, needsBase, needsRerun } from '../../src/core/flaky.ts'
import type { CommandRun } from '../../src/core/types.ts'

function run(exit: number | null, timed_out = false, sha = 'head'): CommandRun {
  return {
    id: 'lint',
    sha,
    exit,
    timed_out,
    duration_ms: 10,
    stdout_tail: '',
    stderr_tail: '',
  }
}

const ok = run(0)
const bad = run(1)
const timeout = run(null, true)
const baseOk = run(0, false, 'base')
const baseBad = run(2, false, 'base')

describe('classify (V7)', () => {
  test('head 실행이 없으면 not_run', () => {
    expect(classify([], undefined)).toBe('not_run')
    expect(classify([], baseOk)).toBe('not_run')
  })

  test('첫 실행이 통과하면 pass', () => {
    expect(classify([ok], undefined)).toBe('pass')
    expect(classify([ok], baseBad)).toBe('pass')
  })

  test('첫 실행이 실패하고 다시 돌려 통과하면 unstable', () => {
    expect(classify([bad, ok], undefined)).toBe('unstable')
    expect(classify([bad, ok], baseBad)).toBe('unstable')
  })

  test('두 번 실패하고 base가 없으면 fail', () => {
    expect(classify([bad, bad], undefined)).toBe('fail')
  })

  test('두 번 실패하고 base에서도 실패하면 pre_existing', () => {
    expect(classify([bad, bad], baseBad)).toBe('pre_existing')
  })

  test('두 번 실패하고 base에서 통과하면 fail', () => {
    expect(classify([bad, bad], baseOk)).toBe('fail')
  })

  test('head가 한 번뿐이고 실패하면 base로 같은 규칙을 쓴다', () => {
    expect(classify([bad], undefined)).toBe('fail')
    expect(classify([bad], baseBad)).toBe('pre_existing')
    expect(classify([bad], baseOk)).toBe('fail')
  })

  test('종료 코드 0이어도 시간이 넘었으면 통과가 아니다', () => {
    const lateZero = run(0, true)
    expect(classify([lateZero], undefined)).toBe('fail')
    expect(classify([lateZero, ok], undefined)).toBe('unstable')
    expect(classify([bad, lateZero], undefined)).toBe('fail')
  })

  test('시간 초과도 실패로 세어 다시 돌리고 base와 견준다', () => {
    expect(classify([timeout, ok], undefined)).toBe('unstable')
    expect(classify([timeout, timeout], baseBad)).toBe('pre_existing')
  })

  test('base가 시간 초과나 신호로 끝났으면 실패를 확인한 것이 아니라 fail', () => {
    expect(classify([bad, bad], run(null, true, 'base'))).toBe('fail')
    expect(classify([bad, bad], run(null, false, 'base'))).toBe('fail')
    expect(classify([bad, bad], run(1, true, 'base'))).toBe('fail')
  })

  test('세 번째 이후 실행은 보지 않는다', () => {
    expect(classify([bad, bad, ok], undefined)).toBe('fail')
  })
})

describe('needsRerun', () => {
  test('첫 실행이 통과하면 다시 돌리지 않는다', () => {
    expect(needsRerun(ok)).toBe(false)
  })

  test('실패, 시간 초과, 신호로 끝난 실행은 다시 돌린다', () => {
    expect(needsRerun(bad)).toBe(true)
    expect(needsRerun(timeout)).toBe(true)
    expect(needsRerun(run(null))).toBe(true)
    expect(needsRerun(run(0, true))).toBe(true)
  })
})

describe('needsBase', () => {
  test('head 실행이 없으면 base도 돌리지 않는다', () => {
    expect(needsBase([])).toBe(false)
  })

  test('첫 실행이 통과하면 base가 필요 없다', () => {
    expect(needsBase([ok])).toBe(false)
  })

  test('다시 돌려 통과했으면 base가 필요 없다', () => {
    expect(needsBase([bad, ok])).toBe(false)
  })

  test('두 번 실패하면 base에서 돌린다', () => {
    expect(needsBase([bad, bad])).toBe(true)
    expect(needsBase([bad, timeout])).toBe(true)
  })

  test('한 번만 돌렸고 실패했으면 base에서 돌린다', () => {
    expect(needsBase([bad])).toBe(true)
  })

  test('needsBase가 거짓이면 classify는 base를 보지 않는다', () => {
    for (const head of [[], [ok], [bad, ok]]) {
      expect(needsBase(head)).toBe(false)
      expect(classify(head, baseBad)).toBe(classify(head, undefined))
    }
  })
})

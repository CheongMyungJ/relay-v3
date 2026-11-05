// [단위] 제출 때 기준 확인(V28): core probeVerdicts(증거의 기준 쪽 규칙으로 바뀜·지킴 줄을 봄)와 세션에 돌려보내는 오류 글
// (main works-probe.ts probeErrors, 영어). 실제 기준 실행은 [흐름] probe.test.ts, 제출 창구는 [흐름] works-probe.test.ts.
import { describe, expect, test } from 'vitest'
import { probeVerdicts } from '../../src/core/lines.ts'
import type {
  Contract,
  ContractLine,
  ContractProbe,
  LineKind,
  TestCase,
  TestStatus,
} from '../../src/core/types.ts'
import { probeErrors, probeProblems } from '../../src/main/works-probe.ts'

function line(id: string, kind: LineKind, examples: string[]): ContractLine {
  const check = kind === 'human' ? 'human' : kind === 'observe' ? 'observe' : 'test'
  return { id, kind, text: `${id} 줄`, grounds: [], examples, check }
}

function contract(...lines: ContractLine[]): Contract {
  return {
    version: 1,
    id: 'w-1',
    goal: '목표',
    lines,
    non_goals: [],
    human_rules: [],
    examples: lines.flatMap((l) => l.examples.map((id) => ({ id, input: null }))),
    tidy: [],
  }
}

const FILE = 'test/a.test.js'

/** head에서 찾은 태그(돌리지 않음: file만 본다) */
const tagged = (ids: string[], file = FILE): TestCase[] =>
  ids.map((id) => ({ name: `[w-1:${id}]`, file, status: 'passed' }))

/** 기준의 testcase. 이름 속 `[C1.1]`은 `[w-1:C1.1]`로 */
function tc(name: string, status: TestStatus, extra: Partial<TestCase> = {}): TestCase {
  return { name: name.replace(/\[(C\d+\.\d+)\]/g, '[w-1:$1]'), status, ...extra }
}

describe('probeVerdicts: 바뀜 줄', () => {
  const change = line('C1', 'change', ['C1.1', 'C1.2'])

  test('예시가 모두 기준에서도 통과하면 not_met(돌려보냄)', () => {
    const [v] = probeVerdicts(
      contract(change),
      [tc('[C1.1]', 'passed'), tc('[C1.2]', 'passed')],
      tagged(['C1.1', 'C1.2']),
    )
    expect(v).toMatchObject({ line: 'C1', status: 'not_met' })
    expect(v?.detail).toContain('기준에서도 통과')
  })

  test('하나라도 기준에서 실패하면 met이고 실패 예시에 JUnit 메시지를 붙인다', () => {
    const [v] = probeVerdicts(
      contract(change),
      [tc('[C1.1]', 'failed', { message: '0 !== 10' }), tc('[C1.2]', 'passed')],
      tagged(['C1.1', 'C1.2']),
    )
    expect(v?.status).toBe('met')
    expect(v?.examples).toEqual([
      { id: 'C1.1', head: 'passed', base: 'failed', message: '0 !== 10' },
      { id: 'C1.2', head: 'passed', base: 'passed' },
    ])
  })

  test('태그 시험이 없는 예시가 있으면 나머지가 기준에서 통과해도 돌려보내지 않는다(확인 안 함)', () => {
    const [v] = probeVerdicts(contract(change), [tc('[C1.1]', 'passed')], tagged(['C1.1']))
    expect(v?.status).toBe('missing_evidence')
    expect(v?.examples[1]).toEqual({ id: 'C1.2', head: 'missing', base: 'not_run' })
  })

  test('줄에 태그 시험이 하나도 없으면 확인 안 함', () => {
    const [v] = probeVerdicts(contract(change), [], tagged(['C9.1']))
    expect(v).toMatchObject({
      status: 'missing_evidence',
      detail: '태그를 단 시험이 없어 확인 안 함',
    })
  })

  test('기준에서 그 시험 파일을 불러오지 못하면(새 API) 바뀜 줄은 받고, 파일과 메시지를 적는다', () => {
    const [v] = probeVerdicts(
      contract(line('C1', 'change', ['C1.1'])),
      [tc(FILE, 'failed', { message: 'test failed' })],
      tagged(['C1.1']),
    )
    expect(v?.status).toBe('met')
    expect(v?.examples[0]).toEqual({
      id: 'C1.1',
      head: 'passed',
      base: 'missing',
      message: `${FILE}: test failed`,
    })
  })
})

describe('probeVerdicts: 지킴 줄', () => {
  const keep = line('C2', 'keep', ['C2.1', 'C2.2'])

  test('예시 하나가 기준에서 실패하면 not_met(태그 시험이 없는 예시가 있어도)', () => {
    const [v] = probeVerdicts(
      contract(keep),
      [tc('[C2.1]', 'failed', { message: '5 !== 6' })],
      tagged(['C2.1']),
    )
    expect(v).toMatchObject({ status: 'not_met' })
    expect(v?.examples[0]).toMatchObject({ base: 'failed', message: '5 !== 6' })
  })

  test('모두 기준에서 통과하면 met', () => {
    const [v] = probeVerdicts(
      contract(keep),
      [tc('[C2.1]', 'passed'), tc('[C2.2]', 'passed')],
      tagged(['C2.1', 'C2.2']),
    )
    expect(v?.status).toBe('met')
  })

  test('그 시험 파일을 기준에서 불러오지 못하면 not_met(지킴 시험이 기준에 없는 것을 씀)', () => {
    const [v] = probeVerdicts(
      contract(keep),
      [tc(FILE, 'failed', { classname: 'test', message: 'test failed' })],
      tagged(['C2.1', 'C2.2']),
    )
    expect(v).toMatchObject({
      status: 'not_met',
      detail: '기준에서 시험 파일을 불러오지 못함 (C2.1, C2.2)',
    })
    expect(v?.examples[0]?.message).toBe(`${FILE}: test failed`)
  })

  test('다른 파일을 불러오지 못한 것이나 기준 결과에 없는 것만으로는 돌려보내지 않는다', () => {
    const other = [tc('test/other.test.js', 'failed')]
    const [v] = probeVerdicts(contract(keep), other, tagged(['C2.1']))
    expect(v?.status).toBe('missing_evidence')
    expect(v?.examples[0]).toEqual({ id: 'C2.1', head: 'passed', base: 'missing' })
  })
})

test('probeVerdicts: 바뀜·지킴 줄만 본다(new, remove, observe, human은 돌리지 않는다)', () => {
  const c = contract(
    line('C1', 'new', ['C1.1']),
    line('C2', 'remove', ['C2.1']),
    line('C3', 'observe', []),
    line('C4', 'human', []),
    line('C5', 'keep', ['C5.1']),
  )
  const vs = probeVerdicts(c, [tc('[C5.1]', 'passed')], tagged(['C1.1', 'C5.1']))
  expect(vs.map((v) => [v.line, v.status])).toEqual([['C5', 'met']])
})

describe('probeErrors: 세션에 돌려보내는 글(영어)', () => {
  const probe = (lines: ContractProbe['lines']): ContractProbe => ({
    head: 'a'.repeat(40),
    base: 'b'.repeat(40),
    contract: 'h',
    ran: true,
    note: null,
    lines,
    ms: 10,
  })
  const c = contract(line('C1', 'change', ['C1.1', 'C1.2']), line('C2', 'keep', ['C2.1', 'C2.2']))

  test('줄마다 까닭과 예시마다 기준의 결과·메시지, 앞에 무엇을 돌렸는지 한 줄', () => {
    const p = probe(
      probeVerdicts(
        c,
        [tc('[C1.1]', 'passed'), tc('[C2.1]', 'failed', { message: 'Expected 5 !== 6' })],
        tagged(['C1.1', 'C2.1']),
      ),
    )
    // C1은 C1.2에 태그 시험이 없어 확인 안 함이다. C2는 C2.1이 기준에서 실패한다
    expect(probeProblems(p).map((v) => v.line)).toEqual(['C2'])
    expect(probeErrors(p)).toEqual([
      "relay ran the acceptance command on the base bbbbbbb with the changed test files of head aaaaaaa and this contract's examples in place. Lines without tagged tests are not checked.",
      'C2 (keep): an example fails on the base bbbbbbb, so the test checks changed behavior, not kept behavior. On the base: C2.1 failed: "Expected 5 !== 6"; C2.2 no tagged test, not checked.',
    ])
  })

  test('바뀜 줄의 예시가 모두 통과, 지킴 시험 파일을 불러오지 못함. 긴 메시지는 자른다', () => {
    const long = `x${'y'.repeat(400)}`
    const p = probe(
      probeVerdicts(
        c,
        [tc('[C1.1]', 'passed'), tc('[C1.2]', 'passed'), tc(FILE, 'failed', { message: long })],
        [...tagged(['C1.1', 'C1.2'], 'test/c.test.js'), ...tagged(['C2.1', 'C2.2'])],
      ),
    )
    const [, change, keep] = probeErrors(p)
    expect(change).toBe(
      'C1 (change): no example fails on the base bbbbbbb, so the tagged tests do not show the changed behavior. On the base: C1.1 passed; C1.2 passed.',
    )
    expect(keep).toContain(
      'C2 (keep): the test file does not load on the base bbbbbbb; a keep test can use only what the base has. On the base: C2.1 its test file did not load: "test/a.test.js: xyyy',
    )
    expect(keep).toContain('…"; C2.2 its test file did not load')
    expect(keep?.length).toBeLessThan(900)
  })
})

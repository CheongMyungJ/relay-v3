import { describe, expect, test } from 'vitest'
import {
  allLinesTestedAndMet,
  applyExampleMismatch,
  confirmFailures,
  judgeLines,
} from '../../src/core/lines.ts'
import type {
  Contract,
  ContractLine,
  LineKind,
  LineVerdict,
  TestCase,
  TestStatus,
} from '../../src/core/types.ts'

function line(
  id: string,
  kind: LineKind,
  examples: string[],
  check?: ContractLine['check'],
): ContractLine {
  const fallback = kind === 'human' ? 'human' : kind === 'observe' ? 'observe' : 'test'
  return { id, kind, text: `${id} 줄`, grounds: [], examples, check: check ?? fallback }
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

/** 이름 속 `[C1.1]`은 이 계약(w-1)의 태그 `[w-1:C1.1]`로 바꿔 쓴다. 그대로 두려면 raw를 쓴다 */
function tc(name: string, status: TestStatus, extra: Partial<TestCase> = {}): TestCase {
  return { name: name.replace(/\[(C\d+\.\d+)\]/g, '[w-1:$1]'), status, ...extra }
}

function raw(name: string, status: TestStatus, extra: Partial<TestCase> = {}): TestCase {
  return { name, status, ...extra }
}

/** 줄 하나를 판정한다 */
function one(l: ContractLine, head: TestCase[] | null, base: TestCase[] | null): LineVerdict {
  const [v] = judgeLines(contract(l), head, base)
  if (v === undefined) throw new Error('판정이 없음')
  return v
}

describe('judgeLines: 바뀜(change)', () => {
  const change = line('C1', 'change', ['C1.1'])

  test('결과에서 통과하고 기준에서 단언이 실패하면 met', () => {
    const v = one(change, [tc('합 [C1.1]', 'passed')], [tc('합 [C1.1]', 'failed')])
    expect(v).toEqual({
      line: 'C1',
      kind: 'change',
      status: 'met',
      detail: '기준에서 실패, 결과에서 통과',
      examples: [{ id: 'C1.1', head: 'passed', base: 'failed' }],
    })
  })

  test('기준을 돌리지 않았으면 결과만으로 met이되 기준 실패를 확인하지 못했다고 적는다', () => {
    const v = one(change, [tc('[C1.1]', 'passed')], null)
    expect(v.status).toBe('met')
    expect(v.detail).toContain('기준 실패를 확인하지 못함')
    expect(v.examples).toEqual([{ id: 'C1.1', head: 'passed', base: 'not_run' }])
  })

  test('예시가 모두 기준에서도 통과하면 바뀐 동작을 시험하지 않은 것이라 not_met', () => {
    const v = one(change, [tc('[C1.1]', 'passed')], [tc('[C1.1]', 'passed')])
    expect(v.status).toBe('not_met')
    expect(v.detail).toContain('기준에서도 통과: 바뀐 동작을 시험하지 않음')
    expect(v.detail).toContain('C1.1')
  })

  test('하나 이상이 기준에서 실패하면 met이고, 기준에서도 통과한 예시는 지킴으로 적는다(M2 평가 배치 1)', () => {
    const two = line('C1', 'change', ['C1.1', 'C1.2'])
    const head = [tc('토 [C1.1]', 'passed'), tc('일 [C1.2]', 'passed')]
    const v = one(two, head, [tc('토 [C1.1]', 'failed'), tc('일 [C1.2]', 'passed')])
    expect(v.status).toBe('met')
    expect(v.detail).toBe('결과에서 통과. 기준에서도 통과(지킴): C1.2')
    // 기준에서 통과한 것 말고는 기준 실패를 확인하지 못했으면 증거 없음 그대로
    const unconfirmed = one(two, head, [tc('일 [C1.2]', 'passed')])
    expect(unconfirmed.status).toBe('missing_evidence')
    // 결과에서 하나라도 실패하면 기준과 상관없이 not_met
    const headFail = one(two, [tc('토 [C1.1]', 'passed'), tc('일 [C1.2]', 'failed')], head)
    expect(headFail.status).toBe('not_met')
  })

  test('기준에서 오류면(새 이름을 못 불러옴) met으로 보되 적는다', () => {
    const v = one(change, [tc('[C1.1]', 'passed')], [tc('[C1.1]', 'error')])
    expect(v.status).toBe('met')
    expect(v.detail).toContain('C1.1: 기준에서 오류')
    expect(v.examples[0]?.base).toBe('error')
  })

  test('vitest: 기준에서 같은 시험 파일을 불러오지 못했으면(파일 단위 실패) met이되 적는다', () => {
    const file = 'test/b.test.ts'
    const head = [tc('묶음 > [C1.1] x', 'passed', { classname: file })]
    const base = [raw(file, 'failed', { classname: file })]
    const v = one(change, head, base)
    expect(v.status).toBe('met')
    expect(v.detail).toBe('결과에서 통과. C1.1: 기준에서 시험 파일을 불러오지 못함')
    expect(v.examples[0]?.base).toBe('missing')
  })

  test('vitest: 불러오지 못한 파일이 다른 파일이면 기준 실패를 확인하지 못한 것이라 증거 없음', () => {
    const head = [tc('[C1.1] x', 'passed', { classname: 'test/a.test.ts' })]
    const base = [raw('test/other.test.ts', 'failed', { classname: 'test/other.test.ts' })]
    const v = one(change, head, base)
    expect(v.status).toBe('missing_evidence')
    expect(v.detail).toBe('기준 실패를 확인하지 못함: C1.1(기준에 그 시험이 없음)')
  })

  test('node:test: 파일을 모르면 파일 단위 실패가 하나라도 있을 때 met이되 파일은 확인하지 못했다고 적는다', () => {
    const head = [tc('[C1.1]', 'passed', { classname: 'test' })]
    const base = [raw('test/sum.test.mjs', 'failed', { classname: 'test' })]
    const v = one(change, head, base)
    expect(v.status).toBe('met')
    expect(v.detail).toContain('파일은 확인하지 못함')
  })

  test('파일 경로 비교는 앞의 ./와 절대 경로 차이를 넘는다', () => {
    const head = [tc('[C1.1]', 'passed', { file: './test/a.test.ts' })]
    const base = [raw('/repo/test/a.test.ts', 'error', { file: '/repo/test/a.test.ts' })]
    expect(one(change, head, base).status).toBe('met')
  })

  test('기준에 그 시험이 없고 파일 단위 실패도 없으면 증거 없음', () => {
    const v = one(change, [tc('[C1.1]', 'passed')], [tc('다른 시험', 'passed')])
    expect(v.status).toBe('missing_evidence')
    expect(v.detail).toBe('기준 실패를 확인하지 못함: C1.1(기준에 그 시험이 없음)')
  })

  test('태그를 단 기준 실패는 파일 단위 실패로 보지 않는다', () => {
    const head = [tc('[C1.1]', 'passed', { classname: 'a.test.ts' })]
    const base = [tc('a.test.ts [C9.9]', 'failed', { classname: 'a.test.ts' })]
    expect(one(change, head, base).status).toBe('missing_evidence')
  })

  test('기준에서 건너뛰었으면 기준 실패를 확인하지 못한 것이라 증거 없음', () => {
    const v = one(change, [tc('[C1.1]', 'passed')], [tc('[C1.1]', 'skipped')])
    expect(v.status).toBe('missing_evidence')
    expect(v.detail).toBe('기준 실패를 확인하지 못함: C1.1(기준에서 건너뜀)')
  })

  test('예시마다 기준 결과가 다르면 met의 detail에 확인하지 못한 것만 적는다', () => {
    const l = line('C1', 'change', ['C1.1', 'C1.2'])
    const head = [tc('[C1.1]', 'passed'), tc('[C1.2]', 'passed')]
    const base = [tc('[C1.1]', 'failed'), tc('[C1.2]', 'error')]
    const v = one(l, head, base)
    expect(v.status).toBe('met')
    expect(v.detail).toContain('C1.2: 기준에서 오류')
    expect(v.detail).not.toContain('C1.1')
  })

  test('결과에서 실패하거나 오류면 not_met', () => {
    expect(one(change, [tc('[C1.1]', 'failed')], [tc('[C1.1]', 'failed')]).status).toBe('not_met')
    const v = one(change, [tc('[C1.1]', 'error')], null)
    expect(v.status).toBe('not_met')
    expect(v.detail).toBe('결과에서 실패: C1.1(error)')
  })
})

describe('judgeLines: 새로(new)·지킴(keep)·없앰(remove)', () => {
  test('new는 결과에서 통과하면 met이고 기준은 보지 않는다', () => {
    const l = line('C2', 'new', ['C2.1'])
    expect(one(l, [tc('[C2.1]', 'passed')], null).status).toBe('met')
    expect(one(l, [tc('[C2.1]', 'passed')], [tc('[C2.1]', 'passed')]).status).toBe('met')
    expect(one(l, [tc('[C2.1]', 'passed')], [tc('[C2.1]', 'failed')]).status).toBe('met')
  })

  test('new는 결과에서 실패하면 not_met', () => {
    const l = line('C2', 'new', ['C2.1'])
    expect(one(l, [tc('[C2.1]', 'failed')], null).status).toBe('not_met')
  })

  test('keep은 기준을 돌리지 않았으면 결과의 통과만으로 met', () => {
    const v = one(line('C3', 'keep', ['C3.1']), [tc('[C3.1]', 'passed')], null)
    expect(v.status).toBe('met')
    expect(v.examples).toEqual([{ id: 'C3.1', head: 'passed', base: 'not_run' }])
  })

  test('keep은 기준을 돌렸으면 기준에서도 통과해야 met', () => {
    const l = line('C3', 'keep', ['C3.1'])
    const v = one(l, [tc('[C3.1]', 'passed')], [tc('[C3.1]', 'passed')])
    expect(v.status).toBe('met')
    expect(v.detail).toBe('기준과 결과에서 모두 통과')
  })

  test('keep이 기준에서 실패하면 바뀐 동작을 시험한 것이라 not_met', () => {
    const v = one(line('C3', 'keep', ['C3.1']), [tc('[C3.1]', 'passed')], [tc('[C3.1]', 'failed')])
    expect(v.status).toBe('not_met')
    expect(v.detail).toContain('기준에서 실패')
  })

  test('keep이 기준에서 오류·없음·건너뜀이면 확인하지 못한 것이라 missing_evidence', () => {
    const l = line('C3', 'keep', ['C3.1'])
    const head = [tc('[C3.1]', 'passed')]
    for (const base of [[tc('[C3.1]', 'error')], [], [tc('[C3.1]', 'skipped')]]) {
      const v = one(l, head, base)
      expect(v.status).toBe('missing_evidence')
      expect(v.detail).toContain('기준에서 통과를 확인하지 못함')
    }
  })

  test('keep도 결과에서 실패하면 not_met', () => {
    const v = one(line('C3', 'keep', ['C3.1']), [tc('[C3.1]', 'failed')], [tc('[C3.1]', 'passed')])
    expect(v.status).toBe('not_met')
  })

  test('remove는 예시가 없으면 missing_evidence', () => {
    const v = one(line('C4', 'remove', []), [tc('[C1.1]', 'passed')], null)
    expect(v).toEqual({
      line: 'C4',
      kind: 'remove',
      status: 'missing_evidence',
      detail: '쓰는 곳 없음을 보일 시험이 없음',
      examples: [],
    })
  })

  test('remove는 예시가 있고 결과에서 통과하면 met', () => {
    const l = line('C4', 'remove', ['C4.1'])
    expect(one(l, [tc('옛 이름은 없다 [C4.1]', 'passed')], null).status).toBe('met')
    expect(one(l, [tc('옛 이름은 없다 [C4.1]', 'failed')], null).status).toBe('not_met')
  })

  test('예시가 없는 test 줄(모양 검사를 거치지 않은 계약)은 missing_evidence', () => {
    const v = one(line('C2', 'new', []), [], null)
    expect(v.status).toBe('missing_evidence')
    expect(v.detail).toBe('시험으로 확인할 예시가 없음')
  })
})

describe('judgeLines: 증거가 없을 때', () => {
  test('수용 시험을 돌리지 못했으면 test 줄은 모두 missing_evidence', () => {
    const c = contract(
      line('C1', 'change', ['C1.1']),
      line('C2', 'new', ['C2.1']),
      line('C3', 'keep', ['C3.1']),
      line('C4', 'remove', []),
    )
    const vs = judgeLines(c, null, null)
    expect(vs.map((v) => v.status)).toEqual(Array(4).fill('missing_evidence'))
    expect(vs.every((v) => v.detail === '수용 시험을 돌리지 못함')).toBe(true)
    expect(vs[0]?.examples).toEqual([{ id: 'C1.1', head: 'missing', base: 'not_run' }])
  })

  test('태그를 단 testcase가 없으면 missing_evidence', () => {
    const v = one(line('C2', 'new', ['C2.1']), [tc('다른 시험 [C9.1]', 'passed')], null)
    expect(v.status).toBe('missing_evidence')
    expect(v.detail).toBe('태그를 단 시험이 없음: C2.1')
    expect(v.examples).toEqual([{ id: 'C2.1', head: 'missing', base: 'not_run' }])
  })

  test('수용 시험은 돌았지만 testcase가 하나도 없어도 missing_evidence', () => {
    expect(one(line('C2', 'new', ['C2.1']), [], null).status).toBe('missing_evidence')
  })

  test('결과에서 건너뛰었으면 missing_evidence', () => {
    const v = one(line('C2', 'new', ['C2.1']), [tc('[C2.1]', 'skipped')], null)
    expect(v.status).toBe('missing_evidence')
    expect(v.detail).toBe('결과에서 건너뜀: C2.1')
  })

  test('예시 중 하나가 실패하면 다른 예시가 없어도 not_met이 앞선다', () => {
    const l = line('C2', 'new', ['C2.1', 'C2.2'])
    expect(one(l, [tc('[C2.2]', 'failed')], null).status).toBe('not_met')
  })
})

describe('judgeLines: 태그 찾기와 여러 testcase', () => {
  const l = line('C2', 'new', ['C2.1'])
  const statusOf = (...ss: TestStatus[]) =>
    one(
      l,
      ss.map((s, i) => tc(`시험 ${i} [C2.1]`, s)),
      null,
    ).examples[0]?.head

  test('같은 태그가 여럿이면 하나라도 실패면 실패', () => {
    expect(statusOf('passed', 'failed')).toBe('failed')
    expect(statusOf('error', 'failed')).toBe('failed')
  })

  test('실패 없이 오류가 있으면 오류', () => {
    expect(statusOf('passed', 'error')).toBe('error')
  })

  test('모두 건너뜀이면 건너뜀, 통과가 하나라도 있으면 통과', () => {
    expect(statusOf('skipped', 'skipped')).toBe('skipped')
    expect(statusOf('skipped', 'passed')).toBe('passed')
  })

  test('C1.10의 태그는 C1.1로 세지 않는다', () => {
    const v = one(line('C1', 'new', ['C1.1']), [tc('[C1.10]', 'passed')], null)
    expect(v.examples[0]?.head).toBe('missing')
  })

  test('한 시험에 태그가 둘이면 두 예시 모두의 증거다', () => {
    const c = contract(line('C1', 'new', ['C1.1']), line('C2', 'new', ['C2.1']))
    const vs = judgeLines(c, [tc('함께 [C1.1] [C2.1]', 'passed')], null)
    expect(vs.map((v) => v.status)).toEqual(['met', 'met'])
  })

  test('태그는 이름에서만 찾고 classname은 보지 않는다', () => {
    const head: TestCase[] = [{ name: '이름', classname: '[C2.1]', status: 'passed' }]
    expect(one(l, head, null).status).toBe('missing_evidence')
  })

  test('대괄호 없는 id는 태그가 아니다', () => {
    expect(one(l, [tc('C2.1 빈 줄', 'passed')], null).status).toBe('missing_evidence')
  })
})

describe('judgeLines: 시험으로 판정하지 않는 줄', () => {
  test('observe·human 줄은 그대로 observe·human', () => {
    const c = contract(line('C5', 'observe', []), line('C6', 'human', []))
    const vs = judgeLines(c, [], [])
    expect(vs).toEqual([
      {
        line: 'C5',
        kind: 'observe',
        status: 'observe',
        detail: '시험 대신 보고 확인하는 줄',
        examples: [],
      },
      { line: 'C6', kind: 'human', status: 'human', detail: '사람이 확인하는 줄', examples: [] },
    ])
  })

  test('수용 시험을 돌리지 못해도 observe·human 줄은 바뀌지 않는다', () => {
    const c = contract(line('C5', 'observe', []), line('C6', 'human', []))
    expect(judgeLines(c, null, null).map((v) => v.status)).toEqual(['observe', 'human'])
  })

  test('check가 observe나 human이면 종류와 상관없이 그것을 따른다', () => {
    const c = contract(
      line('C1', 'change', ['C1.1'], 'observe'),
      line('C2', 'new', ['C2.1'], 'human'),
    )
    const vs = judgeLines(c, [tc('[C1.1]', 'passed'), tc('[C2.1]', 'passed')], null)
    expect(vs.map((v) => v.status)).toEqual(['observe', 'human'])
  })

  test('observe 종류는 check가 test여도 observe로 둔다(엄격한 쪽)', () => {
    const v = one(line('C5', 'observe', ['C5.1'], 'test'), [tc('[C5.1]', 'passed')], null)
    expect(v.status).toBe('observe')
    expect(v.examples).toEqual([{ id: 'C5.1', head: 'passed', base: 'not_run' }])
  })
})

describe('judgeLines: 순서와 모양', () => {
  test('계약의 줄 순서대로 판정을 돌려준다', () => {
    const c = contract(
      line('C3', 'keep', ['C3.1']),
      line('C1', 'change', ['C1.1']),
      line('C2', 'new', ['C2.1']),
    )
    const head = [tc('[C1.1]', 'passed'), tc('[C2.1]', 'passed'), tc('[C3.1]', 'passed')]
    const base = [tc('[C1.1]', 'failed'), tc('[C2.1]', 'failed'), tc('[C3.1]', 'passed')]
    const vs = judgeLines(c, head, base)
    expect(vs.map((v) => [v.line, v.kind, v.status])).toEqual([
      ['C3', 'keep', 'met'],
      ['C1', 'change', 'met'],
      ['C2', 'new', 'met'],
    ])
  })

  test('줄이 없는 계약은 빈 배열', () => {
    expect(judgeLines(contract(), [], [])).toEqual([])
  })
})

describe('allLinesTestedAndMet', () => {
  const v = (status: LineVerdict['status']): LineVerdict => ({
    line: 'C1',
    kind: 'new',
    status,
    detail: '',
    examples: [],
  })

  test('모든 줄이 met이면 참', () => {
    expect(allLinesTestedAndMet([v('met'), v('met')])).toBe(true)
  })

  test('observe나 human 줄이 있으면 거짓', () => {
    expect(allLinesTestedAndMet([v('met'), v('observe')])).toBe(false)
    expect(allLinesTestedAndMet([v('met'), v('human')])).toBe(false)
  })

  test('not_met이나 missing_evidence가 있으면 거짓', () => {
    expect(allLinesTestedAndMet([v('met'), v('not_met')])).toBe(false)
    expect(allLinesTestedAndMet([v('missing_evidence')])).toBe(false)
  })

  test('줄이 없으면 확인한 것이 없으니 거짓', () => {
    expect(allLinesTestedAndMet([])).toBe(false)
  })
})

describe('judgeLines: 다른 계약의 태그', () => {
  test('앞 Work가 남긴 시험의 태그는 이 계약의 증거가 아니다', () => {
    const l = line('C1', 'new', ['C1.1'])
    const v = one(l, [raw('login > [fix-clamp:C1.1] 비밀번호가 틀리면 401', 'passed')], null)
    expect(v.status).toBe('missing_evidence')
    expect(v.detail).toBe('태그를 단 시험이 없음: C1.1')
  })

  test('계약 id가 없는 태그도 증거가 아니다', () => {
    const keep = line('C2', 'keep', ['C2.1'])
    const old = [raw('[C2.1] 토큰 만료는 그대로', 'passed')]
    expect(one(keep, old, old).status).toBe('missing_evidence')
  })

  test('node:test처럼 describe 이름(suite)에 단 태그도 찾는다', () => {
    const keep = line('C2', 'keep', ['C2.1'])
    const cases = [raw('통과', 'passed', { suite: '묶음 [w-1:C2.1]' })]
    expect(one(keep, cases, cases).status).toBe('met')
  })
})

describe('applyExampleMismatch', () => {
  const v = (lineId: string, status: LineVerdict['status'], ids: string[]): LineVerdict => ({
    line: lineId,
    kind: 'new',
    status,
    detail: 'd',
    examples: ids.map((id) => ({ id, head: 'passed' })),
  })

  test('다른 예시를 쓰는 줄은 met이어도 못 미침이다', () => {
    const out = applyExampleMismatch([v('C1', 'met', ['C1.1']), v('C2', 'met', ['C2.1'])], ['C1.1'])
    expect(out.map((x) => [x.line, x.status, x.detail])).toEqual([
      ['C1', 'not_met', '예시 자료가 승인된 예시와 다름: C1.1'],
      ['C2', 'met', 'd'],
    ])
  })

  test('사람·관찰 줄과 다른 것이 없을 때는 그대로', () => {
    const lines = [v('C1', 'human', ['C1.1'])]
    expect(applyExampleMismatch(lines, ['C1.1'])).toEqual(lines)
    expect(applyExampleMismatch([v('C2', 'met', ['C2.1'])], [])).toEqual([v('C2', 'met', ['C2.1'])])
  })
})

describe('confirmFailures', () => {
  test('두 번 모두 실패해야 실패로 남는다', () => {
    const first = [raw('a', 'failed', { message: 'x' }), raw('b', 'failed'), raw('c', 'passed')]
    const second = [raw('a', 'passed'), raw('b', 'failed'), raw('c', 'failed')]
    expect(confirmFailures(first, second)).toEqual([
      raw('a', 'passed'),
      raw('b', 'failed'),
      raw('c', 'passed'),
    ])
  })

  test('두 번째에 없는 시험과 오류는 첫 결과를 쓴다', () => {
    const first = [raw('a', 'failed'), raw('b', 'error')]
    expect(confirmFailures(first, [raw('b', 'passed')])).toEqual(first)
  })

  test('classname과 suite가 같아야 같은 시험이다', () => {
    const first = [raw('a', 'failed', { classname: 'x.test.ts' })]
    const second = [raw('a', 'passed', { classname: 'y.test.ts' })]
    expect(confirmFailures(first, second)).toEqual(first)
  })
})

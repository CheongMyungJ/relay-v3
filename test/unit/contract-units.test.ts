// [단위] 단위와 전달 방식(V21): 줄의 unit 꼴, delivery 값, branch_per_unit의 약속(단위 둘 이상, change·new·remove 줄의
// 단위), unitsOf, sliceContract(V22: 전달 방식을 뺀 조각), unitBranch. 앱이 단위 브랜치를 내보내기로 재는 것은
// [흐름](works-exports.test.ts)이 본다.
import { describe, expect, test } from 'vitest'
import {
  contractHash,
  parseContract,
  sliceContract,
  unitBranch,
  unitsOf,
} from '../../src/core/contract.ts'
import type { Contract, ContractLine } from '../../src/core/types.ts'

const line = (id: string, kind: ContractLine['kind'], unit?: string): ContractLine => ({
  id,
  kind,
  text: `${id} 줄`,
  grounds: [],
  examples: kind === 'change' || kind === 'new' || kind === 'keep' ? [`${id}.1`] : [],
  check: kind === 'observe' || kind === 'human' ? kind : 'test',
  ...(unit === undefined ? {} : { unit }),
})

/** 버그 둘(csv, money)과 둘에 걸친 지킴 줄, 사람 줄 */
const twoBugs: Contract = {
  version: 1,
  id: 'w-units',
  goal: '두 버그를 한 Work에서 고친다',
  lines: [
    line('C1', 'change', 'csv'),
    line('C2', 'change', 'money'),
    line('C3', 'keep'),
    line('C4', 'new', 'csv'),
    line('C5', 'human'),
  ],
  non_goals: ['날짜 형식'],
  human_rules: [],
  examples: [
    { id: 'C1.1', input: 'a,b', output: ['a', 'b'] },
    { id: 'C2.1', input: '1,000', output: 1000 },
    { id: 'C3.1', input: 'x', output: 'x' },
    { id: 'C4.1', input: '', output: [] },
  ],
  tidy: [],
}

const parse = (c: unknown) => parseContract(JSON.stringify(c))

function errorsOf(c: unknown): string[] {
  const r = parse(c)
  if (r.ok) throw new Error('오류를 기대했지만 통과함')
  return r.errors
}

describe('parseContract: 단위와 전달 방식(V21)', () => {
  test('단위 이름은 영문 소문자로 시작하고 영문 소문자·숫자·-만, 21자까지', () => {
    for (const unit of ['csv', 'parse-money', 'a', 'v2', `a${'b'.repeat(20)}`]) {
      const r = parse({
        ...twoBugs,
        lines: [line('C1', 'change', unit), ...twoBugs.lines.slice(1)],
      })
      expect(r.ok, unit).toBe(true)
    }
    const hint = 'lines[0].unit: 영문 소문자로 시작하고 영문 소문자·숫자·-만, 21자까지여야 함'
    for (const unit of ['CSV', '1csv', '-csv', 'parse_money', 'csv 1', `a${'b'.repeat(21)}`]) {
      const c = { ...twoBugs, lines: [line('C1', 'change', unit), ...twoBugs.lines.slice(1)] }
      expect(errorsOf(c), unit).toEqual([hint])
    }
    const blank = { ...twoBugs, lines: [line('C1', 'change', ''), ...twoBugs.lines.slice(1)] }
    expect(errorsOf(blank)).toEqual(['lines[0].unit: 비어 있으면 안 됨'])
  })

  test('단위와 전달 방식이 없는 옛 계약은 그 칸이 없는 채로 읽혀 계약 hash가 그대로다', () => {
    const old: Contract = { ...twoBugs, lines: twoBugs.lines.map((l) => ({ ...l })) }
    for (const l of old.lines) delete l.unit
    const r = parse(old)
    if (!r.ok) throw new Error(r.errors.join(' / '))
    expect(r.value.lines.some((l) => 'unit' in l)).toBe(false)
    expect('delivery' in r.value).toBe(false)
    expect(contractHash(r.value)).toBe(contractHash(old))
  })

  test('delivery는 one_branch와 branch_per_unit만. 단위가 없어도 one_branch는 된다', () => {
    expect(parse({ ...twoBugs, delivery: 'one_branch' }).ok).toBe(true)
    const single = {
      ...twoBugs,
      lines: [line('C1', 'change')],
      examples: twoBugs.examples.slice(0, 1),
    }
    expect(parse({ ...single, delivery: 'one_branch' }).ok).toBe(true)
    expect(errorsOf({ ...twoBugs, delivery: 'per_module' })).toEqual([
      "delivery: 'one_branch', 'branch_per_unit' 중 하나여야 함",
    ])
  })

  test('branch_per_unit: 단위가 둘 이상이고 change·new·remove 줄마다 단위가 있어야 한다(keep·observe·human은 없어도 됨)', () => {
    expect(parse({ ...twoBugs, delivery: 'branch_per_unit' }).ok).toBe(true)
    const oneUnit = {
      ...twoBugs,
      delivery: 'branch_per_unit',
      lines: twoBugs.lines.map((l) => (l.unit === 'money' ? { ...l, unit: 'csv' } : l)),
    }
    expect(errorsOf(oneUnit)).toEqual([
      "delivery: 'branch_per_unit'이면 단위가 둘 이상이어야 함 (지금 1개)",
    ])
    const loose = {
      ...twoBugs,
      delivery: 'branch_per_unit',
      lines: [...twoBugs.lines, line('C6', 'remove'), line('C7', 'observe')],
    }
    expect(errorsOf(loose)).toEqual([
      "lines[5].unit: 'branch_per_unit'이면 remove 줄은 단위가 있어야 함",
    ])
    // one_branch에서는 단위가 없는 change 줄도 된다
    expect(parse({ ...loose, delivery: 'one_branch' }).ok).toBe(true)
  })
})

test('unitsOf: 줄에 처음 나온 차례로, 겹침 없이. 단위가 없으면 []', () => {
  expect(unitsOf(twoBugs)).toEqual(['csv', 'money'])
  expect(unitsOf({ ...twoBugs, lines: [line('C1', 'change')] })).toEqual([])
})

test('sliceContract: 그 단위의 줄과 단위가 없는 줄, 그 줄들의 예시. 계약 id와 줄 밖의 칸은 그대로, 전달 방식은 뺀다', () => {
  const csv = sliceContract({ ...twoBugs, delivery: 'branch_per_unit' }, 'csv')
  expect(csv.lines.map((l) => l.id)).toEqual(['C1', 'C3', 'C4', 'C5'])
  expect(csv.examples.map((x) => x.id)).toEqual(['C1.1', 'C3.1', 'C4.1'])
  expect(csv).toMatchObject({
    id: 'w-units',
    goal: twoBugs.goal,
    non_goals: twoBugs.non_goals,
  })
  // 조각은 제 브랜치 하나로 간다: branch_per_unit(단위 둘 이상)이 남으면 조각이 모양 검사를 지나지 못한다
  expect('delivery' in csv).toBe(false)
  expect(parse(csv).ok).toBe(true)
  expect(unitBranch('relay/x-ab12', 'csv')).toBe('relay/x-ab12--csv')
  const money = sliceContract(twoBugs, 'money')
  expect(money.lines.map((l) => l.id)).toEqual(['C2', 'C3', 'C5'])
  expect(money.examples.map((x) => x.id)).toEqual(['C2.1', 'C3.1'])
  // 조각도 계약의 약속을 지킨다
  expect(parse(money).ok).toBe(true)
})

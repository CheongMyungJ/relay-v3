// [단위] 내보내기의 기록(V22): 옛 기록을 Work 브랜치의 내보내기 하나로 옮김, 승인된 계약의 전달 방식으로 내보내기를 정함
// (같은 브랜치의 기록은 이음), 내보내기의 계약과 계약 파일, 단위 브랜치의 끝. 단위 브랜치를 실제로 재는 것은
// [흐름](works-exports.test.ts).
import { describe, expect, test } from 'vitest'
import type { Contract } from '../../src/core/types.ts'
import { branchExport, upgradeWork, type WorkRecord } from '../../src/main/store.ts'
import {
  contractFile,
  exportContract,
  perUnit,
  planExports,
  sameTips,
  tipOf,
} from '../../src/main/works-types.ts'
import { unitScope } from '../../src/main/works-review.ts'
import { contract, C1, C2 } from '../support/gate.ts'

const GATE = {
  conclusion: 'human_merge' as const,
  decisive: '리뷰 없음',
  reasons: ['리뷰 없음'],
  condition: null,
  shadow: false,
}
const PR = {
  number: 3,
  url: 'u',
  state: 'OPEN' as const,
  headRefOid: 'h',
  baseRefName: 'main',
  isDraft: false,
  mergedAt: null,
}

function record(over: Record<string, unknown> = {}): WorkRecord {
  return {
    id: 'w',
    branch: 'relay/x-ab12',
    exports: [branchExport('relay/x-ab12')],
    ...over,
  } as never
}

/** 단위 둘(csv, money)을 단위 브랜치로 내보내는 계약 */
const perUnitContract: Contract = contract({
  delivery: 'branch_per_unit',
  lines: [
    { ...C1, unit: 'csv' },
    { ...C2, unit: 'money' },
  ],
})

describe('upgradeWork', () => {
  test('V22 앞의 기록: PR·증거·관문·내보낸 head·미리 리뷰 수를 Work 브랜치의 내보내기 하나로 옮긴다', () => {
    const old = {
      id: 'w',
      branch: 'relay/x-ab12',
      pr: PR,
      evidence_path: '/e.json',
      gate: GATE,
      exported_head: 'h',
      prepared_reviews: 2,
    } as unknown as WorkRecord
    const rec = upgradeWork(old)
    expect(rec.exports).toEqual([
      {
        unit: null,
        branch: 'relay/x-ab12',
        pr: PR,
        evidence_path: '/e.json',
        gate: GATE,
        exported_head: 'h',
        prepared_reviews: 2,
      },
    ])
    for (const k of ['pr', 'evidence_path', 'gate', 'exported_head', 'prepared_reviews'])
      expect(k in rec).toBe(false)
    expect(rec).toMatchObject({
      integration_path: null,
      notice: null,
      session_started: true,
      end_pending: null,
      end_memos: [],
      feedback: { rounds: 0, sent: [] },
      // M3 앞의 Work는 M3 장치가 모두 꺼진 것이다(V38). 기록 안 된 나빠짐(M3b)도 없다
      m3: { knowledge: false, debt: false },
      unrecorded: [],
    })
    // M3a의 Work는 빚 기록(M3b)이 꺼진 것이다: Work는 만들 때의 스위치를 지닌다
    const m3a = { ...old, m3: { knowledge: true } } as unknown as WorkRecord
    expect(upgradeWork(m3a).m3).toEqual({ knowledge: true, debt: false })
  })

  test('뺀 장치의 칸은 버린다: V28(제출 때 기준 확인, V32에서 뺌)의 probe', () => {
    const old = { id: 'w', branch: 'b', probe: { ran: true, lines: [] } } as unknown as WorkRecord
    expect('probe' in upgradeWork(old)).toBe(false)
  })

  test('더 옛 기록(칸이 없음)도 빈 내보내기 하나, 내보내기가 있는 기록은 그대로', () => {
    const bare = upgradeWork({ id: 'w', branch: 'b' } as unknown as WorkRecord)
    expect(bare.exports).toEqual([branchExport('b')])
    const exports = [{ ...branchExport('b--csv'), unit: 'csv' }]
    expect(upgradeWork({ ...bare, exports }).exports).toBe(exports)
  })
})

describe('planExports', () => {
  test('one_branch(전달 방식 없음 포함)는 Work 브랜치 하나, branch_per_unit은 단위마다 <Work 브랜치>--<단위>', () => {
    expect(planExports(record(), contract()).map((x) => [x.unit, x.branch])).toEqual([
      [null, 'relay/x-ab12'],
    ])
    const plan = planExports(record(), perUnitContract)
    expect(plan.map((x) => [x.unit, x.branch])).toEqual([
      ['csv', 'relay/x-ab12--csv'],
      ['money', 'relay/x-ab12--money'],
    ])
    expect(perUnit({ exports: plan })).toBe(true)
    expect(perUnit({ exports: [branchExport('b')] })).toBe(false)
  })

  test('같은 브랜치의 기록(PR, 관문, 미리 리뷰 수)은 잇고, 빠진 단위의 기록은 버린다', () => {
    const csv = { ...branchExport('relay/x-ab12--csv'), unit: 'csv', pr: PR, prepared_reviews: 3 }
    const gone = { ...branchExport('relay/x-ab12--old'), unit: 'old' }
    const plan = planExports(record({ exports: [csv, gone] }), perUnitContract)
    expect(plan[0]).toBe(csv)
    expect(plan.map((x) => x.unit)).toEqual(['csv', 'money'])
    // 단위 브랜치에서 한 브랜치로 바꾸면 Work 브랜치의 내보내기 하나
    expect(planExports(record({ exports: plan }), contract())).toEqual([
      branchExport('relay/x-ab12'),
    ])
  })
})

test('exportContract·contractFile: Work 브랜치는 계약 전체(contract.json), 단위 브랜치는 조각(contract.<단위>.json)', () => {
  const [csv] = planExports(record(), perUnitContract)
  if (!csv) throw new Error('내보내기 없음')
  const whole = branchExport('relay/x-ab12')
  expect(exportContract({ contract: perUnitContract }, whole)).toBe(perUnitContract)
  expect(exportContract({ contract: perUnitContract }, csv)?.lines.map((l) => l.id)).toEqual(['C1'])
  expect(exportContract({ contract: null }, csv)).toBeNull()
  expect(contractFile(whole)).toBe('contract.json')
  expect(contractFile(csv)).toBe('contract.csv.json')
})

test('tipOf·sameTips: Work 브랜치는 head, 단위 브랜치는 그 끝(없으면 null). 빈 것과 없는 것은 같다', () => {
  const [csv] = planExports(record(), perUnitContract)
  if (!csv) throw new Error('내보내기 없음')
  expect(tipOf(branchExport('b'), 'H', {})).toBe('H')
  expect(tipOf(csv, 'H', { 'relay/x-ab12--csv': 'C' })).toBe('C')
  expect(tipOf(csv, 'H', {})).toBeNull()
  expect(sameTips(undefined, {})).toBe(true)
  expect(sameTips({ a: 'x' }, { a: 'x' })).toBe(true)
  expect(sameTips({ a: 'x' }, { a: null })).toBe(false)
  expect(sameTips({ a: 'x' }, {})).toBe(false)
})

test('unitScope: 단위 브랜치의 리뷰어에게 채울 줄과 제 브랜치로 가는 다른 단위의 줄을 알린다(V30). Work 브랜치는 없음', () => {
  const keep = { ...C1, id: 'C3', kind: 'keep' as const, examples: [] }
  const c: Contract = { ...perUnitContract, lines: [...perUnitContract.lines, keep] }
  const [csv, money] = planExports(record(), c)
  const [scope] = unitScope(c, csv as never)
  expect(scope).toContain('export of unit "csv" on branch relay/x-ab12--csv')
  expect(scope).toContain(
    'it must meet the lines of unit "csv" and the lines without a unit (C1, C3)',
  )
  expect(scope).toContain('The lines of the other units (C2 of money)')
  expect(scope).toContain(
    'a part of the request that no line of the contract covers is a request_gap',
  )
  expect(unitScope(c, money as never)[0]).toContain('(C2, C3)')
  expect(unitScope(c, branchExport('relay/x-ab12'))).toEqual([])
})

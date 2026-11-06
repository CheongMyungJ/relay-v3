// [단위] 그림자 실적의 순수한 셈(M4a, docs/m4-design.md 3.1): 채운 조건 전부(conditionsMet)와 조건 hash(condHashes).
// 바탕은 test/support/gate.ts
import { describe, expect, test } from 'vitest'
import { contractHash } from '../../src/core/contract.ts'
import { gate } from '../../src/core/gate.ts'
import type { AutoCondition, EvidenceBundle } from '../../src/core/types.ts'
import { condHashes, conditionsMet } from '../../src/engine/track.ts'
import { contract, DIFF, evidence, HEAD, policy, sig } from '../support/gate.ts'

const small: AutoCondition = { id: 'small', max_changed_lines: 50, no_new_dependencies: true }
const src: AutoCondition = { id: 'src', paths: ['src/**', 'test/**'] }
const tiny: AutoCondition = { id: 'tiny', max_changed_lines: 10 }

const bundle = (over: Partial<EvidenceBundle> = {}) =>
  evidence({ contract: { id: 'w1', hash: contractHash(contract()) }, ...over })

describe('conditionsMet', () => {
  test('채운 조건 전부를 정책의 차례로: 관문은 처음 하나만 적는다', () => {
    const p = policy({ conditions: [tiny, small, src], track_record_ok: {} })
    const e = bundle()
    expect(gate(e, contract(), p, HEAD).condition).toBe('small')
    expect(conditionsMet(e, contract(), p, HEAD)).toEqual(['small', 'src'])
  })

  test('스위치·서버 보호·실적은 채움을 바꾸지 않는다(그림자도 채운 것이다)', () => {
    const off = policy({
      conditions: [small, src],
      auto_merge_enabled: false,
      server: null,
      track_record_ok: {},
    })
    expect(conditionsMet(bundle(), contract(), off, HEAD)).toEqual(['small', 'src'])
  })

  test('사람에게 보낼 사실이 있으면 빈다: 낡은 증거, 바닥 신호, 리뷰 없음, 계약 다시', () => {
    const p = policy({ conditions: [small, src] })
    expect(conditionsMet(bundle(), contract(), p, 'n'.repeat(40))).toEqual([])
    const floor = bundle({ signals: [sig('guard_path', '.relay/quality.json', '지킴 파일')] })
    expect(conditionsMet(floor, contract(), p, HEAD)).toEqual([])
    expect(conditionsMet(bundle({ review: null }), contract(), p, HEAD)).toEqual([])
    const change = contract({ change_requested: '예시가 틀림' })
    expect(conditionsMet(bundle(), change, p, HEAD)).toEqual([])
  })

  test('조건마다 따로 본다: diff가 큰 묶음은 paths 조건만 채운다', () => {
    const big = bundle({ diff: { ...DIFF, added: 200 } })
    const p = policy({ conditions: [small, src] })
    expect(conditionsMet(big, contract(), p, HEAD)).toEqual(['src'])
    expect(conditionsMet(big, contract(), policy({ conditions: [] }), HEAD)).toEqual([])
  })
})

describe('condHashes', () => {
  test('조건마다 정의의 안정 hash 앞 12자: 칸 차례와 상관없고, 정의가 바뀌면 다르다', () => {
    const h = condHashes([small, src])
    expect(Object.keys(h)).toEqual(['small', 'src'])
    expect(h.small).toMatch(/^[0-9a-f]{12}$/)
    const reordered: AutoCondition = {
      no_new_dependencies: true,
      max_changed_lines: 50,
      id: 'small',
    }
    expect(condHashes([reordered]).small).toBe(h.small)
    expect(condHashes([{ ...small, max_changed_lines: 100 }]).small).not.toBe(h.small)
    expect(condHashes([{ ...small, paths: undefined }]).small).toBe(h.small)
    expect(condHashes([])).toEqual({})
  })
})

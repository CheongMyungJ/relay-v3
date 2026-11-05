// [단위] 렌더러의 리뷰 올림과 메모(V26, src/renderer/src/findings.ts). 렌더러는 core를 가져오지 않으므로 같은 규칙을 다시
// 쓴다: core review.ts `raises`, gate의 '리뷰 올림(…)' 이름과 견준다. 화면은 [스모크]가 이어지는지만 본다.
import { describe, expect, test } from 'vitest'
import { raises } from '../../src/core/review.ts'
import type { RaiseReason, ReviewFinding } from '../../src/core/types.ts'
import {
  findingGroups,
  RAISE_LABEL,
  raiseLabel,
  raisesFinding,
} from '../../src/renderer/src/findings.ts'
import { finding, run } from '../support/gate.ts'

const KINDS = Object.keys(RAISE_LABEL) as RaiseReason[]
const SEVERITIES: ReviewFinding['severity'][] = ['high', 'medium', 'low']

describe('렌더러의 올림 규칙은 core와 같다', () => {
  test('갈래(없음, 넷, 모르는 갈래) × 심각도(셋, 모르는 심각도)마다 core raises와 같은 답', () => {
    const raisesOf = [undefined, ...KINDS, 'request_gap' as RaiseReason]
    for (const raise of raisesOf)
      for (const severity of [...SEVERITIES, 'urgent' as ReviewFinding['severity']]) {
        const f = finding({ severity, ...(raise ? { raise } : {}) })
        expect(raisesFinding(f), `${String(raise)}/${severity}`).toBe(raises(f))
      }
  })

  test('갈래 이름은 관문의 사실 글과 같다', () => {
    for (const raise of KINDS) {
      const f = finding({ raise, severity: 'high', text: 't' })
      expect(run({ review: { status: 'done', findings: [f] } }).decisive).toBe(
        `리뷰 올림(${raiseLabel(f)}): t`,
      )
    }
    expect(raiseLabel(finding())).toBeNull()
    expect(raiseLabel(finding({ raise: 'request_gap' as RaiseReason }))).toBe('request_gap')
  })
})

describe('findingGroups', () => {
  test('올림과 메모(구조/low, 갈래 없음)로 나누고 각자 리뷰어의 차례를 지킨다', () => {
    const r1 = finding({ id: 'R1', raise: 'structure', severity: 'low' })
    const r2 = finding({ id: 'R2', raise: 'security', severity: 'low' })
    const r3 = finding({ id: 'R3', severity: 'high' })
    const r4 = finding({ id: 'R4', raise: 'structure', severity: 'medium' })
    expect(findingGroups([r1, r2, r3, r4])).toEqual({ raised: [r2, r4], notes: [r1, r3] })
    expect(findingGroups([])).toEqual({ raised: [], notes: [] })
    // 묶음의 관문이 올린 수와 같다
    const up = run({ review: { status: 'done', findings: [r1, r2, r3, r4] } }).reasons.filter((r) =>
      r.startsWith('리뷰 올림'),
    )
    expect(up).toHaveLength(findingGroups([r1, r2, r3, r4]).raised.length)
  })
})

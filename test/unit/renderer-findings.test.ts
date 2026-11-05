// [단위] 렌더러의 리뷰 올림과 메모(V26, src/renderer/src/findings.ts). 렌더러는 core를 가져오지 않으므로 같은 규칙을 다시
// 쓴다: core review.ts `raises`, gate의 '리뷰 올림(…)' 이름과 견준다. 되먹임(V24)의 상태 한 줄과 지적마다의 표시, 사람이
// 넘길 수 있는 지적(사람 몫, 저절로 가지 않는 세션 몫)과 상자의 [세션에 넘기기]가 보낼 지적. 화면은 [스모크]가 이어지는지만 본다.
import { describe, expect, test } from 'vitest'
import { raises } from '../../src/core/review.ts'
import type { RaiseReason, ReviewFinding } from '../../src/core/types.ts'
import {
  feedbackStatus,
  findingGroups,
  findingRoute,
  passable,
  passableFindings,
  RAISE_LABEL,
  raiseLabel,
  raisesFinding,
} from '../../src/renderer/src/findings.ts'
import type { FeedbackView, WorkView } from '../../src/shared/api.ts'
import { evidence, finding, HEAD, reviewed, run } from '../support/gate.ts'

const KINDS = Object.keys(RAISE_LABEL) as RaiseReason[]
const SEVERITIES: ReviewFinding['severity'][] = ['high', 'medium', 'low']

describe('렌더러의 올림 규칙은 core와 같다', () => {
  test('갈래(없음, 다섯, 모르는 갈래) × 심각도(셋, 모르는 심각도)마다 core raises와 같은 답', () => {
    expect(KINDS).toContain('request_gap')
    const raisesOf = [undefined, ...KINDS, 'later_kind' as RaiseReason]
    for (const raise of raisesOf)
      for (const severity of [...SEVERITIES, 'urgent' as ReviewFinding['severity']]) {
        const f = finding({ severity, ...(raise ? { raise } : {}) })
        expect(raisesFinding(f), `${String(raise)}/${severity}`).toBe(raises(f))
      }
  })

  test('갈래 이름은 관문의 사실 글과 같다', () => {
    // 요청과 어긋남(V30)은 메모라 관문의 사실이 아니다(M2.1 O2)
    const up = KINDS.filter((raise) => raises(finding({ raise, severity: 'high' })))
    expect(up).not.toContain('request_gap')
    for (const raise of up) {
      const f = finding({ raise, severity: 'high', text: 't' })
      expect(run({ review: reviewed([f]) }).decisive).toBe(`리뷰 올림(${raiseLabel(f)}): t`)
    }
    expect(raiseLabel(finding())).toBeNull()
    expect(raiseLabel(finding({ raise: 'request_gap' }))).toBe('요청과 어긋남')
    expect(raiseLabel(finding({ raise: 'later_kind' as RaiseReason }))).toBe('later_kind')
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
    const up = run({ review: reviewed([r1, r2, r3, r4]) }).reasons.filter((r) =>
      r.startsWith('리뷰 올림'),
    )
    expect(up).toHaveLength(findingGroups([r1, r2, r3, r4]).raised.length)
  })
})

describe('되먹임(V24)', () => {
  const fb = (over: Partial<FeedbackView> = {}): FeedbackView => ({
    rounds: 0,
    max: 3,
    sent: [],
    findings: {},
    pending: 0,
    held: null,
    ...over,
  })
  const view = (feedback: FeedbackView, over: Partial<WorkView> = {}) =>
    ({ state: 'working', endPending: null, evidence: null, feedback, ...over }) as WorkView
  const round = (n: number, by: 'relay' | 'human', facts: number, findings: number) => ({
    n,
    head: HEAD,
    at: '2026-11-05T00:00:00Z',
    by,
    keys: [],
    facts,
    findings,
    path: `/h/works/w/feedback/${n}.md`,
  })

  test('feedbackStatus: 상한, 사람 몫의 올림, 쓰다 둔 글, 사람이 최근 입력함, 쉬면 보냄, 이 head에 보낸 것, 앞 head의 라운드 수, 없음', () => {
    expect(feedbackStatus(view(fb()))).toBeNull()
    expect(feedbackStatus(view(fb({ rounds: 3, pending: 1, held: 'cap' })))).toBe(
      '되먹임 상한(3/3)에 닿아 세션 몫 사실 1개를 보내지 않았습니다. 리뷰 지적은 [세션에 넘기기]로 보낼 수 있습니다',
    )
    expect(feedbackStatus(view(fb({ pending: 1, held: 'human_findings' })))).toBe(
      '사람 몫의 리뷰 올림이 있어 세션 몫 사실 1개를 보내지 않았습니다: 지적을 보고 [세션에 넘기기]로 보내거나 터미널에서 말하세요 (세션에 보낸 되먹임 0/3)',
    )
    expect(feedbackStatus(view(fb({ rounds: 1, pending: 2, held: 'draft' })))).toBe(
      '세션 몫 사실 2개를 보내지 않았습니다: 터미널 입력 칸에 쓰다 둔 글이 있을 수 있습니다. 그 글을 보내면(Enter) 1분 뒤 세션이 쉬고 있을 때 보냅니다 (세션에 보낸 되먹임 1/3)',
    )
    expect(feedbackStatus(view(fb({ rounds: 1, pending: 2, held: 'human_input' })))).toBe(
      '세션 몫 사실 2개를 보내지 않았습니다: 최근 터미널에 입력했으니 1분 동안 입력이 없고 세션이 쉬고 있을 때 보냅니다 (세션에 보낸 되먹임 1/3)',
    )
    expect(feedbackStatus(view(fb({ pending: 1 })))).toBe(
      '세션 몫 사실 1개: 세션이 쉬면 보냅니다 (세션에 보낸 되먹임 0/3)',
    )
    // 끝내기가 걸렸거나 상자가 떠 있으면 보내지 않으니 그렇게 말하지 않는다
    const pending = { head: HEAD, armed: false, open: ['x'] }
    expect(feedbackStatus(view(fb({ pending: 1 }), { endPending: pending }))).toBeNull()
    for (const held of ['human_findings', 'draft', 'human_input'] as const)
      expect(feedbackStatus(view(fb({ pending: 1, held }), { endPending: pending }))).toBeNull()
    expect(feedbackStatus(view(fb({ rounds: 2, sent: [round(2, 'relay', 3, 1)] })))).toBe(
      '세션에 보냄(2/3) · 되먹임 2: 사실 3개, 리뷰 지적 1개',
    )
    expect(feedbackStatus(view(fb({ rounds: 2, sent: [round(3, 'human', 0, 2)] })))).toBe(
      '사람이 세션에 넘김 · 되먹임 3: 리뷰 지적 2개',
    )
    expect(feedbackStatus(view(fb({ rounds: 2 })))).toBe('세션에 보낸 되먹임 2/3')
  })

  test('findingRoute와 passableFindings: 상자의 [세션에 넘기기]는 사람 몫의 올림 가운데 보내지 않은 것만', () => {
    const outside = finding({ id: 'R1', raise: 'out_of_contract', severity: 'low' })
    const memo = finding({ id: 'R2', severity: 'low' })
    const structure = finding({ id: 'R3', raise: 'structure', severity: 'medium' })
    const sent = finding({ id: 'R4', raise: 'out_of_contract', severity: 'high' })
    const v = view(
      fb({
        findings: {
          R1: { route: 'human', sent: false },
          R2: { route: 'human', sent: false },
          R3: { route: 'session', sent: false },
          R4: { route: 'human', sent: true },
        },
      }),
      {
        evidence: evidence({
          review: { status: 'done', findings: [outside, memo, structure, sent] },
        }),
      },
    )
    expect(
      [outside, memo, structure, sent, finding({ id: 'R9' })].map((f) => findingRoute(v, f)),
    ).toEqual(['human', 'human', 'session', 'sent', null])
    expect(passableFindings(v)).toEqual(['R1'])
    expect([outside, memo, structure, sent].map((f) => passable(v, f))).toEqual([
      true,
      true,
      false,
      false,
    ])
  })

  test('저절로 가지 않는 세션 몫(상한, 사람 몫의 올림이 막음, 끝내기의 상자)은 사람이 넘길 수 있다', () => {
    const structure = finding({ id: 'R1', raise: 'structure', severity: 'medium' })
    const sent = finding({ id: 'R2', raise: 'security', severity: 'low' })
    const findings = { R1: { route: 'session', sent: false }, R2: { route: 'session', sent: true } }
    const at = (over: Partial<FeedbackView>, endPending: WorkView['endPending'] = null) =>
      view(fb({ pending: 1, findings, ...over } as Partial<FeedbackView>), {
        endPending,
        evidence: evidence({ review: { status: 'done', findings: [structure, sent] } }),
      })
    expect(passableFindings(at({}))).toEqual([])
    expect(passableFindings(at({ held: 'human_input' }))).toEqual([])
    expect(passableFindings(at({ held: 'draft' }))).toEqual([])
    expect(passableFindings(at({ rounds: 3, held: 'cap' }))).toEqual(['R1'])
    expect(passableFindings(at({ held: 'human_findings' }))).toEqual(['R1'])
    expect(passableFindings(at({}, { head: HEAD, armed: false, open: ['x'] }))).toEqual(['R1'])
    expect(passable(at({ rounds: 3, held: 'cap' }), sent)).toBe(false)
  })
})

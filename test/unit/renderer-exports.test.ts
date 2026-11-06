// [단위] 렌더러의 단위 브랜치 내보내기(V22, src/renderer/src/exports.ts)와 단위 머리가 붙은 열린 것의 글(format.ts).
// 칸을 그리는 것은 [스모크]가 이어지는지만 본다.
import { describe, expect, test } from 'vitest'
import type { ExportView, FeedbackView, WorkView } from '../../src/shared/api.ts'
import {
  endTips,
  exportSection,
  handable,
  integrationText,
  passByExport,
} from '../../src/renderer/src/exports.ts'
import { endMovedText, factText, isStale, openText } from '../../src/renderer/src/format.ts'
import { evidence, finding, reviewed } from '../support/gate.ts'

const NO_FEEDBACK: FeedbackView = {
  rounds: 0,
  max: 3,
  sent: [],
  findings: {},
  pending: 0,
  held: null,
}

function exp(unit: string, over: Partial<ExportView> = {}): ExportView {
  return {
    unit,
    branch: `relay/x--${unit}`,
    head: `${unit}`.padEnd(40, '0'),
    missing: false,
    evidence: null,
    gate: null,
    pr: null,
    evidenceRunning: false,
    reviewRunning: false,
    feedback: NO_FEEDBACK,
    ...over,
  }
}

const work = (over: Partial<WorkView> = {}) =>
  ({
    id: 'w',
    state: 'working',
    head: 'w'.repeat(40),
    evidence: evidence({ head: 'w'.repeat(40), review: null }),
    gate: null,
    pr: null,
    endPending: null,
    endMoved: null,
    reviewDisabled: false,
    feedback: NO_FEEDBACK,
    exports: [exp('csv'), exp('money')],
    integration: [],
    ...over,
  }) as WorkView

test('exportSection: 내보내기의 증거·관문·PR·되먹임·끝으로 바꾼 칸. 낡음은 그 단위 브랜치의 끝으로 본다', () => {
  const e = evidence({ head: 'old'.padEnd(40, '0') })
  const x = exp('csv', { evidence: e, evidenceRunning: true })
  const s = exportSection(work(), x)
  expect(s).toMatchObject({ evidence: e, head: x.head, evidenceRunning: true, exports: [] })
  expect(isStale(s)).toBe(true)
  expect(isStale(exportSection(work(), { ...x, head: e.head }))).toBe(false)
})

describe('endTips', () => {
  test('화면의 단위 브랜치 끝(없는 브랜치는 null). one_branch는 넘기지 않는다', () => {
    const v = work({ exports: [exp('csv'), exp('money', { head: null, missing: true })] })
    expect(endTips(v)).toEqual({
      tips: { 'relay/x--csv': exp('csv').head, 'relay/x--money': null },
    })
    expect(endTips(work({ exports: [] }))).toEqual({})
  })

  test('아직 읽지 못한 끝이 있으면 넘기지 않는다(메인이 지금 끝으로 본다)', () => {
    expect(endTips(work({ exports: [exp('csv', { head: null })] }))).toEqual({})
  })
})

test('passByExport: 상자의 [세션에 넘기기]는 내보내기마다 넘길 수 있는 올림을 단위와 함께', () => {
  const raised = finding({ id: 'R1', raise: 'out_of_contract', severity: 'low' })
  const human: FeedbackView = { ...NO_FEEDBACK, findings: { R1: { route: 'human', sent: false } } }
  const csv = exp('csv', { evidence: evidence({ review: reviewed([raised]) }), feedback: human })
  expect(passByExport(work({ exports: [csv, exp('money')] }))).toEqual([
    { unit: 'csv', ids: ['R1'] },
  ])
  // one_branch는 단위 없이
  const one = work({ exports: [], evidence: csv.evidence, feedback: human })
  expect(passByExport(one)).toEqual([{ ids: ['R1'] }])
  expect(passByExport(work())).toEqual([])
})

test('handable: 상자의 [세션에 넘기기](V35)는 넘길 올림이나 저절로 가지 않은 세션 몫 사실이 있을 때', () => {
  const raised = finding({ id: 'R1', raise: 'out_of_contract', severity: 'low' })
  const human: FeedbackView = { ...NO_FEEDBACK, findings: { R1: { route: 'human', sent: false } } }
  const one = work({ exports: [], evidence: evidence({ review: reviewed([raised]) }) })
  expect(handable(one)).toBe(false)
  expect(handable({ ...one, feedback: human })).toBe(true)
  // 통합 증거나 내보내기의 보내지 않은 사실
  expect(handable(work({ feedback: { ...NO_FEEDBACK, pending: 2 } }))).toBe(true)
  const fact = exp('money', { feedback: { ...NO_FEEDBACK, pending: 1 } })
  expect(handable(work({ exports: [exp('csv'), fact] }))).toBe(true)
  expect(handable(work())).toBe(false)
})

test('integrationText: 아직 재지 않음, 열린 것 없음, 열린 것 n개', () => {
  expect(integrationText(work({ evidence: null, integration: null }))).toBe(
    '통합 증거를 아직 재지 않았습니다',
  )
  expect(integrationText(work())).toBe('통합 증거: 열린 것 없음')
  expect(integrationText(work({ integration: ['통합 증거: 명령 실패: test'] }))).toBe(
    '통합 증거: 열린 것 1개',
  )
})

test('단위 머리가 붙은 열린 것: 리뷰를 끈 앱의 리뷰 없음·건너뜀, 리뷰 실패의 안내', () => {
  const off = { reviewDisabled: true }
  expect(factText('csv: 리뷰를 건너뜀', off)).toBe('csv: 리뷰가 꺼져 있음(평가 설정)')
  expect(factText('통합 증거: 리뷰 없음', off)).toBe('통합 증거: 리뷰 없음')
  expect(openText('csv: 리뷰 실패', { reviewDisabled: false })).toBe(
    'csv: 리뷰 실패: 끝내기를 다시 누르면 리뷰를 다시 돌립니다',
  )
})

test('endMovedText: 단위 브랜치만 움직여 지운 상자는 그렇게 말한다', () => {
  const head = 'w'.repeat(40)
  expect(endMovedText(work({ endMoved: head }))).toBe(
    '[끝내기] 뒤 세션이 단위 브랜치에 새로 커밋했습니다. 새 커밋의 증거와 리뷰를 보려면 끝내기를 다시 누르세요',
  )
  // one_branch는 앞 그대로(같은 head면 보이지 않는다)
  expect(endMovedText(work({ endMoved: head, exports: [] }))).toBeNull()
})

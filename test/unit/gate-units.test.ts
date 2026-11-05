// [단위] 단위 브랜치의 내보내기와 통합 증거(V22): 내보내기가 자동 조건(그림자 포함)을 채운 것으로 보려면 통합 증거에 열린
// 것이 없고 Work 전체 diff로도 같은 조건을 채워야 한다. 통합 증거는 리뷰하지 않는다(openItems의 review 거짓). 바탕은
// test/support/gate.ts
import { describe, expect, test } from 'vitest'
import { contractHash } from '../../src/core/contract.ts'
import { gate, integrationFacts, openItems } from '../../src/core/gate.ts'
import type { AutoCondition, EvidenceBundle, Integration } from '../../src/core/types.ts'
import { command, contract, DIFF, evidence, HEAD, policy, small } from '../support/gate.ts'

/** Work 브랜치(모든 단위)의 끝 */
const WORK = 'w'.repeat(40)

/** 깨끗한 통합 증거: Work 브랜치를 계약 전체로 잰 결정론 묶음(리뷰 없음) */
function integration(over: Partial<EvidenceBundle> = {}, head = WORK): Integration {
  const c = contract()
  return {
    evidence: evidence({ head: WORK, review: null, ...over }),
    contract: c,
    head,
  }
}

const exported = (whole: Integration, p = policy()) => gate(evidence(), contract(), p, HEAD, whole)

describe('통합 증거에 열린 것이 있으면 내보내기는 자동 조건을 채운 것이 아니다', () => {
  test('깨끗한 통합 증거(리뷰 없음)면 내보내기는 그대로 자동 머지 후보다', () => {
    expect(exported(integration())).toMatchObject({
      conclusion: 'auto_merge_candidate',
      condition: 'small',
    })
    // 그림자도 같다
    const shadow = exported(integration(), policy({ auto_merge_enabled: false }))
    expect(shadow).toMatchObject({ condition: 'small', shadow: true })
  })

  test('통합 증거의 명령 실패는 사람 머지이고 그림자도 아니다', () => {
    const r = exported(integration({ commands: [command('test', 'fail')] }))
    expect(r).toEqual({
      conclusion: 'human_merge',
      decisive: '통합 증거: 명령 실패: test',
      reasons: ['통합 증거: 명령 실패: test'],
      condition: null,
      shadow: false,
    })
  })

  test('재지 못한 통합 증거, 낡은 통합 증거도 막는다', () => {
    expect(exported({ evidence: null, contract: contract(), head: WORK }).decisive).toBe(
      '통합 증거 없음',
    )
    expect(exported(integration({}, 'n'.repeat(40))).decisive).toBe(
      '통합 증거: 낡은 증거: 묶음은 wwwwwww, 지금 head는 nnnnnnn',
    )
  })

  test('통합 증거가 다른 계약으로 만든 것이면 막는다', () => {
    const other = { id: 'w1', hash: contractHash(contract({ goal: '다른 목표' })) }
    expect(exported(integration({ contract: other })).decisive).toBe(
      '통합 증거: 증거를 만든 뒤 계약이 바뀜',
    )
  })

  test('내보내기 자신의 사실이 먼저다(통합 증거는 그 뒤에 본다)', () => {
    const r = gate(
      evidence({ missing: ['ci'] }),
      contract(),
      policy(),
      HEAD,
      integration({ missing: ['x'] }),
    )
    expect(r.reasons).toEqual(['없는 증거: ci'])
  })
})

test('앱이 본 통합의 사실(Work 브랜치에 커밋이 다 있지 않은 단위 브랜치)도 통합 증거의 열린 것이다: 사람 머지, 그림자도 아니다', () => {
  const fact = '단위 브랜치의 커밋이 Work 브랜치에 없음: relay/x--csv'
  const r = exported({ ...integration(), facts: [fact] })
  expect(r).toEqual({
    conclusion: 'human_merge',
    decisive: `통합 증거: ${fact}`,
    reasons: [`통합 증거: ${fact}`],
    condition: null,
    shadow: false,
  })
  expect(
    integrationFacts({ evidence: null, contract: contract(), head: WORK, facts: [fact] }),
  ).toEqual(['통합 증거 없음', `통합 증거: ${fact}`])
})

describe('Work 전체 diff로도 같은 조건을 채워야 한다', () => {
  test('내보내기는 작아도 Work 전체가 크면 채운 조건이 없다', () => {
    const whole = integration({ diff: { ...DIFF, added: 110, deleted: 10 } })
    expect(exported(whole)).toEqual({
      conclusion: 'human_merge',
      decisive: '채운 자동 조건 없음',
      reasons: ['채운 자동 조건 없음', '조건 small: Work 전체 바뀐 줄 120 > 50'],
      condition: null,
      shadow: false,
    })
  })

  test('조건마다 두 diff를 함께 보고, 둘 다 채운 처음 조건을 쓴다', () => {
    const docs: AutoCondition = { id: 'docs', paths: ['src/**', 'test/**', 'docs/**'] }
    const whole = integration({ diff: { ...DIFF, added: 70, paths: ['src/a.ts', 'docs/x.md'] } })
    const p = policy({ conditions: [small, docs], track_record_ok: { small: true, docs: true } })
    expect(exported(whole, p)).toMatchObject({
      conclusion: 'auto_merge_candidate',
      condition: 'docs',
    })
  })
})

test('openItems(review 거짓): 통합 증거는 리뷰 사실(리뷰 없음, 올림)을 보지 않는다', () => {
  const e = evidence({ review: null, commands: [command('lint', 'unstable')] })
  expect(openItems(e, contract(), HEAD)).toEqual(['불안정한 명령: lint', '리뷰 없음'])
  expect(openItems(e, contract(), HEAD, false)).toEqual(['불안정한 명령: lint'])
})

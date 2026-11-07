// [단위] 관문 재생 자료를 만드는 도구(scripts/gate-replay-fixture.ts)의 묶음 줄이기. 커밋하는 기록에 모델 이름을 남기지 않는다
// (docs/experiments/m4/log.md '모델 이름 지우기'): 리뷰어의 출력이 말한 모델(review.model, M4a)은 빼고 나머지 리뷰 칸은 그대로다.
import { describe, expect, test } from 'vitest'
import { slimEvidence } from '../../scripts/gate-replay-fixture.ts'
import { evidence, finding, reviewed } from '../support/gate.ts'

describe('관문 재생 자료 쓰기', () => {
  test('리뷰의 모델 이름은 쓰지 않고 status, request, prompt_version, raise가 있는 지적은 남긴다', () => {
    const review = {
      ...reviewed([finding({ raise: 'security' }), finding({ id: 'f2' })]),
      prompt_version: 3,
      model: 'reviewer-model-x',
    }
    const e = evidence({ review })
    const slim = slimEvidence(e, e.ratchets, undefined)
    const line = JSON.stringify(slim)
    expect(line).not.toContain('reviewer-model-x')
    expect(slim.review).not.toHaveProperty('model')
    expect(slim.review).toEqual({
      status: 'done',
      request: true,
      prompt_version: 3,
      findings: [{ id: 'f1', severity: 'high', raise: 'security', text: '지적' }],
    })
  })

  test('모델 이름이 없는 묶음은 리뷰 칸이 그대로다(기존 자료가 바이트까지 같다)', () => {
    const e = evidence()
    expect(slimEvidence(e, e.ratchets, undefined).review).toEqual(e.review)
  })
})

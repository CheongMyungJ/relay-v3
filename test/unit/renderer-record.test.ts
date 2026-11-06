// [단위] 실적의 글(M4c, src/renderer/src/record.ts): 그림자 줄은 표본의 끝이 정해진 뒤에만(Q6), 숫자는 k/n과 Wilson 하한, 사건
// 0건은 3의 규칙의 위 한계, 진행 막대·'M5까지 몇 건' 같은 할 일 글이 없음. CLI(src/cli/record.ts)의 글도 같은 것을 담는다
import { expect, test } from 'vitest'
import { recordText } from '../../src/cli/record.ts'
import type { GateResult } from '../../src/core/types.ts'
import { recordStats } from '../../src/engine/shadow.ts'
import {
  afterText,
  conditionHead,
  conditionRest,
  epochText,
  footText,
  ratio,
  shadowLine,
} from '../../src/renderer/src/record.ts'
import type { AfterStats } from '../../src/shared/api.ts'

const SHADOW: GateResult = {
  conclusion: 'human_merge',
  decisive: '프로젝트에서 자동 머지가 꺼져 있음',
  reasons: [],
  condition: 'small',
  shadow: true,
}

test('그림자 줄: 끝이 정해지기 전에는 가리고, 끝난 뒤 일치·불일치(갈래)', () => {
  expect(shadowLine(SHADOW, undefined)).toBeNull()
  expect(
    shadowLine(
      { ...SHADOW, shadow: false },
      { unit: null, conditions: ['small'], result: 'match', why: null },
    ),
  ).toBeNull()
  expect(
    shadowLine(SHADOW, { unit: null, conditions: ['small'], result: 'match', why: null }),
  ).toBe('그림자 표본: 일치 (조건 small)')
  expect(
    shadowLine(SHADOW, {
      unit: null,
      conditions: ['small', 'docs'],
      result: 'miss',
      why: 'more_human',
    }),
  ).toBe('그림자 표본: 불일치(사람이 더 고침) (조건 small, docs)')
  // '자동이었으면 머지했을 것'은 더 이상 보이지 않는다(닻 내림)
  expect(
    shadowLine(SHADOW, { unit: null, conditions: [], result: 'miss', why: 'closed' }),
  ).not.toMatch(/자동이었으면/)
})

const AFTER: AfterStats = {
  merges: 9,
  closed: 4,
  watching: 5,
  reverts: 0,
  main: { attributed: 0, pending: 1, inherited: 0, unknown: 0 },
  unmeasurable: 0,
  disputed: 0,
  upper: 0.75,
  events: [],
}

test('k/n과 하한, 머지 뒤 30일의 글(0이면 위 한계)', () => {
  expect(ratio(7, 9, 0.4532)).toBe('7/9 (하한 0.45)')
  expect(ratio(0, 0, null)).toBe('0/0')
  expect(afterText(AFTER)).toBe(
    '머지 뒤(창 닫힘 4, 지켜보는 중 5): 되돌림 0, main 실패 귀속 0, 미정 1 (위 한계 약 0.75)',
  )
  expect(afterText({ ...AFTER, merges: 0 })).toBe('머지 뒤: 머지 없음')
  expect(epochText(null)).toBe('판 모름')
  expect(
    epochText({ model: 'm', effort: null, claude: '2.4', gate_epoch: 1, review_prompt: 4 }),
  ).toBe('모델 m, effort 모름, Claude Code 2.4, 관문 판 1, 리뷰 프롬프트 4')
})

test('조건 줄과 CLI 표에 할 일 글(진행 막대, M5까지, 남은 주)이 없다', () => {
  const line = {
    ts: '2026-11-20T00:00:00Z',
    project: 'p1',
    work: 'w',
    head: 'h',
    conclusion: 'human_merge' as const,
    condition: 'small',
    shadow: true,
    met: ['small'],
    conds: { small: 'a1b2c3d4e5f6' },
    model_observed: 'm',
    effort: 'medium',
    claude_version: '2.4.1',
    gate_version: 1,
    review_prompt: 4,
    relay_version: '0',
  }
  const merged = {
    ...line,
    met: undefined,
    condition: null,
    shadow: false,
    merged_head: 'h',
    by: 'human' as const,
  }
  const r = recordStats({
    entries: [line, merged],
    scope: { project: 'p1' },
    now: '2026-11-30T00:00:00Z',
    allEpochs: false,
    broken: 1,
  })
  const small = r.conditions[0]
  if (!small) throw new Error('small 없음')
  expect(conditionHead(small)).toBe('small (a1b2c3) · 일치 1/1 (하한 0.21)')
  const all = [conditionHead(small), ...conditionRest(small), footText(r), ...recordText('p1', r)]
  for (const text of all) expect(text).not.toMatch(/M5|몇 건|남은|진행|%/)
  expect(footText(r)).toBe('판을 모르는 결론 줄 0/1 · 읽지 못한 장부 줄 1')
  expect(recordText('p1', r)[1]).toBe(
    '이 판: 모델 m, effort medium, Claude Code 2.4, 관문 판 1, 리뷰 프롬프트 4',
  )
})

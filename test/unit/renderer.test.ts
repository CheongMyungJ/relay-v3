// [단위] 렌더러의 순수 조각 (src/renderer/src/format.ts, termSize.ts). 화면을 띄우지 않고 본다.
// 화면 전체는 [스모크] test/smoke/app.spec.ts가 이어지는지만 본다.
import { describe, expect, test } from 'vitest'
import type { GateResult } from '../../src/core/types.ts'
import type { WorkView } from '../../src/shared/api.ts'
import {
  canMergeView,
  conclusionOf,
  decisiveText,
  exitText,
  groundStatus,
  isStale,
  missingOf,
  nextStep,
  outcomeOf,
  reviewNote,
  splitDiff,
} from '../../src/renderer/src/format.ts'
import { evidence } from '../support/gate.ts'
import { chunkOrder, sizeSender } from '../../src/renderer/src/termSize.ts'

describe('chunkOrder: 붙기 전 조각과 지난 출력을 잇는다', () => {
  function sink() {
    const written: string[] = []
    const later: (() => void)[] = []
    const order = chunkOrder((data, cb) => {
      written.push(data)
      if (cb) later.push(cb)
    })
    return { written, order, flush: () => later.splice(0).forEach((f) => f()) }
  }

  test('attach 답보다 먼저 온 조각은 지난 출력 뒤에 차례대로, 이미 든 조각(seq < backlog.seq)은 버린다', () => {
    const { written, order } = sink()
    order.chunk({ data: 'c', seq: 2 })
    order.chunk({ data: 'a', seq: 0 })
    order.chunk({ data: 'b', seq: 1 })
    expect(written).toEqual([])
    order.backlog({ data: 'AB', seq: 1 })
    expect(written).toEqual(['AB', 'b', 'c'])
    order.chunk({ data: 'c', seq: 2 })
    order.chunk({ data: 'd', seq: 3 })
    expect(written).toEqual(['AB', 'b', 'c', 'd'])
  })

  test('지난 출력을 다 쓸 때까지 replaying(그동안 xterm의 응답은 세션에 보내지 않는다)', () => {
    const { order, flush } = sink()
    let done = false
    expect(order.replaying).toBe(true)
    order.backlog({ data: 'x', seq: 0 }, () => (done = true))
    expect(order.replaying).toBe(true)
    flush()
    expect([order.replaying, done]).toEqual([false, true])
  })
})

test('sizeSender: 처음이거나 바뀐 크기만, PTY가 받는 크기만 보낸다', () => {
  const sent: string[] = []
  const send = sizeSender((s) => void sent.push(`${s.cols}x${s.rows}`))
  send({ cols: 80, rows: 24 })
  send({ cols: 80, rows: 24 })
  send({ cols: 1, rows: 24 })
  send({ cols: 100.5, rows: 30 })
  send({ cols: 100, rows: 30 })
  expect(sent).toEqual(['80x24', '100x30'])
})

describe('splitDiff: diff(id)의 글을 파일로 나눈다', () => {
  const text = [
    ' src/a.ts   | 3 ++-',
    ' img.png    | Bin 0 -> 4 bytes',
    ' 2 files changed, 2 insertions(+), 1 deletion(-)',
    '',
    'diff --git a/src/a.ts b/src/a.ts',
    'index 1..2 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,2 +1,3 @@',
    ' keep',
    '--- removed line that starts with dashes',
    '+++ added line that starts with pluses',
    '+new',
    'diff --git a/img.png b/img.png',
    'new file mode 100644',
    'Binary files /dev/null and b/img.png differ',
    '',
  ].join('\n')

  test('경로, 더한·뺀 줄(머리는 세지 않음), 바이너리', () => {
    const files = splitDiff(text)
    expect(files.map((f) => [f.path, f.added, f.deleted, f.binary])).toEqual([
      ['src/a.ts', 2, 1, false],
      ['img.png', 0, 0, true],
    ])
    expect(files[0]?.patch.startsWith('diff --git a/src/a.ts')).toBe(true)
  })

  test('바뀐 것이 없으면 빈 목록', () => {
    expect(splitDiff('\n\n')).toEqual([])
  })
})

test('groundStatus: guess는 추정, 확인 못 한 근거도 추정, 근거 확인 결과가 없으면 확인 못 함', () => {
  const code = { type: 'code', path: 'a.ts', line: 1 } as const
  const label = (ok: boolean | null) =>
    groundStatus(code, ok === null ? undefined : { line: 'C1', ground: code, ok, detail: '' }).label
  expect([label(true), label(false), label(null)]).toEqual(['확인됨', '추정', '확인 못 함'])
  expect(groundStatus({ type: 'guess' }, undefined).label).toBe('추정')
})

test('conclusionOf: 그림자면 자동이었으면 머지했을 것과 조건', () => {
  const gate: GateResult = {
    conclusion: 'human_merge',
    decisive: '프로젝트에서 자동 머지가 꺼져 있음',
    reasons: [],
    condition: 'small',
    shadow: true,
  }
  expect(conclusionOf(gate)).toEqual({
    label: '사람 머지',
    tone: 'info',
    shadow: '그림자: 자동이었으면 머지했을 것 (조건 small)',
  })
  expect(conclusionOf({ ...gate, shadow: false }).shadow).toBeNull()
})

test('낡은 증거와 [머지]를 누를 수 있는 때', () => {
  const pr = {
    number: 1,
    url: 'u',
    state: 'OPEN' as const,
    headRefOid: 'h1',
    baseRefName: 'main',
    isDraft: false,
    mergedAt: null,
  }
  const gate: GateResult = {
    conclusion: 'human_merge',
    decisive: 'x',
    reasons: ['x'],
    condition: null,
    shadow: false,
  }
  const v = {
    state: 'working',
    base: 'main',
    head: 'h1',
    evidence: { head: 'h1' },
    gate,
    pr,
    evidenceRunning: false,
    reviewRunning: false,
  } as unknown as WorkView
  expect([isStale(v), canMergeView(v)]).toEqual([false, true])
  expect(isStale({ ...v, head: 'h2' })).toBe(true)
  expect(isStale({ ...v, head: null })).toBe(false)
  expect(canMergeView({ ...v, state: 'recontract' })).toBe(false)
  expect(canMergeView({ ...v, gate: null })).toBe(false)
  expect(canMergeView({ ...v, pr: { ...pr, state: 'MERGED' } })).toBe(false)
  expect(canMergeView({ ...v, evidenceRunning: true })).toBe(false)
  // 리뷰는 사람을 막지 않는다(V4)
  expect(canMergeView({ ...v, reviewRunning: true })).toBe(true)
  // PR이 증거의 head를 가리키지 않거나 다른 기준으로 가면 머지할 수 없다
  expect(canMergeView({ ...v, pr: { ...pr, headRefOid: 'h0' } })).toBe(false)
  expect(canMergeView({ ...v, pr: { ...pr, baseRefName: 'dev' } })).toBe(false)
})

describe('증거 패널의 글', () => {
  const base = {
    state: 'working',
    base: 'main',
    head: evidence().head,
    evidence: evidence({ review: null }),
    gate: {
      conclusion: 'human_merge',
      decisive: '리뷰 없음',
      reasons: [],
      condition: null,
      shadow: false,
    },
    pr: null,
    evidenceRunning: false,
    reviewRunning: false,
  } as unknown as WorkView
  const pr = {
    number: 3,
    url: 'u',
    state: 'OPEN' as const,
    headRefOid: evidence().head,
    baseRefName: 'main',
    isDraft: false,
    mergedAt: null,
  }

  test('reviewNote: 지적 0개라도 실패·건너뜀·리뷰 없음은 지적 없음이라고 하지 않는다', () => {
    expect(reviewNote({ status: 'failed', findings: [] }, false)).toBe(
      '리뷰 실패: 지적을 받지 못함',
    )
    expect(reviewNote({ status: 'skipped', findings: [] }, false)).toMatch(/^리뷰를 건너뜀/)
    expect(reviewNote(null, false)).toMatch(/^리뷰 없음: 리뷰는 PR을 열거나/)
    expect(reviewNote(null, true)).toBe('독립 리뷰 중…')
    expect(reviewNote({ status: 'done', findings: [] }, false)).toBe('지적 없음')
    expect(
      reviewNote({ status: 'done', findings: [{ id: 'R1', severity: 'low', text: 'x' }] }, false),
    ).toBeNull()
  })

  test('decisiveText: 리뷰 중이면 그렇게, 내보내기가 아닌 리뷰 없음은 언제 도는지 풀어 쓴다', () => {
    expect(decisiveText(base)).toBe('리뷰 없음 (리뷰는 PR을 열거나 갱신할 때, 끝낼 때 돕니다)')
    expect(decisiveText({ ...base, reviewRunning: true })).toMatch(/^독립 리뷰 중/)
    const reviewed = {
      ...base,
      evidence: evidence(),
      gate: { ...base.gate, decisive: 'x' },
    } as WorkView
    expect(decisiveText(reviewed)).toBe('x')
  })

  test('missingOf: 품질 기준이 없으면 quality.json을 맨 앞에(core summarize와 같게)', () => {
    expect(
      missingOf(evidence({ quality: { hash: '', from: 'none' }, missing: ['acceptance'] })),
    ).toEqual(['quality.json', 'acceptance'])
    expect(missingOf(evidence({ missing: ['ci'] }))).toEqual(['ci'])
  })

  test('nextStep: PR이 지금 HEAD를 가리키지 않음, 품질 기준 없음, PR 없음의 다음 할 일', () => {
    expect(
      nextStep({ ...base, pr: { ...pr, headRefOid: 'a'.repeat(40) }, head: 'b'.repeat(40) }),
    ).toBe('PR이 지금 HEAD(bbbbbbb)를 가리키지 않음: 세션에게 push를 요청하세요')
    expect(
      nextStep({ ...base, evidence: evidence({ quality: { hash: '', from: 'none' } }) }),
    ).toMatch(/relay init/)
    expect(nextStep(base)).toMatch(/^리뷰와 머지는 PR이 열리면 시작합니다/)
    expect(nextStep({ ...base, pr })).toBeNull()
    expect(nextStep({ ...base, state: 'done' })).toBeNull()
  })

  test('outcomeOf: 끝난 Work의 결과 한 줄', () => {
    expect(outcomeOf(base)).toBeNull()
    expect(outcomeOf({ ...base, state: 'abandoned' })).toBe('버림')
    expect(outcomeOf({ ...base, state: 'done' })).toBe('머지 없이 끝남')
    expect(outcomeOf({ ...base, state: 'done', pr: { ...pr, state: 'MERGED' } })).toBe(
      `머지됨 · PR #3 · ${evidence().head.slice(0, 7)}`,
    )
    expect(outcomeOf({ ...base, state: 'done', pr: { ...pr, state: 'CLOSED' } })).toBe(
      '머지 없이 끝남 · PR #3 닫힘',
    )
  })

  test('exitText: 앱이 끝낸 세션(신호)은 종료 코드 없이', () => {
    expect([exitText(129), exitText(143), exitText(1)]).toEqual([
      '[세션을 닫음]',
      '[세션을 닫음]',
      '[세션이 끝남: 종료 코드 1]',
    ])
  })
})

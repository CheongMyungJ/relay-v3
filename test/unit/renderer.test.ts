// [단위] 렌더러의 순수 조각 (src/renderer/src/format.ts, termSize.ts). 화면을 띄우지 않고 본다.
// 화면 전체는 [스모크] test/smoke/app.spec.ts가 이어지는지만 본다.
import { describe, expect, test } from 'vitest'
import type { Contract, ContractLine, GateResult } from '../../src/core/types.ts'
import type { WorkView } from '../../src/shared/api.ts'
import {
  canMergeView,
  conclusionOf,
  contractDelta,
  decisiveText,
  deliveryText,
  diffOpen,
  type DiffFile,
  draftPending,
  draftResultText,
  endArmed,
  endHanded,
  endMovedText,
  endTexts,
  exitText,
  factText,
  groundStatus,
  isStale,
  missingOf,
  nextStep,
  outcomeOf,
  qualityNotice,
  REVIEW_DISABLED,
  reviewMeta,
  reviewNote,
  openText,
  showEndBox,
  splitDiff,
  unitGroups,
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

test('diffOpen: 5파일 이하이고 바뀐 줄(더한 줄 + 뺀 줄)이 400 이하면 펼친 채로 연다(M2.1 13절)', () => {
  const file = (added: number, deleted = 0): DiffFile => ({
    path: `f${added}-${deleted}`,
    added,
    deleted,
    binary: false,
    patch: '',
  })
  expect(diffOpen([file(3, 1), file(10)])).toBe(true)
  expect(diffOpen([file(200, 100), file(100)])).toBe(true)
  expect(diffOpen([file(200, 100), file(100, 1)])).toBe(false)
  expect(diffOpen([1, 2, 3, 4, 5].map((n) => file(n)))).toBe(true)
  expect(diffOpen([1, 2, 3, 4, 5, 6].map((n) => file(n)))).toBe(false)
})

describe('contractDelta: 계약 바꾸기 상자의 승인본과 제안 사이 차이(M2.1 13절)', () => {
  const C1: ContractLine = {
    id: 'C1',
    kind: 'change',
    text: 'hi보다 큰 값은 hi가 된다',
    grounds: [{ type: 'code', path: 'src/calc.js', line: 5, name: 'clamp' }],
    examples: ['C1.1'],
    check: 'test',
  }
  const C2: ContractLine = {
    id: 'C2',
    kind: 'keep',
    text: '더하기는 그대로',
    grounds: [{ type: 'guess' }],
    examples: ['C2.1'],
    check: 'test',
  }
  const approved: Contract = {
    version: 1,
    id: 'clamp-fix-ab12',
    goal: 'clamp가 hi보다 큰 값을 hi로 자른다',
    lines: [C1, C2],
    examples: [
      { id: 'C1.1', input: [15, 0, 10], output: 10 },
      { id: 'C2.1', input: [2, 3], output: 5 },
    ],
    non_goals: [],
    human_rules: [],
    tidy: [],
    approved_by: 'human',
    approved_at: '2026-11-05T09:00:00.000Z',
    change_requested: 'lo보다 작은 값도 고쳐야 함',
  }

  test('줄과 예시를 id로 짝지어 더함·고침(제안 차례), 뺌(승인본 차례). 고침은 고친 칸과 앞 글', () => {
    const proposed: Contract = {
      ...approved,
      lines: [
        {
          ...C1,
          text: 'hi보다 큰 값은 hi, lo보다 작은 값은 lo',
          examples: ['C1.1', 'C1.2'],
        },
        {
          id: 'C3',
          kind: 'new',
          text: 'lo보다 작은 값은 lo가 된다',
          grounds: [{ type: 'guess' }],
          examples: ['C1.2'],
          check: 'test',
        },
      ],
      examples: [
        { id: 'C1.1', input: [15, 0, 10], output: 10 },
        { id: 'C1.2', input: [-5, 0, 10], output: 0, note: '아래로 넘음' },
      ],
    }
    delete proposed.approved_by
    delete proposed.approved_at
    delete proposed.change_requested
    const d = contractDelta(approved, proposed)
    expect(d.lines).toEqual([
      {
        id: 'C1',
        how: 'changed',
        text: '바뀜 · hi보다 큰 값은 hi, lo보다 작은 값은 lo',
        fields: ['글', '예시'],
        before: '바뀜 · hi보다 큰 값은 hi가 된다',
      },
      { id: 'C3', how: 'added', text: '새로 · lo보다 작은 값은 lo가 된다', fields: [] },
      { id: 'C2', how: 'removed', text: '지킴 · 더하기는 그대로', fields: [] },
    ])
    expect(d.examples).toEqual([
      { id: 'C1.2', how: 'added', text: '[-5,0,10] → 0', fields: [] },
      { id: 'C2.1', how: 'removed', text: '[2,3] → 5', fields: [] },
    ])
    // 승인 표시와 계약 변경 요청은 내용이 아니다
    expect(d.other).toEqual([])
  })

  test('글이 그대로인 고침은 앞 글 없이 칸만, 열쇠 차례만 다른 값은 같다, 줄 밖에서 바뀐 것은 이름으로', () => {
    const proposed: Contract = {
      ...approved,
      goal: 'clamp가 범위 밖 값을 자른다',
      non_goals: ['인자 순서는 그대로'],
      lines: [
        {
          ...C1,
          // 열쇠 차례만 다름
          grounds: [{ name: 'clamp', line: 5, path: 'src/calc.js', type: 'code' }],
        },
        { ...C2, check: 'human' },
      ],
      examples: [
        { id: 'C1.1', input: [15, 0, 10], output: 10 },
        { id: 'C2.1', input: [2, 3], output: 5, note: '그대로' },
      ],
    }
    const d = contractDelta(approved, proposed)
    expect(d.lines).toEqual([
      { id: 'C2', how: 'changed', text: '지킴 · 더하기는 그대로', fields: ['확인 방법'] },
    ])
    expect(d.examples).toEqual([
      { id: 'C2.1', how: 'changed', text: '[2,3] → 5', fields: ['메모'] },
    ])
    expect(d.other).toEqual(['목표', '비목표'])
    expect(contractDelta(approved, { ...approved })).toEqual({ lines: [], examples: [], other: [] })
  })

  test('단위(V21): 줄의 단위를 바꾸면 고친 칸 단위, 전달 방식을 적으면 그 밖의 전달 방식', () => {
    const proposed: Contract = {
      ...approved,
      delivery: 'one_branch',
      lines: [{ ...C1, unit: 'clamp' }, C2],
    }
    const d = contractDelta(approved, proposed)
    expect(d.lines).toEqual([
      { id: 'C1', how: 'changed', text: '바뀜 · hi보다 큰 값은 hi가 된다', fields: ['단위'] },
    ])
    expect(d.other).toEqual(['전달 방식'])
  })

  test('계약 판(V21): 줄을 단위로 묶고(처음 나온 차례, 단위 없는 줄은 한 묶음), 단위가 있으면 전달 방식을 보인다', () => {
    const lines = [
      { ...C1, unit: 'csv' },
      C2,
      { ...C1, id: 'C3', unit: 'money' },
      { ...C2, id: 'C4', unit: 'csv' },
    ]
    const c: Contract = { ...approved, lines }
    expect(unitGroups(c).map((g) => [g.unit, g.lines.map((l) => l.id)])).toEqual([
      ['csv', ['C1', 'C4']],
      [null, ['C2']],
      ['money', ['C3']],
    ])
    expect(unitGroups(approved)).toEqual([{ unit: null, lines: [C1, C2] }])
    // 전달 방식: 단위가 있으면 기본(한 브랜치)을 보이고, 단위도 전달 방식도 없으면 보이지 않는다
    expect(deliveryText(c, 'relay/two-bugs-ab12')).toBe(
      '한 브랜치: 모든 단위를 relay/two-bugs-ab12에 두고, 단위마다 커밋을 따로 합니다',
    )
    expect(deliveryText(approved, 'relay/x')).toBeNull()
    expect(deliveryText({ ...approved, delivery: 'one_branch' }, 'relay/x')).toContain('한 브랜치')
  })
})

test('groundStatus: guess는 추정, 확인 못 한 근거도 추정, 근거 확인 결과가 없으면 확인 못 함', () => {
  const code = { type: 'code', path: 'a.ts', line: 1 } as const
  const label = (ok: boolean | null) =>
    groundStatus(code, ok === null ? undefined : { line: 'C1', ground: code, ok, detail: '' }).label
  expect([label(true), label(false), label(null)]).toEqual(['확인됨', '추정', '확인 못 함'])
  expect(groundStatus({ type: 'guess' }, undefined).label).toBe('추정')
})

test('conclusionOf: 결론의 이름과 색만(그림자 줄은 끝이 정해진 뒤 record.ts shadowLine, Q6)', () => {
  const gate: GateResult = {
    conclusion: 'human_merge',
    decisive: '프로젝트에서 자동 머지가 꺼져 있음',
    reasons: [],
    condition: 'small',
    shadow: true,
  }
  expect(conclusionOf(gate)).toEqual({ label: '사람 머지', tone: 'info' })
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
    exports: [],
    integration: null,
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
    expect(reviewNote(null, false)).toBe(
      '리뷰 없음: 리뷰는 증거가 통과하고 세션이 쉴 때, PR을 열거나 갱신할 때, 끝낼 때 돕니다',
    )
    expect(reviewNote(null, true)).toBe('리뷰 도는 중…')
    expect(reviewNote({ status: 'done', findings: [] }, false)).toBe('지적 없음')
    expect(
      reviewNote({ status: 'done', findings: [{ id: 'R1', severity: 'low', text: 'x' }] }, false),
    ).toBeNull()
  })

  test('decisiveText: 리뷰가 돌면 그렇게, 아직 리뷰가 없으면 언제 도는지(미리 리뷰, V23) 풀어 쓴다', () => {
    expect(decisiveText(base)).toBe(
      '리뷰 없음 (리뷰는 증거가 통과하고 세션이 쉴 때, PR을 열거나 갱신할 때, 끝낼 때 돕니다)',
    )
    expect(decisiveText({ ...base, reviewRunning: true })).toMatch(/^리뷰 도는 중/)
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
    expect(nextStep(base)).toMatch(
      /^머지는 PR이 열리면 할 수 있습니다\. 리뷰는 증거가 통과하고 세션이 쉬면 미리 돕니다/,
    )
    expect(nextStep({ ...base, pr })).toBeNull()
    expect(nextStep({ ...base, state: 'done' })).toBeNull()
    // 품질 기준 알림(V20)이 위에 보이면 되풀이하지 않는다
    const none = {
      ...base,
      evidence: evidence({ quality: { hash: '', from: 'none' }, review: null }),
    }
    expect(nextStep(none, { qualityNotice: true })).toMatch(/리뷰는 증거가 통과하고/)
    // 미리 리뷰(V23)나 [끝내기]로 리뷰가 이미 돌았으면 머지만 PR을 기다린다. 걸린 끝이나 상자(V25)가 보이면 그것이 다음 할 일
    expect(nextStep({ ...base, evidence: evidence() })).toBe(
      '머지는 PR이 열리면 할 수 있습니다. 세션에게 PR을 열라고 하거나, PR 없이 끝내려면 끝내기를 누르세요',
    )
    expect(nextStep(base, { ending: true })).toBeNull()
    // 리뷰가 도는 동안은 언제 도는지 말하지 않는다
    expect(nextStep({ ...base, reviewRunning: true })).toBe(
      '머지는 PR이 열리면 할 수 있습니다. 세션에게 PR을 열라고 하거나, PR 없이 끝내려면 끝내기를 누르세요',
    )
  })

  test('리뷰를 평가용으로 끈 Work(reviewDisabled)는 리뷰 문구를 그 뜻으로만 쓴다(다른 건너뜀과 섞지 않음)', () => {
    const off = { ...base, reviewDisabled: true }
    expect(REVIEW_DISABLED).toBe('리뷰가 꺼져 있음(평가 설정)')
    // 내보내기 전(리뷰 없음)과 내보내기 뒤(건너뜀) 모두
    expect(decisiveText(off)).toBe(REVIEW_DISABLED)
    const skipped = {
      ...off,
      evidence: evidence({ review: { status: 'skipped', findings: [] } }),
      gate: { ...base.gate, decisive: '리뷰를 건너뜀' },
    } as WorkView
    expect(decisiveText(skipped)).toBe(REVIEW_DISABLED)
    expect(reviewNote({ status: 'skipped', findings: [] }, false, true)).toBe(REVIEW_DISABLED)
    expect(reviewNote(null, false, true)).toBe(REVIEW_DISABLED)
    expect(reviewMeta({ status: 'skipped', findings: [] }, { disabled: true })).toBe(
      REVIEW_DISABLED,
    )
    expect(factText('리뷰를 건너뜀', off)).toBe(REVIEW_DISABLED)
    expect(factText('명령 실패: unit', off)).toBe('명령 실패: unit')
    // 켜져 있으면 그대로: 건너뜀의 다른 까닭, 언제 도는지
    expect(factText('리뷰를 건너뜀', base)).toBe('리뷰를 건너뜀')
    expect(reviewNote({ status: 'skipped', findings: [] }, false)).toMatch(/자동 후보에만/)
    expect(reviewMeta({ status: 'skipped', findings: [] })).toBe('리뷰 건너뜀')
    expect(reviewMeta(null)).toBe('리뷰 없음')
    expect(reviewMeta({ status: 'done', findings: [] }, { disabled: true })).toBe('리뷰 지적 0개')
    // 지금 HEAD의 묶음이면 리뷰가 끝났다고 보인다(V23: [끝내기]가 기다리지 않는다)
    expect(reviewMeta({ status: 'done', findings: [] }, { current: true })).toBe(
      '리뷰 끝(이 head): 지적 0개',
    )
    expect(reviewMeta({ status: 'failed', findings: [] }, { current: true })).toBe('리뷰 실패')
    expect(reviewMeta(null, { running: true })).toBe('리뷰 도는 중')
    // 다음 할 일, [끝내기] 단추와 걸린 끝도 리뷰를 말하지 않는다
    expect(nextStep(off)).toBe(
      '머지는 PR이 열리면 할 수 있습니다. 세션에게 PR을 열라고 하거나, PR 없이 끝내려면 끝내기를 누르세요(증거를 재고, 열린 것이 없으면 바로 끝냅니다)',
    )
    expect(nextStep(off)).not.toMatch(/리뷰/)
    expect(endTexts(off)).toEqual({
      button:
        '내보내기 증거를 재고, 열린 것이 없으면 Work를 끝냅니다. 열린 것이 있으면 [증거]에 보입니다',
      waiting: '재면 끝냄',
      armed:
        '끝내기가 걸려 있습니다: 내보내기 증거를 다 재고 열린 것이 없으면 Work를 끝냅니다. 열린 것이 있으면 여기에 보입니다.',
      box: '열린 것이 있습니다. 보고 끝낼지 정하세요. 고칠 것이 있으면 터미널에서 세션에게 말하세요.',
      handedButton: '고치면 끝냄',
      handed:
        '세션에 넘겼습니다: 세션이 고치고 쉬면 그 head의 내보내기 증거를 보고, 열린 것이 없으면 Work를 끝냅니다. 열린 것이 있으면 상자가 다시 뜹니다.',
      hand: '열린 것의 리뷰 올림과 세션 몫 사실을 세션에 보내고, 세션이 고치고 쉬면 다시 끝내기를 봅니다',
    })
    // 리뷰를 끈 쪽은 '리뷰를 건너뜀'이 늘 열린 것이다(특례 없음): 상자에는 그 뜻으로 보인다
    expect(openText('리뷰를 건너뜀', off)).toBe(REVIEW_DISABLED)
    expect(endTexts(base)).toMatchObject({
      button: expect.stringMatching(/^내보내기 증거\(리뷰 포함\)를 재고, 열린 것이 없으면/),
      waiting: '리뷰 끝나면 끝냄',
      armed: expect.stringMatching(/^끝내기가 걸려 있습니다: 내보내기 증거와 리뷰가 끝나고/),
      handed: expect.stringMatching(/그 head의 내보내기 증거와 리뷰를 보고/),
    })
  })

  test('openText: 상자(V25)의 열린 것은 관문 사실 그대로, 리뷰 실패면 다시 누르라고 붙인다', () => {
    expect(openText('줄 C1 못 미침: x', base)).toBe('줄 C1 못 미침: x')
    expect(openText('리뷰를 건너뜀', base)).toBe('리뷰를 건너뜀')
    expect(openText('리뷰 실패', base)).toBe('리뷰 실패: 끝내기를 다시 누르면 리뷰를 다시 돌립니다')
  })

  test('showEndBox·endArmed·endHanded: 메인이 둔 상자와 걸린 끝(V25, V35)을 구현 중 Work에만 보인다', () => {
    const head = evidence().head
    const box = { ...base, endPending: { head, armed: false, open: ['리뷰 없음'] } }
    const armed = { ...base, endPending: { head, armed: true, open: [] } }
    expect(showEndBox(box)).toBe(true)
    expect(showEndBox({ ...box, state: 'recontract' })).toBe(true)
    expect(showEndBox({ ...box, state: 'done' })).toBe(false)
    expect(showEndBox({ ...base, endPending: null })).toBe(false)
    expect(showEndBox(armed)).toBe(false)
    expect(endArmed(armed)).toBe(true)
    expect(endArmed(box)).toBe(false)
    expect(endArmed({ ...armed, state: 'abandoned' })).toBe(false)
    // 상자에서 세션에 넘겨 다시 건 끝(V35): 상자가 아니라 걸린 끝이다. 세션의 고침을 기다리는 동안만 endHanded
    const handed = { ...base, endPending: { head, armed: false, open: [], handed: true as const } }
    expect(showEndBox(handed)).toBe(false)
    expect(endArmed(handed)).toBe(true)
    expect(endHanded(handed)).toBe(true)
    const measuring = {
      ...base,
      endPending: { head, armed: true, open: [], handed: true as const },
    }
    expect(endArmed(measuring)).toBe(true)
    expect(endHanded(measuring)).toBe(false)
    expect(endHanded(armed)).toBe(false)
    expect(endHanded({ ...handed, state: 'done' })).toBe(false)
    // HEAD가 바뀌어 메인이 지운 상자: 까닭을 한 줄로(구현 중이고 지금 HEAD가 그 head가 아닐 때만)
    const moved = { ...base, head: 'c'.repeat(40), endPending: null, endMoved: head }
    expect(endMovedText(moved)).toBe(
      `[끝내기] 뒤 세션이 새로 커밋했습니다(${head.slice(0, 7)} → ccccccc). 새 커밋의 증거와 리뷰를 보려면 끝내기를 다시 누르세요`,
    )
    expect(endMovedText({ ...moved, reviewDisabled: true })).toMatch(/새 커밋의 증거를 보려면/)
    expect(endMovedText({ ...moved, head })).toBeNull()
    expect(endMovedText({ ...moved, endMoved: null })).toBeNull()
    expect(endMovedText({ ...moved, state: 'done' })).toBeNull()
  })

  test('품질 기준 알림(V20)과 [초안 만들기]의 답', () => {
    expect(qualityNotice('present')).toBeNull()
    expect(qualityNotice('missing')).toBe(
      '이 레포에는 품질 기준(.relay/quality.json)이 없습니다. 앱이 명령을 돌리지 못해 증거가 비고, 결론은 늘 사람 머지입니다.',
    )
    expect(qualityNotice('invalid')).toMatch(
      /^이 레포의 품질 기준\(\.relay\/quality\.json\)이 깨져/,
    )
    expect(draftResultText({ written: true, path: '/r/.relay/quality.json' })).toBe(
      '초안을 썼습니다. 검토하고 기본 브랜치에 커밋하면 다음 Work부터 쓰입니다(V9: 기준은 base에서 읽음).',
    )
    expect(draftPending('main')).toBe(
      '작업 트리에 초안(.relay/quality.json)이 있습니다. 검토하고 기본 브랜치에 커밋하면 다음 Work부터 쓰입니다(V9: 기준은 base에서 읽음).',
    )
    expect(draftResultText({ written: false, path: '/r/.relay/quality.json' })).toMatch(
      /^이미 있어 덮지 않았습니다: \/r\/\.relay\/quality\.json\. 검토하고/,
    )
    // 기준을 origin/<기본>에서 읽으면 로컬 커밋만으로는 쓰이지 않는다: push까지 말한다
    expect(draftPending('origin/main')).toBe(
      '작업 트리에 초안(.relay/quality.json)이 있습니다. 검토하고 기본 브랜치에 커밋한 뒤 origin에 push하면 다음 Work부터 쓰입니다(V9: 기준은 origin/main에서 읽음).',
    )
    expect(
      draftResultText({ written: true, path: '/r/.relay/quality.json' }, 'origin/main'),
    ).toMatch(/^초안을 썼습니다\. 검토하고 기본 브랜치에 커밋한 뒤 origin에 push하면/)
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

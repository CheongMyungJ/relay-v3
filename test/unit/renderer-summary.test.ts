// [단위] 한눈에 보이는 짧은 글과 단축키, 패널 너비의 끝(V78, src/renderer/src/summary.ts, keys.ts, panelSize.ts), 화면과 메인이 같이 쓰는
// 답이 필요한가의 판정(src/shared/answer.ts)과 메인의 답 알림(src/main/attention.ts).
// 화면은 [스모크]가 이어지는지만 본다.
import { describe, expect, test } from 'vitest'
import type { EvidenceBundle, ReviewFinding } from '../../src/core/types.ts'
import { AttentionWatch } from '../../src/main/attention.ts'
import { newWorkKey, newWorkKeyText, tabKey, type KeyLike } from '../../src/renderer/src/keys.ts'
import { panelMax } from '../../src/renderer/src/panelSize.ts'
import {
  agoText,
  commandSummary,
  countSummary,
  doneOpen,
  knowledgeSummary,
  lineSummary,
  patchView,
  qualityShort,
  ratchetSummary,
  reviewSummary,
  splitPath,
  splitWorks,
} from '../../src/renderer/src/summary.ts'
import { answerReason, needsAnswer, showEndBox } from '../../src/shared/answer.ts'
import type { WorkView } from '../../src/shared/api.ts'
import { finding } from '../support/gate.ts'

const work = (id: string, more: Partial<WorkView> = {}): WorkView =>
  ({ id, title: `일 ${id}`, state: 'working', endPending: null, ...more }) as WorkView

describe('접는 칸의 오른쪽 한 마디', () => {
  const cmd = (outcome: string) => ({ id: outcome, outcome }) as EvidenceBundle['commands'][number]
  const line = (status: string) =>
    ({ line: 'C1', status }) as NonNullable<EvidenceBundle['lines']>[number]
  const ratchet = (status: string) => ({ id: status, status }) as EvidenceBundle['ratchets'][number]

  test('명령: 가장 나쁜 것 하나를 말하고, 모두 통과면 수와 통과', () => {
    expect(commandSummary([])).toEqual({ text: '없음', tone: 'muted' })
    expect(commandSummary([cmd('pass'), cmd('pass')])).toEqual({ text: '2개 통과', tone: 'ok' })
    expect(commandSummary([cmd('pass'), cmd('pre_existing'), cmd('fail')])).toEqual({
      text: '실패 1',
      tone: 'bad',
    })
    expect(commandSummary([cmd('pass'), cmd('unstable'), cmd('not_run')]).text).toBe('불안정 1')
    expect(commandSummary([cmd('not_run')])).toEqual({ text: '돌리지 못함 1', tone: 'warn' })
  })

  test('줄 판정: 못 미침 > 증거 없음 > 사람이 볼 줄 > 충족', () => {
    expect(lineSummary(null).text).toBe('계약 없이 잼')
    expect(lineSummary([line('met'), line('met')])).toEqual({ text: '2개 충족', tone: 'ok' })
    expect(lineSummary([line('met'), line('human'), line('observe')])).toEqual({
      text: '사람이 볼 줄 2',
      tone: 'info',
    })
    expect(lineSummary([line('missing_evidence'), line('human')]).tone).toBe('warn')
    expect(lineSummary([line('not_met'), line('missing_evidence')])).toEqual({
      text: '못 미침 1',
      tone: 'bad',
    })
  })

  test('래칫: 나빠짐 > 모름 > 나아짐 > 그대로', () => {
    expect(ratchetSummary([ratchet('same'), ratchet('same')])).toEqual({
      text: '2개 그대로',
      tone: 'muted',
    })
    expect(ratchetSummary([ratchet('better'), ratchet('same')]).text).toBe('나아짐 1')
    expect(ratchetSummary([ratchet('better'), ratchet('unknown')]).tone).toBe('warn')
    expect(ratchetSummary([ratchet('better'), ratchet('worse')])).toEqual({
      text: '나빠짐 1',
      tone: 'bad',
    })
  })

  test('수만 있는 칸, 지식, 리뷰 지적', () => {
    expect(countSummary(0)).toEqual({ text: '없음', tone: 'muted' })
    expect(countSummary(3)).toEqual({ text: '3개', tone: 'warn' })
    const issue = (kind: string) => ({ kind, path: 'k.md', detail: '' })
    const k = (...kinds: string[]) =>
      ({ changed: [], issues: kinds.map(issue) }) as unknown as NonNullable<
        EvidenceBundle['knowledge']
      >
    // 말로만 남은 규칙은 세지 않는다
    expect(knowledgeSummary(k('spoken')).text).toBe('없음')
    expect(knowledgeSummary(k('not_yet', 'spoken'))).toEqual({ text: '알림 1', tone: 'warn' })
    expect(knowledgeSummary(k('not_yet', 'allow'))).toEqual({ text: '문제 2', tone: 'bad' })
    const raised = finding({ id: 'R1', raise: 'security', severity: 'low' })
    const note = finding({ id: 'R2', severity: 'high' })
    const done = (...findings: ReviewFinding[]) => ({ status: 'done' as const, findings })
    expect(reviewSummary(done())).toEqual({ text: '없음', tone: 'muted' })
    expect(reviewSummary(done(note))).toEqual({ text: '메모 1', tone: 'muted' })
    expect(reviewSummary(done(raised))).toEqual({ text: '올림 1', tone: 'warn' })
    expect(reviewSummary(done(raised, note)).text).toBe('올림 1 · 메모 1')
  })

  test("리뷰가 끝나지 않았으면 '없음'이라고 하지 않는다(V6): 돌지 않음, 도는 중, 실패, 건너뜀, 꺼짐", () => {
    expect(reviewSummary(null)).toEqual({ text: '리뷰 없음', tone: 'muted' })
    expect(reviewSummary(null, { running: true })).toEqual({ text: '도는 중', tone: 'info' })
    expect(reviewSummary({ status: 'failed', findings: [] })).toEqual({
      text: '리뷰 실패',
      tone: 'warn',
    })
    expect(reviewSummary({ status: 'skipped', findings: [] }).text).toBe('건너뜀')
    expect(reviewSummary(null, { disabled: true }).text).toBe('리뷰 꺼짐')
    expect(reviewSummary({ status: 'skipped', findings: [] }, { disabled: true }).text).toBe(
      '리뷰 꺼짐',
    )
    // 끈 앱에서도 이미 끝난 리뷰는 그 결과를 말한다
    expect(reviewSummary({ status: 'done', findings: [] }, { disabled: true }).text).toBe('없음')
  })
})

describe('사이드바', () => {
  const box = { head: 'h', armed: false, open: ['x'] } as WorkView['endPending']

  test('답이 필요한 Work(화면과 메인의 알림이 같이 쓰는 판정): 승인, 계약 다시, 끝내기 상자(걸린 끝과 넘긴 끝은 아님)', () => {
    expect(needsAnswer(work('a', { state: 'awaiting_approval' }))).toBe(true)
    expect(needsAnswer(work('a', { state: 'recontract' }))).toBe(true)
    expect(needsAnswer(work('a', { endPending: box }))).toBe(true)
    expect(needsAnswer(work('a'))).toBe(false)
    expect(needsAnswer(work('a', { endPending: { ...box, armed: true } as never }))).toBe(false)
    expect(needsAnswer(work('a', { state: 'done' }))).toBe(false)
    expect(answerReason(work('a', { state: 'awaiting_approval' }))).toBe('approval')
    expect(answerReason(work('a', { state: 'recontract' }))).toBe('change')
    expect(answerReason(work('a', { endPending: box }))).toBe('end')
    expect(answerReason(work('a', { endPending: { ...box, handed: true } as never }))).toBeNull()
    expect(answerReason(work('a'))).toBeNull()
    // 계약을 다시 맞추는 동안 상자가 떠 있으면 까닭은 계약이고(알림은 하나), 상자도 보인다([증거] 탭의 점)
    const both = work('a', { state: 'recontract', endPending: box })
    expect(answerReason(both)).toBe('change')
    expect(showEndBox(both)).toBe(true)
  })

  test('열린 Work는 답이 필요한 것이 앞, 끝난 Work는 따로. 묶음 안의 차례는 그대로', () => {
    const ws = [
      work('1'),
      work('2', { state: 'done' }),
      work('3', { state: 'awaiting_approval' }),
      work('4', { state: 'drafting' }),
      work('5', { state: 'abandoned' }),
    ]
    const { open, closed } = splitWorks(ws)
    expect(open.map((w) => w.id)).toEqual(['3', '1', '4'])
    expect(closed.map((w) => w.id)).toEqual(['2', '5'])
  })

  test('끝난 Work 묶음은 셋까지 펼치고, 고른 Work가 안에 있으면 펼친다', () => {
    expect(doneOpen(3, false)).toBe(true)
    expect(doneOpen(4, false)).toBe(false)
    expect(doneOpen(9, true)).toBe(true)
  })

  test('만든 때', () => {
    const now = Date.parse('2026-11-11T12:00:00Z')
    const ago = (ms: number) => agoText(new Date(now - ms).toISOString(), now)
    expect(ago(20_000)).toBe('방금')
    expect(ago(5 * 60_000)).toBe('5분 전')
    expect(ago(3 * 3_600_000)).toBe('3시간 전')
    expect(ago(2 * 86_400_000)).toBe('2일 전')
    expect(ago(40 * 86_400_000)).toMatch(/^\d+월 \d+일$/)
    expect(agoText('x', now)).toBe('')
  })

  test('품질 기준 알림의 짧은 글', () => {
    expect(qualityShort('missing')).toBe('품질 기준 없음')
    expect(qualityShort('invalid')).toBe('품질 기준이 깨짐')
    expect(qualityShort('present')).toBeNull()
  })
})

describe('[변경]의 patch', () => {
  test('git의 머리 줄을 빼고 첫 @@부터, 머리가 말하는 것은 짧은 글로', () => {
    const patch = [
      'diff --git a/src/a.js b/src/a.js',
      'new file mode 100644',
      'index 0000000..fd89ade',
      '--- /dev/null',
      '+++ b/src/a.js',
      '@@ -0,0 +1,2 @@',
      '+a',
      '+b',
      '',
    ].join('\n')
    expect(patchView(patch)).toEqual({ notes: ['새 파일'], body: '@@ -0,0 +1,2 @@\n+a\n+b' })
  })

  test('@@가 없으면(이름만 바꿈, 권한만 바뀜, 바이너리) body는 빈 글', () => {
    const renamed = 'diff --git a/x b/y\nsimilarity index 100%\nrename from x\nrename to y\n'
    expect(patchView(renamed)).toEqual({ notes: ['이름 바꿈: x에서'], body: '' })
    const mode = 'diff --git a/x b/x\nold mode 100644\nnew mode 100755\n'
    expect(patchView(mode)).toEqual({ notes: ['권한 바뀜'], body: '' })
    expect(patchView('diff --git a/i.png b/i.png\nBinary files differ\n').body).toBe('')
  })

  test('경로를 폴더와 파일 이름으로', () => {
    expect(splitPath('src/core/a.ts')).toEqual({ dir: 'src/core/', base: 'a.ts' })
    expect(splitPath('README.md')).toEqual({ dir: '', base: 'README.md' })
  })
})

describe('단축키', () => {
  const key = (k: Partial<KeyLike>): KeyLike => ({
    key: '',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...k,
  })

  test('탭: macOS는 ⌘1~4, 그 밖은 Alt+1~4. 터미널의 Ctrl 조합은 건드리지 않는다', () => {
    expect(tabKey(key({ key: '2', code: 'Digit2', metaKey: true }), true)).toBe(1)
    expect(tabKey(key({ key: '2', code: 'Digit2', altKey: true }), true)).toBeNull()
    expect(tabKey(key({ key: '4', code: 'Digit4', altKey: true }), false)).toBe(3)
    // Alt가 글자를 바꿔도 자리로 안다
    expect(tabKey(key({ key: '¡', code: 'Digit1', altKey: true }), false)).toBe(0)
    expect(tabKey(key({ key: '1', code: 'Digit1', ctrlKey: true }), false)).toBeNull()
    expect(tabKey(key({ key: '5', code: 'Digit5', altKey: true }), false)).toBeNull()
    expect(
      tabKey(key({ key: '1', code: 'Digit1', altKey: true, shiftKey: true }), false),
    ).toBeNull()
  })

  test('새 Work: macOS는 ⌘N, 그 밖은 Ctrl+Shift+N(Ctrl+N은 세션의 것)', () => {
    expect(newWorkKey(key({ key: 'n', metaKey: true }), true)).toBe(true)
    expect(newWorkKey(key({ key: 'N', ctrlKey: true, shiftKey: true }), false)).toBe(true)
    expect(newWorkKey(key({ key: 'n', ctrlKey: true }), false)).toBe(false)
    expect(newWorkKey(key({ key: 'n', ctrlKey: true }), true)).toBe(false)
    // 한글·키릴 자판이나 IME가 켜져 key가 다른 글자로 와도 자리(code)로 안다
    expect(newWorkKey(key({ key: 'ㅜ', code: 'KeyN', metaKey: true }), true)).toBe(true)
    expect(newWorkKey(key({ key: 'Т', code: 'KeyN', ctrlKey: true, shiftKey: true }), false)).toBe(
      true,
    )
    expect(
      newWorkKey(key({ key: 'Process', code: 'KeyN', ctrlKey: true, shiftKey: true }), false),
    ).toBe(true)
    // 라틴 글자가 오면 그 글자를 믿는다: Dvorak에서 N 자리의 글쇠는 b다
    expect(newWorkKey(key({ key: 'b', code: 'KeyN', metaKey: true }), true)).toBe(false)
    expect(newWorkKey(key({ key: 'n', code: 'KeyL', metaKey: true }), true)).toBe(true)
    expect(newWorkKeyText(true)).toBe('⌘N')
    expect(newWorkKeyText(false)).toBe('Ctrl+Shift+N')
  })
})

describe('답이 필요해진 Work의 알림(메인)', () => {
  const box = { head: 'h', armed: false, open: ['x'] } as WorkView['endPending']

  test('까닭이 새로 생길 때 한 번만 알리고, 배지는 답이 필요한 Work의 수', () => {
    const w = new AttentionWatch()
    w.prime([])
    expect(w.note(work('a', { state: 'drafting' }))).toBeNull()
    const waiting = work('a', { state: 'awaiting_approval' })
    expect(w.note(waiting)).toEqual({ id: 'a', title: '계약이 승인을 기다립니다', body: '일 a' })
    // 같은 까닭으로 또 바뀌어도(근거 확인 등) 다시 알리지 않는다
    expect(w.note(waiting)).toBeNull()
    expect(w.count()).toBe(1)
    expect(w.note(work('a'))).toBeNull()
    expect(w.count()).toBe(0)
    expect(w.waiting('a')).toBe(false)
    // 까닭이 바뀌면 다시 알린다
    expect(w.note(work('a', { endPending: box }))?.title).toBe('끝내기 전에 볼 것이 있습니다')
    expect(w.note(work('a', { state: 'recontract' }))?.title).toBe('세션이 계약을 바꾸자고 합니다')
  })

  test('앱을 켤 때 이미 기다리던 Work는 알리지 않는다', () => {
    const w = new AttentionWatch()
    const waiting = work('a', { state: 'awaiting_approval' })
    w.prime([waiting, work('b')])
    expect(w.count()).toBe(1)
    expect(w.note(waiting)).toBeNull()
    expect(w.note(work('b', { state: 'recontract' }))).not.toBeNull()
  })

  test('켜는 동안(prime 전) 온 것은 적어 두기만 한다: Works.init이 Work마다 내는 이벤트로 알리지 않는다', () => {
    const w = new AttentionWatch()
    const a = work('a', { state: 'awaiting_approval' })
    const b = work('b', { endPending: box })
    expect(w.note(a)).toBeNull()
    expect(w.note(b)).toBeNull()
    // 배지에는 기다리는 수가 그대로 보인다
    expect(w.count()).toBe(2)
    expect(w.waiting('a')).toBe(true)
    w.prime([a, b, work('c')])
    expect(w.note(a)).toBeNull()
    expect(w.note(b)).toBeNull()
    expect(w.note(work('c', { state: 'awaiting_approval' }))?.id).toBe('c')
  })
})

describe('패널 너비의 끝', () => {
  test('터미널이 560px 남는 데까지만 넓어진다(340~900). 재기 전에는 900', () => {
    expect(panelMax(null)).toBe(900)
    // 1400px 창: 사이드바 264를 뺀 1136에서 터미널 560
    expect(panelMax(1136)).toBe(576)
    expect(panelMax(2000)).toBe(900)
    // 가장 좁은 창에서도 패널의 가장 좁은 너비보다 작아지지 않는다
    expect(panelMax(800)).toBe(340)
    expect(panelMax(1135.6)).toBe(575)
  })
})

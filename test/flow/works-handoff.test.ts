// [흐름] 상자의 [세션에 넘기기]가 끝을 다시 건다(V35, src/main/works-end.ts hand·rest·busy). 경우: 넘기면 지적과 아직 보내지
// 않은 세션 몫 사실이 파일로 가고 끝은 '고친 뒤 끝냄'(end_pending.handed)으로 남는다. 세션이 고쳐 커밋하고 쉬면 새 head를
// 내보내기로 재서 열린 것이 없으면 끝낸다(ended.how handed). 열린 것이 남으면 상자가 다시 뜬다. [증거]의 [세션에 넘기기]는
// 끝을 걸지 않는다. 넘길 것이 없으면 상자로 되돌린다. [취소]로 푼다. 재는 동안 세션이 다시 움직이면 다음 쉼을 기다린다.
// 바탕은 test/support/works-flow.ts.
import { readFile } from 'node:fs/promises'
import { expect, test, vi } from 'vitest'
import { calc } from '../support/calc.ts'
import { makeTempDir } from '../support/repo.ts'
import type { TestApp } from '../support/works-app.ts'
import {
  CONTRACT,
  FIX_COMMIT,
  flowKit,
  NOTE_FINDINGS,
  RAISED_FINDINGS,
  REQUEST,
  settled,
  type Entry,
} from '../support/works-flow.ts'

const kit = flowKit()
const { scenario, fake, until } = kit

const SUBMIT = { do: 'mcp', tool: 'submit_contract', args: CONTRACT }
const RAISED = '리뷰 올림(계약 밖 변경): 계약 밖에서 sub를 더함 — src/calc.js:5'
/** 시험은 고쳤지만 소스는 그대로: C1.1이 head에서 실패하고 명령 unit이 실패한다(세션 몫의 사실) */
const FAILING = {
  ...FIX_COMMIT,
  message: '시험 먼저',
  files: { ...FIX_COMMIT.files, 'src/calc.js': calc('lo') },
}
const NOTE_COMMIT = { do: 'commit', message: '지적 고침', files: { 'NOTES.md': '고쳤다\n' } }

/** [끝내기]가 남긴 기록(ts를 뺀다) */
const ends = async (app: TestApp, id: string) =>
  (await app.store.readEvents(id))
    .filter((e) => typeof e.type === 'string' && /^end/.test(e.type))
    .map((e) => {
      const rest: Entry = { ...e }
      delete rest.ts
      return rest
    })

const workJson = async (app: TestApp, id: string) =>
  JSON.parse((await app.store.readText(id, 'work.json')) ?? '') as Entry

const inputs = async () =>
  (await fake()).filter((e) => e.type === 'input').map((e) => String(e.text))

const reviews = async () => (await fake()).filter((e) => e.type === 'review').length

/** 계약을 승인하고 첫 증거를 기다린다. rest면 세션이 쉬어 미리 리뷰(V23)까지 기다린다 */
async function startWork(app: TestApp, rest: boolean): Promise<string> {
  const { works } = app
  const project = await works.addProject(kit.repo.dir)
  const { id } = await works.createWork({ project: project.id, request: REQUEST })
  await until(() => works.view(id).state === 'awaiting_approval', '계약 제출')
  await works.approveContract(id)
  await until(() => {
    const v = works.view(id)
    return v.evidence !== null && settled(v) && (!rest || v.evidence.review?.status === 'done')
  }, '첫 증거')
  await works.idle()
  return id
}

test('넘기면 지적과 보내지 않은 사실이 세션에 가고 끝이 다시 걸린다: 세션이 고치고 쉬면 새 head를 재서 열린 것이 없으면 끝낸다', async () => {
  await kit.review(RAISED_FINDINGS)
  // 세션이 relay_check만 하고 쉬지 않는다: 실패의 사실이 저절로 가지 않은 채 [끝내기]의 상자가 뜬다
  await scenario([
    SUBMIT,
    FAILING,
    { do: 'mcp', tool: 'relay_check', args: {} },
    { do: 'waitInput' },
    FIX_COMMIT,
    { do: 'stop' },
    { do: 'waitInput' },
  ])
  const app = await kit.openApp(await makeTempDir('relay-home-'))
  const { works } = app
  const id = await startWork(app, false)
  const first = works.view(id).head ?? ''
  expect(await works.end(id, { head: first })).toMatchObject({ armed: true })
  await until(() => works.view(id).endPending?.armed === false, '상자')
  await works.idle()
  expect(works.view(id).endPending?.open).toContain(RAISED)
  // 상자가 떠 있는 동안은 세션 몫의 사실도 저절로 가지 않았다
  expect(works.view(id).feedback).toMatchObject({ pending: 3, rounds: 0, sent: [] })

  // 고친 뒤의 리뷰는 올림이 없다
  await kit.review(NOTE_FINDINGS)
  await works.handEnd(id, { head: first, picks: [{ ids: ['R1'] }] })
  const handed = { head: first, armed: false, open: [], handed: true }
  expect(works.view(id).endPending).toEqual(handed)
  expect((await workJson(app, id)).end_pending).toEqual(handed)
  // 사람이 넘긴 것은 라운드로 세지 않는다. 지적과 사실을 한 파일로
  expect(works.record(id).feedback).toMatchObject({
    rounds: 0,
    sent: [{ n: 1, by: 'human', facts: 3, findings: 1 }],
  })
  const file = await readFile(app.store.feedbackPath(id, 1), 'utf8')
  expect(file).toContain('계약 밖에서 sub를 더함')
  expect(file).toContain('C1.1')

  // 세션이 고쳐 커밋하고 쉰다: 새 head를 내보내기로 재고(리뷰 포함) 열린 것이 없으니 끝낸다
  await until(() => works.view(id).state === 'done', '고친 뒤 끝남')
  await works.idle()
  const second = works.record(id).exports[0]?.exported_head ?? ''
  expect(second).not.toBe(first)
  expect(works.view(id).evidence).toMatchObject({ head: second, review: { status: 'done' } })
  expect(await reviews()).toBe(2)
  expect((await inputs())[0]).toMatch(/^relay feedback 1 for head /)
  expect(await ends(app, id)).toEqual([
    { type: 'end_armed', head: first },
    { type: 'end_box', head: first, open: expect.any(Number) as number },
    { type: 'end_handed', head: first, facts: 3, findings: 1 },
    { type: 'end_armed', head: second, handed: true },
    { type: 'ended', how: 'handed', head: second, memos: 1 },
  ])
})

test('고친 뒤에도 열린 것이 남으면 상자가 다시 뜬다. [증거]의 [세션에 넘기기]는 끝을 걸지 않고, 넘길 것이 없으면 상자로 되돌리며, [취소]로 푼다', async () => {
  await kit.review(RAISED_FINDINGS)
  await scenario([
    SUBMIT,
    FIX_COMMIT,
    { do: 'stop' },
    { do: 'waitInput' },
    NOTE_COMMIT,
    { do: 'stop' },
    // [증거]의 넘기기와 둘째 넘기기를 받고 쉬지 않는다
    { do: 'waitInput' },
    { do: 'waitInput' },
    { do: 'waitInput' },
  ])
  const app = await kit.openApp(await makeTempDir('relay-home-'))
  const { works } = app
  const id = await startWork(app, true)
  const first = works.view(id).head ?? ''
  expect(await works.end(id, { head: first })).toMatchObject({ open: [RAISED] })
  await works.handEnd(id, { head: first, picks: [{ ids: ['R1'] }] })
  expect(works.view(id).endPending).toMatchObject({ head: first, handed: true })

  // 세션이 커밋했지만 리뷰는 같은 것을 다시 올린다: 넘긴 끝이 풀리고 새 head의 상자
  await until(() => {
    const p = works.view(id).endPending
    return p !== null && p.head !== first && p.armed === false && p.handed !== true
  }, '새 head의 상자')
  await works.idle()
  const second = works.view(id).head ?? ''
  const box = { head: second, armed: false, open: [RAISED] }
  expect(works.view(id)).toMatchObject({ state: 'working', endPending: box, endMoved: null })

  // [증거]의 [세션에 넘기기]는 지적만 보내고 상자는 그대로다
  await works.sendFindings(id, ['R1'])
  expect(works.view(id).endPending).toEqual(box)
  // 보낼 것이 없는 넘기기(사실은 없고 지적을 고르지 않음)는 던지고 상자로 되돌린다
  await expect(works.handEnd(id, { head: second, picks: [] })).rejects.toThrow(/넘길 지적이나/)
  expect(works.view(id).endPending).toEqual(box)
  expect((await workJson(app, id)).end_pending).toEqual(box)
  // 상자의 head가 아니면 넘기지 않는다
  await expect(works.handEnd(id, { head: first, picks: [{ ids: ['R1'] }] })).rejects.toThrow(
    /끝내기 상자가 없음/,
  )

  await works.handEnd(id, { head: second, picks: [{ ids: ['R1'] }] })
  expect(works.view(id).endPending).toMatchObject({ head: second, handed: true })
  await works.cancelEnd(id)
  expect(works.view(id).endPending).toBeNull()
  expect((await workJson(app, id)).end_pending).toBeNull()
  await until(async () => (await inputs()).length === 3, '세 번의 넘김')
  expect(works.record(id).feedback.sent.map((r) => [r.n, r.by, r.findings])).toEqual([
    [1, 'human', 1],
    [2, 'human', 1],
    [3, 'human', 1],
  ])
  expect(await ends(app, id)).toEqual([
    { type: 'end_box', head: first, open: 1 },
    { type: 'end_handed', head: first, facts: 0, findings: 1 },
    { type: 'end_armed', head: second, handed: true },
    { type: 'end_box', head: second, open: 1 },
    { type: 'end_handed', head: second, facts: 0, findings: 1 },
    { type: 'end_cancelled', head: second, armed: false, handed: true, reason: 'human' },
  ])
})

test('넘긴 끝을 재는 동안 세션이 다시 움직이면 끝내지 않고 다음 쉼을 기다린다', async () => {
  await kit.review(RAISED_FINDINGS)
  await scenario([
    SUBMIT,
    FIX_COMMIT,
    { do: 'stop' },
    { do: 'waitInput' },
    NOTE_COMMIT,
    { do: 'stop' },
    // 리뷰가 도는 사이 사람이 말한다
    { do: 'waitInput' },
    { do: 'sleep', ms: 2500 },
    { do: 'stop' },
    { do: 'waitInput' },
  ])
  const app = await kit.openApp(await makeTempDir('relay-home-'))
  const { works } = app
  const id = await startWork(app, true)
  const first = works.view(id).head ?? ''
  await works.end(id, { head: first })
  await kit.review(NOTE_FINDINGS)
  vi.stubEnv('FAKE_CLAUDE_REVIEW_MS', '1500')
  try {
    await works.handEnd(id, { head: first, picks: [{ ids: ['R1'] }] })
    await until(() => {
      const v = works.view(id)
      return v.endPending?.armed === true && v.reviewRunning
    }, '고친 head의 리뷰')
    const second = works.view(id).head ?? ''
    app.sessions.write(id, '하나만 더 봐 주세요\r')
    await until(() => works.view(id).endPending?.armed === false, '다음 쉼을 기다림')
    expect(works.view(id).endPending).toEqual({
      head: second,
      armed: false,
      open: [],
      handed: true,
    })
    // 리뷰는 끝나도 세션이 일하는 중이라 끝내지 않는다
    await until(() => settled(works.view(id)), '리뷰 끝')
    expect(works.view(id).state).toBe('working')
    // 세션이 다시 쉬면 이미 잰 head라 바로 끝낸다
    await until(() => works.view(id).state === 'done', '다시 쉰 뒤 끝남')
    expect(await reviews()).toBe(2)
    expect(await ends(app, id)).toEqual([
      { type: 'end_box', head: first, open: 1 },
      { type: 'end_handed', head: first, facts: 0, findings: 1 },
      { type: 'end_armed', head: second, handed: true },
      { type: 'end_waiting', head: second },
      { type: 'ended', how: 'handed', head: second, memos: 1 },
    ])
  } finally {
    vi.stubEnv('FAKE_CLAUDE_REVIEW_MS', '')
  }
})

// [흐름] [끝내기](V25): 열린 것이 없으면 한 번에 끝남(걸었다가 리뷰 뒤, 이미 잰 head면 바로), 올림이 있으면 상자(work.json)와
// [더 고치기]·[그래도 끝내기](안전망), 상자 뒤 커밋과 낡은 화면의 head, 걸린 끝의 [취소]와 리뷰 중 커밋, 실패한 리뷰는 상자의
// 열린 것(앱을 다시 켜도 남음)이고 다시 [끝내기]가 리뷰를 다시 부름, 앱을 닫아 끊긴 리뷰와 걸린 끝 이어 재기, 평가용으로 끈
// 리뷰(reviewDisabled)는 늘 상자. 다시 내보내기로 재는 동안과 그 리뷰가 끊긴 뒤의 [끝내기], [끝내기]의 재기가 도는 사이 새
// head에서 다시 [끝내기], 계약 바꾸기를 받은 뒤의 새 head(내보내기 아님). 세션이 쉬면 미리 리뷰(V23)가 돈다: 미리 리뷰와
// [끝내기]가 만나는 경우는 works-review.test.ts. 바탕은 test/support/works-flow.ts.
import { expect, test, vi } from 'vitest'
import { check } from '../../src/engine/check.ts'
import { workHead } from '../../src/main/works-types.ts'
import { makeTempDir } from '../support/repo.ts'
import type { TestApp } from '../support/works-app.ts'
import {
  CONTRACT,
  FIX_COMMIT,
  flowKit,
  PUSH_AND_PR,
  RAISED_FINDINGS,
  REQUEST,
  settled,
  type Entry,
} from '../support/works-flow.ts'

const kit = flowKit()
const { scenario, fake, until } = kit

const SUBMIT = { do: 'mcp', tool: 'submit_contract', args: CONTRACT }
const RAISED = ['리뷰 올림(계약 밖 변경): 계약 밖에서 sub를 더함 — src/calc.js:5']

const exportsOf = async (app: TestApp, id: string) =>
  (await app.store.readEvents(id)).filter((e) => e.type === 'evidence').map((e) => e.export)

const reviews = async () => (await fake()).filter((e) => e.type === 'review').length

/** [끝내기]가 남긴 기록(ts를 뺀다) */
const ends = async (app: TestApp, id: string) =>
  (await app.store.readEvents(id))
    .filter((e) => typeof e.type === 'string' && /^end/.test(e.type))
    .map((e) => {
      const { ts, ...rest } = e
      return ts === undefined ? e : rest
    })

const workJson = async (app: TestApp, id: string) =>
  JSON.parse((await app.store.readText(id, 'work.json')) ?? '') as Entry

/**
 * 프로젝트를 더하고 Work를 만들어 계약을 승인하고, 첫 증거(내보내기 아님)를 기다린다. Stop의 증거면 미리 리뷰(V23)까지
 * 기다린다. o.reviewing이면 미리 리뷰가 도는 동안 돌아온다
 */
async function startWork(app: TestApp, o: { reviewing?: boolean } = {}): Promise<string> {
  const { works } = app
  const project = await works.addProject(kit.repo.dir)
  const { id } = await works.createWork({ project: project.id, request: REQUEST })
  await until(() => works.view(id).state === 'awaiting_approval', '계약 제출')
  await works.approveContract(id)
  if (o.reviewing) await until(() => works.view(id).reviewRunning, '미리 리뷰 시작')
  else await until(() => works.view(id).evidence !== null && settled(works.view(id)), '첫 증거')
  return id
}

/** 세션이 relay_check로 증거를 당겨 보고 쉬지 않는다: 미리 리뷰(V23)가 없는 head */
const CHECK_NO_REST = [{ do: 'mcp', tool: 'relay_check', args: {} }, { do: 'waitInput' }]

const boxed = (app: TestApp, id: string) => () => app.works.view(id).endPending?.armed === false

test('열린 것이 없으면 [끝내기] 한 번에 끝난다: 내보내기 증거가 없으면 걸어 두고 리뷰가 끝나면 끝낸다(상자 없음)', async () => {
  // 세션이 쉬지 않아 미리 리뷰가 없다
  await scenario([SUBMIT, FIX_COMMIT, ...CHECK_NO_REST])
  const app = await kit.openApp(await makeTempDir('relay-home-'))
  const { works } = app
  const id = await startWork(app)
  const head = works.view(id).head ?? ''
  expect(works.view(id).evidence?.review).toBeNull()

  const armed = { head, armed: true, open: [] }
  expect(await works.end(id, { head })).toEqual({ ...armed, ended: false })
  expect(works.view(id).endPending).toEqual(armed)
  expect((await workJson(app, id)).end_pending).toEqual(armed)
  await until(() => works.view(id).state === 'done', '리뷰 뒤 끝남')
  // 끝내기는 증거 재기의 줄 안에서 일어난다: 그 줄이 끝나면 ended 기록도 남았다
  await works.idle()
  const v = works.view(id)
  // 리뷰 지적(올림 없음)은 열린 것이 아니다. 관문은 사람 머지(그림자)여도 끝낸다
  expect(v.evidence).toMatchObject({
    head,
    review: { status: 'done', findings: [{ text: '이름이 짧음' }] },
  })
  expect(v.gate?.conclusion).toBe('human_merge')
  expect(v.endPending).toBeNull()
  expect((await workJson(app, id)).end_pending).toBeNull()
  // relay_check의 증거(내보내기 아님)를 다시 쓰고 리뷰만 더한 내보내기
  expect(await exportsOf(app, id)).toEqual([false, true])
  expect(await reviews()).toBe(1)
  const reviewed = (await app.store.readEvents(id)).filter((e) => e.type === 'review')
  expect(reviewed).toMatchObject([{ trigger: 'end', status: 'done' }])
  expect(await ends(app, id)).toEqual([
    { type: 'end_armed', head },
    { type: 'ended', how: 'armed', head, memos: 1 },
  ])
  await until(() => !app.sessions.isRunning(id), '세션 끝')
  // 리뷰 결과는 세션에 넣지 않는다(V4, V8)
  expect((await fake()).filter((e) => e.type === 'input')).toEqual([])
  await expect(works.end(id, { head })).rejects.toThrow()
})

test('PR 내보내기로 이미 잰 깨끗한 head는 [끝내기]가 다시 재지 않고 바로 끝낸다', async () => {
  await scenario([SUBMIT, FIX_COMMIT, ...PUSH_AND_PR, { do: 'stop' }])
  const app = await kit.openApp(await makeTempDir('relay-home-'))
  const { works } = app
  const id = await startWork(app)
  await until(
    () =>
      works.find(id)?.exports[0]?.exported_head === works.view(id).head && settled(works.view(id)),
    'PR의 내보내기 증거',
  )
  await works.idle()
  const head = works.view(id).head ?? ''
  const exported = await exportsOf(app, id)
  expect(await reviews()).toBe(1)
  expect(await works.end(id, { head })).toEqual({ head, ended: true, armed: false, open: [] })
  expect(works.view(id).state).toBe('done')
  expect(await exportsOf(app, id)).toEqual(exported)
  expect(await reviews()).toBe(1)
  expect(await ends(app, id)).toEqual([{ type: 'ended', how: 'once', head, memos: 1 }])
})

test('올림이 있으면 상자(work.json에 남음): [더 고치기]로 닫고, 세션이 고친 head는 [그래도 끝내기]가 먼저 내보내기로 재고(안전망) 끝낸다', async () => {
  await kit.review(RAISED_FINDINGS)
  await scenario([
    SUBMIT,
    FIX_COMMIT,
    { do: 'stop' },
    { do: 'waitInput' },
    { do: 'commit', message: '리뷰 지적 고침', files: { 'NOTES.md': '중복을 없앴다\n' } },
    { do: 'stop' },
  ])
  const app = await kit.openApp(await makeTempDir('relay-home-'))
  const { works } = app
  const id = await startWork(app)
  const first = works.view(id).head ?? ''

  // 세션이 쉬어 미리 리뷰(V23)가 이미 올림을 냈다: [끝내기]는 걸리지 않고 바로 상자
  const box = { head: first, armed: false, open: RAISED }
  expect(await works.end(id, { head: first })).toEqual({ ...box, ended: false })
  expect(works.view(id)).toMatchObject({ state: 'working', endPending: box })
  expect((await workJson(app, id)).end_pending).toEqual(box)
  expect(app.sessions.isRunning(id)).toBe(true)
  // 다시 [끝내기]: 이미 잰 head라 다시 재지 않고 같은 상자
  expect(await works.end(id, { head: first })).toEqual({ ...box, ended: false })
  expect(await reviews()).toBe(1)

  // [더 고치기]: 상자를 지운다(work.json에서도). 사람이 터미널에서 말하고 세션이 고친다
  await works.cancelEnd(id)
  expect(works.view(id).endPending).toBeNull()
  expect((await workJson(app, id)).end_pending).toBeNull()
  app.sessions.write(id, '중복을 없애 주세요\r')
  await until(() => {
    const v = works.view(id)
    return v.head !== first && v.evidence?.head === v.head && settled(v)
  }, '세션의 새 커밋과 그 증거')
  const second = works.view(id).head ?? ''

  // [그래도 끝내기](상자 없이 부름): 이 head를 내보내기로 재지 않았으니 먼저 잰다(안전망). 열린 것이 있어도 끝낸다
  expect(await works.end(id, { head: second, force: true })).toEqual({
    head: second,
    ended: true,
    armed: false,
    open: RAISED,
  })
  expect(works.view(id).state).toBe('done')
  // 리뷰는 head마다 미리 리뷰 한 번(내보내기는 그것을 다시 쓴다)
  expect(await exportsOf(app, id)).toEqual([false, true, false, true])
  expect(await reviews()).toBe(2)
  expect(await ends(app, id)).toEqual([
    { type: 'end_box', head: first, open: 1 },
    { type: 'end_box', head: first, open: 1 },
    { type: 'end_cancelled', head: first, armed: false, reason: 'human' },
    { type: 'ended', how: 'box', head: second, open: 1, memos: 0 },
  ])
})

test('상자 뒤 세션이 Stop 없이 커밋하면 [그래도 끝내기](상자의 head)도 낡은 화면의 [끝내기]도 끝내지 않는다. 셸 명령의 커밋은 Stop 전에 HEAD를 보인다', async () => {
  await kit.review(RAISED_FINDINGS)
  const shellCommit = `git -c user.name=f -c user.email=f@relay.invalid commit -q --allow-empty -m 셋째`
  await scenario([
    SUBMIT,
    FIX_COMMIT,
    { do: 'stop' },
    { do: 'waitInput' },
    // 차례 안의 커밋(훅 없음, Stop 없음): 화면은 아직 앞 head다
    { do: 'commit', message: '지적 고침', files: { 'NOTES.md': '고쳤다\n' } },
    { do: 'waitInput' },
    { do: 'bash', command: shellCommit },
    { do: 'waitInput' },
  ])
  const app = await kit.openApp(await makeTempDir('relay-home-'))
  const { works } = app
  const id = await startWork(app)
  const first = works.view(id).head ?? ''
  await works.end(id, { head: first })
  await until(boxed(app, id), '상자')
  const exported = await exportsOf(app, id)
  expect(await reviews()).toBe(1)

  const rec = works.record(id)
  app.sessions.write(id, '지적을 고쳐 주세요\r')
  await until(async () => (await workHead(rec)) !== first, '세션의 차례 안 커밋')
  const second = await workHead(rec)
  expect(works.view(id)).toMatchObject({ head: first, endPending: { head: first } })
  // [그래도 끝내기]가 넘긴 head는 지금 HEAD가 아니다: 새 커밋을 재지도 끝내지도 않고, 화면의 HEAD를 고쳐 상자를 지운다
  await expect(works.end(id, { head: first, force: true })).rejects.toThrow(
    /HEAD가 바뀜.*끝내기를 다시 눌러/,
  )
  expect(works.view(id)).toMatchObject({
    state: 'working',
    head: second,
    endPending: null,
    endMoved: first,
  })
  expect((await workJson(app, id)).end_pending).toBeNull()
  // 화면이 앞 head를 보던 [끝내기]도 끝내지 않는다(사람이 보지 못한 커밋을 한 번에 끝내지 않게)
  await expect(works.end(id, { head: first })).rejects.toThrow(/HEAD가 바뀜/)
  expect(await exportsOf(app, id)).toEqual(exported)
  expect(await reviews()).toBe(1)
  expect(app.sessions.isRunning(id)).toBe(true)

  // 셸 명령(git commit)의 PostToolUse는 Stop을 기다리지 않고 화면의 HEAD를 고친다
  app.sessions.write(id, '하나 더\r')
  await until(() => works.view(id).head !== second, '셸 커밋의 HEAD')
  const third = await workHead(rec)
  expect(works.view(id)).toMatchObject({ head: third, session: 'running' })
  // 새 head의 [끝내기] → 걸림 → 상자 → [그래도 끝내기]는 다시 재지 않는다
  expect(await works.end(id, { head: third })).toMatchObject({ armed: true })
  expect(works.view(id).endMoved).toBeNull()
  await until(boxed(app, id), '새 head의 상자')
  const again = await exportsOf(app, id)
  expect(await reviews()).toBe(2)
  await works.end(id, { head: third, force: true })
  expect(works.view(id).state).toBe('done')
  expect(await exportsOf(app, id)).toEqual(again)
  expect(await reviews()).toBe(2)
  expect((await ends(app, id)).find((e) => e.type === 'end_moved')).toEqual({
    type: 'end_moved',
    from: first,
    to: second,
    armed: false,
  })
})

test('걸린 끝은 [취소]로 푼다(미리 리뷰는 끝까지 돌고 내보내기로 재지 않는다). 리뷰 중 세션이 커밋하면 끝내지 않고 지운다', async () => {
  await scenario([
    SUBMIT,
    FIX_COMMIT,
    { do: 'stop' },
    { do: 'waitInput' },
    { do: 'commit', message: '하나 더', files: { 'NOTES.md': '하나\n' } },
    { do: 'stop' },
    { do: 'waitInput' },
    // 리뷰가 도는 동안의 차례 안 커밋(훅 없음)
    { do: 'commit', message: '또 하나', files: { 'NOTES.md': '둘\n' } },
    { do: 'waitInput' },
  ])
  const app = await kit.openApp(await makeTempDir('relay-home-'))
  const { works } = app
  vi.stubEnv('FAKE_CLAUDE_REVIEW_MS', '1500')
  try {
    // 미리 리뷰가 도는 동안 [끝내기]는 걸린다(V23·V25)
    const id = await startWork(app, { reviewing: true })
    const first = works.view(id).head ?? ''
    const rec = works.record(id)
    expect(await works.end(id, { head: first })).toMatchObject({ armed: true })
    await works.cancelEnd(id)
    expect(works.view(id).endPending).toBeNull()
    await until(
      () => works.view(id).evidence?.review !== null && settled(works.view(id)),
      '리뷰 끝',
    )
    await works.idle()
    // 깨끗한 head였지만 [취소]했으니 끝내지 않고, 내보내기로 재지도 않는다(장부 없음)
    expect(works.view(id).state).toBe('working')
    expect(works.find(id)?.exports[0]?.exported_head).toBeNull()
    expect(await exportsOf(app, id)).toEqual([false])

    app.sessions.write(id, '하나 더\r')
    await until(() => {
      const v = works.view(id)
      return v.head !== first && v.evidence?.head === v.head && v.reviewRunning
    }, '세션의 새 커밋과 그 미리 리뷰')
    const second = works.view(id).head ?? ''
    expect(await works.end(id, { head: second })).toMatchObject({ armed: true })
    app.sessions.write(id, '또 하나\r')
    await until(async () => (await workHead(rec)) !== second, '리뷰 중 커밋')
    const third = await workHead(rec)
    await until(() => settled(works.view(id)), '둘째 리뷰 끝')
    await works.idle()
    // 리뷰가 끝난 뒤 HEAD가 바뀐 것을 보고 그 리뷰를 버린다(V23). 걸린 끝은 지우고 새 head를 재지 않는다
    expect(works.view(id)).toMatchObject({
      state: 'working',
      head: third,
      endPending: null,
      endMoved: second,
      evidence: { head: second, review: null },
    })
    expect(await reviews()).toBe(2)
    const reviewed = (await app.store.readEvents(id)).filter((e) => e.type === 'review')
    expect(reviewed).toMatchObject([
      { trigger: 'prepared', status: 'done' },
      { trigger: 'prepared', aborted: true },
    ])
    expect(await ends(app, id)).toEqual([
      { type: 'end_armed', head: first },
      { type: 'end_cancelled', head: first, armed: true, reason: 'human' },
      { type: 'end_armed', head: second },
      { type: 'end_moved', from: second, to: third, armed: true },
    ])
  } finally {
    vi.stubEnv('FAKE_CLAUDE_REVIEW_MS', '')
  }
})

test('리뷰가 실패하면 상자의 열린 것이고 앱을 다시 켜도 상자가 남는다. 다시 [끝내기]는 리뷰를 다시 부른다([증거 다시 재기]는 실패를 잇는다)', async () => {
  await scenario([SUBMIT, FIX_COMMIT, ...CHECK_NO_REST])
  const home = await makeTempDir('relay-home-')
  const first = await kit.openApp(home)
  const id = await startWork(first)
  const head = first.works.view(id).head ?? ''
  const box = { head, armed: false, open: ['리뷰 실패'] }
  try {
    vi.stubEnv('FAKE_CLAUDE_REVIEW_FAIL', 'exit')
    await first.works.end(id, { head })
    await until(boxed(first, id), '상자')
  } finally {
    vi.stubEnv('FAKE_CLAUDE_REVIEW_FAIL', '')
  }
  expect(first.works.view(id).endPending).toEqual(box)
  expect(await reviews()).toBe(1)
  // PR이 없으면 [증거 다시 재기]는 내보내기가 아니어서 같은 head의 실패한 리뷰를 잇는다
  await first.works.runEvidence(id, { exportCandidate: false })
  expect(first.works.view(id).evidence?.review?.status).toBe('failed')
  expect(await reviews()).toBe(1)
  await first.close()
  kit.forget(first)

  // 앱을 다시 켜도 상자가 남는다(다른 Work로 갔다 와도 남는 것과 같은 자리: work.json)
  const second = await kit.openApp(home)
  expect(second.works.view(id).endPending).toEqual(box)
  // 다시 [끝내기]: 이미 잰 head라도 리뷰가 실패했으면 다시 잰다. 이번 리뷰에는 올림이 없어 끝난다
  expect(await second.works.end(id, { head })).toMatchObject({ armed: true })
  await until(() => second.works.view(id).state === 'done', '리뷰 뒤 끝남')
  await second.works.idle()
  expect(second.works.view(id).evidence?.review).toMatchObject({ status: 'done' })
  expect(await reviews()).toBe(2)
  expect((await ends(second, id)).at(-1)).toEqual({ type: 'ended', how: 'armed', head, memos: 1 })
})

test('앱을 닫아 끊긴 리뷰는 내보내기(exported_head, 장부, export 기록)로 남지 않는다. 걸린 끝은 남아 다시 켜면 이어 재고 끝낸다', async () => {
  await scenario([SUBMIT, FIX_COMMIT, ...CHECK_NO_REST])
  const home = await makeTempDir('relay-home-')
  const first = await kit.openApp(home)
  const id = await startWork(first)
  const head = first.works.view(id).head ?? ''
  const ledger = (await first.store.readLedger()).length
  try {
    vi.stubEnv('FAKE_CLAUDE_REVIEW_FAIL', 'hang')
    await first.works.end(id, { head })
    await until(() => first.works.view(id).reviewRunning, '리뷰 시작')
    await first.close()
    kit.forget(first)
  } finally {
    vi.stubEnv('FAKE_CLAUDE_REVIEW_FAIL', '')
  }
  const rec = await workJson(first, id)
  expect((rec.exports as Entry[])[0]?.exported_head ?? null).toBeNull()
  expect(rec.end_pending).toEqual({ head, armed: true, open: [] })
  expect(await exportsOf(first, id)).toEqual([false])
  expect((await first.store.readLedger()).length).toBe(ledger)

  const second = await kit.openApp(home)
  await until(() => second.works.view(id).state === 'done', '이어 잰 뒤 끝남')
  await second.works.idle()
  expect(second.works.view(id).evidence?.review).toMatchObject({ status: 'done' })
  expect(await exportsOf(second, id)).toEqual([false, true])
  expect((await ends(second, id)).at(-1)).toEqual({ type: 'ended', how: 'armed', head, memos: 1 })
})

test('[끝내기]의 재기가 도는 사이 세션이 커밋하고 사람이 새 head에서 다시 [끝내기]하면, 앞 재기(다른 head)가 끝난 뒤 새 head를 내보내기로 재서 끝낸다', async () => {
  const shellCommit = `git -c user.name=f -c user.email=f@relay.invalid commit -q --allow-empty -m 둘째`
  await scenario([
    SUBMIT,
    FIX_COMMIT,
    { do: 'waitInput' },
    { do: 'bash', command: shellCommit },
    { do: 'waitInput' },
  ])
  // 첫 head의 check를 붙잡아 둔다: 그사이 세션이 커밋하고 사람이 다시 누른다
  let hold: Promise<void> | null = null
  let release = () => {}
  const app = await kit.openApp(await makeTempDir('relay-home-'), {
    check: async (o) => {
      if (hold) await hold
      return check(o)
    },
  })
  const { works } = app
  const project = await works.addProject(kit.repo.dir)
  const { id } = await works.createWork({ project: project.id, request: REQUEST })
  await until(() => works.view(id).state === 'awaiting_approval', '계약 제출')
  const rec = works.record(id)
  const start = await workHead(rec)
  await works.approveContract(id)
  await until(async () => (await workHead(rec)) !== start, '고침 커밋')
  const first = await workHead(rec)
  hold = new Promise((r) => {
    release = r
  })
  expect(await works.end(id, { head: first })).toMatchObject({ armed: true })
  await until(() => works.view(id).evidenceRunning, '첫 head의 내보내기 재기')

  app.sessions.write(id, '하나 더\r')
  await until(() => works.view(id).head !== first, '셸 커밋의 HEAD')
  const second = works.view(id).head ?? ''
  expect(works.view(id)).toMatchObject({ endPending: null, endMoved: first })
  // 다시 [끝내기]: 첫 head의 재기가 아직 돌아서 줄 세우지 않고 걸어 둔다
  const armed = { head: second, armed: true, open: [] }
  expect(await works.end(id, { head: second })).toEqual({ ...armed, ended: false })
  hold = null
  release()
  // 끝난 재기는 첫 head를 쟀다(리뷰는 HEAD가 바뀌어 버림): 새 head를 재지 않은 채 풀지 않는다
  await until(
    () => works.view(id).state === 'done' || works.view(id).endPending === null,
    '새 head의 걸린 끝을 정함',
  )
  await works.idle()
  expect(works.view(id).state).toBe('done')
  expect(await exportsOf(app, id)).toEqual([true])
  expect(await ends(app, id)).toEqual([
    { type: 'end_armed', head: first },
    { type: 'end_moved', from: first, to: second, armed: true },
    { type: 'end_armed', head: second },
    { type: 'ended', how: 'armed', head: second, memos: 1 },
  ])
})

test('PR head를 다시 내보내기로 재는 동안(리뷰 중)의 [끝내기]는 리뷰 없는 묶음으로 상자를 띄우지 않고 걸었다가 그 리뷰로 끝낸다', async () => {
  await scenario([SUBMIT, FIX_COMMIT, ...PUSH_AND_PR, { do: 'stop' }])
  const app = await kit.openApp(await makeTempDir('relay-home-'))
  const { works } = app
  const id = await startWork(app)
  await until(
    () =>
      works.find(id)?.exports[0]?.exported_head === works.view(id).head && settled(works.view(id)),
    'PR의 내보내기 증거',
  )
  await works.idle()
  const head = works.view(id).head ?? ''
  vi.stubEnv('FAKE_CLAUDE_REVIEW_MS', '1500')
  try {
    // [증거 다시 재기](PR이 이 head를 가리킴): 내보내기로 다시 재고 리뷰를 다시 부른다
    const again = works.runEvidence(id, { exportCandidate: true })
    await until(() => works.view(id).reviewRunning, '다시 재는 리뷰')
    expect(works.view(id).evidence?.review).toBeNull()
    expect(works.find(id)?.exports[0]?.exported_head).toBeNull()
    expect(await works.end(id, { head })).toEqual({ head, ended: false, armed: true, open: [] })
    await again
    await until(() => works.view(id).state === 'done', '리뷰 뒤 끝남')
    await works.idle()
  } finally {
    vi.stubEnv('FAKE_CLAUDE_REVIEW_MS', '')
  }
  expect(await reviews()).toBe(2)
  expect(await ends(app, id)).toEqual([
    { type: 'end_armed', head },
    { type: 'ended', how: 'armed', head, memos: 1 },
  ])
})

test('PR head를 다시 재는 리뷰 중 앱을 닫으면 그 head는 내보내기로 잰 것이 아니다: 다시 켠 뒤 [끝내기]는 리뷰 없음 상자에 갇히지 않고 리뷰를 다시 부른다', async () => {
  await scenario([SUBMIT, FIX_COMMIT, ...PUSH_AND_PR, { do: 'stop' }])
  const home = await makeTempDir('relay-home-')
  const first = await kit.openApp(home)
  const id = await startWork(first)
  await until(
    () =>
      first.works.find(id)?.exports[0]?.exported_head === first.works.view(id).head &&
      settled(first.works.view(id)),
    'PR의 내보내기 증거',
  )
  await first.works.idle()
  const head = first.works.view(id).head ?? ''
  try {
    vi.stubEnv('FAKE_CLAUDE_REVIEW_FAIL', 'hang')
    const again = first.works.runEvidence(id, { exportCandidate: true }).catch(() => {})
    await until(async () => (await reviews()) === 2, '다시 재는 리뷰(claude -p)')
    await first.close()
    kit.forget(first)
    await again
  } finally {
    vi.stubEnv('FAKE_CLAUDE_REVIEW_FAIL', '')
  }
  const second = await kit.openApp(home)
  const { works } = second
  // 엔진이 이 head의 증거 파일을 리뷰 없는 묶음으로 덮었다
  expect(works.view(id).evidence).toMatchObject({ head, review: null })
  expect(await works.end(id, { head })).toEqual({ head, ended: false, armed: true, open: [] })
  await until(() => works.view(id).state === 'done', '리뷰 뒤 끝남')
  await works.idle()
  expect(works.view(id).evidence?.review).toMatchObject({ status: 'done' })
  expect(await reviews()).toBe(3)
  expect((await ends(second, id)).at(-1)).toEqual({ type: 'ended', how: 'armed', head, memos: 1 })
})

test('계약 바꾸기를 받아들일 때 앞 묶음이 내보내기였어도 새 head는 내보내기로 재지 않는다(장부, exported_head, end 리뷰 없음)', async () => {
  await kit.review(RAISED_FINDINGS)
  const changed = {
    ...CONTRACT,
    goal: 'clamp가 hi보다 큰 값을 hi로 자르고 범위 안의 값은 그대로 둔다',
  }
  await scenario([
    SUBMIT,
    FIX_COMMIT,
    { do: 'stop' },
    { do: 'waitInput' },
    // 차례 안의 커밋(훅 없음)과 계약 바꾸기 요청(답을 기다려 Stop이 없다)
    { do: 'commit', message: '중간', files: { 'NOTES.md': '중간\n' } },
    { do: 'mcp', tool: 'request_contract_change', args: { reason: '범위', contract: changed } },
    { do: 'waitInput' },
  ])
  const app = await kit.openApp(await makeTempDir('relay-home-'))
  const { works } = app
  const id = await startWork(app)
  const first = works.view(id).head ?? ''
  // [끝내기]가 미리 리뷰를 내보내기로 잰다(장부 한 줄): 올림이 있어 상자
  expect(await works.end(id, { head: first })).toMatchObject({ armed: false, open: RAISED })
  await works.cancelEnd(id)
  const ledger = (await app.store.readLedger()).filter((e) => e.work === id)
  expect(ledger.map((e) => e.head)).toEqual([first])

  app.sessions.write(id, '고쳐 주세요\r')
  await until(() => works.view(id).state === 'recontract', '계약 바꾸기 요청')
  const second = await workHead(works.record(id))
  expect(second).not.toBe(first)
  await works.answerChange(id, { approved: true, message: '좋아요' })
  await until(
    () => works.view(id).evidence?.head === second && settled(works.view(id)),
    '새 head를 새 계약으로 잼',
  )
  await works.idle()
  // 새 head는 아무도 내보내지 않았다: 내보내기 계기를 기다린다
  expect(works.find(id)?.exports[0]?.exported_head).toBeNull()
  expect((await app.store.readLedger()).filter((e) => e.work === id)).toEqual(ledger)
  expect(await exportsOf(app, id)).toEqual([false, true, false])
  expect(await reviews()).toBe(1)
  expect(works.view(id).state).toBe('working')
})

test('리뷰를 평가용으로 끄면(reviewDisabled) 리뷰를 부르지 않고 건너뜀으로 둔다. 건너뜀은 늘 열린 것이라 [끝내기]는 상자를 띄운다', async () => {
  await scenario([SUBMIT, FIX_COMMIT, { do: 'stop' }])
  const app = await kit.openApp(await makeTempDir('relay-home-'), { reviewDisabled: true })
  const { works } = app
  const id = await startWork(app)
  expect(works.view(id).reviewDisabled).toBe(true)
  const head = works.view(id).head ?? ''
  await works.end(id, { head })
  await until(boxed(app, id), '상자')
  expect(works.view(id).endPending?.open).toEqual(['리뷰를 건너뜀'])
  await works.end(id, { head, force: true })
  const v = works.view(id)
  expect(v.state).toBe('done')
  expect(v.evidence?.review).toEqual({ status: 'skipped', findings: [] })
  expect(v.gate?.reasons).toContain('리뷰를 건너뜀')
  expect(await exportsOf(app, id)).toEqual([false, true])
  expect(await reviews()).toBe(0)
  // 평가가 [끝내기]마다 센 건너뜀 기록은 남긴다
  const skipped = (await app.store.readEvents(id)).filter((e) => e.type === 'review')
  expect(skipped).toMatchObject([{ status: 'skipped', disabled: true }])
})

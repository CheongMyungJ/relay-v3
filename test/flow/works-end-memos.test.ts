// [흐름] 끝낼 때의 메모(V37, src/main/works-end.ts finish·memosOf): [끝내기]가 리뷰 메모(올림이 아닌 지적)를 남기고 끝내면
// Work(work.json end_memos)에 두고 ended에 그 수를 남긴다. 끝난 Work의 화면(WorkView.endMemos)이 보이고 앱을 다시 켜도
// 남는다. 올림은 메모가 아니다([그래도 끝내기]의 열린 것). 단위 브랜치(V22)의 단위 표시는 works-exports.test.ts.
// 바탕은 test/support/works-flow.ts.
import { expect, test } from 'vitest'
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
const { scenario, until } = kit

const SUBMIT = { do: 'mcp', tool: 'submit_contract', args: CONTRACT }
/** 메모 셋: 구조/low, 요청과 어긋남(V30, 메모로 내림), 갈래 없음 */
const MEMOS = [
  { severity: 'low', raise: 'structure', text: '함수가 길다', file: 'src/calc.js', line: 2 },
  { severity: 'medium', raise: 'request_gap', text: '음수 경로를 보지 않음' },
  ...NOTE_FINDINGS,
]

const ended = async (app: TestApp, id: string) =>
  (await app.store.readEvents(id)).filter((e) => e.type === 'ended')

const workJson = async (app: TestApp, id: string) =>
  JSON.parse((await app.store.readText(id, 'work.json')) ?? '') as Entry

/** 프로젝트를 더하고 Work를 만들어 승인하고, 세션이 쉬어 미리 리뷰(V23)까지 끝나기를 기다린다 */
async function reviewedWork(app: TestApp): Promise<string> {
  const { works } = app
  const project = await works.addProject(kit.repo.dir)
  const { id } = await works.createWork({ project: project.id, request: REQUEST })
  await until(() => works.view(id).state === 'awaiting_approval', '계약 제출')
  await works.approveContract(id)
  await until(() => {
    const v = works.view(id)
    return v.evidence?.review?.status === 'done' && v.evidence.head === v.head && settled(v)
  }, '미리 리뷰')
  return id
}

test('메모만 남긴 [끝내기]는 한 번에 끝나고, 끝난 Work에 그 메모를 남긴다(work.json, ended.memos, 다시 켜도)', async () => {
  await kit.review(MEMOS)
  await scenario([SUBMIT, FIX_COMMIT, { do: 'stop' }, { do: 'waitInput' }])
  const home = await makeTempDir('relay-home-')
  const first = await kit.openApp(home)
  const id = await reviewedWork(first)
  const head = first.works.view(id).head ?? ''
  // 끝나기 전에는 보이지 않는다(메모는 [증거]의 리뷰 지적에 있다)
  expect(first.works.view(id).endMemos).toEqual([])

  expect(await first.works.end(id, { head })).toEqual({ head, ended: true, armed: false, open: [] })
  const memos = MEMOS.map((f) => ({ finding: expect.objectContaining(f) as unknown }))
  expect(first.works.view(id)).toMatchObject({ state: 'done', endMemos: memos })
  expect((await workJson(first, id)).end_memos).toEqual(first.works.view(id).endMemos)
  expect(await ended(first, id)).toMatchObject([{ how: 'once', head, memos: 3 }])
  await first.close()
  kit.forget(first)

  const second = await kit.openApp(home)
  expect(second.works.view(id)).toMatchObject({ state: 'done', endMemos: memos })
})

test('[그래도 끝내기]는 올림을 메모로 남기지 않는다: 올림 곁의 메모만 남긴다', async () => {
  await kit.review([...RAISED_FINDINGS, ...NOTE_FINDINGS])
  await scenario([SUBMIT, FIX_COMMIT, { do: 'stop' }, { do: 'waitInput' }])
  const app = await kit.openApp(await makeTempDir('relay-home-'))
  const { works } = app
  const id = await reviewedWork(app)
  const head = works.view(id).head ?? ''

  const box = await works.end(id, { head })
  expect(box).toMatchObject({
    ended: false,
    armed: false,
    open: [expect.stringContaining('계약 밖')],
  })
  await works.end(id, { head, force: true })
  expect(works.view(id).endMemos).toEqual([{ finding: expect.objectContaining(NOTE_FINDINGS[0]) }])
  expect(await ended(app, id)).toMatchObject([{ how: 'box', open: 1, memos: 1 }])
})

// [흐름] 미리 리뷰 (V23, src/main/works-review.ts): 세션이 쉬고 증거가 리뷰 준비인 head에 리뷰를 미리 돌린다. 경우: 미리 리뷰가
// 끝난 head의 [끝내기]는 걸리지 않고 한 번에(그 리뷰를 다시 씀), 미리 리뷰가 도는 동안의 [끝내기]는 걸렸다가 그 리뷰로 끝남,
// 미리 리뷰로 자동 조건을 채워도 열린 PR을 머지하지 않고 장부에 쓰지 않음(push 뒤 내보내기가 머지), 셸 커밋과 계약 바꾸기
// 요청은 도는 리뷰를 멈춤(리뷰마다 AbortController), 리뷰 준비가 아니면 돌리지 않음과 Work마다 4번까지, 내보내기로 잰
// head로 되돌아와 새로 받은 미리 리뷰는 내보내기가 아님, 'auto_only'에서 리뷰를 부르지 않을 head는 쉴 때마다 다시 재지 않음.
// 바탕은 test/support/works-flow.ts.
import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeAll, describe, expect, test, vi } from 'vitest'
import { calc } from '../support/calc.ts'
import { makeTempDir } from '../support/repo.ts'
import { jsonl, type TestApp } from '../support/works-app.ts'
import {
  CONTRACT,
  FIX_COMMIT,
  flowKit,
  NOTE_FINDINGS,
  PUSH_AND_PR,
  RAISED_FINDINGS,
  flowEpoch,
  REQUEST,
  settled,
  type Entry,
} from '../support/works-flow.ts'

const kit = flowKit()
const { scenario, fake, until } = kit

const SUBMIT = { do: 'mcp', tool: 'submit_contract', args: CONTRACT }
const STOP_AND_WAIT = [{ do: 'stop' }, { do: 'waitInput' }]

/** 가짜 claude -p를 부른 수 */
const reviewCalls = async () => (await fake()).filter((e) => e.type === 'review').length

/** events.jsonl의 기록(ts를 뺀다) */
async function events(app: TestApp, id: string, type: string): Promise<Entry[]> {
  return (await app.store.readEvents(id))
    .filter((e) => e.type === type)
    .map((e) => {
      const { ts, ...rest } = e
      return ts === undefined ? e : rest
    })
}

/** review 기록의 [계기, 다시 씀, 멈춤] */
const reviewsOf = async (app: TestApp, id: string) =>
  (await events(app, id, 'review')).map((e) => [e.trigger, e.reused ?? false, e.aborted ?? false])

const workJson = async (app: TestApp, id: string) =>
  JSON.parse((await app.store.readText(id, 'work.json')) ?? '') as Entry

/** work.json의 미리 리뷰 수: Work 브랜치의 내보내기(V22) */
const prepared = (w: Entry) => (w.exports as Entry[])[0]?.prepared_reviews

async function start(app: TestApp, projectId?: string): Promise<string> {
  const { works } = app
  const project = projectId ?? (await works.addProject(kit.repo.dir)).id
  const { id } = await works.createWork({ project, request: REQUEST })
  await until(() => works.view(id).state === 'awaiting_approval', '계약 제출')
  await works.approveContract(id)
  return id
}

/** 터미널에 한 줄을 넣고, 세션의 새 head를 재기(미리 리뷰까지)가 끝날 때까지 기다린다 */
async function nextHead(app: TestApp, id: string, prev: string, text: string): Promise<string> {
  app.sessions.write(id, `${text}\r`)
  await until(() => {
    const v = app.works.view(id)
    return v.head !== prev && v.evidence?.head === v.head && settled(v)
  }, `${text}: 새 head의 증거`)
  return app.works.view(id).head ?? ''
}

test('미리 리뷰가 끝난 head의 [끝내기]는 걸리지 않고 한 번에 끝난다: 증거와 리뷰를 다시 쓰고(claude -p 한 번) 장부에는 내보내기 한 줄', async () => {
  await scenario([SUBMIT, FIX_COMMIT, ...STOP_AND_WAIT])
  const app = await kit.openApp(await makeTempDir('relay-home-'))
  const { works } = app
  const id = await start(app)
  await until(
    () => works.view(id).evidence?.review?.status === 'done' && settled(works.view(id)),
    '미리 리뷰',
  )
  const head = works.view(id).head ?? ''
  // 내보내기가 아니다: 장부에 쓰지 않는다
  expect(works.find(id)?.exports[0]?.exported_head).toBeNull()
  expect(await app.store.readLedger()).toEqual([])
  expect(prepared(await workJson(app, id))).toBe(1)

  expect(await works.end(id, { head })).toEqual({ head, ended: true, armed: false, open: [] })
  expect(works.view(id).state).toBe('done')
  expect(await reviewCalls()).toBe(1)
  expect(await reviewsOf(app, id)).toEqual([
    ['prepared', false, false],
    ['end', true, false],
  ])
  const measured = await events(app, id, 'evidence')
  expect(measured.map((e) => [e.head, e.export, e.reused ?? false])).toEqual([
    [head, false, false],
    [head, true, true],
  ])
  expect((await app.store.readLedger()).map((e) => [e.work, e.head, e.conclusion])).toEqual([
    [id, head, 'human_merge'],
  ])
  expect(await events(app, id, 'ended')).toEqual([{ type: 'ended', how: 'once', head, memos: 1 }])
  // 리뷰 결과는 세션에 넣지 않는다(V4, V8)
  expect((await fake()).filter((e) => e.type === 'input')).toEqual([])
})

test('미리 리뷰가 도는 동안의 [끝내기]는 걸리고, 리뷰가 끝나면 그 리뷰로 내보내기를 재서 끝낸다(claude -p 한 번)', async () => {
  await scenario([SUBMIT, FIX_COMMIT, ...STOP_AND_WAIT])
  vi.stubEnv('FAKE_CLAUDE_REVIEW_MS', '1500')
  try {
    const app = await kit.openApp(await makeTempDir('relay-home-'))
    const { works } = app
    const id = await start(app)
    await until(() => works.view(id).reviewRunning, '미리 리뷰 시작')
    const head = works.view(id).head ?? ''
    const armed = { head, armed: true, open: [] }
    expect(await works.end(id, { head })).toEqual({ ...armed, ended: false })
    expect(works.view(id).endPending).toEqual(armed)
    await until(() => works.view(id).state === 'done', '리뷰 뒤 끝남')
    await works.idle()
    expect(await reviewCalls()).toBe(1)
    expect(await reviewsOf(app, id)).toEqual([
      ['prepared', false, false],
      ['end', true, false],
    ])
    expect((await events(app, id, 'evidence')).map((e) => e.export)).toEqual([false, true])
    expect(await events(app, id, 'ended')).toEqual([
      { type: 'ended', how: 'armed', head, memos: 1 },
    ])
  } finally {
    vi.stubEnv('FAKE_CLAUDE_REVIEW_MS', '')
  }
})

describe('자동 머지가 켜진 프로젝트 (보호된 main, 조건 small의 그림자 실적 1)', () => {
  let home: string
  let projectId: string

  beforeAll(async () => {
    home = await makeTempDir('relay-home-')
    const checks = { enforcement_level: 'everyone', contexts: ['ci'], strict: true }
    await kit.gh((state) => {
      state.branches = { main: { protected: true, protection: { required_status_checks: checks } } }
    })
    const app = await kit.openApp(home)
    projectId = (await app.works.addProject(kit.repo.dir)).id
    await app.works.updateSettings(projectId, { auto_merge: true, min_shadow: 1 })
    await app.close()
    kit.forget(app)
    // 앞서 사람이 그림자 head를 그대로 머지한 Work 하나
    const v = flowEpoch()
    const base = { ts: '2026-11-01T00:00:00Z', project: projectId, work: 'w0', head: 'h0', ...v }
    const lines = [
      { ...base, conclusion: 'human_merge', condition: 'small', shadow: true },
      {
        ...base,
        conclusion: 'human_merge',
        condition: null,
        shadow: false,
        by: 'human',
        merged_head: 'h0',
      },
    ]
    await appendFile(
      join(home, 'ledger.jsonl'),
      lines.map((l) => `${JSON.stringify(l)}\n`).join(''),
    )
  })

  test('미리 리뷰로 자동 조건을 채워도 열린 PR을 머지하지 않고 장부에 쓰지 않는다. push로 PR이 그 head를 가리키면 내보내기가 미리 리뷰를 다시 써서 정책이 머지한다', async () => {
    // 첫 내보내기(PR)는 올림이 있어 사람 머지다. 세션이 고친 head는 push 전까지 PR이 가리키지 않는다
    await kit.review(RAISED_FINDINGS)
    await scenario([
      SUBMIT,
      FIX_COMMIT,
      ...PUSH_AND_PR,
      ...STOP_AND_WAIT,
      { do: 'commit', message: '정리', files: { 'src/calc.js': `${calc('hi')}// 정리\n` } },
      ...STOP_AND_WAIT,
      { do: 'bash', command: 'git push' },
      ...STOP_AND_WAIT,
    ])
    const app = await kit.openApp(home)
    const { works } = app
    const id = await start(app, projectId)
    await until(() => {
      const v = works.view(id)
      return v.head !== null && works.find(id)?.exports[0]?.exported_head === v.head && settled(v)
    }, 'PR의 내보내기')
    const first = works.view(id).head ?? ''
    expect(works.view(id).gate?.conclusion).toBe('human_merge')

    await kit.review(NOTE_FINDINGS)
    const second = await nextHead(app, id, first, '지적을 고쳐 주세요')
    const v = works.view(id)
    expect(v.evidence?.review).toMatchObject({
      status: 'done',
      findings: [{ text: '이름이 짧음' }],
    })
    expect(v.gate).toMatchObject({ conclusion: 'auto_merge_candidate', condition: 'small' })
    // 내보내기가 아니다: 머지하지 않고(자동 머지를 해 보지도 않는다), 장부에 쓰지 않는다
    expect(v).toMatchObject({
      state: 'working',
      error: null,
      pr: { state: 'OPEN', headRefOid: first },
    })
    // 지금 묶음은 내보내기로 잰 것이 아니다(첫 head의 내보내기 묶음을 바꿨다)
    expect(works.find(id)?.exports[0]?.exported_head).toBeNull()
    const mine = async () => (await app.store.readLedger()).filter((e) => e.work === id)
    expect((await mine()).map((e) => [e.head, e.conclusion])).toEqual([[first, 'human_merge']])
    const merges = async () =>
      (await jsonl(kit.ghLog)).filter((e) => (e.args as string[])[1] === 'merge')
    expect(await merges()).toEqual([])
    expect(await events(app, id, 'auto_merge_failed')).toEqual([])
    expect(await events(app, id, 'auto_merge_waiting')).toEqual([])

    // push → PR이 그 head를 가리킨다 → 내보내기는 증거와 미리 리뷰를 다시 쓰고 정책이 머지한다
    app.sessions.write(id, 'push 해 주세요\r')
    await until(() => works.view(id).state === 'done', '정책 머지')
    expect(await reviewCalls()).toBe(2)
    expect(await reviewsOf(app, id)).toEqual([
      ['pr', false, false],
      ['prepared', false, false],
      ['pr', true, false],
    ])
    expect((await mine()).map((e) => [e.head, e.conclusion, e.by ?? null])).toEqual([
      [first, 'human_merge', null],
      [second, 'auto_merge_candidate', null],
      [second, 'auto_merge_candidate', 'policy'],
    ])
    expect((await merges()).map((e) => (e.args as string[]).at(-1))).toEqual([second])
  })
})

test('내보내기로 잰 head로 세션이 되돌아와 미리 리뷰를 새로 받으면 그 묶음은 내보내기가 아니다: [끝내기]가 내보내기로 다시 재서 장부에 한 줄을 남긴다', async () => {
  await kit.review(RAISED_FINDINGS)
  await scenario([
    SUBMIT,
    FIX_COMMIT,
    ...STOP_AND_WAIT,
    { do: 'commit', message: '시도', files: { 'NOTES.md': '시도\n' } },
    ...STOP_AND_WAIT,
    { do: 'bash', command: 'git reset -q --hard HEAD~1' },
    ...STOP_AND_WAIT,
  ])
  const app = await kit.openApp(await makeTempDir('relay-home-'))
  const { works } = app
  const id = await start(app)
  await until(
    () => works.view(id).evidence?.review?.status === 'done' && settled(works.view(id)),
    '미리 리뷰',
  )
  const first = works.view(id).head ?? ''
  // [끝내기]가 미리 리뷰를 내보내기로 잰다(장부 한 줄): 올림이 있어 상자. [더 고치기]
  expect(await works.end(id, { head: first })).toMatchObject({ armed: false })
  expect(works.find(id)?.exports[0]?.exported_head).toBe(first)
  await works.cancelEnd(id)

  await kit.review(NOTE_FINDINGS)
  const second = await nextHead(app, id, first, '다른 길을 해 보세요')
  // 내보내기가 아닌 재기가 묶음을 바꿨다: 지금 묶음은 내보내기로 잰 것이 아니다
  expect(works.find(id)?.exports[0]?.exported_head).toBeNull()
  app.sessions.write(id, '되돌려 주세요\r')
  await until(() => {
    const v = works.view(id)
    return v.head === first && v.evidence?.head === first && settled(v)
  }, '되돌린 head의 미리 리뷰')
  expect(second).not.toBe(first)
  expect(works.view(id).evidence?.review).toMatchObject({ status: 'done' })
  expect(works.find(id)?.exports[0]?.exported_head).toBeNull()

  // 같은 head지만 묶음(올림 없는 미리 리뷰)은 내보내기가 아니다: [끝내기]가 내보내기로 재서(다시 씀) 장부에 남긴다
  expect(await works.end(id, { head: first })).toEqual({
    head: first,
    ended: true,
    armed: false,
    open: [],
  })
  expect(await reviewCalls()).toBe(3)
  expect(await reviewsOf(app, id)).toEqual([
    ['prepared', false, false],
    ['end', true, false],
    ['prepared', false, false],
    ['prepared', false, false],
    ['end', true, false],
  ])
  expect((await app.store.readLedger()).map((e) => [e.head, e.shadow])).toEqual([
    [first, false],
    [first, true],
  ])
})

test("리뷰 범위 'auto_only'에서 자동 조건을 못 채운 head는 쉴 때마다 다시 보이거나 적지 않는다(미리 리뷰를 부르지 않고 gh도 묻지 않는다)", async () => {
  // 바뀐 줄이 조건 small(50줄)을 넘는다
  const big = { ...FIX_COMMIT, files: { ...FIX_COMMIT.files, 'NOTES.md': 'x\n'.repeat(60) } }
  await scenario([SUBMIT, big, ...STOP_AND_WAIT, ...STOP_AND_WAIT])
  const app = await kit.openApp(await makeTempDir('relay-home-'))
  const { works } = app
  const project = await works.addProject(kit.repo.dir)
  await works.updateSettings(project.id, { review: 'auto_only' })
  const id = await start(app, project.id)
  await until(() => works.view(id).evidence !== null && settled(works.view(id)), '첫 증거')
  await works.idle()
  const v = works.view(id)
  expect(v.evidence?.review).toBeNull()
  expect(v.evidence?.diff.added).toBeGreaterThan(50)
  expect(await events(app, id, 'evidence')).toHaveLength(1)
  const asked = (await jsonl(kit.ghLog)).length

  // 같은 head에서 다시 쉰다: Stop 뒤 몰아 두기가 끝날 때까지 본다
  const rt = works.runtime(id)
  let waited = false
  app.sessions.write(id, '그대로 두세요\r')
  await until(() => {
    if (rt.debounce !== null) waited = true
    return waited && rt.debounce === null
  }, '둘째 Stop 뒤 몰아 두기')
  await works.idle()
  expect(await events(app, id, 'evidence')).toHaveLength(1)
  expect((await jsonl(kit.ghLog)).length).toBe(asked)
  expect(await reviewCalls()).toBe(0)
  expect(prepared(await workJson(app, id))).toBe(0)
})

test('세션이 셸 명령으로 커밋하면 도는 미리 리뷰를 바로 멈추고 버린다(리뷰마다 AbortController). 새 head는 다시 쉴 때 미리 리뷰한다', async () => {
  const shellCommit = `git -c user.name=f -c user.email=f@relay.invalid commit -q --allow-empty -m 둘째`
  await scenario([
    SUBMIT,
    FIX_COMMIT,
    ...STOP_AND_WAIT,
    { do: 'bash', command: shellCommit },
    ...STOP_AND_WAIT,
  ])
  vi.stubEnv('FAKE_CLAUDE_REVIEW_MS', '20000')
  try {
    const app = await kit.openApp(await makeTempDir('relay-home-'))
    const { works } = app
    const id = await start(app)
    // 리뷰어(claude -p)가 프롬프트를 받아 돌고 있다
    await until(async () => (await reviewCalls()) === 1, '미리 리뷰 시작')
    const first = works.view(id).head ?? ''
    const started = Date.now()
    app.sessions.write(id, '하나 더\r')
    // 셸 커밋의 PostToolUse가 HEAD를 고치면 그 리뷰를 끊는다: 20초를 기다리지 않는다
    await until(
      async () => (await reviewsOf(app, id)).some(([, , aborted]) => aborted === true),
      '리뷰 멈춤',
    )
    expect(Date.now() - started).toBeLessThan(15_000)
    vi.stubEnv('FAKE_CLAUDE_REVIEW_MS', '')
    await until(() => {
      const v = works.view(id)
      return v.head !== first && v.evidence?.review?.status === 'done' && settled(v)
    }, '새 head의 미리 리뷰')
    const v = works.view(id)
    expect(v.evidence?.head).toBe(v.head)
    expect(await reviewCalls()).toBe(2)
    expect(await reviewsOf(app, id)).toEqual([
      ['prepared', false, true],
      ['prepared', false, false],
    ])
    // 멈춘 리뷰의 head는 증거 기록(결론)을 남기지 않는다
    expect((await events(app, id, 'evidence')).map((e) => e.head)).toEqual([v.head])
    expect(prepared(await workJson(app, id))).toBe(2)
  } finally {
    vi.stubEnv('FAKE_CLAUDE_REVIEW_MS', '')
  }
})

test('계약 바꾸기 요청이 오면 도는 미리 리뷰를 멈춘다(앞 계약의 리뷰)', async () => {
  const changed = { ...CONTRACT, goal: 'clamp가 hi보다 큰 값을 hi로, lo보다 작은 값을 lo로 자른다' }
  await scenario([
    SUBMIT,
    FIX_COMMIT,
    ...STOP_AND_WAIT,
    { do: 'mcp', tool: 'request_contract_change', args: { reason: '범위', contract: changed } },
    { do: 'waitInput' },
  ])
  vi.stubEnv('FAKE_CLAUDE_REVIEW_MS', '20000')
  try {
    const app = await kit.openApp(await makeTempDir('relay-home-'))
    const { works } = app
    const id = await start(app)
    await until(() => works.view(id).reviewRunning, '미리 리뷰 시작')
    app.sessions.write(id, '계약을 바꿔야 해요\r')
    await until(() => works.view(id).state === 'recontract', '계약 바꾸기 요청')
    await until(() => settled(works.view(id)), '리뷰 멈춤')
    expect(await reviewsOf(app, id)).toEqual([['prepared', false, true]])
    expect(works.view(id).evidence?.review).toBeNull()
    await works.answerChange(id, { approved: false, message: '그대로 갑니다' })
  } finally {
    vi.stubEnv('FAKE_CLAUDE_REVIEW_MS', '')
  }
})

test('리뷰 준비가 아니면(시험 실패) 미리 리뷰하지 않는다(그 사실은 되먹임으로 간다, V24). 미리 리뷰는 Work마다 4번까지이고, 그 뒤 head는 [끝내기]가 리뷰한다', async () => {
  const failing = {
    ...FIX_COMMIT,
    message: '시험 먼저',
    files: { ...FIX_COMMIT.files, 'src/calc.js': calc('lo') },
  }
  const note = (n: number) => ({
    do: 'commit',
    message: `메모 ${n}`,
    files: { 'NOTES.md': `${n}\n` },
  })
  await scenario([
    SUBMIT,
    failing,
    ...STOP_AND_WAIT,
    FIX_COMMIT,
    ...STOP_AND_WAIT,
    ...[1, 2, 3, 4].flatMap((n) => [note(n), ...STOP_AND_WAIT]),
  ])
  const app = await kit.openApp(await makeTempDir('relay-home-'))
  const { works } = app
  const id = await start(app)
  await until(() => works.view(id).evidence !== null && settled(works.view(id)), '첫 증거')
  // 수용 시험이 실패한 head: 리뷰 준비가 아니다
  expect(works.view(id).evidence?.lines?.find((l) => l.line === 'C1')?.status).toBe('not_met')
  expect(works.view(id).evidence?.review).toBeNull()
  expect(await reviewCalls()).toBe(0)

  // 실패한 사실은 쉬는 세션에 되먹임으로 간다(V24): 세션이 터미널의 한 줄을 받고 고친다
  let head = works.view(id).head ?? ''
  await until(() => {
    const v = works.view(id)
    return v.head !== head && v.evidence?.head === v.head && settled(v)
  }, '되먹임 뒤 고친 head')
  const inputs = (await fake()).filter((e) => e.type === 'input').map((e) => e.text)
  expect(inputs).toEqual([expect.stringMatching(/^relay feedback 1 for head /)])
  head = works.view(id).head ?? ''
  for (const text of ['1', '2', '3', '4']) head = await nextHead(app, id, head, text)
  // 고친 head와 메모 셋까지 넷은 미리 리뷰했다. 다섯째 head에는 리뷰가 없다
  expect(await reviewCalls()).toBe(4)
  expect(works.view(id).evidence?.review).toBeNull()
  expect(prepared(await workJson(app, id))).toBe(4)
  expect(await works.end(id, { head })).toMatchObject({ armed: true })
  await until(() => works.view(id).state === 'done', '[끝내기]의 리뷰 뒤 끝남')
  expect(await reviewCalls()).toBe(5)
  expect((await reviewsOf(app, id)).map(([trigger]) => trigger)).toEqual([
    'prepared',
    'prepared',
    'prepared',
    'prepared',
    'end',
  ])
  // 장부에는 [끝내기]의 내보내기 한 줄뿐
  expect((await app.store.readLedger()).map((e) => e.head)).toEqual([head])
})

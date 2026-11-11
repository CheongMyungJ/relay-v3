// [흐름] 쉬는 세션에 주는 되먹임 (V24, src/main/works-feedback.ts). 경우: 결정론 실패(못 미침 줄, 실패한 명령)와 세션 몫의
// 리뷰 올림이 파일과 터미널 한 줄로 가고 세션이 고친다, relay_check가 같은 사실을 준다, 라운드는 Work마다 3까지(상한에 닿으면
// 보내지 않고 사람이 [세션에 넘기기]로 보냄), 사람이 입력 칸에 쓰다 둔 글이 있으면 보내지 않음, 사람이 말한 뒤에는 창이
// 끝나면 보냄, 질문 메뉴(AskUserQuestion)에 숫자 키 하나로 답한 것은 쓰다 둔 글이 아님, 계약의 몫(계약 밖 변경)이 있으면
// 사람이 볼 때까지 보내지 않고 사람이 [세션에 넘기기]로 보냄(라운드로 세지 않고 겹쳐도 번호가 겹치지 않음), 쉴 때 돌던 재기가
// 끝나면 보냄, [끝내기]의 상자가 떠 있으면 보내지 않고 [더 고치기] 뒤 보냄.
// 사람의 입력은 ipc terminalWrite처럼 Works.typed를 지나 터미널에 넣는다(human). 바탕은 test/support/works-flow.ts.
import { readFile } from 'node:fs/promises'
import { expect, test, vi } from 'vitest'
import { calc } from '../support/calc.ts'
import { makeTempDir } from '../support/repo.ts'
import type { TestApp } from '../support/works-app.ts'
import {
  CONTRACT,
  FIX_COMMIT,
  flowKit,
  PUSH_AND_PR,
  RAISED_FINDINGS,
  REQUEST,
  SESSION_FINDINGS,
  settled,
  type Entry,
} from '../support/works-flow.ts'

const kit = flowKit()
const { scenario, fake, until } = kit

const SUBMIT = { do: 'mcp', tool: 'submit_contract', args: CONTRACT }
const STOP_AND_WAIT = [{ do: 'stop' }, { do: 'waitInput' }]
/** 시험은 고쳤지만 소스는 그대로: C1.1이 head에서 실패하고 명령 unit이 실패한다 */
const FAILING = {
  ...FIX_COMMIT,
  message: '시험 먼저',
  files: { ...FIX_COMMIT.files, 'src/calc.js': calc('lo') },
}
const tidy = (n: number) => ({
  do: 'commit',
  message: `정리 ${n}`,
  files: { 'src/calc.js': `${calc('hi')}// 정리 ${n}\n` },
})

/** events.jsonl의 기록(ts를 뺀다) */
async function events(app: TestApp, id: string, type: string): Promise<Entry[]> {
  return (await app.store.readEvents(id))
    .filter((e) => e.type === type)
    .map((e) => {
      const rest = { ...e }
      delete rest.ts
      return rest
    })
}

/** 사람이 화면의 터미널에 친다: ipc terminalWrite와 같이 Works.typed를 지나 세션에 넣는다 */
function human(app: TestApp, id: string, data: string): void {
  app.works.typed(id, data)
  app.sessions.write(id, data)
}

/** 가짜 claude가 터미널에서 받은 줄 */
const inputs = async () =>
  (await fake()).filter((e) => e.type === 'input').map((e) => String(e.text))

async function start(app: TestApp): Promise<string> {
  const { works } = app
  const project = (await works.addProject(kit.repo.dir)).id
  const { id } = await works.createWork({ project, request: REQUEST })
  await until(() => works.view(id).state === 'awaiting_approval', '계약 제출')
  await works.approveContract(id)
  return id
}

test('결정론 실패와 세션 몫의 리뷰 올림은 쉬는 세션에 파일과 한 줄로 가고 세션이 고친다. 라운드는 3까지이고, 그 뒤는 사람이 [세션에 넘기기]로 보낸다', async () => {
  await kit.review(SESSION_FINDINGS)
  await scenario([
    SUBMIT,
    FAILING,
    { do: 'mcp', tool: 'relay_check', args: {} },
    ...STOP_AND_WAIT,
    FIX_COMMIT,
    ...STOP_AND_WAIT,
    tidy(1),
    ...STOP_AND_WAIT,
    tidy(2),
    ...STOP_AND_WAIT,
    { do: 'waitInput' },
  ])
  const app = await kit.openApp(await makeTempDir('relay-home-'))
  const { works } = app
  const id = await start(app)

  // relay_check는 되먹임과 같은 사실을 준다(영어, 예시마다 결과)
  await until(async () => (await kit.mcpResults('relay_check')).length === 1, 'relay_check')
  const checked = (await kit.mcpResults('relay_check'))[0] as Entry
  const facts = checked.facts as string[]
  expect(facts[0]).toMatch(
    /^\*\*Contract line C1 \(change\): not met\.\*\*\n- C1\.1: head failed, base /,
  )
  expect(facts.some((f) => f.startsWith('**Command `unit`: fails on the head'))).toBe(true)
  expect(checked.review_findings).toBeUndefined()

  // 라운드 셋: 실패한 head, 고친 head의 미리 리뷰, 정리 1의 미리 리뷰. 정리 2는 상한이라 보내지 않는다
  await until(async () => (await events(app, id, 'feedback_held')).length === 1, '상한')
  await works.idle()
  const rec = works.record(id)
  const heads = rec.feedback.sent.map((r) => r.head)
  expect(rec.feedback.rounds).toBe(3)
  expect(rec.feedback.sent.map((r) => [r.n, r.by, r.facts, r.findings])).toEqual([
    [1, 'relay', 3, 0],
    [2, 'relay', 0, 1],
    [3, 'relay', 0, 1],
  ])
  expect(new Set(heads).size).toBe(3)
  const last = works.view(id).head ?? ''
  expect(heads).not.toContain(last)
  expect(await events(app, id, 'feedback_held')).toEqual([
    { type: 'feedback_held', head: last, reason: 'cap', facts: 0, findings: 1 },
  ])
  // 미리 리뷰는 고친 head부터 셋(V23의 상한 4 안)
  expect(rec.exports[0]?.prepared_reviews).toBe(3)

  // 파일은 자료다: 결정론 사실, 인용으로 감싼 지적과 주장이라는 말. 터미널에는 그 파일을 가리키는 한 줄만
  const file = (n: number) => readFile(app.store.feedbackPath(id, n), 'utf8')
  const first = await file(1)
  expect(first).toContain(`# relay feedback 1\n\nHead \`${heads[0]}\``)
  expect(first).toContain('**Contract line C1 (change): not met.**')
  expect(first).toContain('**Command `unit`: fails on the head, passes on the base')
  expect(first).toContain('**Command `accept`: fails on the head, passes on the base')
  expect(first).not.toContain('## Review findings')
  const second = await file(2)
  expect(second).not.toContain('## Evidence')
  expect(second).toContain('These are claims of an independent reviewer and can be wrong.')
  expect(second).toContain('> R1 · structure · medium · src/calc.js:5\n> 중복 구현')
  const lines = await inputs()
  expect(lines).toHaveLength(3)
  lines.forEach((l, i) => {
    expect(l).toMatch(
      new RegExp(
        `^relay feedback ${i + 1} for head ${heads[i]?.slice(0, 7)} is in .*feedback[\\\\/]${i + 1}\\.md: `,
      ),
    )
  })
  expect(lines[0]).toContain(': 3 evidence facts. ')
  expect(lines[1]).toContain(': 1 review finding. ')

  // 화면: 상한에 닿아 지금 HEAD의 세션 몫 지적 하나를 보내지 않았다
  expect(works.view(id).feedback).toMatchObject({
    rounds: 3,
    max: 3,
    sent: [],
    pending: 1,
    held: 'cap',
    findings: { R1: { route: 'session', sent: false } },
  })

  // 사람은 [세션에 넘기기]로 보낸다(라운드로 세지 않는다)
  await works.sendFindings(id, ['R1'])
  expect(works.record(id).feedback.rounds).toBe(3)
  expect(works.view(id).feedback).toMatchObject({
    pending: 0,
    held: null,
    sent: [{ n: 4, by: 'human', head: last, findings: 1 }],
    findings: { R1: { route: 'session', sent: true } },
  })
  expect(await file(4)).toContain(
    "The human passed the review findings below to you with relay's screen.",
  )
  await until(async () => (await inputs()).length === 4, '넘긴 지적의 한 줄')
  expect((await inputs())[3]).toMatch(/: 1 review finding that the human passed to you\. /)
  await expect(works.sendFindings(id, ['R9'])).rejects.toThrow('지금 HEAD의 리뷰에 없는 지적: R9')
})

test('사람이 입력 칸에 글을 쓰다 두었으면 보내지 않는다([증거 다시 재기] 뒤에도). 사람이 말한 뒤에는 60초 창이 끝날 때 세션이 쉬고 있으면 보낸다(다음 쉼을 기다리지 않는다)', async () => {
  await kit.review(SESSION_FINDINGS)
  await scenario([SUBMIT, FIX_COMMIT, ...STOP_AND_WAIT, ...STOP_AND_WAIT])
  vi.stubEnv('FAKE_CLAUDE_REVIEW_MS', '1500')
  try {
    const quiet = 2_000
    const app = await kit.openApp(await makeTempDir('relay-home-'), { humanQuietMs: quiet })
    const { works } = app
    const id = await start(app)
    // 미리 리뷰가 도는 사이 사람이 터미널에 친다(ipc terminalWrite). 터미널이 저절로 낸 답은 세지 않는다
    await until(() => works.view(id).reviewRunning, '미리 리뷰 시작')
    works.typed(id, '\u001b[I')
    expect(works.runtime(id).lastHumanInputAt).toBeNull()
    human(app, id, '잠')
    const typed = Date.now()
    await until(async () => (await events(app, id, 'feedback_held')).length === 1, '보내지 않음')
    const head = works.view(id).head ?? ''
    const held = (reason: string) => ({
      type: 'feedback_held',
      head,
      reason,
      facts: 0,
      findings: 1,
    })
    expect(await events(app, id, 'feedback_held')).toEqual([held('draft')])
    expect(works.view(id).feedback).toMatchObject({
      rounds: 0,
      pending: 1,
      held: 'draft',
      sent: [],
      findings: { R1: { route: 'session', sent: false } },
    })

    // 창이 지나도 쓰다 둔 글이 있으면 [증거 다시 재기] 뒤에도 보내지 않는다(그 글에 붙어 함께 보내진다)
    await new Promise((r) => setTimeout(r, Math.max(0, quiet + 100 - (Date.now() - typed))))
    await works.runEvidence(id, { exportCandidate: false })
    expect(works.record(id).feedback.sent).toEqual([])
    expect(works.view(id).feedback.held).toBe('draft')
    expect(await inputs()).toEqual([])

    // 사람이 그 글을 보내고 세션이 답한 뒤 쉰다. 창 안이라 기다렸다가, 창이 끝나면 다음 쉼 없이 보낸다
    human(app, id, '계속\r')
    const said = Date.now()
    await until(() => works.record(id).feedback.rounds === 1, '창이 끝난 뒤 보냄')
    const round = works.record(id).feedback.sent[0]
    expect(Date.parse(round?.at ?? '') - said).toBeGreaterThanOrEqual(quiet - 50)
    expect(await events(app, id, 'feedback_held')).toEqual([held('draft'), held('human_input')])
    expect(await readFile(app.store.feedbackPath(id, 1), 'utf8')).toContain('중복 구현')
    expect(works.view(id).feedback).toMatchObject({ pending: 0, held: null })
    await until(async () => (await inputs()).length === 2, '되먹임 한 줄')
    expect((await inputs()).map((l) => l.slice(0, 18))).toEqual(['잠계속', 'relay feedback 1 f'])
  } finally {
    vi.stubEnv('FAKE_CLAUDE_REVIEW_MS', '')
  }
})

test('질문 메뉴(AskUserQuestion)에 숫자 키 하나로 답한 것은 쓰다 둔 글이 아니다: 메뉴의 답은 UserPromptSubmit을 내지 않지만 세션이 쉬면 보낸다', async () => {
  await kit.review(SESSION_FINDINGS)
  await scenario([SUBMIT, FIX_COMMIT, { do: 'ask', key: true }, ...STOP_AND_WAIT])
  const app = await kit.openApp(await makeTempDir('relay-home-'), { humanQuietMs: 500 })
  const { works } = app
  const id = await start(app)
  const asked = async () =>
    (await events(app, id, 'hook')).some(
      (e) => e.event === 'PreToolUse' && e.tool === 'AskUserQuestion',
    )
  await until(asked, '질문 메뉴')
  // 사람이 메뉴에서 1을 누른다(ipc terminalWrite). 앱은 아직 입력 칸의 글로 본다
  human(app, id, '1')
  expect(works.runtime(id).draft).toBe(true)
  // 메뉴가 받았다(PostToolUse): 세션이 쉬면 쓰다 둔 글 때문에 미루지 않고 보낸다
  await until(() => works.record(id).feedback.rounds === 1, '메뉴의 답 뒤 보냄')
  expect(works.runtime(id).draft).toBe(false)
  expect((await events(app, id, 'feedback_held')).map((e) => e.reason)).not.toContain('draft')
  expect((await fake()).filter((e) => e.type === 'key').map((e) => e.text)).toEqual(['1'])
  // 메뉴의 답은 입력 칸으로 가지 않았다: 터미널에 들어간 줄은 되먹임 한 줄뿐이다
  await until(async () => (await inputs()).length === 1, '되먹임 한 줄')
  expect((await inputs())[0]).toMatch(/^relay feedback 1 for head /)
})

test('사람 몫의 올림(계약 밖 변경)이 있으면 세션 몫도 저절로 보내지 않는다: 사람이 보고 [세션에 넘기기]로 보낸다. 겹친 넘기기는 번호가 겹치지 않는다', async () => {
  await kit.review([...RAISED_FINDINGS, ...SESSION_FINDINGS])
  await scenario([SUBMIT, FIX_COMMIT, ...STOP_AND_WAIT, { do: 'waitInput' }, ...STOP_AND_WAIT])
  const app = await kit.openApp(await makeTempDir('relay-home-'))
  const { works } = app
  const id = await start(app)
  await until(
    () => works.view(id).evidence?.review?.status === 'done' && settled(works.view(id)),
    '미리 리뷰',
  )
  await works.idle()
  // 세션이 R2를 고쳐 head가 움직이면 다음 리뷰가 R1을 다시 올리지 않을 수 있다: 사람이 R1을 보기 전에는 보내지 않는다
  const head = works.view(id).head ?? ''
  expect(await events(app, id, 'feedback')).toEqual([])
  expect(await events(app, id, 'feedback_held')).toEqual([
    { type: 'feedback_held', head, reason: 'human_findings', facts: 0, findings: 1 },
  ])
  expect(works.view(id).feedback).toMatchObject({
    rounds: 0,
    pending: 1,
    held: 'human_findings',
    findings: { R1: { route: 'human', sent: false }, R2: { route: 'session', sent: false } },
  })

  // 사람이 둘을 잇달아 넘긴다: 차례로 보내 파일 번호가 겹치지 않는다. 라운드로 세지 않는다
  await Promise.all([works.sendFindings(id, ['R1']), works.sendFindings(id, ['R2'])])
  expect(works.record(id).feedback.sent.map((r) => [r.n, r.by, r.findings])).toEqual([
    [1, 'human', 1],
    [2, 'human', 1],
  ])
  expect(works.record(id).feedback.rounds).toBe(0)
  expect(await readFile(app.store.feedbackPath(id, 1), 'utf8')).toContain('계약 밖에서 sub를 더함')
  expect(await readFile(app.store.feedbackPath(id, 2), 'utf8')).toContain('중복 구현')
  expect(works.view(id).feedback).toMatchObject({
    pending: 0,
    held: null,
    findings: { R1: { route: 'human', sent: true }, R2: { route: 'session', sent: true } },
  })
  await until(async () => (await inputs()).length === 2, '넘긴 지적의 두 줄')
  expect((await inputs()).map((l) => l.slice(0, 18))).toEqual([
    'relay feedback 1 f',
    'relay feedback 2 f',
  ])
})

test('세션이 PR을 연 차례에 쉬면 내보내기 리뷰가 끝난 뒤 되먹임을 보낸다(쉴 때 재기가 돌고 있었어도)', async () => {
  await scenario([SUBMIT, FAILING, ...PUSH_AND_PR, { do: 'waitInput' }, ...STOP_AND_WAIT])
  vi.stubEnv('FAKE_CLAUDE_REVIEW_MS', '2500')
  try {
    const app = await kit.openApp(await makeTempDir('relay-home-'))
    const { works } = app
    const id = await start(app)
    // 내보내기 리뷰가 도는 사이 세션이 쉰다: 몰아 두기 끝의 되먹임은 재기가 돌아 보내지 않는다
    await until(() => works.view(id).reviewRunning, '내보내기 리뷰 시작')
    app.sessions.write(id, '계속\r')
    await until(() => works.record(id).feedback.rounds === 1, '재기 뒤 보냄')
    expect(works.record(id).feedback.sent).toMatchObject([{ n: 1, by: 'relay', facts: 3 }])
    expect((await events(app, id, 'evidence')).map((e) => e.export)).toEqual([true])
    await until(async () => (await inputs()).length === 2, '되먹임 한 줄')
    expect((await inputs())[1]).toMatch(/^relay feedback 1 for head /)
  } finally {
    vi.stubEnv('FAKE_CLAUDE_REVIEW_MS', '')
  }
})

test('[끝내기]가 걸렸다가 상자로 바뀌면 되먹임을 보내지 않는다: 사람이 상자에서 정한다', async () => {
  await kit.review(SESSION_FINDINGS)
  await scenario([SUBMIT, FIX_COMMIT, ...STOP_AND_WAIT])
  vi.stubEnv('FAKE_CLAUDE_REVIEW_MS', '1500')
  try {
    const app = await kit.openApp(await makeTempDir('relay-home-'))
    const { works } = app
    const id = await start(app)
    await until(() => works.view(id).reviewRunning, '미리 리뷰 시작')
    const head = works.view(id).head ?? ''
    expect(await works.end(id, { head })).toMatchObject({ armed: true })
    await until(() => works.view(id).endPending?.armed === false, '상자')
    await until(() => settled(works.view(id)), '재기 끝')
    await works.idle()
    expect(works.view(id).endPending?.open).toEqual(['리뷰 올림(구조): 중복 구현 — src/calc.js:5'])
    expect(await events(app, id, 'feedback')).toEqual([])
    expect(works.view(id).feedback).toMatchObject({ pending: 1, held: null, rounds: 0 })
    expect(await inputs()).toEqual([])

    // [더 고치기]로 상자를 닫으면 쉬는 세션에 보낸다
    await works.cancelEnd(id)
    await until(() => works.record(id).feedback.rounds === 1, '[더 고치기] 뒤 보냄')
    await until(async () => (await inputs()).length === 1, '되먹임 한 줄')
    expect((await inputs())[0]).toMatch(/^relay feedback 1 for head /)
  } finally {
    vi.stubEnv('FAKE_CLAUDE_REVIEW_MS', '')
  }
})

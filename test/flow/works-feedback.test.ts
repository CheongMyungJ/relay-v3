// [흐름] 쉬는 세션에 주는 되먹임 (V24, src/main/works-feedback.ts). 경우: 결정론 실패(못 미침 줄, 실패한 명령)와 세션 몫의
// 리뷰 올림이 파일과 터미널 한 줄로 가고 세션이 고친다, relay_check가 같은 사실을 준다, 라운드는 Work마다 3까지(상한에 닿으면
// 보내지 않고 사람이 [세션에 넘기기]로 보냄), 사람이 최근 입력했으면 보내지 않고 다음에 쉴 때 보냄, 계약의 몫(계약 밖 변경)은
// 사람에게만이고 [세션에 넘기기]로 보냄(라운드로 세지 않음), [끝내기]의 상자가 떠 있으면 보내지 않음.
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
  expect(rec.prepared_reviews).toBe(3)

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
        `^relay feedback ${i + 1} for head ${heads[i]?.slice(0, 7)} is in .*feedback/${i + 1}\\.md: `,
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

test('사람이 최근 터미널에 입력했으면 보내지 않고 상태 줄에만 보이고, 다음에 쉴 때 보낸다. 계약 밖 변경은 사람에게만이고 [세션에 넘기기]로 보낸다', async () => {
  await kit.review([...RAISED_FINDINGS, ...SESSION_FINDINGS])
  await scenario([SUBMIT, FIX_COMMIT, ...STOP_AND_WAIT, ...STOP_AND_WAIT, { do: 'waitInput' }])
  vi.stubEnv('FAKE_CLAUDE_REVIEW_MS', '1500')
  try {
    const app = await kit.openApp(await makeTempDir('relay-home-'), { humanQuietMs: 3_000 })
    const { works } = app
    const id = await start(app)
    // 미리 리뷰가 도는 사이 사람이 터미널에 친다(ipc terminalWrite). 터미널이 저절로 낸 답은 세지 않는다
    await until(() => works.view(id).reviewRunning, '미리 리뷰 시작')
    works.typed(id, '\u001b[I')
    expect(works.runtime(id).lastHumanInputAt).toBeNull()
    works.typed(id, '잠')
    const typed = Date.now()
    await until(async () => (await events(app, id, 'feedback_held')).length === 1, '보내지 않음')
    const head = works.view(id).head ?? ''
    expect(await events(app, id, 'feedback_held')).toEqual([
      { type: 'feedback_held', head, reason: 'human_input', facts: 0, findings: 1 },
    ])
    expect(works.view(id).feedback).toMatchObject({
      rounds: 0,
      pending: 1,
      held: 'human_input',
      sent: [],
      findings: { R1: { route: 'human', sent: false }, R2: { route: 'session', sent: false } },
    })
    expect(await inputs()).toEqual([])

    // 사람이 말하고 세션이 같은 head에서 다시 쉰다: 60초(시험은 3초)가 지났으면 보낸다
    await new Promise((r) => setTimeout(r, Math.max(0, 3_100 - (Date.now() - typed))))
    app.sessions.write(id, '계속\r')
    await until(() => works.record(id).feedback.rounds === 1, '다음에 쉴 때 보냄')
    const text = await readFile(app.store.feedbackPath(id, 1), 'utf8')
    expect(text).toContain('중복 구현')
    expect(text).not.toContain('계약 밖에서 sub를 더함')
    expect(works.view(id).feedback).toMatchObject({
      pending: 0,
      held: null,
      findings: { R1: { route: 'human', sent: false }, R2: { route: 'session', sent: true } },
    })

    // 계약 밖 변경은 [세션에 넘기기]로만 간다. 라운드로 세지 않는다
    await works.sendFindings(id, ['R1'])
    expect(works.record(id).feedback).toMatchObject({ rounds: 1 })
    expect(works.view(id).feedback.findings.R1).toEqual({ route: 'human', sent: true })
    expect(await readFile(app.store.feedbackPath(id, 2), 'utf8')).toContain(
      '계약 밖에서 sub를 더함',
    )
    await until(async () => (await inputs()).length === 3, '넘긴 지적의 한 줄')
    expect((await inputs()).map((l) => l.slice(0, 18))).toEqual([
      '계속',
      'relay feedback 1 f',
      'relay feedback 2 f',
    ])
    expect(await events(app, id, 'feedback')).toMatchObject([
      { n: 1, head, by: 'relay', facts: 0, findings: 1 },
      { n: 2, head, by: 'human', facts: 0, findings: 1 },
    ])
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
  } finally {
    vi.stubEnv('FAKE_CLAUDE_REVIEW_MS', '')
  }
})

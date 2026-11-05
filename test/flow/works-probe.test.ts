// [흐름] 제출 때 기준 확인(V28): 세션이 시험을 먼저 커밋하고 계약을 내면 앱이 기준에서 예시를 확인한다. 바뀐 동작을 보이지
// 않는 예시(기준에서도 통과)는 invalid(줄과 예시마다 기준의 결과, 영어)로 돌려보내고, 예시를 고친 계약은 승인을 기다리며
// 계약 판(WorkView.probe)이 예시마다 기준 결과를 보인다. 시험은 예시 자료를 읽으므로 계약만 고쳐도 된다. 계약 바꾸기 요청도
// 같다: 지킴 예시가 기준에서 실패하면 invalid이고 상태는 그대로다. 줄 규칙은 [단위] probe.test.ts, 기준 실행은 [흐름] probe.test.ts.
import { expect, test } from 'vitest'
import { repoRoot } from '../../src/adapters/git.ts'
import { repoKey } from '../../src/adapters/store.ts'
import { lockWorktrees } from '../../src/adapters/worktrees.ts'
import { calc } from '../support/calc.ts'
import { makeTempDir, runGit } from '../support/repo.ts'
import { CONTRACT, flowKit, REQUEST, type Entry } from '../support/works-flow.ts'

const kit = flowKit()
const { scenario, mcpResults, until } = kit

// 예시는 앱이 쓴 예시 자료에서 읽는다(제출 때는 커밋돼 있지 않다: 확인이 제출된 계약의 자료를 얹는다)
const PROBE_TESTS = `import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { add, clamp } from '../src/calc.js'

const examples = JSON.parse(
  readFileSync(new URL('../.relay/examples/{contractId}.json', import.meta.url), 'utf8'),
)

test('위로 넘는 값은 hi로 [{contractId}:C1.1]', () => {
  const { input, output } = examples['C1.1']
  assert.equal(clamp(...input), output)
})

test('더하기는 그대로 [{contractId}:C2.1]', () => {
  const { input, output } = examples['C2.1']
  assert.equal(add(...input), output)
})
`

const [C11, C21] = CONTRACT.examples
/** 바뀐 동작을 보이지 않는 예시: 기준(lo를 돌려줌)에서도 통과한다 */
const NO_BUG = { ...CONTRACT, examples: [{ id: 'C1.1', input: [5, 0, 10], output: 5 }, C21] }
/** 지킴 예시가 틀림: 기준에서 실패한다 */
const KEEP_WRONG = { ...CONTRACT, examples: [C11, { id: 'C2.1', input: [2, 3], output: 6 }] }

test('시험을 먼저 커밋한 제출: 기준에서도 통과하는 바뀜 예시는 invalid, 고친 계약은 예시마다 기준 결과와 함께 승인을 기다림. 계약 바꾸기 요청도 같다', async () => {
  await scenario([
    { do: 'commit', message: '시험 먼저', files: { 'test/probe.test.js': PROBE_TESTS } },
    { do: 'mcp', tool: 'submit_contract', args: NO_BUG },
    { do: 'mcp', tool: 'submit_contract', args: CONTRACT },
    { do: 'commit', message: 'clamp 고침', files: { 'src/calc.js': calc('hi') } },
    {
      do: 'mcp',
      tool: 'request_contract_change',
      args: { reason: '더하기 예시', contract: KEEP_WRONG },
    },
    { do: 'stop' },
  ])
  const app = await kit.openApp(await makeTempDir('relay-home-'))
  const { works } = app
  const project = await works.addProject(kit.repo.dir)
  const { id } = await works.createWork({ project: project.id, request: REQUEST })
  const base = (await kit.repo.sha('main')).slice(0, 7)

  await until(() => works.view(id).state === 'awaiting_approval', '고친 계약 제출')
  const [rejected] = await mcpResults('submit_contract')
  expect(rejected).toEqual({
    status: 'invalid',
    errors: [
      expect.stringMatching(
        new RegExp(
          `^relay ran the acceptance command on the base ${base} with the changed test files of head [0-9a-f]{7} and this contract's examples in place\\.`,
        ),
      ),
      `C1 (change): no example fails on the base ${base}, so the tagged tests do not show the changed behavior. On the base: C1.1 passed.`,
    ],
  })

  // 받아들인 제출의 확인: 바뀜 예시는 기준에서 실패(지금 출력), 지킴 예시는 통과
  const v = works.view(id)
  // 확인한 head: 시험만 커밋한 Work 브랜치의 끝(세션은 승인을 기다린다)
  const tested = await runGit(works.record(id).worktree, ['rev-parse', works.view(id).branch])
  expect(v.probe).toMatchObject({ head: tested, ran: true, note: null })
  expect(v.probe?.lines.map((l) => [l.line, l.status])).toEqual([
    ['C1', 'met'],
    ['C2', 'met'],
  ])
  expect(v.probe?.lines[0]?.examples[0]).toMatchObject({ id: 'C1.1', base: 'failed' })
  expect(v.probe?.lines[0]?.examples[0]?.message).toContain('0 !== 10')
  expect(v.probe?.lines[1]?.examples[0]).toEqual({ id: 'C2.1', head: 'passed', base: 'passed' })
  // 돌려보낸 제출에도 초안 예시 자료를 쓴다(세션이 그 파일로 시험을 고친다)
  const events = async (type: string) =>
    (await app.store.readEvents(id)).filter((e: Entry) => e.type === type)
  expect((await events('examples_written')).map((e) => e.kind)).toEqual(['draft', 'draft'])

  // 승인한 계약에도 그 확인을 보인다(같은 계약)
  await works.approveContract(id)
  expect(works.view(id).probe?.ran).toBe(true)

  // 계약 바꾸기 요청: 지킴 예시가 기준에서 실패하면 invalid이고 상태는 그대로다
  await until(async () => (await mcpResults('request_contract_change')).length === 1, '바꾸기 요청')
  const [change] = await mcpResults('request_contract_change')
  expect(change?.status).toBe('invalid')
  const errors = change?.errors as string[]
  expect(errors).toHaveLength(2)
  expect(errors[1]).toMatch(
    new RegExp(
      `^C2 \\(keep\\): an example fails on the base ${base}, so the test checks changed behavior, not kept behavior\\. On the base: C2\\.1 failed: ".*5 !== 6`,
    ),
  )
  expect(works.view(id)).toMatchObject({ state: 'working', pendingContract: null })
  expect(works.view(id).probe?.lines[1]?.status).toBe('met')

  expect((await events('probe')).map((e) => [e.tool, e.ran, e.problems, typeof e.ms])).toEqual([
    ['submit_contract', true, 1, 'number'],
    ['submit_contract', true, 0, 'number'],
    ['request_contract_change', true, 1, 'number'],
  ])
  expect(await events('contract_invalid')).toHaveLength(2)
})

test('확인이 도는 사이 끊긴 제출은 뒤의 제출을 덮지 않는다: 늦게 끝난 확인은 cancelled이고 승인을 기다리는 것은 뒤의 계약이다', async () => {
  await scenario([
    { do: 'commit', message: '시험 먼저', files: { 'test/probe.test.js': PROBE_TESTS } },
    { do: 'stop' },
    { do: 'waitInput' },
  ])
  const app = await kit.openApp(await makeTempDir('relay-home-'))
  const { works } = app
  const project = await works.addProject(kit.repo.dir)
  const { id } = await works.createWork({ project: project.id, request: REQUEST })
  await until(
    async () => (await kit.fake()).some((e) => e.type === 'hook' && e.event === 'Stop'),
    '시험 커밋',
  )
  const rec = works.record(id)
  const fill = (c: object) =>
    JSON.parse(JSON.stringify(c).replaceAll('{contractId}', rec.contract_id)) as Entry
  // 앞 제출(C1)은 태그 시험이 있어 기준 확인이 worktree 잠금을 기다린다(다른 Work의 check가 쓰는 중)
  const release = await lockWorktrees(app.store.home, repoKey(await repoRoot(rec.worktree)), 5_000)
  const first = new AbortController()
  const older = works.onControl(id, 'submit_contract', fill(CONTRACT), first.signal)
  // 사람이 Esc로 그 호출을 끊고, 세션이 태그 시험이 없는 예시로 고친 계약(C2)을 낸다: 확인 없이 승인을 기다린다
  first.abort()
  const revised = fill({
    ...CONTRACT,
    goal: '고친 계약',
    lines: CONTRACT.lines.map((l) => ({ ...l, examples: [`${l.id}.9`] })),
    examples: [
      { id: 'C1.9', input: [20, 0, 10], output: 10 },
      { id: 'C2.9', input: [1, 1], output: 2 },
    ],
  })
  const newer = works.onControl(id, 'submit_contract', revised, new AbortController().signal)
  await until(
    () => works.view(id).pendingContract?.goal === '고친 계약',
    '고친 계약이 승인을 기다림',
  )
  await release()
  expect(await older).toEqual({ status: 'cancelled' })
  expect(works.view(id)).toMatchObject({ state: 'awaiting_approval' })
  expect(works.view(id).pendingContract?.goal).toBe('고친 계약')
  // 뒤의 호출이 그대로 사람의 답을 받는다
  await works.approveContract(id)
  expect(await newer).toMatchObject({ status: 'approved', contract: { goal: '고친 계약' } })
})

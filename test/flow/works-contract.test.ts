// [흐름] 계약 창구(works-contract.ts)의 제출. 제출 때 기준 확인(V28)은 뺐다(V32): 시험을 먼저 커밋하고 기준에서도
// 통과하는 바뀜 예시로 내도 제출은 승인을 기다리고, events에 probe 기록이 없다(그 어긋남은 승인 뒤 증거가 잰다).
// 근거 확인을 기다리는 사이 끊긴 호출과 뒤 호출에 밀린 호출은 상태를 바꾸지 않는다.
import { expect, test } from 'vitest'
import { makeTempDir } from '../support/repo.ts'
import { CONTRACT, flowKit, REQUEST, type Entry } from '../support/works-flow.ts'

const kit = flowKit()
const { scenario, until } = kit

const TAGGED = `import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clamp } from '../src/calc.js'

test('범위 안의 값은 그대로 [{contractId}:C1.1]', () => {
  assert.equal(clamp(5, 0, 10), 5)
})
`

/** 바뀐 동작을 보이지 않는 예시: 기준(lo를 돌려줌)에서도 통과한다 */
const NO_BUG = {
  ...CONTRACT,
  examples: [{ id: 'C1.1', input: [5, 0, 10], output: 5 }, CONTRACT.examples[1]],
}

async function openWork() {
  await scenario([
    { do: 'commit', message: '시험 먼저', files: { 'test/probe.test.js': TAGGED } },
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
  const fill = (c: object) =>
    JSON.parse(JSON.stringify(c).replaceAll('{contractId}', works.record(id).contract_id)) as Entry
  return { app, works, id, fill }
}

test('시험을 먼저 커밋하고 기준에서도 통과하는 바뀜 예시로 내도 제출은 승인을 기다린다: 기준에서 돌리지 않는다(V32)', async () => {
  const { app, works, id, fill } = await openWork()
  const reply = works.onControl(id, 'submit_contract', fill(NO_BUG), new AbortController().signal)
  await until(() => works.view(id).state === 'awaiting_approval', '승인 대기')
  expect('probe' in works.view(id)).toBe(false)
  expect('probe' in works.record(id)).toBe(false)
  const events = await app.store.readEvents(id)
  expect(events.filter((e) => e.type === 'probe')).toEqual([])
  expect(events.filter((e) => e.type === 'contract_invalid')).toEqual([])
  await works.approveContract(id)
  expect(await reply).toMatchObject({ status: 'approved' })
})

test('근거 확인을 기다리는 사이 끊긴 제출은 cancelled, 뒤 제출에 밀린 제출은 superseded이고 승인을 기다리는 것은 마지막 계약이다', async () => {
  const { works, id, fill } = await openWork()
  const first = new AbortController()
  const cancelled = works.onControl(id, 'submit_contract', fill(CONTRACT), first.signal)
  first.abort()
  const older = works.onControl(
    id,
    'submit_contract',
    fill({ ...CONTRACT, goal: '앞 계약' }),
    new AbortController().signal,
  )
  const newer = works.onControl(
    id,
    'submit_contract',
    fill({ ...CONTRACT, goal: '뒤 계약' }),
    new AbortController().signal,
  )
  expect(await cancelled).toEqual({ status: 'cancelled' })
  expect(await older).toMatchObject({ status: 'superseded' })
  await until(() => works.view(id).pendingContract?.goal === '뒤 계약', '뒤 계약이 승인을 기다림')
  expect(works.view(id)).toMatchObject({ state: 'awaiting_approval' })
  await works.approveContract(id)
  expect(await newer).toMatchObject({ status: 'approved', contract: { goal: '뒤 계약' } })
})

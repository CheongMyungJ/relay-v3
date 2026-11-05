// [흐름] 단위 브랜치를 내보내기로 잰다(V22, branch_per_unit). 바탕은 test/support/works-flow.ts.
// 경우: 세션이 Work 브랜치에 모든 단위를 두고 단위마다 <Work 브랜치>--<단위>를 만든다. 쉬면 Work 브랜치를 계약 전체로
// 결정론만 재고(통합 증거, 리뷰 없음), 단위 브랜치마다 계약의 조각으로 재고 미리 리뷰한다(내보내기마다 상한). 선언한 단위
// 브랜치가 없으면 '단위 브랜치 없음'이 [끝내기]의 열린 것이다. [끝내기]는 내보내기마다 장부에 한 줄(export). 단위 브랜치마다
// PR을 열면 그 내보내기만 내보내기로 재고, [머지]도 내보내기마다이고, PR이 모두 머지되면 Work가 끝난다. 관문이 통합 증거와
// Work 전체 diff를 보는 규칙은 [단위](gate-units.test.ts), 실적의 묶음은 ledger.test.ts.
import { expect, test } from 'vitest'
import { contractHash, sliceContract } from '../../src/core/contract.ts'
import type { Contract } from '../../src/core/types.ts'
import { makeTempDir, runGit } from '../support/repo.ts'
import { CONTRACT, flowKit, REQUEST, settled, type Entry } from '../support/works-flow.ts'
import type { TestApp } from '../support/works-app.ts'
import { calc } from '../support/calc.ts'

const kit = flowKit()
const { scenario, until, mcpResults } = kit

const [C1] = CONTRACT.lines
/** 단위 둘(clamp 고침, sub 새로)을 단위 브랜치로 내보내는 계약 */
const PER_UNIT = {
  ...CONTRACT,
  delivery: 'branch_per_unit',
  lines: [
    { ...C1, unit: 'clamp' },
    {
      id: 'C2',
      kind: 'new',
      text: 'sub(a, b)는 a - b',
      grounds: [{ type: 'guess' }],
      examples: ['C2.1'],
      check: 'test',
      unit: 'sub',
    },
  ],
  examples: [
    { id: 'C1.1', input: [15, 0, 10], output: 10 },
    { id: 'C2.1', input: [5, 3], output: 2 },
  ],
}

/** 앱이 쓴 예시 자료를 읽는 태그 시험 하나 */
const tagged = (fn: string, from: string, example: string) => `import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ${fn} } from '../src/${from}.js'
const examples = JSON.parse(
  readFileSync(new URL('../.relay/examples/{contractId}.json', import.meta.url), 'utf8'),
)

test('${fn} [{contractId}:${example}]', () => {
  const { input, output } = examples['${example}']
  assert.equal(${fn}(...input), output)
})
`

/** Work 브랜치(모든 단위): clamp 고침 커밋(예시 자료 포함), sub 커밋. 그리고 clamp 단위 브랜치 */
const WORK_COMMITS = [
  { do: 'mcp', tool: 'submit_contract', args: PER_UNIT },
  {
    do: 'commit',
    message: 'clamp 고침',
    files: { 'src/calc.js': calc('hi'), 'test/clamp.test.js': tagged('clamp', 'calc', 'C1.1') },
  },
  {
    do: 'commit',
    message: 'sub 더함',
    files: {
      'src/sub.js': 'export function sub(a, b) {\n  return a - b\n}\n',
      'test/sub.test.js': tagged('sub', 'sub', 'C2.1'),
    },
  },
  { do: 'bash', command: 'git branch {branch}--clamp HEAD~1' },
]

/** sub 단위 브랜치: 기준에서 sub 커밋을 얹고 예시 자료(Work 브랜치의 것)를 커밋한다 */
const SUB_BRANCH = {
  do: 'bash',
  command:
    'W={branch} && git checkout -q -b $W--sub main && git cherry-pick $W >/dev/null && git checkout $W -- .relay/examples && git commit -qm examples && git checkout -q $W',
}

const tipOf = (app: TestApp, id: string, branch: string) =>
  runGit(app.works.record(id).worktree, ['rev-parse', branch])

async function start(app: TestApp): Promise<{ id: string; branch: string }> {
  const project = await app.works.addProject(kit.repo.dir)
  const w = await app.works.createWork({ project: project.id, request: REQUEST })
  await until(() => app.works.view(w.id).state === 'awaiting_approval', '계약 제출')
  await app.works.approveContract(w.id)
  return w
}

test('단위 브랜치마다 조각으로 재고 미리 리뷰, Work 브랜치는 통합 증거. 없는 단위 브랜치는 [끝내기]의 열린 것, 만들면 한 번에 끝남', async () => {
  await scenario([
    ...WORK_COMMITS,
    { do: 'stop' },
    { do: 'waitInput' },
    SUB_BRANCH,
    { do: 'stop' },
    { do: 'waitInput' },
  ])
  const app = await kit.openApp(await makeTempDir('relay-home-'))
  const { works } = app
  const { id, branch } = await start(app)
  expect(works.record(id).exports.map((x) => [x.unit, x.branch])).toEqual([
    ['clamp', `${branch}--clamp`],
    ['sub', `${branch}--sub`],
  ])

  // 쉬면: 통합 증거(Work 브랜치), clamp 내보내기(조각, 미리 리뷰), sub는 브랜치가 없다
  await until(() => {
    const v = works.view(id)
    return (
      v.exports[0]?.evidence?.review?.status === 'done' &&
      v.exports[1]?.missing === true &&
      settled(v)
    )
  }, '통합 증거, clamp 미리 리뷰, sub 없음')
  await works.idle()
  const head = await tipOf(app, id, branch)
  const clampTip = await tipOf(app, id, `${branch}--clamp`)
  let v = works.view(id)
  const contract = v.contract as Contract
  // 통합 증거: 계약 전체의 줄, 리뷰·관문·PR 없음, 열린 것 없음
  expect(v).toMatchObject({ head, gate: null, pr: null, integration: [] })
  expect(v.evidence).toMatchObject({
    head,
    review: null,
    contract: { hash: contractHash(contract) },
  })
  expect(v.evidence?.lines?.map((l) => [l.line, l.status])).toEqual([
    ['C1', 'met'],
    ['C2', 'met'],
  ])
  // clamp 내보내기: 조각(C1)과 그 계약 파일, 예시 자료는 계약 전체와 같다
  const [clamp, sub] = v.exports
  expect(clamp).toMatchObject({ unit: 'clamp', head: clampTip, missing: false })
  expect(clamp?.evidence?.lines?.map((l) => l.line)).toEqual(['C1'])
  expect(clamp?.evidence?.contract?.hash).toBe(contractHash(sliceContract(contract, 'clamp')))
  expect(clamp?.evidence?.examples_file?.status).toBe('same')
  expect(clamp?.gate?.reasons).not.toContain('리뷰 없음')
  expect(await app.store.readText(id, 'contract.clamp.json')).toContain('"C1"')
  expect(sub).toMatchObject({ unit: 'sub', head: null, missing: true, evidence: null })
  expect(sub?.gate?.decisive).toBe(`단위 브랜치 없음: ${branch}--sub`)
  // 미리 리뷰는 내보내기마다 센다
  expect(works.record(id).exports.map((x) => x.prepared_reviews)).toEqual([1, 0])
  const events = await app.store.readEvents(id)
  expect(
    events
      .filter((e) => e.type === 'evidence')
      .map((e) => [e.integration ?? false, e.unit ?? null]),
  ).toEqual([
    [true, null],
    [false, 'clamp'],
  ])
  expect(events.filter((e: Entry) => e.type === 'review').map((e) => [e.trigger, e.unit])).toEqual([
    ['prepared', 'clamp'],
  ])

  // [끝내기]: clamp는 미리 리뷰를 다시 써서 내보내기로(장부 한 줄), 없는 sub 브랜치는 열린 것이라 상자
  const tips = { [`${branch}--clamp`]: clampTip, [`${branch}--sub`]: null }
  const box = await works.end(id, { head, tips })
  expect(box).toEqual({
    head,
    ended: false,
    armed: false,
    open: [`단위 브랜치 없음: ${branch}--sub`],
  })
  expect(works.view(id).endPending).toMatchObject({ armed: false, tips })
  let ledger = await app.store.readLedger()
  expect(ledger.map((e) => [e.export, e.head])).toEqual([['clamp', clampTip]])

  // [더 고치기] 뒤 세션이 sub 브랜치를 만든다: 그 끝만 새로 재고 미리 리뷰한다
  await works.cancelEnd(id)
  app.sessions.write(id, '단위 브랜치를 만들어 주세요\r')
  await until(() => {
    const x = works.view(id).exports[1]
    return x?.evidence?.review?.status === 'done' && settled(works.view(id))
  }, 'sub 미리 리뷰')
  await works.idle()
  const subTip = await tipOf(app, id, `${branch}--sub`)
  v = works.view(id)
  expect(v.exports[1]).toMatchObject({ head: subTip, missing: false })
  expect(v.exports[1]?.evidence?.lines?.map((l) => l.line)).toEqual(['C2'])
  expect(v.exports[1]?.evidence?.examples_file?.status).toBe('same')
  expect(works.record(id).exports.map((x) => x.prepared_reviews)).toEqual([1, 1])

  // 다시 [끝내기]: 열린 것이 없어 한 번에 끝난다. sub도 장부에 한 줄
  const done = await works.end(id, {
    head,
    tips: { [`${branch}--clamp`]: clampTip, [`${branch}--sub`]: subTip },
  })
  expect(done).toEqual({ head, ended: true, armed: false, open: [] })
  ledger = await app.store.readLedger()
  expect(ledger.map((e) => [e.export, e.head])).toEqual([
    ['clamp', clampTip],
    ['sub', subTip],
  ])
  const reviews = (await app.store.readEvents(id)).filter((e) => e.type === 'review')
  expect(reviews.map((e) => [e.trigger, e.unit, e.reused ?? false])).toEqual([
    ['prepared', 'clamp', false],
    ['end', 'clamp', true],
    ['prepared', 'sub', false],
    ['end', 'sub', true],
  ])
})

test('화면의 단위 브랜치 끝이 지금과 다르면 [끝내기]가 끝내지 않는다. relay_check는 통합 증거와 내보내기마다 답한다', async () => {
  await scenario([
    ...WORK_COMMITS,
    SUB_BRANCH,
    { do: 'stop' },
    { do: 'waitInput' },
    { do: 'mcp', tool: 'relay_check', args: {} },
    { do: 'stop' },
    { do: 'waitInput' },
  ])
  const app = await kit.openApp(await makeTempDir('relay-home-'))
  const { works } = app
  const { id, branch } = await start(app)
  await until(
    () =>
      works.view(id).exports.every((x) => x.evidence?.review?.status === 'done') &&
      settled(works.view(id)),
    '미리 리뷰 둘',
  )
  await works.idle()
  const head = works.view(id).head ?? ''
  await expect(
    works.end(id, {
      head,
      tips: { [`${branch}--clamp`]: 'f'.repeat(40), [`${branch}--sub`]: null },
    }),
  ).rejects.toThrow('단위 브랜치가 바뀜')
  expect(works.view(id).state).toBe('working')

  app.sessions.write(id, '증거를 보세요\r')
  await until(async () => (await mcpResults('relay_check')).length === 1, 'relay_check')
  const [reply] = await mcpResults('relay_check')
  expect(reply).toMatchObject({
    status: 'ok',
    integration: { branch, status: 'ok', head, stale: false },
    exports: [
      { unit: 'clamp', branch: `${branch}--clamp`, status: 'ok' },
      { unit: 'sub', branch: `${branch}--sub`, status: 'ok' },
    ],
  })
  const exports = (reply?.exports ?? []) as Entry[]
  expect(exports.map((x) => (x.lines as Entry[]).map((l) => l.line))).toEqual([['C1'], ['C2']])
})

test('PR은 내보내기마다: 그 단위 브랜치만 내보내기로 재고, [머지]도 내보내기마다, PR이 모두 머지되면 Work가 끝난다', async () => {
  const push = (unit: string) => [
    { do: 'bash', command: `git push -q -u origin {branch}--${unit}` },
    {
      do: 'bash',
      command: `gh pr create --head {branch}--${unit} --base main --title ${unit} --body b`,
    },
  ]
  await scenario([
    ...WORK_COMMITS,
    SUB_BRANCH,
    ...push('clamp'),
    { do: 'stop' },
    { do: 'waitInput' },
    ...push('sub'),
    { do: 'stop' },
    { do: 'waitInput' },
  ])
  const app = await kit.openApp(await makeTempDir('relay-home-'), { prPollMs: 300 })
  const { works } = app
  const { id, branch } = await start(app)
  const clamp = `${branch}--clamp`
  // clamp의 PR: clamp만 내보내기로(장부 한 줄), sub는 미리 리뷰만
  await until(async () => {
    const v = works.view(id)
    return (
      v.exports[0]?.pr?.state === 'OPEN' &&
      works.record(id).exports[0]?.exported_head === v.exports[0]?.head &&
      v.exports[1]?.evidence?.review?.status === 'done' &&
      settled(v)
    )
  }, 'clamp PR 내보내기, sub 미리 리뷰')
  await works.idle()
  let ledger = await app.store.readLedger()
  expect(ledger.map((e) => e.export)).toEqual(['clamp'])
  expect(works.record(id).exports[1]?.exported_head).toBeNull()
  // 단위 없이 [머지]하면 고르라고 한다. clamp를 머지하면 Work는 남는다
  expect(await works.merge(id)).toEqual({ ok: false, error: '단위를 골라 주세요' })
  expect(await works.merge(id, 'clamp')).toEqual({ ok: true })
  expect(works.view(id).state).toBe('working')
  ledger = await app.store.readLedger()
  expect(ledger.at(-1)).toMatchObject({
    export: 'clamp',
    by: 'human',
    merged_head: await tipOf(app, id, clamp),
  })

  // sub의 PR을 열고 머지하면 PR이 모두 머지되어 Work가 끝난다
  app.sessions.write(id, 'sub PR도 열어 주세요\r')
  await until(
    () =>
      works.record(id).exports[1]?.exported_head === works.view(id).exports[1]?.head &&
      settled(works.view(id)),
    'sub PR 내보내기',
  )
  await works.idle()
  expect(await works.merge(id, 'sub')).toEqual({ ok: true })
  expect(works.view(id).state).toBe('done')
  ledger = await app.store.readLedger()
  expect(ledger.filter((e) => e.merged_head).map((e) => e.export)).toEqual(['clamp', 'sub'])
})

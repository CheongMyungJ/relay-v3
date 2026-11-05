// [흐름] 단위 브랜치를 내보내기로 잰다(V22, branch_per_unit). 바탕은 test/support/works-flow.ts.
// 경우: 세션이 Work 브랜치에 모든 단위를 두고 단위마다 <Work 브랜치>--<단위>를 만든다. 쉬면 Work 브랜치를 계약 전체로
// 결정론만 재고(통합 증거, 리뷰 없음), 단위 브랜치마다 계약의 조각으로 재고 미리 리뷰한다(내보내기마다 상한). 선언한 단위
// 브랜치가 없으면 '단위 브랜치 없음'이 [끝내기]의 열린 것이다. [끝내기]는 내보내기마다 장부에 한 줄(export). 단위 브랜치마다
// PR을 열면 그 내보내기만 내보내기로 재고, [머지]도 내보내기마다이고, PR이 모두 머지되면 Work가 끝난다. 관문이 통합 증거와
// Work 전체 diff를 보는 규칙은 [단위](gate-units.test.ts), 실적의 묶음은 ledger.test.ts.
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { contractHash, sliceContract } from '../../src/core/contract.ts'
import type { Contract } from '../../src/core/types.ts'
import { makeTempDir, runGit } from '../support/repo.ts'
import { passByExport } from '../../src/renderer/src/exports.ts'
import {
  CONTRACT,
  flowKit,
  RAISED_FINDINGS,
  REQUEST,
  settled,
  type Entry,
} from '../support/works-flow.ts'
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
  // clamp의 리뷰어는 승인된 계약 전체(다른 단위 sub의 줄도)와 자기가 볼 줄을 받는다(V30): 다른 단위가 다루는 것만 빈틈이 아니다
  const [asked] = (await kit.fake()).filter((e) => e.type === 'review')
  const prompt = String(asked?.prompt)
  expect(prompt).toContain('sub(a, b)는 a - b')
  expect(prompt).toContain(
    'it must meet the lines of unit "clamp" and the lines without a unit (C1)',
  )
  expect(prompt).toContain(
    'The lines of the other units (C2 of sub) are delivered on their own branches',
  )
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

test('PR은 내보내기마다: 그 단위 브랜치만 내보내기로 재고, [머지]도 내보내기마다, PR이 모두 머지되면 Work가 끝난다. 머지된 내보내기의 올림은 넘길 것이 아니다', async () => {
  // 리뷰는 계약 밖 변경(사람 몫)을 올린다: [머지]는 사람이 그래도 한다
  await kit.review(RAISED_FINDINGS)
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
  expect(passByExport(works.view(id)).map((x) => x.unit)).toEqual(['clamp', 'sub'])
  expect(await works.merge(id, 'clamp')).toEqual({ ok: true })
  expect(works.view(id).state).toBe('working')
  // 머지된 clamp의 올림은 [끝내기] 상자와 [증거]의 [세션에 넘기기]에 없다(메인도 받지 않는다)
  expect(works.view(id).exports[0]?.feedback.findings).toEqual({})
  expect(passByExport(works.view(id)).map((x) => x.unit)).toEqual(['sub'])
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

/** Work 브랜치에만 실패하는 시험을 더한다(통합 증거의 명령이 실패한다) */
const BROKEN_TEST = `import { test } from 'node:test'
test('깨짐', () => {
  throw new Error('깨짐')
})
`

test('앱을 다시 켠 뒤 통합 증거가 바뀌어도 다시 재지 않은 내보내기의 관문을 다시 계산한다(정책은 다시 만든다)', async () => {
  await scenario([...WORK_COMMITS, SUB_BRANCH, { do: 'stop' }, { do: 'waitInput' }])
  const home = await makeTempDir('relay-home-')
  const first = await kit.openApp(home)
  const { id, branch } = await start(first)
  await until(
    () =>
      first.works.view(id).exports.every((x) => x.evidence?.review?.status === 'done') &&
      settled(first.works.view(id)),
    '미리 리뷰 둘',
  )
  await first.works.idle()
  expect(first.works.view(id).exports[0]?.gate?.reasons.join('\n')).not.toContain('통합 증거')
  await first.close()
  kit.forget(first)

  // 앱이 닫힌 사이 Work 브랜치에만 실패하는 시험이 더해진다. 다시 켜고 세션이 쉬면 통합 증거만 새로 잰다
  const worktree = first.works.record(id).worktree
  await writeFile(join(worktree, 'test/broken.test.js'), BROKEN_TEST)
  await runGit(worktree, ['add', '-A'])
  await runGit(worktree, [
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@relay.invalid',
    'commit',
    '-qm',
    '깨짐',
  ])
  const head = await runGit(worktree, ['rev-parse', branch])
  const second = await kit.openApp(home)
  const { works } = second
  await works.onHook(id, 'Stop', {})
  await until(
    () => works.view(id).evidence?.head === head && settled(works.view(id)),
    '새 통합 증거',
  )
  await works.idle()
  expect(works.view(id).integration?.join('\n')).toContain('명령 실패')
  for (const x of works.view(id).exports) expect(x.gate?.decisive).toMatch(/^통합 증거: /)
})

test("리뷰 범위 'auto_only': 통합 증거가 열려 건너뛴 내보내기 리뷰는 Work 브랜치만 고쳐 통합 증거가 깨끗해지면 다시 정한다", async () => {
  await scenario([
    ...WORK_COMMITS,
    SUB_BRANCH,
    { do: 'commit', message: '깨짐', files: { 'test/broken.test.js': BROKEN_TEST } },
    { do: 'bash', command: 'git push -q -u origin {branch}--clamp' },
    { do: 'bash', command: 'gh pr create --head {branch}--clamp --base main --title c --body b' },
    { do: 'stop' },
    { do: 'waitInput' },
    { do: 'bash', command: 'git rm -q test/broken.test.js && git commit -qm 고침' },
    { do: 'stop' },
    { do: 'waitInput' },
  ])
  const app = await kit.openApp(await makeTempDir('relay-home-'))
  const { works } = app
  const project = await works.addProject(kit.repo.dir)
  await works.updateSettings(project.id, { review: 'auto_only' })
  const { id, branch } = await works.createWork({ project: project.id, request: REQUEST })
  await until(() => works.view(id).state === 'awaiting_approval', '계약 제출')
  await works.approveContract(id)
  // clamp의 PR: 통합 증거의 명령이 실패해 자동 조건을 못 채우니 리뷰를 건너뛴다
  await until(
    () =>
      works.view(id).exports[0]?.evidence?.review?.status === 'skipped' &&
      works.record(id).exports[0]?.exported_head === works.view(id).exports[0]?.head &&
      settled(works.view(id)),
    'clamp 내보내기(리뷰 건너뜀)',
  )
  await works.idle()
  expect(works.view(id).integration?.join('\n')).toContain('명령 실패')

  // 쉬는 세션이 되먹임(V24, 통합 증거의 실패한 명령)을 받고 Work 브랜치만 고친다: clamp 브랜치는 그대로인데 이제 리뷰가
  // 필요하다
  await until(
    async () =>
      (await kit.fake()).some((e) => e.type === 'bash' && String(e.command).startsWith('git rm')),
    'Work 브랜치 고침',
  )
  const head = await tipOf(app, id, branch)
  await until(
    () => works.view(id).evidence?.head === head && settled(works.view(id)),
    '새 통합 증거',
  )
  await works.idle()
  const [clamp] = works.view(id).exports
  expect(works.view(id).integration).toEqual([])
  expect(clamp?.evidence?.review).toMatchObject({ status: 'done', request: true })
  expect(clamp?.gate?.reasons).not.toContain('리뷰를 건너뜀')
})

test('되먹임(V24): 내보내기의 사람 몫 올림(request_gap)이 남았으면 통합 증거의 세션 몫 사실도 저절로 보내지 않는다', async () => {
  await kit.review([
    { severity: 'low', raise: 'request_gap', text: '요청의 다른 경로를 다루지 않음' },
  ])
  await scenario([
    ...WORK_COMMITS,
    SUB_BRANCH,
    { do: 'commit', message: '깨짐', files: { 'test/broken.test.js': BROKEN_TEST } },
    { do: 'stop' },
    { do: 'waitInput' },
  ])
  const app = await kit.openApp(await makeTempDir('relay-home-'))
  const { works } = app
  const { id } = await start(app)
  await until(
    () =>
      works.view(id).exports.every((x) => x.evidence?.review?.status === 'done') &&
      settled(works.view(id)),
    '미리 리뷰 둘',
  )
  await works.idle()
  await until(
    async () => (await app.store.readEvents(id)).some((e) => String(e.type).startsWith('feedback')),
    '되먹임 결정',
  )
  const events = (await app.store.readEvents(id)).filter((e) =>
    String(e.type).startsWith('feedback'),
  )
  expect(events.map((e) => [e.type, e.reason])).toEqual([['feedback_held', 'human_findings']])
  // 화면(통합 칸)도 같은 까닭을 보인다
  expect(works.view(id).feedback.held).toBe('human_findings')
})

test('단위 브랜치에만 있는 커밋(Work 브랜치에 없음)은 통합 증거의 열린 것이다: 모든 내보내기가 사람 머지이고 [끝내기] 상자에 보인다. 옮겨 심은 단위 브랜치는 Work 브랜치에 있다', async () => {
  await scenario([
    ...WORK_COMMITS,
    SUB_BRANCH,
    // clamp의 고침을 단위 브랜치에만 커밋한다
    {
      do: 'bash',
      command:
        'W={branch} && git checkout -q $W--clamp && echo "clamp 고침" > NOTE.txt && git add NOTE.txt && git commit -qm 고침 && git checkout -q $W',
    },
    { do: 'mcp', tool: 'relay_check', args: {} },
    { do: 'stop' },
    { do: 'waitInput' },
  ])
  const app = await kit.openApp(await makeTempDir('relay-home-'))
  const { works } = app
  const { id, branch } = await start(app)
  const clamp = `${branch}--clamp`
  const fact = `단위 브랜치의 커밋이 Work 브랜치에 없음: ${clamp}`
  await until(async () => (await mcpResults('relay_check')).length === 1, 'relay_check')
  const [reply] = await mcpResults('relay_check')
  expect(reply?.integration).toMatchObject({ status: 'ok', not_on_work_branch: [clamp] })
  await until(
    () =>
      works.view(id).exports.every((x) => x.evidence?.review?.status === 'done') &&
      settled(works.view(id)),
    '통합 증거와 미리 리뷰 둘',
  )
  await works.idle()
  const v = works.view(id)
  expect(v.integration).toEqual([fact])
  for (const x of v.exports) expect(x.gate?.reasons).toContain(`통합 증거: ${fact}`)
  const tips = Object.fromEntries(v.exports.map((x) => [x.branch, x.head]))
  const box = await works.end(id, { head: v.head ?? '', tips })
  expect(box.open).toContain(`통합 증거: ${fact}`)
  expect(box.open.join('\n')).not.toContain(`${branch}--sub`)
})

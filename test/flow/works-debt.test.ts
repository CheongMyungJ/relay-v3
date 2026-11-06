// [흐름] 받아들인 나빠짐의 빚 기록(M3b, V40): [빚으로 남기고 머지](Work 브랜치에 relay가 커밋하고 push한 뒤 그 head로 머지,
// 다시 재지 않음), [그래도 끝내기]의 빚과 [그냥 끝내기](장부의 받아들였지만 기록하지 않음), 앱 밖에서 머지된 나빠짐이 다음
// Work의 request.md와 [계약]에 '기록 안 된 나빠짐'으로, RELAY_M3=off는 M2.2 그대로(커밋도 알림도 없음). 바탕은
// test/support/works-flow.ts. 확인의 글과 묻는 때는 [단위] renderer-debt.test.ts, 커밋은 [어댑터] git-write.test.ts.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { UNRECORDED_TITLE } from '../../src/engine/debt-record.ts'
import { debtAsk } from '../../src/renderer/src/debt.ts'
import { makeTempDir, runGit } from '../support/repo.ts'
import type { TestApp } from '../support/works-app.ts'
import {
  CONTRACT,
  type Entry,
  FIX_COMMIT,
  flowKit,
  PUSH_AND_PR,
  REQUEST,
  settled,
} from '../support/works-flow.ts'

const kit = flowKit()
const { scenario, until } = kit

const SUBMIT = { do: 'mcp', tool: 'submit_contract', args: CONTRACT }
const DEBT_ID = 'r-file-size-src-big-js'
const DEBT_FILE = `.relay/debt/${DEBT_ID}.md`

/** 고침과 함께 600줄을 넘는 새 파일: 래칫 file-size가 나빠진다 */
const BIG_COMMIT = {
  ...FIX_COMMIT,
  files: { ...FIX_COMMIT.files, 'src/big.js': 'export const x = 1\n'.repeat(700) },
}

const exportsOf = async (app: TestApp, id: string) =>
  (await app.store.readEvents(id)).filter((e) => e.type === 'evidence').map((e) => e.export)

/** 프로젝트를 더하고 Work를 만들어 계약을 승인한다 */
async function startWork(app: TestApp): Promise<string> {
  const { works } = app
  const project = await works.addProject(kit.repo.dir)
  const { id } = await works.createWork({ project: project.id, request: REQUEST })
  await until(() => works.view(id).state === 'awaiting_approval', '계약 제출')
  await works.approveContract(id)
  return id
}

/** PR 내보내기로 잰 증거(래칫 나빠짐, 사람 머지) */
async function exported(app: TestApp, id: string): Promise<string> {
  const { works } = app
  await until(
    () =>
      works.find(id)?.exports[0]?.exported_head === works.view(id).head && settled(works.view(id)),
    'PR의 내보내기 증거',
  )
  await works.idle()
  return works.view(id).head ?? ''
}

/** [끝내기]의 상자까지 */
async function boxed(app: TestApp, id: string): Promise<string> {
  const { works } = app
  await until(() => works.view(id).evidence !== null && settled(works.view(id)), '첫 증거')
  const head = works.view(id).head ?? ''
  await works.end(id, { head })
  await until(() => works.view(id).endPending?.armed === false, '상자')
  return head
}

const git = (cwd: string, ...args: string[]) => runGit(cwd, args)

test('[빚으로 남기고 머지]: relay가 Work 브랜치에 빚을 커밋하고 push한 뒤 그 head로 머지한다. 다시 재지 않는다', async () => {
  await scenario([SUBMIT, BIG_COMMIT, ...PUSH_AND_PR, { do: 'stop' }])
  const app = await kit.openApp(await makeTempDir('relay-home-'))
  const { works } = app
  const id = await startWork(app)
  const head = await exported(app, id)
  const v = works.view(id)
  expect(v.m3).toEqual({ knowledge: true, debt: true, tidy: true, promote: true })
  expect(v.gate?.reasons).toContainEqual(expect.stringMatching(/^래칫 나빠짐: file-size/))
  const measured = await exportsOf(app, id)

  expect(await works.merge(id, undefined, { debt: true })).toEqual({ ok: true })
  const rec = works.record(id)
  const after = works.view(id)
  expect(after.state).toBe('done')
  const sha = after.head ?? ''
  expect(sha).not.toBe(head)
  // 묶음은 빚 커밋으로 옮겼다(다시 재지 않음). 관문은 그대로 사람 머지
  expect(after.evidence).toMatchObject({ head: sha, debt_commit: { from: head, items: [DEBT_ID] } })
  expect(await exportsOf(app, id)).toEqual(measured)
  // 커밋: 부모는 잰 head, .relay/debt/만, 작성자 relay, 트레일러. origin에 push됐고 worktree는 깨끗하다
  const repo = rec.worktree
  expect(await git(repo, 'rev-parse', `${sha}^`)).toBe(head)
  expect(await git(repo, 'diff-tree', '--no-commit-id', '--name-only', '-r', sha)).toBe(DEBT_FILE)
  expect(await git(repo, 'log', '-1', '--format=%an', sha)).toBe('relay')
  const trailers = await git(repo, 'log', '-1', '--format=%(trailers:only,unfold)', sha)
  expect(trailers.split('\n')).toEqual([`Relay-Work: ${id}`, `Relay-Debt: ${DEBT_ID}`])
  expect(await git(repo, 'ls-remote', 'origin', `refs/heads/${rec.branch}`)).toContain(sha)
  expect(await git(repo, 'status', '--porcelain')).toBe('')
  const item = await readFile(join(repo, DEBT_FILE), 'utf8')
  expect(item).toContain('kind: accepted_regression')
  expect(item).toContain(`source: ${v.pr?.url ?? ''}`)
  // 장부: 그 head의 결론 줄에 나빠진 래칫, 머지 줄에 받아들인 래칫과 기록한 빚
  const ledger = (await app.store.readLedger()).filter((e) => e.work === id)
  expect(ledger.find((e) => e.head === head)?.worse?.map((r) => r.id)).toEqual(['file-size'])
  expect(ledger.at(-1)).toMatchObject({
    by: 'human',
    merged_head: sha,
    accepted: { ratchets: ['file-size'], debt: [DEBT_ID] },
  })
  const events = await app.store.readEvents(id)
  expect(events.find((e) => e.type === 'debt_recorded')).toMatchObject({
    from: head,
    head: sha,
    items: [DEBT_ID],
    push: true,
  })
  const gh = (await readFile(kit.ghLog, 'utf8'))
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l))
  const merge = gh.findLast((c: { args: string[] }) => c.args[1] === 'merge') as { args: string[] }
  expect(merge.args).toContain(sha)
  expect(works.list().projects[0]?.unrecordedDebt).toBe(0)
})

test('CI가 실패한 PR에는 빚을 커밋하지 않는다. 기록한 뒤 다시 재도 다시 묻거나 또 적지 않는다', async () => {
  await scenario([SUBMIT, BIG_COMMIT, ...PUSH_AND_PR, { do: 'stop' }])
  const app = await kit.openApp(await makeTempDir('relay-home-'))
  const { works } = app
  const id = await startWork(app)
  const head = await exported(app, id)
  const pr = works.view(id).pr?.number
  const ci = (state: string) => [{ __typename: 'StatusContext', context: 'ci', state }]
  const setPr = (fields: Entry) =>
    kit.gh((state) => {
      Object.assign(state.prs?.find((p) => p.number === pr) ?? {}, fields)
    })
  const recorded = async () =>
    (await app.store.readEvents(id)).filter((e) => e.type === 'debt_recorded')

  // 머지가 실패할 것이 보이면 사람의 브랜치에 relay가 커밋하지 않는다
  await setPr({ statusCheckRollup: ci('FAILURE') })
  expect(await works.merge(id, undefined, { debt: true })).toEqual({
    ok: false,
    error: 'CI 실패 (ci)',
  })
  expect(works.view(id).head).toBe(head)
  expect(await recorded()).toEqual([])

  // 기록하고 push하면 CI가 다시 돈다: 머지는 기다린다
  await setPr({ statusCheckRollup: ci('PENDING') })
  const wait = await works.merge(id, undefined, { debt: true })
  expect(wait).toMatchObject({ ok: false, error: expect.stringMatching(/^CI가 아직 돎/) })
  const sha = works.view(id).head ?? ''
  expect(sha).not.toBe(head)
  expect(await recorded()).toHaveLength(1)

  // [증거 다시 재기]: 새 묶음은 빚 커밋으로 옮긴 것이 아니지만 이 diff의 빚이 나빠짐을 덮는다
  await works.runEvidence(id, { exportCandidate: true })
  await until(() => {
    const e = works.view(id).evidence
    return e?.head === sha && !e.debt_commit && settled(works.view(id))
  }, '다시 잰 증거')
  const again = works.view(id)
  expect(again.evidence?.debt_covered).toEqual({ ratchets: ['file-size'], items: [DEBT_ID] })
  expect(debtAsk(again)).toBeNull()
  await setPr({ statusCheckRollup: ci('SUCCESS') })
  expect(await works.merge(id, undefined, { debt: true })).toEqual({ ok: true })
  expect(await recorded()).toHaveLength(1)
  const tree = await git(works.record(id).worktree, 'ls-tree', '-r', '--name-only', sha)
  expect(tree.split('\n').filter((p) => p.startsWith('.relay/debt/'))).toEqual([DEBT_FILE])
  expect((await app.store.readLedger()).at(-1)).toMatchObject({
    by: 'human',
    merged_head: sha,
    accepted: { ratchets: ['file-size'], debt: [DEBT_ID] },
  })
  expect(works.list().projects[0]?.unrecordedDebt).toBe(0)
})

test('[빚으로 남기고 끝내기]의 push가 실패하면 끝나지 않고, 다시 끝낼 때 push한 뒤 끝낸다', async () => {
  await scenario([SUBMIT, BIG_COMMIT, ...PUSH_AND_PR, { do: 'stop' }])
  const app = await kit.openApp(await makeTempDir('relay-home-'))
  const { works } = app
  const id = await startWork(app)
  const head = await exported(app, id)
  const rec = works.record(id)
  const origin = await git(rec.worktree, 'remote', 'get-url', 'origin')
  await git(rec.worktree, 'remote', 'set-url', 'origin', join(origin, 'gone'))
  await works.end(id, { head })
  await until(() => works.view(id).endPending?.armed === false, '상자')
  await expect(works.end(id, { head, force: true, debt: true })).rejects.toThrow(
    /빚 커밋을 push하지 못함/,
  )
  expect(works.view(id).state).toBe('working')
  const sha = works.view(id).head ?? ''
  expect(sha).not.toBe(head)
  expect(await git(rec.worktree, 'ls-remote', origin, `refs/heads/${rec.branch}`)).toContain(head)

  await git(rec.worktree, 'remote', 'set-url', 'origin', origin)
  expect(await works.end(id, { head: sha, force: true })).toMatchObject({ head: sha, ended: true })
  expect(await git(rec.worktree, 'ls-remote', 'origin', `refs/heads/${rec.branch}`)).toContain(sha)
})

test('[그래도 끝내기]의 빚과 [그냥 끝내기]: 빚은 Work 브랜치에, 그냥은 장부의 받아들였지만 기록하지 않음', async () => {
  const app = await kit.openApp(await makeTempDir('relay-home-'))
  const { works } = app

  await scenario([SUBMIT, BIG_COMMIT, { do: 'stop' }])
  const a = await startWork(app)
  const head = await boxed(app, a)
  expect(works.view(a).endPending?.open).toContainEqual(expect.stringMatching(/^래칫 나빠짐/))
  const r = await works.end(a, { head, force: true, debt: true })
  expect(r).toMatchObject({ ended: true })
  const sha = r.head ?? ''
  expect(sha).not.toBe(head)
  const rec = works.record(a)
  expect(rec.state).toBe('done')
  expect(await git(rec.worktree, 'rev-parse', `refs/heads/${rec.branch}`)).toBe(sha)
  expect(await git(rec.worktree, 'show', `${sha}:${DEBT_FILE}`)).toContain('accepted_regression')
  // PR이 없으면 push하지 않는다
  const recorded = (await app.store.readEvents(a)).find((e) => e.type === 'debt_recorded')
  expect(recorded).toMatchObject({ push: false })
  const ended = (await app.store.readEvents(a)).find((e) => e.type === 'ended')
  expect(ended).toMatchObject({ how: 'box', head: sha })

  await scenario([SUBMIT, BIG_COMMIT, { do: 'stop' }])
  const b = await startWork(app)
  const head2 = await boxed(app, b)
  expect(await works.end(b, { head: head2, force: true })).toMatchObject({
    head: head2,
    ended: true,
  })
  expect((await app.store.readEvents(b)).some((e) => e.type === 'debt_recorded')).toBe(false)
  const ledger = await app.store.readLedger()
  expect(ledger.filter((e) => e.accepted).map((e) => [e.work, e.accepted?.debt])).toEqual([
    [a, [DEBT_ID]],
    [b, []],
  ])
  await until(() => works.list().projects[0]?.unrecordedDebt === 1, '받아들였지만 기록하지 않음')
})

test('앱 밖에서 머지된 나빠짐은 다음 Work의 request.md와 [계약]에 알린다. RELAY_M3=off는 묻지도 기록하지도 알리지도 않는다', async () => {
  const home = await makeTempDir('relay-home-')
  const app = await kit.openApp(home, { prPollMs: 200 })
  const { works } = app
  await scenario([SUBMIT, BIG_COMMIT, ...PUSH_AND_PR, { do: 'stop' }])
  const a = await startWork(app)
  const head = await exported(app, a)
  const pr = works.view(a).pr?.number
  await kit.gh((state) => {
    Object.assign(state.prs?.find((p) => p.number === pr) ?? {}, { state: 'MERGED' })
  })
  await until(() => works.view(a).state === 'done', '앱 밖 머지')
  const ledger = (await app.store.readLedger()).filter((e) => e.work === a)
  expect(ledger.at(-1)).toMatchObject({
    by: 'human-override',
    merged_head: head,
    accepted: { ratchets: ['file-size'], debt: [] },
  })

  await scenario([SUBMIT, { do: 'waitInput' }])
  const project = works.list().projects[0]?.id ?? ''
  const { id: b } = await works.createWork({ project, request: REQUEST })
  const line = 'file-size: src/big.js 없음 → 700 (앱 밖에서 머지됨)'
  expect(works.view(b).unrecorded).toEqual([line])
  const request = (await app.store.readText(b, 'request.md')) ?? ''
  expect(request).toContain(`\n${UNRECORDED_TITLE}\n`)
  expect(request.endsWith(`- ${line}\n`)).toBe(true)
  await app.close()
  kit.forget(app)

  // 끈 쪽(relay3-m2): 같은 장부에서도 알리지 않고, [그래도 끝내기]의 debt도 커밋하지 않는다
  const off = await kit.openApp(home, { m3: 'off' })
  await scenario([SUBMIT, BIG_COMMIT, { do: 'stop' }])
  const c = await startWork(off)
  expect(off.works.view(c)).toMatchObject({ m3: { debt: false }, unrecorded: [] })
  expect((await off.store.readText(c, 'request.md')) ?? '').not.toContain(UNRECORDED_TITLE)
  const head3 = await boxed(off, c)
  expect(await off.works.end(c, { head: head3, force: true, debt: true })).toMatchObject({
    head: head3,
    ended: true,
  })
  expect((await off.store.readEvents(c)).some((e) => e.type === 'debt_recorded')).toBe(false)
  expect((await off.store.readLedger()).at(-1)).toMatchObject({
    work: c,
    accepted: { ratchets: ['file-size'], debt: [] },
  })
})

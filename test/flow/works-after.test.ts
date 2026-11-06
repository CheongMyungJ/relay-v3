// [흐름] 머지 뒤 30일(M4d, docs/m4-design.md 6절, src/main/works-after.ts): Work가 끝난 뒤 GitHub에서 merge 머지된 PR의 머지 커밋에
// 귀속되는 main 실패(부모 통과, 다시 시도도 실패)와 git revert -m 1의 되돌림, squash 머지의 미정(다시 시도 없음)과 제목 되돌림,
// 필수 검사가 없는 레포의 잴 수 없음. 창 안에서는 처음 본 사건만, 가짜 시계로 30일이 지나면 닫힌 줄 하나를 쓰고 그 뒤로는 보지
// 않는다. 앱은 CI를 다시 돌리지 않고(gh 기록에 rerun 없음) 사용자 레포의 ref를 바꾸지 않는다. 바탕은 test/support/works-flow.ts.
import { cp, readFile, writeFile } from 'node:fs/promises'
import { expect, test } from 'vitest'
import type { AfterLine } from '../../src/engine/after-merge.ts'
import { trackRecord } from '../../src/engine/shadow.ts'
import { RecordDesk } from '../../src/main/works-stats.ts'
import { makeTempDir } from '../support/repo.ts'
import type { TestApp } from '../support/works-app.ts'
import {
  CONTRACT,
  FIX_COMMIT,
  flowEpoch,
  flowKit,
  PUSH_AND_PR,
  REQUEST,
  settled,
  type Entry,
} from '../support/works-flow.ts'

const kit = flowKit()
const { scenario, until } = kit

const SUBMIT = { do: 'mcp', tool: 'submit_contract', args: CONTRACT }
const DAY = 24 * 60 * 60 * 1000
const CI = { name: 'ci', path: '.github/workflows/ci.yml', event: 'push', status: 'completed' }

/** 프로젝트를 더하고 PR을 연 Work를 리뷰까지 기다린 뒤 [끝내기]로 끝낸다(PR은 열린 채 남는다) */
async function endedWork(
  app: TestApp,
): Promise<{ id: string; project: string; pr: number; branch: string; head: string }> {
  const { works } = app
  const project = (await works.addProject(kit.repo.dir)).id
  const { id } = await works.createWork({ project, request: REQUEST })
  await until(() => works.view(id).state === 'awaiting_approval', '계약 제출')
  await works.approveContract(id)
  await until(
    () =>
      works.view(id).evidence?.review?.status === 'done' &&
      works.find(id)?.exports[0]?.exported_head === works.view(id).head &&
      settled(works.view(id)),
    '리뷰가 끝난 PR의 증거',
  )
  await works.idle()
  const head = works.view(id).head ?? ''
  await works.end(id, { head })
  await until(() => works.view(id).state === 'done', '끝남')
  await works.idle()
  return {
    id,
    project,
    pr: works.view(id).pr?.number ?? 0,
    branch: works.find(id)?.branch ?? '',
    head,
  }
}

/** 가짜 gh에서 PR을 머지됨으로 */
async function merged(pr: number, o: { head: string; at: string; commit: string }): Promise<void> {
  await kit.gh((state) => {
    const target = state.prs?.find((p) => p.number === pr)
    if (target)
      Object.assign(target, {
        state: 'MERGED',
        headRefOid: o.head,
        mergedAt: o.at,
        mergeCommit: { oid: o.commit },
      })
  })
}

const afterLines = async (app: TestApp, work: string): Promise<AfterLine[]> =>
  (await app.store.readRecord()).after.filter((a) => a.work === work)

const ghCalls = async () =>
  (await readFile(kit.ghLog, 'utf8').catch(() => ''))
    .split('\n')
    .filter(Boolean)
    .map((l) => (JSON.parse(l) as { args: string[] }).args)

const userRefs = () => kit.repo.git('for-each-ref', '--format=%(refname) %(objectname)')

test('merge 머지: 머지 커밋의 main 실패가 부모 통과·다시 시도도 실패면 귀속, git revert -m 1은 되돌림, 30일 뒤 닫힘', async () => {
  await scenario([SUBMIT, FIX_COMMIT, ...PUSH_AND_PR, { do: 'stop' }])
  let clock: number | null = null
  const app = await kit.openApp(await makeTempDir('relay-home-'), {
    recordNow: () => new Date(clock ?? Date.now()).toISOString(),
  })
  const { id, project, pr, branch, head } = await endedWork(app)

  // GitHub: merge 머지. 서버 보호에 필수 검사가 있고, 머지 커밋의 ci는 다시 시도해도 실패, 부모는 통과
  const { g } = await kit.github()
  const parent = await g('rev-parse', 'origin/main')
  await g('merge', '--quiet', '--no-ff', '--no-edit', `origin/${branch}`)
  const m = await g('rev-parse', 'HEAD')
  await g('push', '--quiet', 'origin', 'main')
  const at = new Date(Date.now() - 60_000).toISOString()
  await merged(pr, { head, at, commit: m })
  await kit.gh((state) => {
    state.branches = {
      main: {
        protected: true,
        protection: { required_status_checks: { contexts: ['ci'], enforcement_level: 'everyone' } },
      },
    }
    state.runs = [
      { ...CI, head_sha: m, conclusion: 'failure', run_attempt: 2 },
      { ...CI, head_sha: parent, conclusion: 'success', run_attempt: 1 },
    ]
  })

  const before = await userRefs()
  await app.record.follow(project)
  const first = await afterLines(app, id)
  expect(first).toEqual([
    expect.objectContaining({
      merge_commit: m,
      merged_at: at,
      closed: false,
      revert: null,
      main: 'attributed',
      main_run: { name: 'ci', sha: m, attempts: 2 },
    }),
  ])
  // 같은 사건은 다시 쓰지 않는다
  await app.record.follow(project)
  expect(await afterLines(app, id)).toHaveLength(1)

  // 사람이 머지 커밋을 되돌린다
  await g('revert', '--no-edit', '-m', '1', m)
  const revert = await g('rev-parse', 'HEAD')
  await g('push', '--quiet', 'origin', 'main')
  await app.record.follow(project)
  expect((await afterLines(app, id)).at(-1)).toMatchObject({
    closed: false,
    revert: { sha: revert, form: 'this_reverts' },
    main: 'attributed',
  })
  const r = await app.store.readRecord()
  expect(trackRecord(r.entries, project, 0, flowEpoch())).toEqual({ small: true })
  expect(trackRecord(r.entries, project, 0, flowEpoch(), r)).toEqual({ small: false })
  // [실적]의 셈과 [귀속이 틀림]
  const desk = new RecordDesk({ store: app.store, now: () => new Date().toISOString() })
  const stats = await desk.record(project, false)
  expect(stats.conditions.find((c) => c.id === 'small')?.after).toMatchObject({
    merges: 1,
    watching: 1,
    reverts: 1,
    main: { attributed: 1 },
  })
  await desk.dispute(project, m, 'main')
  await desk.dispute(project, m, 'main')
  expect((await app.store.readRecord()).disputes).toHaveLength(1)
  await expect(desk.dispute(project, 'f'.repeat(40), 'revert')).rejects.toThrow(
    '귀속된 사건이 없음',
  )

  // 30일이 지나면 닫힌 줄 하나, 그 뒤로는 보지 않는다
  clock = Date.parse(at) + 31 * DAY
  await app.record.follow(project)
  await app.record.follow(project)
  const lines = await afterLines(app, id)
  expect(lines.map((a) => a.closed)).toEqual([false, false, true])
  expect(lines.at(-1)).toMatchObject({
    window_end: new Date(Date.parse(at) + 30 * DAY).toISOString(),
  })
  // CI를 다시 돌리지 않고 사용자 레포의 ref를 바꾸지 않는다
  const calls = await ghCalls()
  expect(calls.some((a) => a[0] === 'api' && a[1]?.includes('/actions/runs?head_sha='))).toBe(true)
  expect(calls.some((a) => a.includes('rerun') || a.some((x) => x.includes('rerun')))).toBe(false)
  expect(await userRefs()).toBe(before)
})

test('squash 머지: 다시 시도 없는 실패는 미정, 제목 되돌림(Revert "<squash 제목>"). 필수 검사가 없으면 잴 수 없음', async () => {
  await scenario([SUBMIT, FIX_COMMIT, ...PUSH_AND_PR, { do: 'stop' }])
  let clock: number | null = null
  const app = await kit.openApp(await makeTempDir('relay-home-'), {
    recordNow: () => new Date(clock ?? Date.now()).toISOString(),
  })
  const { id, project, pr, branch, head } = await endedWork(app)

  const { g } = await kit.github()
  const parent = await g('rev-parse', 'origin/main')
  await g('merge', '--quiet', '--squash', `origin/${branch}`)
  await g('commit', '--quiet', '--no-verify', '-m', `clamp 고침 (#${pr})`)
  const s = await g('rev-parse', 'HEAD')
  await g('push', '--quiet', 'origin', 'main')
  const at = new Date(Date.now() - 60_000).toISOString()
  await merged(pr, { head, at, commit: s })
  await kit.gh((state: Entry) => {
    state.branches = {
      main: {
        protected: true,
        protection: { required_status_checks: { contexts: ['ci'], enforcement_level: 'everyone' } },
      },
    }
    state.runs = [
      { ...CI, head_sha: s, conclusion: 'failure', run_attempt: 1 },
      { ...CI, head_sha: parent, conclusion: 'success', run_attempt: 1 },
    ]
  })
  await app.record.follow(project)
  expect(await afterLines(app, id)).toEqual([
    expect.objectContaining({ merge_commit: s, main: 'pending', revert: null }),
  ])

  // 손으로 쓴 되돌림 커밋(GitHub 되돌림 PR의 제목 꼴)
  await g('revert', '--no-edit', '--no-commit', s)
  await g('commit', '--quiet', '--no-verify', '-m', `Revert "clamp 고침 (#${pr})"`)
  const revert = await g('rev-parse', 'HEAD')
  await g('push', '--quiet', 'origin', 'main')
  clock = Date.parse(at) + 31 * DAY
  await app.record.follow(project)
  expect((await afterLines(app, id)).at(-1)).toMatchObject({
    closed: true,
    main: 'pending',
    revert: { sha: revert, form: 'revert_title' },
  })
  // 미정은 미정으로 남는다(실적을 막지는 않는다: M5 규칙이 따로 본다)
  const r = await app.store.readRecord()
  const stats = new RecordDesk({ store: app.store, now: () => new Date(clock ?? 0).toISOString() })
  expect(
    (await stats.record(project, false)).conditions.find((c) => c.id === 'small')?.after,
  ).toMatchObject({
    closed: 1,
    reverts: 1,
    main: { pending: 1, attributed: 0 },
  })
  expect(r.after.every((a) => a.main !== 'attributed')).toBe(true)

  // 필수 검사가 없는 레포(서버 보호 없음, quality.json에 ci_checks 없음): 같은 머지를 새 장부로 보면 잴 수 없음
  await kit.gh((state: Entry) => {
    state.branches = {}
  })
  const other = await kit.openApp(await makeTempDir('relay-home-'), {
    recordNow: () => new Date(Date.parse(at) + 31 * DAY).toISOString(),
  })
  const raw = await readFile(app.store.ledgerFile, 'utf8')
  const keep = raw.split('\n').filter((l) => l && !l.includes('"kind":"after"'))
  await writeFile(other.store.ledgerFile, `${keep.join('\n')}\n`)
  await cp(app.store.workDir(id), other.store.workDir(id), { recursive: true })
  await other.works.addProject(kit.repo.dir)
  await other.record.follow(project)
  expect(await afterLines(other, id)).toEqual([
    expect.objectContaining({ closed: true, main: 'unmeasurable' }),
  ])
})

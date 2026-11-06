// [흐름] 끝까지 따라가기(M4b, docs/m4-design.md 4절, src/main/works-record.ts): Work가 [끝내기]로 끝난 뒤 GitHub에서 Update
// branch를 거쳐 머지된 PR(같은 변경, 머지 커밋·때), 사람이 더 커밋해 squash로 머지한 PR(같은 변경이 아님), PR 없이 끝난 Work의
// no_pr와 90일 뒤 unmerged(가짜 시계, 90일은 첫 결론 줄부터), [버림]의 discarded, 새 Work가 따라가기를 부름. 거울은 $RELAY_HOME에만 생기고 사용자
// 레포의 ref는 그대로다. 로컬에서 합친 경우는 works-record-local.test.ts. 바탕은 test/support/works-flow.ts.
import { existsSync } from 'node:fs'
import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { mirrorDir } from '../../src/adapters/mirror.ts'
import type { LedgerEntry } from '../../src/engine/ledger.ts'
import { trackRecord } from '../../src/engine/shadow.ts'
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
} from '../support/works-flow.ts'

const kit = flowKit()
const { scenario, until } = kit

const SUBMIT = { do: 'mcp', tool: 'submit_contract', args: CONTRACT }
const DAY = 24 * 60 * 60 * 1000

/** 프로젝트를 더하고 Work를 만들어 계약을 승인하고, 세션이 쉰 뒤의 증거(PR이 있으면 PR의 내보내기)를 기다린다 */
async function startWork(app: TestApp, pr: boolean): Promise<{ id: string; project: string }> {
  const { works } = app
  const project = (await works.addProject(kit.repo.dir)).id
  const { id } = await works.createWork({ project, request: REQUEST })
  await until(() => works.view(id).state === 'awaiting_approval', '계약 제출')
  await works.approveContract(id)
  await until(
    () =>
      works.view(id).evidence?.review?.status === 'done' &&
      (!pr || works.find(id)?.exports[0]?.exported_head === works.view(id).head) &&
      settled(works.view(id)),
    '리뷰가 끝난 증거',
  )
  await works.idle()
  return { id, project }
}

/** [끝내기]로 끝낸다(PR은 열린 채 남는다) */
async function endWork(app: TestApp, id: string): Promise<string> {
  const head = app.works.view(id).head ?? ''
  await app.works.end(id, { head })
  await until(() => app.works.view(id).state === 'done', '끝남')
  await app.works.idle()
  return head
}

const fates = (ledger: LedgerEntry[], id: string) =>
  ledger.filter((e) => e.work === id && (e.merged_head || e.closed || e.ended))

const userRefs = () => kit.repo.git('for-each-ref', '--format=%(refname) %(objectname)')

test('Work가 끝난 뒤 Update branch를 거쳐 머지된 PR을 따라간다: 같은 변경이라 일치, 거울은 $RELAY_HOME에만', async () => {
  await scenario([SUBMIT, FIX_COMMIT, ...PUSH_AND_PR, { do: 'stop' }])
  const home = await makeTempDir('relay-home-')
  const app = await kit.openApp(home)
  const { id, project } = await startWork(app, true)
  const pr = app.works.view(id).pr?.number ?? 0
  const branch = app.works.find(id)?.branch ?? ''
  const head = await endWork(app, id)
  expect(app.works.view(id).pr?.state).toBe('OPEN')
  // 열린 PR: 끝을 쓰지 않는다
  await app.record.follow(project)
  expect(fates(await app.store.readLedger(), id)).toEqual([])

  // GitHub: 기준이 앞으로 가고, 사람이 Update branch를 누른 뒤 merge로 머지한다
  const { g, write } = await kit.github()
  await write('README.md', '# calc\n', '기준이 앞으로')
  await g('push', '--quiet', 'origin', 'main')
  await g('checkout', '--quiet', '-b', 'upd', `origin/${branch}`)
  await g('merge', '--quiet', '--no-ff', '--no-edit', 'main')
  const updated = await g('rev-parse', 'HEAD')
  await g('push', '--quiet', 'origin', `upd:${branch}`)
  await kit.pullRef(pr, updated)
  await g('checkout', '--quiet', 'main')
  await g('merge', '--quiet', '--no-ff', '--no-edit', updated)
  const mergeCommit = await g('rev-parse', 'HEAD')
  await g('push', '--quiet', 'origin', 'main')
  await kit.gh((state) => {
    const target = state.prs?.find((p) => p.number === pr)
    if (target)
      Object.assign(target, {
        state: 'MERGED',
        headRefOid: updated,
        mergedAt: '2026-11-07T10:00:00Z',
        mergeCommit: { oid: mergeCommit },
      })
  })

  const before = await userRefs()
  await app.record.follow(project)
  const ledger = await app.store.readLedger()
  expect(fates(ledger, id)).toEqual([
    expect.objectContaining({
      work: id,
      head,
      conclusion: 'human_merge',
      condition: null,
      shadow: false,
      by: 'human-override',
      merged_head: updated,
      merge_commit: mergeCommit,
      merged_at: '2026-11-07T10:00:00Z',
      same_change: true,
      pr,
    }),
  ])
  expect(trackRecord(ledger, project, 1, flowEpoch())).toEqual({ small: true })
  // 거울은 $RELAY_HOME/mirror에 있고 사용자 레포의 ref는 그대로다
  expect(existsSync(mirrorDir(home, kit.repo.dir))).toBe(true)
  expect(mirrorDir(home, kit.repo.dir).startsWith(join(home, 'mirror'))).toBe(true)
  expect(await userRefs()).toBe(before)
  // 끝이 정해지면 다시 쓰지 않는다
  await app.record.follow(project)
  expect(fates(await app.store.readLedger(), id)).toHaveLength(1)
})

test('사람이 PR에 더 커밋하고 squash로 머지했으면 같은 변경이 아니다(불일치)', async () => {
  await scenario([SUBMIT, FIX_COMMIT, ...PUSH_AND_PR, { do: 'stop' }])
  const app = await kit.openApp(await makeTempDir('relay-home-'))
  const { id, project } = await startWork(app, true)
  const pr = app.works.view(id).pr?.number ?? 0
  const branch = app.works.find(id)?.branch ?? ''
  const head = await endWork(app, id)

  const { g, write } = await kit.github()
  await g('checkout', '--quiet', '-b', 'more', `origin/${branch}`)
  const more = await write('NOTES.md', '사람이 더 고침\n', '사람이 더 고침')
  await g('push', '--quiet', 'origin', `more:${branch}`)
  await kit.pullRef(pr, more)
  // squash 커밋은 기준에 올리지 않는다(이 레포의 다른 시험과 겹치지 않게): 거울은 머지 커밋을 몰라도 가른다
  await kit.gh((state) => {
    const target = state.prs?.find((p) => p.number === pr)
    if (target)
      Object.assign(target, { state: 'MERGED', headRefOid: more, mergedAt: '2026-11-07T11:00:00Z' })
  })
  await app.record.follow(project)
  const ledger = await app.store.readLedger()
  expect(fates(ledger, id)).toEqual([
    expect.objectContaining({ head, by: 'human-override', merged_head: more, same_change: false }),
  ])
  expect(fates(ledger, id)[0]).not.toHaveProperty('merge_commit')
  expect(trackRecord(ledger, project, 0, flowEpoch())).toEqual({ small: false })
})

test('PR 없이 끝난 Work는 no_pr, 기준에 닿지 않고 90일이 지나면 unmerged(가짜 시계). [버림]은 discarded. 새 Work가 따라가기를 부른다', async () => {
  await scenario([SUBMIT, FIX_COMMIT, { do: 'stop' }])
  // 가짜 시계는 실제 오늘(결론 줄의 때) 다음 날 0시부터: 90일은 결론 줄의 때부터 센다
  const start = Math.ceil(Date.now() / DAY) * DAY
  let clock = start
  const app = await kit.openApp(await makeTempDir('relay-home-'), {
    follow: true,
    recordNow: () => new Date(clock).toISOString(),
  })
  const { id, project } = await startWork(app, false)
  const head = await endWork(app, id)
  expect(app.works.view(id).pr).toBeNull()
  expect(fates(await app.store.readLedger(), id)).toEqual([])

  // 새 Work를 만들면 따라간다(기다리지 않는다)
  const next = await app.works.createWork({ project, request: REQUEST })
  await until(
    async () => fates(await app.store.readLedger(), id).length > 0,
    '새 Work가 부른 따라가기',
  )
  await app.record.follow(project)
  expect(fates(await app.store.readLedger(), id)).toEqual([
    expect.objectContaining({ head, ended: 'no_pr', ts: new Date(start).toISOString() }),
  ])

  // 30일: 아직 기준에 닿지 않았지만 끝을 정하지 않는다
  clock += 30 * DAY
  await app.record.follow(project)
  expect(fates(await app.store.readLedger(), id)).toHaveLength(1)
  // 90일이 지나면 불일치(unmerged)
  clock += 61 * DAY
  await app.record.follow(project)
  expect(fates(await app.store.readLedger(), id).map((e) => e.ended)).toEqual(['no_pr', 'unmerged'])

  // [버림]: 내보내기 결론 줄이 있는 Work(장부에 미리 적음)를 버리면 discarded
  await until(() => app.works.view(next.id).state === 'awaiting_approval', '계약 제출')
  await app.works.abandon(next.id)
  const line = {
    ...flowEpoch(),
    ts: '2026-11-08T00:00:00Z',
    project,
    work: next.id,
    head: 'f'.repeat(40),
    conclusion: 'human_merge',
    condition: 'small',
    shadow: true,
  }
  await appendFile(join(app.store.home, 'ledger.jsonl'), `${JSON.stringify(line)}\n`)
  await app.record.follow(project)
  const ledger = await app.store.readLedger()
  expect(fates(ledger, next.id)).toEqual([
    expect.objectContaining({ head: line.head, ended: 'discarded' }),
  ])
  expect(trackRecord(ledger, project, 0, flowEpoch())).toEqual({ small: false })
})

test('늦게 처음 따라가도 no_pr의 90일은 내보내기의 첫 결론 줄부터 센다(분모 밖 추적 잃음과 같은 시계)', async () => {
  await scenario([SUBMIT, FIX_COMMIT, { do: 'stop' }])
  const start = Date.now()
  let clock = start + 85 * DAY
  const app = await kit.openApp(await makeTempDir('relay-home-'), {
    recordNow: () => new Date(clock).toISOString(),
  })
  const { id, project } = await startWork(app, false)
  await endWork(app, id)
  // 앱이 꺼져 있다가 85일 뒤 처음 따라감: no_pr
  await app.record.follow(project)
  expect(fates(await app.store.readLedger(), id).map((e) => e.ended)).toEqual(['no_pr'])
  // 첫 결론 줄에서 90일이 지났다(no_pr 줄을 쓴 때부터는 6일)
  clock = start + 91 * DAY
  await app.record.follow(project)
  expect(fates(await app.store.readLedger(), id).map((e) => e.ended)).toEqual(['no_pr', 'unmerged'])
})

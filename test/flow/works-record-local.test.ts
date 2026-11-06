// [흐름] 끝까지 따라가기(M4b, docs/m4-design.md 4.2, src/main/works-record.ts): PR 없이 [끝내기]한 Work를 사람이 로컬에서
// 기준에 합쳐 push했으면 human-override 머지로 쓴다. squash(같은 patch-id의 기준 커밋을 찾음)와 merge(head가 기준의 조상).
// works-record.test.ts와 origin을 나누지 않으려고(기준에 변경이 들어간다) 파일을 갈랐다. 바탕은 test/support/works-flow.ts.
import { expect, test } from 'vitest'
import { trackRecord, type LedgerEntry } from '../../src/engine/ledger.ts'
import { makeTempDir } from '../support/repo.ts'
import type { TestApp } from '../support/works-app.ts'
import {
  CONTRACT,
  FIX_COMMIT,
  flowEpoch,
  flowKit,
  REQUEST,
  settled,
} from '../support/works-flow.ts'

const kit = flowKit()
const { scenario, until } = kit

const SUBMIT = { do: 'mcp', tool: 'submit_contract', args: CONTRACT }

/** Work를 만들어 승인하고 첫 증거를 기다렸다가 [끝내기](상자가 남으면 [그래도 끝내기])로 끝낸다 */
async function endedWork(app: TestApp): Promise<{ id: string; project: string; head: string }> {
  const { works } = app
  const project = (await works.addProject(kit.repo.dir)).id
  const { id } = await works.createWork({ project, request: REQUEST })
  await until(() => works.view(id).state === 'awaiting_approval', '계약 제출')
  await works.approveContract(id)
  await until(() => works.view(id).evidence !== null && settled(works.view(id)), '첫 증거')
  await works.idle()
  const head = works.view(id).head ?? ''
  await works.end(id, { head })
  const boxed = () => works.view(id).endPending?.armed === false
  await until(() => works.view(id).state === 'done' || boxed(), '끝남이나 상자')
  if (boxed()) await works.end(id, { head, force: true })
  await until(() => works.view(id).state === 'done', '끝남')
  await works.idle()
  return { id, project, head }
}

const fates = (ledger: LedgerEntry[], id: string) =>
  ledger.filter((e) => e.work === id && (e.merged_head || e.closed || e.ended))

test('PR 없이 끝난 Work를 사람이 로컬에서 squash로 합쳐 push하면 같은 변경의 human-override 머지로 쓴다', async () => {
  await scenario([SUBMIT, FIX_COMMIT, { do: 'stop' }])
  const app = await kit.openApp(await makeTempDir('relay-home-'))
  const { id, project, head } = await endedWork(app)
  await app.record.follow(project)
  expect(fates(await app.store.readLedger(), id).map((e) => e.ended)).toEqual(['no_pr'])

  // 사람의 다른 clone에서 Work 브랜치를 받아 squash로 합친다
  const { g } = await kit.github()
  await g('fetch', '--quiet', kit.repo.dir, app.works.find(id)?.branch ?? '')
  await g('merge', '--quiet', '--squash', 'FETCH_HEAD')
  await g('commit', '--quiet', '--no-verify', '-m', 'clamp 고침 (squash)')
  const squash = await g('rev-parse', 'HEAD')
  await g('push', '--quiet', 'origin', 'main')

  await app.record.follow(project)
  const ledger = await app.store.readLedger()
  expect(fates(ledger, id)).toEqual([
    expect.objectContaining({ ended: 'no_pr' }),
    expect.objectContaining({
      head,
      by: 'human-override',
      merged_head: head,
      merge_commit: squash,
      same_change: true,
    }),
  ])
  expect(trackRecord(ledger, project, 1, flowEpoch())).toEqual({ small: true })
})

test('[그래도 끝내기]로 PR 없이 끝난 Work를 사람이 merge로 합쳤으면(head가 기준의 조상) 머지로 쓴다', async () => {
  // 앞 시험이 기준에 들인 파일과 겹치지 않는 변경(계약 줄은 못 미침: [그래도 끝내기])
  const docs = { do: 'commit', message: '문서', files: { 'docs/notes.md': '메모\n' } }
  await scenario([SUBMIT, docs, { do: 'stop' }])
  const app = await kit.openApp(await makeTempDir('relay-home-'))
  const { id, project, head } = await endedWork(app)

  const { g } = await kit.github()
  await g('fetch', '--quiet', kit.repo.dir, app.works.find(id)?.branch ?? '')
  await g('merge', '--quiet', '--no-ff', '--no-edit', 'FETCH_HEAD')
  await g('push', '--quiet', 'origin', 'main')

  await app.record.follow(project)
  const last = fates(await app.store.readLedger(), id)
  expect(last.map((e) => [e.ended ?? null, e.by ?? null, e.merged_head ?? null])).toEqual([
    ['no_pr', null, null],
    [null, 'human-override', head],
  ])
  expect(last[1]).toMatchObject({ same_change: true })
  expect(last[1]).not.toHaveProperty('merge_commit')
})

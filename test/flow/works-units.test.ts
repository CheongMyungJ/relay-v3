// [흐름] 한 요청은 한 Work다(V21): 단위가 있는 계약을 한 번에 승인하고, 앱이 아직 받지 않는 전달 방식(branch_per_unit,
// V22)은 바로 invalid다. 증거는 Work 브랜치의 ref로 잰다: 세션이 worktree에서 다른 브랜치로 옮겨 커밋해도 증거, 화면의
// HEAD, [변경], [끝내기]가 재는 대상은 Work 브랜치의 끝 그대로다. 단위의 꼴과 약속은 [단위](contract-units.test.ts).
import { expect, test } from 'vitest'
import { makeTempDir, runGit } from '../support/repo.ts'
import {
  CONTRACT,
  FIX_COMMIT,
  flowKit,
  REQUEST,
  settled,
  type Entry,
} from '../support/works-flow.ts'

const kit = flowKit()
const { scenario, fake, mcpResults, until } = kit

/** 버그 고침(clamp 단위)과 모든 단위에 걸친 지킴 줄 */
const [C1, C2] = CONTRACT.lines
const UNITS = { ...CONTRACT, lines: [{ ...C1, unit: 'clamp' }, C2] }
/** branch_per_unit의 모양은 맞는 계약(단위 둘): 앱만 아직 받지 않는다 */
const PER_UNIT = {
  ...CONTRACT,
  delivery: 'branch_per_unit',
  lines: [
    { ...C1, unit: 'clamp' },
    { ...C2, unit: 'add' },
  ],
}

test('단위가 있는 계약: branch_per_unit은 invalid, one_branch는 승인. 다른 브랜치로 옮긴 커밋은 재지 않고 Work 브랜치의 끝으로 [끝내기]', async () => {
  await scenario([
    { do: 'mcp', tool: 'submit_contract', args: PER_UNIT },
    { do: 'mcp', tool: 'submit_contract', args: { ...UNITS, delivery: 'one_branch' } },
    FIX_COMMIT,
    { do: 'stop' },
    { do: 'waitInput' },
    // 세션이 worktree에서 다른 브랜치로 옮겨 커밋한다(M2 40 relay3-noreview-3)
    { do: 'bash', command: 'git checkout -q -b side' },
    { do: 'commit', message: '옆 브랜치', files: { 'NOTES.md': '옆 브랜치의 일\n' } },
    { do: 'stop' },
    { do: 'waitInput' },
  ])
  const app = await kit.openApp(await makeTempDir('relay-home-'))
  const { works } = app
  const project = await works.addProject(kit.repo.dir)
  const { id, branch } = await works.createWork({ project: project.id, request: REQUEST })

  // 앱이 아직 받지 않는 전달 방식은 모양 검사 전에 바로 invalid(영어, 세션이 읽는다)
  await until(() => works.view(id).state === 'awaiting_approval', '계약 제출')
  expect((await mcpResults('submit_contract'))[0]).toEqual({
    status: 'invalid',
    errors: [
      `delivery: "branch_per_unit" (a branch per unit) is not available yet. Leave delivery out or use "one_branch": all units go on the Work branch ${branch}, each unit in its own commits.`,
    ],
  })
  expect(works.view(id).pendingContract).toMatchObject({
    delivery: 'one_branch',
    lines: [{ id: 'C1', unit: 'clamp' }, { id: 'C2' }],
  })
  await works.approveContract(id)
  expect(works.view(id).contract?.lines.map((l) => l.unit)).toEqual(['clamp', undefined])

  // Work 브랜치의 고침 커밋: 세션이 쉬면 재고 미리 리뷰(V23)까지 돈다
  await until(() => {
    const v = works.view(id)
    return v.evidence?.head === v.head && v.evidence?.review?.status === 'done' && settled(v)
  }, '고침 커밋의 증거와 미리 리뷰')
  const fixed = works.view(id).head ?? ''
  const worktree = works.record(id).worktree
  expect(await runGit(worktree, ['rev-parse', branch])).toBe(fixed)
  const measured = async () =>
    (await app.store.readEvents(id)).filter((e) => e.type === 'evidence').length
  const before = await measured()

  // 다른 브랜치로 옮겨 커밋하고 쉰다: Work 브랜치의 끝은 그대로라 화면의 HEAD도 증거도 그대로다
  app.sessions.write(id, '계속\r')
  const stops = async () =>
    (await fake()).filter((e: Entry) => e.type === 'hook' && e.event === 'Stop').length
  await until(async () => (await stops()) === 2, '옆 브랜치 커밋 뒤 Stop')
  // 몰아 두기(200ms)가 지나도 재기가 없다
  await new Promise((r) => setTimeout(r, 600))
  await works.idle()
  const side = await runGit(worktree, ['rev-parse', 'HEAD'])
  expect(side).not.toBe(fixed)
  expect(await runGit(worktree, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('side')
  expect(works.view(id)).toMatchObject({ head: fixed, evidence: { head: fixed } })
  expect(await measured()).toBe(before)
  // [변경]도 Work 브랜치의 끝을 보인다
  const diff = await works.diff(id)
  expect(diff).toContain('src/calc.js')
  expect(diff).not.toContain('NOTES.md')

  // [끝내기]는 Work 브랜치의 끝(미리 리뷰가 끝난 head)으로 한 번에 끝난다
  expect(await works.end(id, { head: fixed })).toEqual({
    head: fixed,
    ended: true,
    armed: false,
    open: [],
  })
  expect(works.view(id).state).toBe('done')
  expect((await fake()).filter((e) => e.type === 'review')).toHaveLength(1)
})

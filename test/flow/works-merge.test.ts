// [흐름] Works의 머지·자동 머지·증거 계기의 경계 (src/main/works-evidence.ts). 바탕은 test/support/works-flow.ts.
// 경우: 리뷰 범위 auto_only의 자동 후보(리뷰하고 정책이 머지), 자동 머지가 실패하면 PR 확인에서 다시 해 봄,
// 내보내기 리뷰가 도는 동안의 relay_check(리뷰를 덮지 않음), 기준이 다른 PR과 CI 실패·진행 중인 PR의 [머지],
// 대화를 만들기 전에 끝난 세션의 [다시 열기](새 세션).
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeAll, describe, expect, test, vi } from 'vitest'
import type { EvidenceBundle } from '../../src/core/types.ts'
import { makeTempDir } from '../support/repo.ts'
import {
  CLAUDE_VERSION,
  CONTRACT,
  FIX_COMMIT,
  flowKit,
  PUSH_AND_PR,
  RELAY_VERSION,
  REQUEST,
  settled,
  type Entry,
} from '../support/works-flow.ts'

const kit = flowKit()
const { scenario, fake, mcpResults, until } = kit

const STANDARD = [
  { do: 'mcp', tool: 'submit_contract', args: CONTRACT },
  FIX_COMMIT,
  ...PUSH_AND_PR,
  { do: 'stop' },
]

const events = async (app: { store: { readEvents(id: string): Promise<Entry[]> } }, id: string) =>
  app.store.readEvents(id)

describe('자동 머지 (보호된 main, 조건 small의 그림자 실적 1)', () => {
  let home: string
  let projectId: string

  beforeAll(async () => {
    home = await makeTempDir('relay-home-')
    const checks = { enforcement_level: 'everyone', contexts: ['ci'], strict: true }
    await kit.gh((state) => {
      state.branches = { main: { protected: true, protection: { required_status_checks: checks } } }
    })
    const app = await kit.openApp(home)
    projectId = (await app.works.addProject(kit.repo.dir)).id
    await app.works.updateSettings(projectId, { auto_merge: true, min_shadow: 1 })
    await app.close()
    kit.forget(app)
    // 앞서 사람이 그림자 head를 그대로 머지한 Work 하나
    const v = { claude_version: CLAUDE_VERSION, relay_version: RELAY_VERSION }
    const base = { ts: '2026-11-01T00:00:00Z', project: projectId, work: 'w0', head: 'h0', ...v }
    const lines = [
      { ...base, conclusion: 'human_merge', condition: 'small', shadow: true },
      {
        ...base,
        conclusion: 'human_merge',
        condition: null,
        shadow: false,
        by: 'human',
        merged_head: 'h0',
      },
    ]
    await appendFile(
      join(home, 'ledger.jsonl'),
      lines.map((l) => `${JSON.stringify(l)}\n`).join(''),
    )
  })

  test("리뷰 범위 'auto_only': 자동 조건을 채운 후보는 리뷰하고(V4) 정책이 머지한다", async () => {
    await scenario(STANDARD)
    const app = await kit.openApp(home)
    await app.works.updateSettings(projectId, { review: 'auto_only' })
    const { id } = await app.works.createWork({ project: projectId, request: REQUEST })
    await until(() => app.works.view(id).state === 'awaiting_approval', '계약 제출')
    await app.works.approveContract(id)
    await until(() => app.works.view(id).state === 'done', '자동 머지')
    const v = app.works.view(id)
    expect(v.evidence?.review).toMatchObject({ status: 'done' })
    expect(v.gate).toMatchObject({ conclusion: 'auto_merge_candidate', condition: 'small' })
    expect((await fake()).filter((e) => e.type === 'review')).toHaveLength(1)
    const ledger = await app.store.readLedger()
    expect(ledger.filter((e) => e.work === id).map((e) => [e.conclusion, e.by ?? null])).toEqual([
      ['auto_merge_candidate', null],
      ['auto_merge_candidate', 'policy'],
    ])
    await app.works.updateSettings(projectId, { review: 'all' })
  })

  test('자동 머지가 실패하면(gh pr merge) 결론이 그대로인 동안 PR 확인에서 다시 해 본다', async () => {
    await scenario(STANDARD)
    await kit.gh((state) => {
      state.fail = ['pr merge']
    })
    const app = await kit.openApp(home, { prPollMs: 200 })
    const { id } = await app.works.createWork({ project: projectId, request: REQUEST })
    await until(() => app.works.view(id).state === 'awaiting_approval', '계약 제출')
    await app.works.approveContract(id)
    await until(
      async () => (await events(app, id)).some((e) => e.type === 'auto_merge_failed'),
      '자동 머지 실패',
    )
    expect(app.works.view(id)).toMatchObject({
      state: 'working',
      gate: { conclusion: 'auto_merge_candidate' },
      error: expect.stringContaining('머지하지 못함'),
    })
    await kit.gh((state) => {
      state.fail = []
    })
    await until(() => app.works.view(id).state === 'done', 'PR 확인에서 다시 머지')
    expect(app.works.view(id).error).toBeNull()
    expect((await app.store.readLedger()).at(-1)).toMatchObject({ work: id, by: 'policy' })
    // 같은 까닭의 실패는 한 번만 적는다
    const failed = (await events(app, id)).filter((e) => e.type === 'auto_merge_failed')
    expect(failed).toHaveLength(1)
  })
})

test('내보내기 리뷰가 도는 동안 relay_check는 먼저 보인 증거를 주고, 리뷰 지적이 사라지지 않는다', async () => {
  const review = join(kit.tmp, 'review-security.json')
  const finding = { severity: 'high', raise: 'security', text: '비밀이 로그에 남음' }
  await writeFile(review, JSON.stringify({ findings: [finding] }))
  vi.stubEnv('FAKE_CLAUDE_REVIEW', review)
  vi.stubEnv('FAKE_CLAUDE_REVIEW_MS', '4000')
  await scenario([
    { do: 'mcp', tool: 'submit_contract', args: CONTRACT },
    FIX_COMMIT,
    ...PUSH_AND_PR,
    { do: 'sleep', ms: 2000 },
    { do: 'mcp', tool: 'relay_check', args: {} },
    { do: 'stop' },
  ])
  try {
    const app = await kit.openApp(await makeTempDir('relay-home-'))
    const { works } = app
    const project = await works.addProject(kit.repo.dir)
    const { id } = await works.createWork({ project: project.id, request: REQUEST })
    await until(() => works.view(id).state === 'awaiting_approval', '계약 제출')
    await works.approveContract(id)
    // 리뷰가 도는 동안 결정론적 증거와 관문을 먼저 보인다(리뷰는 사람을 막지 않는다)
    await until(() => works.view(id).reviewRunning, '리뷰 시작')
    expect(works.view(id)).toMatchObject({ evidenceRunning: false, evidence: { review: null } })
    expect(works.view(id).gate).not.toBeNull()
    await until(async () => (await mcpResults('relay_check')).length === 1, 'relay_check')
    const checked = (await mcpResults('relay_check'))[0] as Entry
    expect(checked).toMatchObject({ status: 'ok', stale: false })
    expect(checked.summary).toEqual(expect.arrayContaining(['command unit: pass']))
    expect(JSON.stringify(checked)).not.toMatch(/[가-힣]/)
    await until(
      () => works.view(id).evidence?.review?.status === 'done' && settled(works.view(id)),
      '리뷰',
    )
    await works.idle()
    const v = works.view(id)
    expect(v.evidence?.review?.findings).toMatchObject([finding])
    expect(v.gate?.decisive).toBe('리뷰 올림(보안): 비밀이 로그에 남음')
    const evidence = (await events(app, id)).filter((e) => e.type === 'evidence')
    expect(evidence.map((e) => e.export)).toEqual([true])
    const path = (await app.store.readText(id, 'work.json')) ?? ''
    const file = (JSON.parse(path) as { evidence_path: string }).evidence_path
    const bundle = JSON.parse(await readFile(file, 'utf8')) as EvidenceBundle
    expect(bundle.review?.findings).toHaveLength(1)
  } finally {
    vi.stubEnv('FAKE_CLAUDE_REVIEW_MS', '0')
    vi.stubEnv('FAKE_CLAUDE_REVIEW', join(kit.tmp, 'review.json'))
  }
})

test('[머지]: Work의 기준과 다른 PR, CI 실패·진행 중인 PR은 머지하지 않는다. PR을 고치면 PR 확인이 내보내기로 잰다', async () => {
  await scenario([
    { do: 'mcp', tool: 'submit_contract', args: CONTRACT },
    FIX_COMMIT,
    { do: 'bash', command: 'git push -u origin HEAD' },
    { do: 'bash', command: 'gh pr create --title t --body b --base dev' },
    { do: 'stop' },
  ])
  const app = await kit.openApp(await makeTempDir('relay-home-'), { prPollMs: 200 })
  const { works } = app
  const project = await works.addProject(kit.repo.dir)
  const { id } = await works.createWork({ project: project.id, request: REQUEST })
  await until(() => works.view(id).state === 'awaiting_approval', '계약 제출')
  await works.approveContract(id)
  // 기준이 다른 PR은 내보내기로 재지 않고(Stop의 증거만) 알린다
  await until(() => works.view(id).evidence !== null && settled(works.view(id)), '첫 증거')
  await until(() => works.view(id).error?.includes('기준 브랜치(dev)') ?? false, '기준 알림')
  expect(works.view(id).evidence?.review).toBeNull()
  expect(await works.merge(id)).toEqual({
    ok: false,
    error: 'PR의 기준 브랜치(dev)가 Work의 기준(main)과 다름',
  })

  // 사람이 PR의 기준을 main으로 고친다 → PR 확인이 내보내기 후보로 잰다(리뷰)
  const pr = works.view(id).pr?.number
  const setPr = (fields: Entry) =>
    kit.gh((state) => Object.assign(state.prs?.find((p) => p.number === pr) ?? {}, fields))
  await setPr({ baseRefName: 'main' })
  await until(
    () => works.view(id).evidence?.review?.status === 'done' && settled(works.view(id)),
    '내보내기 증거',
  )
  expect(works.view(id).error).toBeNull()

  const ci = (state: string) => [{ __typename: 'StatusContext', context: 'ci', state }]
  await setPr({ statusCheckRollup: ci('FAILURE') })
  expect(await works.merge(id)).toEqual({ ok: false, error: 'CI 실패 (ci)' })
  await setPr({ statusCheckRollup: ci('PENDING') })
  expect(await works.merge(id)).toEqual({
    ok: false,
    error: 'CI가 아직 돎 (ci): 끝난 뒤 머지하세요',
  })
  await setPr({ statusCheckRollup: ci('SUCCESS') })
  expect(await works.merge(id)).toEqual({ ok: true })
  expect(works.view(id).state).toBe('done')
})

test('세션이 대화를 만들기 전에 끝났으면 [다시 열기]는 --resume이 아닌 새 세션(새 session id, 첫 프롬프트)이다', async () => {
  await scenario([{ do: 'stop' }])
  const home = await makeTempDir('relay-home-')
  const first = await kit.openApp(home, { claudeBin: join(kit.tmp, 'no-such-claude') })
  const project = await first.works.addProject(kit.repo.dir)
  const { id } = await first.works.createWork({ project: project.id, request: REQUEST })
  await until(() => first.works.view(id).error?.includes('시작하자마자') ?? false, '시작 실패')
  const before = JSON.parse((await first.store.readText(id, 'work.json')) ?? '') as Entry
  expect(before.session_started).toBe(false)
  await first.close()
  kit.forget(first)

  // 사람이 claude 경로를 고치고 앱을 다시 켠다
  const second = await kit.openApp(home)
  await second.works.resumeWork(id)
  await until(async () => (await fake()).some((e) => e.type === 'start'), '세션 시작')
  const start = (await fake()).find((e) => e.type === 'start') as Entry
  expect(start.resume).toBe(false)
  expect((start.args as string[]).slice(0, 2)).toEqual([
    '--dangerously-skip-permissions',
    '--session-id',
  ])
  expect(start.sessionId).not.toBe(before.session_id)
  expect(start.prompt).toContain(second.store.workPath(id, 'request.md'))
  await until(async () => {
    const rec = JSON.parse((await second.store.readText(id, 'work.json')) ?? '') as Entry
    return rec.session_started === true && rec.session_id === start.sessionId
  }, '훅을 받음')
})

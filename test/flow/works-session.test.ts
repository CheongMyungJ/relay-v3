// [흐름] 세션 커밋 가르기(M4e, docs/m4-design.md 7절): 가짜 claude의 셸 도구로 만든 커밋은 사용자 레포에서 Relay-Work
// 트레일러를 달고 세션 커밋 집합(works/<id>/session-commits.jsonl)에 든다. 사용자 레포의 설정·훅 파일은 그대로다. Work가 끝난
// 뒤 사람이 PR에 더 커밋해 머지하면 끝 줄이 머지 뒤 커밋을 사람으로 가르고 [실적]이 '사람이 더 고침'과 사람 교정으로 센다.
// 다시 내보내기 전에 세션이 더 고친 앞 head는 '세션이 더 고침'이다(앱의 [머지]). 트레일러를 끈 프로젝트는 세션 환경에 심이 없고
// 집합만으로 가른다. 심이 사고를 남기면 그 프로젝트의 트레일러가 꺼진다. 바탕은 test/support/works-flow.ts.
import { readdir } from 'node:fs/promises'
import { expect, test } from 'vitest'
import type { LedgerEntry } from '../../src/engine/ledger.ts'
import { NO_COMMITS, parseSessionLog, workTrailers } from '../../src/engine/session-commits.ts'
import { RecordDesk } from '../../src/main/works-stats.ts'
import { calc } from '../support/calc.ts'
import { makeTempDir } from '../support/repo.ts'
import type { TestApp } from '../support/works-app.ts'
import {
  CONTRACT,
  FIX_COMMIT,
  flowKit,
  PUSH_AND_PR,
  REQUEST,
  settled,
} from '../support/works-flow.ts'

const kit = flowKit()
const { scenario, until } = kit

const SUBMIT = { do: 'mcp', tool: 'submit_contract', args: CONTRACT }
/** 세션이 셸 도구로 고치고 커밋한다(트레일러는 세션 환경의 심이 붙인다) */
const SESSION_FIX = [
  { do: 'write', files: FIX_COMMIT.files },
  { do: 'bash', command: 'git add -A && git commit -q -m "clamp 고침"' },
]

async function startWork(app: TestApp): Promise<{ id: string; project: string }> {
  const { works } = app
  const project = (await works.addProject(kit.repo.dir)).id
  const { id } = await works.createWork({ project, request: REQUEST })
  await until(() => works.view(id).state === 'awaiting_approval', '계약 제출')
  await works.approveContract(id)
  return { id, project }
}

/** 이 head를 내보내기로 잰 결론 줄이 생길 때까지 */
async function exported(app: TestApp, id: string, head: string): Promise<void> {
  await until(
    async () =>
      (await app.store.readLedger()).some((e) => e.work === id && e.head === head) &&
      settled(app.works.view(id)),
    `내보내기 ${head.slice(0, 7)}`,
  )
  await app.works.idle()
}

const fates = (ledger: LedgerEntry[], id: string) =>
  ledger.filter((e) => e.work === id && (e.merged_head || e.closed || e.ended))

const message = (sha: string) => kit.repo.git('log', '-1', '--format=%B', sha)

/** 사용자 레포의 설정(세션의 `git push -u`가 더하는 branch.* 칸은 뺀다)과 훅 폴더 */
const userState = async () => ({
  config: (await kit.repo.git('config', '--local', '--list'))
    .split('\n')
    .filter((l) => !l.startsWith('branch.')),
  hooks: (await readdir(kit.repo.path('.git/hooks')).catch(() => [])).sort(),
})

async function sessionSet(app: TestApp, id: string) {
  return parseSessionLog((await app.store.readText(id, 'session-commits.jsonl')) ?? '')
}

test('세션 커밋에 트레일러와 집합, 끝난 뒤 사람이 더 커밋해 머지하면 사람이 더 고침과 사람 교정', async () => {
  const before = await userState()
  await scenario([SUBMIT, ...SESSION_FIX, ...PUSH_AND_PR, { do: 'stop' }])
  const app = await kit.openApp(await makeTempDir('relay-home-'))
  const { id, project } = await startWork(app)
  await until(() => app.works.view(id).pr !== null, 'PR')
  const head = await kit.repo.sha(app.works.find(id)?.branch ?? '')
  await exported(app, id, head)
  // 세션 커밋: 트레일러, 집합, 트레일러 누락 없음. 사용자 레포의 설정과 훅은 그대로
  expect(workTrailers(await message(head))).toEqual([id])
  const set = await sessionSet(app, id)
  expect(set.launched).toBe(true)
  expect(set.trailerOff).toBe(false)
  expect(set.commits.get(head)).toEqual({ watched: true, trailer: true })
  expect((await app.store.readEvents(id)).some((e) => e.type === 'trailer_missing')).toBe(false)
  expect(await userState()).toEqual(before)

  await app.works.end(id, { head })
  await until(() => app.works.view(id).state === 'done', '끝남')
  await app.works.idle()
  // GitHub: 사람이 PR에 더 커밋하고 squash로 머지한다
  const pr = app.works.view(id).pr?.number ?? 0
  const branch = app.works.find(id)?.branch ?? ''
  const { g, write } = await kit.github()
  await g('checkout', '--quiet', '-b', 'more', `origin/${branch}`)
  const more = await write('NOTES.md', '사람이 더 고침\n', '사람이 더 고침')
  await g('push', '--quiet', 'origin', `more:${branch}`)
  await kit.pullRef(pr, more)
  await kit.gh((state) => {
    const target = state.prs?.find((p) => p.number === pr)
    if (target)
      Object.assign(target, { state: 'MERGED', headRefOid: more, mergedAt: '2026-11-07T10:00:00Z' })
  })
  await app.record.follow(project)
  expect(fates(await app.store.readLedger(), id)).toEqual([
    expect.objectContaining({
      head,
      merged_head: more,
      same_change: false,
      after_commits: { ...NO_COMMITS, human: 1 },
      session_set: { commits: 1, watched: 1, trailered: 1, incidents: 0 },
    }),
  ])
  const stats = await new RecordDesk({
    store: app.store,
    now: () => new Date().toISOString(),
  }).record(project, true)
  expect(stats.conditions.find((c) => c.id === 'small')?.miss).toMatchObject({
    more_human: 1,
    more_unknown: 0,
  })
  expect(stats.sessions).toMatchObject({
    merges: 1,
    corrected: 1,
    commits: { session: 0, human: 1, relay: 0, base_update: 0 },
    disagree: 0,
    watched: 1,
    trailered: 1,
    incidents: 0,
  })
})

test('다시 내보내기 전에 세션이 더 고친 앞 head는 세션이 더 고침이다(앱의 [머지])', async () => {
  const MORE = { 'src/calc.js': `${calc('hi')}// 세션이 더 고침\n` }
  await scenario([
    SUBMIT,
    ...SESSION_FIX,
    ...PUSH_AND_PR,
    { do: 'stop' },
    { do: 'waitInput' },
    { do: 'write', files: MORE },
    { do: 'bash', command: 'git commit -q -am "더 고침" && git push -q origin HEAD' },
    { do: 'stop' },
  ])
  const app = await kit.openApp(await makeTempDir('relay-home-'), { prPollMs: 200 })
  const { id, project } = await startWork(app)
  await until(() => app.works.view(id).pr !== null, 'PR')
  const branch = app.works.find(id)?.branch ?? ''
  const first = await kit.repo.sha(branch)
  await exported(app, id, first)
  // 사람이 터미널에서 더 고치라고 시킨다
  app.sessions.write(id, '하나 더 고쳐 주세요\r')
  await until(async () => (await kit.repo.sha(branch)) !== first, '세션의 두 번째 커밋')
  const second = await kit.repo.sha(branch)
  await exported(app, id, second)
  expect(await app.works.merge(id)).toEqual({ ok: true })
  await app.works.idle()
  const fate = fates(await app.store.readLedger(), id)
  expect(fate).toEqual([
    expect.objectContaining({
      head: second,
      merged_head: second,
      after_commits: NO_COMMITS,
      after_heads: { [first]: { ...NO_COMMITS, session: 1 } },
    }),
  ])
  const stats = await new RecordDesk({
    store: app.store,
    now: () => new Date().toISOString(),
  }).record(project, true)
  expect(stats.sessions).toMatchObject({
    merges: 1,
    corrected: 0,
    commits: { session: 1, human: 0 },
  })
  // 두 head 모두 small을 채운 표본: 그 단위는 첫 head가 세션이 더 고침이라 불일치다
  const lines = (await app.store.readLedger()).filter((e) => e.work === id && e.met)
  expect(lines.map((e) => [e.head, e.met])).toEqual([
    [first, ['small']],
    [second, ['small']],
  ])
  expect(stats.conditions.find((c) => c.id === 'small')).toMatchObject({
    match: 0,
    miss: { more_session: 1, more_human: 0, more_unknown: 0 },
  })
})

test('트레일러를 끈 프로젝트는 세션 환경에 심이 없고, 심의 사고는 프로젝트의 트레일러를 끈다', async () => {
  await scenario([
    SUBMIT,
    ...SESSION_FIX,
    // 심이 사고를 남긴 것처럼(원래 훅 자리를 찾지 못함)
    {
      do: 'bash',
      command: 'printf "pre-commit: 원래 훅 자리를 찾지 못함\\n" >> "$RELAY_HOOK_LOG"',
    },
    { do: 'stop' },
  ])
  const app = await kit.openApp(await makeTempDir('relay-home-'))
  const { id, project } = await startWork(app)
  await until(
    async () => (await app.store.readEvents(id)).some((e) => e.type === 'hook_incident'),
    '사고',
  )
  await until(
    () => app.works.list().projects.find((p) => p.id === project)?.settings.trailer === false,
    '트레일러 끔',
  )
  expect(workTrailers(await message(await kit.repo.sha(app.works.find(id)?.branch ?? '')))).toEqual(
    [id],
  )

  // 끈 프로젝트의 새 Work: 세션 환경에 심이 없고 집합만 쓴다
  await scenario([SUBMIT, ...SESSION_FIX, { do: 'stop' }])
  const { id: next } = await (async () => {
    const created = await app.works.createWork({ project, request: REQUEST })
    await until(() => app.works.view(created.id).state === 'awaiting_approval', '계약 제출')
    await app.works.approveContract(created.id)
    return created
  })()
  const branch = app.works.find(next)?.branch ?? ''
  await until(async () => (await sessionSet(app, next)).commits.size > 0, '세션 커밋')
  const sha = await kit.repo.sha(branch)
  expect(workTrailers(await message(sha))).toEqual([])
  const set = await sessionSet(app, next)
  expect(set.trailerOff).toBe(true)
  expect(set.commits.get(sha)).toEqual({ watched: false, trailer: false })
  expect((await app.store.readEvents(next)).some((e) => e.type === 'trailer_missing')).toBe(false)
  const log = await app.store.readText(next, 'session-commits.jsonl')
  expect(log).toContain('"why":"setting"')
})

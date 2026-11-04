// [흐름] [끝내기]의 두 단계(V18: prepareEnd → 사람이 보고 [끝 확정] end), 상자 뒤 커밋과 [끝 확정]의 head, 실패하거나
// 끊긴 리뷰의 다시 재기, 프로젝트의 품질 기준 상태와 [초안 만들기](V20), 평가용으로 끈 리뷰(RELAY_ABLATE=review의
// reviewDisabled). 바탕은 test/support/works-flow.ts.
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, vi } from 'vitest'
import { parseQuality } from '../../src/core/quality.ts'
import { headOf } from '../../src/main/works-evidence.ts'
import { EVENTS, type ProjectView } from '../../src/shared/api.ts'
import { QUALITY_TEXT } from '../support/calc.ts'
import { makeRepo, makeTempDir } from '../support/repo.ts'
import {
  CONTRACT,
  FIX_COMMIT,
  flowKit,
  REQUEST,
  settled,
  type Entry,
} from '../support/works-flow.ts'

const kit = flowKit()
const { scenario, fake, until } = kit

const exportsOf = async (
  app: { store: { readEvents(id: string): Promise<Entry[]> } },
  id: string,
) => (await app.store.readEvents(id)).filter((e) => e.type === 'evidence').map((e) => e.export)

const reviews = async () => (await fake()).filter((e) => e.type === 'review').length

test('[끝내기]는 내보내기 증거(리뷰 포함)만 재고 Work를 구현 중으로 둔다. 사람이 보고 세션이 더 고치면 다시 [끝내기], [끝 확정]은 다시 재지 않고 끝낸다', async () => {
  await scenario([
    { do: 'mcp', tool: 'submit_contract', args: CONTRACT },
    FIX_COMMIT,
    { do: 'stop' },
    { do: 'waitInput' },
    { do: 'commit', message: '리뷰 지적 고침', files: { 'NOTES.md': '이름을 고쳤다\n' } },
    { do: 'stop' },
  ])
  const app = await kit.openApp(await makeTempDir('relay-home-'))
  const { works } = app
  const project = await works.addProject(kit.repo.dir)
  const { id } = await works.createWork({ project: project.id, request: REQUEST })
  await until(() => works.view(id).state === 'awaiting_approval', '계약 제출')
  await works.approveContract(id)
  await until(() => works.view(id).evidence !== null && settled(works.view(id)), 'Stop의 증거')
  const first = works.view(id).head
  expect(works.view(id).evidence?.review).toBeNull()

  // [끝내기]: 내보내기 증거(리뷰 포함)를 재고 Work는 그대로
  const prepared = await works.prepareEnd(id)
  expect(prepared).toEqual({ head: first })
  let v = works.view(id)
  expect(v).toMatchObject({ state: 'working', reviewDisabled: false })
  expect(v.evidence?.head).toBe(first)
  expect(v.evidence?.review).toMatchObject({ status: 'done', findings: [{ text: '이름이 짧음' }] })
  expect(await exportsOf(app, id)).toEqual([false, true])
  expect(await reviews()).toBe(1)
  expect(app.sessions.isRunning(id)).toBe(true)
  // 이미 잰 head면 다시 재지 않는다
  expect(await works.prepareEnd(id)).toEqual({ head: first })
  expect(await reviews()).toBe(1)
  // 리뷰 결과는 세션에 넣지 않는다(V4, V8): 세션은 아무 입력도 받지 않았다
  expect((await fake()).filter((e) => e.type === 'input')).toEqual([])

  // 사람이 지적을 보고 터미널에서 말한다 → 세션이 더 커밋한다 → HEAD가 바뀌었으니 다시 [끝내기]
  app.sessions.write(id, '이름을 고쳐 주세요\r')
  await until(() => works.view(id).head !== first, '세션의 새 커밋')
  const second = works.view(id).head
  expect(await works.prepareEnd(id)).toEqual({ head: second })
  expect(works.view(id).evidence).toMatchObject({ head: second, review: { status: 'done' } })
  expect(await reviews()).toBe(2)
  const before = await exportsOf(app, id)
  expect(before.at(-1)).toBe(true)

  // [끝 확정]: 이 head는 이미 내보내기로 쟀다. 다시 재지 않고 끝낸다
  await works.end(id, second ?? '')
  v = works.view(id)
  expect(v.state).toBe('done')
  expect(await exportsOf(app, id)).toEqual(before)
  expect(await reviews()).toBe(2)
  await until(() => !app.sessions.isRunning(id), '세션 끝')
  await expect(works.prepareEnd(id)).rejects.toThrow()
})

test('리뷰를 평가용으로 끄면(reviewDisabled) 리뷰를 부르지 않고 건너뜀으로 둔다. [끝 확정]만 눌러도 내보내기로 재고 끝낸다(안전망)', async () => {
  await scenario([
    { do: 'mcp', tool: 'submit_contract', args: CONTRACT },
    FIX_COMMIT,
    { do: 'stop' },
  ])
  const app = await kit.openApp(await makeTempDir('relay-home-'), { reviewDisabled: true })
  const { works } = app
  const project = await works.addProject(kit.repo.dir)
  const { id } = await works.createWork({ project: project.id, request: REQUEST })
  expect(works.view(id).reviewDisabled).toBe(true)
  await until(() => works.view(id).state === 'awaiting_approval', '계약 제출')
  await works.approveContract(id)
  await until(() => works.view(id).evidence !== null && settled(works.view(id)), 'Stop의 증거')
  await works.end(id, works.view(id).head ?? '')
  const v = works.view(id)
  expect(v.state).toBe('done')
  expect(v.evidence?.review).toEqual({ status: 'skipped', findings: [] })
  expect(v.gate?.reasons).toContain('리뷰를 건너뜀')
  expect(await exportsOf(app, id)).toEqual([false, true])
  expect(await reviews()).toBe(0)
  // 평가가 [끝내기]마다 센 건너뜀 기록은 남긴다
  const skipped = (await app.store.readEvents(id)).filter((e) => e.type === 'review')
  expect(skipped).toMatchObject([{ status: 'skipped', disabled: true }])
})

test('[끝내기] 상자 뒤 세션이 Stop 없이 커밋하면 [끝 확정](상자의 head)은 끝내지 않는다. 셸 명령의 커밋은 Stop 전에 화면의 HEAD를 고친다', async () => {
  const shellCommit = `git -c user.name=f -c user.email=f@relay.invalid commit -q --allow-empty -m 셋째`
  await scenario([
    { do: 'mcp', tool: 'submit_contract', args: CONTRACT },
    FIX_COMMIT,
    { do: 'stop' },
    { do: 'waitInput' },
    // 차례 안의 커밋(훅 없음, Stop 없음): 화면은 아직 앞 head다
    { do: 'commit', message: '지적 고침', files: { 'NOTES.md': '고쳤다\n' } },
    { do: 'waitInput' },
    { do: 'bash', command: shellCommit },
    { do: 'waitInput' },
  ])
  const app = await kit.openApp(await makeTempDir('relay-home-'))
  const { works } = app
  const project = await works.addProject(kit.repo.dir)
  const { id } = await works.createWork({ project: project.id, request: REQUEST })
  await until(() => works.view(id).state === 'awaiting_approval', '계약 제출')
  await works.approveContract(id)
  await until(() => works.view(id).evidence !== null && settled(works.view(id)), 'Stop의 증거')
  const first = works.view(id).head ?? ''
  expect(await works.prepareEnd(id)).toEqual({ head: first })
  const exported = await exportsOf(app, id)
  expect(await reviews()).toBe(1)

  const worktree = works.find(id)?.worktree ?? ''
  app.sessions.write(id, '지적을 고쳐 주세요\r')
  await until(async () => (await headOf(worktree)) !== first, '세션의 차례 안 커밋')
  const second = await headOf(worktree)
  expect(works.view(id).head).toBe(first)
  // [끝 확정]이 넘긴 head는 지금 HEAD가 아니다: 새 커밋을 재지도 끝내지도 않고, 화면의 HEAD를 고쳐 상자를 거둔다
  await expect(works.end(id, first)).rejects.toThrow(/HEAD가 바뀜.*끝내기를 다시 눌러/)
  expect(works.view(id)).toMatchObject({ state: 'working', head: second })
  expect(await exportsOf(app, id)).toEqual(exported)
  expect(await reviews()).toBe(1)
  expect(app.sessions.isRunning(id)).toBe(true)

  // 셸 명령(git commit)의 PostToolUse는 Stop을 기다리지 않고 화면의 HEAD를 고친다
  app.sessions.write(id, '하나 더\r')
  await until(() => works.view(id).head !== second, '셸 커밋의 HEAD')
  const third = await headOf(worktree)
  expect(works.view(id)).toMatchObject({ head: third, session: 'running' })
  // 다시 [끝내기] → 새 head의 리뷰 → [끝 확정]
  expect(await works.prepareEnd(id)).toEqual({ head: third })
  expect(await reviews()).toBe(2)
  await works.end(id, third)
  expect(works.view(id).state).toBe('done')
})

test('리뷰가 실패한 head는 [끝내기]가 리뷰를 다시 부른다([증거 다시 재기]는 실패를 잇는다)', async () => {
  await scenario([
    { do: 'mcp', tool: 'submit_contract', args: CONTRACT },
    FIX_COMMIT,
    { do: 'stop' },
  ])
  const app = await kit.openApp(await makeTempDir('relay-home-'))
  const { works } = app
  const project = await works.addProject(kit.repo.dir)
  const { id } = await works.createWork({ project: project.id, request: REQUEST })
  await until(() => works.view(id).state === 'awaiting_approval', '계약 제출')
  await works.approveContract(id)
  await until(() => works.view(id).evidence !== null && settled(works.view(id)), 'Stop의 증거')
  const head = works.view(id).head
  try {
    vi.stubEnv('FAKE_CLAUDE_REVIEW_FAIL', 'exit')
    expect(await works.prepareEnd(id)).toEqual({ head })
    expect(works.view(id).evidence?.review).toEqual({ status: 'failed', findings: [] })
    expect(await reviews()).toBe(1)
  } finally {
    vi.stubEnv('FAKE_CLAUDE_REVIEW_FAIL', '')
  }
  // PR이 없으면 [증거 다시 재기]는 내보내기가 아니어서 같은 head의 실패한 리뷰를 잇는다
  await works.runEvidence(id, { exportCandidate: false })
  expect(works.view(id).evidence?.review?.status).toBe('failed')
  expect(await reviews()).toBe(1)
  // 다시 [끝내기]: 이미 잰 head라도 리뷰가 실패했으면 다시 잰다
  expect(await works.prepareEnd(id)).toEqual({ head })
  expect(works.view(id).evidence?.review).toMatchObject({
    status: 'done',
    findings: [{ text: '이름이 짧음' }],
  })
  expect(await reviews()).toBe(2)
  // 리뷰가 된 head는 다시 부르지 않는다
  expect(await works.prepareEnd(id)).toEqual({ head })
  expect(await reviews()).toBe(2)
})

test('앱을 닫아 끊긴 리뷰는 내보내기(exported_head, 장부, export 기록)로 남지 않는다. 다시 켜고 [끝내기]하면 다시 잰다', async () => {
  await scenario([
    { do: 'mcp', tool: 'submit_contract', args: CONTRACT },
    FIX_COMMIT,
    { do: 'stop' },
  ])
  const home = await makeTempDir('relay-home-')
  const first = await kit.openApp(home)
  const project = await first.works.addProject(kit.repo.dir)
  const { id } = await first.works.createWork({ project: project.id, request: REQUEST })
  await until(() => first.works.view(id).state === 'awaiting_approval', '계약 제출')
  await first.works.approveContract(id)
  await until(
    () => first.works.view(id).evidence !== null && settled(first.works.view(id)),
    'Stop의 증거',
  )
  const head = first.works.view(id).head
  const ledger = (await first.store.readLedger()).length
  let ending: Promise<unknown>
  try {
    vi.stubEnv('FAKE_CLAUDE_REVIEW_FAIL', 'hang')
    ending = first.works.prepareEnd(id).catch((e: unknown) => e)
    await until(() => first.works.view(id).reviewRunning, '리뷰 시작')
    await first.close()
    kit.forget(first)
  } finally {
    vi.stubEnv('FAKE_CLAUDE_REVIEW_FAIL', '')
  }
  expect(await ending).toBeInstanceOf(Error)
  const rec = JSON.parse((await first.store.readText(id, 'work.json')) ?? '') as Entry
  expect(rec.exported_head ?? null).toBeNull()
  expect(await exportsOf(first, id)).toEqual([false])
  expect((await first.store.readLedger()).length).toBe(ledger)

  const second = await kit.openApp(home)
  expect(await second.works.prepareEnd(id)).toEqual({ head })
  expect(second.works.view(id).evidence?.review).toMatchObject({ status: 'done' })
  expect(await exportsOf(second, id)).toEqual([false, true])
})

test('품질 기준 상태(V20): 기본 브랜치에 없으면 missing, [초안 만들기]는 작업 트리에 쓰고 덮지 않는다, 커밋하면 present, 깨지면 invalid', async () => {
  const repo = await makeRepo({
    files: {
      'package.json': JSON.stringify({ name: 'x', scripts: { test: 'node --test' } }),
      'package-lock.json': '{}\n',
      'src/a.js': 'export const a = 1\n',
    },
  })
  const app = await kit.openApp(await makeTempDir('relay-home-'))
  const { works } = app
  // origin/main의 기준을 읽는다(kit의 레포는 origin에 품질 기준이 있다)
  expect(await works.addProject(kit.repo.dir)).toMatchObject({
    quality: 'present',
    qualityRef: 'origin/main',
  })
  // origin이 없으면 로컬 기본 브랜치를 읽는다(화면은 push를 말하지 않는다)
  const project = await works.addProject(repo.dir)
  expect(project).toMatchObject({ quality: 'missing', qualityDraft: false, qualityRef: 'main' })
  expect(works.list().projects.find((p) => p.id === project.id)?.quality).toBe('missing')

  const target = join(repo.dir, '.relay', 'quality.json')
  expect(await works.draftQuality(project.id)).toEqual({ written: true, path: target })
  const parsed = parseQuality(await readFile(target, 'utf8'))
  if (!parsed.ok) throw new Error(parsed.errors.join('; '))
  expect(parsed.value.commands.acceptance?.run).toMatch(/^node --test --test-reporter=junit/)
  expect(parsed.value.auto.map((c) => c.id)).toEqual(['small'])
  // 이미 있으면 덮지 않는다
  await writeFile(target, '{ "사람이": "고침" }\n')
  expect(await works.draftQuality(project.id)).toEqual({ written: false, path: target })
  expect(await readFile(target, 'utf8')).toBe('{ "사람이": "고침" }\n')
  // 작업 트리에만 있는 기준은 쓰이지 않는다(V9: 기준은 base에서 읽음). 화면은 초안이 있다고 알린다
  await works.refreshProjects()
  expect(works.list().projects.find((p) => p.id === project.id)).toMatchObject({
    quality: 'missing',
    qualityDraft: true,
  })

  // 기본 브랜치에 깨진 기준을 커밋하면 invalid, 고쳐 커밋하면 present. 바뀌면 화면에 알린다
  await repo.commit('깨진 기준')
  await works.refreshProjects()
  const shown = () =>
    (app.emitted.filter((e) => e.event === EVENTS.projects).at(-1)?.payload as ProjectView[]).find(
      (p) => p.id === project.id,
    )
  expect(shown()).toMatchObject({ quality: 'invalid', qualityDraft: false })
  await repo.commit('기준 고침', { '.relay/quality.json': QUALITY_TEXT })
  await works.refreshProjects()
  expect(shown()).toMatchObject({ quality: 'present', qualityDraft: false })
  await expect(works.draftQuality('없는 프로젝트')).rejects.toThrow(/프로젝트가 없음/)
})

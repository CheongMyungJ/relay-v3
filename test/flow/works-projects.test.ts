// [흐름] 프로젝트의 품질 기준 상태와 [초안 만들기]·[초안 쓰기](V20, src/main/works-projects.ts): 기본 브랜치(origin이 있으면 origin)의
// 기준을 읽고, 초안은 작업 트리에만 쓰며 덮지 않고, 커밋하면 present, 깨지면 invalid. 바탕은 test/support/works-flow.ts.
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { parseQuality } from '../../src/core/quality.ts'
import { EVENTS, type ProjectView } from '../../src/shared/api.ts'
import { QUALITY_TEXT } from '../support/calc.ts'
import { makeRepo, makeTempDir } from '../support/repo.ts'
import { flowKit } from '../support/works-flow.ts'

const kit = flowKit()

test('품질 기준 상태(V20): 기본 브랜치에 없으면 missing, [초안 만들기]는 작업 트리에 쓰고 덮지 않는다, 커밋하면 present, 깨지면 invalid', async () => {
  const repo = await makeRepo({
    files: {
      'package.json': JSON.stringify({ name: 'x', scripts: { test: 'node --test' } }),
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
  // [초안 만들기]는 돌려 보기만 하고 쓰지 않는다. [초안 쓰기]가 쓴다(자세한 것은 works-draft.test.ts)
  await expect(works.writeQualityDraft(project.id, {})).rejects.toThrow(/먼저 \[초안 만들기\]/)
  expect(await works.draftQuality(project.id)).toMatchObject({ exists: false, fixes: [] })
  expect(await works.writeQualityDraft(project.id, {})).toEqual({ written: true, path: target })
  const parsed = parseQuality(await readFile(target, 'utf8'))
  if (!parsed.ok) throw new Error(parsed.errors.join('; '))
  expect(parsed.value.commands.acceptance?.run).toMatch(/^node --test --test-reporter=junit/)
  expect(parsed.value.auto.map((c) => c.id)).toEqual(['small'])
  // 이미 있으면 덮지 않는다
  await writeFile(target, '{ "사람이": "고침" }\n')
  expect(await works.draftQuality(project.id)).toMatchObject({ exists: true })
  expect(await works.writeQualityDraft(project.id, {})).toEqual({ written: false, path: target })
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

test('M3 장치 설정(V38): 장치마다 덮고, 모르는 장치나 참·거짓이 아닌 값은 거절하며 저장된다', async () => {
  const home = await makeTempDir('relay-home-')
  const app = await kit.openApp(home)
  const project = await app.works.addProject(kit.repo.dir)
  // 기본: 지식 잇기만 끔(V44)
  expect(project.settings.m3).toEqual({ knowledge: false, debt: true, tidy: true, promote: true })
  const on = await app.works.updateSettings(project.id, { m3: { knowledge: true } })
  expect(on.settings).toMatchObject({
    m3: { knowledge: true, debt: true, tidy: true, promote: true },
    auto_merge: false,
  })
  const tidy = await app.works.updateSettings(project.id, { m3: { tidy: false } })
  expect(tidy.settings.m3).toEqual({ knowledge: true, debt: true, tidy: false, promote: true })
  const promote = await app.works.updateSettings(project.id, { m3: { promote: false } })
  expect(promote.settings.m3).toEqual({ knowledge: true, debt: true, tidy: false, promote: false })
  await expect(
    app.works.updateSettings(project.id, { m3: { knowledge: 'no' } as never }),
  ).rejects.toThrow(/m3/)
  await expect(
    app.works.updateSettings(project.id, { m3: { rules: true } as never }),
  ).rejects.toThrow(/m3/)
  await app.close()
  kit.forget(app)
  const again = await kit.openApp(home)
  expect(again.works.list().projects[0]?.settings.m3).toEqual({
    knowledge: true,
    debt: true,
    tidy: false,
    promote: false,
  })
})

// [흐름] 지식 잇기(M3a, V38): 새 Work의 request.md 끝에 기준의 관련 지식 목록, 지침의 읽기·쓰기 사실, 계약 근거 knowledge의
// 확인, 증거의 knowledge 칸(바꾼 파일의 형식 오류는 관문의 사람 머지 사실, 아직 따르지 않는 곳은 알림), relay_check의 답.
// RELAY_M3=off(장기 평가의 relay3-m2 쪽)면 모두 M2 그대로다. 형식과 고르기의 자세한 것은 [단위] knowledge.test.ts.
import { beforeAll, expect, test } from 'vitest'
import { LIST_HEADING } from '../../src/engine/knowledge-format.ts'
import { makeTempDir } from '../support/repo.ts'
import {
  CONTRACT,
  FIX_COMMIT,
  flowKit,
  REQUEST,
  settled,
  type Entry,
} from '../support/works-flow.ts'

const kit = flowKit()
const { scenario, until } = kit

const CLAMP_RULE = `---
kind: rule
source: human
anchor: clamp
---
# clamp는 hi로 자른다

## 규칙

- 위로 넘는 값은 hi다.

## 아직 규칙을 따르지 않는 곳

- \`src/calc.js\`: 지금은 lo를 돌려준다
`
const LOGGING = `---
kind: fact
source: investigation
---
# 로그 형식

## 내용

로그는 JSON 한 줄이다.
`
/** 제목이 없는 새 항목: 형식 오류 */
const BROKEN = `---
kind: rule
source: human
---
## 규칙

- 아래로 넘는 값은 lo다.
`

const KNOWLEDGE_CONTRACT = {
  ...CONTRACT,
  lines: CONTRACT.lines.map((l) =>
    l.id === 'C1'
      ? {
          ...l,
          grounds: [
            ...l.grounds,
            { type: 'knowledge', id: 'docs/knowledge/calc/clamp.md' },
            { type: 'knowledge', id: 'calc/none' },
          ],
        }
      : l,
  ),
}

const STEPS = [
  { do: 'mcp', tool: 'submit_contract', args: KNOWLEDGE_CONTRACT },
  { ...FIX_COMMIT, files: { ...FIX_COMMIT.files, 'docs/knowledge/calc/lo.md': BROKEN } },
  { do: 'stop' },
  { do: 'waitInput' },
]

beforeAll(async () => {
  await kit.repo.commit('지식', {
    'docs/knowledge/calc/clamp.md': CLAMP_RULE,
    'docs/knowledge/logging.md': LOGGING,
  })
  await kit.repo.git('push', '--quiet', 'origin', 'main')
})

async function run(m3?: string) {
  await scenario(STEPS)
  const app = await kit.openApp(await makeTempDir('relay-home-'), m3 === undefined ? {} : { m3 })
  const { works } = app
  const project = await works.addProject(kit.repo.dir)
  const { id } = await works.createWork({ project: project.id, request: REQUEST })
  await until(() => works.view(id).state === 'awaiting_approval', '계약 제출')
  const groundings = works.view(id).groundings ?? []
  await works.approveContract(id)
  await until(
    async () => (await kit.fake()).some((e) => e.type === 'hook' && e.event === 'Stop'),
    'Stop',
  )
  await until(() => {
    const v = works.view(id)
    return v.evidence !== null && v.evidence.review !== null && settled(v)
  }, '증거')
  const start = (await kit.fake()).find((e) => e.type === 'start') as Entry
  return { app, works, id, groundings, instructions: String(start.instructions) }
}

test('켜면: 관련 지식 목록, 지침, 근거 확인, 증거의 knowledge와 형식 오류의 사람 머지, relay_check', async () => {
  const { app, works, id, groundings, instructions } = await run()
  expect(works.record(id).m3).toEqual({ knowledge: true })
  const request = (await app.store.readText(id, 'request.md')) ?? ''
  expect(request.startsWith(`${REQUEST}\n\n${LIST_HEADING}\n`)).toBe(true)
  expect(request).toContain('- clamp는 hi로 자른다 — `docs/knowledge/calc/clamp.md`')
  expect(request).not.toContain('로그 형식')
  expect(instructions).toContain('If `docs/knowledge/` exists, read the entries related')
  expect(instructions).toContain("Of the contract's `human_rules`, save the ones later work")

  expect(groundings.filter((g) => g.ground.type === 'knowledge')).toMatchObject([
    { line: 'C1', ok: true, detail: '지식 항목이 있음 (docs/knowledge/calc/clamp.md)' },
    { line: 'C1', ok: false, detail: '지식 항목이 head에 없음 (docs/knowledge/calc/none.md)' },
  ])

  const v = works.view(id)
  expect(v.evidence?.knowledge).toEqual({
    changed: ['docs/knowledge/calc/lo.md'],
    issues: [
      {
        path: 'docs/knowledge/calc/clamp.md',
        kind: 'not_yet',
        detail:
          '이 diff가 `src/calc.js`를 바꿨는데 항목의 `## 아직 규칙을 따르지 않는 곳`에 그대로 있고 항목은 고치지 않음',
      },
      { path: 'docs/knowledge/calc/lo.md', kind: 'format', detail: '첫 `# ` 제목 줄 없음' },
    ],
  })
  expect(v.gate?.reasons).toContain(
    '지식 형식 오류: docs/knowledge/calc/lo.md (첫 `# ` 제목 줄 없음)',
  )
  expect(v.gate?.reasons.some((r) => r.includes('clamp.md'))).toBe(false)

  const reply = (await works.onControl(id, 'relay_check', {}, new AbortController().signal)) as {
    knowledge?: unknown
    summary: string[]
  }
  expect(reply.knowledge).toEqual(v.evidence?.knowledge)
  expect(reply.summary).toContain('knowledge format issue: docs/knowledge/calc/lo.md')
})

test('RELAY_M3=off: 목록·지침·근거 확인·knowledge 칸 없이 M2 그대로', async () => {
  const { app, works, id, groundings, instructions } = await run('off')
  expect(works.record(id).m3).toEqual({ knowledge: false })
  expect(await app.store.readText(id, 'request.md')).toBe(`${REQUEST}\n`)
  expect(instructions).not.toContain('docs/knowledge/')
  expect(groundings.filter((g) => g.ground.type === 'knowledge').map((g) => g.detail)).toEqual([
    '지식 잇기가 꺼져 있어 확인하지 못함',
    '지식 잇기가 꺼져 있어 확인하지 못함',
  ])
  const v = works.view(id)
  expect(v.evidence?.knowledge).toBeNull()
  expect(v.gate?.reasons.some((r) => r.startsWith('지식'))).toBe(false)
})

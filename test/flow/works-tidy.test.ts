// [흐름] 곁들일 정리(M3c, V41): 새 Work의 request.md 끝에 기준의 빚 목록(나이 순)과 지침의 문단, 계약 tidy로 집은 항목은 다른
// Work의 목록에 '진행 중: 잡힘(<Work id>)'(Work가 끝나면 풀림), 증거의 tidy 칸(갚은 빚, 건드린 곳의 빚)은 알림이라 관문에
// 들어가지 않고, relay_check의 답에도 있다. RELAY_M3=off(장기 평가의 relay3-m2 쪽)면 목록·지침·칸 없이 M2.2 그대로다. 판정의
// 자세한 것은 [단위] tidy.test.ts, git을 읽는 쪽은 [흐름] check-tidy.test.ts.
import { beforeAll, expect, test } from 'vitest'
import { formatDebt } from '../../src/core/debt.ts'
import type { DebtItem } from '../../src/core/types.ts'
import { TIDY_TITLE } from '../../src/engine/tidy.ts'
import { baseDebt } from '../../src/main/works-worktree.ts'
import { makeTempDir } from '../support/repo.ts'
import { CONTRACT, FIX_COMMIT, flowKit, REQUEST, settled } from '../support/works-flow.ts'

const kit = flowKit()
const { scenario, until } = kit

const item = (id: string, o: Partial<DebtItem>): DebtItem => ({
  id,
  anchor: { path: 'src/calc.js' },
  kind: 'tidy',
  source: 'w0',
  reason: `${id}의 까닭`,
  created: '2026-01-01',
  ...o,
})

const DEBT = [
  item('calc-names', { reason: 'clamp의 이름이 짧음\n자세한 것', created: '2026-03-01' }),
  item('calc-rule', { kind: 'rule_violation', created: '2026-02-01' }),
  item('test-gap', { kind: 'test_gap', anchor: { path: 'src/other.js' } }),
]

const STEPS = [
  { do: 'mcp', tool: 'submit_contract', args: { ...CONTRACT, tidy: ['calc-names'] } },
  { ...FIX_COMMIT, files: { ...FIX_COMMIT.files, '.relay/debt/calc-names.md': null } },
  { do: 'stop' },
  { do: 'waitInput' },
]

beforeAll(async () => {
  await kit.repo.commit(
    '빚',
    Object.fromEntries(DEBT.map((d) => [`.relay/debt/${d.id}.md`, formatDebt(d)])),
  )
  await kit.repo.git('push', '--quiet', 'origin', 'main')
})

async function open(m3?: string) {
  await scenario(STEPS)
  const app = await kit.openApp(await makeTempDir('relay-home-'), m3 === undefined ? {} : { m3 })
  const project = await app.works.addProject(kit.repo.dir)
  return { app, works: app.works, project: project.id }
}

/** Work를 만들어 계약을 승인하고 첫 증거(리뷰까지)를 기다린다 */
async function measured(works: Awaited<ReturnType<typeof open>>['works'], project: string) {
  const { id } = await works.createWork({ project, request: REQUEST })
  await until(() => works.view(id).state === 'awaiting_approval', '계약 제출')
  await works.approveContract(id)
  await until(() => {
    const v = works.view(id)
    return v.evidence?.review != null && settled(v)
  }, '증거')
  return id
}

test('켜면: 빚 목록과 지침, 증거의 갚은 빚·건드린 곳의 빚(알림), 잡힘은 다른 Work에 진행 중', async () => {
  const { app, works, project } = await open()
  const a = await measured(works, project)
  // 기본 설정(V44: 지식 잇기만 끔)
  expect(works.record(a).m3).toEqual({ knowledge: false, debt: true, tidy: true, promote: true })
  const request = (await app.store.readText(a, 'request.md')) ?? ''
  expect(request.startsWith(`${REQUEST}\n\n${TIDY_TITLE}\n`)).toBe(true)
  expect(request.split('\n').filter((l) => l.startsWith('- '))).toEqual([
    '- `src/other.js`: test-gap의 까닭 (test-gap, test_gap, 2026-01-01)',
    '- `src/calc.js`: calc-rule의 까닭 (calc-rule, rule_violation, 2026-02-01)',
    '- `src/calc.js`: clamp의 이름이 짧음 (calc-names, tidy, 2026-03-01)',
  ])
  const start = (await kit.fake()).find((e) => e.type === 'start')
  expect(String(start?.instructions)).toContain('Leave items marked as in progress')
  // [계약]의 곁들일 정리가 읽는 기준 장부: Work가 항목 파일을 지운 뒤에도 기준의 항목
  expect((await baseDebt(works.record(a))).map((d) => d.id).sort()).toEqual(
    DEBT.map((d) => d.id).sort(),
  )
  // 리뷰어에게는 사람이 쓴 요청만 간다: relay가 붙인 빚 목록은 사람의 요청이 아니다
  const prompt = String((await kit.fake()).find((e) => e.type === 'review')?.prompt)
  expect(prompt).toContain(`> ${REQUEST.split('\n')[0]}`)
  expect(prompt).not.toContain('이 레포의 빚')
  expect(prompt).not.toContain('test-gap의 까닭')

  const v = works.view(a)
  expect(v.evidence?.tidy).toMatchObject({
    taken: ['calc-names'],
    items: [
      { id: 'calc-names', status: 'paid', detail: '항목 파일을 지움' },
      { id: 'calc-rule', status: 'unknown' },
    ],
    max: 100,
  })
  expect(v.evidence?.tidy?.lines).toBeGreaterThan(0)
  expect(v.gate?.reasons.some((r) => r.includes('빚'))).toBe(false)
  const reply = (await works.onControl(a, 'relay_check', {}, new AbortController().signal)) as {
    tidy?: unknown
  }
  expect(reply.tidy).toEqual(v.evidence?.tidy)

  // 다른 Work의 목록: A가 집은 항목은 진행 중. A가 끝나면 풀린다
  const b = (await works.createWork({ project, request: REQUEST })).id
  const listed = (await app.store.readText(b, 'request.md')) ?? ''
  expect(listed).toContain(`(calc-names, tidy, 2026-03-01, 진행 중: 잡힘(${a}))`)
  expect(listed).toContain('(test-gap, test_gap, 2026-01-01)\n')
  await works.abandon(a)
  const c = (await works.createWork({ project, request: REQUEST })).id
  expect((await app.store.readText(c, 'request.md')) ?? '').not.toContain('진행 중: 잡힘')
})

test('RELAY_M3=off: 목록·지침·tidy 칸 없이 M2.2 그대로', async () => {
  const { app, works, project } = await open('off')
  const id = await measured(works, project)
  expect(works.record(id).m3).toEqual({
    knowledge: false,
    debt: false,
    tidy: false,
    promote: false,
  })
  expect(await app.store.readText(id, 'request.md')).toBe(`${REQUEST}\n`)
  const start = (await kit.fake()).find((e) => e.type === 'start')
  expect(String(start?.instructions)).not.toContain('tidy_max_lines')
  expect(works.view(id).evidence?.tidy).toBeNull()
})

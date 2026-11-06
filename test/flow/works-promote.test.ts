// [흐름] 규칙 승격(M3d, V42): 지침의 한 문단, 증거의 knowledge 칸에서 기준에서 승격된 규칙(check가 quality.json rules에
// 있음)의 허용 목록을 세션이 늘리면 관문의 사람 머지 사실이고, 말로만 남은 규칙은 알림이다. relay_check의 답에도 있다.
// RELAY_M3=off(장기 평가의 relay3-m2 쪽)면 지침과 칸 없이 M2.2 그대로다. 판정의 자세한 것은 [단위] promote.test.ts, git을
// 읽는 쪽과 rule_violation의 갚음은 [흐름] check-promote.test.ts.
import { beforeAll, expect, test } from 'vitest'
import { makeTempDir } from '../support/repo.ts'
import { QUALITY } from '../support/calc.ts'
import { CONTRACT, FIX_COMMIT, flowKit, REQUEST, settled } from '../support/works-flow.ts'

const kit = flowKit()
const { scenario, until } = kit

const rule = (title: string, check: string | null, notYet: string[]) =>
  [
    '---',
    'kind: rule',
    'source: human',
    ...(check === null ? [] : [`check: ${check}`]),
    '---',
    `# ${title}`,
    '',
    '## 규칙',
    '',
    `- ${title}`,
    '',
    '## 아직 규칙을 따르지 않는 곳',
    '',
    ...notYet.map((p) => `- \`${p}\``),
    '',
  ].join('\n')

const CONSOLE = 'docs/knowledge/console.md'

const STEPS = [
  { do: 'mcp', tool: 'submit_contract', args: CONTRACT },
  // 세션이 승격된 규칙의 허용 목록에 고친 파일을 더한다
  {
    ...FIX_COMMIT,
    files: {
      ...FIX_COMMIT.files,
      [CONSOLE]: rule('콘솔', 'no-console', ['src/old.js', 'src/calc.js']),
    },
  },
  { do: 'stop' },
  { do: 'waitInput' },
]

beforeAll(async () => {
  await kit.repo.commit('승격된 규칙', {
    '.relay/quality.json': `${JSON.stringify({ ...QUALITY, rules: ['no-console'] }, null, 2)}\n`,
    [CONSOLE]: rule('콘솔', 'no-console', ['src/old.js']),
    'docs/knowledge/naming.md': rule('이름', null, []),
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
  await works.approveContract(id)
  await until(() => {
    const v = works.view(id)
    return v.evidence?.review != null && settled(v)
  }, '증거')
  const start = (await kit.fake()).find((e) => e.type === 'start')
  return { works, id, instructions: String(start?.instructions) }
}

test('켜면: 지침의 문단, 늘어난 허용 목록은 사람 머지 사실, 말로만은 알림, relay_check', async () => {
  const { works, id, instructions } = await run()
  expect(works.record(id).m3.promote).toBe(true)
  expect(instructions).toContain('Rule checks: when you write or edit a `kind: rule` entry')
  const v = works.view(id)
  const promoted = v.evidence?.knowledge?.issues.filter((i) => ['allow', 'spoken'].includes(i.kind))
  expect(promoted).toEqual([
    {
      path: CONSOLE,
      kind: 'allow',
      detail:
        '검사 `no-console`의 허용 목록(`## 아직 규칙을 따르지 않는 곳`)에 `src/calc.js`가 더해짐: 줄어들기만 한다',
    },
    { path: 'docs/knowledge/naming.md', kind: 'spoken', detail: '검사(`check:`)가 없음' },
  ])
  expect(v.gate?.reasons).toContain(
    '규칙의 허용 목록이 늚: docs/knowledge/console.md (검사 `no-console`의 허용 목록(`## 아직 규칙을 따르지 않는 곳`)에 `src/calc.js`가 더해짐: 줄어들기만 한다)',
  )
  expect(v.gate?.reasons.some((r) => r.includes('naming.md'))).toBe(false)
  const reply = (await works.onControl(id, 'relay_check', {}, new AbortController().signal)) as {
    knowledge?: unknown
  }
  expect(reply.knowledge).toEqual(v.evidence?.knowledge)
})

test('RELAY_M3=off: 지침과 knowledge 칸 없이 M2.2 그대로', async () => {
  const { works, id, instructions } = await run('off')
  expect(works.record(id).m3.promote).toBe(false)
  expect(instructions).not.toContain('Rule checks')
  expect(works.view(id).evidence?.knowledge).toBeNull()
  expect(works.view(id).gate?.reasons.some((r) => r.includes('허용 목록'))).toBe(false)
})

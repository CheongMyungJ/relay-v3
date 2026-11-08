// [흐름] 구조 규칙 래칫(V74)이 Work를 끝까지 지난다: 세션이 고침과 함께 `src`에서 `scripts`를 가져오면 [증거]의 래칫이
// 나빠짐이고 관문이 사람 머지로 보낸다, 쉬는 세션에 그 import를 가리키는 되먹임이 가고(V24), 사람이 [빚으로 남기고 머지]하면
// 그 파일에 단 빚이 커밋된다(V40). 읽기·비교는 [단위] imports·import-rules.test.ts, 실제 git에서 재는 것은 [어댑터]
// structure.test.ts. 바탕은 test/support/works-flow.ts(기준 브랜치의 quality.json에 구조 규칙을 더한다, V9).
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { calc, QUALITY } from '../support/calc.ts'
import { makeTempDir } from '../support/repo.ts'
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

const DEBT_ID = 'r-structure-src-calc-js'

const WHERE = 'src/calc.js:1 → scripts/tool.js (src는 scripts를 가져오지 않음)'

/** 고침과 함께 src가 scripts를 가져온다 */
const CROSSED = {
  ...FIX_COMMIT,
  files: {
    ...FIX_COMMIT.files,
    'src/calc.js': `import { tool } from '../scripts/tool.js'\nexport const used = tool\n${calc('hi')}`,
    'scripts/tool.js': 'export const tool = 1\n',
  },
}

test('세션이 금지된 import를 더한 Work: [증거]의 래칫 나빠짐 → 되먹임 → [빚으로 남기고 머지]', async () => {
  const q = {
    ...QUALITY,
    ratchets: [
      ...QUALITY.ratchets,
      { id: 'structure', kind: 'imports', forbid: [{ from: ['src'], to: ['scripts'] }] },
    ],
  }
  await kit.repo.commit('구조 규칙 래칫', {
    '.relay/quality.json': `${JSON.stringify(q, null, 2)}\n`,
  })
  await kit.repo.git('push', '--quiet', 'origin', 'main')
  await scenario([
    { do: 'mcp', tool: 'submit_contract', args: CONTRACT },
    CROSSED,
    ...PUSH_AND_PR,
    { do: 'stop' },
    { do: 'waitInput' },
  ])
  const app = await kit.openApp(await makeTempDir('relay-home-'))
  const { works } = app
  const project = await works.addProject(kit.repo.dir)
  const { id } = await works.createWork({ project: project.id, request: REQUEST })
  await until(() => works.view(id).state === 'awaiting_approval', '계약 제출')
  await works.approveContract(id)

  // [증거]: 래칫 줄과 관문의 까닭
  await until(
    () =>
      works.find(id)?.exports[0]?.exported_head === works.view(id).head && settled(works.view(id)),
    'PR의 내보내기 증거',
  )
  const v = works.view(id)
  const head = v.head ?? ''
  const ratchet = v.evidence?.ratchets.find((r) => r.id === 'structure')
  const detail = `구조 규칙을 어긴 import 0 → 1, 새로 어김 1: ${WHERE}`
  expect(ratchet).toEqual({
    id: 'structure',
    status: 'worse',
    base: 0,
    head: 1,
    detail,
    offenders: [{ path: 'src/calc.js', head: 1 }],
    where: [WHERE],
  })
  expect(v.gate?.reasons).toContain(`래칫 나빠짐: structure (${detail})`)
  // 다른 래칫은 그대로(옛 래칫의 동작은 바뀌지 않는다)
  expect(v.evidence?.ratchets.map((r) => [r.id, r.status])).toEqual([
    ['tests', 'better'],
    ['file-size', 'same'],
    ['structure', 'worse'],
  ])

  // 되먹임: 쉬는 세션에 그 줄을 가리킨다
  await until(() => works.record(id).feedback.rounds === 1, '되먹임')
  const sent = works.record(id).feedback.sent[0]
  expect(sent).toMatchObject({ n: 1, by: 'relay', head })
  const text = await readFile(app.store.feedbackPath(id, 1), 'utf8')
  expect(text).toContain(`**Ratchet \`structure\`: worse (base 0, head 1).**\n- ${WHERE}`)

  // 빚: 고치지 않은 채 머지하면 그 파일에 단 빚을 남긴다
  await works.idle()
  expect(await works.merge(id, undefined, { debt: true })).toEqual({ ok: true })
  const item = await readFile(join(works.record(id).worktree, `.relay/debt/${DEBT_ID}.md`), 'utf8')
  expect(item).toContain('anchor.path: src/calc.js')
  expect(item).toContain('anchor.metric: structure')
  expect(item).toContain('kind: accepted_regression')
  const ledger = (await app.store.readLedger()).filter((e) => e.work === id)
  expect(ledger.find((e) => e.head === head)?.worse?.map((r) => r.id)).toEqual(['structure'])
  expect(ledger.at(-1)).toMatchObject({ accepted: { ratchets: ['structure'], debt: [DEBT_ID] } })
})

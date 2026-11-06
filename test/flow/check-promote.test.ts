// [흐름] 증거의 규칙 승격(M3d, V42, engine/promote.ts checkPromote와 tidy.ts의 rule_violation): 실제 git 임시 레포에서 기준의
// 품질 기준 rules로 head의 말로만 남은 규칙을 찾고, 기준에서 승격된 규칙의 허용 목록이 늘었는지 보고, 곁들일 정리가 켜졌으면
// rule_violation 빚을 허용 목록과 빠른 명령으로 가른다. 장치마다 끄고 켠다. 자세한 판정은 [단위] promote.test.ts, 관문은
// [단위] gate.test.ts.
import { afterAll, beforeAll, expect, test } from 'vitest'
import { formatDebt } from '../../src/core/debt.ts'
import { check } from '../../src/engine/check.ts'
import { NOW, QUALITY } from '../support/calc.ts'
import { cleanupAll, makeRepo, makeTempDir, type TestRepo } from '../support/repo.ts'

afterAll(cleanupAll)

const rule = (title: string, check: string | null, notYet: string[] = []) =>
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
    ...(notYet.length === 0
      ? []
      : ['', '## 아직 규칙을 따르지 않는 곳', '', ...notYet.map((p) => `- \`${p}\``)]),
    '',
  ].join('\n')

const violation = (id: string, path: string): [string, string] => [
  `.relay/debt/${id}.md`,
  formatDebt({
    id,
    anchor: { path, metric: 'no-console' },
    kind: 'rule_violation',
    source: 'w0',
    reason: `${path}가 콘솔에 씀`,
    created: '2026-01-01',
  }),
]

const quality = (rules: string[]) => JSON.stringify({ ...QUALITY, rules })

let repo: TestRepo
let head: string

beforeAll(async () => {
  repo = await makeRepo({
    files: {
      '.relay/quality.json': quality(['no-console']),
      'src/a.js': 'console.log(1)\nexport const a = 1\n',
      'src/b.js': 'console.log(2)\nexport const b = 1\n',
      'src/c.js': 'export const c = 1\n',
      'src/a.test.js': "import { test } from 'node:test'\ntest('a', () => {})\n",
      'docs/knowledge/console.md': rule('콘솔에 쓰지 않는다', 'no-console', [
        'src/a.js',
        'src/b.js',
      ]),
      'docs/knowledge/naming.md': rule('이름은 영어로', null),
      'docs/knowledge/eval.md': rule('eval을 쓰지 않는다', 'no-eval'),
      ...Object.fromEntries([
        violation('console-a', 'src/a.js'),
        violation('console-b', 'src/b.js'),
      ]),
    },
  })
  await repo.branch('feature')
  // a.js를 고쳐 목록에서 빼고, b.js는 그대로 두고, c.js에 새로 콘솔을 써 목록에 더했다. rules에 no-eval을 더했다
  head = await repo.commit('콘솔 정리', {
    '.relay/quality.json': quality(['no-console', 'no-eval']),
    'src/a.js': 'export const a = 1\n',
    'src/b.js': 'console.log(2)\nexport const b = 2\n',
    'src/c.js': 'console.log(3)\nexport const c = 1\n',
    'docs/knowledge/console.md': rule('콘솔에 쓰지 않는다', 'no-console', ['src/b.js', 'src/c.js']),
  })
})

const run = async (o: { knowledge?: boolean; tidy?: boolean; promote?: boolean }) =>
  check({
    repo: repo.dir,
    base: 'main',
    head,
    home: await makeTempDir('relay-home-'),
    now: NOW,
    ...o,
  })

test('켜면: 늘어난 허용 목록(allow), 말로만 남은 규칙(spoken), rule_violation의 갚음', async () => {
  const bundle = await run({ knowledge: true, tidy: true, promote: true })
  expect(bundle.missing.filter((m) => /규칙|지식|빚/.test(m))).toEqual([])
  expect(bundle.commands.map((c) => [c.id, c.outcome])).toContainEqual(['unit', 'pass'])
  const promoted = bundle.knowledge?.issues.filter((i) => i.kind === 'allow' || i.kind === 'spoken')
  expect(promoted).toEqual([
    {
      path: 'docs/knowledge/console.md',
      kind: 'allow',
      detail:
        '검사 `no-console`의 허용 목록(`## 아직 규칙을 따르지 않는 곳`)에 `src/c.js`가 더해짐: 줄어들기만 한다',
    },
    {
      path: 'docs/knowledge/eval.md',
      kind: 'spoken',
      detail: '검사 `no-eval`가 기준의 quality.json rules에 없음(이 diff가 더함: 머지 뒤 승격)',
    },
    { path: 'docs/knowledge/naming.md', kind: 'spoken', detail: '검사(`check:`)가 없음' },
  ])
  expect(bundle.tidy?.items.map((i) => [i.id, i.status, i.detail])).toEqual([
    ['console-a', 'paid', '`src/a.js`가 허용 목록에서 빠지고 빠른 명령이 통과 (항목 파일이 남음)'],
    [
      'console-b',
      'open',
      '`src/b.js`가 아직 허용 목록에 있음: docs/knowledge/console.md (항목 파일이 남음)',
    ],
  ])
})

test('규칙 승격만 켜면 knowledge에 그 장치의 문제만, 끄면 승격의 문제가 없고 rule_violation은 모름', async () => {
  const only = await run({ promote: true })
  expect(only.knowledge?.changed).toEqual(['docs/knowledge/console.md'])
  expect(only.knowledge?.issues.map((i) => i.kind)).toEqual(['allow', 'spoken', 'spoken'])
  expect(only.tidy).toBeNull()

  const off = await run({ knowledge: true, tidy: true })
  expect(off.knowledge?.issues.some((i) => i.kind === 'allow' || i.kind === 'spoken')).toBe(false)
  expect(off.tidy?.items.map((i) => i.status)).toEqual(['unknown', 'unknown'])
  expect(off.tidy?.items[0]?.detail).toBe(
    '규칙 승격(M3d)이 꺼져 있어 가르지 못함 (항목 파일이 남음)',
  )

  expect((await run({})).knowledge).toBeNull()
})

// [흐름] 증거의 지식 확인(V38, engine/knowledge.ts checkKnowledge): 실제 git 임시 레포에서 바꾼 지식 파일의 형식(지식 경로가
// 아닌 .md도), 옮긴 항목, anchor가 head의 코드에 있는지(지식 폴더 안의 낱말은 세지 않음), 바꾸지 않은 항목의 anchor를 이
// diff가 지움, 아직 따르지 않는 곳의 경로를 바꾸고 항목은 그대로. 끄면 knowledge는 null이다. 형식 규칙의 자세한 것은
// [단위] knowledge.test.ts, 관문은 [단위] gate.test.ts.
import { afterAll, beforeAll, expect, test } from 'vitest'
import { check } from '../../src/engine/check.ts'
import { NOW } from '../support/calc.ts'
import { cleanupAll, makeRepo, makeTempDir, type TestRepo } from '../support/repo.ts'

afterAll(cleanupAll)

const entry = (kind: string, title: string, o: { anchor?: string; more?: string } = {}) =>
  [
    '---',
    `kind: ${kind}`,
    'source: human',
    ...(o.anchor ? [`anchor: ${o.anchor}`] : []),
    '---',
    `# ${title}`,
    '',
    kind === 'rule' ? '## 규칙' : '## 내용',
    '',
    '- 본문',
    o.more ?? '',
  ].join('\n')

let repo: TestRepo
let head: string

beforeAll(async () => {
  repo = await makeRepo({
    files: {
      'src/order.js':
        'export function totalOf(o) {\n  return o.sum\n}\nexport const legacyFee = 1\n',
      'src/fee.js': 'export const fee = 2\n',
      'docs/knowledge/README.md': '# 지식\n',
      'docs/knowledge/old.md': entry('fact', '옛 자리'),
      'docs/knowledge/order/total.md': entry('rule', '합계', {
        anchor: 'order.totalOf',
        more: '\n## 아직 규칙을 따르지 않는 곳\n\n- `src/fee.js`: 옛 계산\n',
      }),
      'docs/knowledge/fee.md': entry('rule', '옛 수수료', { anchor: 'legacyFee' }),
    },
  })
  await repo.branch('feature')
  head = await repo.commit('바꿈', {
    'src/order.js': 'export function totalOf(o) {\n  return o.sum + 1\n}\n',
    'src/fee.js': 'export const fee = 3\n',
    'docs/knowledge/README.md': '# 지식 폴더\n',
    'docs/knowledge/old.md': null,
    'docs/knowledge/order/moved.md': entry('fact', '옛 자리'),
    'docs/knowledge/order/new.md': entry('rule', '새 규칙', { anchor: 'nowhere' }),
    'docs/knowledge/order/deep/x.md': entry('fact', '깊음'),
    'docs/knowledge/order/note.md': 'nowhere\n',
  })
})

test('바꾼 지식 파일, 형식, anchor, 아직 따르지 않는 곳', async () => {
  const home = await makeTempDir('relay-home-')
  const bundle = await check({
    repo: repo.dir,
    base: 'main',
    head,
    home,
    now: NOW,
    knowledge: true,
  })
  expect(bundle.knowledge?.changed.sort()).toEqual([
    'docs/knowledge/order/deep/x.md',
    'docs/knowledge/order/moved.md',
    'docs/knowledge/order/new.md',
    'docs/knowledge/order/note.md',
  ])
  const issues = bundle.knowledge?.issues.map((i) => [i.path, i.kind, i.detail]) ?? []
  expect(issues).toContainEqual([
    'docs/knowledge/order/deep/x.md',
    'format',
    expect.stringContaining('지식 파일 경로가 아님'),
  ])
  expect(issues).toContainEqual([
    'docs/knowledge/order/note.md',
    'format',
    expect.stringContaining('머리글 없음'),
  ])
  expect(issues).toContainEqual([
    'docs/knowledge/order/new.md',
    'anchor',
    'anchor `nowhere`가 head의 코드에 없음',
  ])
  expect(issues).toContainEqual([
    'docs/knowledge/fee.md',
    'anchor',
    '이 diff가 anchor `legacyFee`를 코드에서 지웠는데 항목은 그대로',
  ])
  expect(issues).toContainEqual([
    'docs/knowledge/order/total.md',
    'not_yet',
    expect.stringContaining('`src/fee.js`'),
  ])
  // 옮긴 항목은 형식이 맞고, 바꾸지 않은 항목의 anchor(order.totalOf)는 코드에 있어 문제가 아니다
  expect(issues.filter(([p]) => p === 'docs/knowledge/order/moved.md')).toEqual([])
  expect(
    issues.filter(([p, k]) => p === 'docs/knowledge/order/total.md' && k === 'anchor'),
  ).toEqual([])
  expect(issues).toHaveLength(5)
})

test('끄면(기본) knowledge는 null이다', async () => {
  const home = await makeTempDir('relay-home-')
  const bundle = await check({ repo: repo.dir, base: 'main', head, home, now: NOW })
  expect(bundle.knowledge).toBeNull()
})

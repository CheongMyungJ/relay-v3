// [흐름] 지킴 시험이 기준에서 불러지지 않을 때(V33): 실제 git 임시 레포와 node:test에서 지킴 시험이 새 함수를 부르는 시험과
// 한 파일에 있으면, 기준에서 그 파일을 불러오지 못해 지킴 줄이 증거 없음이고 고칠 길이 붙는다. 판정의 자세한 규칙은
// [단위] lines.test.ts, 글은 gate.test.ts·review-feedback.test.ts. 여기서는 실제 러너의 출력에서 이어지는 것만 본다.

import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { examplesFileText, parseContract } from '../../src/core/contract.ts'
import { openItems } from '../../src/core/gate.ts'
import { feedbackFacts } from '../../src/core/review.ts'
import type { Contract, EvidenceBundle } from '../../src/core/types.ts'
import { check } from '../../src/engine/check.ts'
import { calc, NOW, QUALITY_TEXT, TESTS_BASE } from '../support/calc.ts'
import { cleanupAll, makeRepo, makeTempDir, type TestRepo } from '../support/repo.ts'

afterAll(cleanupAll)

const CONTRACT = {
  version: 1,
  id: 'fix-clamp',
  goal: 'clamp가 hi보다 큰 값을 hi로 자르고 빼기를 더한다',
  lines: [
    {
      id: 'C1',
      kind: 'new',
      text: '빼기를 더한다',
      grounds: [{ type: 'request', quote: '빼기도' }],
      examples: ['C1.1'],
      check: 'test',
    },
    {
      id: 'C2',
      kind: 'keep',
      text: '더하기는 그대로',
      grounds: [{ type: 'guess' }],
      examples: ['C2.1'],
      check: 'test',
    },
  ],
  examples: [
    { id: 'C1.1', input: [5, 3], output: 2 },
    { id: 'C2.1', input: [2, 3], output: 5 },
  ],
  approved_by: 'human',
}

let repo: TestRepo
let contract: Contract
let bundle: EvidenceBundle

beforeAll(async () => {
  const parsed = parseContract(JSON.stringify(CONTRACT))
  if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
  contract = parsed.value
  repo = await makeRepo({
    files: {
      'package.json': '{ "name": "calc", "private": true, "type": "module" }\n',
      '.gitignore': '.relay-out/\n',
      '.relay/quality.json': QUALITY_TEXT,
      'src/calc.js': calc('lo'),
      'test/calc.test.js': TESTS_BASE,
    },
  })
  await repo.branch('sub')
  // 지킴 시험(TESTS_BASE의 [fix-clamp:C2.1])과 새 함수 sub를 부르는 시험이 한 파일에 있다
  await repo.commit('빼기를 더함', {
    'src/calc.js': `${calc('lo')}\nexport function sub(a, b) {\n  return a - b\n}\n`,
    'test/calc.test.js': `${TESTS_BASE}
import { sub } from '../src/calc.js'

test('빼기 [fix-clamp:C1.1]', () => {
  assert.equal(sub(5, 3), 2)
})
`,
    '.relay/examples/fix-clamp.json': examplesFileText(contract),
  })
  const home = await makeTempDir('relay-home-')
  const contractPath = join(await makeTempDir('relay-work-'), 'contract.json')
  await writeFile(contractPath, JSON.stringify(CONTRACT))
  bundle = await check({ repo: repo.dir, base: 'main', head: 'sub', contractPath, home, now: NOW })
})

test('지킴 줄은 증거 없음 그대로이고, 기준에서 불러오지 못했다고 적고 고칠 길을 붙인다', () => {
  const keep = bundle.lines?.[1]
  expect(keep).toMatchObject({
    line: 'C2',
    status: 'missing_evidence',
    examples: [{ id: 'C2.1', head: 'passed', base: 'missing' }],
    fix: { kind: 'keep_base_api', examples: ['C2.1'] },
  })
  expect(keep?.detail).toContain('기준에서 시험 파일을 불러오지 못함')
  expect(bundle.lines?.[0]).toMatchObject({ line: 'C1', status: 'met' })
  expect(bundle.lines?.[0]).not.toHaveProperty('fix')
})

test('[끝내기] 상자의 열린 것과 되먹임·relay_check의 사실(feedbackFacts)에 같은 고칠 길이 간다', async () => {
  const open = openItems(bundle, contract, await repo.sha('sub'))
  expect(open.find((f) => f.startsWith('줄 C2 증거 없음'))).toContain(
    '지킴 시험은 기준에 있는 API만 불러야 한다. 새 함수를 부르는 시험과 다른 파일에 둔다',
  )
  const fact = feedbackFacts(bundle).find((f) => f.key === 'line:C2:missing_evidence')
  expect(fact?.text).toContain('No base result for C2.1: a test file failed to load on the base.')
  expect(fact?.text).toContain('A keep test may call only the API the base already has')
})

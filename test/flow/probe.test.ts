// [흐름] 제출 때 기준 확인(V28, engine/probe.ts): 실제 git 임시 레포의 기준 checkout에 head의 바뀐 시험 파일과 제출된 계약의
// 정규 예시 자료를 얹고 수용 명령(node:test)을 한 번 돈다. 줄 규칙은 [단위] probe.test.ts, 제출 창구는 works-probe.test.ts.
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { parseContract } from '../../src/core/contract.ts'
import type { Contract } from '../../src/core/types.ts'
import { probeContract } from '../../src/engine/probe.ts'
import { calc, JUNIT, QUALITY_TEXT, TESTS_BASE } from '../support/calc.ts'
import { cleanupAll, makeRepo, makeTempDir, nodeCommand, type TestRepo } from '../support/repo.ts'

afterAll(cleanupAll)

const ID = 'fix-clamp-ab12'

function contract(c1: [unknown, unknown], c2: [unknown, unknown]): Contract {
  const parsed = parseContract(
    JSON.stringify({
      version: 1,
      id: ID,
      goal: 'clamp가 hi보다 큰 값을 hi로 자른다',
      lines: [
        {
          id: 'C1',
          kind: 'change',
          text: '위로 넘으면 hi',
          grounds: [],
          examples: ['C1.1'],
          check: 'test',
        },
        {
          id: 'C2',
          kind: 'keep',
          text: '더하기는 그대로',
          grounds: [],
          examples: ['C2.1'],
          check: 'test',
        },
        { id: 'C3', kind: 'new', text: '새것', grounds: [], examples: ['C3.1'], check: 'test' },
      ],
      examples: [
        { id: 'C1.1', input: c1[0], output: c1[1] },
        { id: 'C2.1', input: c2[0], output: c2[1] },
        { id: 'C3.1', input: 1, output: 1 },
      ],
      non_goals: [],
      human_rules: [],
      tidy: [],
    }),
  )
  if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
  return parsed.value
}

/** 바르게 쓴 계약: C1.1은 기준(lo를 돌려줌)에서 실패하고 C2.1은 통과한다 */
const GOOD = contract([[15, 0, 10], 10], [[2, 3], 5])

// 계약 id를 상수로 쓴 태그(`[${T}:C1.1]`)만 쓴다. 예시는 앱이 쓴 예시 자료에서 읽는다(커밋하지 않았다: 확인이 얹는다)
const TAGGED = `import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { add, clamp } from '../src/calc.js'

const T = '${ID}'
const examples = JSON.parse(
  readFileSync(new URL('../.relay/examples/' + T + '.json', import.meta.url), 'utf8'),
)

test('위로 넘는 값 [' + T + ':C1.1]', () => {
  const { input, output } = examples['C1.1']
  assert.equal(clamp(...input), output)
})

test('더하기 [' + T + ':C2.1]', () => {
  const { input, output } = examples['C2.1']
  assert.equal(add(...input), output)
})
`

describe('calc 레포', () => {
  let repo: TestRepo
  let home: string
  let tagged: string

  beforeAll(async () => {
    repo = await makeRepo({
      files: {
        'package.json': '{ "name": "calc", "private": true, "type": "module" }\n',
        '.gitignore': '.relay-out/\n',
        '.relay/quality.json': QUALITY_TEXT,
        'src/calc.js': calc('lo'),
        'test/calc.test.js': TESTS_BASE,
      },
    })
    home = await makeTempDir('relay-home-')
    await repo.branch('work')
    tagged = await repo.commit('시험 먼저', { 'test/probe.test.js': TAGGED })
  })

  const probe = (head: string, c: Contract) =>
    probeContract({ repo: repo.dir, head, base: 'main', contract: c, home })

  test('태그 시험이 없으면 돌리지 않는다', async () => {
    const p = await probe(await repo.sha('main'), GOOD)
    expect(p).toMatchObject({
      ran: false,
      note: '바뀜·지킴 줄의 예시 태그를 단 시험 파일이 head에 없음',
      lines: [],
    })
  })

  test('바른 계약: 바뀜 예시는 기준에서 실패(메시지), 지킴 예시는 통과. new 줄은 돌리지 않는다', async () => {
    const p = await probe(tagged, GOOD)
    expect(p).toMatchObject({ head: tagged, base: await repo.sha('main'), ran: true, note: null })
    expect(p.lines.map((l) => [l.line, l.status])).toEqual([
      ['C1', 'met'],
      ['C2', 'met'],
    ])
    expect(p.lines[0]?.examples[0]).toMatchObject({ id: 'C1.1', head: 'passed', base: 'failed' })
    expect(p.lines[0]?.examples[0]?.message).toContain('0 !== 10')
    expect(p.lines[1]?.examples[0]).toEqual({ id: 'C2.1', head: 'passed', base: 'passed' })
  })

  test('같은 시험에 예시만 틀리면: 바뀜 예시가 기준에서도 통과, 지킴 예시가 기준에서 실패', async () => {
    const p = await probe(tagged, contract([[5, 0, 10], 5], [[2, 3], 6]))
    expect(p.ran).toBe(true)
    expect(p.lines.map((l) => [l.line, l.status])).toEqual([
      ['C1', 'not_met'],
      ['C2', 'not_met'],
    ])
    expect(p.lines[1]?.examples[0]?.message).toContain('5 !== 6')
  })

  test('지킴 시험이 기준에 없는 함수를 쓰면 그 파일을 불러오지 못해 not_met', async () => {
    const head = await repo.commit('sub를 쓰는 지킴 시험', {
      'src/calc.js': `${calc('lo')}\nexport const sub = (a, b) => a - b\n`,
      'test/probe.test.js': TAGGED.replace(
        "import { add, clamp } from '../src/calc.js'",
        "import { add, clamp, sub } from '../src/calc.js'",
      ),
    })
    const p = await probe(head, GOOD)
    expect(p.lines.map((l) => [l.line, l.status])).toEqual([
      ['C1', 'met'],
      ['C2', 'not_met'],
    ])
    expect(p.lines[1]?.examples[0]).toMatchObject({ base: 'missing' })
    expect(p.lines[1]?.examples[0]?.message).toContain('test/probe.test.js')
    await repo.git('reset', '--quiet', '--hard', tagged)
  })
})

describe('돌리지 못하는 레포', () => {
  test('수용 명령이 없으면 돌리지 않는다', async () => {
    const repo = await makeRepo({ files: { 'src/calc.js': calc('lo') } })
    await repo.branch('work')
    const head = await repo.commit('시험', { 'test/probe.test.js': TAGGED })
    const home = await makeTempDir('relay-home-')
    const p = await probeContract({ repo: repo.dir, head, base: 'main', contract: GOOD, home })
    expect(p).toMatchObject({ ran: false, note: '품질 기준에 수용 시험 명령이 없음' })
  })

  test('수용 명령의 시간 제한을 넘으면 확인 안 함으로 적는다', async () => {
    const sleep = await nodeCommand('setTimeout(() => {}, 20000)')
    const quality = {
      version: 1,
      commands: {
        fast: [],
        acceptance: { id: 'accept', run: sleep, timeout_sec: 1, junit: JUNIT },
      },
      test_globs: ['**/*.test.js'],
    }
    const repo = await makeRepo({
      files: { '.relay/quality.json': JSON.stringify(quality), 'src/calc.js': calc('lo') },
    })
    await repo.branch('work')
    const head = await repo.commit('시험', { 'test/probe.test.js': TAGGED })
    const home = await makeTempDir('relay-home-')
    const p = await probeContract({ repo: repo.dir, head, base: 'main', contract: GOOD, home })
    expect(p).toMatchObject({ ran: false, note: '시간 제한 1초를 넘음', lines: [] })
    expect(p.ms).toBeGreaterThanOrEqual(1000)
  })
})

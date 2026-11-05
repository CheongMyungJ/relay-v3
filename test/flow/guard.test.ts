// [흐름] check가 지키는 것: 예시 자료(V27: 승인본을 얹어 판정, 커밋된 파일은 견줌), 깨진 JUnit 자리, 한 레포의 worktree를
// 함께 쓰는 check.

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { repoKey } from '../../src/adapters/store.ts'
import { lockWorktrees } from '../../src/adapters/worktrees.ts'
import { check } from '../../src/engine/check.ts'
import { gate } from '../../src/core/gate.ts'
import type { Contract, EvidenceBundle, Policy } from '../../src/core/types.ts'
import { byId, calc, NOW, QUALITY, QUALITY_TEXT, TESTS_BASE } from '../support/calc.ts'
import { cleanupAll, makeRepo, makeTempDir, nodeCommand, type TestRepo } from '../support/repo.ts'

afterAll(cleanupAll)

// 빼기(sub)를 새로 더하는 Work: 시험은 예시 자료 .relay/examples/sub.json을 읽는다. 승인된 C1.1은 5 - 3 = 2
const SUB_TEST = `import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { sub } from '../src/sub.js'
const examples = JSON.parse(readFileSync(new URL('../.relay/examples/sub.json', import.meta.url), 'utf8'))
test('빼기 [sub:C1.1]', () => {
  const { input, output } = examples['C1.1']
  assert.equal(sub(...input), output)
})
`

const SUB: Contract = {
  version: 1,
  id: 'sub',
  goal: '빼기',
  lines: [{ id: 'C1', kind: 'new', text: '빼기', grounds: [], examples: ['C1.1'], check: 'test' }],
  non_goals: [],
  human_rules: [],
  examples: [{ id: 'C1.1', input: [5, 3], output: 2 }],
  tidy: [],
  approved_by: 'human',
}

const policy: Policy = {
  auto_merge_enabled: false,
  conditions: [],
  server: null,
  track_record_ok: {},
}

/** 예시 자료 파일이 head에 있는지 세는 command 래칫(1이면 있음). 수용 시험 뒤에 돈다 */
async function seenRatchet(): Promise<object> {
  const run = await nodeCommand(
    `console.log(require('fs').existsSync('.relay/examples/sub.json') ? 1 : 0)`,
  )
  return { id: 'seen', kind: 'command', run, better: 'lower' }
}

/** sub 브랜치에 빼기와 그 시험을 커밋한 레포. examples가 null이면 예시 자료를 커밋하지 않는다 */
async function subRepo(
  examples: string | null,
  impl = 'export const sub = (a, b) => a + b\n',
): Promise<TestRepo> {
  const quality = { ...QUALITY, ratchets: [...QUALITY.ratchets, await seenRatchet()] }
  const repo = await makeRepo({
    files: {
      'package.json': '{ "name": "calc", "private": true, "type": "module" }\n',
      '.gitignore': '.relay-out/\n',
      '.relay/quality.json': JSON.stringify(quality),
      'src/calc.js': calc('hi'),
      'test/calc.test.js': TESTS_BASE.replace('[fix-clamp:C2.1]', ''),
    },
  })
  await repo.branch('sub')
  await repo.commit('sub 더함', {
    'src/sub.js': impl,
    'test/sub.test.js': SUB_TEST,
    ...(examples === null ? {} : { '.relay/examples/sub.json': examples }),
  })
  return repo
}

async function checkSub(repo: TestRepo): Promise<EvidenceBundle> {
  const files = await makeTempDir('relay-work-')
  const contractPath = join(files, 'contract.json')
  await writeFile(contractPath, JSON.stringify(SUB))
  const home = await makeTempDir('relay-home-')
  return check({ repo: repo.dir, base: 'main', head: 'sub', contractPath, home, now: NOW })
}

describe('예시 자료와 worktree를 지키기', () => {
  test('커밋한 예시 자료가 승인본과 다르면 줄은 앱이 얹은 승인본으로 판정하고 다름을 사람 머지 사실로 남긴다(V27)', async () => {
    const repo = await subRepo('{ "C1.1": { "input": [5, 3], "output": 8 } }\n')
    const b = await checkSub(repo)
    // 커밋된 자료(8)로는 통과하지만 승인본(2)으로 돌면 결과에서 실패한다
    expect(b.lines?.map((l) => [l.line, l.status, l.detail])).toEqual([
      ['C1', 'not_met', '결과에서 실패: C1.1(failed)'],
    ])
    expect(b.examples_file).toEqual({
      path: '.relay/examples/sub.json',
      status: 'differs',
      diffs: [{ id: 'C1.1', field: 'output', expected: 2, found: 8 }],
    })
    // fast의 node --test는 얹지 않은 head 그대로 돈다(커밋된 자료로 통과)
    expect(byId(b.commands, 'unit')?.outcome).toBe('pass')
    expect(gate(b, SUB, policy, b.head).reasons).toEqual(
      expect.arrayContaining(['예시 자료가 승인본과 다름: C1.1 output (기대 2, 실제 8)']),
    )
  })

  test('예시 자료를 커밋하지 않아도 수용 시험은 승인본을 얹어 돌고, 커밋되지 않음이 사실로 남으며 head는 되돌린다(V27)', async () => {
    const repo = await subRepo(null, 'export const sub = (a, b) => a - b\n')
    const b = await checkSub(repo)
    expect(byId(b.commands, 'accept')?.outcome).toBe('pass')
    expect(b.lines?.map((l) => [l.line, l.status])).toEqual([['C1', 'met']])
    expect(b.examples_file).toEqual({
      path: '.relay/examples/sub.json',
      status: 'absent',
      diffs: [],
    })
    // 얹지 않은 head의 fast 명령은 자료가 없어 실패한다
    expect(byId(b.commands, 'unit')?.outcome).toBe('fail')
    // 수용 시험 뒤에 도는 command 래칫은 얹은 파일을 보지 않는다(head worktree를 되돌림)
    expect(byId(b.ratchets, 'seen')).toMatchObject({ status: 'same', base: 0, head: 0 })
    expect(b.missing).toEqual([])
    expect(gate(b, SUB, policy, b.head).reasons).toEqual(
      expect.arrayContaining(['예시 자료 파일이 커밋되지 않음: .relay/examples/sub.json']),
    )
  })

  test('예시 자료 자리에 head가 폴더를 커밋하면 얹지 못함을 없는 증거로 한 번 적고 커밋된 그대로 돈다(V27)', async () => {
    const repo = await subRepo(null, 'export const sub = (a, b) => a - b\n')
    await repo.commit('자료 자리에 폴더', { '.relay/examples/sub.json/keep.txt': 'x\n' })
    const b = await checkSub(repo)
    expect(b.missing).toEqual([
      "예시 자료 얹기(head) .relay/examples/sub.json: 파일이 아님(링크·폴더): '.relay/examples/sub.json'",
    ])
    // 시험 파일이 불러올 때 폴더를 읽어 파일째 실패한다(다시 돌아도 같은 까닭은 한 번만 적는다)
    expect(byId(b.commands, 'accept')?.head).toHaveLength(2)
    expect(b.lines?.map((l) => [l.line, l.status])).toEqual([['C1', 'missing_evidence']])
    expect(b.examples_file?.status).toBe('absent')
  })

  test('JUnit 자리에 head가 폴더를 커밋해도 check는 던지지 않고 없는 증거로 적는다', async () => {
    const repo = await makeRepo({
      files: {
        'package.json': '{ "name": "calc", "private": true, "type": "module" }\n',
        '.relay/quality.json': QUALITY_TEXT,
        'src/calc.js': calc('hi'),
        'test/calc.test.js': TESTS_BASE,
      },
    })
    await repo.branch('dir')
    await repo.commit('폴더', { '.relay-out/junit.xml/keep.txt': 'x\n' })
    const home = await makeTempDir('relay-home-')
    const b = await check({ repo: repo.dir, base: 'main', head: 'dir', home, now: NOW })
    expect(b.missing).toContain('acceptance: JUnit을 읽지 못함 (.relay-out/junit.xml)')
    expect(byId(b.ratchets, 'tests')?.status).toBe('unknown')
  })

  test('한 레포에서 check 둘을 함께 돌려도 각 묶음은 자기 head의 출력을 담는다', async () => {
    const slow = await nodeCommand(
      `setTimeout(() => process.stdout.write(require('fs').readFileSync('v.txt', 'utf8')), 700)`,
    )
    const quality = { version: 1, commands: { fast: [{ id: 'show', run: slow }] } }
    const repo = await makeRepo({
      files: { '.relay/quality.json': JSON.stringify(quality), 'v.txt': 'base\n' },
    })
    await repo.branch('a')
    await repo.commit('A', { 'v.txt': 'A\n' })
    await repo.branch('b', 'main')
    await repo.commit('B', { 'v.txt': 'B\n' })
    const home = await makeTempDir('relay-home-')
    const run = (head: string) => check({ repo: repo.dir, base: 'main', head, home, now: NOW })
    const [a, b] = await Promise.all([run('a'), run('b')])
    expect(a.head).toBe(await repo.sha('a'))
    expect(a.commands[0]?.head[0]?.stdout_tail).toBe('A\n')
    expect(b.commands[0]?.head[0]?.stdout_tail).toBe('B\n')
    expect([...a.missing, ...b.missing]).toEqual([])
  })

  test('잠금을 기다리다 시간이 넘으면 명령은 돌리지 못함이고 까닭을 적는다', async () => {
    const quality = { version: 1, commands: { fast: [{ id: 'unit', run: 'node --version' }] } }
    const repo = await makeRepo({ files: { '.relay/quality.json': JSON.stringify(quality) } })
    const home = await makeTempDir('relay-home-')
    const release = await lockWorktrees(home, repoKey(repo.dir), 0)
    try {
      const b = await check({
        repo: repo.dir,
        head: 'main',
        base: 'main',
        home,
        now: NOW,
        lockWaitMs: 50,
      })
      expect(b.commands).toEqual([{ id: 'unit', outcome: 'not_run', head: [] }])
      expect(b.missing).toEqual([
        expect.stringMatching(/^worktree: 다른 check가 worktree를 쓰는 중/),
      ])
    } finally {
      await release()
    }
  })
})

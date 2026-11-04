// [흐름] check가 지키는 것: 커밋한 예시 자료, 깨진 JUnit 자리, 한 레포의 worktree를 함께 쓰는 check.

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { repoKey } from '../../src/adapters/store.ts'
import { lockWorktrees } from '../../src/adapters/worktrees.ts'
import { check } from '../../src/engine/check.ts'
import { byId, calc, NOW, QUALITY_TEXT, TESTS_BASE } from '../support/calc.ts'
import { cleanupAll, makeRepo, makeTempDir, nodeCommand } from '../support/repo.ts'

afterAll(cleanupAll)

describe('예시 자료와 worktree를 지키기', () => {
  test('커밋한 예시 자료가 승인된 예시와 다르면 시험이 통과해도 줄은 못 미침', async () => {
    const repo = await makeRepo({
      files: {
        'package.json': '{ "name": "calc", "private": true, "type": "module" }\n',
        '.relay/quality.json': QUALITY_TEXT,
        'src/calc.js': calc('hi'),
        'test/calc.test.js': TESTS_BASE.replace('[fix-clamp:C2.1]', ''),
      },
    })
    await repo.branch('sub')
    await repo.commit('sub 더함', {
      'src/sub.js': 'export const sub = (a, b) => a + b\n',
      '.relay/examples/sub.json': '{ "C1.1": { "input": [5, 3], "output": 8 } }\n',
      'test/sub.test.js': `import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { sub } from '../src/sub.js'
const examples = JSON.parse(readFileSync(new URL('../.relay/examples/sub.json', import.meta.url), 'utf8'))
test('빼기 [sub:C1.1]', () => {
  const { input, output } = examples['C1.1']
  assert.equal(sub(...input), output)
})
`,
    })
    const files = await makeTempDir('relay-work-')
    const contractPath = join(files, 'contract.json')
    await writeFile(
      contractPath,
      JSON.stringify({
        version: 1,
        id: 'sub',
        goal: '빼기',
        lines: [{ id: 'C1', kind: 'new', text: '빼기', examples: ['C1.1'], check: 'test' }],
        examples: [{ id: 'C1.1', input: [5, 3], output: 2 }],
        approved_by: 'human',
      }),
    )
    const home = await makeTempDir('relay-home-')
    const b = await check({
      repo: repo.dir,
      base: 'main',
      head: 'sub',
      contractPath,
      home,
      now: NOW,
    })
    expect(byId(b.commands, 'accept')?.outcome).toBe('pass')
    expect(b.lines?.map((l) => [l.line, l.status, l.detail])).toEqual([
      ['C1', 'not_met', '예시 자료가 승인된 예시와 다름: C1.1'],
    ])
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

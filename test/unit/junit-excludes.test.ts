// [단위] 새 Work의 worktree에서 뺄 JUnit 출력(M2.1 13절): src/main/works-worktree.ts junitExcludes.
// exclude 파일에 실제로 쓰고 git이 무시하는지는 [어댑터] test/adapters/work-exclude.test.ts가 본다.
import { expect, test } from 'vitest'
import type { CommandSpec, QualityConfig } from '../../src/core/types.ts'
import { junitExcludes } from '../../src/main/works-worktree.ts'

function quality(commands: QualityConfig['commands']): QualityConfig {
  return {
    version: 1,
    commands,
    human_paths: [],
    guard_paths: [],
    public_api: [],
    test_globs: [],
    examples_dir: '.relay/examples',
    ratchets: [],
    rules: [],
    auto: [],
  }
}

const cmd = (id: string, junit?: string): CommandSpec =>
  junit === undefined ? { id, run: 'x' } : { id, run: 'x', junit }

test('명령마다의 junit 파일을 /로 시작해(레포 루트에 묶어) 한 번씩. 폴더가 아니라 파일이다', () => {
  const q = quality({
    fast: [cmd('lint'), cmd('unit', 'reports/unit.xml')],
    acceptance: cmd('test', '.relay-out/junit.xml'),
    full: { local: [cmd('e2e', './.relay-out/junit.xml'), cmd('it', 'test/junit.xml')] },
  })
  expect(junitExcludes(q)).toEqual([
    '/reports/unit.xml',
    '/.relay-out/junit.xml',
    '/test/junit.xml',
  ])
})

test('품질 기준이 없거나 junit이 없으면 없음', () => {
  expect(junitExcludes(null)).toEqual([])
  expect(junitExcludes(quality({ fast: [cmd('lint')] }))).toEqual([])
})

test('역슬래시는 /로 읽고 glob 글자와 끝 공백은 막고, 줄바꿈이 든 경로는 쓰지 않는다', () => {
  const q = quality({
    fast: [cmd('a', 'out\\win.xml'), cmd('b', 'out/[x]*?.xml'), cmd('c', 'out/sp.xml ')],
    acceptance: cmd('test', 'out/a\nb.xml'),
  })
  expect(junitExcludes(q)).toEqual(['/out/win.xml', '/out/\\[x]\\*\\?.xml', '/out/sp.xml\\ '])
})

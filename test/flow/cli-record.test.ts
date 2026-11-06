// [흐름] relay record(M4c, src/cli/record.ts): $RELAY_HOME의 장부에서 지금 폴더 레포의 조건별 실적 표(글과 --json), --project,
// --all-epochs, --pool. 레포 밖이면 사용 오류. 셈의 자세한 갈래는 [단위] shadow.test.ts.
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { repoKey } from '../../src/adapters/store.ts'
import { main, type Io } from '../../src/cli/app.ts'
import { GATE_VERSION } from '../../src/engine/gate-version.ts'
import { cleanupAll, makeRepo, makeTempDir, type TestRepo } from '../support/repo.ts'

afterAll(cleanupAll)

let repo: TestRepo
let home: string

function io(cwd: string): Io & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = []
  const stderr: string[] = []
  return {
    cwd,
    env: { RELAY_HOME: home },
    out: (t) => stdout.push(t),
    err: (t) => stderr.push(t),
    now: () => new Date('2026-11-30T00:00:00Z'),
    stdout,
    stderr,
  }
}

beforeAll(async () => {
  repo = await makeRepo({ files: { 'a.txt': 'a\n' } })
  home = await makeTempDir('relay-home-')
  await mkdir(home, { recursive: true })
  const epoch = {
    conds: { small: 'a1b2c3d4e5f6' },
    model_observed: 'model-a',
    effort: 'medium',
    claude_version: '2.4.1 (Claude Code)',
    gate_version: GATE_VERSION,
    review_prompt: 4,
    relay_version: '0',
  }
  const line = (project: string, work: string, more: object = {}) => ({
    ts: '2026-11-20T00:00:00Z',
    project,
    work,
    head: 'h',
    conclusion: 'human_merge',
    condition: 'small',
    shadow: true,
    met: ['small'],
    ...epoch,
    ...more,
  })
  const me = repoKey(repo.dir)
  const lines = [
    line(me, 'w1'),
    line(me, 'w1', {
      condition: null,
      shadow: false,
      met: undefined,
      merged_head: 'h',
      by: 'human',
    }),
    line(me, 'w2', { model_observed: 'model-old' }),
    line(me, 'w2', {
      condition: null,
      shadow: false,
      met: undefined,
      merged_head: 'h',
      by: 'human',
    }),
    line('other', 'w3'),
    line('other', 'w3', {
      condition: null,
      shadow: false,
      met: undefined,
      merged_head: 'h',
      by: 'human',
    }),
  ]
  await appendFile(
    join(home, 'ledger.jsonl'),
    `${lines.map((l) => JSON.stringify(l)).join('\n')}\n{깨짐\n`,
  )
})

test('지금 폴더 레포의 지금 판: 글과 --json', async () => {
  const t = io(repo.dir)
  expect(await main(['record'], t)).toBe(0)
  expect(t.stdout[0]).toBe(`실적: ${repoKey(repo.dir)}`)
  expect(t.stdout).toContain('small (a1b2c3d4e5f6) · 일치 1/1 (하한 0.21)')
  expect(t.stdout.at(-1)).toBe('판을 모르는 결론 줄 0/2 · 읽지 못한 장부 줄 1')
  const j = io(repo.dir)
  expect(await main(['record', '--json'], j)).toBe(0)
  const out = JSON.parse(j.stdout.join('\n')) as {
    project: string
    epoch: string
    conditions: { id: string; match: number; outside: { other_epoch: number } }[]
  }
  expect(out).toMatchObject({ project: repoKey(repo.dir), epoch: 'current' })
  expect(out.conditions[0]).toMatchObject({ id: 'small', match: 1, outside: { other_epoch: 1 } })
})

test('--all-epochs, --pool, --project, 레포 밖은 사용 오류', async () => {
  const all = io(repo.dir)
  await main(['record', '--json', '--all-epochs'], all)
  expect(JSON.parse(all.stdout.join('\n'))).toMatchObject({
    epoch: 'all',
    conditions: [{ match: 2 }],
  })
  const pool = io(repo.dir)
  await main(['record', '--json', '--pool', '--all-epochs'], pool)
  expect(JSON.parse(pool.stdout.join('\n'))).toMatchObject({
    project: 'pool',
    conditions: [{ match: 3 }],
  })
  const outside = await makeTempDir('relay-outside-')
  const by = io(outside)
  expect(await main(['record', '--project', repo.dir], by)).toBe(0)
  const bad = io(outside)
  expect(await main(['record'], bad)).toBe(1)
  expect(bad.stderr[0]).toMatch(/^relay record: git 레포가 아님/)
})

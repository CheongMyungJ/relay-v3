import { readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  findPr,
  ghAvailable,
  listPr,
  mergePr,
  prMerge,
  prStatus,
  runsAt,
  serverProtection,
} from '../../src/adapters/gh.ts'
import { runFile } from '../../src/adapters/pty.ts'
import { FAKE_GH } from '../support/fakes.ts'
import { cleanupAll, makeRepo, makeTempDir, runGit, type TestRepo } from '../support/repo.ts'

const BRANCH = 'relay/fix-ab12'
let tmp: string
let stateFile: string
let logFile: string
let repo: TestRepo
let head: string

async function setState(state: object): Promise<void> {
  await writeFile(stateFile, JSON.stringify(state))
}
async function readState(): Promise<{ prs: Record<string, unknown>[] }> {
  return JSON.parse(await readFile(stateFile, 'utf8')) as { prs: Record<string, unknown>[] }
}
async function logged(): Promise<{ args: string[]; cwd: string }[]> {
  const text = await readFile(logFile, 'utf8').catch(() => '')
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { args: string[]; cwd: string })
}

beforeAll(async () => {
  tmp = await makeTempDir('relay-gh-')
  stateFile = join(tmp, 'gh-state.json')
  logFile = join(tmp, 'gh.jsonl')
  repo = await makeRepo({ files: { 'a.txt': 'a\n' } })
  const origin = join(tmp, 'origin.git')
  await runGit(tmp, ['init', '--quiet', '--bare', origin])
  await repo.git('remote', 'add', 'origin', origin)
  await repo.git('push', '--quiet', 'origin', 'main')
  await repo.branch(BRANCH)
  head = await repo.commit('고침', { 'a.txt': 'b\n' })
  await repo.git('push', '--quiet', 'origin', BRANCH)
  vi.stubEnv('RELAY_GH_BIN', FAKE_GH)
  vi.stubEnv('FAKE_GH_STATE', stateFile)
  vi.stubEnv('FAKE_GH_LOG', logFile)
})
afterAll(async () => {
  vi.unstubAllEnvs()
  await cleanupAll()
})
beforeEach(async () => {
  await setState({})
  await writeFile(logFile, '')
})

const pr = (o: Record<string, unknown>) => ({
  url: `https://github.test/fake/repo/pull/${String(o.number)}`,
  state: 'OPEN',
  headRefName: BRANCH,
  baseRefName: 'main',
  ...o,
})

describe('ghAvailable', () => {
  test('gh auth status가 성공하면 true, 실패하거나 gh가 없으면 false', async () => {
    expect(await ghAvailable()).toBe(true)
    await setState({ auth: false })
    expect(await ghAvailable()).toBe(false)
    vi.stubEnv('RELAY_GH_BIN', join(tmp, 'no-gh'))
    try {
      expect(await ghAvailable()).toBe(false)
    } finally {
      vi.stubEnv('RELAY_GH_BIN', FAKE_GH)
    }
  })
})

describe('findPr', () => {
  test('브랜치의 가장 최근 PR(상태와 관계없이). head는 push된 끝 커밋이다', async () => {
    expect(await findPr(repo.dir, BRANCH)).toBeNull()
    await setState({
      prs: [
        pr({ number: 1, state: 'CLOSED', headRefOid: 'f'.repeat(40) }),
        pr({ number: 2, isDraft: true }),
        pr({ number: 3, headRefName: 'other' }),
      ],
    })
    expect(await findPr(repo.dir, BRANCH)).toEqual({
      number: 2,
      url: 'https://github.test/fake/repo/pull/2',
      state: 'OPEN',
      headRefOid: head,
      baseRefName: 'main',
      isDraft: true,
      mergedAt: null,
    })
    const calls = await logged()
    expect(calls.at(-1)).toEqual({
      args: [
        'pr',
        'list',
        '--head',
        BRANCH,
        '--state',
        'all',
        '--json',
        'number,url,state,headRefOid,baseRefName,isDraft,mergedAt',
      ],
      cwd: repo.dir,
    })
  })

  test('gh가 실패하면 null', async () => {
    await setState({ prs: [pr({ number: 1 })], fail: ['pr list'] })
    expect(await findPr(repo.dir, BRANCH)).toBeNull()
  })

  test('세션이 연 PR(가짜 gh pr create)을 찾는다. push하지 않은 브랜치는 PR을 못 연다', async () => {
    const created = await runFile(FAKE_GH, ['pr', 'create', '--title', '고침', '--body', '본문'], {
      cwd: repo.dir,
      timeoutMs: 30_000,
    })
    expect(created).toMatchObject({ exit: 0, stdout: 'https://github.test/fake/repo/pull/1\n' })
    expect(await findPr(repo.dir, BRANCH)).toMatchObject({
      number: 1,
      state: 'OPEN',
      headRefOid: head,
    })
    const again = await runFile(FAKE_GH, ['pr', 'create', '--title', '고침'], {
      cwd: repo.dir,
      timeoutMs: 30_000,
    })
    expect(again.stderr).toContain('already exists')

    await repo.branch('local-only')
    try {
      const r = await runFile(FAKE_GH, ['pr', 'create', '--title', 't'], {
        cwd: repo.dir,
        timeoutMs: 30_000,
      })
      expect(r.exit).toBe(1)
      expect(r.stderr).toContain("Head sha can't be blank")
    } finally {
      await repo.checkout(BRANCH)
    }
  })
})

describe('listPr와 prMerge (M4b)', () => {
  test('listPr는 PR이 없음과 읽지 못함을 가른다', async () => {
    expect(await listPr(repo.dir, BRANCH)).toEqual({ ok: true, pr: null })
    await setState({ prs: [pr({ number: 3 })] })
    expect(await listPr(repo.dir, BRANCH)).toMatchObject({ ok: true, pr: { number: 3 } })
    await setState({ prs: [pr({ number: 3 })], fail: ['pr list'] })
    expect(await listPr(repo.dir, BRANCH)).toMatchObject({ ok: false })
  })

  test('prMerge: 머지 커밋(mergeCommit.oid)과 머지한 때. 머지되지 않았으면 둘 다 null', async () => {
    const oid = 'a'.repeat(40)
    await setState({
      prs: [
        pr({ number: 4, state: 'MERGED', mergedAt: '2026-11-07T10:00:00Z', mergeCommit: { oid } }),
        pr({ number: 5 }),
      ],
    })
    expect(await prMerge(repo.dir, 4)).toEqual({
      ok: true,
      state: 'MERGED',
      headRefOid: head,
      mergeCommit: oid,
      mergedAt: '2026-11-07T10:00:00Z',
    })
    expect(await prMerge(repo.dir, 5)).toMatchObject({
      ok: true,
      mergeCommit: null,
      mergedAt: null,
    })
    const calls = (await logged()).map((c) => c.args)
    expect(calls).toContainEqual([
      'pr',
      'view',
      '4',
      '--json',
      'mergeCommit,mergedAt,state,headRefOid',
    ])
    // 부르는 칸은 relay-v2 녹화본의 prView에 있다(test/fixtures/recorded-fields.json)
    const recorded = JSON.parse(
      readFileSync(new URL('../fixtures/recorded-fields.json', import.meta.url), 'utf8'),
    ) as { gh: { prView: string[] } }
    for (const f of ['mergeCommit', 'mergeCommit.oid', 'mergedAt', 'state', 'headRefOid'])
      expect(recorded.gh.prView).toContain(f)
    expect(await prMerge(repo.dir, 9)).toMatchObject({ ok: false })
    expect(await prMerge(repo.dir, 0)).toMatchObject({ ok: false })
  })
})

describe('runsAt (M4d)', () => {
  test('커밋의 push 실행을 읽는다: 녹화본 run 모양의 칸만, 다시 시도는 run_attempt', async () => {
    const sha = 'a'.repeat(40)
    const run = {
      name: 'ci',
      path: '.github/workflows/ci.yml',
      head_sha: sha,
      event: 'push',
      status: 'completed',
      conclusion: 'failure',
      run_attempt: 2,
    }
    await setState({
      runs: [run, { ...run, event: 'pull_request' }, { ...run, head_sha: 'b'.repeat(40) }],
    })
    expect(await runsAt(repo.dir, sha)).toEqual({ ok: true, runs: [run] })
    const last = (await logged()).at(-1)
    expect(last?.args).toEqual([
      'api',
      `repos/{owner}/{repo}/actions/runs?head_sha=${sha}&event=push&per_page=100`,
    ])
    // 읽는 칸은 relay-v2 녹화본의 run에 있다(봉투 workflow_runs는 REST 문서의 꼴, recorded-fields.json의 note)
    const recorded = JSON.parse(
      readFileSync(new URL('../fixtures/recorded-fields.json', import.meta.url), 'utf8'),
    ) as { gh: { run: string[] } }
    for (const f of Object.keys(run)) expect(recorded.gh.run).toContain(f)
    // 앱은 CI를 다시 돌리지 않는다
    expect((await logged()).some((l) => l.args.includes('rerun'))).toBe(false)
  })

  test('읽지 못하면 ok 거짓(SHA가 아님, gh 실패)', async () => {
    expect(await runsAt(repo.dir, 'main')).toMatchObject({ ok: false })
    await setState({ fail: ['api runs'] })
    expect(await runsAt(repo.dir, 'a'.repeat(40))).toMatchObject({ ok: false })
  })
})

describe('prStatus', () => {
  test('머지 가능 상태와 체크 요약. 같은 체크는 가장 늦게 시작한 것만', async () => {
    await setState({
      prs: [
        pr({
          number: 4,
          mergeable: 'MERGEABLE',
          mergeStateStatus: 'BLOCKED',
          statusCheckRollup: [
            {
              __typename: 'CheckRun',
              name: 'test',
              workflowName: 'ci',
              status: 'COMPLETED',
              conclusion: 'FAILURE',
              startedAt: '2026-11-01T00:00:00Z',
            },
            {
              __typename: 'CheckRun',
              name: 'test',
              workflowName: 'ci',
              status: 'COMPLETED',
              conclusion: 'SUCCESS',
              startedAt: '2026-11-02T00:00:00Z',
            },
            {
              __typename: 'CheckRun',
              name: 'lint',
              workflowName: 'ci',
              status: 'IN_PROGRESS',
              conclusion: '',
              startedAt: '2026-11-02T00:00:00Z',
            },
            { __typename: 'StatusContext', context: 'deploy', state: 'ERROR' },
          ],
        }),
      ],
    })
    expect(await prStatus(repo.dir, 4)).toEqual({
      ok: true,
      state: 'OPEN',
      headRefOid: head,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'BLOCKED',
      checks: [
        { name: 'ci / test', state: 'SUCCESS', bucket: 'pass' },
        { name: 'ci / lint', state: 'IN_PROGRESS', bucket: 'pending' },
        { name: 'deploy', state: 'ERROR', bucket: 'fail' },
      ],
    })
    expect((await logged()).at(-1)?.args).toEqual([
      'pr',
      'view',
      '4',
      '--json',
      'mergeable,mergeStateStatus,statusCheckRollup,headRefOid,state',
    ])
  })

  test('읽지 못하면 까닭과 함께 ok false', async () => {
    const r = await prStatus(repo.dir, 9)
    expect(r).toEqual({ ok: false, error: expect.stringContaining('Could not resolve') })
  })
})

describe('mergePr', () => {
  test('--match-head-commit으로 머지한다. head가 다르면 GitHub가 거절한다', async () => {
    await setState({ prs: [pr({ number: 5 })] })
    const stale = await mergePr(repo.dir, 5, 'a'.repeat(40), 'squash')
    expect(stale).toEqual({ ok: false, error: expect.stringContaining('Head branch was modified') })
    expect((await readState()).prs[0]?.state).toBe('OPEN')

    expect(await mergePr(repo.dir, 5, head, 'squash')).toEqual({ ok: true })
    expect((await logged()).at(-1)?.args).toEqual([
      'pr',
      'merge',
      '5',
      '--squash',
      '--match-head-commit',
      head,
    ])
    expect(await findPr(repo.dir, BRANCH)).toMatchObject({
      number: 5,
      state: 'MERGED',
      mergedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
    })
  })

  test('SHA나 PR 번호가 아니면 gh를 부르지 않고, 충돌이면 실패로 돌려준다', async () => {
    await setState({ prs: [pr({ number: 6, mergeable: 'CONFLICTING' })] })
    expect(await mergePr(repo.dir, 6, '--admin', 'merge')).toEqual({
      ok: false,
      error: expect.stringContaining('SHA'),
    })
    expect(await mergePr(repo.dir, 0, head, 'merge')).toEqual({
      ok: false,
      error: expect.stringContaining('PR 번호'),
    })
    expect(await prStatus(repo.dir, 1.5)).toMatchObject({ ok: false })
    expect(await logged()).toEqual([])
    const r = await mergePr(repo.dir, 6, head, 'rebase')
    expect(r).toEqual({ ok: false, error: expect.stringContaining('not mergeable') })
  })
})

describe('serverProtection', () => {
  const required = {
    enforcement_level: 'everyone',
    contexts: ['ci / test'],
    checks: [{ context: 'ci / test', app_id: 15368 }],
    strict: true,
  }
  const rule = (type: string, parameters: object) => ({
    type,
    parameters,
    ruleset_source_type: 'Repository',
    ruleset_source: 'fake/repo',
    ruleset_id: 1,
  })

  test('브랜치 보호: protected, 필수 검사, strict', async () => {
    await setState({
      branches: {
        main: { protected: true, protection: { enabled: true, required_status_checks: required } },
      },
    })
    expect(await serverProtection(repo.dir, 'main')).toEqual({
      branch_protected: true,
      required_checks: true,
      merge_queue: false,
      up_to_date_required: true,
    })
    expect((await logged()).map((c) => c.args)).toEqual(
      expect.arrayContaining([
        ['api', 'repos/{owner}/{repo}/branches/main'],
        ['api', 'repos/{owner}/{repo}/rules/branches/main'],
      ]),
    )
  })

  test('규칙 모음: pull_request, required_status_checks, merge_queue', async () => {
    await setState({
      branches: { 'release/1.0': { protected: false } },
      rules: {
        'release/1.0': [
          rule('pull_request', { required_approving_review_count: 1 }),
          rule('required_status_checks', {
            strict_required_status_checks_policy: false,
            required_status_checks: [{ context: 'ci / test' }],
          }),
          rule('merge_queue', { merge_method: 'SQUASH' }),
        ],
      },
    })
    expect(await serverProtection(repo.dir, 'release/1.0')).toEqual({
      branch_protected: true,
      required_checks: true,
      merge_queue: true,
      up_to_date_required: false,
    })
  })

  test('보호가 없으면 모두 false. 못 읽으면 null', async () => {
    await setState({ branches: { main: { protected: false } } })
    expect(await serverProtection(repo.dir, 'main')).toEqual({
      branch_protected: false,
      required_checks: false,
      merge_queue: false,
      up_to_date_required: false,
    })
    // 꺼진 필수 검사와 검사 목록이 빈 규칙은 필수 검사가 아니다
    await setState({
      branches: {
        main: {
          protected: true,
          protection: { required_status_checks: { ...required, enforcement_level: 'off' } },
        },
      },
      rules: { main: [rule('required_status_checks', { required_status_checks: [] })] },
    })
    expect(await serverProtection(repo.dir, 'main')).toMatchObject({
      required_checks: false,
      up_to_date_required: false,
    })
    await setState({})
    expect(await serverProtection(repo.dir, 'main')).toBeNull()
    await setState({ branches: { main: { protected: true } }, fail: ['api rules'] })
    expect(await serverProtection(repo.dir, 'main')).toBeNull()
  })
})

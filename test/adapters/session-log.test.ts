// [어댑터] 세션 커밋 집합(M4e 첫 겹, docs/m4-design.md 7.1, src/main/works-session-log.ts SessionLog): 실제 git worktree에서
// 셸 도구의 PreToolUse·PostToolUse 사이에 Work 브랜치에 생긴 커밋만 집합에 든다(도구 밖의 사람 커밋, 바닥 막기가 거절한 도구는
// 빠진다). 도구가 겹치면 한 창, Stop이 열린 창을 닫는다. 트레일러를 켠 세션의 집합 커밋에 트레일러가 없으면 trailer_missing,
// 심이 hooks.log에 사고를 남기면 hook_incident와 그 프로젝트의 트레일러 끄기(한 번만, 앱을 다시 켜도). 띄움의 트레일러 켜기·끄기
import { execFile } from 'node:child_process'
import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { NO_COMMITS, workTrailers } from '../../src/engine/session-commits.ts'
import { branchExport, Store } from '../../src/main/store.ts'
import {
  afterOf,
  SessionLog,
  sessionLedger,
  sessionOf,
  type SessionWork,
} from '../../src/main/works-session-log.ts'
import { cleanupAll, makeRepo, makeTempDir, runGit, type TestRepo } from '../support/repo.ts'

afterAll(cleanupAll)

let repo: TestRepo
let store: Store
let work: SessionWork
let wt = ''
const notes: Record<string, unknown>[] = []
const disabled: string[] = []
const logs: string[] = []

const newLog = () =>
  new SessionLog({
    store,
    work: (id) => (id === work.id ? work : null),
    note: (_id, e) => void notes.push(e),
    disableTrailer: async (p) => void disabled.push(p),
    log: (m) => void logs.push(m),
  })

let log: SessionLog
let env: Record<string, string> = {}

/** 세션처럼(세션 환경으로) worktree에서 커밋한다 */
function sessionCommit(message: string, extra: string[] = []): Promise<void> {
  return new Promise((resolve, reject) =>
    execFile(
      'git',
      [...extra, 'commit', '-q', '--allow-empty', '-m', message],
      { cwd: wt, env: { ...process.env, ...env, RELAY_WORK_ID: work.id } },
      (e) => (e ? reject(e) : resolve()),
    ),
  )
}
/** 사람처럼(세션 환경 없이) */
const humanCommit = (message: string) =>
  runGit(wt, ['commit', '-q', '--allow-empty', '--no-verify', '-m', message])
const head = () => runGit(wt, ['rev-parse', 'HEAD'])

const bash = (id: string) => ({
  tool_name: 'Bash',
  tool_input: { command: 'git commit -m x' },
  tool_use_id: id,
})

beforeAll(async () => {
  repo = await makeRepo({ files: { 'a.txt': 'a\n' } })
  const home = await makeTempDir('relay-home-')
  store = new Store({ home, now: () => new Date().toISOString(), newId: () => 'x' })
  wt = join(await makeTempDir('relay-wt-'), 'w1')
  await repo.git('worktree', 'add', '--quiet', '-b', 'relay/w-1', wt)
  work = {
    id: 'w1',
    project: 'p1',
    worktree: wt,
    branch: 'relay/w-1',
    base_ref: 'main',
    exports: [branchExport('relay/w-1')],
  }
  log = newLog()
})

describe('세션 커밋 집합', () => {
  const sets = { session: [] as string[], human: [] as string[] }

  test('띄움: 트레일러를 켜면 세션 환경에 core.hooksPath 심, 띄움 줄', async () => {
    const setup = await log.prepareLaunch(work, true)
    expect(setup.on).toBe(true)
    // 물려받은 GIT_CONFIG_*(이 기계의 git 설정일 수 있다) 뒤에 붙인다
    const base = process.env['GIT_CONFIG_COUNT'] ?? '0'
    expect(setup.env['RELAY_GIT_CONFIG_BASE']).toBe(base)
    expect(setup.env[`GIT_CONFIG_KEY_${base}`]).toBe('core.hooksPath')
    env = setup.env
    const off = await newLog().prepareLaunch(work, false)
    expect(off).toEqual({ on: false, why: 'setting', env: {} })
    // 앞의 띄움 줄은 남고, 끈 띄움이 있었으니 집합만으로 가른다
    expect((await sessionOf(store, work.id)).set).toMatchObject({
      launched: true,
      trailerOff: true,
    })
    // 다시 켠 띄움(이 시험의 나머지)
    await log.prepareLaunch(work, true)
  })

  test('셸 도구 사이의 커밋만 든다. 도구 밖의 사람 커밋은 빠진다', async () => {
    await log.noteHook(work.id, 'PreToolUse', bash('u1'))
    await sessionCommit('s1')
    sets.session.push(await head())
    await log.noteHook(work.id, 'PostToolUse', bash('u1'))
    await humanCommit('h1')
    sets.human.push(await head())
    expect(
      workTrailers(await runGit(wt, ['log', '-1', '--format=%B', sets.session[0] ?? ''])),
    ).toEqual(['w1'])
  })

  test('겹친 도구는 한 창, 바닥 막기가 거절한 도구는 창을 열지 않음, Stop이 열린 창을 닫는다', async () => {
    await log.noteHook(work.id, 'PreToolUse', bash('u2'))
    await log.noteHook(work.id, 'PreToolUse', bash('u3'))
    // 트레일러 없이 만든 세션 커밋(-c가 세션 환경을 덮음)
    await sessionCommit('no-trailer', ['-c', `core.hooksPath=${join(repo.dir, '.git', 'hooks')}`])
    const missing = await head()
    sets.session.push(missing)
    await log.noteHook(work.id, 'PostToolUseFailure', bash('u2'))
    await sessionCommit('s3')
    sets.session.push(await head())
    await log.noteHook(work.id, 'PostToolUse', bash('u3'))

    await log.noteHook(work.id, 'PreToolUse', bash('u4'), true)
    await humanCommit('h2')
    sets.human.push(await head())
    await log.noteHook(work.id, 'PostToolUse', bash('u4'))

    await log.noteHook(work.id, 'PreToolUse', bash('u5'))
    await sessionCommit('s4')
    sets.session.push(await head())
    await log.noteHook(work.id, 'Stop', { stop_hook_active: false })
    await humanCommit('h3')
    sets.human.push(await head())
    await log.noteHook(work.id, 'PostToolUse', bash('u5'))

    const s = await sessionOf(store, work.id)
    expect([...s.set.commits.keys()].sort()).toEqual([...sets.session].sort())
    for (const h of sets.human) expect(s.set.commits.has(h)).toBe(false)
    expect(notes).toContainEqual({ type: 'trailer_missing', commits: [missing] })
    expect(s.set.commits.get(missing)).toEqual({ watched: true, trailer: false })
  })

  test('머지 뒤 커밋을 집합과 트레일러로 가른다(끝 줄의 칸)', async () => {
    const s = await sessionOf(store, work.id)
    const commits = await Promise.all(
      [...sets.session, ...sets.human].map(async (sha) => ({
        sha,
        author: 'test@relay.invalid',
        baseUpdate: false,
        trailers: workTrailers(await runGit(wt, ['log', '-1', '--format=%B', sha])),
      })),
    )
    // 트레일러를 끈 띄움이 있었으므로 집합만으로 가른다
    const after = afterOf(s, work.id, commits)
    expect(after).toEqual({ ...NO_COMMITS, session: 4, human: 3 })
    expect(sessionLedger(s, after)).toEqual({
      after_commits: after,
      trailer: false,
      session_set: { commits: 4, watched: 4, trailered: 3, incidents: 0 },
    })
  })

  test('심의 사고: hook_incident를 적고 프로젝트의 트레일러를 끈다. 다시 켠 앱은 같은 사고로 다시 끄지 않는다', async () => {
    await appendFile(
      store.workPath(work.id, 'hooks.log'),
      'pre-commit: 원래 훅 자리를 찾지 못함 ()\n',
    )
    await log.noteHook(work.id, 'Stop', {})
    expect(disabled).toEqual(['p1'])
    expect(notes).toContainEqual({
      type: 'hook_incident',
      lines: ['pre-commit: 원래 훅 자리를 찾지 못함 ()'],
    })
    await log.noteHook(work.id, 'Stop', {})
    await newLog().noteHook(work.id, 'Stop', {})
    expect(disabled).toEqual(['p1'])
    expect((await sessionOf(store, work.id)).incidents).toBe(1)
    expect(logs).toEqual([])
  })

  test('모르는 Work와 세션 기록이 없는 앱은 아무것도 하지 않는다', async () => {
    await log.noteHook('nope', 'PreToolUse', bash('x'))
    await new SessionLog().noteHook(work.id, 'PreToolUse', bash('x'))
    expect(await new SessionLog().prepareLaunch(work, true)).toMatchObject({ on: false })
  })
})

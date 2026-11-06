// [어댑터] 앱 로컬 거울과 그 읽기(M4b, docs/m4-design.md 4.3·4.4): $RELAY_HOME/mirror의 blobless bare clone, 기준·PR·Work
// 브랜치 받기가 사용자 레포의 ref·설정을 바꾸지 않음, git.ts의 logRange·isAncestor·mergeTree·patchId, 거울에서 읽은 같은
// 변경의 사실(main/works-record.ts changeFacts: Update branch, rebase, 더 커밋, 충돌을 푼 맞춤 머지)
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { isAncestor, logRange, mergeTree, patchId } from '../../src/adapters/git.ts'
import {
  ensureMirror,
  fetchBase,
  fetchPr,
  fetchWork,
  hasCommit,
  mirrorDir,
  originUrl,
  prRef,
  workRef,
} from '../../src/adapters/mirror.ts'
import { sameChange } from '../../src/engine/follow.ts'
import { changeFacts } from '../../src/main/works-change.ts'
import { cleanupAll, makeRepo, makeTempDir, runGit, type TestRepo } from '../support/repo.ts'

afterAll(cleanupAll)

let origin = ''
let repo: TestRepo
let home = ''

/** 사용자 레포의 ref와 설정(거울이 바꾸면 안 되는 것) */
const userState = async () => ({
  refs: await repo.git('for-each-ref', '--format=%(refname) %(objectname)'),
  config: await repo.git('config', '--local', '--list'),
  remotes: await repo.git('remote', '-v'),
})

/** origin에 GitHub의 refs/pull/<n>/head를 흉내 낸다 */
const pullRef = (n: number, sha: string) =>
  runGit(origin, ['update-ref', `refs/pull/${String(n)}/head`, sha])

beforeAll(async () => {
  const tmp = await makeTempDir('relay-mirror-')
  origin = join(tmp, 'origin.git')
  home = join(tmp, 'home')
  await runGit(tmp, ['init', '--quiet', '--bare', '--initial-branch', 'main', origin])
  repo = await makeRepo({ files: { 'a.txt': 'a\n', 'b.txt': 'b\n' } })
  await repo.git('remote', 'add', 'origin', origin)
  await repo.git('push', '--quiet', 'origin', 'main')
})

describe('거울', () => {
  test('origin의 bare clone을 $RELAY_HOME/mirror에 두고 사용자 레포는 바꾸지 않는다', async () => {
    const before = await userState()
    expect(await originUrl(repo.dir)).toBe(origin)
    const dir = await ensureMirror(home, repo.dir)
    expect(dir).toBe(mirrorDir(home, repo.dir))
    expect(dir.startsWith(join(home, 'mirror'))).toBe(true)
    expect(await runGit(dir, ['rev-parse', '--is-bare-repository'])).toBe('true')
    // 두 번째는 있는 거울을 쓴다
    expect(await ensureMirror(home, repo.dir)).toBe(dir)

    // 기준이 앞으로 가고, 세션이 Work 브랜치를 만들고 PR이 생긴다
    const base = await repo.commit('기준', { 'a.txt': 'a2\n' })
    await repo.git('push', '--quiet', 'origin', 'main')
    await repo.branch('relay/w1')
    const work = await repo.commit('고침', { 'b.txt': 'b2\n' })
    await repo.git('push', '--quiet', 'origin', 'relay/w1')
    await pullRef(7, work)
    await repo.checkout('main')
    const mid = await userState()

    await fetchBase(dir, 'main')
    expect(await runGit(dir, ['rev-parse', 'refs/heads/main'])).toBe(base)
    expect(await fetchPr(dir, 7)).toBe(true)
    expect(await runGit(dir, ['rev-parse', prRef(7)])).toBe(work)
    expect(await fetchPr(dir, 8)).toBe(false)
    expect(await fetchWork(dir, repo.dir, 'relay/w1')).toBe(true)
    expect(await runGit(dir, ['rev-parse', workRef('relay/w1')])).toBe(work)
    expect(await fetchWork(dir, repo.dir, 'relay/none')).toBe(false)
    expect(await hasCommit(dir, work)).toBe(true)
    expect(await hasCommit(dir, '0123456789abcdef0123456789abcdef01234567')).toBe(false)
    expect(await userState()).toEqual(mid)
    expect(mid.config).toBe(before.config)
    expect(mid.remotes).toBe(before.remotes)
  })

  test('origin이 없으면 거울을 만들지 않고 던진다', async () => {
    const lone = await makeRepo({ files: { 'a.txt': 'a\n' } })
    expect(await originUrl(lone.dir)).toBeNull()
    await expect(ensureMirror(home, lone.dir)).rejects.toThrow(/origin/)
    expect(existsSync(mirrorDir(home, lone.dir))).toBe(false)
  })
})

describe('git.ts의 거울 읽기', () => {
  let r: TestRepo
  let c0 = ''
  let c1 = ''
  let c2 = ''
  beforeAll(async () => {
    r = await makeRepo({ files: { 'x.txt': 'one\ntwo\nthree\n' } })
    c0 = await r.sha()
    c1 = await r.commit('첫\n\n본문 줄', { 'x.txt': 'one\nTWO\nthree\n' })
    await r.branch('side', c0)
    c2 = await r.commit('옆', { 'y.txt': 'y\n' })
    await r.checkout('main')
  })

  test('logRange: from..to의 커밋, 부모, 작성자, tree, 시각, 본문', async () => {
    const [only, ...rest] = await logRange(r.dir, { from: c0, to: c1 })
    expect(rest).toEqual([])
    expect(only).toMatchObject({ sha: c1, parents: [c0], author: 'test@relay.invalid' })
    expect(only?.tree).toBe(await r.git('rev-parse', `${c1}^{tree}`))
    expect(only?.body).toContain('본문 줄')
    expect(Number.isInteger(only?.time)).toBe(true)
    expect((await logRange(r.dir, { to: c1 })).map((c) => c.sha)).toEqual([c1, c0])
    expect((await logRange(r.dir, { to: c1, max: 1 })).map((c) => c.sha)).toEqual([c1])
    const later = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    expect(await logRange(r.dir, { to: c1, since: later })).toEqual([])
    expect((await logRange(r.dir, { to: c1, until: later })).map((c) => c.sha)).toEqual([c1, c0])
  })

  test('isAncestor, mergeTree(충돌이면 null), patchId(옮겨 심어도 같음, 바뀐 것이 없으면 null)', async () => {
    expect(await isAncestor(r.dir, c0, c1)).toBe(true)
    expect(await isAncestor(r.dir, c1, c2)).toBe(false)
    expect(await isAncestor(r.dir, c1, c1)).toBe(true)
    await expect(
      isAncestor(r.dir, '0123456789abcdef0123456789abcdef01234567', c1),
    ).rejects.toThrow()
    expect(await mergeTree(r.dir, c1, c2)).toMatch(/^[0-9a-f]{40}$/)
    await r.branch('clash', c0)
    const clash = await r.commit('겹침', { 'x.txt': 'one\n2\nthree\n' })
    await r.checkout('main')
    expect(await mergeTree(r.dir, c1, clash)).toBeNull()

    await r.branch('pick', c2)
    await r.git('cherry-pick', c1)
    const picked = await r.sha()
    await r.checkout('main')
    expect(await patchId(r.dir, c2, picked)).toBe(await patchId(r.dir, c0, c1))
    expect(await patchId(r.dir, c0, c2)).not.toBe(await patchId(r.dir, c0, c1))
    expect(await patchId(r.dir, c1, c1)).toBeNull()
  })
})

describe('같은 변경의 사실(changeFacts → sameChange)', () => {
  let r: TestRepo
  let base0 = ''
  let head = ''
  let base1 = ''
  beforeAll(async () => {
    r = await makeRepo({ files: { 'a.txt': 'a\n', 'b.txt': 'b\n', 'c.txt': 'c\n' } })
    base0 = await r.sha()
    await r.branch('work')
    head = await r.commit('고침', { 'b.txt': 'b fixed\n' })
    await r.checkout('main')
    base1 = await r.commit('기준이 앞으로', { 'a.txt': 'a2\n' })
  })

  const facts = (merged: string, mergeCommit: string | null = null) =>
    changeFacts(r.dir, 'refs/heads/main', { head, merged, mergeCommit, baseSha: base0 })

  test('Update branch(기준을 깨끗하게 합친 머지)만 더했으면 같다', async () => {
    await r.branch('updated', head)
    await r.git('merge', '--quiet', '--no-edit', '--no-ff', 'main')
    const updated = await r.sha()
    await r.checkout('main')
    const f = await facts(updated)
    expect(f).toMatchObject({ ancestor: true, between: [{ sha: updated, baseUpdate: true }] })
    expect(sameChange(f)).toBe(true)
  })

  test('앱이 쓴 relay 빚 커밋(적어 둔 SHA, 작성자 relay@localhost)만 더했으면 같다. 작성자만 같으면 다르다', async () => {
    await r.branch('debt', head)
    await r.write({ '.relay/debt/d1.md': '빚\n' })
    await r.git('add', '--all')
    await r.git('commit', '--quiet', '-m', '빚', '--author', 'relay <relay@localhost>')
    const debt = await r.sha()
    await r.checkout('main')
    const known = await changeFacts(r.dir, 'refs/heads/main', {
      head,
      merged: debt,
      mergeCommit: null,
      baseSha: base0,
      debts: new Set([debt]),
    })
    expect(known.between).toMatchObject([{ sha: debt, relay: true }])
    expect(sameChange(known)).toBe(true)
    // 세션이 작성자를 relay@localhost로 지어 커밋함(앱이 적은 SHA가 아님)
    const forged = await facts(debt)
    expect(forged.between).toMatchObject([{ sha: debt, relay: false }])
    expect(sameChange(forged)).toBe(false)
  })

  test('rebase로 맞춤(조상이 아님): 머지 커밋의 첫 부모에서 잰 patch-id가 같으면 같다', async () => {
    await r.branch('rebased', base1)
    await r.git('cherry-pick', head)
    const rebased = await r.sha()
    await r.checkout('main')
    // squash 머지: 기준에 PR 변경 하나를 올린 커밋
    await r.branch('squashed', base1)
    await r.git('cherry-pick', head)
    const squash = await r.sha()
    await r.checkout('main')
    const f = await facts(rebased, squash)
    expect(f.ancestor).toBe(false)
    expect(f.patch.head).not.toBeNull()
    expect(sameChange(f)).toBe(true)
  })

  test('사람이 더 커밋했거나 맞춤 머지에서 충돌을 손으로 풀었으면 다르다', async () => {
    await r.branch('more', head)
    const more = await r.commit('더 고침', { 'c.txt': 'c more\n' })
    await r.checkout('main')
    expect(sameChange(await facts(more))).toBe(false)

    // 기준이 같은 줄을 바꿔 충돌하고, 사람이 손으로 푼 맞춤 머지
    await r.branch('clash-base', base1)
    const clashBase = await r.commit('기준이 b를 바꿈', { 'b.txt': 'b base\n' })
    await r.branch('resolved', head)
    await r.git('merge', '--quiet', '--no-commit', clashBase).catch(() => '')
    await r.write({ 'b.txt': 'b by hand\n' })
    await r.git('add', '--all')
    await r.git('commit', '--quiet', '--no-edit')
    const resolved = await r.sha()
    await r.checkout('main')
    await r.git('merge', '--quiet', '--ff-only', clashBase)
    const f = await facts(resolved)
    expect(f.between).toMatchObject([{ sha: resolved, baseUpdate: false }])
    expect(sameChange(f)).toBe(false)
  })

  test('머지된 head가 거울에 없으면 모름', async () => {
    const f = await facts('0123456789abcdef0123456789abcdef01234567')
    expect(sameChange(f)).toBeNull()
  })
})

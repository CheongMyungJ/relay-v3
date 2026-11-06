// [어댑터] 기록 안 된 나빠짐(M3b, src/engine/debt-record.ts unrecordedRegressions): 실적 장부의 마지막 머지(앞 기록)와 기준
// 브랜치를 실제 git으로 견준다. (1) 앱 밖에서 머지된 앞 내보내기의 나빠진 래칫, (2) 앞 기록 뒤 기준에 들어온 file_lines 나빠짐,
// 기준의 .relay/debt/에 같은 경로·래칫의 빚이 있으면 기록된 것
import { afterAll, expect, test } from 'vitest'
import { formatDebt } from '../../src/core/debt.ts'
import type { LedgerEntry } from '../../src/core/ledger.ts'
import type { RatchetResult } from '../../src/core/types.ts'
import { unrecordedRegressions } from '../../src/engine/debt-record.ts'
import { cleanupAll, makeRepo } from '../support/repo.ts'

afterAll(cleanupAll)

const QUALITY = JSON.stringify({
  version: 1,
  commands: { fast: [] },
  ratchets: [{ id: 'file-size', kind: 'file_lines', max: 10 }],
})

const lines = (n: number) => 'x\n'.repeat(n)

function entry(more: Partial<LedgerEntry>): LedgerEntry {
  return {
    ts: '2026-11-06T00:00:00Z',
    project: 'p1',
    work: 'w1',
    head: 'h',
    conclusion: 'human_merge',
    condition: null,
    shadow: false,
    relay_version: '0',
    ...more,
  }
}

/** 장부의 모든 Work가 이 기준으로 머지됐다 */
const all = async () => true

const TESTS: RatchetResult = {
  id: 'tests',
  status: 'worse',
  base: 5,
  head: 4,
  detail: '시험 수 5 → 4',
}

test('장부에 머지가 없으면 보지 않는다', async () => {
  const repo = await makeRepo({ files: { '.relay/quality.json': QUALITY } })
  const none = await unrecordedRegressions({
    repo: repo.dir,
    base: 'main',
    ledger: [],
    project: 'p1',
    sameBase: all,
  })
  expect(none).toEqual([])
})

test('앞 기록 뒤 기준에 들어온 파일 크기 나빠짐과, 앱 밖에서 머지된 앞 내보내기의 나빠짐', async () => {
  const repo = await makeRepo({
    files: { '.relay/quality.json': QUALITY, 'src/a.js': lines(5), 'src/big.js': lines(12) },
  })
  const prev = await repo.sha()
  // 앞 기록 뒤 앱을 거치지 않고: 새로 넘음, 이미 넘은 파일이 더 커짐, 넘지 않는 바꿈
  await repo.commit('직접 push', {
    'src/a.js': lines(11),
    'src/big.js': lines(13),
    'src/small.js': lines(3),
  })
  const ledger = [
    entry({ head: prev, worse: [TESTS] }),
    entry({ head: prev, by: 'human-override', merged_head: prev }),
    entry({ project: 'p2', head: 'x', by: 'human-override', merged_head: 'x' }),
  ]
  const found = await unrecordedRegressions({
    repo: repo.dir,
    base: 'main',
    ledger,
    project: 'p1',
    sameBase: all,
  })
  expect(found).toEqual([
    'tests: 시험 수 5 → 4 (앱 밖에서 머지됨)',
    'file-size: src/a.js 5 → 11 (앞 기록 뒤 기준에 들어옴)',
    'file-size: src/big.js 12 → 13 (앞 기록 뒤 기준에 들어옴)',
  ])
  // 앱에서 사람이 머지한 앞 기록은 그 head의 나빠짐을 다시 알리지 않는다(빚 확인을 거쳤다)
  const human = [ledger[0] as LedgerEntry, entry({ head: prev, by: 'human', merged_head: prev })]
  expect(
    await unrecordedRegressions({
      repo: repo.dir,
      base: 'main',
      ledger: human,
      project: 'p1',
      sameBase: all,
    }),
  ).toHaveLength(2)
})

test('기준의 .relay/debt/에 같은 경로·래칫의 빚이 있으면 기록된 것이다. 앞 기록의 커밋이 없으면 (2)는 건너뛴다', async () => {
  const repo = await makeRepo({ files: { '.relay/quality.json': QUALITY, 'src/a.js': lines(5) } })
  const prev = await repo.sha()
  const debt = (id: string, path: string, metric: string) =>
    formatDebt({
      id,
      anchor: { path, metric },
      kind: 'accepted_regression',
      source: 'w0',
      reason: '나빠진 채 머지됨',
      created: '2026-11-06',
    })
  await repo.commit('나빠짐과 그 빚', {
    'src/a.js': lines(20),
    'src/b.js': lines(20),
    '.relay/debt/r-file-size-src-a-js.md': debt('r-file-size-src-a-js', 'src/a.js', 'file-size'),
    '.relay/debt/r-tests.md': debt('r-tests', '.relay/quality.json', 'tests'),
  })
  const ledger = [
    entry({ head: prev, worse: [TESTS] }),
    entry({ head: prev, by: 'human-override', merged_head: prev }),
  ]
  expect(
    await unrecordedRegressions({
      repo: repo.dir,
      base: 'main',
      ledger,
      project: 'p1',
      sameBase: all,
    }),
  ).toEqual(['file-size: src/b.js 없음 → 20 (앞 기록 뒤 기준에 들어옴)'])
  const gone = [entry({ head: 'f'.repeat(40), by: 'human', merged_head: 'f'.repeat(40) })]
  expect(
    await unrecordedRegressions({
      repo: repo.dir,
      base: 'main',
      ledger: gone,
      project: 'p1',
      sameBase: all,
    }),
  ).toEqual([])
})

test('기준이 앞 기록의 머지를 아직 받지 않았으면(fetch 전) 앞 기록이 줄인 파일을 나빠짐으로 보지 않는다. squash 머지도', async () => {
  const repo = await makeRepo({
    files: { '.relay/quality.json': QUALITY, 'src/a.js': lines(14), 'src/old.js': lines(15) },
  })
  const base = await repo.sha()
  // 앞 Work가 큰 파일을 줄이고 지웠다. 기준(main)은 그 머지 전 그대로다
  await repo.branch('work')
  await repo.checkout('work')
  const prev = await repo.commit('줄임', { 'src/a.js': lines(12), 'src/old.js': null })
  await repo.checkout('main')
  const ledger = [entry({ head: prev, by: 'human', merged_head: prev })]
  const o = { repo: repo.dir, base: 'main', ledger, project: 'p1', sameBase: all }
  expect(await unrecordedRegressions(o)).toEqual([])
  // squash 머지: 기준에 앞 기록의 트리를 담은 새 커밋(prev는 조상이 아님). 그 뒤 앱 밖에서 들어온 것만 나빠짐이다
  await repo.commit('squash', { 'src/a.js': lines(12), 'src/old.js': null })
  expect(await unrecordedRegressions(o)).toEqual([])
  await repo.commit('직접 push', { 'src/big.js': lines(20) })
  expect(await unrecordedRegressions(o)).toEqual([
    'file-size: src/big.js 없음 → 20 (앞 기록 뒤 기준에 들어옴)',
  ])
  expect(await repo.git('merge-base', '--is-ancestor', base, 'main')).toBe('')
})

test('앞 기록은 같은 기준 브랜치로 머지된 마지막 Work다', async () => {
  const repo = await makeRepo({ files: { '.relay/quality.json': QUALITY, 'src/x.js': lines(30) } })
  const onMain = await repo.sha()
  // 다른 기준(develop)의 Work가 x.js를 나눴다. main에는 들어오지 않았다
  await repo.branch('develop')
  await repo.checkout('develop')
  const onDevelop = await repo.commit('나눔', { 'src/x.js': lines(5), 'src/y.js': lines(5) })
  await repo.checkout('main')
  const ledger = [
    entry({ work: 'wm', head: onMain, by: 'human', merged_head: onMain }),
    entry({
      work: 'wd',
      head: onDevelop,
      by: 'human-override',
      merged_head: onDevelop,
      worse: [TESTS],
    }),
    entry({ work: 'wd', head: onDevelop, worse: [TESTS] }),
  ]
  const bases: Record<string, string> = { wm: 'main', wd: 'develop' }
  const sameBase = async (work: string) => bases[work] === 'main'
  expect(
    await unrecordedRegressions({ repo: repo.dir, base: 'main', ledger, project: 'p1', sameBase }),
  ).toEqual([])
})

// [흐름] 증거의 곁들일 정리 확인(M3c, V41, engine/tidy.ts checkTidy): 실제 git 임시 레포에서 기준의 빚을 읽고, head의 항목
// 파일과 anchor 파일의 줄 수로 갚음을 가르며, 계약 tidy의 anchor에 닿은 파일의 바뀐 줄을 센다. 끄면 tidy는 null이다. 종류마다의
// 자세한 판정은 [단위] tidy.test.ts.
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { formatDebt } from '../../src/core/debt.ts'
import type { DebtItem } from '../../src/core/types.ts'
import { check } from '../../src/engine/check.ts'
import { NOW, QUALITY } from '../support/calc.ts'
import { cleanupAll, makeRepo, makeTempDir, type TestRepo } from '../support/repo.ts'
import { CONTRACT } from '../support/works-flow.ts'

afterAll(cleanupAll)

const debt = (id: string, o: Partial<DebtItem>): [string, string] => [
  `.relay/debt/${id}.md`,
  formatDebt({
    id,
    anchor: { path: 'src/a.js' },
    kind: 'tidy',
    source: 'w0',
    reason: `${id}의 까닭`,
    created: '2026-01-01',
    ...o,
  }),
]

const big = (n: number) => 'export const x = 1\n'.repeat(n)

let repo: TestRepo
let head: string
let contractPath: string

beforeAll(async () => {
  repo = await makeRepo({
    files: {
      '.relay/quality.json': JSON.stringify({ ...QUALITY, tidy_max_lines: 30 }),
      'src/a.js': 'export const a = 1\n',
      'src/big.js': big(700),
      'src/c.js': 'export const c = 1\n',
      ...Object.fromEntries([
        debt('tidy-a', { created: '2026-02-01' }),
        debt('big', {
          kind: 'accepted_regression',
          anchor: { path: 'src/big.js', metric: 'file-size' },
        }),
        debt('gap-c', { kind: 'test_gap', anchor: { path: 'src/c.js' } }),
        debt('far', { anchor: { path: 'lib/far.js' } }),
      ]),
      '.relay/debt/broken.md': '깨진 항목\n',
    },
  })
  await repo.branch('feature')
  head = await repo.commit('정리', {
    'src/a.js': 'export const a = 2\n',
    'src/big.js': big(590),
    'src/c.js': 'export const c = 2\n',
    '.relay/debt/tidy-a.md': null,
    '.relay/debt/big.md': null,
  })
  contractPath = join(await makeTempDir('relay-contract-'), 'contract.json')
  const contract = { ...CONTRACT, id: 'fix-clamp', tidy: ['big', 'tidy-a', 'broken', 'nope'] }
  await writeFile(contractPath, JSON.stringify(contract))
})

const run = async (tidy: boolean) =>
  check({
    repo: repo.dir,
    base: 'main',
    head,
    home: await makeTempDir('relay-home-'),
    now: NOW,
    contractPath,
    tidy,
  })

test('계약 tidy의 갚음, 깨진 id와 없는 id, 건드린 곳의 빚, 정리 몫과 상한', async () => {
  const bundle = await run(true)
  expect(bundle.missing.filter((m) => m.startsWith('빚'))).toEqual([])
  const t = bundle.tidy
  expect(t?.taken).toEqual(['big', 'tidy-a', 'broken', 'nope'])
  expect(t?.items.map((i) => [i.id, i.status, i.detail])).toEqual([
    ['big', 'paid', '590줄 ≤ 600 (항목 파일을 지움)'],
    ['tidy-a', 'paid', '항목 파일을 지움'],
    ['broken', 'unknown', '기준의 항목 파일을 읽지 못함(형식)'],
    ['nope', 'unknown', '기준의 빚 장부에 없음'],
    ['gap-c', 'open', '항목 파일이 남음'],
  ])
  // 정리 몫: big.js(−110)와 a.js(+1 −1). c.js는 계약 tidy가 아니다
  expect(t?.lines).toBe(112)
  expect(t?.max).toBe(30)
  // 알림이다: 갚음과 상한은 관문에 쓰는 칸(신호, missing)에 들어가지 않는다
  expect(bundle.signals.some((s) => s.path?.startsWith('.relay/debt/'))).toBe(false)
})

test('끄면 tidy는 null', async () => {
  expect((await run(false)).tidy).toBeNull()
})

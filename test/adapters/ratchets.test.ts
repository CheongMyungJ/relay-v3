// [어댑터] 앱이 직접 재는 래칫(V55~V57, engine/ratchets.ts measureRatchets): 실제 git 레포의 기준·결과 커밋에서 억누름과
// 중복을 세고(adapters git.ts grepLines·readBlobs), 수용 시험 명령이 check worktree(실행 폴더)에 쓴 커버리지 보고서를
// 읽는다. 셈과 비교의 자세한 경우는 [단위] suppressions·duplication·coverage.test.ts.
import { afterAll, describe, expect, test } from 'vitest'
import { diffRaw, grepLines, readBlobs } from '../../src/adapters/git.ts'
import { buildDiffFacts } from '../../src/core/diff.ts'
import { parseQuality } from '../../src/core/quality.ts'
import type { DiffFacts, QualityConfig, RatchetSpec } from '../../src/core/types.ts'
import { measureRatchets } from '../../src/engine/ratchets.ts'
import { workspace } from '../../src/engine/workspace.ts'
import { GREP_NEEDLES } from '../../src/engine/suppressions.ts'
import { cleanupAll, makeRepo, makeTempDir, nodeCommand, type TestRepo } from '../support/repo.ts'

afterAll(cleanupAll)

const BODY = `  let sum = 0
  for (const item of items) {
    if (item.price > 100) {
      sum += item.price * rate
    } else {
      sum += item.price
    }
  }
  const rounded = Math.round(sum * 100) / 100
  return { sum: rounded, count: items.length }
}
`

async function diffOf(repo: TestRepo, base: string, head: string): Promise<DiffFacts> {
  const raw = await diffRaw(repo.dir, base, head)
  return buildDiffFacts(base, head, raw.nameStatus, raw.numstat, raw.patch)
}

function quality(ratchets: RatchetSpec[], acceptance?: string): QualityConfig {
  const doc = {
    version: 1,
    commands: {
      fast: [],
      ...(acceptance === undefined
        ? {}
        : { acceptance: { id: 'accept', run: acceptance, junit: '.relay-out/junit.xml' } }),
    },
    test_globs: ['test/**'],
    ratchets,
  }
  const q = parseQuality(JSON.stringify(doc))
  if (!q.ok) throw new Error(q.errors.join('; '))
  return q.value
}

describe('git에서 셈', () => {
  test('grepLines: 경로에 빈칸·콜론이 있어도 줄과 글을 읽고, 맞는 것이 없으면 빈 목록', async () => {
    // Windows의 파일 이름에는 콜론을 쓸 수 없다(작업 트리에 만들지 못한다): 그곳에서는 빈칸만 본다
    const odd = process.platform === 'win32' ? 'src/a b.ts' : 'src/a b:c.ts'
    const repo = await makeRepo({
      files: { [odd]: 'x\n// @ts-ignore\n', 'bin.dat': new Uint8Array([0, 64, 116, 115]) },
    })
    const sha = await repo.sha()
    expect(await grepLines(repo.dir, sha, GREP_NEEDLES)).toEqual([
      { path: odd, line: 2, text: '// @ts-ignore' },
    ])
    expect(await grepLines(repo.dir, sha, ['nothing-here'])).toEqual([])
  })

  test('readBlobs: 한 번에 읽고 큰 파일·바이너리·없는 파일은 뺀다', async () => {
    const repo = await makeRepo({
      files: { 'a.ts': 'a\n', 'big.ts': 'x'.repeat(100), 'bin.ts': new Uint8Array([0, 1]) },
    })
    const m = await readBlobs(repo.dir, await repo.sha(), ['a.ts', 'big.ts', 'bin.ts', 'no.ts'], 50)
    expect([...m]).toEqual([['a.ts', 'a\n']])
  })

  test('기준·결과 커밋의 억누름과 중복을 센다(작업 트리가 아니라 커밋을 본다)', async () => {
    const repo = await makeRepo({
      files: {
        'src/a.ts': `export function total(items, rate) {\n${BODY}`,
        'src/old.py': 'import os  # noqa\n',
        'node_modules/x/i.js': '// @ts-ignore\n',
      },
    })
    const base = await repo.sha()
    const head = await repo.commit('복사와 억누름', {
      'src/b.ts': `// @ts-ignore\nexport function amount(rows, f) {\n${BODY.replace(/item/g, 'row')}`,
      'test/a.test.ts': "it.skip('나중에', () => {})\n",
    })
    // 커밋하지 않은 작업 트리는 세지 않는다
    await repo.write({ 'src/c.ts': '// @ts-ignore\n' })
    const q = quality([
      { id: 'sup', kind: 'suppressions' },
      { id: 'dup', kind: 'duplication' },
    ])
    const home = await makeTempDir('relay-home-')
    const missing: string[] = []
    const ws = workspace({ home, key: 'k', root: repo.dir, base, head, rerun: false, missing })
    const diff = await diffOf(repo, base, head)
    const [sup, dup] = await measureRatchets({
      q,
      ws,
      root: repo.dir,
      diff,
      acceptance: null,
      acceptanceStarted: null,
      missing,
    })
    expect(sup).toMatchObject({
      status: 'worse',
      base: 1,
      head: 3,
      detail: '억누름 1 → 3: src/b.ts:1 @ts-ignore, test/a.test.ts:1 .skip(',
      offenders: [
        { path: 'src/b.ts', head: 1 },
        { path: 'test/a.test.ts', head: 1 },
      ],
    })
    expect(dup).toMatchObject({
      status: 'worse',
      base: 0,
      where: ['src/b.ts:2-12 duplicates src/a.ts:1-11'],
    })
    expect(missing).toEqual([])
  })
})

describe('수용 시험이 쓴 커버리지 보고서', () => {
  async function measured(write: boolean, min = 0.8) {
    const repo = await makeRepo({ files: { 'src/calc.js': 'a\n' } })
    const base = await repo.sha()
    const head = await repo.commit('더함', { 'src/calc.js': 'a\nb\nc\n' })
    // 수용 시험: 실행 폴더(head check worktree)에 절대 경로의 lcov를 쓴다
    const run = await nodeCommand(
      `const fs = require('fs'); const write = ${String(write)}
const lcov = 'SF:' + process.cwd() + '/src/calc.js\\nDA:1,1\\nDA:2,0\\nDA:3,1\\nend_of_record\\n'
if (write) { fs.mkdirSync('coverage', { recursive: true }); fs.writeFileSync('coverage/lcov.info', lcov) }`,
    )
    const q = quality(
      [{ id: 'cov', kind: 'diff_coverage', report: 'coverage/lcov.info', format: 'lcov', min }],
      run,
    )
    const home = await makeTempDir('relay-home-')
    const missing: string[] = []
    const ws = workspace({ home, key: 'k', root: repo.dir, base, head, rerun: false, missing })
    const started = Date.now()
    const acceptance = await ws.command(q.commands.acceptance ?? { id: '', run: '' }, false)
    const diff = await diffOf(repo, base, head)
    const [cov] = await measureRatchets({
      q,
      ws,
      root: repo.dir,
      diff,
      acceptance,
      acceptanceStarted: started,
      missing,
    })
    return cov
  }

  test('실행 폴더 아래의 절대 경로를 레포 경로로 맞추고 더한 줄(2, 3)과 견준다', async () => {
    expect(await measured(true)).toEqual({
      id: 'cov',
      status: 'worse',
      head: 50,
      detail: '바뀐 줄 커버리지 50.0% (1/2줄, 바닥 80.0%) · 안 덮은 줄: src/calc.js:2',
      where: [
        'covered 1 of 2 added lines (50.0%), below the floor 80.0%',
        'src/calc.js:2 not covered',
      ],
    })
    expect((await measured(true, 0.5))?.status).toBe('same')
  })

  test('보고서를 쓰지 않으면 잴 수 없음', async () => {
    expect(await measured(false)).toEqual({
      id: 'cov',
      status: 'unknown',
      detail: '잴 수 없음: 보고서가 없음 (coverage/lcov.info)',
    })
  })
})

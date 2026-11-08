// [어댑터] 구조 규칙 래칫(V74)과 후보(V75): 실제 git 레포의 기준·결과 커밋에서 새로 어긴 import와 그 줄, 옮긴 파일을 보고,
// relay-v3 자신의 체크아웃에서 낸 후보가 손으로 적은 층(eslint.config.mjs)과 맞는지 본다(structure-rules.md 5절의 맞춤 시험).
// 뽑기·풀기·비교·후보의 자세한 경우는 [단위] imports.test.ts·import-rules.test.ts.
import { resolve } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { diffRaw } from '../../src/adapters/git.ts'
import { buildDiffFacts } from '../../src/core/diff.ts'
import { DEFAULT_TEST_GLOBS, parseQuality } from '../../src/core/quality.ts'
import type { QualityConfig } from '../../src/core/types.ts'
import { layersOf, structureCandidates } from '../../src/engine/import-graph.ts'
import { ruleBroken, type ImportsSpec } from '../../src/engine/import-rules.ts'
import { scanRepo } from '../../src/engine/init.ts'
import { measureRatchets } from '../../src/engine/ratchets.ts'
import { workspace } from '../../src/engine/workspace.ts'
import { cleanupAll, makeRepo, makeTempDir } from '../support/repo.ts'

afterAll(cleanupAll)

const ROOT = resolve(import.meta.dirname, '../..')

function quality(spec: ImportsSpec): QualityConfig {
  const q = parseQuality(JSON.stringify({ version: 1, commands: { fast: [] }, ratchets: [spec] }))
  if (!q.ok) throw new Error(q.errors.join('; '))
  return q.value
}

describe('기준·결과 커밋에서 잼', () => {
  test('새로 어긴 import와 줄을 알리고, 옮긴 파일의 옛 어김은 새로 세지 않는다. 작업 트리는 보지 않는다', async () => {
    const repo = await makeRepo({
      files: {
        'src/core/a.ts': "import { run } from '../engine/run.ts'\n",
        'src/core/b.ts': 'export const b = 1\n',
        'src/engine/run.ts': "import { b } from '../core/b.ts'\nexport const run = b\n",
        'src/cli/main.ts': "import { run } from '../engine/run.ts'\n",
        'test/core.test.ts': "import { main } from '../src/cli/main.ts'\n",
      },
    })
    const base = await repo.sha()
    await repo.git('mv', 'src/core/a.ts', 'src/core/moved.ts')
    const head = await repo.commit('옮기고 새로 어김', {
      'src/core/b.ts': "import '../cli/main.ts'\nexport const b = 1\n",
    })
    await repo.write({ 'src/core/c.ts': "import '../cli/main.ts'\n" })
    const q = quality({
      id: 'layers',
      kind: 'imports',
      layers: [['src/cli'], ['src/engine'], ['src/core']],
    })
    const missing: string[] = []
    const ws = workspace({
      home: await makeTempDir('relay-home-'),
      key: 'k',
      root: repo.dir,
      base,
      head,
      rerun: false,
      missing,
    })
    const raw = await diffRaw(repo.dir, base, head)
    const diff = buildDiffFacts(base, head, raw.nameStatus, raw.numstat, raw.patch)
    const [r] = await measureRatchets({
      q,
      ws,
      root: repo.dir,
      diff,
      acceptance: null,
      acceptanceStarted: null,
      missing,
    })
    expect(r).toEqual({
      id: 'layers',
      status: 'worse',
      base: 1,
      head: 2,
      detail:
        '구조 규칙을 어긴 import 1 → 2, 새로 어김 1: src/core/b.ts:1 → src/cli/main.ts (src/core는 위층 src/cli를 가져오지 않음)',
      offenders: [{ path: 'src/core/b.ts', head: 1 }],
      where: ['src/core/b.ts:1 → src/cli/main.ts (src/core는 위층 src/cli를 가져오지 않음)'],
    })
    expect(missing).toEqual([])
  })
})

describe('relay-v3 자신으로 맞춤 시험', () => {
  test('작업 트리의 import에서 낸 첫 후보가 eslint.config.mjs의 층과 맞는다(어긴 곳 0)', async () => {
    const scan = await scanRepo(ROOT)
    const facts = scan.imports
    if (facts === undefined) throw new Error('import 그래프가 없음')
    expect(facts.unseen.filter((u) => u.from.startsWith('src/'))).toEqual([])
    const [first] = structureCandidates(facts, scan.files, DEFAULT_TEST_GLOBS)
    expect(first?.label).toMatch(/^src의 층\(위 > 아래\): .*\(지금 어긴 곳 0\)$/)
    const spec: ImportsSpec = { id: 'x', kind: 'imports', layers: layersOf(first?.value ?? '') }
    // eslint의 no-restricted-imports가 막는 방향은 모두 이 층에서도 어김이다
    const banned: [string, string][] = [
      ['src/core/a.ts', 'src/adapters/x.ts'],
      ['src/core/a.ts', 'src/engine/x.ts'],
      ['src/core/a.ts', 'src/cli/x.ts'],
      ['src/adapters/a.ts', 'src/engine/x.ts'],
      ['src/adapters/a.ts', 'src/cli/x.ts'],
      ['src/engine/a.ts', 'src/cli/x.ts'],
      ['src/core/a.ts', 'src/main/x.ts'],
      ['src/engine/a.ts', 'src/main/x.ts'],
    ]
    for (const [from, to] of banned)
      expect(ruleBroken(spec, from, to), `${from} → ${to}`).not.toBeNull()
    // 거꾸로(위가 아래를)는 된다
    for (const [from, to] of banned)
      expect(ruleBroken(spec, to, from), `${to} → ${from}`).toBeNull()
  })
})

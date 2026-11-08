// [단위] 구조 규칙 래칫(V74, engine/import-rules.ts)과 후보 내기(V75, engine/import-graph.ts): 층과 금지 맞추기, 셀 파일(시험·범위),
// 기준과 견주기(집합: 하나 고치고 하나 어기면 나빠짐, 옮긴 파일), 폴더 그래프의 층·한쪽·거의 한쪽 후보. quality.json 검증은 quality.test.ts.
import { describe, expect, test } from 'vitest'
import { DEFAULT_TEST_GLOBS } from '../../src/core/quality.ts'
import type { DiffFacts } from '../../src/core/types.ts'
import { layersOf, structureCandidates } from '../../src/engine/import-graph.ts'
import {
  importsRatchet,
  ruleBroken,
  unseenIn,
  violations,
  type ImportsSpec,
} from '../../src/engine/import-rules.ts'
import type { ImportFacts } from '../../src/engine/imports.ts'

const LAYERS: ImportsSpec = {
  id: 'layers',
  kind: 'imports',
  layers: [['src/cli'], ['src/engine'], ['src/core/**']],
  forbid: [{ from: ['src/ui'], to: ['src/db'] }],
}

const graph = (pairs: [string, string, number?][], unseen: ImportFacts['unseen'] = []) => ({
  edges: pairs.map(([from, to, line]) => ({ from, to, line: line ?? 1, spec: to })),
  unseen,
  files: 0,
})

const noDiff: Pick<DiffFacts, 'files'> = { files: [] }

describe('규칙 맞추기', () => {
  test('층: 아래가 위를 가져오면 어김(건너뛰기 포함), 위가 아래는 됨, 묶음 밖은 규칙 밖. 금지: 앞이 뒤를', () => {
    expect(ruleBroken(LAYERS, 'src/core/a.ts', 'src/engine/b.ts')).toBe(
      'src/core는 위층 src/engine를 가져오지 않음',
    )
    expect(ruleBroken(LAYERS, 'src/core/a.ts', 'src/cli/main.ts')).not.toBeNull()
    expect(ruleBroken(LAYERS, 'src/cli/main.ts', 'src/core/a.ts')).toBeNull()
    expect(ruleBroken(LAYERS, 'src/engine/a.ts', 'src/engine/b.ts')).toBeNull()
    expect(ruleBroken(LAYERS, 'src/util/a.ts', 'src/cli/x.ts')).toBeNull()
    expect(ruleBroken(LAYERS, 'src/ui/v.ts', 'src/db/q.ts')).toBe('src/ui는 src/db를 가져오지 않음')
    // 폴더 대상(Go 패키지)도 묶음 안이다
    expect(ruleBroken(LAYERS, 'src/core/a.go', 'src/engine')).not.toBeNull()
  })

  test('셀 파일: 시험 파일은 기본으로 빼고(tests: true면 넣음), include·exclude, 읽지 않는 언어는 뺀다', () => {
    const g = graph([
      ['src/core/a.ts', 'src/engine/x.ts'],
      ['src/core/a.test.ts', 'src/engine/x.ts'],
      ['src/core/gen.ts', 'src/engine/x.ts'],
      ['src/core/A.java', 'src/engine/x.ts'],
    ])
    const at = (spec: ImportsSpec) => violations(spec, g, DEFAULT_TEST_GLOBS).map((v) => v.from)
    expect(at(LAYERS)).toEqual(['src/core/a.ts', 'src/core/gen.ts'])
    expect(at({ ...LAYERS, tests: true, exclude: ['**/gen.ts'] })).toEqual([
      'src/core/a.ts',
      'src/core/a.test.ts',
    ])
    expect(at({ ...LAYERS, include: ['src/core/gen.ts'] })).toEqual(['src/core/gen.ts'])
  })

  test('못 봄은 규칙 묶음 안의 가져오는 쪽만 센다', () => {
    const g = graph(
      [],
      [
        { from: 'src/core/a.ts', line: 1, spec: 'import(…)' },
        { from: 'scripts/x.ts', line: 1, spec: 'import(…)' },
        { from: 'src/ui/a.test.ts', line: 1, spec: './gone' },
      ],
    )
    expect(unseenIn(LAYERS, g, DEFAULT_TEST_GLOBS)).toBe(1)
  })
})

describe('기준과 견주기', () => {
  const v = (pairs: [string, string, number?][]) =>
    violations(LAYERS, graph(pairs), DEFAULT_TEST_GLOBS)

  test('같음, 좋아짐(고친 것만), 나빠짐(새로 어김: 줄과 규칙을 where로)', () => {
    const base = v([['src/core/a.ts', 'src/engine/b.ts']])
    expect(importsRatchet(LAYERS, base, base, noDiff)).toEqual({
      id: 'layers',
      status: 'same',
      base: 1,
      head: 1,
      detail: '구조 규칙을 어긴 import 1 → 1',
    })
    expect(importsRatchet(LAYERS, base, [], noDiff).status).toBe('better')
    const head = v([
      ['src/core/a.ts', 'src/engine/b.ts'],
      ['src/core/a.ts', 'src/cli/main.ts', 4],
      ['src/ui/v.ts', 'src/db/q.ts', 2],
    ])
    expect(importsRatchet(LAYERS, base, head, noDiff)).toEqual({
      id: 'layers',
      status: 'worse',
      base: 1,
      head: 3,
      detail:
        '구조 규칙을 어긴 import 1 → 3, 새로 어김 2: src/core/a.ts:4 → src/cli/main.ts (src/core는 위층 src/cli를 가져오지 않음), src/ui/v.ts:2 → src/db/q.ts (src/ui는 src/db를 가져오지 않음)',
      offenders: [
        { path: 'src/core/a.ts', base: 1, head: 2 },
        { path: 'src/ui/v.ts', head: 1 },
      ],
      where: [
        'src/core/a.ts:4 → src/cli/main.ts (src/core는 위층 src/cli를 가져오지 않음)',
        'src/ui/v.ts:2 → src/db/q.ts (src/ui는 src/db를 가져오지 않음)',
      ],
    })
  })

  test('하나 고치고 하나 새로 어기면 수는 같아도 나빠짐', () => {
    const r = importsRatchet(
      LAYERS,
      v([['src/core/a.ts', 'src/engine/b.ts']]),
      v([['src/core/c.ts', 'src/engine/b.ts']]),
      noDiff,
    )
    expect(r).toMatchObject({ status: 'worse', base: 1, head: 1 })
  })

  test('옮긴 파일(가져오는 쪽, 대상)은 옛 자리와 견준다', () => {
    const diff: Pick<DiffFacts, 'files'> = {
      files: [
        {
          path: 'src/core/z.ts',
          old_path: 'src/core/a.ts',
          status: 'R',
          added: 0,
          deleted: 0,
          binary: false,
        },
        {
          path: 'src/engine/y.ts',
          old_path: 'src/engine/b.ts',
          status: 'R',
          added: 0,
          deleted: 0,
          binary: false,
        },
      ] as DiffFacts['files'],
    }
    const r = importsRatchet(
      LAYERS,
      v([['src/core/a.ts', 'src/engine/b.ts']]),
      v([['src/core/z.ts', 'src/engine/y.ts']]),
      diff,
    )
    expect(r.status).toBe('same')
  })
})

describe('후보 내기', () => {
  const files = (paths: string[]) => paths

  test('층: 셋 이상의 단계가 순환 없이 이어지면 층 후보(같은 단계는 쉼표). 그 부모에서는 쌍 후보를 내지 않는다', () => {
    const g = graph([
      ['src/cli/a.ts', 'src/engine/e.ts'],
      ['src/main/m.ts', 'src/engine/e.ts'],
      ['src/engine/e.ts', 'src/adapters/g.ts'],
      ['src/engine/e.ts', 'src/core/t.ts'],
      ['src/adapters/g.ts', 'src/core/t.ts'],
      ['test/x.test.ts', 'src/cli/a.ts'],
    ])
    const c = structureCandidates(g, ['src/cli/a.ts', 'test/x.test.ts'], DEFAULT_TEST_GLOBS)
    expect(c).toEqual([
      {
        value: 'src/cli,src/main>src/engine>src/adapters>src/core',
        label:
          'src의 층(위 > 아래): cli·main > engine > adapters > core. 아래 층은 위 층을 가져오지 않음 (지금 어긴 곳 0)',
        weight: 5,
      },
    ])
    expect(layersOf(c[0]?.value ?? '')).toEqual([
      ['src/cli', 'src/main'],
      ['src/engine'],
      ['src/adapters'],
      ['src/core'],
    ])
  })

  test('층: 작은 거꾸로 화살표(상한 안)는 빼고 지금 어긴 곳으로 보인다. 상한을 넘으면 층 후보가 없다', () => {
    const many = (from: string, to: string, n: number): [string, string][] =>
      Array.from({ length: n }, (_, i) => [`${from}/f${i}.ts`, `${to}/t.ts`])
    const g = graph([
      ...many('src/a', 'src/b', 10),
      ...many('src/b', 'src/c', 10),
      ['src/c/x.ts', 'src/a/f0.ts', 7],
    ])
    const c = structureCandidates(g, ['src/a/f0.ts'], DEFAULT_TEST_GLOBS)
    expect(c[0]).toMatchObject({
      value: 'src/a>src/b>src/c',
      label: expect.stringContaining('(지금 어긴 곳 1: src/c/x.ts:7)') as string,
    })
    const tangled = graph([
      ...many('src/a', 'src/b', 10),
      ...many('src/b', 'src/c', 10),
      ...many('src/c', 'src/a', 3),
    ])
    expect(
      structureCandidates(tangled, ['src/a/f0.ts'], DEFAULT_TEST_GLOBS).map((x) => x.value),
    ).not.toContain('src/a>src/b>src/c')
  })

  test('쌍: 한쪽 방향(5 이상, 반대 0), 거의 한쪽(10 이상, 반대 1~2). 문턱 아래는 없다. 무게 순 다섯까지', () => {
    const many = (from: string, to: string, n: number): [string, string][] =>
      Array.from({ length: n }, (_, i) => [`${from}/f${i}.py`, `${to}/t.py`])
    const g = graph([
      ...many('app/api', 'app/db', 12),
      ['app/db/x.py', 'app/api/f0.py'],
      ...many('lib/ui', 'lib/store', 5),
      ...many('pkg/a', 'pkg/b', 4),
    ])
    const c = structureCandidates(
      g,
      files(['app/api/f0.py', 'lib/ui/f0.py', 'pkg/a/f0.py']),
      DEFAULT_TEST_GLOBS,
    )
    expect(c.map((x) => x.value)).toEqual(['app/db:app/api', 'lib/store:lib/ui'])
    expect(c[0]?.label).toBe(
      'app/db는 app/api를 가져오지 않음 (반대쪽 12, 지금 어긴 곳 1: app/db/x.py:1)',
    )
    expect(c[1]?.label).toBe('lib/store는 lib/ui를 가져오지 않음 (반대쪽 5, 지금 어긴 곳 0)')
  })

  test('폴더 대상(Go 패키지)과 레포 루트의 폴더도 마디가 된다. 시험 파일은 양쪽에서 뺀다', () => {
    const g = graph(
      Array.from(
        { length: 5 },
        (_, i) => [`cmd/app${i}/main.go`, 'internal/db'] as [string, string],
      ),
    )
    const c = structureCandidates(g, ['cmd/app0/main.go', 'internal/db/db.go'], DEFAULT_TEST_GLOBS)
    expect(c.map((x) => x.value)).toEqual(['internal:cmd'])
    const tests = graph(
      Array.from({ length: 5 }, (_, i) => [`cmd/a${i}_test.go`, 'internal/db'] as [string, string]),
    )
    expect(structureCandidates(tests, ['cmd/a0_test.go'], DEFAULT_TEST_GLOBS)).toEqual([])
  })
})

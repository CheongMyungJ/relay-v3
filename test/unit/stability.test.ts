// [단위] 관문 5회 반복 안정성의 셈(M4f, m4-design 8절, engine/stability.ts)과 (C)의 입력 모으기(test/support/gate-replay.ts
// generationRuns), 지난 자료를 읽는 요약(scripts/gate-repeat.ts). 명령줄과 실제 check 반복은 [흐름] gate-repeat.test.ts가 본다.
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import type { Contract, EvidenceBundle, GateResult } from '../../src/core/types.ts'
import {
  checkDigest,
  generationSpread,
  kindsKey,
  reviewStability,
  stabilityOf,
  type GenerationRun,
} from '../../src/engine/stability.ts'
import { generationSummary, readJsonl, reviewSummary } from '../../scripts/gate-repeat.ts'
import { generationRuns, readReplay, type ReplayBundle } from '../support/gate-replay.ts'

const evidence = (over: Partial<EvidenceBundle> = {}): EvidenceBundle => ({
  version: 1,
  repo: '',
  base: 'b',
  head: 'h',
  created_at: '2026-11-06T00:00:00.000Z',
  quality: { hash: '', from: 'base' },
  contract: null,
  commands: [{ id: 'test', outcome: 'pass', head: [] }],
  lines: [{ line: 'C1', kind: 'change', status: 'met', detail: '', examples: [] }],
  groundings: null,
  ratchets: [{ id: 'tests', status: 'better', base: 2, head: 3, detail: '시험 수 2 → 3' }],
  signals: [{ kind: 'test_weakening', path: 'test/a.test.js', detail: '' }],
  diff: {
    files: 1,
    added: 3,
    deleted: 1,
    new_dependencies: [],
    new_modules: [],
    paths: [],
    binary: [],
  },
  review: null,
  claims: null,
  contract_change_requested: false,
  missing: [],
  ...over,
})

const result = (over: Partial<GateResult> = {}): GateResult => ({
  conclusion: 'human_merge',
  decisive: '프로젝트에서 자동 머지가 꺼져 있음',
  reasons: [],
  condition: 'small',
  shadow: true,
  ...over,
})

describe('(A) checkDigest와 stabilityOf', () => {
  test('결정론 입력의 칸: 명령, 래칫과 head 값, 줄, 신호, 시험 약화, diff, 못 모은 증거, 채운 조건, 결론', () => {
    const d = checkDigest(evidence({ missing: ['b', 'a'] }), result(), ['small'])
    expect(d).toEqual({
      'commands.test': 'pass',
      'ratchets.tests': 'better 3',
      'lines.C1': 'met',
      signals: 'test_weakening:test/a.test.js',
      test_weakening: '1',
      diff: '1 +3 -1',
      missing: 'a,b',
      met: 'small',
      conclusion: 'human_merge',
      decisive: '프로젝트에서 자동 머지가 꺼져 있음',
    })
    // 시각과 출력 꼬리는 넣지 않는다
    const later = evidence({ created_at: '2026-11-07T00:00:00.000Z', missing: ['a', 'b'] })
    expect(checkDigest(later, result(), ['small'])).toEqual(d)
    const ex = evidence({ examples_file: { path: 'x', status: 'differs', diffs: [] } })
    expect(checkDigest(ex, result(), [])['examples_file']).toBe('differs')
  })

  test('같은 결과는 갈린 칸이 없다. 하나 이하의 반복도 그렇다', () => {
    const d = checkDigest(evidence(), result(), ['small'])
    expect(stabilityOf([d, { ...d }, { ...d }])).toEqual({
      runs: 3,
      diverged: [],
      conclusion_changed: false,
    })
    expect(stabilityOf([d]).diverged).toEqual([])
    expect(stabilityOf([]).runs).toBe(0)
  })

  test('흔들린 명령은 갈린 칸이고, 결론이나 채운 조건이 갈리면 conclusion_changed', () => {
    const a = checkDigest(evidence(), result(), ['small'])
    const b = checkDigest(
      evidence({ commands: [{ id: 'test', outcome: 'unstable', head: [] }] }),
      result({ condition: null, shadow: false, decisive: '명령 test 흔들림' }),
      [],
    )
    const s = stabilityOf([a, a, b])
    expect(s.diverged.map((d) => d.field)).toEqual(['commands.test', 'decisive', 'met'])
    expect(s.diverged[0]?.values).toEqual(['pass', 'pass', 'unstable'])
    expect(s.conclusion_changed).toBe(true)
    // 래칫 값만 갈리면 결론은 그대로
    const c = { ...a, 'ratchets.tests': 'better 4' }
    expect(stabilityOf([a, c])).toMatchObject({ conclusion_changed: false })
    // 한 반복에만 있는 칸은 '-'
    const noLine = Object.fromEntries(Object.entries(a).filter(([k]) => k !== 'lines.C1'))
    expect(stabilityOf([a, noLine]).diverged).toEqual([{ field: 'lines.C1', values: ['met', '-'] }])
  })
})

describe('(B) reviewStability', () => {
  test('올림 유무와 갈래(심각도는 보지 않음)를 따로 본다. 실패한 반복은 견주지 않는다', () => {
    const same = reviewStability([
      { status: 'done', raises: { 'structure/medium': 1 } },
      { status: 'done', raises: { 'structure/high': 2 } },
      { status: 'failed', raises: {} },
    ])
    expect(same).toEqual({
      done: 2,
      failed: 1,
      presence_flip: false,
      kind_flip: false,
      kinds: [['structure'], ['structure']],
    })
    const kind = reviewStability([
      { status: 'done', raises: { 'example_test_mismatch/medium': 1 } },
      { status: 'done', raises: { 'example_test_mismatch/low': 1, 'request_gap/low': 1 } },
    ])
    expect(kind).toMatchObject({ presence_flip: false, kind_flip: true })
    const presence = reviewStability([
      { status: 'done', raises: {} },
      { status: 'done', raises: { 'security/high': 1 } },
    ])
    expect(presence).toMatchObject({ presence_flip: true, kind_flip: true })
    // 0인 칸은 올림이 아니다
    expect(reviewStability([{ status: 'done', raises: { 'x/low': 0 } }]).kinds).toEqual([[]])
  })

  test('이미 있는 M2.1 리뷰 재생 자료(3회 반복 8묶음)를 센다: 올림 유무는 갈리지 않는다', () => {
    const file = fileURLToPath(
      new URL('../../docs/experiments/m2.1/review-replay.jsonl', import.meta.url),
    )
    const text = reviewSummary(readJsonl(file))
    expect(text).toMatch(/반복이 둘 이상인 head 8개 가운데 올림 유무가 갈림 0, 올림 갈래/)
  })
})

describe('(C) generationSpread와 generationRuns', () => {
  const run = (over: Partial<GenerationRun>): GenerationRun => ({
    group: 'm2/s/relay3',
    run: 1,
    kinds: ['change', 'keep'],
    conclusions: ['human_merge'],
    met: false,
    facts: ['채운 자동 조건 없음'],
    ...over,
  })

  test('kindsKey는 종류 이름 차례의 다중집합 글', () => {
    expect(kindsKey(['keep', 'change', 'change', 'human'])).toBe('change×2,human×1,keep×1')
    expect(kindsKey([])).toBe('-')
  })

  test('무리마다 줄 종류, 사람 줄, 결론, 조건 채움, 실행마다 다른 까닭을 센다', () => {
    const s = generationSpread([
      run({ run: 1 }),
      run({ run: 2, kinds: ['change', 'keep', 'human'], met: true, facts: [] }),
      run({ run: 3 }),
      run({ group: 'm2/t/relay3', run: 1 }),
    ])
    expect(s.map((x) => x.group)).toEqual(['m2/s/relay3', 'm2/t/relay3'])
    expect(s[0]).toEqual({
      group: 'm2/s/relay3',
      runs: 3,
      kinds: { 'change×1,keep×1': 2, 'change×1,human×1,keep×1': 1 },
      human: 1,
      conclusions: { human_merge: 3 },
      met: 1,
      facts_varying: ['채운 자동 조건 없음'],
      diverged: { kinds: true, human: true, conclusion: false, met: true },
    })
    expect(s[1]?.diverged).toEqual({ kinds: false, human: false, conclusion: false, met: false })
  })

  const bundle = (over: Partial<ReplayBundle>, contract: Contract): ReplayBundle => ({
    protocol: 'm2',
    scenario: 's',
    arm: 'relay3',
    run: 1,
    work: 'w1',
    hidden_pass: true,
    recorded: { conclusion: 'human_merge', condition: null, shadow: false },
    evidence: evidence({ contract: null, signals: [], lines: null }),
    contract,
    ...over,
  })
  const contract = (kinds: Contract['lines'][number]['kind'][]): Contract => ({
    version: 1,
    id: 'c',
    goal: '',
    lines: kinds.map((kind, i) => ({
      id: `C${i + 1}`,
      kind,
      text: '',
      grounds: [],
      examples: [],
      check: 'test',
    })),
    non_goals: [],
    human_rules: [],
    examples: [],
    tidy: [],
  })

  test('generationRuns: 실행마다 묶음을 모으고 같은 Work의 같은 줄 id는 한 번(단위 조각), 규약의 실행 단위 규칙', () => {
    const c = contract(['change', 'keep'])
    const runs = generationRuns([
      bundle({ unit: 'a' }, c),
      bundle({ unit: 'b' }, c),
      bundle({ work: 'w2' }, contract(['human'])),
      bundle({ run: 2 }, c),
    ])
    expect(runs.map((r) => [r.group, r.run, kindsKey(r.kinds)])).toEqual([
      ['m2/s/relay3', 1, 'change×1,human×1,keep×1'],
      ['m2/s/relay3', 2, 'change×1,keep×1'],
    ])
    expect(runs[0]?.conclusions).toHaveLength(3)
    expect(runs.every((r) => !r.met)).toBe(true)
    expect(runs[0]?.facts.length).toBeGreaterThan(0)
  })

  test('지금 재생 자료로 요약이 나온다(무리마다 실행 5개 안팎)', () => {
    const bundles = readReplay(fileURLToPath(new URL('../fixtures/gate-replay/', import.meta.url)))
    const text = generationSummary(bundles)
    expect(text).toContain('| m2/14-double-notify/relay3 | 5 |')
    expect(text).toMatch(
      /무리 \d+개 가운데 실행마다 갈림: 줄 종류 \d+, 사람 줄 \d+, 결론 \d+, 조건 채움 \d+/,
    )
  })
})

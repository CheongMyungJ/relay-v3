import { describe, expect, test } from 'vitest'
import { isStale, summarize } from '../../src/core/evidence.ts'
import type { EvidenceBundle, LineVerdict, Signal } from '../../src/core/types.ts'

function evidence(over: Partial<EvidenceBundle> = {}): EvidenceBundle {
  return {
    version: 1,
    repo: '/r',
    base: 'abcdef1234567890',
    head: '1234567abcdef000',
    created_at: '2026-11-04T00:00:00Z',
    quality: { hash: 'q', from: 'base' },
    contract: null,
    commands: [],
    lines: null,
    groundings: null,
    ratchets: [],
    signals: [],
    diff: {
      files: 2,
      added: 10,
      deleted: 3,
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
  }
}

function verdict(line: string, status: LineVerdict['status']): LineVerdict {
  return { line, kind: 'change', status, detail: '', examples: [] }
}

describe('요약', () => {
  test('바이너리 파일이 있으면 머리 줄에 수를 적는다', () => {
    const diff = { ...evidence().diff, binary: ['a.png', 'b.wasm'] }
    expect(summarize(evidence({ diff }))[0]).toBe('abcdef1..1234567 · 파일 2 · +10 −3 · 바이너리 2')
  })

  test('빈 묶음은 diff 머리와 없음 줄을 낸다', () => {
    expect(summarize(evidence())).toEqual([
      'abcdef1..1234567 · 파일 2 · +10 −3',
      '명령: 없음',
      '줄 판정: 없음',
      '신호: 없음',
    ])
  })

  test('명령마다 결과를 한 줄씩 쓴다', () => {
    const commands = (['pass', 'fail', 'pre_existing', 'unstable', 'not_run'] as const).map(
      (outcome, i) => ({ id: `c${i}`, outcome, head: [] }),
    )
    expect(summarize(evidence({ commands })).slice(1, 6)).toEqual([
      '명령 c0: 통과',
      '명령 c1: 실패',
      '명령 c2: 원래 실패',
      '명령 c3: 불안정',
      '명령 c4: 돌리지 못함',
    ])
  })

  test('줄 판정은 상태마다 수를 세고 0인 상태는 뺀다', () => {
    const lines = [
      verdict('C1', 'met'),
      verdict('C2', 'met'),
      verdict('C3', 'missing_evidence'),
      verdict('C4', 'human'),
    ]
    expect(summarize(evidence({ lines }))).toContain('줄 판정 4개: 충족 2, 증거 없음 1, 사람 1')
  })

  test('줄이 없는 판정은 따로 적는다', () => {
    expect(summarize(evidence({ lines: [] }))).toContain('줄 판정: 줄 없음')
  })

  test('예시 자료(V27)는 줄 판정 다음 한 줄, 다르면 다른 예시 id', () => {
    const path = '.relay/examples/w1.json'
    const line = (examples_file: EvidenceBundle['examples_file']) =>
      summarize(evidence({ examples_file })).filter((l) => l.startsWith('예시 자료'))
    expect(line({ path, status: 'same', diffs: [] })).toEqual([
      '예시 자료 .relay/examples/w1.json: 승인본과 같음',
    ])
    expect(line({ path, status: 'absent', diffs: [] })).toEqual([
      '예시 자료 .relay/examples/w1.json: 커밋되지 않음',
    ])
    expect(line({ path, status: 'unreadable', diffs: [] })).toEqual([
      '예시 자료 .relay/examples/w1.json: 읽지 못함',
    ])
    const diffs = [
      { id: 'C1.1', field: 'input', expected: 1, found: 2 },
      { id: 'C1.1', field: 'output', expected: 1 },
      { id: 'C2.1', found: 3 },
    ]
    expect(line({ path, status: 'differs', diffs })).toEqual([
      '예시 자료 .relay/examples/w1.json: 승인본과 다름 (C1.1, C2.1)',
    ])
    expect(line(null)).toEqual([])
    const all = summarize(
      evidence({ lines: [], examples_file: { path, status: 'same', diffs: [] } }),
    )
    expect(all.indexOf('줄 판정: 줄 없음') + 1).toBe(
      all.indexOf(`예시 자료 ${path}: 승인본과 같음`),
    )
  })

  test('지식 확인(V38)은 바뀐 파일과 문제 수를 한 줄로, 끈 장치(null)는 줄이 없다', () => {
    const issues = [{ path: 'docs/knowledge/a.md', kind: 'format' as const, detail: 'x' }]
    expect(summarize(evidence({ knowledge: { changed: ['a', 'b'], issues } }))).toContain(
      '지식: 바뀐 파일 2 · 문제 1',
    )
    expect(summarize(evidence({ knowledge: null })).some((l) => l.startsWith('지식'))).toBe(false)
  })

  test('래칫마다 상태와 detail을 쓴다', () => {
    const ratchets = [
      { id: 'tests', status: 'worse' as const, base: 3, head: 2, detail: '시험 수 3 → 2' },
      { id: 'lint', status: 'unknown' as const, detail: '기준 출력이 없음' },
    ]
    const out = summarize(evidence({ ratchets }))
    expect(out).toContain('래칫 tests: 나빠짐 (시험 수 3 → 2)')
    expect(out).toContain('래칫 lint: 모름 (기준 출력이 없음)')
  })

  test('신호는 종류마다 한 줄로 묶고 정한 순서로 쓴다', () => {
    const signals: Signal[] = [
      { kind: 'structure_change', path: 'package.json', detail: '새 의존성: lodash' },
      { kind: 'human_path', path: 'db/1.sql', detail: '사람 경로를 건드림 (db/**)' },
      { kind: 'human_path', path: 'db/2.sql', detail: '사람 경로를 건드림 (db/**)' },
      { kind: 'test_weakening', path: 'a.test.ts', detail: '시험 파일을 지움' },
      { kind: 'test_weakening', path: 'a.test.ts', detail: '단언 줄이 줄어듦' },
    ]
    const out = summarize(evidence({ signals }))
    expect(out.filter((l) => l.startsWith('신호'))).toEqual([
      '신호 사람 경로 2: db/1.sql, db/2.sql',
      '신호 시험 약화 2: a.test.ts',
      '신호 구조 변경 1: 새 의존성: lodash',
    ])
  })

  test('신호가 많으면 다섯 개까지 쓴다', () => {
    const signals: Signal[] = [1, 2, 3, 4, 5, 6, 7].map((n) => ({
      kind: 'guard_path',
      path: `g${n}`,
      detail: 'd',
    }))
    expect(summarize(evidence({ signals }))).toContain(
      '신호 지킴 파일 7: g1, g2, g3, g4, g5 외 2개',
    )
  })

  test('리뷰가 있으면 상태와 지적·올림 수를 쓴다(구조/low는 올림이 아니다, V26)', () => {
    const review = {
      status: 'done' as const,
      findings: [
        { id: 'f1', severity: 'high' as const, text: 'a', raise: 'security' as const },
        { id: 'f2', severity: 'low' as const, text: 'b' },
        { id: 'f3', severity: 'low' as const, text: 'c', raise: 'structure' as const },
      ],
    }
    expect(summarize(evidence({ review }))).toContain('리뷰: 마침, 지적 3(올림 1)')
    expect(summarize(evidence({ review: { status: 'failed', findings: [] } }))).toContain(
      '리뷰: 실패, 지적 0(올림 0)',
    )
  })

  test('없는 증거를 한 줄로 쓴다', () => {
    expect(summarize(evidence({ missing: ['acceptance', 'ci'] }))).toContain(
      '없는 증거: acceptance, ci',
    )
  })

  test('품질 기준이 없으면 없는 증거에 quality.json을 한 번만 넣는다', () => {
    const quality = { hash: '', from: 'none' as const }
    expect(summarize(evidence({ quality }))).toContain('없는 증거: quality.json')
    expect(summarize(evidence({ quality, missing: ['ci', 'quality.json'] }))).toContain(
      '없는 증거: ci, quality.json',
    )
  })

  test('계약 변경 요청을 알린다', () => {
    expect(summarize(evidence({ contract_change_requested: true }))[1]).toBe('계약 변경 요청 있음')
  })

  test('SHA를 모르면 물음표로 쓴다', () => {
    expect(summarize(evidence({ base: '', head: '' }))[0]).toBe('?..? · 파일 2 · +10 −3')
  })

  test('묶음을 바꾸지 않는다', () => {
    const e = evidence({ missing: ['ci'], quality: { hash: '', from: 'none' } })
    summarize(e)
    expect(e.missing).toEqual(['ci'])
  })
})

describe('낡은 증거', () => {
  const e = evidence({ head: 'a'.repeat(40) })

  test('같은 head면 낡지 않았다', () => {
    expect(isStale(e, 'a'.repeat(40))).toBe(false)
  })

  test('앞뒤 공백은 무시한다', () => {
    expect(isStale(e, ` ${'a'.repeat(40)}\n`)).toBe(false)
  })

  test('다른 head면 낡았다', () => {
    expect(isStale(e, 'b'.repeat(40))).toBe(true)
  })

  test('짧은 SHA는 같은 커밋이라도 낡음으로 본다', () => {
    expect(isStale(e, 'a'.repeat(7))).toBe(true)
  })

  test('head를 모르면 낡았다', () => {
    expect(isStale(e, '')).toBe(true)
    expect(isStale(evidence({ head: '' }), '')).toBe(true)
  })
})

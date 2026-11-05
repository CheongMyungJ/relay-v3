// [단위] 관문: 사람 머지로 보내는 사실과 계약 다시 (V5), 그 사실로 만든 열린 것(V25). 바탕은 test/support/gate.ts
import { describe, expect, test } from 'vitest'
import { contractHash } from '../../src/core/contract.ts'
import { openItems } from '../../src/core/gate.ts'
import type { Contract, EvidenceBundle, Policy } from '../../src/core/types.ts'
import {
  C2,
  command,
  contract,
  evidence,
  finding,
  HEAD,
  met,
  reviewed,
  run,
  SERVER,
  sig,
  verdict,
  withLine,
} from '../support/gate.ts'

describe('모든 조건을 채웠을 때만 자동 후보', () => {
  test('깨끗한 바탕은 auto_merge_candidate다', () => {
    expect(run()).toEqual({
      conclusion: 'auto_merge_candidate',
      decisive: '자동 조건을 채움: small',
      reasons: [],
      condition: 'small',
      shadow: false,
    })
  })

  test.each<[string, Partial<EvidenceBundle>, Partial<Policy>]>([
    [
      'merge queue만 있어도 서버 보호로 봄',
      {},
      { server: { ...SERVER, merge_queue: true, up_to_date_required: false } },
    ],
    [
      '래칫이 좋아짐·그대로',
      {
        ratchets: [
          { id: 'a', status: 'better', detail: '' },
          { id: 'b', status: 'same', detail: '' },
        ],
      },
      {},
    ],
    ['올림 사유가 없는 리뷰 지적', { review: reviewed([finding({ severity: 'high' })]) }, {}],
    [
      '구조/low 지적(메모, V26)',
      {
        review: reviewed([
          finding({ raise: 'structure', severity: 'low', text: '경계값 시험 없음' }),
        ]),
      },
      {},
    ],
    ['명령이 없는 레포', { commands: [] }, {}],
  ])('%s → 후보', (_name, e, p) => {
    expect(run(e, contract(), p).conclusion).toBe('auto_merge_candidate')
  })
})

// 사실 하나가 human_merge를 만든다. decisive는 그 사실이다.
type Fact = [name: string, e: Partial<EvidenceBundle>, decisive: string, c?: Contract | null]

const FACTS: Fact[] = [
  [
    '사람 경로',
    { signals: [sig('human_path', 'db/1.sql', '사람 경로 (db/**)')] },
    '사람 경로 (db/**) — db/1.sql',
  ],
  [
    '지킴 파일',
    { signals: [sig('guard_path', 'ci.yml', '지킴 파일 (ci.yml)')] },
    '지킴 파일 (ci.yml)',
  ],
  [
    '시험 약화',
    { signals: [sig('test_weakening', 'a.test.ts', '시험 파일을 지움')] },
    '시험 파일을 지움 — a.test.ts',
  ],
  [
    '구조 변경',
    { signals: [sig('structure_change', 'package.json', '새 의존성: x')] },
    '새 의존성: x — package.json',
  ],
  ['명령 실패', { commands: [command('lint', 'fail')] }, '명령 실패: lint'],
  ['원래 실패', { commands: [command('lint', 'pre_existing')] }, '원래 실패하던 명령: lint'],
  ['불안정', { commands: [command('test', 'unstable')] }, '불안정한 명령: test'],
  ['돌리지 못함', { commands: [command('test', 'not_run')] }, '돌리지 못한 명령: test'],
  [
    '래칫 나빠짐',
    { ratchets: [{ id: 't', status: 'worse', detail: '3 → 2' }] },
    '래칫 나빠짐: t (3 → 2)',
  ],
  [
    '래칫 모름',
    { ratchets: [{ id: 't', status: 'unknown', detail: '없음' }] },
    '래칫을 재지 못함: t (없음)',
  ],
  ['계약 없음', {}, '계약 없음', null],
  ['caller 승인', {}, '사람이 승인하지 않은 계약(caller)', contract({ approved_by: 'caller' })],
  ['승인 없음', {}, '승인되지 않은 계약', contract({ approved_by: undefined })],
  [
    '줄 못 미침',
    { lines: [verdict('C1', 'not_met', '실패'), met('C2', 'new')] },
    '줄 C1 못 미침: 실패',
  ],
  [
    '줄 증거 없음',
    { lines: [met('C1'), verdict('C2', 'missing_evidence', '태그 없음', 'new')] },
    '줄 C2 증거 없음: 태그 없음',
  ],
  [
    '사람 줄',
    { lines: [met('C1'), verdict('C2', 'human', '', 'human', [])] },
    '줄 C2은 사람이 확인',
    withLine({ ...C2, kind: 'human', check: 'human', examples: [] }),
  ],
  [
    '관찰 줄',
    { lines: [met('C1'), verdict('C2', 'observe', '', 'observe', [])] },
    '줄 C2은 관찰로 확인',
    withLine({ ...C2, kind: 'observe', check: 'observe', examples: [] }),
  ],
  ['줄 판정 null', { lines: null }, '줄 판정 없음'],
  ['줄 판정이 빈 목록', { lines: [] }, '줄 판정 없음'],
  ['계약 줄에 판정이 없음', { lines: [met('C1')] }, '줄 C2 판정 없음'],
  [
    '계약에 없는 줄 판정',
    { lines: [met('C1'), met('C2', 'new'), met('C9')] },
    '계약에 없는 줄 판정: C9',
  ],
  [
    '판정 종류가 계약과 다름',
    { lines: [met('C1', 'keep'), met('C2', 'new')] },
    '줄 C1 판정이 계약과 맞지 않음',
  ],
  [
    '사람이 볼 줄을 met으로 판정',
    {},
    '줄 C2 판정이 계약과 맞지 않음',
    withLine({ ...C2, check: 'human' }),
  ],
  [
    '예시 자료가 커밋되지 않음',
    { examples_file: { path: '.relay/examples/w1.json', status: 'absent', diffs: [] } },
    '예시 자료 파일이 커밋되지 않음: .relay/examples/w1.json',
  ],
  [
    '예시 자료가 승인본과 다름',
    {
      examples_file: {
        path: '.relay/examples/w1.json',
        status: 'differs',
        diffs: [
          { id: 'C1.1', field: 'output', expected: 10, found: 8 },
          { id: 'C1.2', field: 'note', expected: 'n' },
          { id: 'C2.1', expected: { input: 2 } },
          { id: 'C9.9', found: { input: 9 } },
        ],
      },
    },
    '예시 자료가 승인본과 다름: C1.1 output (기대 10, 실제 8), C1.2 note (기대 "n", 실제 없음), C2.1 없음 외 1개',
  ],
  [
    '예시 자료를 읽지 못함',
    {
      examples_file: {
        path: '.relay/examples/w1.json',
        status: 'unreadable',
        diffs: [],
        error: 'JSON을 읽지 못함: x',
      },
    },
    '예시 자료를 읽지 못함: .relay/examples/w1.json (JSON을 읽지 못함: x)',
  ],
  [
    '예시 자료의 모르는 견줌 결과',
    { examples_file: { path: 'e.json', status: 'weird' as never, diffs: [] } },
    '예시 자료를 견준 결과를 모름: e.json',
  ],
  ['리뷰 없음', { review: null }, '리뷰 없음'],
  ['리뷰 실패', { review: { status: 'failed', findings: [] } }, '리뷰 실패'],
  ['리뷰 건너뜀', { review: { status: 'skipped', findings: [] } }, '리뷰를 건너뜀'],
  // V30이 V15를 넓힌다: 요청을 받지 않은 리뷰(앞 판의 묶음, request.md를 읽지 못함)로는 자동 후보도 그림자도 되지 않는다
  [
    '요청을 보지 않은 리뷰',
    { review: { status: 'done', findings: [] } },
    '리뷰가 요청을 보지 않음',
  ],
  [
    '요청을 보지 않았다고 적은 리뷰',
    { review: { ...reviewed(), request: false } },
    '리뷰가 요청을 보지 않음',
  ],
  [
    '리뷰 올림',
    {
      review: reviewed([finding({ raise: 'security', text: '토큰 노출', file: 'a.ts', line: 3 })]),
    },
    '리뷰 올림(보안): 토큰 노출 — a.ts:3',
  ],
  ['없는 증거', { missing: ['acceptance'] }, '없는 증거: acceptance'],
  ['품질 기준 없음', { quality: { hash: '', from: 'none' } }, '품질 기준 없음'],
  ['모르는 명령 결과', { commands: [command('x', 'weird' as never)] }, '결과를 모르는 명령: x'],
  [
    '모르는 줄 판정',
    { lines: [met('C1'), verdict('C2', 'weird' as never, '', 'new')] },
    '줄 C2 판정을 모름',
  ],
  ['모르는 quality 출처', { quality: { hash: 'q', from: 'weird' as never } }, '품질 기준 없음'],
  [
    '판정의 예시가 계약 줄의 예시와 다름',
    { lines: [verdict('C1', 'met', '', 'change', ['C1.1', 'C1.2']), met('C2', 'new')] },
    '줄 C1 판정이 계약과 맞지 않음',
  ],
  [
    '모르는 종류의 신호',
    { signals: [{ kind: 'human-path' as never, path: 'src/auth/x.ts', detail: 'x' }] },
    '알 수 없는 신호: human-path — src/auth/x.ts',
  ],
  [
    '다른 계약으로 만든 묶음',
    { contract: { id: 'other', hash: 'x' } },
    '다른 계약으로 만든 증거: other',
  ],
  [
    '묶음을 만든 뒤 계약이 바뀜',
    { contract: { id: 'w1', hash: 'old' } },
    '증거를 만든 뒤 계약이 바뀜',
  ],
  ['묶음에 계약 정보가 없음', { contract: null }, '증거 묶음에 계약 정보가 없음'],
]

describe('사실 하나하나가 사람 머지를 만든다', () => {
  test.each(FACTS)('%s', (_name, e, decisive, c = contract()) => {
    expect(run(e, c)).toEqual({
      conclusion: 'human_merge',
      decisive,
      reasons: [decisive],
      condition: null,
      shadow: false,
    })
  })

  test.each(FACTS)('%s는 스위치가 꺼져도 그림자가 아니다', (_name, e, _d, c = contract()) => {
    const r = run(e, c, { auto_merge_enabled: false, server: null, track_record_ok: {} })
    expect(r).toMatchObject({ conclusion: 'human_merge', condition: null, shadow: false })
  })
})

describe('까닭은 엄격한 것부터 모두 모은다', () => {
  test('여러 사실을 정한 순서로 적고 decisive는 첫 사실이다', () => {
    const r = run(
      {
        missing: ['ci'],
        review: null,
        lines: [verdict('C1', 'observe'), verdict('C2', 'not_met', 'x', 'new')],
        ratchets: [{ id: 'size', status: 'worse', detail: 'a.ts(700)' }],
        commands: [command('lint', 'unstable'), command('tc', 'fail')],
        signals: [
          sig('structure_change', 'src/new', '새 모듈: src/new'),
          sig('test_weakening', 't.test.ts', '시험 파일을 지움'),
          sig('human_path', 'db/1.sql', '사람 경로 (db/**)'),
        ],
        quality: { hash: '', from: 'none' },
      },
      null,
    )
    expect(r.reasons).toEqual([
      '사람 경로 (db/**) — db/1.sql',
      '시험 파일을 지움 — t.test.ts',
      '새 모듈: src/new',
      '명령 실패: tc',
      '불안정한 명령: lint',
      '래칫 나빠짐: size (a.ts(700))',
      '계약 없음',
      '줄 C2 못 미침: x',
      '줄 C1은 관찰로 확인',
      '리뷰 없음',
      '없는 증거: ci',
      '품질 기준 없음',
    ])
    expect(r.decisive).toBe('사람 경로 (db/**) — db/1.sql')
  })

  test('예시 자료가 승인본과 같거나 견주지 않았으면(null, 앞 판의 묶음) 사실이 아니다', () => {
    const same = { path: 'e.json', status: 'same' as const, diffs: [] }
    for (const examples_file of [same, null, undefined])
      expect(run({ examples_file }).conclusion).toBe('auto_merge_candidate')
  })

  test('예시 자료 사실은 줄 판정 다음, 리뷰 앞이다(V27)', () => {
    const r = run({
      review: null,
      lines: [met('C1'), verdict('C2', 'not_met', 'x', 'new')],
      examples_file: { path: 'e.json', status: 'absent', diffs: [] },
    })
    expect(r.reasons).toEqual([
      '줄 C2 못 미침: x',
      '예시 자료 파일이 커밋되지 않음: e.json',
      '리뷰 없음',
    ])
  })

  test('예시 자료의 차이에 다른 예시는 셋까지, 승인본에 없는 예시와 통째로 다른 예시를 적는다', () => {
    const diffs = [
      { id: 'C9.9', found: 1 },
      { id: 'C1.1', expected: { input: 1 }, found: 'x' },
    ]
    const r = run({ examples_file: { path: 'e.json', status: 'differs', diffs } })
    expect(r.decisive).toBe(
      '예시 자료가 승인본과 다름: C9.9 승인본에 없는 예시, C1.1 (기대 {"input":1}, 실제 "x")',
    )
  })

  test('리뷰 상태가 올림 지적보다 먼저고 올림 없는 지적은 빠진다', () => {
    const findings = [finding({ raise: 'structure', text: '중복 구현' }), finding({ text: '이름' })]
    const r = run({ review: { status: 'failed', findings } })
    expect(r.reasons).toEqual(['리뷰 실패', '리뷰 올림(구조): 중복 구현'])
  })

  test('올림 기준(V26): 구조는 medium 이상만, 보안·예시와 시험 불일치·계약 밖 변경은 low도 올린다. 요청과 어긋남(V30)은 메모다(M2.1 O2)', () => {
    const findings = [
      finding({ id: 'R1', raise: 'structure', severity: 'low', text: '구조 낮음' }),
      finding({ id: 'R2', raise: 'structure', severity: 'medium', text: '구조 중간' }),
      finding({ id: 'R3', raise: 'out_of_contract', severity: 'low', text: '계약 밖 낮음' }),
      finding({ id: 'R4', raise: 'example_test_mismatch', severity: 'low', text: '불일치 낮음' }),
      finding({ id: 'R5', raise: 'security', severity: 'low', text: '보안 낮음' }),
    ]
    findings.push(finding({ id: 'R6', raise: 'request_gap', severity: 'low', text: '요청 낮음' }))
    expect(run({ review: reviewed(findings) }).reasons).toEqual([
      '리뷰 올림(구조): 구조 중간',
      '리뷰 올림(계약 밖 변경): 계약 밖 낮음',
      '리뷰 올림(예시와 시험 불일치): 불일치 낮음',
      '리뷰 올림(보안): 보안 낮음',
    ])
    const high = finding({ id: 'R7', raise: 'request_gap', severity: 'high', text: '요청 높음' })
    expect(run({ review: reviewed([high]) }).reasons).not.toContain(
      '리뷰 올림(요청과 어긋남): 요청 높음',
    )
  })

  test('없는 증거는 이름마다 한 줄이다', () => {
    const r = run({ missing: ['acceptance', 'ci'] })
    expect(r.reasons).toEqual(['없는 증거: acceptance', '없는 증거: ci'])
  })

  test('같은 글의 사실은 한 번만 적는다', () => {
    const s = sig('human_path', 'a', '사람 경로 (a)')
    expect(run({ signals: [s, s] }).reasons).toEqual(['사람 경로 (a)'])
  })

  test('경로가 없는 신호는 detail만 쓴다', () => {
    expect(run({ signals: [{ kind: 'structure_change', detail: '새 공개 이름' }] }).decisive).toBe(
      '새 공개 이름',
    )
  })

  test('긴 글은 공백을 펴고 줄여 쓴다', () => {
    const r = run({
      lines: [verdict('C1', 'not_met', `a\n  b${'x'.repeat(300)}`), met('C2', 'new')],
    })
    expect(r.decisive).toBe(`줄 C1 못 미침: ${`a b${'x'.repeat(300)}`.slice(0, 99)}…`)
  })

  test('계약이 없으면 계약과 맞춰 보지 않고 줄 판정만 본다', () => {
    const r = run({ lines: [verdict('C1', 'not_met', 'x')] }, null)
    expect(r.reasons).toEqual(['계약 없음', '줄 C1 못 미침: x'])
  })
})

describe('계약 다시', () => {
  test('증거에 계약 변경 요청이 있으면 다른 사실보다 먼저 recontract다', () => {
    expect(run({ contract_change_requested: true, missing: ['ci'], review: null })).toEqual({
      conclusion: 'recontract',
      decisive: '계약 변경 요청이 풀리지 않음',
      reasons: ['계약 변경 요청이 풀리지 않음'],
      condition: null,
      shadow: false,
    })
  })

  test('계약에 적힌 변경 요청도 recontract이고 그 글을 보인다', () => {
    const r = run({}, contract({ change_requested: '  C2를\n빼자  ' }))
    expect(r).toMatchObject({ conclusion: 'recontract', decisive: '계약 변경 요청: C2를 빼자' })
  })

  test('빈 변경 요청 글은 요청으로 보지 않는다', () => {
    expect(run({}, contract({ change_requested: '  ' })).conclusion).toBe('auto_merge_candidate')
  })

  test('계약이 없어도 증거의 변경 요청으로 recontract다', () => {
    expect(run({ contract_change_requested: true }, null).conclusion).toBe('recontract')
  })
})

describe('열린 것(V25)은 관문이 사람에게 보내는 사실 그대로다', () => {
  const open = (e: Partial<EvidenceBundle> = {}, c: Contract | null = contract(), head = HEAD) => {
    const made = c === null ? null : { id: c.id, hash: contractHash(c) }
    return openItems(evidence({ contract: made, ...e }), c, head)
  }

  test.each(FACTS)('%s', (_name, e, decisive, c = contract()) => {
    expect(open(e, c)).toEqual([decisive])
  })

  test('깨끗한 묶음은 자동 조건·스위치·서버 보호·실적을 못 채워도 열린 것이 없다', () => {
    expect(open()).toEqual([])
    expect(run({}, contract(), { auto_merge_enabled: false, server: null }).shadow).toBe(true)
    // 자동 조건을 못 채운 까닭(바뀐 줄이 많음, 새 의존성)도 열린 것이 아니다
    const big = { ...evidence().diff, added: 500, new_dependencies: ['left-pad'] }
    expect(run({ diff: big }).decisive).toBe('채운 자동 조건 없음')
    expect(open({ diff: big })).toEqual([])
    // 리뷰 메모(올림 사유가 없는 지적, 구조/low. V26)도 아니다
    expect(open({ review: reviewed([finding({ severity: 'high' })]) })).toEqual([])
    const low = finding({ raise: 'structure', severity: 'low' })
    expect(open({ review: reviewed([low]) })).toEqual([])
  })

  test('사실을 관문과 같은 차례로 모두 모으고, 풀리지 않은 계약 변경을 맨 앞에 둔다', () => {
    const e = { review: null, missing: ['ci'], contract_change_requested: true }
    expect(open(e)).toEqual(['계약 변경 요청이 풀리지 않음', '리뷰 없음', '없는 증거: ci'])
    const r = run({ review: null, missing: ['ci'] })
    expect(open({ review: null, missing: ['ci'] })).toEqual(r.reasons)
    expect(open({}, contract({ change_requested: 'C2를 빼자' }))).toEqual([
      '계약 변경 요청: C2를 빼자',
    ])
  })

  test('지금 head가 묶음의 head가 아니거나 모르면 열린 것이다', () => {
    expect(open({}, contract(), 'c'.repeat(40))).toEqual([
      `낡은 증거: 묶음은 ${HEAD.slice(0, 7)}, 지금 head는 ccccccc`,
    ])
    expect(openItems(evidence(), contract(), null)).toEqual([
      '지금 head를 모름: 낡은 증거인지 확인하지 못함',
    ])
  })
})

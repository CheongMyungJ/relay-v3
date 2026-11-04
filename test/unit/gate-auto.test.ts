// [단위] 관문: 낡은 증거, 자동 조건, 스위치·서버 보호·실적(그림자). 바탕은 test/support/gate.ts
import { describe, expect, test } from 'vitest'
import type {
  AutoCondition,
  EvidenceBundle,
  GateResult,
  Policy,
  ServerProtection,
} from '../../src/core/types.ts'
import { contract, DIFF, run, SERVER } from '../support/gate.ts'

describe('낡은 증거 (V6)', () => {
  test('묶음의 head가 지금 head와 다르면 사람 머지이고 그 사실이 맨 앞이다', () => {
    const r = run({ missing: ['ci'] }, contract(), {}, 'n'.repeat(40))
    expect(r).toMatchObject({ conclusion: 'human_merge', condition: null, shadow: false })
    expect(r.reasons).toEqual(['낡은 증거: 묶음은 hhhhhhh, 지금 head는 nnnnnnn', '없는 증거: ci'])
  })

  test('지금 head를 모르면 낡았는지 확인하지 못했으니 사람 머지다', () => {
    expect(run({}, contract(), {}, null).decisive).toBe(
      '지금 head를 모름: 낡은 증거인지 확인하지 못함',
    )
  })

  test('빈 head도 모르는 것으로 본다', () => {
    expect(run({}, contract(), {}, '').decisive).toBe('낡은 증거: 묶음은 hhhhhhh, 지금 head는 ?')
  })
})

describe('자동 조건 (diff에 대한 술어)', () => {
  function only(c: AutoCondition, e: Partial<EvidenceBundle> = {}): GateResult {
    return run(e, contract(), { conditions: [c], track_record_ok: { [c.id]: true } })
  }

  test.each<[string, AutoCondition, GateResult['conclusion']]>([
    ['바뀐 줄이 상한과 같음', { id: 'c', max_changed_lines: 25 }, 'auto_merge_candidate'],
    ['바뀐 줄이 상한을 넘음', { id: 'c', max_changed_lines: 24 }, 'human_merge'],
    [
      '바뀐 파일이 모두 paths 안',
      { id: 'c', paths: ['src/**', 'test/**'] },
      'auto_merge_candidate',
    ],
    ['paths 밖 파일이 있음', { id: 'c', paths: ['src/**'] }, 'human_merge'],
    ['빈 paths', { id: 'c', paths: [] }, 'human_merge'],
    [
      '줄이 모두 시험으로 확인됨',
      { id: 'c', max_changed_lines: 100, require_all_lines_tested: true },
      'auto_merge_candidate',
    ],
  ])('%s → %s', (_name, c, conclusion) => {
    expect(only(c).conclusion).toBe(conclusion)
  })

  test('못 채운 까닭을 조건마다 적는다', () => {
    const diff = { ...DIFF, added: 90, deleted: 10, paths: ['src/a.ts', 'docs/x.md'] }
    const conditions: AutoCondition[] = [
      { id: 'small', max_changed_lines: 50 },
      { id: 'src', paths: ['src/**'], max_changed_lines: 10 },
    ]
    expect(run({ diff }, contract(), { conditions })).toEqual({
      conclusion: 'human_merge',
      decisive: '채운 자동 조건 없음',
      reasons: [
        '채운 자동 조건 없음',
        '조건 small: 바뀐 줄 100 > 50',
        '조건 src: 바뀐 줄 100 > 10, 조건 경로 밖: docs/x.md',
      ],
      condition: null,
      shadow: false,
    })
  })

  test('새 의존성·새 모듈을 금한 조건은 못 채운다', () => {
    const diff = { ...DIFF, new_dependencies: ['lodash'], new_modules: ['src/new'] }
    const c: AutoCondition = {
      id: 'c',
      max_changed_lines: 100,
      no_new_dependencies: true,
      no_new_modules: true,
    }
    const r = only(c, { diff })
    expect(r.reasons).toEqual([
      '채운 자동 조건 없음',
      '조건 c: 새 의존성: lodash, 새 모듈: src/new',
    ])
  })

  test('금하지 않은 조건은 새 의존성이 있어도 채운다', () => {
    const diff = { ...DIFF, new_dependencies: ['lodash'] }
    const r = only({ id: 'c', max_changed_lines: 100, no_new_dependencies: false }, { diff })
    expect(r.conclusion).toBe('auto_merge_candidate')
  })

  test('제한이 하나도 없는 조건은 채운 것으로 보지 않는다', () => {
    const r = only({ id: 'any', no_new_modules: false, require_all_lines_tested: false })
    expect(r.reasons).toEqual(['채운 자동 조건 없음', '조건 any: 크기·범위 제한이 없는 조건'])
  })

  test.each<AutoCondition>([
    { id: 'any', require_all_lines_tested: true },
    { id: 'any', no_new_modules: true },
    { id: 'any', no_new_dependencies: true, no_new_modules: true, require_all_lines_tested: true },
  ])('부울 제한만 있는 조건은 큰 diff도 막지 못하므로 채운 것으로 보지 않는다 (%j)', (c) => {
    const diff = { ...DIFF, files: 40, added: 5000, deleted: 3000 }
    const r = only(c, { diff })
    expect(r.conclusion).toBe('human_merge')
    expect(r.reasons).toEqual(['채운 자동 조건 없음', '조건 any: 크기·범위 제한이 없는 조건'])
  })

  test('바이너리 파일이 있으면 줄 수 상한을 채운 것으로 보지 않는다', () => {
    const diff = {
      ...DIFF,
      added: 0,
      deleted: 0,
      paths: ['bin/tool.wasm'],
      binary: ['bin/tool.wasm'],
    }
    const r = only({ id: 'c', max_changed_lines: 50 }, { diff })
    expect(r.reasons).toEqual(['채운 자동 조건 없음', '조건 c: 바이너리 변경: bin/tool.wasm'])
  })

  test('줄 수 상한 0도 바이너리·이름 바꿈만 있는 diff를 고르지 않는다', () => {
    const diff = { ...DIFF, added: 0, deleted: 0, binary: ['a.png'] }
    expect(only({ id: 'c', max_changed_lines: 0 }, { diff }).conclusion).toBe('human_merge')
  })

  test('바이너리 목록이 없는 묶음은 줄 수 상한을 채운 것으로 보지 않는다', () => {
    const diff = { ...DIFF, binary: undefined as never }
    const r = only({ id: 'c', max_changed_lines: 50 }, { diff })
    expect(r.reasons).toEqual(['채운 자동 조건 없음', '조건 c: 바이너리 변경을 모름'])
  })

  test('바이너리가 있어도 줄 수 상한이 없는 paths 조건은 채울 수 있다', () => {
    const diff = { ...DIFF, binary: ['src/a.png'], paths: ['src/a.png'] }
    expect(only({ id: 'c', paths: ['src/**'] }, { diff }).conclusion).toBe('auto_merge_candidate')
  })

  test('바뀐 줄 수를 모르면(NaN) 상한을 채운 것으로 보지 않는다', () => {
    const diff = { ...DIFF, added: Number.NaN }
    expect(only({ id: 'c', max_changed_lines: 50 }, { diff }).conclusion).toBe('human_merge')
  })

  test('정책에 조건이 없으면 사람 머지다', () => {
    expect(run({}, contract(), { conditions: [] })).toEqual({
      conclusion: 'human_merge',
      decisive: '채운 자동 조건 없음',
      reasons: ['채운 자동 조건 없음', '정책에 자동 조건이 없음'],
      condition: null,
      shadow: false,
    })
  })

  test('처음 채운 조건을 쓴다', () => {
    const conditions: AutoCondition[] = [
      { id: 'tiny', max_changed_lines: 5 },
      { id: 'mid', max_changed_lines: 100 },
      { id: 'big', max_changed_lines: 1000 },
    ]
    const r = run({}, contract(), { conditions, track_record_ok: { mid: true, big: true } })
    expect(r).toMatchObject({ conclusion: 'auto_merge_candidate', condition: 'mid' })
  })

  test('처음 채운 조건의 실적이 없으면 뒤 조건의 실적이 있어도 그림자다', () => {
    const conditions: AutoCondition[] = [
      { id: 'new', max_changed_lines: 100 },
      { id: 'old', max_changed_lines: 1000 },
    ]
    const r = run({}, contract(), { conditions, track_record_ok: { old: true } })
    expect(r).toMatchObject({ conclusion: 'human_merge', condition: 'new', shadow: true })
  })
})

describe('스위치·서버 보호·실적 중 하나라도 없으면 그림자', () => {
  const noRecord = '조건 small의 그림자 실적이 기준에 못 미침'

  test.each<[string, Partial<Policy>, string]>([
    ['자동 머지 스위치 꺼짐', { auto_merge_enabled: false }, '프로젝트에서 자동 머지가 꺼져 있음'],
    ['서버 보호를 모름', { server: null }, '서버 보호를 확인하지 못함'],
    [
      '브랜치 보호 없음',
      { server: { ...SERVER, branch_protected: false } },
      '기본 브랜치 보호가 없음',
    ],
    ['필수 검사 없음', { server: { ...SERVER, required_checks: false } }, '필수 검사가 없음'],
    [
      'merge queue도 최신 맞춤도 없음',
      { server: { ...SERVER, up_to_date_required: false } },
      'merge queue도 최신 대상 맞춤 요구도 없음',
    ],
    ['실적이 기준에 못 미침', { track_record_ok: { small: false } }, noRecord],
    ['실적 기록이 없음', { track_record_ok: {} }, noRecord],
  ])('%s', (_name, p, decisive) => {
    expect(run({}, contract(), p)).toEqual({
      conclusion: 'human_merge',
      decisive,
      reasons: [decisive],
      condition: 'small',
      shadow: true,
    })
  })

  test('막은 것을 모두 적고 decisive는 스위치부터다', () => {
    const r = run({}, contract(), { auto_merge_enabled: false, server: null, track_record_ok: {} })
    expect(r).toEqual({
      conclusion: 'human_merge',
      decisive: '프로젝트에서 자동 머지가 꺼져 있음',
      reasons: ['프로젝트에서 자동 머지가 꺼져 있음', '서버 보호를 확인하지 못함', noRecord],
      condition: 'small',
      shadow: true,
    })
  })

  test('서버 보호에서 빠진 것을 모두 적는다', () => {
    const server: ServerProtection = {
      branch_protected: false,
      required_checks: false,
      merge_queue: false,
      up_to_date_required: false,
    }
    expect(run({}, contract(), { server }).reasons).toEqual([
      '기본 브랜치 보호가 없음',
      '필수 검사가 없음',
      'merge queue도 최신 대상 맞춤 요구도 없음',
    ])
  })

  test.each([[1], ['true']])('참이 아닌 실적 값(%j)은 실적으로 보지 않는다', (value) => {
    const track_record_ok = { small: value } as unknown as Record<string, boolean>
    expect(run({}, contract(), { track_record_ok }).shadow).toBe(true)
  })

  test('참이 아닌 스위치 값은 꺼진 것으로 본다', () => {
    const r = run({}, contract(), { auto_merge_enabled: 'yes' as never })
    expect(r).toMatchObject({ decisive: '프로젝트에서 자동 머지가 꺼져 있음', shadow: true })
  })

  test('조건 id가 객체 기본 속성 이름이어도 실적으로 보지 않는다', () => {
    const c: AutoCondition = { id: 'constructor', max_changed_lines: 100 }
    const r = run({}, contract(), { conditions: [c], track_record_ok: {} })
    expect(r).toMatchObject({ conclusion: 'human_merge', condition: 'constructor', shadow: true })
  })

  test('M1처럼 리뷰가 없으면 그림자까지 가지 않고 사람 머지다', () => {
    const r = run({ review: null }, contract(), { server: null })
    expect(r).toMatchObject({ conclusion: 'human_merge', decisive: '리뷰 없음', shadow: false })
  })
})

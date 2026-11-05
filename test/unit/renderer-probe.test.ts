// [단위] 계약 판의 제출 때 기준 확인(V28, renderer/src/probe.ts): 머리의 한 줄과 예시마다 꼬리표. 꼬리표의 색은 줄이 원하는
// 것으로 정한다(바뀜 줄의 예시는 기준에서 실패해야, 지킴 줄의 예시는 통과해야 한다).
import { describe, expect, test } from 'vitest'
import type { ContractLine, ContractProbe, LineVerdict } from '../../src/core/types.ts'
import { PROBE_MESSAGE_SHOWN, probeBadge, probeSummary } from '../../src/renderer/src/probe.ts'

const line = (id: string, kind: ContractLine['kind'], check: ContractLine['check'] = 'test') => ({
  id,
  kind,
  text: '',
  grounds: [],
  examples: [`${id}.1`],
  check,
})

const C1 = line('C1', 'change')
const C2 = line('C2', 'keep')

function probe(lines: LineVerdict[], over: Partial<ContractProbe> = {}): ContractProbe {
  return {
    head: 'a'.repeat(40),
    base: 'b'.repeat(40),
    contract: 'h',
    ran: true,
    note: null,
    lines,
    ms: 2400,
    ...over,
  }
}

const verdict = (l: ContractLine, examples: LineVerdict['examples']): LineVerdict => ({
  line: l.id,
  kind: l.kind,
  status: 'met',
  detail: '',
  examples,
})

test('probeSummary: 돌렸으면 head·기준과 걸린 시간, 아니면 까닭, 확인이 없으면 null', () => {
  expect(probeSummary(probe([]))).toBe(
    '제출 때 기준에서 확인함: head aaaaaaa의 태그 시험을 기준 bbbbbbb에서 돌림 · 2초',
  )
  expect(
    probeSummary(
      probe([], { ran: false, note: '바뀜·지킴 줄의 예시 태그를 단 시험 파일이 head에 없음' }),
    ),
  ).toBe('제출 때 기준 확인 안 함: 바뀜·지킴 줄의 예시 태그를 단 시험 파일이 head에 없음')
  expect(probeSummary(null)).toBeNull()
})

describe('probeBadge', () => {
  const badge = (label: string, tone: string, title = '', now: string | null = null) => ({
    label,
    tone,
    now,
    title,
  })

  test('바뀜 줄의 예시가 기준에서 실패하면 재현(좋음)이고 지금 출력을 줄여 옆에 보인다', () => {
    const long = `AssertionError: ${'x'.repeat(100)}`
    const p = probe([verdict(C1, [{ id: 'C1.1', head: 'passed', base: 'failed', message: long }])])
    const b = probeBadge(p, C1, 'C1.1')
    expect(b).toMatchObject({ label: '기준에서 실패', tone: 'ok', title: long })
    expect(b?.now?.startsWith('AssertionError: xxx')).toBe(true)
    expect(b?.now?.endsWith('…')).toBe(true)
    expect(b?.now).toHaveLength(PROBE_MESSAGE_SHOWN)
  })

  test('지킴 줄은 기준에서 통과가 좋음, 실패·불러오지 못함은 나쁨', () => {
    const ok = probe([verdict(C2, [{ id: 'C2.1', head: 'passed', base: 'passed' }])])
    expect(probeBadge(ok, C2, 'C2.1')).toEqual(badge('기준에서 통과', 'ok'))
    const failed = probe([verdict(C2, [{ id: 'C2.1', head: 'passed', base: 'failed' }])])
    expect(probeBadge(failed, C2, 'C2.1')).toEqual(badge('기준에서 실패', 'bad'))
    const msg = 't.js: test failed'
    const unloaded = probe([
      verdict(C2, [{ id: 'C2.1', head: 'passed', base: 'missing', message: msg }]),
    ])
    expect(probeBadge(unloaded, C2, 'C2.1')).toEqual(
      badge('기준에서 불러오지 못함', 'bad', msg, msg),
    )
  })

  test('바뀜 줄의 예시가 기준에서도 통과하면 지킴 예시(정보), 기준 결과에 없으면 흐리게', () => {
    const p = probe([verdict(C1, [{ id: 'C1.1', head: 'passed', base: 'passed' }])])
    expect(probeBadge(p, C1, 'C1.1')).toEqual(badge('기준에서 통과', 'info'))
    const gone = probe([verdict(C1, [{ id: 'C1.1', head: 'passed', base: 'missing' }])])
    expect(probeBadge(gone, C1, 'C1.1')).toEqual(badge('기준에 그 시험이 없음', 'muted'))
  })

  test('태그 시험이 없거나 확인을 돌리지 않았으면 확인 안 함, 확인하지 않는 줄은 꼬리표가 없음', () => {
    const p = probe([verdict(C1, [{ id: 'C1.1', head: 'missing', base: 'not_run' }])])
    expect(probeBadge(p, C1, 'C1.1')).toEqual(
      badge('확인 안 함', 'muted', 'head에 이 예시의 태그를 단 시험이 없음'),
    )
    const off = probe([], { ran: false, note: '품질 기준에 수용 시험 명령이 없음' })
    expect(probeBadge(off, C2, 'C2.1')).toEqual(
      badge('확인 안 함', 'muted', '품질 기준에 수용 시험 명령이 없음'),
    )
    expect(probeBadge(probe([]), line('C3', 'new'), 'C3.1')).toBeNull()
    expect(probeBadge(probe([]), line('C4', 'keep', 'observe'), 'C4.1')).toBeNull()
  })
})

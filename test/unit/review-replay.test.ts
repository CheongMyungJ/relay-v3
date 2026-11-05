// [단위] 리뷰 재생(m2.1-design 14절 O2, scripts/review-replay.ts)의 순수한 몫: 묶음 고르기와 호출 계획, 리뷰 결과의 칸(올림,
// 메모, request_gap), 14절의 통과 기준과 보고 값(구조 medium 이상, 반복 사이 뒤집힘). 저장된 결과 폴더를 읽고 임시 레포를 만들어
// 리뷰어를 부르고 JSONL을 쓰는 것은 [흐름] test/flow/review-replay.test.ts가 본다.
import { describe, expect, test } from 'vitest'
import { REVIEW_TOOLS as APP_TOOLS } from '../../src/main/works-review.ts'
import {
  callsOf,
  evalEnv,
  keyOf,
  plan,
  REVIEW_TOOLS,
  reviewFields,
  sameDiff,
  slimUsage,
  spread,
  summarize,
  summaryText,
  TARGET_B,
  type Bundle,
  type Call,
  type Line,
} from '../../scripts/review-replay.ts'

const bundle = (
  scenario: string,
  arm: string,
  run: number,
  work: string,
  pass: boolean,
): Bundle => ({
  scenario,
  arm,
  run,
  work,
  hidden_pass: pass,
  dir: `/results/${scenario}/${arm}-${run}`,
  options: {},
})

/** M2 꼴의 묶음: 14는 쪽마다 1·2·4·5회 실패, 3회 통과. B 시나리오는 쪽마다 5회, 실행마다 Work 둘 */
function m2Like(): Bundle[] {
  const out: Bundle[] = []
  for (const arm of ['relay3-noreview', 'relay3'])
    for (const run of [5, 4, 3, 2, 1]) {
      out.push(bundle('14-double-notify', arm, run, `w${run}`, run === 3))
      for (const s of TARGET_B.scenarios)
        for (const w of ['b', 'a']) out.push(bundle(s, arm, run, `${w}${run}`, true))
    }
  return out
}

test('리뷰어의 읽기 도구는 앱의 것과 같다', () => {
  expect(REVIEW_TOOLS).toEqual(APP_TOOLS)
})

describe('묶음 고르기와 호출 계획', () => {
  test('M2 꼴이면 설계대로 A 8묶음 × 3번, B 30묶음 × 1번, 모두 54번', () => {
    const p = plan(m2Like())
    const a = p.filter((x) => x.target === 'A')
    expect(a.map((x) => keyOf(x.bundle))).toEqual([
      '14-double-notify/relay3-1/w1',
      '14-double-notify/relay3-noreview-1/w1',
      '14-double-notify/relay3-2/w2',
      '14-double-notify/relay3-noreview-2/w2',
      '14-double-notify/relay3-4/w4',
      '14-double-notify/relay3-noreview-4/w4',
      '14-double-notify/relay3-5/w5',
      '14-double-notify/relay3-noreview-5/w5',
    ])
    expect(a.every((x) => x.repeats === 3 && !x.bundle.hidden_pass)).toBe(true)
    expect(p.filter((x) => x.target === 'B' && x.repeats === 1)).toHaveLength(30)
    const calls = callsOf(p)
    expect(calls).toHaveLength(54)
    expect(calls.slice(0, 4)).toEqual([
      { target: 'A', key: '14-double-notify/relay3-1/w1', repeat: 1 },
      { target: 'A', key: '14-double-notify/relay3-1/w1', repeat: 2 },
      { target: 'A', key: '14-double-notify/relay3-1/w1', repeat: 3 },
      { target: 'A', key: '14-double-notify/relay3-noreview-1/w1', repeat: 1 },
    ])
  })

  test('B는 (회차, 쪽, Work) 차례로 실행마다 첫 Work를 먼저 고른다', () => {
    const b = plan(m2Like()).filter((x) => x.bundle.scenario === '07-two-bugs')
    expect(b.map((x) => keyOf(x.bundle))).toEqual([
      '07-two-bugs/relay3-1/a1',
      '07-two-bugs/relay3-noreview-1/a1',
      '07-two-bugs/relay3-2/a2',
      '07-two-bugs/relay3-noreview-2/a2',
      '07-two-bugs/relay3-3/a3',
    ])
  })

  test('실행이 모자라면 같은 차례로 나머지 Work에서 채운다', () => {
    const few = ['x', 'y', 'z'].flatMap((w) => [1, 2].map((r) => bundle('s', 'relay3', r, w, true)))
    expect(spread(few, 5).map(keyOf)).toEqual([
      's/relay3-1/x',
      's/relay3-2/x',
      's/relay3-1/y',
      's/relay3-1/z',
      's/relay3-2/y',
    ])
    expect(spread(few, 10)).toHaveLength(6)
  })

  test('숨긴 시험을 통과한 14 묶음과 실패한 B 묶음은 대상이 아니다', () => {
    const p = plan([
      bundle('14-double-notify', 'relay3', 3, 'p', true),
      bundle('07-two-bugs', 'relay3', 1, 'f', false),
    ])
    expect(p).toEqual([])
  })
})

describe('리뷰 결과의 칸', () => {
  test('올림은 갈래/심각도별로 세고 구조/low와 갈래 없는 지적은 메모다', () => {
    const r = reviewFields({
      ok: true,
      value: {
        findings: [
          { severity: 'low', raise: 'request_gap', text: '다른 원인' },
          { severity: 'low', raise: 'structure', text: '시험 없음' },
          { severity: 'medium', raise: 'structure', text: '빈 입력' },
          { severity: 'medium', raise: 'structure', text: '음수' },
          { severity: 'low', text: '이름' },
        ],
      },
      usage: { input_tokens: 10, output_tokens: 2, service_tier: 'standard', cache: { a: 1 } },
    })
    expect(r.status).toBe('done')
    expect(r.raises).toEqual({ 'request_gap/low': 1, 'structure/medium': 2 })
    expect(r.memos).toBe(2)
    expect(r.request_gap).toBe(true)
    expect(r.findings.map((f) => f.id)).toEqual(['R1', 'R2', 'R3', 'R4', 'R5'])
    expect(r.usage).toEqual({ input_tokens: 10, output_tokens: 2 })
  })

  test('claude -p 실패와 읽지 못한 결과는 실패다', () => {
    expect(reviewFields({ ok: false, error: '시간 초과' })).toMatchObject({
      status: 'failed',
      error: '시간 초과',
      findings: [],
      request_gap: false,
    })
    const bad = reviewFields({ ok: true, value: { findings: [{ severity: 'huge', text: 'x' }] } })
    expect(bad.status).toBe('failed')
    expect(bad.error).toContain('리뷰 결과를 읽지 못함')
  })

  test('평가가 앱에 준 환경, 사용량의 수 칸, 증거의 diff와 견줌', () => {
    expect(evalEnv({ agentModel: 'm', effort: 'medium' })).toEqual({
      ANTHROPIC_MODEL: 'm',
      CLAUDE_CODE_EFFORT_LEVEL: 'medium',
    })
    expect(evalEnv({})).toEqual({})
    expect(slimUsage(undefined)).toBeNull()
    const d = { files: 2, added: 5, deleted: 1, new_dependencies: [], new_modules: [] }
    const ev = { ...d, paths: ['src/a.js', 'test/a.test.js'], binary: [] }
    expect(sameDiff('1\t1\tsrc/a.js\n4\t0\ttest/a.test.js\n', ev)).toBe(true)
    expect(sameDiff('1\t1\tsrc/a.js\n', ev)).toBe(false)
    expect(sameDiff('2\t1\tsrc/a.js\n4\t0\ttest/a.test.js\n', ev)).toBe(false)
  })
})

// ── 요약 ────────────────────────────────────────────────────────────────────

const FACTS = { overlay: 'same' as const, same_as_evidence: true, contract_same: true }

function line(c: Call, o: { gap?: boolean; structure?: ('low' | 'medium')[] } = {}): Line {
  const findings = [
    ...(o.gap
      ? [{ id: 'R1', severity: 'low' as const, raise: 'request_gap' as const, text: 'g' }]
      : []),
    ...(o.structure ?? []).map((severity, i) => ({
      id: `S${i}`,
      severity,
      raise: 'structure' as const,
      text: 's',
    })),
  ]
  const raised = reviewFields({ ok: true, value: { findings }, usage: { input_tokens: 3 } })
  const [scenario = '', armRun = '', work = ''] = c.key.split('/')
  return {
    key: c.key,
    target: c.target,
    scenario,
    arm: armRun.replace(/-\d+$/, ''),
    run: Number(armRun.replace(/^.*-/, '')),
    work,
    hidden_pass: c.target === 'B',
    repeat: c.repeat,
    dry: false,
    prompt_version: 3,
    ...raised,
    request: true,
    prompt_chars: 100,
    ms: 1,
    checkout: FACTS,
  }
}

const CALLS = callsOf(plan(m2Like()))
const A_KEYS = [...new Set(CALLS.filter((c) => c.target === 'A').map((c) => c.key))]
const B_KEYS = [...new Set(CALLS.filter((c) => c.target === 'B').map((c) => c.key))]

/** A 묶음 i의 반복마다 request_gap(gapsA[i]), B 묶음 앞의 bHits개에 request_gap */
function lines(gapsA: boolean[][], bHits: number): Line[] {
  return CALLS.map((c) =>
    line(c, {
      gap:
        c.target === 'A'
          ? (gapsA[A_KEYS.indexOf(c.key)]?.[c.repeat - 1] ?? false)
          : B_KEYS.indexOf(c.key) < bHits,
    }),
  )
}

const T = [true, true, false]
const F = [true, false, false]

describe('14절의 통과 기준', () => {
  test('A: 3번 중 2번 이상 올린 묶음이 4개면 통과, 3개면 넘지 못함', () => {
    const pass = summarize(lines([T, T, T, T, F, F, F, F], 0), CALLS)
    expect(pass).toMatchObject({ design: true, a: { hits: 4, pass: true } })
    expect(pass.calls).toEqual({ planned: 54, done: 54, failed: 0, missing: 0 })
    const fail = summarize(lines([T, T, T, F, F, F, F, F], 0), CALLS)
    expect(fail.a).toMatchObject({ hits: 3, pass: false })
    expect(summaryText(fail)).toContain('V30은 메모로 내린 채 배치를 돈다')
  })

  test('B: request_gap을 올린 묶음이 4개면 통과, 5개면 넘지 못함', () => {
    const all = [T, T, T, T, T, T, T, T]
    expect(summarize(lines(all, 4), CALLS).b).toMatchObject({ hits: 4, pass: true })
    expect(summarize(lines(all, 5), CALLS).b).toMatchObject({ hits: 5, pass: false })
    expect(summaryText(summarize(lines(all, 4), CALLS))).toContain('판정: 통과')
  })

  test('끝나지 않은 호출이 있으면 그 대상은 모름이다. 실패 뒤 다시 돈 호출은 끝난 줄을 쓴다', () => {
    const all = lines([T, T, T, T, T, T, T, T], 0)
    const failed: Line = { ...all[0], status: 'failed', error: 'x' } as Line
    const s = summarize([failed, ...all.slice(1)], CALLS)
    expect(s.calls).toEqual({ planned: 54, done: 53, failed: 1, missing: 0 })
    expect(s.a.pass).toBeNull()
    expect(s.b.pass).toBe(true)
    expect(summaryText(s)).toContain('--resume')
    expect(summarize([failed, ...all], CALLS).calls.done).toBe(54)
    expect(summarize([...all, failed], CALLS).calls.done).toBe(54)
    expect(summarize(all.slice(3), CALLS).calls.missing).toBe(3)
  })

  test('계획이 설계의 규모가 아니면 알린다', () => {
    const calls = CALLS.slice(0, 6)
    const s = summarize(lines([T, T], 0).slice(0, 6), calls)
    expect(s.design).toBe(false)
    expect(summaryText(s)).toContain('설계(A 8×3, B 30×1, 54번)와 다르다')
  })
})

describe('보고만 하는 값', () => {
  test('구조 지적 가운데 medium 이상, 반복 사이 뒤집힘, 갈래/심각도별 올림, 토큰', () => {
    const [k0, k1] = A_KEYS
    const at = (key: string | undefined, repeat: number) =>
      CALLS.find((c) => c.key === key && c.repeat === repeat) as Call
    const ls = [
      line(at(k0, 1), { gap: true, structure: ['low', 'medium'] }),
      line(at(k0, 2), { gap: true, structure: ['low'] }),
      line(at(k0, 3), { gap: false }),
      line(at(k1, 1), { structure: ['medium'] }),
      line(at(k1, 2), { structure: ['medium'] }),
      line(at(k1, 3), { structure: ['medium', 'low'] }),
      line(CALLS.find((c) => c.target === 'B') as Call, { structure: ['low'] }),
    ]
    const s = summarize(ls, CALLS)
    expect(s.structure).toEqual({ A: { all: 7, up: 4 }, B: { all: 1, up: 0 } })
    expect(s.flips).toEqual({ bundles: 2, request_gap: 1, any_raise: 1, structure_up: 1 })
    expect(s.raises.A).toEqual({ 'request_gap/low': 2, 'structure/medium': 4 })
    expect(s.usage).toEqual({ input: 21, output: 0 })
    const text = summaryText(s)
    expect(text).toContain('medium 이상 A 4/7, B 0/1, 모두 4/8 (50%)')
    expect(text).toContain(`${k0 ?? ''}  ●●○`)
  })
})

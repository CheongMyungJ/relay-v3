// [단위] 리뷰 재생(m2.1-design 14절 O2, scripts/review-replay.ts, review-replay-plan.ts)의 순수한 몫: 묶음 고르기와 호출 계획
// (B에서 요청이 Work의 몫보다 넓은 묶음을 뺌), 리뷰 결과의 칸(올림, 메모, request_gap), 호출마다의 claude 설정 폴더, 14절의
// 통과 기준과 보고 값(구조 medium 이상, 반복 사이 뒤집힘). 저장된 결과 폴더를 읽고 임시 레포를 만들어 리뷰어를 부르고 JSONL을
// 쓰는 것은 [흐름] test/flow/review-replay.test.ts가 본다.
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { REVIEW_TOOLS as APP_TOOLS } from '../../src/main/works-review.ts'
import {
  CONFIG_FILES,
  evalEnv,
  makeConfigDir,
  operatorEnv,
  REVIEW_TOOLS,
  reviewFields,
  sameDiff,
  slimUsage,
  summarize,
  summaryText,
  type Line,
} from '../../scripts/review-replay.ts'
import {
  callsOf,
  excludedFromB,
  FULL_REPORT,
  keyOf,
  plan,
  reportCoverage,
  spread,
  TARGET_B,
  widerRequest,
  type Bundle,
  type Call,
} from '../../scripts/review-replay-plan.ts'

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
  wider: null,
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

  test('B는 요청이 Work의 몫보다 넓은 묶음을 빼고 같은 차례로 다음 묶음을 고른다(다섯 그대로)', () => {
    const all = m2Like().map((b) =>
      b.scenario === '40-three-libraries' && b.work.startsWith('a') && b.run <= 2
        ? { ...b, wider: 'full_report' as const }
        : b,
    )
    const b = plan(all).filter((x) => x.bundle.scenario === '40-three-libraries')
    // 1·2회의 첫 Work(a)가 빠져 그 실행의 다음 Work(b)가 실행의 첫 Work가 된다
    expect(b.map((x) => keyOf(x.bundle))).toEqual([
      '40-three-libraries/relay3-1/b1',
      '40-three-libraries/relay3-noreview-1/b1',
      '40-three-libraries/relay3-2/b2',
      '40-three-libraries/relay3-noreview-2/b2',
      '40-three-libraries/relay3-3/a3',
    ])
    expect(plan(all).filter((x) => x.target === 'B')).toHaveLength(30)
    expect(excludedFromB(all)).toEqual([
      '40-three-libraries/relay3-1/a1 (full_report)',
      '40-three-libraries/relay3-noreview-1/a1 (full_report)',
      '40-three-libraries/relay3-2/a2 (full_report)',
      '40-three-libraries/relay3-noreview-2/a2 (full_report)',
    ])
    expect(excludedFromB(m2Like())).toEqual([])
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
    // 요청과 어긋남(V30)은 메모다(M2.1 O2). request_gap은 리뷰어가 낸 것을 그대로 센다
    expect(r.raises).toEqual({ 'structure/medium': 2 })
    expect(r.memos).toBe(3)
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

  test('평가가 앱에 준 환경(호출의 설정 폴더 포함), 사용량의 수 칸, 증거의 diff와 견줌', () => {
    const clean = { DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false' }
    expect(evalEnv({ agentModel: 'm', effort: 'medium' }, '/cfg')).toEqual({
      ...clean,
      ANTHROPIC_MODEL: 'm',
      CLAUDE_CODE_EFFORT_LEVEL: 'medium',
      CLAUDE_CONFIG_DIR: '/cfg',
    })
    expect(evalEnv({}, '/cfg')).toEqual({ ...clean, CLAUDE_CONFIG_DIR: '/cfg' })
    // 운영자의 Claude Code 세션 변수는 넘기지 않는다(--pass-env로 고른 것은 넘긴다)
    const env = {
      PATH: '/bin',
      CLAUDECODE: '1',
      CLAUDE_CODE_SYNC_SKILLS: '1',
      ANTHROPIC_API_KEY: 'k',
    }
    expect(operatorEnv({ ...env, FAKE_CLAUDE_LOG: 'x', HTTPS_PROXY: 'p' })).toEqual([
      'CLAUDECODE',
      'CLAUDE_CODE_SYNC_SKILLS',
      'ANTHROPIC_API_KEY',
    ])
    expect(operatorEnv(env, ['ANTHROPIC_API_KEY'])).toEqual([
      'CLAUDECODE',
      'CLAUDE_CODE_SYNC_SKILLS',
    ])
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
    const out = summaryText(summarize(lines(all, 4), CALLS, ['40/relay3-1/w (full_report)']))
    expect(out).toContain('요청이 Work의 몫보다 넓음): 1 (40/relay3-1/w (full_report))')
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
    // 요청과 어긋남(V30)은 메모라 올림에 들지 않는다(M2.1 O2)
    expect(s.raises.A).toEqual({ 'structure/medium': 4 })
    expect(s.usage).toEqual({ input: 21, output: 0 })
    const text = summaryText(s)
    expect(text).toContain('medium 이상 A 4/7, B 0/1, 모두 4/8 (50%)')
    expect(text).toContain(`${k0 ?? ''}  ●●○`)
  })
})

// ── 요청이 Work의 몫보다 넓은가 ───────────────────────────────────────────────

/** 40 꼴의 리포트: 모듈 셋 */
const REPORT =
  '공용 도구 세 개를 같이 만들어 주세요. (1) src/csv.js에 parseCsv(text). (2) src/money.js에 formatKrw(amount). (3) src/workdays.js에 addWorkdays(date, n).'
const MONEY =
  'src/money.js에 formatKrw(amount)를 만들어 주세요. csv와 workdays는 다른 Work에서 합니다.'
const kind = '\n\n## 일의 성격 제안\n\n기능\n'

describe('요청이 Work의 몫보다 넓은가 (B에서 뺌)', () => {
  test('리포트의 낱말 가운데 요청에 있는 비율. 말을 조금 바꿔 옮겨도 전부로 본다', () => {
    expect(reportCoverage(`${REPORT}${kind}`, REPORT)).toBe(1)
    expect(reportCoverage(MONEY, REPORT)).toBeLessThan(FULL_REPORT)
    const reworded = REPORT.replace('만들어 주세요.', '만들어 줘.')
    expect(reportCoverage(reworded, REPORT)).toBeGreaterThanOrEqual(FULL_REPORT)
    // 리포트가 여럿(07)이면 모두를 합쳐 본다
    const two = [
      '리포트 1: truncate가 9자를 돌려준다 (src/text.js)',
      '리포트 2: median이 틀린다 (src/stats.js)',
    ]
    expect(reportCoverage(two[0] ?? '', two)).toBeLessThan(FULL_REPORT)
    expect(reportCoverage(two.join(' 그리고 '), two)).toBe(1)
    expect(reportCoverage('무엇이든', '')).toBe(0)
  })

  test('Work가 여럿인 실행에서 리포트 전부를 받은 Work, 비목표가 요청의 파일·함수를 다른 Work로 넘긴 Work', () => {
    const one = { works: 1, report: REPORT, nonGoals: [] }
    expect(widerRequest({ ...one, request: REPORT })).toBeNull()
    const three = { works: 3, report: REPORT, nonGoals: [] }
    expect(widerRequest({ ...three, request: `${REPORT}${kind}` })).toBe('full_report')
    expect(widerRequest({ ...three, request: MONEY })).toBeNull()
    expect(widerRequest({ ...three, request: null })).toBeNull()
    // 리포트를 읽지 못해도 비목표로 본다: 요청이 부른 money.js·formatKrw를 별도 Work로 넘김
    const handed = [
      'money.js(formatKrw)와 workdays.js는 이 Work에서 하지 않는다. 별도 Work로 한다.',
    ]
    const wide = { works: 3, report: null, request: REPORT }
    expect(widerRequest({ ...wide, nonGoals: handed })).toBe('non_goal_elsewhere')
    // 다른 Work를 말하지 않는 비목표, 요청이 부르지 않은 파일을 넘기는 비목표는 아니다
    expect(widerRequest({ ...wide, nonGoals: ['money.js는 건드리지 않는다'] })).toBeNull()
    const others = ['csv.js, workdays.js는 건드리지 않는다(다른 Work).']
    expect(widerRequest({ works: 3, report: null, request: MONEY, nonGoals: others })).toBeNull()
  })
})

describe('호출마다의 claude 설정 폴더', () => {
  test('평가의 makeClaudeConfig와 같은 내용(온보딩 건너뜀, 입력창 추천 끔)을 새 임시 폴더에 쓴다', () => {
    const a = makeConfigDir()
    const b = makeConfigDir()
    try {
      expect(a).not.toBe(b)
      expect(readdirSync(a).sort()).toEqual(['.claude.json', 'settings.json'])
      expect(JSON.parse(readFileSync(path.join(a, '.claude.json'), 'utf8'))).toEqual({
        hasCompletedOnboarding: true,
      })
      expect(readFileSync(path.join(a, 'settings.json'), 'utf8')).toBe(
        JSON.stringify({ promptSuggestionEnabled: false }, null, 2),
      )
      expect(Object.keys(CONFIG_FILES).sort()).toEqual(readdirSync(b).sort())
    } finally {
      for (const d of [a, b]) rmSync(d, { recursive: true, force: true })
    }
    expect(existsSync(a)).toBe(false)
  })
})

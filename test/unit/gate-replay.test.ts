// [단위] 관문 재생 래칫(V31, docs/m2.1-design.md 12절). 저장된 평가의 relay3 내보내기 묶음(숨긴 시험 이름표가 붙음)으로
// 지금의 관문을 초안 정책으로 돌린다. 관문을 느슨하게 하는 고침이 머지 전에 보인다.
// 자료는 scripts/gate-replay-fixture.ts가 만들고 꼴은 test/support/gate-replay.ts다. M2 Q4의 사후 계산
// (docs/experiments/m2/posthoc-q4.mjs)을 옮겼다: 시험 수 래칫의 태그 고침은 이제 코드에 있어 자료를 만들 때 다시 잰다.
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { gate } from '../../src/core/gate.ts'
import { DRAFT_AUTO } from '../../src/core/quality.ts'
import { raises } from '../../src/core/review.ts'
import type {
  EvidenceBundle,
  GateResult,
  Integration,
  Policy,
  ReviewFinding,
} from '../../src/core/types.ts'
import {
  bundleName,
  readReplay,
  reasonKind,
  RUN_MET,
  runMet,
  type ReplayBundle,
} from '../support/gate-replay.ts'

const BUNDLES = readReplay(fileURLToPath(new URL('../fixtures/gate-replay/', import.meta.url)))

/**
 * 래칫: 규약마다 숨긴 시험이 실패했는데 자동 조건을 채운 묶음(거짓 자동)의 수. 늘면 실패한다. 줄면 이 값을 내린다. 규약마다
 * 두어 한 규약에서 준 것이 다른 규약에서 는 것을 가리지 않게 한다. 묶음을 더한 규약은 여기에 적는다.
 * - m2 3: M2 묶음, V26 규칙(2026-11-05). V30을 재생한 리뷰를 붙이면 목표는 0이다
 * - m2.1 0: M2.1 relay3-m21 묶음 50개(2026-11-05). 숨긴 시험이 실패한 묶음은 14의 둘이고 둘 다 자동 조건을 못 채웠다.
 *   M2.1 규약의 온라인 목표(0)와 같다
 */
const FALSE_AUTO_MAX: Record<string, number> = { m2: 3, 'm2.1': 0 }

/** 초안 정책: 스위치 꺼짐, 서버 보호 모름, 실적 없음, 초안 조건(V19) */
const POLICY: Policy = {
  auto_merge_enabled: false,
  conditions: [{ ...DRAFT_AUTO }],
  server: null,
  track_record_ok: {},
}

/**
 * M2의 리뷰는 요청을 보지 않았다. V30부터 관문은 request가 참이 아닌 끝난 리뷰를 사람 머지로 보내지만('리뷰가 요청을 보지
 * 않음'), 재생은 request를 참으로 두고 관문의 나머지를 잰다. 기록에 request가 있으면(V30 뒤의 묶음) 그 값을 쓴다. 요청
 * 대조의 효과는 리뷰 재생(m2.1-design 14절 O2)으로 따로 잰다
 */
const SAW_REQUEST = { request: true }

/**
 * V26: 지금 관문의 규칙 그대로(core raises. 구조/low는 메모, M2.1 0단계 뒤로는 request_gap도 메모). V4: raise가 있으면
 * 심각도와 상관없이 올림. V30-memo: V26에 더해 request_gap(V30)을 심각도와 상관없이 메모로 둔다. M2.1 0단계 O2가 기준을 넘지
 * 못해 배치 빌드가 쓴 규칙이다(M2.1 규약 6절). raises가 request_gap을 다시 올려도 M2.1 빌드를 흉내 내고, V30의 잡음을 센다
 */
type Rule = 'V4' | 'V26' | 'V30-memo'

/** 규약마다 평가 빌드가 쓴 올림 규칙. 묶음을 더한 규약은 여기에 적는다 */
const RECORDED_RULE: Record<string, Rule> = { m2: 'V4', 'm2.1': 'V30-memo' }

/** V4를 지금 관문으로 흉내 낸다: 지금 올림이 아닌 raise 지적(구조/low)의 심각도를 올림이 되는 medium으로 */
function asV4(f: ReviewFinding): ReviewFinding {
  return f.raise !== undefined && !raises(f) ? { ...f, severity: 'medium' } : f
}

/** V30-memo: raise가 request_gap인 지적은 raise를 지운다(메모. M2.1 규약 5.3의 '그 지적의 raise를 지운 묶음') */
function asMemo(f: ReviewFinding): ReviewFinding {
  if (f.raise !== 'request_gap') return f
  const memo = { ...f }
  delete memo.raise
  return memo
}

const RULES: Record<Rule, (f: ReviewFinding) => ReviewFinding> = {
  V4: asV4,
  V26: (f) => f,
  'V30-memo': asMemo,
}

const hasRequestGap = (b: ReplayBundle) =>
  b.evidence.review?.findings.some((f) => f.raise === 'request_gap') ?? false

/**
 * ratchets 'recorded': 평가 빌드의 래칫(태그 고침 앞). 'now': 자료를 만들 때 지금 코드로 다시 잰 래칫. 단위 브랜치의 내보내기는
 * 앱처럼 통합 증거를 함께 본다(V22, core gate의 whole). 통합 증거는 리뷰하지 않으므로 올림 규칙과 상관없다
 */
function replay(b: ReplayBundle, rule: Rule, ratchets: 'now' | 'recorded'): GateResult {
  const e = b.evidence
  const review: EvidenceBundle['review'] =
    e.review === null
      ? null
      : { ...SAW_REQUEST, ...e.review, findings: e.review.findings.map(RULES[rule]) }
  const recorded = ratchets === 'recorded' ? b.recorded_ratchets : undefined
  const w = b.integration
  const wRecorded = ratchets === 'recorded' ? b.recorded_integration_ratchets : undefined
  const whole: Integration | undefined =
    w === undefined || w.evidence === null || wRecorded === undefined
      ? w
      : { ...w, evidence: { ...w.evidence, ratchets: wRecorded } }
  return gate({ ...e, review, ratchets: recorded ?? e.ratchets }, b.contract, POLICY, e.head, whole)
}

const met = (g: GateResult) => g.condition !== null
const hasChangeLine = (b: ReplayBundle) =>
  b.contract?.lines.some((l) => l.kind === 'change') ?? false

describe('관문 재생 (V31)', () => {
  test('자료: 쪽마다 묶음이 있고 이름이 겹치지 않는다', () => {
    const names = BUNDLES.map(bundleName)
    expect(new Set(names).size).toBe(names.length)
    expect(new Set(BUNDLES.map((b) => b.arm))).toEqual(
      new Set(['relay3', 'relay3-noreview', 'relay3-handsoff', 'relay3-m21']),
    )
    // 단위 브랜치의 내보내기(V22)는 관문이 함께 본 통합 증거가 있다
    const unpaired = BUNDLES.filter((b) => (b.unit === undefined) !== (b.integration === undefined))
    expect(unpaired.map(bundleName)).toEqual([])
  })

  test('규약마다 평가 빌드의 올림 규칙, 거짓 자동 래칫, 실행 단위를 안다', () => {
    const unknown = PROTOCOLS.filter(
      (p) => !(p in RECORDED_RULE) || !(p in FALSE_AUTO_MAX) || !(p in RUN_MET),
    )
    expect(unknown).toEqual([])
  })

  test('입력을 바꾸지 않으면 평가 빌드가 기록한 결론이 그대로 다시 나온다', () => {
    const differs = BUNDLES.flatMap((b) => {
      const g = replay(b, RECORDED_RULE[b.protocol] ?? 'V26', 'recorded')
      const now = { conclusion: g.conclusion, condition: g.condition, shadow: g.shadow }
      return JSON.stringify(now) === JSON.stringify(b.recorded)
        ? []
        : [`${bundleName(b)}: 기록 ${JSON.stringify(b.recorded)}, 재생 ${JSON.stringify(now)}`]
    })
    expect(differs).toEqual([])
  })

  test('숨긴 시험이 실패했는데 자동 조건을 채운 묶음이 규약마다 래칫을 넘지 않는다 (G1·G2를 찍는다)', () => {
    const now = replayAll('V26')
    console.log(report(replayAll('V4'), now, replayAll('V30-memo')))
    const over = PROTOCOLS.flatMap((p) => {
      const names = falseAutos(now.filter((r) => r.b.protocol === p))
      const max = FALSE_AUTO_MAX[p] ?? 0
      return names.length > max ? [`${p}: ${names.length} > ${max} (${names.join(', ')})`] : []
    })
    expect(over).toEqual([])
  })
})

// ── 찍기 (npm run test:replay) ──────────────────────────────────────────────

interface Replayed {
  b: ReplayBundle
  g: GateResult
}

const PROTOCOLS = [...new Set(BUNDLES.map((b) => b.protocol))]

const replayAll = (rule: Rule): Replayed[] => BUNDLES.map((b) => ({ b, g: replay(b, rule, 'now') }))

const falseAutos = (rs: Replayed[]) =>
  rs.filter((r) => !r.b.hidden_pass && met(r.g)).map((r) => bundleName(r.b))

interface Row {
  pass: boolean
  met: boolean
}

const pct = (a: number, b: number) => (b === 0 ? '-' : `${Math.round((100 * a) / b)}% (${a}/${b})`)

function line(rule: string, unit: string, group: string, rows: Row[]): string {
  const auto = rows.filter((r) => r.met)
  const pass = rows.filter((r) => r.pass)
  const both = auto.filter((r) => r.pass).length
  const cells = [rule, unit, group, rows.length, pass.length, auto.length, auto.length - both]
  return `| ${cells.join(' | ')} | ${pct(both, auto.length)} | ${pct(both, pass.length)} |`
}

/** 실행 단위: 규약의 RUN_MET대로 실행의 내보내기 묶음 가운데 하나라도(any) 또는 모두(all) 채웠으면 그 실행이 채운 것 */
function byRun(rs: Replayed[]): Row[] {
  const runs = new Map<string, Replayed[]>()
  for (const r of rs) {
    const key = `${r.b.protocol}/${r.b.scenario}/${r.b.arm}-${r.b.run}`
    runs.set(key, [...(runs.get(key) ?? []), r])
  }
  return [...runs.values()].map((run) => {
    const first = run[0] as Replayed
    const all = runMet(first.b.protocol) === 'all'
    const metRun = all ? run.every((r) => met(r.g)) : run.some((r) => met(r.g))
    return { pass: first.b.hidden_pass, met: metRun }
  })
}

const kind = reasonKind

/**
 * V30의 온라인 잡음(M2.1 규약 5.3): 리뷰가 요청을 본(기록에 request가 참인) 묶음에서, request_gap을 메모로 본(V30-memo) 관문이
 * 자동 조건을 채운 숨긴 시험 실패 실행의 묶음이 분모, 그 가운데 리뷰에 raise가 request_gap인 지적이 있는 것이 분자다. 숨긴
 * 시험이 실패한 묶음마다 자동 조건과 request_gap을 붙인다
 */
function noise(memo: Replayed[]): string[] {
  const saw = memo.filter((r) => r.b.evidence.review?.request === true)
  const failed = saw.filter((r) => !r.b.hidden_pass)
  const den = failed.filter((r) => met(r.g))
  const num = den.filter((r) => hasRequestGap(r.b))
  const each = failed.map(({ b, g }) => {
    // 채운 조건이 없으면 조건마다 못 채운 까닭(gate의 '채운 자동 조건 없음' 뒤), 아니면 사람 머지 사실의 갈래
    const misses = g.decisive === '채운 자동 조건 없음' ? g.reasons.slice(1).join(', ') : ''
    const why = met(g) ? `자동 조건 ${g.condition}` : `못 채움: ${misses || kind(g.decisive)}`
    return `${bundleName(b)} (${why}, request_gap ${hasRequestGap(b) ? '있음' : '없음'})`
  })
  const rate = den.length === 0 ? `${num.length}/0 (분모 0: 모름)` : pct(num.length, den.length)
  return [
    `V30 잡음(요청을 본 리뷰의 묶음 ${saw.length}개, request_gap은 메모로 봄): ${rate}`,
    `  숨긴 시험이 실패한 묶음 ${failed.length}개: ${each.join(', ') || '-'}`,
  ]
}

function report(v4: Replayed[], v26: Replayed[], memo: Replayed[]): string {
  const conditions = POLICY.conditions.map((c) => c.id)
  const out = [
    `관문 재생 (V31): 묶음 ${BUNDLES.length}개, 초안 정책(조건 ${conditions.join(', ')}), 리뷰는 요청을 본 것으로 둠(기록에 있으면 그 값)`,
    '',
    '| 규칙 | 단위 | 나눔 | 수 | 숨긴 시험 통과 | 자동 조건 | 거짓 자동 | G1 | G2 |',
    '|---|---|---|---|---|---|---|---|---|',
  ]
  const arms = [...new Set(BUNDLES.map((b) => b.arm))].sort()
  const rows = (rs: Replayed[], condition?: string): Row[] =>
    rs.map(({ b, g }) => ({
      pass: b.hidden_pass,
      met: condition === undefined ? met(g) : g.condition === condition,
    }))
  for (const [rule, rs] of [
    ['V4', v4],
    ['V26', v26],
  ] as const) {
    out.push(line(rule, '묶음', '모두', rows(rs)))
    for (const c of conditions) out.push(line(rule, '묶음', `조건 ${c}`, rows(rs, c)))
    out.push(line(rule, '묶음', '바뀜 줄 있음', rows(rs.filter((r) => hasChangeLine(r.b)))))
    out.push(line(rule, '묶음', '바뀜 줄 없음', rows(rs.filter((r) => !hasChangeLine(r.b)))))
    for (const arm of arms)
      out.push(line(rule, '묶음', arm, rows(rs.filter((r) => r.b.arm === arm))))
    for (const arm of arms)
      out.push(line(rule, '실행', arm, byRun(rs.filter((r) => r.b.arm === arm))))
  }
  const falseAuto = PROTOCOLS.map((p) => {
    const names = falseAutos(v26.filter((r) => r.b.protocol === p))
    return `${p} ${names.length}개(래칫 ${FALSE_AUTO_MAX[p] ?? 0}): ${names.join(', ') || '-'}`
  })
  // V26의 끄는 조건: 거짓 자동 가운데 V4(구조/low도 올림)였으면 막혔을 것
  const lowOnly = v26
    .filter((r, i) => !r.b.hidden_pass && met(r.g) && !met((v4[i] as Replayed).g))
    .map((r) => bundleName(r.b))
  const fixed = v26.filter((r) => r.b.recorded_ratchets !== undefined)
  const why = new Map<string, number>()
  for (const { g } of v26.filter((r) => !met(r.g))) {
    for (const k of new Set(g.reasons.map(kind))) why.set(k, (why.get(k) ?? 0) + 1)
  }
  const whyText = [...why].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`)
  out.push(
    '',
    `거짓 자동(V26) 규약마다: ${falseAuto.join('; ')}`,
    `구조/low 지적만 막을 수 있었던 거짓 자동(V26의 끄는 조건) ${lowOnly.length}개: ${lowOnly.join(', ') || '-'}`,
    `시험 수 래칫을 지금 코드로 다시 잰 묶음 ${fixed.length}개, 그 가운데 자동 조건(V26) ${fixed.filter((r) => met(r.g)).length}개`,
    `자동 조건을 못 채운 묶음의 까닭(V26, 묶음마다 갈래 하나씩): ${whyText.join(', ')}`,
    ...noise(memo),
  )
  return out.join('\n')
}

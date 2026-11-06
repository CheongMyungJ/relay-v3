// 실적의 글 (M4c, docs/m4-design.md 5.2). 설정 대화상자의 [실적](RecordTable.tsx)과 [증거]의 그림자 줄. 숫자는 늘 k/n이고
// Wilson 하한을 곁들인다. 사건 0건은 '0/n (위 한계 약 3/n)'(3의 규칙). 진행 막대·'M5까지 몇 건'·남은 주는 만들지 않는다.

import type { GateResult } from '../../core/types.ts'
import type {
  AfterStats,
  ConditionStats,
  ControlStats,
  EpochView,
  RecordStats,
  ShadowEnd,
} from '../../shared/api.ts'

const MISS: Record<keyof ConditionStats['miss'], string> = {
  more_session: '세션이 더 고침',
  more_human: '사람이 더 고침',
  more_unknown: '그 head 뒤에 더 커밋함',
  closed: '닫음',
  discarded: '버림',
  unknown_change: '같은 변경인지 모름',
}

const OUTSIDE: Record<keyof ConditionStats['outside'], string> = {
  open: '열림',
  stale: '낡음(14일)',
  lost: '추적 잃음(90일)',
  policy: '정책 머지',
  preapproved: '미리 승인',
  other_epoch: '판 다름',
}

/**
 * [증거]의 그림자 줄(Q6): 그림자 결론의 표본은 끝(머지·닫힘·버림)이 정해질 때까지 가린다. 머지 전에 '자동이었으면 머지했을
 * 것'을 본 사람이 그 head를 머지하면 일치가 부풀기 때문이다. 끝난 뒤 '그림자 표본: 일치'나 '불일치(갈래)'
 */
export function shadowLine(g: GateResult, end: ShadowEnd | undefined): string | null {
  if (!g.shadow || !end) return null
  const conds = end.conditions.length > 0 ? ` (조건 ${end.conditions.join(', ')})` : ''
  if (end.result === 'match') return `그림자 표본: 일치${conds}`
  return `그림자 표본: 불일치(${end.why ? MISS[end.why] : '모름'})${conds}`
}

const pct = (x: number) => x.toFixed(2)

/** 'k/n (하한 0.45)'. n이 0이면 '0/0' */
export function ratio(k: number, n: number, low: number | null): string {
  return low === null ? `${k}/${n}` : `${k}/${n} (하한 ${pct(low)})`
}

/** 갈래가 0이 아닌 것만 '이름 수' */
function parts<K extends string>(counts: Record<K, number>, names: Record<K, string>): string {
  const xs = (Object.keys(names) as K[]).filter((k) => counts[k] > 0)
  return xs.length === 0 ? '없음' : xs.map((k) => `${names[k]} ${counts[k]}`).join(', ')
}

export function missText(s: ConditionStats): string {
  return parts(s.miss, MISS)
}

export function outsideText(s: ConditionStats): string {
  return parts(s.outside, OUTSIDE)
}

/** 머지 뒤 30일: '창 닫힘 4, 지켜보는 중 5: 되돌림 0, main 실패 귀속 0, 미정 1' (0이면 위 한계) */
export function afterText(a: AfterStats): string {
  if (a.merges === 0) return '머지 뒤: 머지 없음'
  const upper = a.upper === null ? '' : ` (위 한계 약 ${pct(a.upper)})`
  const more = [
    a.main.inherited > 0 ? `물려받음 ${a.main.inherited}` : '',
    a.main.unknown > 0 ? `모름 ${a.main.unknown}` : '',
    a.unmeasurable > 0 ? `잴 수 없음 ${a.unmeasurable}` : '',
    a.disputed > 0 ? `이의로 뺌 ${a.disputed}` : '',
  ].filter(Boolean)
  return (
    `머지 뒤(창 닫힘 ${a.closed}, 지켜보는 중 ${a.watching}): 되돌림 ${a.reverts}, ` +
    `main 실패 귀속 ${a.main.attributed}, 미정 ${a.main.pending}${upper}` +
    (more.length > 0 ? ` · ${more.join(', ')}` : '')
  )
}

export function controlText(c: ControlStats): string {
  return `그대로 머지 ${c.as_is}/${c.n} · ${afterText(c.after)}`
}

/** '모델 claude-…, effort medium, Claude Code 2.4, 관문 판 1, 리뷰 프롬프트 4' */
export function epochText(e: EpochView | null): string {
  if (!e) return '판 모름'
  const v = (x: string | number | null) => (x === null ? '모름' : String(x))
  return `모델 ${v(e.model)}, effort ${v(e.effort)}, Claude Code ${v(e.claude)}, 관문 판 ${v(e.gate_epoch)}, 리뷰 프롬프트 ${v(e.review_prompt)}`
}

/** 조건 한 줄의 머리: 'small (a1b2c3) · 일치 7/9 (하한 0.45)' */
export function conditionHead(s: ConditionStats): string {
  const hash = s.cond_hash ? ` (${s.cond_hash.slice(0, 6)})` : ''
  return `${s.id}${hash} · 일치 ${ratio(s.match, s.n, s.wilson_low)}`
}

/** 조건 한 줄의 나머지 */
export function conditionRest(s: ConditionStats): string[] {
  const lift = s.lift === null ? '모름' : `${s.lift >= 0 ? '+' : ''}${pct(s.lift)}`
  return [
    `불일치: ${missText(s)}`,
    `분모 밖: ${outsideText(s)}`,
    afterText(s.after),
    `비교군(이 조건을 못 채움): ${controlText(s.control)} · lift ${lift}`,
    `같은 Work로 함께 센 표본 ${s.correlated} · 30일 동안 내보내기 ${s.inflow.exports_30d}, 이 조건 ${s.inflow.met_30d}`,
  ]
}

/** 표의 아래 줄: 판 칸을 모르는 결론 줄과 깨진 장부 줄 */
export function footText(r: RecordStats): string {
  return `판을 모르는 결론 줄 ${r.unknown_epoch.lines}/${r.unknown_epoch.of} · 읽지 못한 장부 줄 ${r.broken}`
}

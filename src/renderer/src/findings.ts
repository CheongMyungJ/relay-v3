// 리뷰 지적의 올림과 메모 (V26), 쉬는 세션에 준 되먹임(V24) (docs/m2-modules.md 4절). DOM을 쓰지 않는 순수 함수만 둔다.
// 렌더러는 core를 'import type'으로만 가져오므로 core review.ts `raises`의 규칙을 여기에 다시 쓴다. [단위]가 둘을 견준다.
// 지적의 갈래(세션 몫, 사람 몫)는 메인이 WorkView.feedback에 담아 준다.

import type { RaiseReason, ReviewFinding } from '../../core/types.ts'
import type { WorkView } from '../../shared/api.ts'

/** 지적의 갈래 이름(core gate의 '리뷰 올림(…)'과 같은 이름) */
export const RAISE_LABEL: Record<RaiseReason, string> = {
  example_test_mismatch: '예시와 시험 불일치',
  security: '보안',
  out_of_contract: '계약 밖 변경',
  structure: '구조',
  request_gap: '요청과 어긋남',
}

/**
 * 올림인가(V26): 보안, 예시와 시험 불일치, 계약 밖 변경은 심각도와 상관없이, 구조는 medium과 high만. 구조/low, 요청과
 * 어긋남(V30, M2.1 0단계 O2에서 메모로 내림), raise가 없는 지적은 메모다. 모르는 갈래나 심각도는 올림이다(core와 같이
 * 엄격한 쪽)
 */
export function raisesFinding(f: Pick<ReviewFinding, 'raise' | 'severity'>): boolean {
  if (f.raise === undefined || f.raise === 'request_gap') return false
  return f.raise !== 'structure' || f.severity !== 'low'
}

/** [리뷰 지적]을 올림(관문이 사람에게 보내는 사실)과 메모(관문 사실이 아님)로 나눈다. 각자 리뷰어가 낸 차례 그대로 */
export function findingGroups(findings: ReviewFinding[]): {
  raised: ReviewFinding[]
  notes: ReviewFinding[]
} {
  return {
    raised: findings.filter(raisesFinding),
    notes: findings.filter((f) => !raisesFinding(f)),
  }
}

/** 지적의 갈래 이름. 갈래가 없으면 null, 모르는 갈래는 그 값 그대로 */
export function raiseLabel(f: Pick<ReviewFinding, 'raise'>): string | null {
  if (f.raise === undefined) return null
  return Object.hasOwn(RAISE_LABEL, f.raise) ? RAISE_LABEL[f.raise] : String(f.raise)
}

/**
 * [증거]의 되먹임 상태 한 줄(V24). 보내지 않은 세션 몫이 있으면 그 까닭(상한, 사람 몫의 올림, 입력 칸에 쓰다 둔 글, 사람이
 * 최근 입력함, 세션이 일하는 중), 아니면 지금 HEAD에 마지막으로 보낸 되먹임, 아니면 Work에서 보낸 라운드 수. 끝내기가
 * 걸렸거나 상자가 떠 있으면 보내지 않은 것은 말하지 않는다(상자에서 정한다). 보낸 것도 없고 보낼 것도 없으면 null
 */
export function feedbackStatus(
  v: Pick<WorkView, 'feedback' | 'endPending' | 'state'>,
): string | null {
  const f = v.feedback
  const rounds = `세션에 보낸 되먹임 ${f.rounds}/${f.max}`
  const held = `세션 몫 사실 ${f.pending}개를 보내지 않았습니다`
  if (f.held === 'cap')
    return `되먹임 상한(${f.rounds}/${f.max})에 닿아 ${held}. 리뷰 지적은 [세션에 넘기기]로 보낼 수 있습니다`
  if (f.pending > 0 && v.endPending === null && v.state === 'working') {
    if (f.held === 'human_findings')
      return `사람 몫의 리뷰 올림이 있어 ${held}: 지적을 보고 [세션에 넘기기]로 보내거나 터미널에서 말하세요 (${rounds})`
    if (f.held === 'draft')
      return `${held}: 터미널 입력 칸에 쓰다 둔 글이 있을 수 있습니다. 그 글을 보내면(Enter) 1분 뒤 세션이 쉬고 있을 때 보냅니다 (${rounds})`
    if (f.held === 'human_input')
      return `${held}: 최근 터미널에 입력했으니 1분 동안 입력이 없고 세션이 쉬고 있을 때 보냅니다 (${rounds})`
    return `세션 몫 사실 ${f.pending}개: 세션이 쉬면 보냅니다 (${rounds})`
  }
  const last = f.sent.at(-1)
  if (last) {
    const what = [
      ...(last.facts > 0 ? [`사실 ${last.facts}개`] : []),
      ...(last.findings > 0 ? [`리뷰 지적 ${last.findings}개`] : []),
    ].join(', ')
    const who = last.by === 'human' ? '사람이 세션에 넘김' : `세션에 보냄(${f.rounds}/${f.max})`
    return `${who} · 되먹임 ${last.n}: ${what}`
  }
  return f.rounds > 0 ? rounds : null
}

/** 지적 하나의 되먹임 표시(V24): 보냄, 세션 몫(쉬면 저절로 감), 사람 몫([세션에 넘기기]). 지금 HEAD의 묶음이 아니면 null */
export function findingRoute(
  v: Pick<WorkView, 'feedback'>,
  f: Pick<ReviewFinding, 'id'>,
): 'sent' | 'session' | 'human' | null {
  const r = v.feedback.findings[f.id]
  if (r === undefined) return null
  return r.sent ? 'sent' : r.route
}

/**
 * 사람이 이 지적을 [세션에 넘기기]로 보낼 수 있나(V24): 이 head에 아직 보내지 않았고, 사람 몫이거나 저절로 가지 않는 세션
 * 몫이다(라운드 상한, 사람 몫의 올림이 막음, [끝내기]가 걸렸거나 상자가 떠 있음)
 */
export function passable(
  v: Pick<WorkView, 'feedback' | 'endPending'>,
  f: Pick<ReviewFinding, 'id'>,
): boolean {
  const route = findingRoute(v, f)
  if (route !== 'session') return route === 'human'
  const held = v.feedback.held
  return held === 'cap' || held === 'human_findings' || v.endPending !== null
}

/**
 * [끝내기] 상자의 [세션에 넘기기]가 보낼 지적 id(V24): 지금 HEAD의 올림 가운데 넘길 수 있는 것(passable). 상자의 열린 것에
 * 보이는 지적이다: 상자가 떠 있는 동안은 세션 몫도 저절로 가지 않는다
 */
export function passableFindings(
  v: Pick<WorkView, 'feedback' | 'evidence' | 'endPending'>,
): string[] {
  const findings = v.evidence?.review?.findings ?? []
  return findings.filter((f) => raisesFinding(f) && passable(v, f)).map((f) => f.id)
}

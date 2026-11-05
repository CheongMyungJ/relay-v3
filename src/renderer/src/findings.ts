// 리뷰 지적의 올림과 메모 (V26, docs/m2-modules.md 4절). DOM을 쓰지 않는 순수 함수만 둔다.
// 렌더러는 core를 'import type'으로만 가져오므로 core review.ts `raises`의 규칙을 여기에 다시 쓴다. [단위]가 둘을 견준다.

import type { RaiseReason, ReviewFinding } from '../../core/types.ts'

/** 지적의 갈래 이름(core gate의 '리뷰 올림(…)'과 같은 이름) */
export const RAISE_LABEL: Record<RaiseReason, string> = {
  example_test_mismatch: '예시와 시험 불일치',
  security: '보안',
  out_of_contract: '계약 밖 변경',
  structure: '구조',
}

/**
 * 올림인가(V26): 보안, 예시와 시험 불일치, 계약 밖 변경은 심각도와 상관없이, 구조는 medium과 high만. 구조/low와 raise가 없는
 * 지적은 메모다. 모르는 갈래나 심각도는 올림이다(core와 같이 엄격한 쪽)
 */
export function raisesFinding(f: Pick<ReviewFinding, 'raise' | 'severity'>): boolean {
  if (f.raise === undefined) return false
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

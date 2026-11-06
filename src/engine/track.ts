// 그림자 실적의 순수한 셈 (M4, docs/m4-design.md 3절·5절). 관문(core gate)은 바꾸지 않고 그 결과를 조건마다 읽는다.
// M4a: 채운 조건 전부(conditionsMet)와 조건 정의의 hash(condHashes). 내보내기 결론 줄(main/works-exports.ts exportLine)이
// met과 conds로 적는다. 이 파일은 관문 판의 파일(test/fixtures/gate-version.json)이다: 바꾸면 GATE_VERSION을 올린다.

import { stableJson } from '../core/contract.ts'
import { gate } from '../core/gate.ts'
import { qualityHash } from '../core/quality.ts'
import type { AutoCondition, Contract, EvidenceBundle, Integration, Policy } from '../core/types.ts'

/** 조건 hash의 길이(안정 JSON의 FNV-1a 64비트 16진수 앞 12자) */
const COND_HASH_LENGTH = 12

/**
 * 채운 조건 전부(정책의 차례). gate는 처음 채운 조건 하나만 돌려주므로 조건마다 그 조건 하나만 둔 정책으로 부르고, 결과의
 * condition이 그 조건인 것을 모은다. 계약 다시나 사람에게 보낼 사실이 있으면 모든 부름이 condition null이라 빈다. 스위치·서버
 * 보호·실적은 condition을 바꾸지 않는다(그림자도 condition을 적는다)
 */
export function conditionsMet(
  evidence: EvidenceBundle,
  contract: Contract | null,
  policy: Policy,
  head: string | null,
  whole?: Integration,
): string[] {
  return policy.conditions
    .filter(
      (c) =>
        gate(evidence, contract, { ...policy, conditions: [c] }, head, whole).condition === c.id,
    )
    .map((c) => c.id)
}

/**
 * 조건 id → 조건 정의의 안정 JSON hash 앞 12자(core contractHash와 같은 hash). 같은 id라도 정의(예: small의 줄 수 상한)가
 * 바뀌면 다른 조건이다. id가 겹치면 뒤의 것(관문은 앞의 것을 먼저 보지만 조건마다 부르는 conditionsMet은 둘 다 본다)
 */
export function condHashes(conditions: readonly AutoCondition[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const c of conditions) out[c.id] = qualityHash(stableJson(c)).slice(0, COND_HASH_LENGTH)
  return out
}

// 받아들인 나빠짐의 빚 확인(M3b, docs/m3-design.md 3절, V40)의 글. format.ts가 600줄을 넘지 않게 나눴다.
// [머지]와 [그래도 끝내기]는 Work 브랜치의 내보내기 증거(지금 HEAD의 것)에 나빠진 래칫이 있고 아직 빚으로 기록하지 않았으면
// 한 번 묻는다: [빚으로 남기고 …] / [그냥 …]. 이 diff가 이미 둔 빚이 모두 덮은 래칫은 묻지 않는다. 장치(view.m3.debt)가 꺼졌거나 branch_per_unit(V22)이면 묻지 않는다.

import type { DebtPayoff, EvidenceBundle } from '../../core/types.ts'
import type { WorkView } from '../../shared/api.ts'

/** 물을 래칫(한 줄씩 'id (detail)'). 묻지 않으면 null */
export function debtAsk(
  v: Pick<WorkView, 'm3' | 'exports' | 'evidence' | 'head'>,
): string[] | null {
  const e = v.evidence
  if (!v.m3.debt || v.exports.length > 0 || e === null || e.debt_commit) return null
  if (v.head !== null && e.head !== v.head) return null
  // 이 diff가 이미 둔 빚이 모두 덮은 래칫(debt_covered)은 다시 묻지 않는다
  const covered = e.debt_covered?.ratchets ?? []
  const worse = e.ratchets.filter((r) => r.status === 'worse' && !covered.includes(r.id))
  return worse.length === 0 ? null : worse.map((r) => `${r.id} (${r.detail})`)
}

export type DebtVerb = '머지' | '끝내기'

/** 확인의 글과 단추 */
export function debtTexts(
  asks: string[],
  verb: DebtVerb,
): { title: string; record: string; skip: string; note: string } {
  const what = asks.length === 1 ? `래칫 ${asks[0] ?? ''}` : `래칫 ${asks.length}개`
  return {
    title: `${what}가 나빠졌습니다. 빚으로 남기고 ${verb === '머지' ? '머지할까요' : '끝낼까요'}?`,
    record: `빚으로 남기고 ${verb}`,
    skip: `그냥 ${verb}`,
    note:
      '빚으로 남기면 relay가 .relay/debt/에 항목을 커밋하고(열린 PR이 있으면 push) 다음 Work가 갚을 수 있게 둡니다. ' +
      '그냥 하면 막지 않고 장부에 받아들였지만 기록하지 않은 것으로 셉니다.',
  }
}

/** 증거의 빚 기록 커밋(다시 재지 않고 옮긴 묶음): 짧은 글(잰 head)과 풀어 쓴 글(빚 id). 없으면 null */
export function debtCommitText(
  e: Pick<EvidenceBundle, 'debt_commit'>,
): { text: string; title: string } | null {
  const d = e.debt_commit
  if (!d) return null
  return {
    text: `빚 기록 커밋(잰 ${d.from.slice(0, 7)})`,
    title: `relay가 잰 head ${d.from.slice(0, 7)} 위에 빚 ${d.items.length}개(${d.items.join(', ')})를 커밋했습니다. .relay/debt/만 더해 다시 재지 않았습니다.`,
  }
}

/** [계약] 위의 기록 안 된 나빠짐(Work를 만들 때 찾음). 없으면 null */
export function unrecordedText(v: Pick<WorkView, 'unrecorded'>): string | null {
  if (v.unrecorded.length === 0) return null
  return '앞 기록 뒤로 기준 브랜치에 래칫이 나빠진 채 들어왔고 빚으로 적히지 않았습니다. 세션에게도 요청 글 끝에 알렸습니다.'
}

type Tidy = NonNullable<EvidenceBundle['tidy']>

/**
 * 곁들일 정리(M3c)의 [증거] 칸: 갚은 빚(계약 tidy이든 아니든), 못 갚은 빚(계약 tidy인데 갚지 않았거나 가르지 못함), 건드린
 * 곳의 빚(계약 tidy가 아닌데 이 diff가 바꾼 경로에 닿고 갚지 않음), 정리 몫이 상한을 넘었나(계약 tidy가 있을 때만). 알림이다
 */
export function tidyGroups(t: Tidy): {
  paid: DebtPayoff[]
  unpaid: DebtPayoff[]
  touched: DebtPayoff[]
  over: boolean
} {
  const taken = new Set(t.taken)
  return {
    paid: t.items.filter((i) => i.status === 'paid'),
    unpaid: t.items.filter((i) => taken.has(i.id) && i.status !== 'paid'),
    touched: t.items.filter((i) => !taken.has(i.id) && i.status !== 'paid'),
    over: t.taken.length > 0 && t.lines > t.max,
  }
}

/** 정리 몫 한 줄. 계약 tidy가 없으면 null */
export function tidyLinesText(t: Tidy): string | null {
  if (t.taken.length === 0) return null
  const head = `곁들일 정리 ${t.taken.length}개 · 정리 몫 ${t.lines}줄 (상한 ${t.max}줄`
  return t.lines > t.max ? `${head}을 넘음)` : `${head})`
}

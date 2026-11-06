// 받아들인 나빠짐의 빚 기록 (M3b, docs/m3-design.md 3절, V40). [머지](works-exports.ts)와 [그래도 끝내기](works-end.ts)가
// 부른다. 사람이 확인에서 [빚으로 남기고 …]를 고르면 Work 브랜치의 내보내기 묶음에서 나빠진 래칫마다 core debtFromRatchet의
// 항목을 .relay/debt/<id>.md로 Work 브랜치에 커밋한다(작성자 relay, 트레일러 Relay-Work·Relay-Debt. worktree의 다른 변경은
// 건드리지 않는다). 이 커밋은 .relay/debt/만 더하므로 다시 재지 않고 묶음을 그 커밋으로 옮겨 debt_commit에 적는다(관문의
// 결론은 그대로: 래칫 나빠짐은 사람 머지 사실). 열린 PR이 있으면 push한다. 장치(WorkRecord.m3.debt)가 꺼졌거나
// branch_per_unit(V22)이면 기록하지 않는다: 장부에는 '받아들였지만 기록하지 않음'으로 남는다.

import { commitFiles, pushBranch } from '../adapters/git-write.ts'
import { evidencePath, repoKey, writeJson } from '../adapters/store.ts'
import type { LedgerEntry } from '../core/ledger.ts'
import type { EvidenceBundle } from '../core/types.ts'
import { debtAt, debtFiles, debtMessage, RELAY_AUTHOR, worseOf } from '../engine/debt-record.ts'
import type { ExportRecord, WorkRecord } from './store.ts'
import { perUnit, type WorkCtx, workHead } from './works-types.ts'

/** 이 내보내기의 묶음이 기록할 빚을 지녔나: 장치가 켜졌고, one_branch이고, 나빠진 래칫이 있고, 아직 기록하지 않았다 */
export function debtable(rec: WorkRecord, x: ExportRecord, b: EvidenceBundle | undefined): boolean {
  return (
    rec.m3.debt &&
    !perUnit(rec) &&
    x.unit === null &&
    b !== undefined &&
    !b.debt_commit &&
    worseOf(b.ratchets).length > 0
  )
}

/** 장부 줄의 accepted 칸: 묶음의 나빠진 래칫과 기록한 빚(없으면 빈 것). 나빠진 래칫이 없으면 칸이 없다 */
export function acceptedOf(b: EvidenceBundle | undefined): Pick<LedgerEntry, 'accepted'> {
  const worse = b ? worseOf(b.ratchets) : []
  if (worse.length === 0) return {}
  return { accepted: { ratchets: worse.map((r) => r.id), debt: b?.debt_commit?.items ?? [] } }
}

/**
 * 빚을 기록한다(one_branch의 Work 브랜치). 묶음의 head가 지금 Work 브랜치의 끝이고 재는 중이 아닐 때만. 묶음을 새 커밋으로
 * 옮기고(debt_commit), 열린 PR이 있으면 push한 뒤 HEAD를 화면에 둔다. 새 head를 돌려준다. 기록할 것이 없으면 null
 */
export async function recordDebt(
  ctx: WorkCtx,
  rec: WorkRecord,
  x: ExportRecord,
): Promise<string | null> {
  const rt = ctx.runtime(rec.id)
  const b = rt.bundles.get(x.branch)
  if (!b || !debtable(rec, x, b)) return null
  if (rt.measuring !== null || rt.pending !== null)
    throw new Error('증거를 재는 중: 끝난 뒤 다시 하세요')
  const head = await workHead(rec)
  if (head !== b.head) throw new Error('증거를 잰 뒤 HEAD가 바뀜: 증거를 다시 재세요')
  const worse = worseOf(b.ratchets)
  const { ids } = await debtAt(rec.worktree, head)
  const { items, files } = debtFiles(worse, x.pr?.url ?? rec.id, ctx.deps.now(), ids)
  const sha = await commitFiles(rec.worktree, {
    branch: rec.branch,
    expect: head,
    files,
    message: debtMessage(rec.id, worse, items),
    author: RELAY_AUTHOR,
    worktree: rec.worktree,
  })
  const moved: EvidenceBundle = {
    ...b,
    head: sha,
    debt_commit: { from: head, items: items.map((i) => i.id) },
  }
  rt.bundles.set(x.branch, moved)
  if (x.exported_head === head) x.exported_head = sha
  x.evidence_path = evidencePath(ctx.deps.store.home, repoKey(moved.repo), sha)
  await writeJson(x.evidence_path, moved)
  await ctx.save(rec)
  const push = x.pr?.state === 'OPEN'
  ctx.note(rec.id, {
    type: 'debt_recorded',
    from: head,
    head: sha,
    items: items.map((i) => i.id),
    push,
  })
  await ctx.seeHead(rec.id, sha)
  if (push) await pushBranch(rec.worktree, rec.branch)
  return sha
}

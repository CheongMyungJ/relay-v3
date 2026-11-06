// 끝까지 따라가기의 순수한 셈 (M4b, docs/m4-design.md 4절). main/works-record.ts가 장부에서 끝이 정해지지 않은 내보내기를
// 고르고(unsettled), 거울에서 읽은 사실로 머지된 head가 내보낸 head와 같은 변경인지 정한다(sameChange). 관문 판의 파일이
// 아니다(engine/track.ts에 두면 GATE_VERSION을 올려야 한다): 결론을 바꾸지 않고 끝 줄만 쓴다.

import type { Conclusion } from '../core/types.ts'
import { RELAY_AUTHOR } from './debt-record.ts'
import { exportKey, type LedgerEntry } from './ledger.ts'

/** PR 없이 [끝내기]한 내보내기의 head가 기준에 닿기를 보는 날 수(m4-design 4.2, Q8) */
export const NO_PR_DAYS = 90

const DAY_MS = 24 * 60 * 60 * 1000

/** 끝 줄(머지, 닫힘, PR 없이 끝남·버림)인가 */
export const isFateLine = (e: LedgerEntry): boolean =>
  e.merged_head !== undefined || e.closed === true || e.ended !== undefined

/** 내보내기 결론 줄인가: 끝 줄도 [그래도 끝내기]의 받아들임 줄(M3b)도 아니다 */
export const isConclusionLine = (e: LedgerEntry): boolean => !isFateLine(e) && !e.accepted

/** 끝이 정해지지 않은 내보내기 하나 */
export interface Unsettled {
  work: string
  /** 내보내기의 단위(V22). Work 브랜치의 내보내기는 null */
  export: string | null
  /** 마지막 결론 줄 */
  last: LedgerEntry
  /** 첫 결론 줄의 때 */
  since: string
  /** PR 없이 끝남(no_pr) 줄의 때. 없으면 null */
  noPrAt: string | null
}

/**
 * 이 프로젝트에서 결론 줄이 있는데 끝이 정해지지 않은 내보내기(장부의 차례): 머지·닫힘·버림·unmerged 줄이 없는 것. PR 없이
 * 끝난(no_pr) 것은 그 때를 함께 준다(아직 기준에 닿는지 본다)
 */
export function unsettled(entries: LedgerEntry[], project: string): Unsettled[] {
  const out = new Map<string, Unsettled>()
  const done = new Set<string>()
  for (const e of entries) {
    if (e.project !== project) continue
    const key = exportKey(e)
    if (isConclusionLine(e)) {
      const u = out.get(key)
      out.set(key, {
        work: e.work,
        export: e.export ?? null,
        last: e,
        since: u?.since ?? e.ts,
        noPrAt: u?.noPrAt ?? null,
      })
    } else if (e.ended === 'no_pr') {
      const u = out.get(key)
      if (u && u.noPrAt === null) u.noPrAt = e.ts
    } else if (isFateLine(e)) done.add(key)
  }
  return [...out].filter(([key]) => !done.has(key)).map(([, u]) => u)
}

/** 이 내보내기의 마지막 결론 줄(끝 줄의 head가 된다). 없으면 undefined */
export function lastConclusion(
  entries: LedgerEntry[],
  work: string,
  unit: string | null,
): LedgerEntry | undefined {
  return entries.findLast(
    (e) => e.work === work && (e.export ?? null) === unit && isConclusionLine(e),
  )
}

/** 이 내보내기의 결론 줄 head(나온 차례, 겹치지 않게). 끝 줄의 앞 head 갈래(M4e after_heads)를 고른다 */
export function exportHeads(
  entries: readonly LedgerEntry[],
  work: string,
  unit: string | null,
): string[] {
  const out: string[] = []
  for (const e of entries)
    if (
      e.work === work &&
      (e.export ?? null) === unit &&
      isConclusionLine(e) &&
      !out.includes(e.head)
    )
      out.push(e.head)
  return out
}

/** PR 없이 끝난 때(no_pr)에서 NO_PR_DAYS가 지났나. 때를 읽지 못하면 거짓(끝을 정하지 않는다) */
export function noPrExpired(noPrAt: string, now: string): boolean {
  const from = Date.parse(noPrAt)
  const to = Date.parse(now)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return false
  return to - from > NO_PR_DAYS * DAY_MS
}

/** head..merged 사이의 커밋 하나(거울에서 읽음) */
export interface BetweenCommit {
  sha: string
  /** 작성자 이메일 */
  author: string
  /** 깨끗한 기준 맞춤 머지: 부모 둘 가운데 하나가 기준 브랜치에 있고 tree가 `git merge-tree --write-tree`의 결과와 같다 */
  baseUpdate: boolean
  /** 메시지의 Relay-Work 트레일러 값(M4e 커밋 가르기, engine/session-commits.ts) */
  trailers?: string[]
}

/** 같은 변경을 가르는 사실(main/works-record.ts가 거울에서 읽는다). 못 읽은 칸은 null */
export interface ChangeFacts {
  /** 내보낸 head(그 내보내기의 마지막 결론 줄) */
  head: string
  /** 머지된 PR의 head */
  merged: string
  /** head가 merged의 조상인가 */
  ancestor: boolean | null
  /** ancestor면 head..merged의 커밋 */
  between: BetweenCommit[] | null
  /** `git diff <base_sha>..<head>`와 `git diff <mb'>..<merged>`의 `git patch-id --stable` */
  patch: { head: string | null; merged: string | null }
}

/**
 * 머지된 head가 내보낸 head와 같은 변경인가(m4-design 4.3). 차례대로: (1) 같은 SHA. (2) head가 merged의 조상이고 사이 커밋이
 * 모두 relay 빚 커밋(작성자 relay@localhost, V40)이거나 깨끗한 기준 맞춤 머지(GitHub Update branch). (3) patch-id가 같음(rebase로
 * 맞춤, squash). (4) 사이에 다른 커밋이 있거나 patch-id가 다르면 다르다. (5) 그 밖(객체를 못 읽음)은 null: 모름(일치로 세지
 * 않는다)
 */
export function sameChange(f: ChangeFacts): boolean | null {
  if (f.head === f.merged) return true
  const between = f.ancestor === true ? f.between : null
  if (between?.every((c) => c.author === RELAY_AUTHOR.email || c.baseUpdate)) return true
  const { head, merged } = f.patch
  if (head !== null && head === merged) return true
  if (between !== null) return false
  if (head !== null && merged !== null) return false
  return null
}

/** 끝 줄의 결론 칸: 마지막 결론 줄의 결론(실적에 다시 세지 않게 condition은 비우고 shadow는 거짓) */
export const fateResult = (
  last: LedgerEntry | undefined,
): { conclusion: Conclusion; condition: null; shadow: false } => ({
  conclusion: last?.conclusion ?? 'human_merge',
  condition: null,
  shadow: false,
})

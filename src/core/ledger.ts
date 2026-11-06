// 실적 장부 (그림자, V3, docs/m2-modules.md 1절 ledger.ts). $RELAY_HOME/ledger.jsonl에 관문 결론마다 한 줄.
// 머지·닫힘은 그 Work(V22: 그 내보내기)의 줄(같은 줄을 고쳐 쓰거나 새 줄)에 by, merged_head, closed로 남는다.
// 실적은 조건마다 '자동이었으면 머지했을 head를 사람이 그대로 머지했나'다. 버전이 바뀌면 다시 잰다(philosophy 원칙 4).

import type { Conclusion, RatchetResult } from './types.ts'

export interface LedgerEntry {
  ts: string
  project: string
  work: string
  head: string
  conclusion: Conclusion
  condition: string | null
  shadow: boolean
  /** 머지했으면 누가. human-override는 앱 밖(GitHub)에서 머지함 */
  by?: 'human' | 'policy' | 'human-override'
  merged_head?: string
  closed?: boolean
  /** 내보내기(V22, branch_per_unit)의 단위. 없으면 Work 브랜치의 내보내기(one_branch, V22 앞의 기록) */
  export?: string
  model?: string
  claude_version?: string
  relay_version: string
  /** 내보내기 결론 줄(M3b): 이 head의 나빠진 래칫. 다음 Work가 기록 안 된 나빠짐을 찾는 앞 기록이다 */
  worse?: RatchetResult[]
  /** 사람이 나빠진 래칫을 받아들여 머지하거나 끝냄(M3b): 그 래칫 id와 기록한 빚 id(비면 기록하지 않음) */
  accepted?: { ratchets: string[]; debt: string[] }
}

/** 일치율 기준 */
const MATCH_RATE = 0.95

const CONCLUSIONS: readonly Conclusion[] = ['human_merge', 'auto_merge_candidate', 'recontract']
const BY: readonly NonNullable<LedgerEntry['by']>[] = ['human', 'policy', 'human-override']

type Fate = { kind: 'merged'; head: string; by: LedgerEntry['by'] } | { kind: 'closed' }

const exportKey = (e: LedgerEntry) => JSON.stringify([e.work, e.export ?? null])

/** 내보내기마다 끝: 머지(마지막 merged_head), 닫힘, 아직 열림(없음) */
function fates(entries: LedgerEntry[]): Map<string, Fate> {
  const out = new Map<string, Fate>()
  for (const e of entries) {
    const key = exportKey(e)
    if (e.merged_head) out.set(key, { kind: 'merged', head: e.merged_head, by: e.by })
    else if (e.closed && out.get(key)?.kind !== 'merged') out.set(key, { kind: 'closed' })
  }
  return out
}

/**
 * 조건 id → 그림자 실적이 기준을 넘었나. 같은 project이고 그 결론을 낼 때의 모델·Claude Code·relay 버전이 지금과 같은
 * 기록만 센다(Work의 머지·닫힘은 버전과 상관없이 읽는다).
 * - 센 것: 조건을 채운 결론(shadow 또는 auto_merge_candidate)이 있는 (Work, 조건) 하나에 한 건(V22: 내보내기가 여럿이어도).
 * - 일치: 그 조건을 채운 내보내기가 모두 조건을 채운 head를 사람이 고치지 않고 그대로 머지함(merged_head === head).
 * - 불일치: 그 head 뒤에 더 커밋해 머지했거나(중간 head가 조건을 채웠어도), 닫음.
 * - 그 조건을 채운 내보내기가 아직 열렸거나 정책이 머지한 것(by 'policy', 사람의 판단이 아님)이 있으면 세지 않는다.
 * 일치 수 ≥ minShadow이고 일치율 ≥ 95%이면 true. 기록이 없는 조건은 결과에 없다(관문은 없음을 거짓으로 본다).
 */
export function trackRecord(
  entries: LedgerEntry[],
  project: string,
  minShadow: number,
  current: { model?: string; claude_version?: string; relay_version: string },
): Record<string, boolean> {
  const mine = entries.filter((e) => e.project === project)
  const fate = fates(mine)
  const samples = new Map<string, { condition: string; match: boolean; open: boolean }>()
  for (const e of mine) {
    if (e.condition === null || !(e.shadow || e.conclusion === 'auto_merge_candidate')) continue
    if (
      e.model !== current.model ||
      e.claude_version !== current.claude_version ||
      e.relay_version !== current.relay_version
    )
      continue
    const key = JSON.stringify([e.work, e.condition])
    const s = samples.get(key) ?? { condition: e.condition, match: true, open: false }
    const f = fate.get(exportKey(e))
    if (!f || (f.kind === 'merged' && f.by === 'policy')) s.open = true
    else if (f.kind !== 'merged' || f.head !== e.head) s.match = false
    samples.set(key, s)
  }
  const counted = new Map<string, { match: number; miss: number }>()
  for (const s of samples.values()) {
    if (s.open) continue
    const c = counted.get(s.condition) ?? { match: 0, miss: 0 }
    if (s.match) c.match++
    else c.miss++
    counted.set(s.condition, c)
  }
  const out: Record<string, boolean> = {}
  for (const [id, c] of counted)
    out[id] = c.match >= minShadow && c.match / (c.match + c.miss) >= MATCH_RATE
  return out
}

const optString = (v: unknown) => v === undefined || typeof v === 'string'

function isEntry(v: unknown): v is LedgerEntry {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const e = v as Record<string, unknown>
  return (
    typeof e['ts'] === 'string' &&
    typeof e['project'] === 'string' &&
    typeof e['work'] === 'string' &&
    typeof e['head'] === 'string' &&
    (CONCLUSIONS as readonly unknown[]).includes(e['conclusion']) &&
    (e['condition'] === null || typeof e['condition'] === 'string') &&
    typeof e['shadow'] === 'boolean' &&
    (e['by'] === undefined || (BY as readonly unknown[]).includes(e['by'])) &&
    optString(e['merged_head']) &&
    (e['closed'] === undefined || typeof e['closed'] === 'boolean') &&
    optString(e['export']) &&
    optString(e['model']) &&
    optString(e['claude_version']) &&
    typeof e['relay_version'] === 'string' &&
    (e['worse'] === undefined || Array.isArray(e['worse'])) &&
    (e['accepted'] === undefined || isAccepted(e['accepted']))
  )
}

const strings = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string')

function isAccepted(v: unknown): boolean {
  const a = v as Record<string, unknown> | null
  return typeof a === 'object' && a !== null && strings(a['ratchets']) && strings(a['debt'])
}

/** 받아들였지만 빚으로 기록하지 않은 내보내기의 수(M3b): 내보내기마다 마지막으로 받아들인 줄의 debt가 빈 것 */
export function acceptedUnrecorded(entries: LedgerEntry[], project: string): number {
  const last = new Map<string, boolean>()
  for (const e of entries)
    if (e.project === project && e.accepted) last.set(exportKey(e), e.accepted.debt.length === 0)
  return [...last.values()].filter(Boolean).length
}

/** ledger.jsonl을 읽는다. 줄마다 JSON 하나, 깨진 줄과 모양이 다른 줄은 건너뛴다 */
export function parseLedger(text: string): LedgerEntry[] {
  const out: LedgerEntry[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const v: unknown = JSON.parse(line)
      if (isEntry(v)) out.push(v)
    } catch {
      // 깨진 줄(쓰다 끊긴 끝줄 등)은 건너뛴다
    }
  }
  return out
}

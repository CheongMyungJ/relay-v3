// 실적 장부 (그림자, V3, docs/m2-modules.md 1절 ledger.ts). $RELAY_HOME/ledger.jsonl에 관문 결론마다 한 줄.
// 머지·닫힘은 그 Work의 줄(같은 줄을 고쳐 쓰거나 새 줄)에 by, merged_head, closed로 남는다.
// 실적은 조건마다 '자동이었으면 머지했을 head를 사람이 그대로 머지했나'다. 버전이 바뀌면 다시 잰다(philosophy 원칙 4).

import type { Conclusion } from './types.ts'

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
  model?: string
  claude_version?: string
  relay_version: string
}

/** 일치율 기준 */
const MATCH_RATE = 0.95

const CONCLUSIONS: readonly Conclusion[] = ['human_merge', 'auto_merge_candidate', 'recontract']
const BY: readonly NonNullable<LedgerEntry['by']>[] = ['human', 'policy', 'human-override']

type Fate = { kind: 'merged'; head: string; by: LedgerEntry['by'] } | { kind: 'closed' }

/** Work마다 끝: 머지(마지막 merged_head), 닫힘, 아직 열림(없음) */
function fates(entries: LedgerEntry[]): Map<string, Fate> {
  const out = new Map<string, Fate>()
  for (const e of entries) {
    if (e.merged_head) out.set(e.work, { kind: 'merged', head: e.merged_head, by: e.by })
    else if (e.closed && out.get(e.work)?.kind !== 'merged') out.set(e.work, { kind: 'closed' })
  }
  return out
}

/**
 * 조건 id → 그림자 실적이 기준을 넘었나. 같은 project이고 그 결론을 낼 때의 모델·Claude Code·relay 버전이 지금과 같은
 * 기록만 센다(Work의 머지·닫힘은 버전과 상관없이 읽는다).
 * - 센 것: 조건을 채운 결론(shadow 또는 auto_merge_candidate)의 (Work, 조건, head). 같은 head를 여러 번 재도 하나다.
 * - 일치: 그 head를 사람이 고치지 않고 그대로 머지함(merged_head === head).
 * - 불일치: 그 Work에서 head 뒤에 더 커밋해 머지했거나(merged_head !== head) 닫음.
 * - 아직 열린 Work와 정책이 머지한 것(by 'policy', 사람의 판단이 아님)은 세지 않는다.
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
  const counted = new Map<string, { match: number; miss: number }>()
  const seen = new Set<string>()
  for (const e of mine) {
    if (e.condition === null || !(e.shadow || e.conclusion === 'auto_merge_candidate')) continue
    if (
      e.model !== current.model ||
      e.claude_version !== current.claude_version ||
      e.relay_version !== current.relay_version
    )
      continue
    const f = fate.get(e.work)
    if (!f || (f.kind === 'merged' && f.by === 'policy')) continue
    const key = JSON.stringify([e.work, e.condition, e.head])
    if (seen.has(key)) continue
    seen.add(key)
    const c = counted.get(e.condition) ?? { match: 0, miss: 0 }
    if (f.kind === 'merged' && f.head === e.head) c.match++
    else c.miss++
    counted.set(e.condition, c)
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
    optString(e['model']) &&
    optString(e['claude_version']) &&
    typeof e['relay_version'] === 'string'
  )
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

// 실적 장부 (그림자, V3, docs/m2-modules.md 1a절 ledger.ts. M4-0에서 core에서 옮김). $RELAY_HOME/ledger.jsonl에 관문 결론마다 한 줄.
// 머지·닫힘은 그 Work(V22: 그 내보내기)의 줄(같은 줄을 고쳐 쓰거나 새 줄)에 by, merged_head, closed로 남는다. M4b부터 끝난
// Work의 PR과 PR 없이 끝남·버림도 따라가 끝 줄(ended, merge_commit, merged_at, same_change)을 쓴다(main/works-record.ts).
// 실적은 조건마다 '자동이었으면 머지했을 head를 사람이 그대로 머지했나'다. 버전이 바뀌면 다시 잰다(philosophy 원칙 4).
// 셈(trackRecord, shadowStats)은 engine/shadow.ts(M4c), 머지 뒤 30일의 after·dispute 줄은 engine/after-merge.ts(M4d)다.
// M4e부터 끝 줄에 머지 뒤 커밋의 갈래(after_commits)와 세션 커밋 집합의 셈(session_set)을 더한다(engine/session-commits.ts).

import type { Conclusion, RatchetResult } from '../core/types.ts'
import { gateEpoch } from './gate-version.ts'

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
  // ── M4a(m4-design 3.1): 내보내기 결론 줄. 모두 선택 칸이고 M4a 앞의 줄에는 없다
  /** 채운 조건 전부(정책의 차례, engine/track.ts conditionsMet). condition은 그 첫 조건이다 */
  met?: string[]
  /** 정책의 조건 id → 조건 정의의 hash(track.ts condHashes). 채우지 못한 조건도 적는다(비교군) */
  conds?: Record<string, string>
  /** 결론을 낸 관문의 판(engine/gate-version.ts GATE_VERSION) */
  gate_version?: number
  /** 리뷰 프롬프트의 판(core/review.ts REVIEW_PROMPT_VERSION) */
  review_prompt?: number
  /** 앱이 리뷰에 넘긴 --model. 없으면 'default'(CLI 기본) */
  model_requested?: string
  /** 이 head 리뷰(claude -p)의 출력이 말한 모델(stream-json assistant message.model). 세션의 모델이 아니다 */
  model_observed?: string
  /** 세션 훅 본문 effort.level의 마지막 값(main/works-session-log.ts) */
  effort?: string
  /** 앱 checkout의 git commit. 감사용이고 판 열쇠가 아니다 */
  relay_build?: string
  /** 내보내기의 PR 번호 */
  pr?: number
  /** 묶음의 base(기준 ref와 head의 공통 조상) */
  base_sha?: string
  /** 계약을 승인한 주체(caller 계약은 따로 센다, philosophy 5장 단계 2) */
  approved_by?: 'human' | 'caller'
  // ── M4b(m4-design 4.1): 끝 줄. 모두 선택 칸이고 M4b 앞의 줄에는 없다
  /**
   * PR 없이 끝남: no_pr는 PR 없이 [끝내기](아직 끝을 모름: 거울에서 90일 동안 head가 기준에 닿는지 본다), discarded는 [버림],
   * unmerged는 no_pr 뒤 90일 동안 기준에 닿지 않음(불일치)
   */
  ended?: 'no_pr' | 'discarded' | 'unmerged'
  /** 머지 커밋(gh pr view mergeCommit.oid) */
  merge_commit?: string
  /** 머지한 때(gh pr view mergedAt) */
  merged_at?: string
  /**
   * 이 끝 줄의 head(그 내보내기의 마지막 결론 줄의 head)와 merged_head가 같은 변경인가(engine/follow.ts sameChange: 기준
   * 맞춤 머지와 relay 빚 커밋만 더함, 또는 같은 patch-id). null은 모름(일치로 세지 않는다)
   */
  same_change?: boolean | null
  // ── M4e(m4-design 7절): 끝 줄. 모두 선택 칸이고 M4e 앞의 줄에는 없다
  /**
   * 머지 뒤 커밋(이 끝 줄의 head..merged_head, 머지 전 기준에서 닿는 것은 뺌)의 갈래(engine/session-commits.ts classifyCommits).
   * 같은 SHA면 모두 0. 가르지 못했으면(사이 커밋을 모름, M4e 앞의 Work) 없다
   */
  after_commits?: AfterCommits
  /**
   * 이 내보내기의 앞 결론 줄 head(끝 줄의 head가 아님)마다 그 head 뒤 머지된 head까지의 커밋 갈래(다시 내보내기 전에 세션이나
   * 사람이 더 고친 것). merged_head의 조상이 아니거나 가르지 못한 head는 없다
   */
  after_heads?: Record<string, AfterCommits>
  /** 거짓이면 트레일러 없이 세션 커밋 집합만으로 갈랐다(트레일러를 켜지 않고 띄운 세션이 있음) */
  trailer?: boolean
  /** 이 Work의 세션 커밋 집합 전체(트레일러 덮임과 훅 위임 사고의 지표). M4e 앞의 Work는 없다 */
  session_set?: SessionSetSummary
}

/** 머지 뒤 커밋의 갈래(m4-design 7.3). disagree는 집합과 트레일러가 다르게 갈라 human으로 센 수 */
export interface AfterCommits {
  session: number
  human: number
  relay: number
  base_update: number
  disagree: number
}

/** Work의 세션 커밋 집합의 셈: 커밋 수, 트레일러를 켠 채 본 수, 그 가운데 트레일러가 있는 수, 훅 위임 사고 수 */
export interface SessionSetSummary {
  commits: number
  watched: number
  trailered: number
  incidents: number
}

/** 판 열쇠의 재료(m4-design 3.2): 내보내기 결론 줄의 판 칸. 지금 판도 같은 꼴로 만든다(main/works-exports.ts) */
export type EpochSource = Pick<
  LedgerEntry,
  'conds' | 'model_observed' | 'effort' | 'claude_version' | 'gate_version' | 'review_prompt'
>

/** 일치율 기준(그림자 실적, engine/shadow.ts trackRecord) */
export const MATCH_RATE = 0.95

const CONCLUSIONS: readonly Conclusion[] = ['human_merge', 'auto_merge_candidate', 'recontract']
const BY: readonly NonNullable<LedgerEntry['by']>[] = ['human', 'policy', 'human-override']
const APPROVED_BY: readonly NonNullable<LedgerEntry['approved_by']>[] = ['human', 'caller']
const ENDED: readonly NonNullable<LedgerEntry['ended']>[] = ['no_pr', 'discarded', 'unmerged']

/** Claude Code 판의 major.minor('2.1.318 (Claude Code)' → '2.1'). patch는 판 열쇠에 넣지 않는다(거의 매주 나온다). 못 읽으면 null */
export function claudeMinor(version: string | undefined): string | null {
  const m = /^(\d+)\.(\d+)(?:\.|\s|$)/.exec(version?.trim() ?? '')
  return m ? `${m[1] ?? ''}.${m[2] ?? ''}` : null
}

/**
 * 조건 하나의 판 열쇠(m4-design 3.2, 원칙 4: 바뀌면 다시 잰다): 조건 hash, 리뷰가 본 모델, effort, Claude Code major.minor,
 * 관문 판의 epoch(gate-version.ts), 리뷰 프롬프트 판. 모르는 칸이 하나라도 있으면 null이고 어떤 판과도 같지 않다(엄격).
 * relay_build, relay_version, Claude Code patch, model_requested는 적기만 하고 넣지 않는다. M4a 앞의 줄은 gate_version이
 * 없어 늘 null(판 모름)이다
 */
export function epochKey(e: EpochSource, condition: string): string | null {
  const parts = [
    e.conds?.[condition],
    e.model_observed,
    e.effort,
    claudeMinor(e.claude_version),
    gateEpoch(e.gate_version),
    e.review_prompt,
  ]
  if (parts.some((p) => p === undefined || p === null || p === '')) return null
  return JSON.stringify([condition, ...parts])
}

export const exportKey = (e: Pick<LedgerEntry, 'work' | 'export'>) =>
  JSON.stringify([e.work, e.export ?? null])

const optString = (v: unknown) => v === undefined || typeof v === 'string'
const optNumber = (v: unknown) => v === undefined || (typeof v === 'number' && Number.isFinite(v))
const optOf = (v: unknown, values: readonly unknown[]) => v === undefined || values.includes(v)

/** 장부의 결론·끝 줄인가(M4d의 after·dispute 줄은 아니다: engine/after-merge.ts parseRecord) */
export function isLedgerEntry(v: unknown): v is LedgerEntry {
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
    optOf(e['by'], BY) &&
    optString(e['merged_head']) &&
    (e['closed'] === undefined || typeof e['closed'] === 'boolean') &&
    optString(e['export']) &&
    optString(e['model']) &&
    optString(e['claude_version']) &&
    typeof e['relay_version'] === 'string' &&
    (e['worse'] === undefined || Array.isArray(e['worse'])) &&
    (e['accepted'] === undefined || isAccepted(e['accepted'])) &&
    isEpochLine(e)
  )
}

/** M4a의 칸(m4-design 3.1). 없으면 옛 줄이다 */
function isEpochLine(e: Record<string, unknown>): boolean {
  const conds = e['conds']
  return (
    (e['met'] === undefined || strings(e['met'])) &&
    (conds === undefined ||
      (typeof conds === 'object' &&
        conds !== null &&
        !Array.isArray(conds) &&
        Object.values(conds).every((h) => typeof h === 'string'))) &&
    optNumber(e['gate_version']) &&
    optNumber(e['review_prompt']) &&
    optString(e['model_requested']) &&
    optString(e['model_observed']) &&
    optString(e['effort']) &&
    optString(e['relay_build']) &&
    optNumber(e['pr']) &&
    optString(e['base_sha']) &&
    optOf(e['approved_by'], APPROVED_BY) &&
    isFateLine(e)
  )
}

/** M4b의 칸(m4-design 4.1). 없으면 옛 줄이다 */
function isFateLine(e: Record<string, unknown>): boolean {
  const same = e['same_change']
  return (
    optOf(e['ended'], ENDED) &&
    optString(e['merge_commit']) &&
    optString(e['merged_at']) &&
    (same === undefined || same === null || typeof same === 'boolean') &&
    optCounts(e['after_commits'], AFTER_KEYS) &&
    (e['after_heads'] === undefined ||
      (typeof e['after_heads'] === 'object' &&
        e['after_heads'] !== null &&
        !Array.isArray(e['after_heads']) &&
        Object.values(e['after_heads']).every(
          (a) => a !== undefined && optCounts(a, AFTER_KEYS),
        ))) &&
    (e['trailer'] === undefined || typeof e['trailer'] === 'boolean') &&
    optCounts(e['session_set'], ['commits', 'watched', 'trailered', 'incidents'])
  )
}

const AFTER_KEYS = ['session', 'human', 'relay', 'base_update', 'disagree'] as const

/** M4e의 셈 칸: 없거나, 이름마다 0 이상의 정수인 객체 */
function optCounts(v: unknown, keys: readonly string[]): boolean {
  if (v === undefined) return true
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const o = v as Record<string, unknown>
  return keys.every((k) => Number.isInteger(o[k]) && (o[k] as number) >= 0)
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
      if (isLedgerEntry(v)) out.push(v)
    } catch {
      // 깨진 줄(쓰다 끊긴 끝줄 등)은 건너뛴다
    }
  }
  return out
}

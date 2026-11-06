// 조건별 그림자 실적의 숫자 (M4c, docs/m4-design.md 5절). 관문 판의 파일이 아니다(engine/track.ts는 관문 판의 파일이라
// 여기 둔다): 실적은 관문의 결론을 엄격하게만 바꾸고(track_record_ok) 장부를 읽기만 한다. 순수 함수이고 시계는 인자다.
// - 단위는 (Work, 조건) 한 건(V22). 표본에 드는지는 결론 줄의 met(옛 줄은 condition)으로 정한다.
// - 일치: 그 조건을 채운 내보내기가 모두 같은 변경으로 사람 손에 머지됨. 불일치: 더 커밋해 머지함(M4e: 세션, 사람, 모름), 닫힘, 버림(discarded,
//   90일 뒤 unmerged), 같은 변경을 모름. 분모 밖: 열림, 낡음(14일), 추적 잃음(90일), 정책 머지, preapproved, 판이 다름.
// - 비교군(control): 그 조건을 못 채운 Work. lift = 이 조건의 일치율 − 비교군의 '그대로 머지' 비율(기술일 뿐 원인이 아니다).
// - trackRecord(관문의 track_record_ok)는 이 셈 위의 얇은 함수다.

import type {
  ConditionStats,
  ControlStats,
  EpochView,
  RecordStats,
  ShadowEnd,
} from '../shared/api.ts'
import {
  afterStats,
  lastAfter,
  type AfterLine,
  type DisputeLine,
  type MergeRef,
} from './after-merge.ts'
import { isConclusionLine, NO_PR_DAYS } from './follow.ts'
import { gateEpoch } from './gate-version.ts'
import { sessionStats } from './session-commits.ts'
import {
  claudeMinor,
  epochKey,
  exportKey,
  MATCH_RATE,
  type EpochSource,
  type LedgerEntry,
} from './ledger.ts'

/** 끝이 없는 내보내기가 낡음으로 보이는 날 수 */
export const STALE_DAYS = 14
const DAY_MS = 24 * 60 * 60 * 1000
const Z = 1.959964

/** Wilson 95% 하한. n이 0이면 null */
export function wilsonLow(k: number, n: number): number | null {
  if (n <= 0) return null
  const p = k / n
  const z2 = Z * Z
  const centre = p + z2 / (2 * n)
  const margin = Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))
  return Math.max(0, (centre - margin) / (1 + z2 / n))
}

const unitOf = (e: LedgerEntry) => JSON.stringify([e.project, e.work])
const exportOf = (e: LedgerEntry) => `${e.project}\0${exportKey(e)}`

/** 내보내기의 끝(마지막 끝 줄. 머지는 뒤의 닫힘에 지지 않는다) */
type End =
  | {
      kind: 'merged'
      merged: string
      by: LedgerEntry['by']
      /** 끝 줄의 head와 그 head에 대한 same_change(M4b) */
      head: string
      same: boolean | null | undefined
      /** 머지 뒤 30일의 열쇠: 머지 커밋, 없으면 머지된 head(로컬 fast-forward) */
      commit: string
      /** 끝 줄의 head 뒤 머지된 head까지의 커밋 갈래(M4e). 모르면 없다 */
      after: LedgerEntry['after_commits']
      /** 앞 결론 줄의 head마다 그 갈래(M4e) */
      heads: LedgerEntry['after_heads']
    }
  | { kind: 'closed' }
  | { kind: 'discarded' }
  | { kind: 'no_pr' }

function ends(entries: readonly LedgerEntry[]): Map<string, End> {
  const out = new Map<string, End>()
  for (const e of entries) {
    const key = exportOf(e)
    const before = out.get(key)?.kind
    if (e.merged_head)
      out.set(key, {
        kind: 'merged',
        merged: e.merged_head,
        by: e.by,
        head: e.head,
        same: e.same_change,
        commit: e.merge_commit ?? e.merged_head,
        after: e.after_commits,
        heads: e.after_heads,
      })
    else if (before === 'merged') continue
    else if (e.closed) out.set(key, { kind: 'closed' })
    else if (e.ended === 'discarded' || e.ended === 'unmerged') out.set(key, { kind: 'discarded' })
    else if (e.ended === 'no_pr' && before === undefined) out.set(key, { kind: 'no_pr' })
  }
  return out
}

type Miss = keyof ConditionStats['miss']
type Outside = keyof ConditionStats['outside']
type Verdict = { kind: 'match' } | { kind: 'miss'; why: Miss } | { kind: 'out'; why: Outside }

/** 결론 줄 하나(그 head)의 판정. since는 그 내보내기의 첫 결론 줄의 때 */
function verdict(
  line: LedgerEntry,
  end: End | undefined,
  since: string,
  now: string | null,
): Verdict {
  if (!end || end.kind === 'no_pr') {
    const age = now === null ? NaN : Date.parse(now) - Date.parse(since)
    if (age > NO_PR_DAYS * DAY_MS) return { kind: 'out', why: 'lost' }
    if (age > STALE_DAYS * DAY_MS) return { kind: 'out', why: 'stale' }
    return { kind: 'out', why: 'open' }
  }
  if (end.kind === 'closed') return { kind: 'miss', why: 'closed' }
  if (end.kind === 'discarded') return { kind: 'miss', why: 'discarded' }
  if (end.by === 'policy') return { kind: 'out', why: 'policy' }
  if (end.merged === line.head || (end.head === line.head && end.same === true))
    return { kind: 'match' }
  // 같은 head인데 같은 변경을 모름(M4b null). 다른 head로 머지했거나 같은 변경이 아니면 더 커밋함
  if (end.head === line.head && end.same === null) return { kind: 'miss', why: 'unknown_change' }
  // 더 커밋한 갈래(M4e): 이 head 뒤 커밋에 사람 커밋이 하나라도 있으면 사람, 세션 커밋만이면 세션, 가르지 못했으면 모름
  const after = end.head === line.head ? end.after : end.heads?.[line.head]
  // 앞 head 뒤에 relay 빚 커밋과 깨끗한 기준 맞춤 머지만 있으면 같은 변경이다(follow.ts sameChange 2: Update branch를 받아 다시
  // 내보낸 head). 끝 줄의 head는 same_change가 이미 정했다
  if (end.head !== line.head && after && after.human === 0 && after.session === 0)
    return { kind: 'match' }
  if (after && after.human > 0) return { kind: 'miss', why: 'more_human' }
  if (after && after.session > 0) return { kind: 'miss', why: 'more_session' }
  return { kind: 'miss', why: 'more_unknown' }
}

const OUT_ORDER: readonly Outside[] = ['policy', 'lost', 'stale', 'open']

/** 단위 하나(Work 하나, 조건 하나)의 판정: 분모 밖이 하나라도 있으면 분모 밖, 모두 일치면 일치, 아니면 첫 불일치 */
function unitVerdict(vs: readonly Verdict[]): Verdict {
  const outs = vs.filter((v): v is Extract<Verdict, { kind: 'out' }> => v.kind === 'out')
  if (outs.length > 0) {
    const why = OUT_ORDER.find((w) => outs.some((o) => o.why === w)) ?? 'open'
    return { kind: 'out', why }
  }
  return vs.find((v) => v.kind === 'miss') ?? { kind: 'match' }
}

/** 이 결론 줄이 조건 c를 채웠나(옛 줄은 condition). 그림자나 자동 후보 결론만 */
const meets = (e: LedgerEntry, c: string): boolean =>
  (e.shadow || e.conclusion === 'auto_merge_candidate') &&
  (e.met ? e.met.includes(c) : e.condition === c)

/** 어느 조건도 채우지 못한 결론 줄인가 */
const meetsNone = (e: LedgerEntry): boolean => (e.met ? e.met.length === 0 : e.condition === null)

/** 조건과 상관없는 판(모델, effort, Claude Code major.minor, 관문 epoch, 리뷰 프롬프트). 하나라도 모르면 null */
function epochBase(e: EpochSource): string | null {
  const parts = [
    e.model_observed,
    e.effort,
    claudeMinor(e.claude_version),
    gateEpoch(e.gate_version),
    e.review_prompt,
  ]
  return parts.some((p) => p === undefined || p === null || p === '') ? null : JSON.stringify(parts)
}

export interface StatsInput {
  entries: readonly LedgerEntry[]
  after?: readonly AfterLine[]
  disputes?: readonly DisputeLine[]
  /** 한 프로젝트, 또는 프로젝트를 넘어 합침(Q11: 보이기만) */
  scope: { project: string } | { pool: true }
  /** 지금 판(이 판의 결론 줄만 센다), 또는 모든 판 */
  epoch: EpochSource | 'all'
  /** 낡음·추적 잃음·들어오는 빠르기의 시계. null이면 낡음과 추적 잃음을 가르지 않는다(모두 열림) */
  now: string | null
}

/** 단위(프로젝트, Work) → 그 단위의 결론 줄 */
type Units = Map<string, { work: string; lines: LedgerEntry[] }>

/** 한 범위의 장부를 단위로 묶고 판정하는 셈(shadowStats와 recordStats가 쓴다) */
function counter(input: StatsInput) {
  const scoped = input.entries.filter(
    (e) => 'pool' in input.scope || e.project === input.scope.project,
  )
  const conclusions = scoped.filter(isConclusionLine)
  const end = ends(scoped)
  const since = new Map<string, string>()
  for (const e of conclusions) if (!since.has(exportOf(e))) since.set(exportOf(e), e.ts)
  // 머지 뒤 30일의 열쇠는 (프로젝트, 머지 커밋)
  const afterLast = new Map<string, AfterLine>()
  for (const p of new Set(scoped.map((e) => e.project)))
    for (const [k, v] of lastAfter(input.after ?? [], p)) afterLast.set(`${p}\0${k}`, v)
  const disputes = (input.disputes ?? []).map((d) => ({
    ...d,
    merge_commit: `${d.project}\0${d.merge_commit}`,
  }))
  const nowMs = input.now === null ? NaN : Date.parse(input.now)

  const group = (pick: (e: LedgerEntry) => boolean, epochOk: (e: LedgerEntry) => boolean) => {
    const units: Units = new Map()
    const other = new Set<string>()
    for (const e of conclusions) {
      if (!pick(e)) continue
      if (!epochOk(e)) {
        other.add(unitOf(e))
        continue
      }
      const u = units.get(unitOf(e)) ?? { work: e.work, lines: [] }
      u.lines.push(e)
      units.set(unitOf(e), u)
    }
    for (const u of units.keys()) other.delete(u)
    return { units, otherEpoch: other.size }
  }
  const judge = (lines: readonly LedgerEntry[]): Verdict =>
    unitVerdict(
      lines.map((l) => verdict(l, end.get(exportOf(l)), since.get(exportOf(l)) ?? l.ts, input.now)),
    )
  const after = (units: Units) => {
    const merges: MergeRef[] = []
    const seen = new Set<string>()
    for (const u of units.values())
      for (const l of u.lines) {
        const f = end.get(exportOf(l))
        if (f?.kind !== 'merged') continue
        const commit = `${l.project}\0${f.commit}`
        if (seen.has(commit)) continue
        seen.add(commit)
        merges.push({ work: u.work, commit })
      }
    const s = afterStats(merges, afterLast, disputes)
    s.events = s.events.map((ev) => ({ ...ev, merge_commit: ev.merge_commit.split('\0')[1] ?? '' }))
    return s
  }
  const control = (units: Units): ControlStats => {
    let n = 0
    let asIs = 0
    for (const u of units.values()) {
      const v = judge(u.lines)
      if (v.kind === 'out') continue
      n++
      if (v.kind === 'match') asIs++
    }
    return { n, as_is: asIs, after: after(units) }
  }
  const recent = (e: LedgerEntry) =>
    nowMs - Date.parse(since.get(exportOf(e)) ?? e.ts) <= 30 * DAY_MS
  const inflow = (id: string) => ({
    exports_30d: new Set(conclusions.filter(recent).map(exportOf)).size,
    met_30d: new Set(conclusions.filter((e) => recent(e) && meets(e, id)).map(exportOf)).size,
  })
  return { conclusions, group, judge, after, control, inflow }
}

/** 조건 id → 조건별 실적(m4-design 5.1). 지금 판이면 그 판의 조건(conds)만, 모든 판이면 장부에 나온 조건 전부(나온 차례) */
export function shadowStats(input: StatsInput): Record<string, ConditionStats> {
  const c = counter(input)
  const ids: string[] = []
  const all = input.epoch === 'all'
  for (const e of all ? c.conclusions : [])
    for (const id of [
      ...Object.keys(e.conds ?? {}),
      ...(e.met ?? []),
      ...(e.condition ? [e.condition] : []),
    ])
      if (!ids.includes(id)) ids.push(id)
  if (input.epoch !== 'all') ids.push(...Object.keys(input.epoch.conds ?? {}))
  const inEpoch = (id: string) => (e: LedgerEntry) => {
    if (input.epoch === 'all') return true
    const key = epochKey(e, id)
    return key !== null && key === epochKey(input.epoch, id)
  }

  const verdicts = new Map<string, Map<string, Verdict>>()
  const out: Record<string, ConditionStats> = {}
  for (const id of ids) {
    const samples = c.group((e) => meets(e, id), inEpoch(id))
    const controls = c.group(
      (e) => !meets(e, id) && e.conds?.[id] !== undefined && !samples.units.has(unitOf(e)),
      inEpoch(id),
    )
    const hash = all
      ? c.conclusions.findLast((e) => e.conds?.[id] !== undefined)?.conds?.[id]
      : undefined
    const s = blank(
      id,
      (all ? hash : input.epoch !== 'all' ? input.epoch.conds?.[id] : undefined) ?? null,
    )
    const mine = new Map<string, Verdict>()
    for (const [unit, u] of samples.units) {
      const v = c.judge(u.lines)
      mine.set(unit, v)
      if (v.kind === 'match') s.match++
      else if (v.kind === 'miss') s.miss[v.why]++
      else s.outside[v.why]++
    }
    verdicts.set(id, mine)
    s.outside.other_epoch = samples.otherEpoch
    s.n = s.match + Object.values(s.miss).reduce((a, b) => a + b, 0)
    s.rate = s.n > 0 ? s.match / s.n : null
    s.wilson_low = wilsonLow(s.match, s.n)
    s.after = c.after(samples.units)
    s.control = c.control(controls.units)
    s.lift = s.rate !== null && s.control.n > 0 ? s.rate - s.control.as_is / s.control.n : null
    s.inflow = c.inflow(id)
    out[id] = s
  }
  // 같은 Work를 다른 조건과 함께 센 표본(끝이 정해진 것끼리)
  const counted = (id: string, unit: string) => {
    const v = verdicts.get(id)?.get(unit)
    return v !== undefined && v.kind !== 'out'
  }
  for (const [id, mine] of verdicts) {
    const s = out[id]
    if (!s) continue
    for (const unit of mine.keys())
      if (counted(id, unit) && ids.some((other) => other !== id && counted(other, unit)))
        s.correlated++
  }
  return out
}

function blankAfter(): ConditionStats['after'] {
  return {
    merges: 0,
    closed: 0,
    watching: 0,
    reverts: 0,
    main: { attributed: 0, pending: 0, inherited: 0, unknown: 0 },
    unmeasurable: 0,
    disputed: 0,
    upper: null,
    events: [],
  }
}

function blank(id: string, hash: string | null): ConditionStats {
  return {
    id,
    cond_hash: hash,
    n: 0,
    match: 0,
    miss: {
      more_session: 0,
      more_human: 0,
      more_unknown: 0,
      closed: 0,
      discarded: 0,
      unknown_change: 0,
    },
    outside: { open: 0, stale: 0, lost: 0, policy: 0, preapproved: 0, other_epoch: 0 },
    rate: null,
    wilson_low: null,
    correlated: 0,
    after: blankAfter(),
    control: { n: 0, as_is: 0, after: blankAfter() },
    lift: null,
    inflow: { exports_30d: 0, met_30d: 0 },
  }
}

/**
 * 조건 id → 그림자 실적이 기준을 넘었나(관문의 track_record_ok, V3). 지금 판(current)의 결론 줄만 센다. 끝이 정해진 표본이 있는
 * 조건만 결과에 있다(관문은 없음을 거짓으로 본다). 일치 수 ≥ minShadow, 일치율 ≥ 95%, 그리고 이 조건의 머지에 이의 없는 귀속
 * 되돌림·귀속 main 실패가 0이고 미정 main이 0이면 참(되돌림 0과 미정 0은 엄격하게만 바꾼다, V5. devices.md '자동 머지')
 */
export function trackRecord(
  entries: readonly LedgerEntry[],
  project: string,
  minShadow: number,
  current: EpochSource,
  record: { after?: readonly AfterLine[]; disputes?: readonly DisputeLine[] } = {},
): Record<string, boolean> {
  const stats = shadowStats({ entries, ...record, scope: { project }, epoch: current, now: null })
  const out: Record<string, boolean> = {}
  for (const [id, s] of Object.entries(stats)) {
    if (s.n === 0) continue
    const clean =
      s.after.reverts === 0 && s.after.main.attributed === 0 && s.after.main.pending === 0
    out[id] = s.match >= minShadow && (s.rate ?? 0) >= MATCH_RATE && clean
  }
  return out
}

/** 결론 줄의 판(보이기용) */
export function epochView(e: EpochSource): EpochView {
  return {
    model: e.model_observed ?? null,
    effort: e.effort ?? null,
    claude: claudeMinor(e.claude_version),
    gate_epoch: gateEpoch(e.gate_version),
    review_prompt: e.review_prompt ?? null,
  }
}

const FIELD_NAMES: Record<keyof EpochView, string> = {
  model: '모델',
  effort: 'effort',
  claude: 'Claude Code',
  gate_epoch: '관문 판',
  review_prompt: '리뷰 프롬프트',
}

/**
 * 설정 대화상자의 [실적]과 `relay record`의 표(m4-design 5.2): 지금 판(이 프로젝트에서 판 칸을 모두 아는 마지막 결론 줄의 판)
 * 또는 모든 판의
 * 조건별 실적, 사람 경로 비교 줄, 판이 바뀐 자리(최근 것부터 다섯), 판을 모르는 결론 줄의 수
 */
export function recordStats(
  input: Omit<StatsInput, 'epoch'> & { allEpochs: boolean; broken: number },
): RecordStats {
  const c = counter({ ...input, epoch: 'all' })
  const lines = c.conclusions
  // 판 칸을 모두 아는 마지막 결론 줄(앱을 다시 켠 뒤 훅 전의 결론 줄은 effort를 몰라 어떤 판과도 같지 않다)
  const current = lines.findLast((e) => epochBase(e) !== null) ?? null
  const epoch = input.allEpochs || current === null ? 'all' : current
  const stats = shadowStats({ ...input, epoch })
  // 사람 경로: 어느 조건도 채우지 못한 Work. 조건이 없어 판 열쇠 대신 조건과 상관없는 판으로 고른다
  const base = epoch === 'all' ? null : epochBase(epoch)
  const human = c.group(
    meetsNone,
    (e) => epoch === 'all' || (base !== null && epochBase(e) === base),
  )
  const changes: RecordStats['changes'] = []
  let prev: EpochView | null = null
  for (const e of lines) {
    if (e.gate_version === undefined) continue
    const v = epochView(e)
    const before = prev
    if (before) {
      const fields = (Object.keys(FIELD_NAMES) as (keyof EpochView)[])
        .filter((k) => v[k] !== before[k])
        .map((k) => `${FIELD_NAMES[k]} ${String(before[k] ?? '모름')} → ${String(v[k] ?? '모름')}`)
      if (fields.length > 0) changes.push({ ts: e.ts, fields })
    }
    prev = v
  }
  return {
    epoch: epoch === 'all' ? 'all' : 'current',
    current: current ? epochView(current) : null,
    conditions: Object.values(stats),
    human: c.control(human.units),
    changes: changes.reverse().slice(0, 5),
    unknown_epoch: { lines: lines.filter((e) => epochBase(e) === null).length, of: lines.length },
    broken: input.broken,
    sessions: sessionStats(
      input.entries.filter((e) => 'pool' in input.scope || e.project === input.scope.project),
    ),
  }
}

/**
 * 이 Work의 내보내기마다 그림자 표본의 끝(Q6). 조건을 채운 결론 줄이 있고 끝(머지·닫힘·버림)이 정해진 내보내기만. 판은 보지
 * 않는다(그 내보내기 자신의 끝이다)
 */
export function shadowEnds(entries: readonly LedgerEntry[], work: string): ShadowEnd[] {
  const mine = entries.filter((e) => e.work === work)
  const end = ends(mine)
  const out = new Map<string, ShadowEnd>()
  for (const e of mine) {
    if (!isConclusionLine(e)) continue
    const met = e.met ?? (e.condition ? [e.condition] : [])
    if (met.length === 0 || !(e.shadow || e.conclusion === 'auto_merge_candidate')) continue
    const v = verdict(e, end.get(exportOf(e)), e.ts, null)
    if (v.kind === 'out') continue
    const key = exportKey(e)
    const before = out.get(key)
    const conditions = [...new Set([...(before?.conditions ?? []), ...met])]
    const miss = before?.result === 'miss' ? before : v.kind === 'miss' ? { why: v.why } : null
    out.set(key, {
      unit: e.export ?? null,
      conditions,
      result: miss ? 'miss' : 'match',
      why: miss ? miss.why : null,
    })
  }
  return [...out.values()]
}

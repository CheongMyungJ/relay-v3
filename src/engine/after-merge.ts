// 머지 뒤 30일의 순수한 셈 (M4d, docs/m4-design.md 6절). main/works-after.ts가 거울(기준 브랜치 이력)과 gh(push 실행)에서
// 읽은 사실로 머지마다 되돌림(revertsOf)과 main 실패(mainOf)를 가르고, 장부(ledger.jsonl)에 kind 'after' 줄을 쓴다: 창 안에서는
// 처음 본 사건만, 창이 닫히면 한 줄. 사람이 [귀속이 틀림]을 누르면 kind 'dispute' 줄이고 그 사건은 셈에서 빠진 채 보인다.
// 앱은 CI를 다시 돌리지 않는다: 실패했는데 다시 시도가 없으면 미정(pending)이고 미정은 미정으로 둔다(엄격).

import type { AfterEvent, AfterStats, MainState } from '../shared/api.ts'
import { isLedgerEntry, type LedgerEntry } from './ledger.ts'

/** 머지 뒤 지켜보는 날 수 */
export const AFTER_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

export interface AfterLine {
  kind: 'after'
  ts: string
  project: string
  work: string
  /** 내보내기의 단위(V22). 없으면 Work 브랜치의 내보내기 */
  export?: string
  /** 머지 커밋(로컬 fast-forward 머지는 머지된 head) */
  merge_commit: string
  merged_at: string
  window_end: string
  /** 창이 닫힘(이 줄이 그 머지의 마지막 줄) */
  closed: boolean
  revert: { sha: string; form: 'this_reverts' | 'reverts_pr' | 'revert_title' } | null
  main: MainState
  /** main을 정한 실행(워크플로 이름, 커밋, 시도 수) */
  main_run?: { name: string; sha: string; attempts: number }
  /** 읽은 기준 브랜치의 마지막 커밋 시각 */
  seen_until: string
}

export interface DisputeLine {
  kind: 'dispute'
  ts: string
  project: string
  merge_commit: string
  event: AfterEvent['event']
}

/** 머지 하나가 기준에 올린 것의 끝 */
export const windowEnd = (mergedAt: string): string | null => {
  const t = Date.parse(mergedAt)
  return Number.isFinite(t) ? new Date(t + AFTER_DAYS * DAY_MS).toISOString() : null
}

// ── 되돌림 ─────────────────────────────────────────────────────────────────

/** 기준 브랜치 커밋 하나(창 안, 오래된 것부터) */
export interface BaseCommit {
  sha: string
  body: string
}

/**
 * 창 안의 기준 커밋 가운데 이 머지를 되돌린 첫 커밋(m4-design 6절): (가) 본문 `This reverts commit <oid>`의 oid가 이 머지가 기준에
 * 올린 커밋(landed)에 있음, (나) `Reverts <owner>/<repo>#<pr>`(GitHub 되돌림 PR 본문. slug를 모르면 owner/repo는 보지 않는다),
 * (다) 제목이 `Revert "<올린 커밋의 제목>"`(GitHub가 되돌림 PR과 git revert가 짓는 제목. PR 제목은 녹화본에 없어 커밋 제목을 쓴다)이고
 * 본문에 `This reverts commit`이 없음(있는데 (가)가 아니면 같은 제목의 다른 커밋을 되돌린 것).
 * 손으로 한 부분 되돌림은 놓친다(낙관 쪽 맹점)
 */
export function revertsOf(
  commits: readonly BaseCommit[],
  o: {
    landed: readonly string[]
    subjects: readonly string[]
    pr: number | null
    slug: string | null
  },
): AfterLine['revert'] {
  const landed = o.landed.map((s) => s.toLowerCase())
  const subjects = new Set(o.subjects.filter((s) => s !== '').map((s) => `Revert "${s}"`))
  for (const c of commits) {
    const named = [...c.body.matchAll(/This reverts commit ([0-9a-f]{7,64})/gi)]
    for (const m of named) {
      const oid = (m[1] ?? '').toLowerCase()
      if (landed.some((l) => l.startsWith(oid))) return { sha: c.sha, form: 'this_reverts' }
    }
    if (o.pr !== null)
      for (const m of c.body.matchAll(/^Reverts ([\w.-]+\/[\w.-]+)#(\d+)\s*$/gm)) {
        const slugOk = o.slug === null || (m[1] ?? '').toLowerCase() === o.slug.toLowerCase()
        if (slugOk && Number(m[2]) === o.pr) return { sha: c.sha, form: 'reverts_pr' }
      }
    // (다)는 되돌린 커밋을 본문에 적지 않은 되돌림만: 적었는데 올린 커밋이 아니면 같은 제목의 다른 커밋을 되돌린 것이다
    const title = c.body.split('\n')[0]?.trim() ?? ''
    if (named.length === 0 && subjects.has(title)) return { sha: c.sha, form: 'revert_title' }
  }
  return null
}

/** origin URL에서 owner/repo(GitHub 꼴만). 모르면 null */
export function repoSlug(url: string | null): string | null {
  const m = /[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url ?? '')
  return m && /github/i.test(url ?? '') ? `${m[1] ?? ''}/${m[2] ?? ''}` : null
}

// ── main 실패 ──────────────────────────────────────────────────────────────

/** 워크플로 실행 하나(gh api actions/runs의 칸: 녹화본 run 모양의 head_sha, event, status, conclusion, run_attempt, name, path) */
export interface RunFact {
  name: string
  path: string
  head_sha: string
  event: string
  status: string
  conclusion: string | null
  run_attempt: number
}

const OK = new Set(['success', 'skipped', 'neutral'])
const FAIL = new Set(['failure', 'timed_out', 'startup_failure'])

/** 엄격한 차례: 앞의 것이 결과를 정한다 */
const ORDER: readonly MainState[] = ['attributed', 'pending', 'unknown', 'inherited', 'clean']

const pushRuns = (runs: readonly RunFact[], sha: string) =>
  runs.filter((r) => r.event === 'push' && r.head_sha === sha)

const workflowOf = (r: RunFact) => r.path || r.name

/**
 * 머지 커밋 M의 main 상태(m4-design 6절). 필수 검사가 없거나(measurable 거짓) M의 push 실행이 0이면 잴 수 없음. 워크플로마다:
 * 성공·건너뜀은 깨끗, 실패했는데 부모 M^1의 같은 워크플로가 성공했고 다시 시도(run_attempt ≥ 2)도 실패면 귀속, 다시 시도가 없으면
 * 미정(앱은 CI를 다시 돌리지 않는다), 부모도 실패면 물려받음, 부모 실행이 없으면 모름. 아직 도는 실행은 미정, 취소 따위는 모름.
 * 실행을 읽지 못했으면(null) 모름. 워크플로 사이는 엄격한 쪽(귀속 > 미정 > 모름 > 물려받음 > 깨끗)
 */
export function mainOf(o: {
  sha: string
  parent: string | null
  runs: readonly RunFact[] | null
  parentRuns: readonly RunFact[] | null
  measurable: boolean
}): Pick<AfterLine, 'main' | 'main_run'> {
  if (!o.measurable) return { main: 'unmeasurable' }
  if (o.runs === null) return { main: 'unknown' }
  const mine = pushRuns(o.runs, o.sha)
  if (mine.length === 0) return { main: 'unmeasurable' }
  const parents =
    o.parent === null || o.parentRuns === null ? null : pushRuns(o.parentRuns, o.parent)
  let best: Pick<AfterLine, 'main' | 'main_run'> = { main: 'clean' }
  for (const r of mine) {
    const state = runState(r, parents)
    if (ORDER.indexOf(state) < ORDER.indexOf(best.main))
      best = {
        main: state,
        main_run: { name: r.name || r.path, sha: r.head_sha, attempts: r.run_attempt },
      }
  }
  return best
}

function runState(r: RunFact, parents: readonly RunFact[] | null): MainState {
  if (r.status !== 'completed') return 'pending'
  if (r.conclusion !== null && OK.has(r.conclusion)) return 'clean'
  if (r.conclusion === null || !FAIL.has(r.conclusion)) return 'unknown'
  const p = parents?.find((x) => workflowOf(x) === workflowOf(r))
  if (!p || p.status !== 'completed' || p.conclusion === null) return 'unknown'
  if (FAIL.has(p.conclusion)) return 'inherited'
  if (!OK.has(p.conclusion)) return 'unknown'
  return r.run_attempt >= 2 ? 'attributed' : 'pending'
}

// ── 장부 읽기와 셈 ─────────────────────────────────────────────────────────

const MAIN: readonly MainState[] = [...ORDER, 'unmeasurable']
const FORMS = ['this_reverts', 'reverts_pr', 'revert_title']

function isAfter(v: Record<string, unknown>): boolean {
  const r = v['revert'] as Record<string, unknown> | null | undefined
  const run = v['main_run'] as Record<string, unknown> | undefined
  return (
    v['kind'] === 'after' &&
    ['ts', 'project', 'work', 'merge_commit', 'merged_at', 'window_end', 'seen_until'].every(
      (k) => typeof v[k] === 'string',
    ) &&
    (v['export'] === undefined || typeof v['export'] === 'string') &&
    typeof v['closed'] === 'boolean' &&
    (r === null ||
      (typeof r === 'object' && typeof r.sha === 'string' && FORMS.includes(r.form as string))) &&
    MAIN.includes(v['main'] as MainState) &&
    (run === undefined ||
      (typeof run === 'object' &&
        typeof run.name === 'string' &&
        typeof run.sha === 'string' &&
        typeof run.attempts === 'number'))
  )
}

const isDispute = (v: Record<string, unknown>): boolean =>
  v['kind'] === 'dispute' &&
  ['ts', 'project', 'merge_commit'].every((k) => typeof v[k] === 'string') &&
  (v['event'] === 'revert' || v['event'] === 'main')

/** 장부 전체: 결론·끝 줄, after 줄, dispute 줄, 읽지 못한 줄 수(깨진 JSON, 모양이 다른 줄) */
export interface RecordFile {
  entries: LedgerEntry[]
  after: AfterLine[]
  disputes: DisputeLine[]
  broken: number
}

export function parseRecord(text: string): RecordFile {
  const out: RecordFile = { entries: [], after: [], disputes: [], broken: 0 }
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    let v: unknown
    try {
      v = JSON.parse(line)
    } catch {
      out.broken++
      continue
    }
    const o =
      typeof v === 'object' && v !== null && !Array.isArray(v)
        ? (v as Record<string, unknown>)
        : null
    if (isLedgerEntry(v)) out.entries.push(v)
    else if (o && isAfter(o)) out.after.push(o as unknown as AfterLine)
    else if (o && isDispute(o)) out.disputes.push(o as unknown as DisputeLine)
    else out.broken++
  }
  return out
}

/** 머지 커밋 → 그 머지의 마지막 after 줄(이 프로젝트) */
export function lastAfter(after: readonly AfterLine[], project: string): Map<string, AfterLine> {
  const out = new Map<string, AfterLine>()
  for (const a of after) if (a.project === project) out.set(a.merge_commit, a)
  return out
}

/** 셈에 넣는 머지 하나 */
export interface MergeRef {
  work: string
  commit: string
}

/**
 * 머지 무리 하나의 머지 뒤 30일(m4-design 6절 AfterStats). after 줄이 없거나 창이 닫히지 않은 머지는 지켜보는 중이다. 이의(dispute)가
 * 달린 사건은 셈에서 빠지고 disputed와 events에 남는다
 */
export function afterStats(
  merges: readonly MergeRef[],
  last: ReadonlyMap<string, AfterLine>,
  disputes: readonly DisputeLine[],
): AfterStats {
  const s: AfterStats = {
    merges: merges.length,
    closed: 0,
    watching: 0,
    reverts: 0,
    main: { attributed: 0, pending: 0, inherited: 0, unknown: 0 },
    unmeasurable: 0,
    disputed: 0,
    upper: null,
    events: [],
  }
  const disputed = (commit: string, event: AfterEvent['event']) =>
    disputes.some((d) => d.merge_commit === commit && d.event === event)
  for (const m of merges) {
    const a = last.get(m.commit)
    if (a?.closed) s.closed++
    else s.watching++
    if (!a) continue
    if (a.revert) {
      const d = disputed(m.commit, 'revert')
      s.events.push({
        merge_commit: m.commit,
        work: m.work,
        event: 'revert',
        sha: a.revert.sha,
        disputed: d,
      })
      if (d) s.disputed++
      else s.reverts++
    }
    if (a.main === 'attributed') {
      const d = disputed(m.commit, 'main')
      const sha = a.main_run?.sha ?? m.commit
      s.events.push({ merge_commit: m.commit, work: m.work, event: 'main', sha, disputed: d })
      if (d) s.disputed++
      else s.main.attributed++
    } else if (a.main === 'unmeasurable') s.unmeasurable++
    else if (a.main !== 'clean') s.main[a.main]++
  }
  if (s.closed > 0 && s.reverts === 0 && s.main.attributed === 0)
    s.upper = Math.min(1, 3 / s.closed)
  return s
}

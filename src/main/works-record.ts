// 끝까지 따라가기 (M4b, docs/m4-design.md 4절, V48). 장부에서 끝이 정해지지 않은 내보내기를 모아 끝난 Work의 것을 따라간다:
// PR이 앱 밖에서 머지·닫혔으면 끝 줄(머지 커밋, 머지한 때, 같은 변경)을 쓰고, PR 없이 [끝내기]한 것은 no_pr, [버림]은
// discarded로 쓴다. no_pr의 head가 90일 안에 기준 브랜치에 닿으면(로컬 머지) human-override 머지로, 닿지 않고 90일이 지나면
// unmerged로 쓴다. 진행 중 Work는 PR 확인(works-exports.ts fate)이 그대로 쓴다: 이 파일은 그것이 놓친 Work가 끝난 뒤의 끝을
// 맡는다. 같은 변경(engine/follow.ts sameChange)의 사실은 $RELAY_HOME의 거울(adapters/mirror.ts)에서 읽는다. 사용자 레포는
// 읽기만 한다(ref·설정·객체를 바꾸지 않는다). 계기: 앱 시작, 새 Work, 앱이 도는 동안 6시간마다. 프로젝트마다 한 번에 하나만.
// 같은 계기에 머지 뒤 30일(M4d, works-after.ts)도 본다. 끝 줄마다 세션 커밋 가르기(M4e)의 칸: 머지 뒤 커밋의 갈래(after_commits,
// 앞 결론 줄 head마다 after_heads)와 세션 커밋 집합의 셈(works-session-log.ts).

import { isAncestor, logRange, mergeBase, patchId, type LogCommit } from '../adapters/git.ts'
import type { PrInfo } from '../adapters/gh.ts'
import { hasCommit } from '../adapters/mirror.ts'
import { readJson } from '../adapters/store.ts'
import type { EvidenceBundle } from '../core/types.ts'
import {
  fateResult,
  exportHeads,
  lastConclusion,
  noPrExpired,
  sameChange,
  unsettled,
  type BetweenCommit,
  type Unsettled,
} from '../engine/follow.ts'
import type { AfterCommits, LedgerEntry } from '../engine/ledger.ts'
import { NO_COMMITS } from '../engine/session-commits.ts'
import {
  upgradeWork,
  type ExportRecord,
  type ProjectRecord,
  type Store,
  type WorkRecord,
} from './store.ts'
import { acceptedOf } from './works-debt.ts'
import { followAfter } from './works-after.ts'
import { ledgerEntry, type LedgerDeps } from './works-ledger.ts'
import { changeFacts, earlierAfter, heads, Mirror } from './works-change.ts'
import { afterOf, sessionLedger, sessionOf } from './works-session-log.ts'
import { isActive } from './works-types.ts'

/** 앱이 도는 동안 따라가는 간격 */
export const FOLLOW_MS = 6 * 60 * 60 * 1000

/** PR 없이 끝난 head의 squash를 찾으려 patch-id를 견줄 기준 커밋 수 */
const SQUASH_SCAN_MAX = 100
/** squash를 찾는 기준 커밋의 시각을 내보낸 때보다 이만큼 앞에서부터 본다(시계 어긋남) */
const SQUASH_SLACK_MS = 24 * 60 * 60 * 1000

export interface RecordDeps extends LedgerDeps {
  store: Store
  gh: Pick<typeof import('../adapters/gh.ts'), 'listPr' | 'prMerge' | 'runsAt' | 'serverProtection'>
  log?: (message: string, error?: unknown) => void
  /** 장부에 줄을 썼다(화면의 [실적]을 다시 읽게) */
  onChange?: (projectId: string) => void
}

/** 머지 끝 줄의 M4b 칸과 M4e 칸(머지 뒤 커밋의 갈래, 세션 커밋 집합의 셈) */
export type MergeFields = Pick<
  LedgerEntry,
  | 'merge_commit'
  | 'merged_at'
  | 'same_change'
  | 'pr'
  | 'after_commits'
  | 'after_heads'
  | 'trailer'
  | 'session_set'
>

/**
 * 머지 끝 줄의 M4b 칸(m4-design 4.1): 머지 커밋과 머지한 때(gh pr view), 내보낸 head와 머지된 head가 같은 변경인가(같은
 * SHA면 거울을 보지 않는다). 읽지 못한 칸은 비우고 같은 변경은 null(모름)이다. M4e 칸: 끝 줄의 head와 앞 결론 줄의 head(earlier)
 * 뒤 머지된 head까지의 커밋 갈래, 세션 커밋 집합의 셈
 */
export async function mergedFields(
  deps: RecordDeps,
  o: {
    project: ProjectRecord
    rec: WorkRecord
    x: ExportRecord
    pr: PrInfo
    /** 내보낸 head(그 내보내기의 마지막 결론 줄) */
    last: LedgerEntry | undefined
    /** 그 내보내기의 결론 줄 head(follow.ts exportHeads) */
    earlier: readonly string[]
    mirror?: Mirror
  },
): Promise<MergeFields> {
  const { project, rec, x, pr } = o
  const m = await deps.gh.prMerge(project.path, pr.number)
  const mergeCommit = m.ok ? m.mergeCommit : null
  const mergedAt = (m.ok ? m.mergedAt : null) ?? pr.mergedAt
  const head = o.last?.head ?? pr.headRefOid
  const session = await sessionOf(deps.store, rec.id)
  let same: boolean | null = head === pr.headRefOid ? true : null
  // 머지 뒤 커밋의 갈래(M4e): 같은 SHA면 없음, 아니면 거울의 사이 커밋을 세션 커밋 집합과 트레일러로 가른다
  let after: AfterCommits | null = same ? { ...NO_COMMITS } : null
  let earlier: Record<string, AfterCommits> = {}
  const job = { heads: o.earlier, merged: pr.headRefOid, session, work: rec.id }
  if (same === null) {
    const mirror = o.mirror ?? new Mirror(deps.store.home, project.path, rec.base, deps.log)
    const dir = await mirror.dir()
    if (dir !== null) {
      await mirror.take(dir, pr.number, x.branch)
      const facts = await changeFacts(dir, mirror.baseRef, {
        head,
        merged: pr.headRefOid,
        mergeCommit,
        baseSha: o.last?.base_sha ?? null,
        debts: session.debts,
      }).catch((e: unknown) => {
        deps.log?.(`같은 변경을 가리지 못함 (${rec.id})`, e)
        return null
      })
      same = facts === null ? null : sameChange(facts)
      if (facts?.between) after = afterOf(session, rec.id, facts.between)
      const known = mergeCommit !== null && (await hasCommit(dir, mergeCommit))
      const exclude = known ? `${mergeCommit}^1` : mirror.baseRef
      earlier = await earlierAfter(dir, mirror.baseRef, { ...job, exclude })
    }
  } else earlier = await earlierAfter(rec.worktree, rec.base_ref, { ...job, exclude: rec.base_ref })
  return {
    pr: pr.number,
    ...(mergeCommit ? { merge_commit: mergeCommit } : {}),
    ...(mergedAt ? { merged_at: mergedAt } : {}),
    same_change: same,
    ...sessionLedger(session, after),
    ...heads(earlier),
  }
}

/** PR 없이 끝난 head가 기준에 닿은 끝(로컬 머지) */
interface Reached {
  /** 기준에 들어간 Work 쪽 끝: fast-forward와 squash면 head, merge면 머지 커밋의 둘째 부모 */
  merged: string
  /** merge·squash의 기준 커밋. fast-forward면 null */
  mergeCommit: string | null
  /** head와 merged가 같은 변경인가(engine/follow.ts sameChange). 모르면 null */
  same: boolean | null
  /** head..merged 사이 커밋(없으면 빈 것, 못 읽었으면 null) */
  between: BetweenCommit[] | null
  /** 머지 전 기준(앞 head 갈래의 exclude) */
  exclude: string
}

/**
 * 기준 first-parent 커밋(새 것부터) 가운데 head를 처음 담은 커밋. head를 담은 커밋은 새 것부터 이어지므로 이분해 찾는다. 목록
 * 끝까지 담았고 그 앞(첫 부모)도 담으면 목록 밖이라 null
 */
async function landingOf(
  dir: string,
  head: string,
  commits: readonly LogCommit[],
): Promise<LogCommit | null> {
  const has = async (sha: string) => sha === head || (await isAncestor(dir, head, sha))
  let lo = 0
  let hi = commits.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    const c = commits[mid]
    if (c && (await has(c.sha))) lo = mid + 1
    else hi = mid
  }
  const land = commits[lo - 1]
  if (!land) return null
  const p1 = land.parents[0]
  if (lo === commits.length && p1 !== undefined && (await has(p1))) return null
  return land
}

/**
 * PR 없이 끝난 head가 기준 브랜치에 닿았나(사람이 Work 브랜치를 로컬에서 합침). head가 기준의 조상이면 기준 first-parent에서
 * head를 처음 담은 커밋을 찾는다: head 자신이면 fast-forward(같은 변경), merge면 그 둘째 부모가 머지된 끝이고 head와 다르면
 * 사이 커밋으로 같은 변경을 가린다(사람이 head 뒤에 더 커밋해 합침). 아니면 내보낸 때 뒤의 기준 first-parent 커밋 가운데 head의
 * 변경과 patch-id가 같은 것(로컬 squash). 거울이나 head를 읽지 못했거나 머지된 끝을 정하지 못하면 null(모름)
 */
async function reached(
  mirror: Mirror,
  u: Unsettled,
  branch: string,
  debts: ReadonlySet<string>,
): Promise<Reached | false | null> {
  const dir = await mirror.dir()
  if (dir === null) return null
  await mirror.take(dir, null, branch)
  const head = u.last.head
  if (!(await hasCommit(dir, head))) return null
  const since = new Date(Date.parse(u.since) - SQUASH_SLACK_MS).toISOString()
  const commits = await logRange(dir, {
    to: mirror.baseRef,
    since,
    firstParent: true,
    max: SQUASH_SCAN_MAX,
  })
  if (await isAncestor(dir, head, mirror.baseRef)) {
    const land = await landingOf(dir, head, commits)
    if (land === null) return null
    if (land.sha === head)
      return { merged: head, mergeCommit: null, same: true, between: [], exclude: `${head}^1` }
    const exclude = `${land.sha}^1`
    let merged: string | null = null
    for (const p of land.parents.slice(1))
      if (merged === null && (p === head || (await isAncestor(dir, head, p)))) merged = p
    if (merged === null) return null
    if (merged === head) return { merged, mergeCommit: land.sha, same: true, between: [], exclude }
    const facts = await changeFacts(dir, mirror.baseRef, {
      head,
      merged,
      mergeCommit: land.sha,
      baseSha: u.last.base_sha ?? null,
      debts,
    })
    return {
      merged,
      mergeCommit: land.sha,
      same: sameChange(facts),
      between: facts.between,
      exclude,
    }
  }
  const base = u.last.base_sha
  const from =
    base !== undefined && (await hasCommit(dir, base))
      ? base
      : await mergeBase(dir, head, mirror.baseRef)
  const want = await patchId(dir, from, head)
  if (want === null) return false
  for (const c of commits) {
    const parent = c.parents[0]
    if (c.parents.length === 1 && parent && (await patchId(dir, parent, c.sha)) === want)
      return { merged: head, mergeCommit: c.sha, same: true, between: [], exclude: `${c.sha}^1` }
  }
  return false
}

/** 끝난 Work의 내보내기를 따라간다. 프로젝트마다 한 번에 하나만 돈다 */
export class RecordFollower {
  private readonly deps: RecordDeps
  private readonly running = new Map<string, Promise<void>>()
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(deps: RecordDeps) {
    this.deps = deps
  }

  /** 지금 모든 프로젝트를 따라가고, 그 뒤 everyMs마다 다시 한다 */
  start(everyMs = FOLLOW_MS): void {
    if (this.timer) return
    void this.followAll()
    this.timer = setInterval(() => void this.followAll(), everyMs)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async followAll(): Promise<void> {
    const projects = await this.deps.store.readProjects().catch(() => [])
    for (const p of projects) await this.follow(p.id)
  }

  /** 이 프로젝트를 따라간다. 이미 돌고 있으면 그것을 기다린다. 실패는 log하고 삼킨다 */
  follow(projectId: string): Promise<void> {
    const now = this.running.get(projectId)
    if (now) return now
    const job = this.run(projectId)
      .catch((e: unknown) => this.deps.log?.(`끝까지 따라가지 못함 (${projectId})`, e))
      .finally(() => this.running.delete(projectId))
    this.running.set(projectId, job)
    return job
  }

  private async run(projectId: string): Promise<void> {
    const { store } = this.deps
    const project = (await store.readProjects()).find((p) => p.id === projectId)
    if (!project) return
    // Work 기록을 장부보다 먼저 읽는다: 앱은 끝 줄을 쓴 뒤 Work를 끝내므로 끝난 Work의 끝 줄은 뒤에 읽는 장부에 있다
    const works = new Map<string, WorkRecord>()
    for (const id of await store.listWorkIds()) {
      const w = await store.readWork(id)
      if (w !== null && w.project === projectId) works.set(id, upgradeWork(w))
    }
    const ledger = await store.readLedger()
    const mirrors = new Map<string, Mirror>()
    const mirrorFor = (base: string) => {
      const m = mirrors.get(base) ?? new Mirror(store.home, project.path, base, this.deps.log)
      mirrors.set(base, m)
      return m
    }
    for (const u of unsettled(ledger, projectId)) {
      const rec = works.get(u.work)
      if (!rec || isActive(rec.state)) continue
      await this.settle(project, rec, u, mirrorFor(rec.base), ledger).catch((e: unknown) =>
        this.deps.log?.(`내보내기를 따라가지 못함 (${rec.id})`, e),
      )
    }
    // 머지 뒤 30일(M4d): 진행 중 Work(단위 브랜치의 내보내기)의 머지도 본다
    await followAfter(this.deps, project, works, await store.readRecord(), mirrorFor).catch(
      (e: unknown) => this.deps.log?.(`머지 뒤 30일을 보지 못함 (${projectId})`, e),
    )
    this.deps.onChange?.(projectId)
  }

  /** 내보내기 하나의 끝을 본다(m4-design 4.2) */
  private async settle(
    project: ProjectRecord,
    rec: WorkRecord,
    u: Unsettled,
    mirror: Mirror,
    ledger: LedgerEntry[],
  ): Promise<void> {
    const x = rec.exports.find((e) => e.unit === u.export)
    if (!x) return
    const found = await this.deps.gh.listPr(project.path, x.branch)
    // gh가 읽지 못했거나, 알던 PR이 보이지 않거나, 다른 기준으로 간 PR이면 끝을 정하지 않는다
    if (!found.ok || (found.pr === null && x.pr !== null)) return
    const pr = found.pr
    if (pr !== null && pr.baseRefName !== rec.base) return
    // 끝 줄마다 세션 커밋 집합의 셈(M4e). 머지 칸이 갈래를 가져오면 그것을 쓴다
    const session = await sessionOf(this.deps.store, rec.id)
    const write = (extra: Partial<LedgerEntry>, head = u.last.head) =>
      this.deps.store.appendLedger(
        ledgerEntry(this.deps, rec, x, project, head, fateResult(u.last), {
          ...sessionLedger(session, null),
          ...extra,
        }),
      )
    if (pr?.state === 'OPEN') return
    if (pr?.state === 'MERGED') {
      const last = lastConclusion(ledger, rec.id, x.unit)
      const earlier = exportHeads(ledger, rec.id, x.unit)
      const fields = await mergedFields(this.deps, { project, rec, x, pr, last, earlier, mirror })
      return write({
        by: 'human-override',
        merged_head: pr.headRefOid,
        ...fields,
        ...(await this.accepted(x, pr.headRefOid)),
      })
    }
    if (pr?.state === 'CLOSED') return write({ closed: true, pr: pr.number })
    // PR 없이 끝남(Q8): 버림은 불일치. [끝내기]는 기준에 닿는지 90일 동안 본다
    if (rec.state === 'abandoned') return write({ ended: 'discarded' })
    if (u.noPrAt === null) await write({ ended: 'no_pr' })
    const got = await reached(mirror, u, x.branch, session.debts).catch((e: unknown) => {
      this.deps.log?.(`기준에 닿았는지 보지 못함 (${rec.id})`, e)
      return null
    })
    if (got) {
      // 머지 뒤 커밋의 갈래(M4e): 사이가 없으면 0, 있으면 세션 커밋 집합과 트레일러로 가른다(집합을 모르면 없음)
      const after =
        got.between?.length === 0
          ? { ...NO_COMMITS }
          : got.between
            ? afterOf(session, rec.id, got.between)
            : null
      const dir = await mirror.dir()
      const earlier =
        dir === null
          ? {}
          : await earlierAfter(dir, mirror.baseRef, {
              heads: exportHeads(ledger, rec.id, x.unit),
              merged: got.merged,
              exclude: got.exclude,
              session,
              work: rec.id,
            }).catch(() => ({}))
      return write({
        by: 'human-override',
        merged_head: got.merged,
        same_change: got.same,
        ...(got.mergeCommit ? { merge_commit: got.mergeCommit } : {}),
        ...sessionLedger(session, after),
        ...heads(earlier),
      })
    }
    // 90일은 그 내보내기의 첫 결론 줄부터(shadow.ts의 추적 잃음과 같은 시계): 늦게 처음 따라가도 늦춰지지 않는다
    if (got === false && noPrExpired(u.since, this.deps.now())) return write({ ended: 'unmerged' })
  }

  /** 잰 head를 앱 밖에서 머지했으면 그 나빠진 래칫도 받아들였다(M3b, works-exports.ts fate와 같다) */
  private async accepted(x: ExportRecord, merged: string): Promise<Pick<LedgerEntry, 'accepted'>> {
    const b = x.evidence_path ? await readJson<EvidenceBundle>(x.evidence_path) : null
    return b?.head === merged ? acceptedOf(b) : {}
  }
}

/** 머지된 PR의 머지 커밋과 때(gh pr view). 읽지 못하면 빈 것 */
export async function mergeOf(
  deps: Pick<RecordDeps, 'gh'>,
  repo: string,
  n: number,
): Promise<Pick<LedgerEntry, 'merge_commit' | 'merged_at'>> {
  const m = await deps.gh.prMerge(repo, n)
  if (!m.ok) return {}
  return {
    ...(m.mergeCommit ? { merge_commit: m.mergeCommit } : {}),
    ...(m.mergedAt ? { merged_at: m.mergedAt } : {}),
  }
}

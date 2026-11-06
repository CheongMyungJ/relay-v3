// 끝까지 따라가기 (M4b, docs/m4-design.md 4절, V48). 장부에서 끝이 정해지지 않은 내보내기를 모아 끝난 Work의 것을 따라간다:
// PR이 앱 밖에서 머지·닫혔으면 끝 줄(머지 커밋, 머지한 때, 같은 변경)을 쓰고, PR 없이 [끝내기]한 것은 no_pr, [버림]은
// discarded로 쓴다. no_pr의 head가 90일 안에 기준 브랜치에 닿으면(로컬 머지) human-override 머지로, 닿지 않고 90일이 지나면
// unmerged로 쓴다. 진행 중 Work는 PR 확인(works-exports.ts fate)이 그대로 쓴다: 이 파일은 그것이 놓친 Work가 끝난 뒤의 끝을
// 맡는다. 같은 변경(engine/follow.ts sameChange)의 사실은 $RELAY_HOME의 거울(adapters/mirror.ts)에서 읽는다. 사용자 레포는
// 읽기만 한다(ref·설정·객체를 바꾸지 않는다). 계기: 앱 시작, 새 Work, 앱이 도는 동안 6시간마다. 프로젝트마다 한 번에 하나만.
// 같은 계기에 머지 뒤 30일(M4d, works-after.ts)도 본다. 끝 줄마다 세션 커밋 가르기(M4e)의 칸: 머지 뒤 커밋의 갈래(after_commits,
// 앞 결론 줄 head마다 after_heads)와 세션 커밋 집합의 셈(works-session-log.ts).

import {
  isAncestor,
  logRange,
  mergeBase,
  mergeTree,
  patchId,
  type LogCommit,
} from '../adapters/git.ts'
import type { PrInfo } from '../adapters/gh.ts'
import {
  ensureMirror,
  fetchBase,
  fetchPr,
  fetchWork,
  hasCommit,
  prRef,
  workRef,
} from '../adapters/mirror.ts'
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
  type ChangeFacts,
  type Unsettled,
} from '../engine/follow.ts'
import type { AfterCommits, LedgerEntry } from '../engine/ledger.ts'
import { NO_COMMITS, workTrailers } from '../engine/session-commits.ts'
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
import { afterOf, sessionLedger, sessionOf } from './works-session-log.ts'
import type { SessionSet } from '../engine/session-commits.ts'
import { isActive } from './works-types.ts'

/** 앱이 도는 동안 따라가는 간격 */
export const FOLLOW_MS = 6 * 60 * 60 * 1000

/** 사이 커밋이 이보다 많으면 같은 변경을 모름으로 둔다(거울을 오래 붙잡지 않게) */
const BETWEEN_MAX = 200
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
 * 한 번의 따라가기에서 쓰는 거울(프로젝트 하나, 기준 브랜치 하나): 처음 쓸 때 만들고 기준을 받으며, PR ref와 Work 브랜치는
 * 하나씩 한 번만 받는다. 거울을 만들거나 기준을 받지 못하면 dir이 null이다(같은 변경은 1번만 보고 나머지는 모름)
 */
export class Mirror {
  private readonly home: string
  private readonly repo: string
  private readonly base: string
  private readonly log: (message: string, error?: unknown) => void
  private dirP: Promise<string | null> | null = null
  private readonly got = new Map<string, Promise<boolean>>()

  constructor(home: string, repo: string, base: string, log: RecordDeps['log']) {
    this.home = home
    this.repo = repo
    this.base = base
    this.log = log ?? (() => {})
  }

  get baseRef(): string {
    return `refs/heads/${this.base}`
  }

  dir(): Promise<string | null> {
    this.dirP ??= (async () => {
      const dir = await ensureMirror(this.home, this.repo)
      await fetchBase(dir, this.base)
      return dir
    })().catch((e: unknown) => {
      this.log(`거울을 갱신하지 못함 (${this.repo})`, e)
      return null
    })
    return this.dirP
  }

  /** PR의 head와 Work 브랜치(사용자 레포)를 받는다. 받지 못한 것은 건너뛴다 */
  async take(dir: string, pr: number | null, branch: string): Promise<void> {
    const once = (key: string, job: () => Promise<boolean>) => {
      if (!this.got.has(key)) this.got.set(key, job())
      return this.got.get(key)
    }
    if (pr !== null) await once(prRef(pr), () => fetchPr(dir, pr))
    await once(workRef(branch), () => fetchWork(dir, this.repo, branch))
  }
}

/** 이 커밋이 깨끗한 기준 맞춤 머지인가: 부모 둘 가운데 하나가 기준에 있고, tree가 두 부모를 합친 트리와 같다 */
async function baseUpdate(dir: string, c: LogCommit, baseRef: string): Promise<boolean> {
  const [p1, p2] = c.parents
  if (c.parents.length !== 2 || p1 === undefined || p2 === undefined) return false
  const onBase = (await isAncestor(dir, p1, baseRef)) || (await isAncestor(dir, p2, baseRef))
  return onBase && (await mergeTree(dir, p1, p2)) === c.tree
}

/** head..merged 사이의 PR 쪽 커밋(머지 전 기준 exclude에서 닿는 것은 뺀다: 맞춤 머지가 들여온 기준 커밋). 너무 많으면 null */
async function betweenOf(
  dir: string,
  o: { head: string; merged: string; exclude: string; baseRef: string },
): Promise<BetweenCommit[] | null> {
  const commits = await logRange(dir, {
    from: o.head,
    to: o.merged,
    exclude: [o.exclude],
    max: BETWEEN_MAX + 1,
  })
  if (commits.length > BETWEEN_MAX) return null
  const out: BetweenCommit[] = []
  for (const c of commits)
    out.push({
      sha: c.sha,
      author: c.author,
      baseUpdate: await baseUpdate(dir, c, o.baseRef),
      trailers: workTrailers(c.body),
    })
  return out
}

const orNull = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null)

/**
 * 거울에서 같은 변경의 사실을 읽는다(m4-design 4.3). 머지 전 기준은 머지 커밋의 첫 부모이고, 머지 커밋을 모르면 기준
 * 브랜치다(merged가 이미 기준에 있으면 머지 전 기준을 몰라 사이 커밋과 머지 쪽 patch-id를 모른다). head 쪽 patch-id는 결론
 * 줄의 base_sha(묶음의 base)에서, 머지 쪽은 머지 전 기준과 merged의 공통 조상에서 잰다. 못 읽은 칸은 null
 */
export async function changeFacts(
  dir: string,
  baseRef: string,
  o: { head: string; merged: string; mergeCommit: string | null; baseSha: string | null },
): Promise<ChangeFacts> {
  const { head, merged } = o
  const facts: ChangeFacts = {
    head,
    merged,
    ancestor: null,
    between: null,
    patch: { head: null, merged: null },
  }
  if (head === merged || !(await hasCommit(dir, merged))) return facts
  const known = o.mergeCommit !== null && (await hasCommit(dir, o.mergeCommit))
  const before = known ? `${o.mergeCommit}^1` : baseRef
  if (!known && (await orNull(isAncestor(dir, merged, baseRef))) !== false) {
    // 머지 전 기준을 모른다
    return facts
  }
  const headKnown = await hasCommit(dir, head)
  if (headKnown) facts.ancestor = await orNull(isAncestor(dir, head, merged))
  if (facts.ancestor === true)
    facts.between = await orNull(betweenOf(dir, { head, merged, exclude: before, baseRef }))
  if (sameChange(facts) === true) return facts
  const from =
    o.baseSha !== null && (await hasCommit(dir, o.baseSha))
      ? o.baseSha
      : headKnown
        ? await orNull(mergeBase(dir, head, before))
        : null
  const mb = await orNull(mergeBase(dir, merged, before))
  facts.patch = {
    head: headKnown && from !== null ? await orNull(patchId(dir, from, head)) : null,
    merged: mb !== null && mb !== merged ? await orNull(patchId(dir, mb, merged)) : null,
  }
  return facts
}

/** 앞 결론 줄의 head를 이만큼까지 가른다(최근 것) */
const EARLIER_MAX = 20

/**
 * 앞 결론 줄의 head마다 그 head 뒤 merged까지의 커밋 갈래(M4e after_heads: 다시 내보내기 전에 세션이나 사람이 더 고친 것). dir은
 * 두 커밋이 다 있는 레포(거울, 같은 SHA의 머지면 Work의 worktree), exclude는 머지 전 기준. merged의 조상이 아니거나 읽지 못한
 * head는 뺀다(모름). 세션 커밋 집합을 모르면 빈 것
 */
export async function earlierAfter(
  dir: string,
  baseRef: string,
  o: {
    heads: readonly string[]
    merged: string
    exclude: string
    session: { set: SessionSet }
    work: string
  },
): Promise<Record<string, AfterCommits>> {
  const out: Record<string, AfterCommits> = {}
  if (!o.session.set.launched) return out
  for (const head of o.heads.filter((h) => h !== o.merged).slice(-EARLIER_MAX)) {
    if (!(await hasCommit(dir, head)) || (await orNull(isAncestor(dir, head, o.merged))) !== true)
      continue
    const between = await orNull(
      betweenOf(dir, { head, merged: o.merged, exclude: o.exclude, baseRef }),
    )
    const after = between && afterOf(o.session, o.work, between)
    if (after) out[head] = after
  }
  return out
}

const heads = (h: Record<string, AfterCommits>) =>
  Object.keys(h).length > 0 ? { after_heads: h } : {}

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

/**
 * PR 없이 끝난 head가 기준 브랜치에 닿았나(사람이 Work 브랜치를 로컬에서 합침): head가 기준의 조상이거나, 내보낸 때 뒤의 기준
 * first-parent 커밋 가운데 head의 변경과 patch-id가 같은 것(로컬 squash)이 있음. 거울이나 head를 읽지 못하면 null(모름)
 */
async function reached(
  mirror: Mirror,
  u: Unsettled,
  branch: string,
): Promise<{ merge_commit?: string } | false | null> {
  const dir = await mirror.dir()
  if (dir === null) return null
  await mirror.take(dir, null, branch)
  const head = u.last.head
  if (!(await hasCommit(dir, head))) return null
  if (await isAncestor(dir, head, mirror.baseRef)) return {}
  const base = u.last.base_sha
  const from =
    base !== undefined && (await hasCommit(dir, base))
      ? base
      : await mergeBase(dir, head, mirror.baseRef)
  const want = await patchId(dir, from, head)
  if (want === null) return false
  const since = new Date(Date.parse(u.since) - SQUASH_SLACK_MS).toISOString()
  const commits = await logRange(dir, {
    to: mirror.baseRef,
    since,
    firstParent: true,
    max: SQUASH_SCAN_MAX,
  })
  for (const c of commits) {
    const parent = c.parents[0]
    if (c.parents.length === 1 && parent && (await patchId(dir, parent, c.sha)) === want)
      return { merge_commit: c.sha }
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
    let noPrAt = u.noPrAt
    if (noPrAt === null) {
      noPrAt = this.deps.now()
      await write({ ended: 'no_pr' })
    }
    const got = await reached(mirror, u, x.branch).catch((e: unknown) => {
      this.deps.log?.(`기준에 닿았는지 보지 못함 (${rec.id})`, e)
      return null
    })
    if (got)
      return write({
        by: 'human-override',
        merged_head: u.last.head,
        same_change: true,
        after_commits: { ...NO_COMMITS },
        ...got,
      })
    if (got === false && noPrExpired(noPrAt, this.deps.now())) return write({ ended: 'unmerged' })
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

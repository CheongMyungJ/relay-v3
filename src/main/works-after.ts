// 머지 뒤 30일 (M4d, docs/m4-design.md 6절). 끝까지 따라가기(works-record.ts RecordFollower)가 같은 계기(앱 시작, 새 Work, 6시간
// 마다)에 부른다. 장부의 머지(앱의 [머지], 정책 머지, 앱 밖 머지, PR 없이 끝난 Work의 로컬 머지 모두)마다 merged_at부터 30일 동안
// 기준 브랜치의 되돌림(거울의 이력, engine/after-merge.ts revertsOf)과 머지 커밋의 main 실패(gh의 push 실행, mainOf)를 본다.
// 이력을 소급해 읽으므로 앱이 꺼져 있던 동안도 잃지 않는다. 창 안에서는 처음 본 사건만, 창이 닫히면 한 줄(kind 'after')을 쓴다.
// 앱은 CI를 다시 돌리지 않는다(사용자 인프라의 부작용): 실패했는데 다시 시도가 없으면 미정으로 둔다. 사용자 레포는 읽기만 한다.

import {
  isAncestor,
  logRange,
  mergeBase,
  patchId,
  showFile,
  type LogCommit,
} from '../adapters/git.ts'
import type { WorkflowRun } from '../adapters/gh.ts'
import { hasCommit, originUrl } from '../adapters/mirror.ts'
import { parseQuality } from '../core/quality.ts'
import type { ServerProtection } from '../core/types.ts'
import {
  lastAfter,
  mainOf,
  repoSlug,
  revertsOf,
  windowEnd,
  type AfterLine,
  type RecordFile,
} from '../engine/after-merge.ts'
import { QUALITY_PATH } from '../engine/check.ts'
import { exportKey, type LedgerEntry } from '../engine/ledger.ts'
import type { MainState } from '../shared/api.ts'
import type { ProjectRecord, Store, WorkRecord } from './store.ts'
import type { Mirror } from './works-change.ts'

/** 머지 하나가 올린 커밋을 셀 때 읽는 PR 커밋의 상한 */
const PR_COMMITS_MAX = 200
/** 창 안에서 읽는 기준 커밋의 상한 */
const WINDOW_COMMITS_MAX = 5000
/** 다시 재지 않는 main 상태(그 커밋의 실행이 끝나 정해짐) */
const SETTLED: ReadonlySet<MainState> = new Set(['attributed', 'inherited', 'clean'])
/** 창 안에서 줄을 쓰는 사건 */
const EVENTS: ReadonlySet<MainState> = new Set(['attributed', 'pending', 'inherited'])

export interface AfterDeps {
  store: Pick<Store, 'appendLedger'>
  gh: {
    runsAt: typeof import('../adapters/gh.ts').runsAt
    serverProtection: typeof import('../adapters/gh.ts').serverProtection
  }
  now: () => string
  log?: (message: string, error?: unknown) => void
}

/** 장부에서 이 프로젝트의 내보내기마다 마지막 머지 끝 줄 */
function mergesOf(entries: readonly LedgerEntry[], project: string): LedgerEntry[] {
  const out = new Map<string, LedgerEntry>()
  for (const e of entries) if (e.project === project && e.merged_head) out.set(exportKey(e), e)
  return [...out.values()]
}

const iso = (unixSeconds: number) => new Date(unixSeconds * 1000).toISOString()

/**
 * 머지 M이 기준에 올린 커밋과 그 제목: merge 머지(부모 둘)면 M과 PR 커밋(M^1..M^2), squash면 M, rebase(부모 하나이고 M의
 * patch-id가 PR의 마지막 커밋과 같음)면 M에서 first-parent로 PR 커밋 수만큼. 로컬 fast-forward(M이 머지된 head)는 M
 */
async function landedOf(dir: string, m: LogCommit, mergedHead: string): Promise<LogCommit[]> {
  const [p1, p2] = m.parents
  if (p1 !== undefined && p2 !== undefined)
    return [m, ...(await logRange(dir, { from: p1, to: p2, max: PR_COMMITS_MAX }))]
  if (p1 === undefined || mergedHead === m.sha || !(await hasCommit(dir, mergedHead))) return [m]
  const from = await mergeBase(dir, mergedHead, p1).catch(() => null)
  if (from === null) return [m]
  const pr = await logRange(dir, { from, to: mergedHead, max: PR_COMMITS_MAX })
  const last = pr[0]
  const lastParent = last?.parents[0]
  if (pr.length < 2 || last === undefined || lastParent === undefined) return [m]
  const same = (await patchId(dir, p1, m.sha)) === (await patchId(dir, lastParent, last.sha))
  return same ? logRange(dir, { to: m.sha, firstParent: true, max: pr.length }) : [m]
}

/** 머지 커밋의 레포가 main 실패를 잴 수 있나: 그 커밋의 quality.json에 ci_checks가 있거나 서버 보호에 필수 검사가 있다 */
async function measurable(
  dir: string,
  sha: string,
  server: ServerProtection | null,
): Promise<boolean> {
  if (server?.required_checks === true) return true
  const text = await showFile(dir, sha, QUALITY_PATH).catch(() => null)
  const q = text === null ? null : parseQuality(text)
  return q?.ok === true && (q.value.commands.full?.ci_checks?.length ?? 0) > 0
}

const runsOrNull = async (
  deps: AfterDeps,
  repo: string,
  sha: string | null,
): Promise<WorkflowRun[] | null> => {
  if (sha === null) return null
  const r = await deps.gh.runsAt(repo, sha)
  return r.ok ? r.runs : null
}

/**
 * 이 프로젝트의 머지마다 머지 뒤 30일을 본다(m4-design 6절). 창이 닫힌 머지는 다시 보지 않는다. 거울이나 머지 커밋을 읽지 못한
 * 머지는 다음 계기로 미룬다. 쓴 줄 수를 돌려준다
 */
export async function followAfter(
  deps: AfterDeps,
  project: ProjectRecord,
  works: ReadonlyMap<string, WorkRecord>,
  record: RecordFile,
  mirrorFor: (base: string) => Mirror,
): Promise<number> {
  const last = lastAfter(record.after, project.id)
  const servers = new Map<string, Promise<ServerProtection | null>>()
  let slug: Promise<string | null> | null = null
  let written = 0
  for (const m of mergesOf(record.entries, project.id)) {
    const rec = works.get(m.work)
    const commit = m.merge_commit ?? m.merged_head ?? ''
    const start = m.merged_at ?? m.ts
    const end = windowEnd(start)
    const prev = last.get(commit)
    if (!rec || end === null || prev?.closed) continue
    const x = rec.exports.find((e) => (e.unit ?? undefined) === m.export)
    const mirror = mirrorFor(rec.base)
    const dir = await mirror.dir()
    if (dir === null) continue
    await mirror.take(dir, m.pr ?? null, x?.branch ?? rec.branch)
    if (!(await hasCommit(dir, commit)) || !(await isAncestor(dir, commit, mirror.baseRef))) {
      deps.log?.(`머지 커밋이 기준에 없음 (${rec.id}): ${commit}`)
      continue
    }
    const now = deps.now()
    const [mc] = await logRange(dir, { to: commit, max: 1 })
    if (!mc) continue
    const landed = await landedOf(dir, mc, m.merged_head ?? commit)
    slug ??= originUrl(project.path).then(repoSlug, () => null)
    const window = await logRange(dir, {
      to: mirror.baseRef,
      since: start,
      until: end,
      exclude: [commit],
      max: WINDOW_COMMITS_MAX,
    })
    const revert =
      prev?.revert ??
      revertsOf(window.reverse(), {
        landed: landed.map((c) => c.sha),
        subjects: landed.map((c) => c.body.split('\n')[0]?.trim() ?? ''),
        pr: m.pr ?? null,
        slug: await slug,
      })
    let main: Pick<AfterLine, 'main' | 'main_run'>
    if (prev && SETTLED.has(prev.main)) main = pick(prev)
    else {
      if (!servers.has(rec.base))
        servers.set(
          rec.base,
          deps.gh.serverProtection(project.path, rec.base).catch(() => null),
        )
      const parent = mc.parents[0] ?? null
      main = mainOf({
        sha: commit,
        parent,
        runs: await runsOrNull(deps, project.path, commit),
        parentRuns: await runsOrNull(deps, project.path, parent),
        measurable: await measurable(dir, commit, (await servers.get(rec.base)) ?? null),
      })
      // gh를 읽지 못해 모름이 됐으면 앞에서 본 것을 지우지 않는다
      if (main.main === 'unknown' && prev && prev.main !== 'unknown') main = pick(prev)
    }
    const [tip] = await logRange(dir, { to: mirror.baseRef, max: 1 })
    const closed = Date.parse(now) >= Date.parse(end)
    const event = revert !== null || EVENTS.has(main.main)
    const changed =
      JSON.stringify([revert?.sha, main.main]) !== JSON.stringify([prev?.revert?.sha, prev?.main])
    if (!closed && !(event && changed)) continue
    const line: AfterLine = {
      kind: 'after',
      ts: now,
      project: project.id,
      work: rec.id,
      ...(m.export === undefined ? {} : { export: m.export }),
      merge_commit: commit,
      merged_at: start,
      window_end: end,
      closed,
      revert,
      ...main,
      seen_until: tip ? iso(tip.time) : now,
    }
    await deps.store.appendLedger(line)
    written++
  }
  return written
}

const pick = (a: AfterLine): Pick<AfterLine, 'main' | 'main_run'> => ({
  main: a.main,
  ...(a.main_run ? { main_run: a.main_run } : {}),
})

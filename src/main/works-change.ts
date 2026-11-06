// 거울에서 읽는 같은 변경의 사실 (M4b·M4e, docs/m4-design.md 4.3·7.3). 끝까지 따라가기(works-record.ts)와 앱의 [머지]
// (works-exports.ts)가 쓴다: 한 번의 따라가기의 거울(Mirror), 내보낸 head와 머지된 head의 사실(changeFacts → engine/follow.ts
// sameChange), 앞 결론 줄 head마다 머지 뒤 커밋의 갈래(earlierAfter). relay 빚 커밋은 작성자가 아니라 앱이 적은 SHA로 정한다.
// 사용자 레포는 읽기만 한다(거울은 $RELAY_HOME).

import {
  isAncestor,
  logRange,
  mergeBase,
  mergeTree,
  patchId,
  type LogCommit,
} from '../adapters/git.ts'
import {
  ensureMirror,
  fetchBase,
  fetchPr,
  fetchWork,
  hasCommit,
  prRef,
  workRef,
} from '../adapters/mirror.ts'
import { RELAY_AUTHOR } from '../engine/debt-record.ts'
import { sameChange, type BetweenCommit, type ChangeFacts } from '../engine/follow.ts'
import type { AfterCommits } from '../engine/ledger.ts'
import { workTrailers, type SessionSet } from '../engine/session-commits.ts'
import { afterOf } from './works-session-log.ts'

/** 사이 커밋이 이보다 많으면 같은 변경을 모름으로 둔다(거울을 오래 붙잡지 않게) */
const BETWEEN_MAX = 200

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

  constructor(
    home: string,
    repo: string,
    base: string,
    log: ((message: string, error?: unknown) => void) | undefined,
  ) {
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

/**
 * head..merged 사이의 PR 쪽 커밋(머지 전 기준 exclude에서 닿는 것은 뺀다: 맞춤 머지가 들여온 기준 커밋). 너무 많으면 null. relay
 * 빚 커밋은 앱이 적은 SHA(debts)이고 작성자가 relay@localhost인 것만이다(작성자는 세션도 지을 수 있다)
 */
async function betweenOf(
  dir: string,
  o: {
    head: string
    merged: string
    exclude: string
    baseRef: string
    debts: ReadonlySet<string> | undefined
  },
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
      relay: (o.debts?.has(c.sha) ?? false) && c.author === RELAY_AUTHOR.email,
      baseUpdate: await baseUpdate(dir, c, o.baseRef),
      trailers: workTrailers(c.body),
    })
  return out
}

const orNull = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null)

/**
 * 거울에서 같은 변경의 사실을 읽는다(m4-design 4.3). 머지 전 기준은 머지 커밋의 첫 부모이고, 머지 커밋을 모르면 기준
 * 브랜치다(merged가 이미 기준에 있으면 머지 전 기준을 몰라 사이 커밋과 머지 쪽 patch-id를 모른다). head 쪽 patch-id는 결론
 * 줄의 base_sha(묶음의 base)에서, 머지 쪽은 머지 전 기준과 merged의 공통 조상에서 잰다. 못 읽은 칸은 null. debts는 이 Work에서
 * 앱이 쓴 빚 커밋의 SHA(works-session-log.ts sessionOf)
 */
export async function changeFacts(
  dir: string,
  baseRef: string,
  o: {
    head: string
    merged: string
    mergeCommit: string | null
    baseSha: string | null
    debts?: ReadonlySet<string>
  },
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
    facts.between = await orNull(
      betweenOf(dir, { head, merged, exclude: before, baseRef, debts: o.debts }),
    )
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

/** 앞 결론 줄의 head를 이만큼까지 가른다(첫 head와 최근 것: 첫 head는 사람 교정의 셈이 쓴다) */
const EARLIER_MAX = 20

/** 가를 앞 head: merged가 아닌 것. 많으면 첫 head와 최근 EARLIER_MAX - 1개 */
export function earlierPick(heads: readonly string[], merged: string): string[] {
  const hs = heads.filter((h) => h !== merged)
  if (hs.length <= EARLIER_MAX) return hs
  return [...hs.slice(0, 1), ...hs.slice(-(EARLIER_MAX - 1))]
}

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
    session: { set: SessionSet; debts?: ReadonlySet<string> }
    work: string
  },
): Promise<Record<string, AfterCommits>> {
  const out: Record<string, AfterCommits> = {}
  if (!o.session.set.launched) return out
  for (const head of earlierPick(o.heads, o.merged)) {
    if (!(await hasCommit(dir, head)) || (await orNull(isAncestor(dir, head, o.merged))) !== true)
      continue
    const between = await orNull(
      betweenOf(dir, {
        head,
        merged: o.merged,
        exclude: o.exclude,
        baseRef,
        debts: o.session.debts,
      }),
    )
    const after = between && afterOf(o.session, o.work, between)
    if (after) out[head] = after
  }
  return out
}

export const heads = (h: Record<string, AfterCommits>) =>
  Object.keys(h).length > 0 ? { after_heads: h } : {}

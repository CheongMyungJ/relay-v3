// 쉬는 세션에 주는 되먹임 (V24, docs/m2-modules.md 3절 works.ts의 되먹임, docs/m2.1-design.md 5절). works.ts가 600줄을
// 넘지 않게 나눴다. 세션 몫의 사실(core feedbackFacts의 결정론 사실, routeFindings의 session: 코드 안에서 고칠 리뷰 올림)을
// 자료 파일(works/<id>/feedback/<n>.md)에 쓰고 터미널에는 그 파일을 가리키는 한 줄만 넣는다. 보내는 때는 다음을 모두 채울
// 때다: 세션이 쉰다(idle이고 몰아 두기가 끝났다. Stop 뒤 몰아 두기 끝, 재기가 끝날 때마다, [끝내기]를 거둔 뒤, 사람의 입력
// 창이 끝날 때 본다), 구현 중이고 [끝내기]가 걸리거나 상자가 뜨지 않았다, 도는 재기·리뷰가 없다, 묶음이 지금 head와 계약의
// 것이다, 이 head에 보내지 않은 사실이 있다. 그래도 다음이면 보내지 않고 상태 줄에 까닭을 보인다: 라운드 상한(Work마다 3,
// 두 종류를 합쳐, v2 D171), 사람 몫의 리뷰 올림을 사람이 아직 넘기지 않음(세션이 고쳐 head가 움직이면 그 올림이 사라질 수
// 있다), 사람이 입력 칸에 쓰다 둔 글(그 글에 붙어 함께 보내진다. 사람이 Enter를 친 뒤 창이 끝날 때 다시 본다), 사람이 화면에서
// 터미널에 60초 안에 입력함(앱의 tell은 세지 않는다. 창이 끝날 때 다시 본다). 바닥 신호와 계약의 몫(계약 밖 변경,
// request_gap)은 보내지 않는다: 사람에게만 보이고, 사람은 [세션에 넘기기]로 지적을 보낸다(라운드로 세지 않는다). 보내기는
// Work마다 차례로 한다. 세션의 답은 받지 않는다: 고쳤으면 새 head의 증거와 새 맥락의 리뷰가 보고, 넘겼으면 그 head의 사실로
// [끝내기]에 남는다. 미리 리뷰(V23)의 상한은 처음 1번과 이 라운드 상한에서 나온다(PREPARED_MAX). 보는 자리(V22)는
// one_branch면 Work 브랜치의 내보내기 하나, branch_per_unit이면 통합 증거(Work 브랜치)와 단위 브랜치마다다: 한 라운드에 자리마다
// 파일 하나(머리에 그 브랜치와 끝)를 쓰고 라운드는 하나로 센다.

import { contractHash } from '../core/contract.ts'
import { feedbackLine, feedbackText, FINDINGS_NOTE } from '../core/instructions.ts'
import { evidenceFacts, feedbackFacts, findingKey, raises, routeFindings } from '../core/review.ts'
import type { Contract, EvidenceBundle, FeedbackFact, ReviewFinding } from '../core/types.ts'
import type { FeedbackHold, FeedbackRound, FeedbackView } from '../shared/api.ts'
import type { ExportRecord, WorkRecord } from './store.ts'
import {
  delivered,
  exportContract,
  perUnit,
  readTips,
  tipOf,
  type Tips,
  type WorkCtx,
  workHead,
} from './works-types.ts'

/** 되먹임을 보는 자리(V22): 내보내기(x)나 branch_per_unit의 통합 증거(x null, Work 브랜치) */
export interface Spot {
  branch: string
  x: ExportRecord | null
}

/** 자리 하나에 보낼 것: 그 끝, 묶음, 아직 보내지 않은 세션 몫 */
interface Item {
  spot: Spot
  head: string
  e: EvidenceBundle
  facts: FeedbackFact[]
  findings: ReviewFinding[]
}

/** 자리들: one_branch는 Work 브랜치의 내보내기 하나, branch_per_unit은 통합 증거와 머지되지 않은 단위 브랜치마다 */
export function spotsOf(rec: WorkRecord): Spot[] {
  const exports = rec.exports.filter((x) => !delivered(x)).map((x) => ({ branch: x.branch, x }))
  return perUnit(rec) ? [{ branch: rec.branch, x: null }, ...exports] : exports
}

/** 되먹임을 미룬 까닭을 적은 때(head와 단위 브랜치의 끝): 같은 때에 같은 까닭을 다시 적지 않게 */
function heldKey(head: string | null, tips: Tips): string | null {
  return head === null || Object.keys(tips).length === 0 ? head : `${head} ${JSON.stringify(tips)}`
}

/** relay가 저절로 보내는 되먹임 라운드의 상한(Work마다, 결정론과 리뷰를 합쳐) */
export const FEEDBACK_ROUNDS = 3
/**
 * 미리 리뷰(V23)의 상한(Work마다): 처음 1번과 되먹임 라운드마다 1번. 세는 것은 리뷰어를 부른 수이고, 사람이 터미널에서 말해
 * 생긴 head의 미리 리뷰도 같이 센다
 */
export const PREPARED_MAX = 1 + FEEDBACK_ROUNDS
const HUMAN_QUIET_MS = 60_000

const ESC = '\u001b'
const CTRL_C = '\u0003'
/**
 * 터미널(xterm)이 앱(claude)의 물음에 저절로 낸 답: 포커스 들어옴·나감, 장치 속성, 커서 위치, 상태, 창 크기, 키보드·모드
 * 보고, OSC·DCS 답. 사람의 입력이 아니다
 */
const REPORT = new RegExp(
  `${ESC}\\[(?:[IO]|[?>]?[\\d;]*[cRnt]|\\?[\\d;]*u|\\??[\\d;]*\\$y)|${ESC}\\][^\\u0007${ESC}]*(?:\\u0007|${ESC}\\\\)|${ESC}P[^${ESC}]*${ESC}\\\\`,
  'g',
)

/** 화면의 터미널에서 온 글이 사람의 입력인가(터미널의 저절로 낸 답만 있으면 아니다) */
export function isHumanInput(data: string): boolean {
  return data.replace(REPORT, '') !== ''
}

/**
 * 사람의 입력이 입력 칸에 글을 남길 수 있나: Enter(\r)나 입력 칸을 비우는 Ctrl+C로 끝나지 않았다. 붙여 넣은 글(bracketed
 * paste)과 화살표(지난 글 불러오기)도 남긴다. 터미널이 저절로 낸 답은 빼고 본다
 */
export function leavesDraft(data: string): boolean {
  const typed = data.replace(REPORT, '')
  return typed !== '' && !typed.endsWith('\r') && !typed.endsWith(CTRL_C)
}

/** 이 head에 이미 보낸 사실과 지적의 이름 */
function sentKeys(rec: WorkRecord, head: string): Set<string> {
  return new Set(rec.feedback.sent.filter((r) => r.head === head).flatMap((r) => r.keys))
}

/** 세션 몫 가운데 아직 보내지 않은 것(같은 사실을 같은 head에 두 번 보내지 않는다) */
function unsent(
  rec: WorkRecord,
  e: EvidenceBundle,
): { facts: FeedbackFact[]; findings: ReviewFinding[] } {
  const keys = sentKeys(rec, e.head)
  return {
    facts: feedbackFacts(e).filter((f) => !keys.has(f.key)),
    findings: routeFindings(e.review?.findings ?? []).session.filter(
      (f) => !keys.has(findingKey(f)),
    ),
  }
}

/**
 * 기록과 묶음만으로 정해지는, 저절로 보내지 않는 까닭: 라운드 상한, 사람 몫의 올림(계약 밖 변경, request_gap, 모르는 갈래)
 * 가운데 사람이 이 head에서 아직 넘기지 않은 것. 화면은 지금 head의 묶음만 보므로 세션이 고쳐 head가 움직이면 다음 리뷰가
 * 다시 올리지 않은 올림은 사람이 보지 못한다. 메모는 막지 않는다
 */
function blocked(rec: WorkRecord, e: EvidenceBundle): 'cap' | 'human_findings' | null {
  if (rec.feedback.rounds >= FEEDBACK_ROUNDS) return 'cap'
  const keys = sentKeys(rec, e.head)
  const { human } = routeFindings(e.review?.findings ?? [])
  return human.some((f) => raises(f) && !keys.has(findingKey(f))) ? 'human_findings' : null
}

/**
 * relay_check의 답(영어): 증거 사실(evidenceFacts), 되먹임 파일과 같은 세션 몫의 사실(칸 단위 예시 차이 포함)과 지적(주장),
 * 명령의 끝 출력, 줄의 판정, 없는 증거. 관문 결론과 사람에게만 가는 지적은 주지 않는다
 */
export function checkReply(bundle: EvidenceBundle, head: string): Record<string, unknown> {
  const findings = routeFindings(bundle.review?.findings ?? []).session
  return {
    status: 'ok',
    head: bundle.head,
    stale: bundle.head !== head,
    summary: evidenceFacts(bundle),
    facts: feedbackFacts(bundle).map((f) => f.text),
    ...(findings.length > 0 ? { review_findings: { note: FINDINGS_NOTE, findings } } : {}),
    commands: bundle.commands.map((c) => ({
      id: c.id,
      outcome: c.outcome,
      stderr_tail: c.head[c.head.length - 1]?.stderr_tail.slice(-2_000) ?? '',
    })),
    lines: bundle.lines?.map((l) => ({ line: l.line, status: l.status, examples: l.examples })),
    missing: bundle.missing,
  }
}

/**
 * relay_check의 답(V22): one_branch는 Work 브랜치의 답(checkReply), branch_per_unit은 통합 증거와 단위 브랜치마다(없는 단위
 * 브랜치는 missing)
 */
export function checkReplies(
  rec: WorkRecord,
  bundles: Map<string, EvidenceBundle>,
  head: string,
  tips: Tips,
): Record<string, unknown> {
  const reply = (branch: string, at: string | null) => {
    const bundle = bundles.get(branch)
    if (at === null)
      return { status: 'missing', error: `The unit branch ${branch} does not exist.` }
    return bundle ? checkReply(bundle, at) : { status: 'error', error: rec.error ?? 'No evidence.' }
  }
  if (!perUnit(rec)) return reply(rec.branch, head)
  return {
    status: 'ok',
    integration: { branch: rec.branch, ...reply(rec.branch, head) },
    exports: rec.exports.map((x) => ({
      unit: x.unit,
      branch: x.branch,
      ...reply(x.branch, tipOf(x, head, tips)),
    })),
  }
}

export class FeedbackDesk {
  private readonly ctx: WorkCtx

  constructor(ctx: WorkCtx) {
    this.ctx = ctx
  }

  private nowMs(): number {
    return Date.parse(this.ctx.deps.now())
  }

  /**
   * ipc terminalWrite: 사람이 화면에서 터미널에 쳤다. 터미널이 저절로 낸 답은 세지 않는다. 쓰다 둔 글 때문에 미룬 되먹임은
   * 사람이 Enter를 치면 창이 끝날 때 다시 본다(빈 입력 칸의 Enter는 세션을 움직이지 않아 다음 쉼이 오지 않는다)
   */
  typed(id: string, data: string): void {
    if (!isHumanInput(data)) return
    const rt = this.ctx.runtime(id)
    rt.lastHumanInputAt = this.nowMs()
    const was = rt.draft
    rt.draft = leavesDraft(data)
    if (was === rt.draft) return
    const reason = rt.feedbackHeld?.reason
    if (reason === 'draft' && !rt.draft) this.retry(id, this.quietMs)
    if (reason === 'draft' || reason === 'human_input') this.ctx.publish(id)
  }

  /** 자리의 지금 끝 */
  private tip(spot: Spot, head: string | null, tips: Tips): string | null {
    return spot.x === null ? head : tipOf(spot.x, head, tips)
  }

  /** 그 자리의 지금 묶음이 이 끝과 지금 계약(단위 브랜치는 조각)의 것이면 그 묶음 */
  private current(rec: WorkRecord, spot: Spot, head: string | null): EvidenceBundle | null {
    const rt = this.ctx.runtime(rec.id)
    const e = rt.bundles.get(spot.branch) ?? null
    const contract: Contract | null = spot.x ? exportContract(rt, spot.x) : rt.contract
    if (e === null || head === null || e.head !== head || contract === null) return null
    return e.contract?.hash === contractHash(contract) ? e : null
  }

  /** 자리마다 아직 보내지 않은 세션 몫 */
  private items(rec: WorkRecord, head: string, tips: Tips): Item[] {
    const out: Item[] = []
    for (const spot of spotsOf(rec)) {
      const at = this.tip(spot, head, tips)
      const e = this.current(rec, spot, at)
      if (e === null || at === null) continue
      const { facts, findings } = unsent(rec, e)
      if (facts.length + findings.length > 0) out.push({ spot, head: at, e, facts, findings })
    }
    return out
  }

  /**
   * 세션이 쉰다: 보낼 때면 보낸다(머리글의 조건). 보내지 않을 까닭이 있으면 head와 까닭마다 한 번 적는다(events.jsonl
   * feedback_held). 사람의 최근 입력이면 창이 끝날 때 다시 본다. 보내기와 [세션에 넘기기]는 Work마다 차례로 한다
   */
  offer(id: string): Promise<void> {
    return this.serial(id, () => this.offerNow(id))
  }

  private async offerNow(id: string): Promise<void> {
    const rec = this.ctx.find(id)
    const rt = this.ctx.runtime(id)
    const resting = () =>
      rec !== null &&
      rec.state === 'working' &&
      rec.end_pending === null &&
      rt.session === 'idle' &&
      rt.debounce === null &&
      this.ctx.deps.sessions.isRunning(id) &&
      rt.measuring === null &&
      rt.pending === null &&
      !rt.reviewRunning
    if (!resting() || rec === null) return
    const head = await workHead(rec).catch(() => null)
    const tips = await readTips(rec)
    const items = head === null ? [] : this.items(rec, head, tips)
    if (items.length === 0 || head === null || !resting()) return
    const since = rt.lastHumanInputAt === null ? Infinity : this.nowMs() - rt.lastHumanInputAt
    const stop = this.blockedAll(
      rec,
      items.map((i) => i.e),
    )
    const reason: FeedbackHold | null =
      stop ?? (rt.draft ? 'draft' : since < this.quietMs ? 'human_input' : null)
    if (reason !== null) {
      if (reason === 'human_input') this.retry(id, this.quietMs - since)
      const key = heldKey(head, tips) ?? head
      if (rt.feedbackHeld?.head === key && rt.feedbackHeld.reason === reason) return
      rt.feedbackHeld = { head: key, reason }
      const count = (f: (i: Item) => number) => items.reduce((n, i) => n + f(i), 0)
      this.ctx.note(id, {
        type: 'feedback_held',
        head,
        reason,
        facts: count((i) => i.facts.length),
        findings: count((i) => i.findings.length),
      })
      return this.ctx.publish(id)
    }
    await this.send(rec, items, 'relay')
  }

  /** 자리들 가운데 하나라도 막으면 막는다(라운드 상한, 사람이 넘기지 않은 사람 몫의 올림) */
  private blockedAll(rec: WorkRecord, bundles: EvidenceBundle[]): 'cap' | 'human_findings' | null {
    const reasons = bundles.map((e) => blocked(rec, e))
    return reasons.includes('cap')
      ? 'cap'
      : reasons.includes('human_findings')
        ? 'human_findings'
        : null
  }

  private get quietMs(): number {
    return this.ctx.deps.humanQuietMs ?? HUMAN_QUIET_MS
  }

  /**
   * ms 뒤 다시 본다. 세션이 다시 움직이면 cancelDebounce가 지운다. 이미 기다리는 몰아 두기가 있으면 그것이 본다(Stop 뒤
   * 재기나 되먹임으로 이어진다)
   */
  private retry(id: string, ms: number): void {
    const rt = this.ctx.runtime(id)
    if (rt.debounce !== null) return
    rt.debounce = setTimeout(() => {
      rt.debounce = null
      void this.ctx.offerFeedback(id)
    }, ms)
  }

  /** Work마다 차례로: 파일 번호와 '이 head에 보낸 것'을 앞 보내기가 끝난 뒤에 정한다 */
  private serial(id: string, run: () => Promise<void>): Promise<void> {
    const rt = this.ctx.runtime(id)
    const turn = rt.feeding.then(run)
    rt.feeding = turn.catch(() => {})
    return turn
  }

  /**
   * [세션에 넘기기]: 지금 HEAD의 리뷰 지적을 되먹임 파일로 보낸다. 사람에게만 보이는 지적도 보낸다(사람이 정했다). 쉬는지,
   * 최근 입력했는지는 보지 않고 라운드로 세지 않는다. 구현 중이고 묶음이 지금 HEAD·계약의 것이어야 한다. unit은 단위 브랜치의
   * 내보내기(V22, branch_per_unit에서는 꼭 준다)
   */
  sendFindings(id: string, ids: string[], unit?: string): Promise<void> {
    return this.serial(id, async () => {
      const rec = this.ctx.record(id)
      if (rec.state !== 'working') throw new Error('구현 중인 Work만 세션에 넘길 수 있음')
      const spot = spotsOf(rec).find((s) => s.x !== null && s.x.unit === (unit ?? null))
      if (spot === undefined) throw new Error(`리뷰가 있는 내보내기가 아님: ${unit ?? '단위 없음'}`)
      const head = this.tip(spot, await workHead(rec), await readTips(rec))
      const e = this.current(rec, spot, head)
      if (e === null || head === null)
        throw new Error('지금 HEAD를 지금 계약으로 잰 증거가 없음: 증거를 다시 재세요')
      const all = e.review?.findings ?? []
      const unknown = ids.filter((i) => !all.some((f) => f.id === i))
      if (ids.length === 0 || unknown.length > 0)
        throw new Error(`지금 HEAD의 리뷰에 없는 지적: ${unknown.join(', ') || '없음'}`)
      const chosen = all.filter((f) => ids.includes(f.id))
      await this.send(rec, [{ spot, head, e, facts: [], findings: chosen }], 'human')
    })
  }

  /**
   * 자리마다 파일을 쓰고, 기록하고, 세션에 한 줄씩 전한다(세션이 멈췄으면 다음 재개의 프롬프트로). relay가 보낸 것은 라운드
   * 하나로 센다. 차례 안에서만 부른다
   */
  private async send(rec: WorkRecord, items: Item[], by: FeedbackRound['by']): Promise<void> {
    const { store } = this.ctx.deps
    const lines: string[] = []
    for (const { spot, head, facts, findings } of items) {
      const n = rec.feedback.sent.length + 1
      const path = store.feedbackPath(rec.id, n)
      await store.writeFileAtomic(
        path,
        feedbackText({ n, head, workBranch: spot.branch, facts, findings, by }),
      )
      const keys = [...facts.map((f) => f.key), ...findings.map(findingKey)]
      const round: FeedbackRound = {
        n,
        head,
        at: this.ctx.deps.now(),
        by,
        keys,
        facts: facts.length,
        findings: findings.length,
      }
      rec.feedback.sent.push(round)
      const unit = spot.x?.unit ? { unit: spot.x.unit } : {}
      this.ctx.note(rec.id, {
        type: 'feedback',
        n,
        head,
        by,
        ...unit,
        facts: round.facts,
        findings: round.findings,
        keys,
      })
      lines.push(
        feedbackLine({ n, head, by, path, facts: facts.length, findings: findings.length }),
      )
    }
    if (by === 'relay') rec.feedback.rounds += 1
    this.ctx.runtime(rec.id).feedbackHeld = null
    await this.ctx.save(rec)
    for (const line of lines) await this.ctx.tell(rec.id, line)
  }

  /** [증거]의 되먹임 상태(그 자리의 지금 끝의 묶음으로). 자리를 주지 않으면 첫 자리(Work 브랜치) */
  view(rec: WorkRecord, spot: Spot | undefined = spotsOf(rec)[0]): FeedbackView {
    const rt = this.ctx.runtime(rec.id)
    const at = spot === undefined ? null : this.tip(spot, rt.head, rt.tips)
    const e = spot === undefined ? null : this.current(rec, spot, at)
    const sent = e === null ? [] : rec.feedback.sent.filter((r) => r.head === e.head)
    const keys = new Set(sent.flatMap((r) => r.keys))
    const findings: FeedbackView['findings'] = {}
    const left = e === null ? { facts: [], findings: [] } : unsent(rec, e)
    const { session, human } = routeFindings(e?.review?.findings ?? [])
    for (const [route, of] of [
      ['session', session],
      ['human', human],
    ] as const)
      for (const f of of) findings[f.id] = { route, sent: keys.has(findingKey(f)) }
    const pending = left.facts.length + left.findings.length
    // 상한과 사람 몫의 올림은 지금 기록으로, 사람의 입력은 마지막으로 본 때의 까닭과 지금 입력 칸으로
    const now = heldKey(rt.head, perUnit(rec) ? rt.tips : {})
    const held = e !== null && rt.feedbackHeld?.head === now ? rt.feedbackHeld.reason : undefined
    const typing =
      held === 'draft' || held === 'human_input' ? (rt.draft ? 'draft' : 'human_input') : null
    return {
      rounds: rec.feedback.rounds,
      max: FEEDBACK_ROUNDS,
      sent: sent.map((r) => ({ ...r, path: this.ctx.deps.store.feedbackPath(rec.id, r.n) })),
      findings,
      pending,
      held: pending === 0 || e === null ? null : (blocked(rec, e) ?? typing),
    }
  }
}

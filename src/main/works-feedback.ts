// 쉬는 세션에 주는 되먹임 (V24, docs/m2-modules.md 3절 works.ts의 되먹임, docs/m2.1-design.md 5절). works.ts가 600줄을
// 넘지 않게 나눴다. 세션 몫의 사실(core feedbackFacts의 결정론 사실, routeFindings의 session: 코드 안에서 고칠 리뷰 올림)을
// 자료 파일(works/<id>/feedback/<n>.md)에 쓰고 터미널에는 그 파일을 가리키는 한 줄만 넣는다. 보내는 때는 다음을 모두 채울
// 때다: 세션이 쉰다(Stop 뒤 몰아 두기나 미리 리뷰를 허락한 재기 뒤, 그 사이 도구 호출이 없어 idle), 구현 중이고 [끝내기]가
// 걸리거나 상자가 뜨지 않았다, 도는 재기·리뷰가 없다, 묶음이 지금 head와 계약의 것이다, 사람이 화면에서 터미널에 60초 넘게
// 입력하지 않았다(앱의 tell은 세지 않는다), 이 head에 보내지 않은 사실이 있다. 사람이 최근 입력했으면 상태 줄에만 보이고
// 다음에 쉴 때 본다. relay가 저절로 보내는 라운드는 Work마다 3까지다(두 종류를 합쳐, v2 D171). 바닥 신호와 계약의 몫(계약 밖
// 변경, request_gap)은 보내지 않는다: 사람에게만 보이고, 사람은 [세션에 넘기기]로 지적을 보낸다(라운드로 세지 않는다).
// 세션의 답은 받지 않는다: 고쳤으면 새 head의 증거와 새 맥락의 리뷰가 보고, 넘겼으면 그 head의 사실로 [끝내기]에 남는다.
// 미리 리뷰(V23)의 상한은 처음 1번과 이 라운드 상한에서 나온다(PREPARED_MAX).

import { contractHash } from '../core/contract.ts'
import { feedbackLine, feedbackText, FINDINGS_NOTE } from '../core/instructions.ts'
import { evidenceFacts, feedbackFacts, findingKey, routeFindings } from '../core/review.ts'
import type { EvidenceBundle, FeedbackFact, ReviewFinding } from '../core/types.ts'
import type { FeedbackRound, FeedbackView } from '../shared/api.ts'
import type { WorkRecord } from './store.ts'
import { type WorkCtx, workHead } from './works-types.ts'

/** relay가 저절로 보내는 되먹임 라운드의 상한(Work마다, 결정론과 리뷰를 합쳐) */
export const FEEDBACK_ROUNDS = 3
/**
 * 미리 리뷰(V23)의 상한(Work마다): 처음 1번과 되먹임 라운드마다 1번. 세는 것은 리뷰어를 부른 수이고, 사람이 터미널에서 말해
 * 생긴 head의 미리 리뷰도 같이 센다
 */
export const PREPARED_MAX = 1 + FEEDBACK_ROUNDS
const HUMAN_QUIET_MS = 60_000

const ESC = '\u001b'
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

export class FeedbackDesk {
  private readonly ctx: WorkCtx

  constructor(ctx: WorkCtx) {
    this.ctx = ctx
  }

  private nowMs(): number {
    return Date.parse(this.ctx.deps.now())
  }

  /** ipc terminalWrite: 사람이 화면에서 터미널에 쳤다. 터미널이 저절로 낸 답은 세지 않는다 */
  typed(id: string, data: string): void {
    if (isHumanInput(data)) this.ctx.runtime(id).lastHumanInputAt = this.nowMs()
  }

  /** 지금 묶음이 이 head와 지금 계약의 것이면 그 묶음 */
  private current(rec: WorkRecord, head: string | null): EvidenceBundle | null {
    const { evidence: e, contract } = this.ctx.runtime(rec.id)
    if (e === null || head === null || e.head !== head || contract === null) return null
    return e.contract?.hash === contractHash(contract) ? e : null
  }

  /**
   * 세션이 쉰다: 보낼 때면 보낸다(머리글의 조건). 사람이 최근 입력했거나 라운드 상한에 닿았으면 보내지 않고 그 까닭을 한 번
   * 적는다(events.jsonl feedback_held)
   */
  async offer(id: string): Promise<void> {
    const rec = this.ctx.find(id)
    const rt = this.ctx.runtime(id)
    const resting = () =>
      rec !== null &&
      rec.state === 'working' &&
      rec.end_pending === null &&
      rt.session === 'idle' &&
      this.ctx.deps.sessions.isRunning(id) &&
      rt.measuring === null &&
      rt.pending === null &&
      !rt.reviewRunning
    if (!resting() || rec === null) return
    const head = await workHead(rec).catch(() => null)
    const e = this.current(rec, head)
    if (e === null || head === null || !resting()) return
    const { facts, findings } = unsent(rec, e)
    if (facts.length + findings.length === 0) return
    const quiet = rt.lastHumanInputAt !== null && this.nowMs() - rt.lastHumanInputAt < this.quietMs
    const reason = rec.feedback.rounds >= FEEDBACK_ROUNDS ? 'cap' : quiet ? 'human_input' : null
    if (reason !== null) {
      if (rt.feedbackHeld?.head === head && rt.feedbackHeld.reason === reason) return
      rt.feedbackHeld = { head, reason }
      this.ctx.note(id, {
        type: 'feedback_held',
        head,
        reason,
        facts: facts.length,
        findings: findings.length,
      })
      return this.ctx.publish(id)
    }
    await this.send(rec, head, facts, findings, 'relay')
  }

  private get quietMs(): number {
    return this.ctx.deps.humanQuietMs ?? HUMAN_QUIET_MS
  }

  /**
   * [세션에 넘기기]: 지금 HEAD의 리뷰 지적을 되먹임 파일로 보낸다. 사람에게만 보이는 지적도 보낸다(사람이 정했다). 쉬는지,
   * 최근 입력했는지는 보지 않고 라운드로 세지 않는다. 구현 중이고 묶음이 지금 HEAD·계약의 것이어야 한다
   */
  async sendFindings(id: string, ids: string[]): Promise<void> {
    const rec = this.ctx.record(id)
    if (rec.state !== 'working') throw new Error('구현 중인 Work만 세션에 넘길 수 있음')
    const head = await workHead(rec)
    const e = this.current(rec, head)
    if (e === null) throw new Error('지금 HEAD를 지금 계약으로 잰 증거가 없음: 증거를 다시 재세요')
    const all = e.review?.findings ?? []
    const unknown = ids.filter((i) => !all.some((f) => f.id === i))
    if (ids.length === 0 || unknown.length > 0)
      throw new Error(`지금 HEAD의 리뷰에 없는 지적: ${unknown.join(', ') || '없음'}`)
    await this.send(
      rec,
      head,
      [],
      all.filter((f) => ids.includes(f.id)),
      'human',
    )
  }

  /** 파일을 쓰고, 기록하고, 세션에 한 줄을 전한다(세션이 멈췄으면 다음 재개의 프롬프트로) */
  private async send(
    rec: WorkRecord,
    head: string,
    facts: FeedbackFact[],
    findings: ReviewFinding[],
    by: FeedbackRound['by'],
  ): Promise<void> {
    const { store } = this.ctx.deps
    const n = rec.feedback.sent.length + 1
    const path = store.feedbackPath(rec.id, n)
    await store.writeFileAtomic(
      path,
      feedbackText({ n, head, workBranch: rec.branch, facts, findings, by }),
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
    if (by === 'relay') rec.feedback.rounds += 1
    this.ctx.runtime(rec.id).feedbackHeld = null
    await this.ctx.save(rec)
    this.ctx.note(rec.id, {
      type: 'feedback',
      n,
      head,
      by,
      facts: round.facts,
      findings: round.findings,
      keys,
    })
    await this.ctx.tell(
      rec.id,
      feedbackLine({ n, head, by, path, facts: facts.length, findings: findings.length }),
    )
  }

  /** [증거]의 되먹임 상태(지금 HEAD의 묶음으로) */
  view(rec: WorkRecord): FeedbackView {
    const rt = this.ctx.runtime(rec.id)
    const e = this.current(rec, rt.head)
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
    const held = rt.feedbackHeld?.head === e?.head ? rt.feedbackHeld?.reason : undefined
    return {
      rounds: rec.feedback.rounds,
      max: FEEDBACK_ROUNDS,
      sent: sent.map((r) => ({ ...r, path: this.ctx.deps.store.feedbackPath(rec.id, r.n) })),
      findings,
      pending,
      held: pending === 0 ? null : rec.feedback.rounds >= FEEDBACK_ROUNDS ? 'cap' : (held ?? null),
    }
  }
}

// [끝내기] (V25, docs/m2-modules.md 3절 works.ts, docs/m2.1-design.md 6절). works.ts가 600줄을 넘지 않게 나눴다.
// [끝내기]는 지금 head의 내보내기 증거(리뷰 포함)를 본다(V22: 머지되지 않은 내보내기마다, branch_per_unit이면 통합 증거도).
// 열린 것(core openItems: 관문이 사람에게 보내는 사실 그대로. 통합 증거는 리뷰를 빼고, 없는 단위 브랜치는 '단위 브랜치
// 없음')이 없고 그사이 head(와 단위 브랜치의 끝)가 그대로면 바로 끝낸다. 미리 리뷰(V23)가 끝난 head는 그 자리에서 내보내기로 잰다(다시 재지 않고
// claude -p도 부르지 않는다). 그 증거가 아직 없거나 리뷰가 돌고 있거나 실패했으면 '걸린 끝'으로 두고 재며, 증거 재기가
// 하나 끝날 때마다(EvidenceRunner의 줄 안에서) 다시 본다. 열린 것이 있으면 상자로 두고 사람이 [그래도 끝내기](V18의
// [끝 확정])나 [더 고치기]를 고른다. 걸린 끝과 상자는 WorkRecord.end_pending이라 다른 Work로 갔다 오거나 앱을 다시 켜도
// 남는다. head가 바뀌거나 계약이 바뀌거나 Work가 끝나면 지운다. 걸린 끝과 상자가 있는 동안은 쉬는 세션에 되먹임(V24)을
// 보내지 않고, [취소]·[더 고치기] 뒤 다시 본다.
// 상자의 [세션에 넘기기](V35)는 지적과 사실을 세션에 보내고 끝을 '고친 뒤 끝냄'(end_pending.handed)으로 다시 건다: head가
// 바뀌어도 지우지 않고 새 head로 옮기며, 세션이 쉬면(Stop 뒤 몰아 두기 끝, rest) 그 head로 [끝내기]처럼 정한다. 열린 것이
// 없으면 끝내고(ended.how handed), 있으면 상자를 다시 띄운다. 그 재기 중 세션이 다시 움직이면 다음 쉼을 기다린다. [취소]로,
// 넘긴 뒤 사람이 터미널에 친 프롬프트(사람의 새 일)로, 보내지 못했는데 그사이 head가 바뀌었으면 푼다.
// 끝낼 때 내보내기 증거의 리뷰 메모(V37: 관문 사실이 아니라 끝을 막지 않은 지적)는 WorkRecord.end_memos에 두고 ended에 수를
// 남긴다: 끝난 Work의 [증거]가 접어 보인다.

import { integrationFacts, openItems } from '../core/gate.ts'
import { raises } from '../core/review.ts'
import { nextState } from '../core/work.ts'
import type { EndInput, EndMemo, EndPending, PreparedEnd } from '../shared/api.ts'
import type { WorkRecord } from './store.ts'
import { debtable, pushRecorded, recordDebt } from './works-debt.ts'
import type { EvidenceRunner } from './works-evidence.ts'
import {
  delivered,
  exportContract,
  isActive,
  measures,
  missingFact,
  outsideBranches,
  outsideFact,
  perUnit,
  readTips,
  sameTips,
  tipOf,
  type MeasureJob,
  type Tips,
  type WorkCtx,
  workHead,
} from './works-types.ts'

/** 끝낸 방식(events.jsonl의 ended.how): 한 번에, 걸렸다가, 상자에서 [그래도 끝내기], 상자에서 세션에 넘긴 뒤(V35) */
type How = 'once' | 'armed' | 'box' | 'handed'

const short = (sha: string) => sha.slice(0, 7)

/** 세션에 넘겨 다시 건 끝(V35)이면 기록에 붙이는 칸 */
const handedOf = (p: EndPending): { handed?: true } => (p.handed === true ? { handed: true } : {})

/** 계약이 바뀌었다(계약 바꾸기 요청과 답): 걸린 끝과 상자는 앞 계약의 증거로 정한 것이라 지운다. 저장은 부른 쪽이 한다 */
export function dropEnd(ctx: WorkCtx, rec: WorkRecord): void {
  const p = rec.end_pending
  if (p === null) return
  rec.end_pending = null
  ctx.note(rec.id, {
    type: 'end_cancelled',
    head: p.head,
    armed: p.armed,
    ...handedOf(p),
    reason: 'contract',
  })
}

export class EndDesk {
  private readonly ctx: WorkCtx
  private readonly evidence: EvidenceRunner

  constructor(ctx: WorkCtx, evidence: EvidenceRunner) {
    this.ctx = ctx
    this.evidence = evidence
  }

  /**
   * [끝내기]: 끝남, 걸림, 상자 가운데 하나를 돌려준다. o.head는 화면의 HEAD다: 지금 HEAD가 다르면 끝내지 않고 던진다(사람이
   * 보지 못한 커밋을 한 번에 끝내지 않게). o.force는 [그래도 끝내기]이고 o.head는 상자의 head다
   */
  async end(id: string, o: EndInput = {}): Promise<PreparedEnd> {
    const rec = this.ctx.record(id)
    const ok = nextState(rec.state, { type: 'ended' })
    if (!ok.ok) throw new Error(ok.errors.join('; '))
    if (o.force === true) return this.force(rec, o.head, o.debt === true)
    const head = o.head === undefined ? await workHead(rec) : await this.sameHead(id, o.head)
    const tips = await this.checkTips(id, o.tips)
    this.ctx.runtime(id).endMoved = null
    return this.start(rec, head, tips, false)
  }

  /**
   * 이 끝들로 정하기 시작한다([끝내기], 세션에 넘긴 끝의 쉼). 미리 리뷰가 끝난 head는 결정론 증거와 리뷰를 다시 써서 바로
   * 내보내기로 잰다(장부 한 줄). 그 사이 정책이 머지했으면 끝났다. 그 사이 HEAD가 바뀌었으면 끝내지 않는다. 내보내기 증거가
   * 있으면 정하고, 없으면 걸어 두고 잰다. handed(V35)는 그 사이 세션이 다시 움직였으면 다음 쉼을 기다린다
   */
  private async start(
    rec: WorkRecord,
    head: string,
    tips: Tips,
    handed: boolean,
  ): Promise<PreparedEnd> {
    const id = rec.id
    const rt = this.ctx.runtime(id)
    const waiting = rec.end_pending
    if (this.evidence.promotable(id, head, tips)) {
      await this.evidence.run(id, { export: 'end' })
      if (!isActive(rec.state)) return { head: null, ended: true, armed: false, open: [] }
      await this.sameHead(id, head)
      await this.checkTips(id, tips)
      if (handed && (rec.end_pending !== waiting || rt.session === 'running'))
        return { head, ended: false, armed: false, open: [] }
    }
    if (this.ready(rec, head, tips)) return this.decide(rec, head, tips, handed ? 'handed' : 'once')
    const mark = handed ? { handed: true as const } : {}
    rec.end_pending = { head, armed: true, open: [], ...this.tipsOf(rec, tips), ...mark }
    await this.ctx.save(rec)
    this.ctx.note(id, { type: 'end_armed', head, ...mark })
    // 도는 재기(미리 리뷰 등)가 있으면 그것이 끝난 뒤 settle이 내보내기를 줄 세운다: 그사이 HEAD가 바뀌면 재지 않는다
    if (rt.measuring === null && rt.pending === null) this.measure(id)
    return { head, ended: false, armed: true, open: [] }
  }

  /**
   * 상자의 [세션에 넘기기](V35): 상자(head가 지금 HEAD)를 '고친 뒤 끝냄'으로 다시 걸고 send(지적과 사실을 세션에 보냄)를
   * 부른다. 걸고 나서 보낸다: 세션이 받아 고치고 쉬는 것이 다시 건 뒤에 오게. 기다리던 몰아 두기는 지운다(넘기기 앞의 Stop이
   * 이 head를 바로 다시 정하지 않게). 보내지 못하면 상자로 되돌리고 던진다
   */
  async hand(
    id: string,
    head: string,
    send: () => Promise<{ facts: number; findings: number }>,
  ): Promise<void> {
    const rec = this.ctx.record(id)
    const box = rec.end_pending
    if (rec.state !== 'working') throw new Error('구현 중인 Work만 세션에 넘길 수 있음')
    if (box === null || box.armed || box.handed === true || box.head !== head)
      throw new Error('끝내기 상자가 없음: 끝내기를 다시 누르세요')
    await this.sameHead(id, head)
    await this.checkTips(id, box.tips)
    if (rec.end_pending !== box) throw new Error('끝내기 상자가 바뀜: 다시 보세요')
    const handed: EndPending = { ...box, open: [], handed: true }
    rec.end_pending = handed
    const rt = this.ctx.runtime(id)
    rt.endMoved = null
    rt.handedAt = Date.parse(this.ctx.deps.now())
    this.evidence.cancelDebounce(id)
    await this.ctx.save(rec)
    try {
      const sent = await send()
      this.ctx.note(id, { type: 'end_handed', head, ...sent })
    } catch (e) {
      const now = rec.end_pending
      if (now === handed) {
        rec.end_pending = box
        await this.ctx.save(rec)
      }
      // 보내는 사이 세션이 커밋해 follow가 넘긴 끝을 새 head로 옮겼다: 넘긴 것이 없으니 푼다(상자는 앞 head의 것이다)
      else if (now?.handed === true) await this.release(rec, now, 'hand_failed')
      throw e
    }
  }

  /**
   * 세션이 쉰다(Stop 뒤 몰아 두기 끝): 세션에 넘겨 다시 건 끝(V35)이 기다리는 중이면 지금 head로 [끝내기]처럼 정한다. 쉬는
   * 동안 미리 리뷰를 돌리지 않으므로 대개 걸어 두고 내보내기로 잰다(그 재기가 끝나면 settle). 이미 잰 head(세션이 커밋하지
   * 않고 쉼)는 바로 정한다: 열린 것이 남았으면 상자가 다시 뜬다
   */
  async rest(id: string): Promise<void> {
    const rec = this.ctx.find(id)
    const p = rec?.end_pending
    if (!rec || p?.handed !== true || p.armed || rec.state !== 'working') return
    const head = await workHead(rec).catch(() => null)
    const tips = await readTips(rec)
    if (head === null || rec.end_pending !== p || this.ctx.runtime(id).session === 'running') return
    await this.start(rec, head, tips, true)
  }

  /**
   * 세션이 다시 움직인다(UserPromptSubmit): 세션에 넘긴 끝(V35)이 걸려 재는 중이면 다음 쉼을 기다리게 되돌린다(일하는 세션의
   * Work를 끝내지 않게). 도는 재기는 끝까지 돌고 settle은 걸린 끝이 아니라 그대로 둔다. 넘긴 뒤 사람이 터미널에 친
   * 프롬프트(rt.lastHumanInputAt이 rt.handedAt 뒤)면 넘긴 끝을 푼다: 사람의 새 일은 넘긴 고침이 아니고, 사람이 보지 못한 그
   * 커밋으로 끝내지 않는다(V25의 [끝내기]처럼)
   */
  async busy(id: string): Promise<void> {
    const rec = this.ctx.find(id)
    if (!rec) return
    const rt = this.ctx.runtime(id)
    const p = rec.end_pending
    const human = rt.lastHumanInputAt !== null && rt.lastHumanInputAt > (rt.handedAt ?? -Infinity)
    if (p?.handed === true && human) return this.release(rec, p, 'human_input')
    if (this.wait(rec)) await this.ctx.save(rec)
  }

  /** 세션에 넘긴 끝(V35)을 푼다: 사람이 새 일을 쳤거나(human_input), 넘기지 못했다(hand_failed) */
  private async release(
    rec: WorkRecord,
    p: EndPending,
    reason: 'human_input' | 'hand_failed',
  ): Promise<void> {
    rec.end_pending = null
    await this.ctx.save(rec)
    this.ctx.note(rec.id, {
      type: 'end_cancelled',
      head: p.head,
      armed: p.armed,
      handed: true,
      reason,
    })
  }

  /** 세션에 넘긴 끝이 걸려 있으면 다음 쉼을 기다리게 되돌린다. 되돌렸으면 참: 부른 쪽이 저장한다 */
  private wait(rec: WorkRecord): boolean {
    const p = rec.end_pending
    if (p?.handed !== true || !p.armed) return false
    rec.end_pending = { ...p, armed: false }
    this.ctx.note(rec.id, { type: 'end_waiting', head: p.head })
    return true
  }

  /**
   * [취소](걸린 끝)와 [더 고치기](상자): 지운다. 도는 증거 재기는 그대로 끝난다(그 증거와 리뷰는 [증거]에 남는다). 걸린 끝과
   * 상자 때문에 보내지 않은 되먹임(V24)을 쉬는 세션에 보낸다(기다리지 않는다)
   */
  async cancel(id: string): Promise<void> {
    const rec = this.ctx.record(id)
    const p = rec.end_pending
    this.ctx.runtime(id).endMoved = null
    if (p === null) return this.ctx.publish(id)
    rec.end_pending = null
    await this.ctx.save(rec)
    this.ctx.note(id, {
      type: 'end_cancelled',
      head: p.head,
      armed: p.armed,
      ...handedOf(p),
      reason: 'human',
    })
    void this.ctx.offerFeedback(id)
  }

  /**
   * 증거 재기 job이 하나 끝났다(EvidenceRunner의 줄 안, 다음 재기 전): 걸린 끝을 다시 본다. 줄 선 재기가 남았거나 앱을 닫는
   * 중이면 그대로 둔다(다시 켜면 resume). HEAD가 바뀌었으면 지운다. 그 head를 내보내기로 쟀으면 끝내거나 상자로 바꾼다.
   * 끝난 재기가 이 head의 내보내기가 아니었으면 이제 내보내기로 잰다(같은 head·계약의 증거와 리뷰는 다시 쓴다): 미리
   * 리뷰(V23)였거나, 걸기 전에 돌던 다른 head의 재기였다(그사이 세션이 커밋하고 사람이 새 head에서 다시 눌렀다). 이 head의
   * 내보내기였는데 재지 못했으면(재기 실패, 까닭은 rec.error) 풀어서 사람이 다시 누르게 한다
   */
  async settle(id: string, job: MeasureJob): Promise<void> {
    const rec = this.ctx.find(id)
    const p = rec?.end_pending
    if (!rec || !p?.armed || !isActive(rec.state)) return
    const rt = this.ctx.runtime(id)
    if (rt.abort.signal.aborted || rt.pending !== null) return
    const head = await workHead(rec).catch(() => null)
    const tips = await readTips(rec)
    if (head !== null && (head !== p.head || !sameTips(tips, p.tips)))
      return this.ctx.seeHead(id, head)
    // 세션에 넘긴 끝(V35): 그사이 세션이 다시 움직였으면 다음 쉼을 기다린다
    if (rt.session === 'running' && this.wait(rec)) return this.ctx.save(rec)
    if (head !== null && this.evidence.exportedAll(rec, head, tips)) {
      await this.decide(rec, head, tips, p.handed === true ? 'handed' : 'armed')
      return
    }
    // 모든 내보내기를 이 끝들로 재는 [끝내기]의 재기가 아니었다
    const all = job.export !== null && job.only === null
    const other = job.head !== null && (job.head !== p.head || !sameTips(job.tips, p.tips))
    if (head !== null && (!all || other)) return this.measure(id)
    rec.end_pending = null
    await this.ctx.save(rec)
    this.ctx.note(id, { type: 'end_failed', head: p.head, ...handedOf(p) })
  }

  /** 앱을 다시 켰을 때 걸린 끝이 남아 있으면 이어 잰다(HEAD가 바뀌었으면 init의 seeHead가 이미 지웠다) */
  resume(id: string): void {
    const rec = this.ctx.record(id)
    const p = rec.end_pending
    if (p?.armed === true && measures(rec.state)) this.measure(id)
  }

  /**
   * 읽은 HEAD(와 단위 브랜치의 끝)가 걸린 끝이나 상자의 것이 아니면 지운다(화면은 endMoved로 까닭을 보인다). 세션에 넘긴
   * 끝(V35)은 세션의 고침을 기다리므로 지우지 않고 새 끝으로 옮겨 다음 쉼을 기다린다. 바꿨으면 참: 부른 쪽이 저장한다
   */
  follow(rec: WorkRecord, head: string, tips: Tips): boolean {
    const p = rec.end_pending
    if (p === null || (p.head === head && sameTips(p.tips, tips))) return false
    if (p.handed === true) {
      rec.end_pending = { head, armed: false, open: [], ...this.tipsOf(rec, tips), handed: true }
      return true
    }
    rec.end_pending = null
    this.ctx.runtime(rec.id).endMoved = p.head
    this.ctx.note(rec.id, { type: 'end_moved', from: p.head, to: head, armed: p.armed })
    return true
  }

  /**
   * 지금 묶음들이 이 끝들을 지금 계약으로 내보내기(리뷰까지)로 잰 것이고 그 리뷰가 실패하지 않았다: 열린 것을 바로 볼 수
   * 있다. 같은 head를 다시 내보내기로 재는 동안(리뷰 없는 묶음을 먼저 보임)은 아니다: 걸어 두고 그 리뷰 뒤에 정한다
   */
  private ready(rec: WorkRecord, head: string, tips: Tips): boolean {
    const rt = this.ctx.runtime(rec.id)
    const failed = rec.exports.some(
      (x) => !delivered(x) && rt.bundles.get(x.branch)?.review?.status === 'failed',
    )
    return this.evidence.exportedAll(rec, head, tips) && !failed
  }

  /** branch_per_unit이면 단위 브랜치의 끝을 걸린 끝과 상자에 둔다(V22) */
  private tipsOf(rec: WorkRecord, tips: Tips): { tips?: Tips } {
    return perUnit(rec) ? { tips } : {}
  }

  /**
   * 이 끝들의 내보내기 증거의 열린 것. one_branch는 그 묶음의 열린 것 그대로다. branch_per_unit은 통합 증거의 열린 것(core
   * integrationFacts: 커밋이 Work 브랜치에 다 있지 않은 단위 브랜치와 리뷰를 뺀 묶음의 열린 것, '통합 증거: '), 머지되지 않은
   * 내보내기마다 '<단위>: '를 붙인 열린 것, 없는 단위 브랜치. 묶음이 없으면 null
   */
  private async openOf(rec: WorkRecord, head: string, tips: Tips): Promise<string[] | null> {
    const rt = this.ctx.runtime(rec.id)
    if (!perUnit(rec)) {
      const b = rt.bundles.get(rec.branch)
      return b ? openItems(b, rt.contract, head) : null
    }
    const whole = rt.bundles.get(rec.branch)
    if (!whole) return null
    const facts = (await outsideBranches(rec, head, tips)).map(outsideFact)
    const out = integrationFacts({ evidence: whole, contract: rt.contract, head, facts })
    for (const x of rec.exports) {
      const tip = tipOf(x, head, tips)
      const b = rt.bundles.get(x.branch)
      if (delivered(x)) continue
      if (tip === null) out.push(missingFact(x))
      else if (!b) return null
      else out.push(...openItems(b, exportContract(rt, x), tip).map((f) => `${x.unit}: ${f}`))
    }
    return out
  }

  /** 이 끝들의 내보내기 증거로 정한다: 열린 것이 없으면 끝내고, 있으면 상자로 둔다 */
  private async decide(rec: WorkRecord, head: string, tips: Tips, how: How): Promise<PreparedEnd> {
    const open = await this.openOf(rec, head, tips)
    if (open === null) throw new Error('증거가 없음: 끝내기를 다시 누르세요')
    if (open.length === 0) {
      await this.finish(rec, head, tips, { how, head })
      return { head, ended: true, armed: false, open }
    }
    rec.end_pending = { head, armed: false, open, ...this.tipsOf(rec, tips) }
    await this.ctx.save(rec)
    this.ctx.note(rec.id, { type: 'end_box', head, open: open.length })
    return { head, ended: false, armed: false, open }
  }

  /**
   * 이 head를 내보내기로 잰다. 같은 head·계약의 결정론 증거와 끝난 리뷰는 다시 쓰고, 리뷰가 실패한 head는 리뷰를 다시
   * 부른다(PR이 없으면 그 head의 리뷰를 받을 길이 이것뿐이다)
   */
  private measure(id: string): void {
    void this.evidence.run(id, { export: 'end' }).catch((e) => this.ctx.log('증거 실패', e))
  }

  /**
   * [그래도 끝내기](V18의 [끝 확정] 그대로): head(상자의 head)가 지금 HEAD일 때만 끝낸다. 상자 뒤 세션이 커밋했으면(Stop이
   * 아직 오지 않아 상자가 남았어도) 끝내지 않고 던진다: 사람은 새 커밋의 증거를 본 적이 없다. 그 head를 내보내기로 재지
   * 않았으면(계약이 바뀐 뒤 등) 먼저 잰다(안전망, 리뷰와 장부). 재는 사이 HEAD가 바뀌어도 끝내지 않는다. debt는 [빚으로 남기고
   * 끝내기](M3b): 나빠진 래칫을 Work 브랜치에 빚으로 커밋하고(열린 PR이 있으면 push) 그 head로 끝낸다. 받아들인 나빠짐은
   * 기록했든 아니든 장부에 남긴다
   */
  private async force(
    rec: WorkRecord,
    head: string | undefined,
    debt: boolean,
  ): Promise<PreparedEnd> {
    if (head === undefined) throw new Error('[그래도 끝내기]에는 상자의 head가 필요함')
    const id = rec.id
    await this.sameHead(id, head)
    const tips = await this.checkTips(id, rec.end_pending?.tips)
    await this.exportHead(id)
    // 그 증거로 정책이 머지했으면 이미 끝났다
    if (!isActive(rec.state)) return { head: null, ended: true, armed: false, open: [] }
    await this.sameHead(id, head)
    await this.checkTips(id, tips)
    const open = (await this.openOf(rec, head, tips)) ?? []
    const x = rec.exports[0]
    let at = head
    if (debt && x && debtable(rec, x, this.ctx.runtime(id).bundles.get(x.branch))) {
      // 상자는 이 head의 것이다: 빚 커밋으로 HEAD가 옮겨도 '세션이 새로 커밋함'으로 지우지 않게 먼저 거둔다
      rec.end_pending = null
      at = (await recordDebt(this.ctx, rec, x)) ?? head
    }
    // 앞 [빚으로 남기고 끝내기]가 push하지 못했으면 지금 push한다(실패하면 끝내지 않는다)
    if (x && at === head) await pushRecorded(rec, x, this.ctx.runtime(id).bundles.get(x.branch), at)
    await this.evidence.exports.ledgerAccepted(rec)
    await this.finish(rec, at, tips, { how: 'box', head: at, open: open.length })
    return { head: at, ended: true, armed: false, open }
  }

  /** 끝낸다(V37): 이 끝들의 리뷰 메모를 Work에 두고 ended에 그 수를 남긴다 */
  private async finish(
    rec: WorkRecord,
    head: string,
    tips: Tips,
    extra: { how: How; head: string; open?: number },
  ): Promise<void> {
    rec.end_memos = this.memosOf(rec, head, tips)
    await this.ctx.transition(rec, { type: 'ended' }, { ...extra, memos: rec.end_memos.length })
  }

  /**
   * 이 끝들의 내보내기 증거에 남은 리뷰 메모(V26 raises가 아닌 지적, 리뷰어가 낸 차례). 머지되지 않은 내보내기마다 그 끝을 잰
   * 묶음의 것만 본다(V22: 통합 증거는 리뷰하지 않는다). 단위 브랜치의 내보내기는 그 단위를 붙인다
   */
  private memosOf(rec: WorkRecord, head: string, tips: Tips): EndMemo[] {
    const rt = this.ctx.runtime(rec.id)
    return rec.exports.flatMap((x) => {
      const b = rt.bundles.get(x.branch)
      if (delivered(x) || !b || b.head !== tipOf(x, head, tips)) return []
      const unit = x.unit === null ? {} : { unit: x.unit }
      return (b.review?.findings ?? [])
        .filter((f) => !raises(f))
        .map((f) => ({ ...unit, finding: f }))
    })
  }

  /** 지금 HEAD를 돌려준다. head가 아니면 화면의 HEAD를 고치고(상자를 지운다) 던진다. HEAD를 읽지 못하면 보지 않는다 */
  private async sameHead(id: string, head: string): Promise<string> {
    const now = await workHead(this.ctx.record(id)).catch(() => null)
    if (now === null || now === head) return head
    await this.ctx.seeHead(id, now)
    throw new Error(
      `HEAD가 바뀜(${short(head)} → ${short(now)}): 끝내기를 다시 눌러 새 커밋의 증거와 리뷰를 보세요`,
    )
  }

  /**
   * 단위 브랜치의 끝(V22)을 돌려준다. tips를 넘겼는데(화면이나 상자의 것) 지금과 다르면 화면을 고치고(상자를 지운다) 던진다.
   * one_branch는 빈 것
   */
  private async checkTips(id: string, tips: Tips | undefined): Promise<Tips> {
    const rec = this.ctx.record(id)
    const now = await readTips(rec)
    if (tips === undefined || sameTips(tips, now)) return now
    await this.ctx.seeHead(id, await workHead(rec).catch(() => null))
    throw new Error('단위 브랜치가 바뀜: 끝내기를 다시 눌러 새 커밋의 증거와 리뷰를 보세요')
  }

  /** 지금 끝들을 내보내기(리뷰 포함)로 재지 않았으면 잰다. 이미 도는 같은 끝의 내보내기에는 합친다 */
  private async exportHead(id: string): Promise<void> {
    const rec = this.ctx.record(id)
    const head = await workHead(rec).catch(() => null)
    if (!measures(rec.state) || head === null) return
    if (!this.evidence.exportedAll(rec, head, await readTips(rec)))
      await this.evidence.run(id, { export: 'end' })
  }
}

// [끝내기] (V25, docs/m2-modules.md 3절 works.ts, docs/m2.1-design.md 6절). works.ts가 600줄을 넘지 않게 나눴다.
// [끝내기]는 지금 head의 내보내기 증거(리뷰 포함)를 본다. 열린 것(core openItems: 관문이 사람에게 보내는 사실 그대로)이
// 없고 그사이 head가 그대로면 바로 끝낸다. 미리 리뷰(V23)가 끝난 head는 그 자리에서 내보내기로 잰다(다시 재지 않고
// claude -p도 부르지 않는다). 그 증거가 아직 없거나 리뷰가 돌고 있거나 실패했으면 '걸린 끝'으로 두고 재며, 증거 재기가
// 하나 끝날 때마다(EvidenceRunner의 줄 안에서) 다시 본다. 열린 것이 있으면 상자로 두고 사람이 [그래도 끝내기](V18의
// [끝 확정])나 [더 고치기]를 고른다. 걸린 끝과 상자는 WorkRecord.end_pending이라 다른 Work로 갔다 오거나 앱을 다시 켜도
// 남는다. head가 바뀌거나 계약이 바뀌거나 Work가 끝나면 지운다. 걸린 끝과 상자가 있는 동안은 쉬는 세션에 되먹임(V24)을
// 보내지 않고, [취소]·[더 고치기] 뒤 다시 본다.

import { openItems } from '../core/gate.ts'
import { nextState } from '../core/work.ts'
import type { EndInput, PreparedEnd } from '../shared/api.ts'
import type { WorkRecord } from './store.ts'
import type { EvidenceRunner } from './works-evidence.ts'
import { isActive, measures, type MeasureJob, type WorkCtx, workHead } from './works-types.ts'

/** 끝낸 방식(events.jsonl의 ended.how): 한 번에, 걸렸다가, 상자에서 [그래도 끝내기] */
type How = 'once' | 'armed' | 'box'

const short = (sha: string) => sha.slice(0, 7)

/** 계약이 바뀌었다(계약 바꾸기 요청과 답): 걸린 끝과 상자는 앞 계약의 증거로 정한 것이라 지운다. 저장은 부른 쪽이 한다 */
export function dropEnd(ctx: WorkCtx, rec: WorkRecord): void {
  const p = rec.end_pending
  if (p === null) return
  rec.end_pending = null
  ctx.note(rec.id, { type: 'end_cancelled', head: p.head, armed: p.armed, reason: 'contract' })
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
    if (o.force === true) return this.force(rec, o.head)
    const head = o.head === undefined ? await workHead(rec) : await this.sameHead(id, o.head)
    this.ctx.runtime(id).endMoved = null
    // 미리 리뷰가 끝난 head: 결정론 증거와 리뷰를 다시 써서 바로 내보내기로 잰다(장부 한 줄). 그 사이 정책이 머지했으면
    // 끝났다. 그 사이 HEAD가 바뀌었으면 끝내지 않는다
    if (this.evidence.promotable(id, head)) {
      await this.evidence.run(id, { export: 'end' })
      if (!isActive(rec.state)) return { head: null, ended: true, armed: false, open: [] }
      await this.sameHead(id, head)
    }
    if (this.ready(id, head)) return this.decide(rec, head, 'once')
    rec.end_pending = { head, armed: true, open: [] }
    await this.ctx.save(rec)
    this.ctx.note(id, { type: 'end_armed', head })
    // 도는 재기(미리 리뷰 등)가 있으면 그것이 끝난 뒤 settle이 내보내기를 줄 세운다: 그사이 HEAD가 바뀌면 재지 않는다
    const rt = this.ctx.runtime(id)
    if (rt.measuring === null && rt.pending === null) this.measure(id)
    return { head, ended: false, armed: true, open: [] }
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
    this.ctx.note(id, { type: 'end_cancelled', head: p.head, armed: p.armed, reason: 'human' })
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
    if (head !== null && head !== p.head) return this.ctx.seeHead(id, head)
    if (head !== null && this.evidence.exported(id, head)) {
      await this.decide(rec, head, 'armed')
      return
    }
    const other = job.head !== null && job.head !== p.head
    if (head !== null && (job.export === null || other)) return this.measure(id)
    rec.end_pending = null
    await this.ctx.save(rec)
    this.ctx.note(id, { type: 'end_failed', head: p.head })
  }

  /** 앱을 다시 켰을 때 걸린 끝이 남아 있으면 이어 잰다(HEAD가 바뀌었으면 init의 seeHead가 이미 지웠다) */
  resume(id: string): void {
    const rec = this.ctx.record(id)
    const p = rec.end_pending
    if (p?.armed === true && measures(rec.state)) this.measure(id)
  }

  /** 읽은 HEAD가 걸린 끝이나 상자의 head가 아니면 지운다(화면은 endMoved로 까닭을 보인다). 지웠으면 참: 부른 쪽이 저장한다 */
  follow(rec: WorkRecord, head: string): boolean {
    const p = rec.end_pending
    if (p === null || p.head === head) return false
    rec.end_pending = null
    this.ctx.runtime(rec.id).endMoved = p.head
    this.ctx.note(rec.id, { type: 'end_moved', from: p.head, to: head, armed: p.armed })
    return true
  }

  /**
   * 지금 묶음이 이 head를 지금 계약으로 내보내기(리뷰까지)로 잰 것이고 그 리뷰가 실패하지 않았다: 열린 것을 바로 볼 수 있다.
   * 같은 head를 다시 내보내기로 재는 동안(리뷰 없는 묶음을 먼저 보임)은 아니다: 걸어 두고 그 리뷰 뒤에 정한다
   */
  private ready(id: string, head: string): boolean {
    return (
      this.evidence.exported(id, head) && this.ctx.runtime(id).evidence?.review?.status !== 'failed'
    )
  }

  /** 이 head의 내보내기 증거로 정한다: 열린 것이 없으면 끝내고, 있으면 상자로 둔다 */
  private async decide(rec: WorkRecord, head: string, how: How): Promise<PreparedEnd> {
    const rt = this.ctx.runtime(rec.id)
    if (rt.evidence === null) throw new Error('증거가 없음: 끝내기를 다시 누르세요')
    const open = openItems(rt.evidence, rt.contract, head)
    if (open.length === 0) {
      await this.ctx.transition(rec, { type: 'ended' }, { how, head })
      return { head, ended: true, armed: false, open }
    }
    rec.end_pending = { head, armed: false, open }
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
   * 않았으면(계약이 바뀐 뒤 등) 먼저 잰다(안전망, 리뷰와 장부). 재는 사이 HEAD가 바뀌어도 끝내지 않는다
   */
  private async force(rec: WorkRecord, head: string | undefined): Promise<PreparedEnd> {
    if (head === undefined) throw new Error('[그래도 끝내기]에는 상자의 head가 필요함')
    const id = rec.id
    await this.sameHead(id, head)
    await this.exportHead(id)
    // 그 증거로 정책이 머지했으면 이미 끝났다
    if (!isActive(rec.state)) return { head: null, ended: true, armed: false, open: [] }
    await this.sameHead(id, head)
    const rt = this.ctx.runtime(id)
    const open = rt.evidence === null ? [] : openItems(rt.evidence, rt.contract, head)
    await this.ctx.transition(rec, { type: 'ended' }, { how: 'box', head, open: open.length })
    return { head, ended: true, armed: false, open }
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

  /** 지금 HEAD를 내보내기(리뷰 포함)로 재지 않았으면 잰다. 이미 도는 같은 HEAD의 내보내기에는 합친다 */
  private async exportHead(id: string): Promise<void> {
    const rec = this.ctx.record(id)
    const head = await workHead(rec).catch(() => null)
    if (!measures(rec.state) || head === null) return
    if (!this.evidence.exported(id, head)) await this.evidence.run(id, { export: 'end' })
  }
}

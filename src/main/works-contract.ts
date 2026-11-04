// 계약 창구 (docs/m2-modules.md 3절 works.ts의 submit_contract, request_contract_change, 승인·고쳐 달라고 함·답).
// 세션의 도구 호출은 /control로 오고, 사람의 답을 기다리는 동안 HTTP가 열려 있다. 연결이 끊기면(세션·브리지가 끝남)
// 기다림만 그만두고 상태는 둔다: 재개한 세션이 다시 부르거나, 그사이 사람이 답했으면 그 답을 프롬프트로 받는다.
// 세션에 돌려주는 상태 글(approved, changes, invalid …)은 모델이 읽으므로 영어다. 계약 검사 오류는 core의 글 그대로다.
// 계약 id는 지침이 준 것(rec.contract_id)이어야 한다(V11).

import { contractHash, parseContract } from '../core/contract.ts'
import { TOOL_CHANGE, TOOL_SUBMIT } from '../core/instructions.ts'
import type { Contract } from '../core/types.ts'
import { nextState } from '../core/work.ts'
import { git } from '../adapters/exec.ts'
import { checkGroundings } from '../engine/judge.ts'
import type { WorkRecord } from './store.ts'
import type { WorkCtx } from './works-types.ts'

type Reply = Record<string, unknown>

interface Waiter {
  kind: 'submit' | 'change'
  resolve: (reply: Reply) => void
}

/** 세션이 낸 계약에서 승인 표시와 바꾸기 요청을 뗀다(세션이 스스로 승인하지 못하게) */
function bare(c: Contract): Contract {
  const out: Contract = { ...c }
  delete out.approved_by
  delete out.approved_at
  delete out.change_requested
  return out
}

/** 도구 인자에서 계약: 인자 자체이거나 { contract } 하나 */
function contractArg(args: Record<string, unknown>): unknown {
  const keys = Object.keys(args)
  return keys.length === 1 && keys[0] === 'contract' ? args.contract : args
}

export class ContractDesk {
  private readonly ctx: WorkCtx
  private readonly waiters = new Map<string, Waiter>()

  constructor(ctx: WorkCtx) {
    this.ctx = ctx
  }

  /** 사람의 답을 기다리는 도구 호출이 있나 */
  waiting(id: string): 'submit' | 'change' | null {
    return this.waiters.get(id)?.kind ?? null
  }

  // ── 세션의 도구 ────────────────────────────────────────────────────────────

  async submit(
    rec: WorkRecord,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<Reply> {
    const parsed = parseContract(JSON.stringify(contractArg(args) ?? null))
    if (!parsed.ok) {
      this.ctx.note(rec.id, { type: 'contract_invalid', errors: parsed.errors })
      return { status: 'invalid', errors: parsed.errors }
    }
    const contract = bare(parsed.value)
    // 계약 id는 앱이 Work마다 정한다(V11): 앞 Work의 머지된 시험 태그와 섞이지 않게
    if (contract.id !== rec.contract_id) return this.wrongId(rec, contract.id, 'id')
    const rt = this.ctx.runtime(rec.id)
    // 재개한 세션이 이미 승인된 계약을 다시 내면 그 승인을 돌려준다
    if ((rec.state === 'working' || rec.state === 'recontract') && rt.contract) {
      if (contractHash(bare(rt.contract)) === contractHash(contract))
        return { status: 'approved', contract: rt.contract }
      return {
        status: 'error',
        error: `The contract is already approved. To change it, call ${TOOL_CHANGE}.`,
      }
    }
    const groundings = await this.groundings(rec, contract)
    const next = nextState(rec.state, { type: 'contract_submitted', contract })
    if (!next.ok) return { status: 'error', error: next.errors.join('; ') }
    rec.state = next.value
    rec.pending_contract = contract
    rec.groundings = groundings
    // 화면이 승인을 보이기 전에 기다림을 건다: 저장하는 사이에 온 사람의 답도 이 호출이 받는다
    const answer = this.wait(rec.id, 'submit', signal)
    await this.ctx.save(rec)
    this.ctx.note(rec.id, { type: 'contract_submitted', id: contract.id })
    return answer
  }

  async requestChange(
    rec: WorkRecord,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<Reply> {
    const reason = typeof args.reason === 'string' ? args.reason.trim() : ''
    if (!reason) return { status: 'invalid', errors: ['reason: 필요함'] }
    let proposed: Contract | null = null
    if (args.contract !== undefined && args.contract !== null) {
      const parsed = parseContract(JSON.stringify(args.contract))
      if (!parsed.ok)
        return { status: 'invalid', errors: parsed.errors.map((e) => `contract.${e}`) }
      proposed = bare(parsed.value)
      if (proposed.id !== rec.contract_id) return this.wrongId(rec, proposed.id, 'contract.id')
    }
    const rt = this.ctx.runtime(rec.id)
    if (!rt.contract)
      return { status: 'error', error: `No approved contract yet: use ${TOOL_SUBMIT}.` }
    const groundings = proposed ? await this.groundings(rec, proposed) : rec.groundings
    const next = nextState(rec.state, { type: 'change_requested', reason })
    if (!next.ok || !rt.contract)
      return { status: 'error', error: next.ok ? '' : next.errors.join('; ') }
    // 묶음이 계약 변경 요청을 보게(contract_change_requested → 관문 recontract) 승인된 계약에 적는다
    rt.contract = { ...rt.contract, change_requested: reason }
    rec.state = next.value
    rec.pending_change = reason
    rec.pending_contract = proposed
    rec.groundings = groundings
    const answer = this.wait(rec.id, 'change', signal)
    await this.ctx.deps.store.writeJson(rec.id, 'contract.json', rt.contract)
    await this.ctx.save(rec)
    this.ctx.note(rec.id, { type: 'change_requested', reason, contract: proposed !== null })
    return answer
  }

  private wrongId(rec: WorkRecord, got: string, field: string): Reply {
    const error = `${field}: must be "${rec.contract_id}", the contract id given in your instructions (got "${got}")`
    this.ctx.note(rec.id, { type: 'contract_invalid', errors: [error] })
    return { status: 'invalid', errors: [error] }
  }

  // ── 사람의 답 ──────────────────────────────────────────────────────────────

  async approve(id: string): Promise<void> {
    const rec = this.ctx.record(id)
    const pending = rec.pending_contract
    if (rec.state !== 'awaiting_approval' || !pending) throw new Error('승인할 계약이 없음')
    const at = this.ctx.deps.now()
    const contract: Contract = { ...pending, approved_by: 'human', approved_at: at }
    const next = nextState(rec.state, { type: 'contract_approved', contract, by: 'human', at })
    if (!next.ok) throw new Error(next.errors.join('; '))
    // 상태는 기다림 없이 바꾼다: 두 번 눌러도 한 번만 승인한다
    this.ctx.runtime(id).contract = contract
    rec.state = next.value
    rec.pending_contract = null
    await this.ctx.deps.store.writeJson(id, 'contract.json', contract)
    await this.ctx.save(rec)
    this.ctx.note(id, { type: 'contract_approved', by: 'human' })
    await this.answer(
      id,
      'submit',
      { status: 'approved', contract },
      `The human approved your contract while no ${TOOL_SUBMIT} call was waiting. The approved contract is in ${this.ctx.deps.store.workPath(id, 'contract.json')}. Go on with the work.`,
    )
  }

  async askChanges(id: string, text: string): Promise<void> {
    const rec = this.ctx.record(id)
    const msg = text.trim()
    if (!msg) throw new Error('무엇을 고칠지 적어 주세요')
    const next = nextState(rec.state, { type: 'contract_changes_asked', message: msg })
    if (!next.ok) throw new Error(next.errors.join('; '))
    rec.state = next.value
    rec.pending_contract = null
    await this.ctx.save(rec)
    this.ctx.note(id, { type: 'contract_changes_asked', message: msg })
    await this.answer(
      id,
      'submit',
      { status: 'changes', message: msg },
      `The human asked for changes to your contract: ${msg} Revise it and call ${TOOL_SUBMIT} again.`,
    )
  }

  async answerChange(id: string, o: { approved: boolean; message: string }): Promise<void> {
    const rec = this.ctx.record(id)
    const rt = this.ctx.runtime(id)
    if (rec.state !== 'recontract' || !rt.contract) throw new Error('답할 계약 바꾸기 요청이 없음')
    const msg = o.message.trim()
    const at = this.ctx.deps.now()
    const contract: Contract =
      o.approved && rec.pending_contract
        ? { ...rec.pending_contract, approved_by: 'human', approved_at: at }
        : { ...rt.contract }
    delete contract.change_requested
    const next = nextState(rec.state, {
      type: 'change_answered',
      approved: o.approved,
      contract,
      message: msg,
    })
    if (!next.ok) throw new Error(next.errors.join('; '))
    const keepGroundings = o.approved && rec.pending_contract !== null
    // 상태는 기다림 없이 바꾼다: 두 번 눌러도 한 번만 답한다
    rt.contract = contract
    rec.state = next.value
    rec.pending_change = null
    rec.pending_contract = null
    // 받아들인 새 계약은 요청 때 확인한 근거를 그대로 쓴다. 아니면 남는 계약의 근거를 다시 확인한다(실패하면 null)
    if (!keepGroundings) rec.groundings = await this.groundings(rec, contract)
    await this.ctx.deps.store.writeJson(id, 'contract.json', contract)
    await this.ctx.save(rec)
    this.ctx.note(id, { type: 'change_answered', approved: o.approved, message: msg })
    const reply = o.approved
      ? { status: 'approved', contract, message: msg }
      : { status: 'rejected', contract, message: msg }
    const said = msg ? ` Message: ${msg}` : ''
    await this.answer(
      id,
      'change',
      reply,
      `The human ${o.approved ? 'approved' : 'rejected'} your contract change request.${said} The contract is in ${this.ctx.deps.store.workPath(id, 'contract.json')}.`,
    )
  }

  /** 기다리는 도구 호출을 모두 끝낸다(앱 종료, 버림) */
  cancel(id: string | null, reply: Reply): void {
    for (const [key, w] of [...this.waiters]) {
      if (id !== null && key !== id) continue
      this.waiters.delete(key)
      w.resolve(reply)
    }
  }

  // ── 안쪽 ───────────────────────────────────────────────────────────────────

  /** 사람의 답을 기다린다. 연결이 끊기면 기다림만 그만둔다 */
  private wait(id: string, kind: Waiter['kind'], signal: AbortSignal): Promise<Reply> {
    this.cancel(id, { status: 'superseded', message: 'A newer call replaced this one.' })
    return new Promise((resolve) => {
      const w: Waiter = {
        kind,
        resolve: (reply) => {
          signal.removeEventListener('abort', aborted)
          resolve(reply)
        },
      }
      const aborted = () => {
        if (this.waiters.get(id) === w) this.waiters.delete(id)
        resolve({ status: 'cancelled' })
      }
      this.waiters.set(id, w)
      signal.addEventListener('abort', aborted, { once: true })
      if (signal.aborted) aborted()
    })
  }

  /** 기다리는 호출이 있으면 답하고, 없으면 세션에 글로 전한다 */
  private async answer(
    id: string,
    kind: Waiter['kind'],
    reply: Reply,
    text: string,
  ): Promise<void> {
    const w = this.waiters.get(id)
    if (w && w.kind === kind) {
      this.waiters.delete(id)
      w.resolve(reply)
      return
    }
    await this.ctx.tell(id, text)
  }

  /** 계약 근거 확인(engine). 실패해도 계약은 받는다: 근거 확인 없음(null) */
  private async groundings(rec: WorkRecord, contract: Contract) {
    try {
      const head = (await git(['rev-parse', 'HEAD'], rec.worktree)).trim()
      const request = await this.ctx.deps.store.readText(rec.id, 'request.md')
      return await checkGroundings(rec.worktree, head, contract, request)
    } catch (e) {
      this.ctx.log(`근거 확인 실패 (${rec.id})`, e)
      return null
    }
  }
}

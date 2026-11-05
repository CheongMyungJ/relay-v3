// 제출 때 기준 확인 (V28, docs/m2-modules.md 3절 works.ts의 submit_contract·request_contract_change). works-contract.ts가
// 부른다. engine probeContract를 돌리고 events.jsonl에 `probe {tool, ran, problems, ms, note?}`를 남긴다. 돌려보낼 줄이 있으면
// 세션에 줄 오류 글을 만든다(모델이 읽으므로 영어): 줄마다 기준과 어긋난 것, 예시마다 기준의 결과와 JUnit 메시지(자료).
// 확인이 던지면(레포·ref를 찾지 못함) 로그만 남기고 확인 없이 받는다: 확인은 제출을 엄격하게만 바꾼다.

import type { Contract, ContractProbe, ExampleEvidence, LineVerdict } from '../core/types.ts'
import { probeContract } from '../engine/probe.ts'
import type { WorkRecord } from './store.ts'
import { message, type WorkCtx, workHead } from './works-types.ts'

/** 예시 메시지(JUnit)를 오류 글에 옮길 때의 상한 */
const MESSAGE_MAX = 300

/** 제출을 돌려보낼 줄: 확인에서 not_met */
export function probeProblems(p: ContractProbe | null): LineVerdict[] {
  return p?.lines.filter((l) => l.status === 'not_met') ?? []
}

/** Work 브랜치의 끝에서 기준 확인을 돌리고 기록한다. 던지면 null(확인 없음) */
export async function runProbe(
  ctx: WorkCtx,
  rec: WorkRecord,
  contract: Contract,
  tool: string,
): Promise<ContractProbe | null> {
  try {
    const p = await probeContract({
      repo: rec.worktree,
      head: await workHead(rec),
      base: rec.base_ref,
      contract,
      home: ctx.deps.store.home,
    })
    const note = p.note === null ? {} : { note: p.note }
    const problems = probeProblems(p).length
    ctx.note(rec.id, { type: 'probe', tool, ran: p.ran, problems, ms: p.ms, ...note })
    return p
  } catch (e) {
    ctx.log(`기준 확인 실패 (${rec.id})`, e)
    ctx.note(rec.id, { type: 'probe', tool, ran: false, problems: 0, ms: 0, note: message(e) })
    return null
  }
}

/** 예시 하나의 기준 결과(영어). 메시지는 따옴표로 감싼 자료다 */
function exampleText(e: ExampleEvidence): string {
  const what =
    e.head === 'missing'
      ? 'no tagged test, not checked'
      : e.base === 'missing'
        ? e.message === undefined
          ? 'not in the base results'
          : 'its test file did not load'
        : (e.base ?? 'not_run')
  const msg = e.message === undefined ? '' : `: ${JSON.stringify(cut(e.message))}`
  return `${e.id} ${what}${msg}`
}

const cut = (s: string): string => (s.length > MESSAGE_MAX ? `${s.slice(0, MESSAGE_MAX - 1)}…` : s)

/** 돌려보낼 줄마다 오류 한 줄(영어). 앞에 무엇을 돌렸는지 한 줄을 둔다 */
export function probeErrors(p: ContractProbe): string[] {
  const base = `the base ${p.base.slice(0, 7)}`
  const lines = probeProblems(p).map((v) => {
    const why =
      v.kind === 'change'
        ? `no example fails on ${base}, so the tagged tests do not show the changed behavior`
        : v.examples.some((e) => e.base === 'failed')
          ? `an example fails on ${base}, so the test checks changed behavior, not kept behavior`
          : `the test file does not load on ${base}; a keep test can use only what the base has`
    return `${v.line} (${v.kind}): ${why}. On the base: ${v.examples.map(exampleText).join('; ')}.`
  })
  const ran = `relay ran the acceptance command on ${base} with the changed test files of head ${p.head.slice(0, 7)} and this contract's examples in place. Lines without tagged tests are not checked.`
  return [ran, ...lines]
}

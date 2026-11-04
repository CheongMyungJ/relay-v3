// 독립 리뷰의 기본 구현 (docs/m2-modules.md 3절 works.ts의 review, V4): 새 맥락의 읽기 전용 claude -p. 언제 부르고 결과를
// 어디에 붙이는지는 works-evidence.ts가 정한다. works-evidence.ts가 600줄을 넘지 않게 나눴다.

import { claudeJson } from '../adapters/claude.ts'
import { parseReview, REVIEW_SCHEMA, reviewPrompt } from '../core/review.ts'
import type { ReviewInput, ReviewResult } from './works-types.ts'

const REVIEW_TIMEOUT_MS = 15 * 60 * 1000
/** 리뷰어가 쓰는 읽기 도구 */
export const REVIEW_TOOLS = ['Read', 'Grep', 'Glob']

/** 독립 리뷰의 기본 구현: 새 맥락의 읽기 전용 claude -p (V4). 실패는 status 'failed'(지적 없음) */
export function claudeReview(o: {
  bin: string
  model?: string
  timeoutMs?: number
  log?: (message: string, error?: unknown) => void
}): (i: ReviewInput) => Promise<ReviewResult> {
  return async (i) => {
    const r = await claudeJson({
      bin: o.bin,
      cwd: i.cwd,
      prompt: reviewPrompt(i),
      schema: REVIEW_SCHEMA,
      allowedTools: REVIEW_TOOLS,
      timeoutMs: o.timeoutMs ?? REVIEW_TIMEOUT_MS,
      ...(o.model ? { model: o.model } : {}),
      ...(i.signal ? { signal: i.signal } : {}),
    })
    if (!r.ok) {
      o.log?.(`리뷰 실패: ${r.error}`)
      return { status: 'failed', findings: [] }
    }
    const usage = r.usage ? { usage: r.usage as Record<string, unknown> } : {}
    const parsed = parseReview(r.value)
    if (!parsed.ok) {
      o.log?.(`리뷰 결과를 읽지 못함: ${parsed.errors.join('; ')}`)
      return { status: 'failed', findings: [], ...usage }
    }
    return { status: 'done', findings: parsed.value, ...usage }
  }
}

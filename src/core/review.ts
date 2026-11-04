// 독립 리뷰 (V4, docs/m2-modules.md 1절 review.ts). 새 맥락의 읽기 전용 claude -p가 이 프롬프트와 스키마로 돈다.
// 리뷰는 막지 않고 올리기만 한다: 지적의 raise(예시와 시험 불일치, 보안, 계약 밖 변경, 구조)만 관문에 들어간다.
// 프롬프트는 모델이 읽으므로 영어다. 리뷰·시험을 고치라는 지시를 세션에 넣지 않는다(V4, V8).

import { err, ok, type Result } from './result.ts'
import type { Contract, EvidenceBundle, LineStatus, RaiseReason, ReviewFinding } from './types.ts'

const SEVERITIES = ['high', 'medium', 'low'] as const
const RAISES: readonly RaiseReason[] = [
  'example_test_mismatch',
  'security',
  'out_of_contract',
  'structure',
]

/** 프롬프트에 넣는 diff의 상한(글자 수). 넘으면 앞쪽만 넣고 알린다 */
export const REVIEW_DIFF_MAX = 60_000

/** claude -p --json-schema로 주는 출력 모양 */
export const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: [...SEVERITIES] },
          raise: {
            type: 'string',
            enum: [...RAISES],
            description: 'Only for these four kinds of finding. Leave out otherwise.',
          },
          file: { type: 'string', description: 'Repository-relative path.' },
          line: { type: 'integer', minimum: 1 },
          text: { type: 'string' },
        },
        required: ['severity', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['findings'],
  additionalProperties: false,
} as const

/** 글 안의 가장 긴 백틱 줄보다 긴 울타리. diff 속 ``` 가 코드 블록을 닫지 않게 한다 */
function fence(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length))
  return '`'.repeat(Math.max(3, longest + 1))
}

function block(lang: string, text: string): string {
  const f = fence(text)
  return `${f}${lang}\n${text}${text.endsWith('\n') ? '' : '\n'}${f}`
}

/** 리뷰어에게 주는 프롬프트. 계약, 앱이 잰 증거의 요약, diff(앞쪽 REVIEW_DIFF_MAX자) */
export function reviewPrompt(o: {
  contract: Contract
  diffStat: string
  diff: string
  evidenceSummary: string[]
}): string {
  const cut = o.diff.length > REVIEW_DIFF_MAX
  const diff = cut ? o.diff.slice(0, REVIEW_DIFF_MAX) : o.diff
  const tag = `[${o.contract.id}:C1.1]`
  const summary = o.evidenceSummary.length
    ? o.evidenceSummary.map((l) => `- ${l}`).join('\n')
    : '- (none)'
  return `You review one change in this repository as an independent reviewer. Your tools are read-only: do not change files, do not run commands that change state.

The change was made under the approved contract below. relay has already run the repository's commands and judged the contract lines from acceptance tests tagged like \`${tag}\` (contract id and example id). Look for what those checks cannot see:

1. \`example_test_mismatch\`: a tagged test does not check its approved example (other input, a weaker assertion, other output or error), or an example has no test that really checks it.
2. \`structure\`: structure and boundary values the tests do not cover (edge values, empty input, errors, cleanup), or a structural change that the contract does not call for.
3. \`out_of_contract\`: behavior changed outside the contract's lines, or work listed in its non-goals.
4. \`security\`: injection, path traversal, leaked secrets, unsafe shell or eval, weakened checks.

Set \`raise\` only for findings of these four kinds. Other findings (naming, style, small suggestions) have no \`raise\`. Give \`file\` and \`line\` when you can point to one. Return an empty list if you find nothing. Keep each \`text\` short and concrete, and write it in Korean: a person reads the findings in relay's Korean screen.

## Contract

${block('json', JSON.stringify(o.contract, null, 2))}

## Evidence summary (from relay)

${summary}

## Diff stat

${block('', o.diffStat)}

## Diff

${block('diff', diff)}
${cut ? `\nThe diff was cut at ${REVIEW_DIFF_MAX} characters (of ${o.diff.length}). Read the changed files in the repository for the rest.\n` : ''}`
}

const LINE_ORDER: LineStatus[] = ['met', 'not_met', 'missing_evidence', 'human', 'observe']

/**
 * 모델(세션의 relay_check, 리뷰어)에게 주는 증거 사실(영어). 사람용 요약(evidence.ts summarize)과 같은 것을 담되 결론과
 * 리뷰 지적은 넣지 않는다(V4, V8). 줄과 신호의 detail은 core의 사람용 글이라 넣지 않고 상태·id·경로만 쓴다
 */
export function evidenceFacts(e: Omit<EvidenceBundle, 'review'>): string[] {
  const d = e.diff
  const out = [
    `${e.base.slice(0, 7)}..${e.head.slice(0, 7)}: ${d.files} files, +${d.added} -${d.deleted}${d.binary.length > 0 ? `, ${d.binary.length} binary` : ''}`,
  ]
  if (e.contract_change_requested) out.push('contract change requested')
  if (e.commands.length === 0) out.push('commands: none')
  for (const c of e.commands) out.push(`command ${c.id}: ${c.outcome}`)
  if (e.lines === null) out.push('contract lines: not judged (no contract)')
  else {
    const lines = e.lines
    const counts = LINE_ORDER.map((st) => [st, lines.filter((l) => l.status === st)] as const)
      .filter(([, of]) => of.length > 0)
      .map(([st, of]) => `${st} ${of.map((l) => l.line).join(' ')}`)
    out.push(`contract lines: ${counts.join('; ') || 'none'}`)
  }
  for (const r of e.ratchets)
    out.push(
      `ratchet ${r.id}: ${r.status}${r.base !== undefined && r.head !== undefined ? ` (${r.base} -> ${r.head})` : ''}`,
    )
  if (e.signals.length === 0) out.push('signals: none')
  for (const s of e.signals) out.push(`signal ${s.kind}${s.path ? `: ${s.path}` : ''}`)
  const missing = [...e.missing]
  if (e.quality.from === 'none' && !missing.includes('quality.json'))
    missing.unshift('quality.json')
  if (missing.length > 0) out.push(`missing evidence: ${missing.join(', ')}`)
  return out
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** 리뷰어의 structured_output을 지적 목록으로. id는 R1, R2, …로 매긴다. null인 선택 칸은 없는 것으로 본다 */
export function parseReview(json: unknown): Result<ReviewFinding[]> {
  if (!isRecord(json) || !Array.isArray(json['findings']))
    return err('리뷰 결과에 findings 목록이 없음')
  const errors: string[] = []
  const findings: ReviewFinding[] = []
  json['findings'].forEach((item: unknown, i) => {
    const at = `findings[${i}]`
    if (!isRecord(item)) {
      errors.push(`${at}: 객체가 아님`)
      return
    }
    const { severity, raise, file, line, text } = item
    const f: ReviewFinding = { id: `R${i + 1}`, severity: 'low', text: '' }
    if (typeof severity === 'string' && (SEVERITIES as readonly string[]).includes(severity))
      f.severity = severity as ReviewFinding['severity']
    else errors.push(`${at}.severity: high, medium, low 가운데 하나여야 함`)
    if (typeof text === 'string' && text.trim()) f.text = text.trim()
    else errors.push(`${at}.text: 비었음`)
    if (raise !== undefined && raise !== null) {
      if (typeof raise === 'string' && (RAISES as readonly string[]).includes(raise))
        f.raise = raise as RaiseReason
      else errors.push(`${at}.raise: 알 수 없는 값 ${JSON.stringify(raise)}`)
    }
    if (file !== undefined && file !== null && file !== '') {
      if (typeof file === 'string') f.file = file
      else errors.push(`${at}.file: 문자열이 아님`)
    }
    if (line !== undefined && line !== null) {
      if (typeof line === 'number' && Number.isInteger(line) && line >= 1) f.line = line
      else errors.push(`${at}.line: 1 이상의 정수가 아님`)
    }
    findings.push(f)
  })
  return errors.length ? err(...errors) : ok(findings)
}

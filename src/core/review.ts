// 독립 리뷰 (V4, docs/m2-modules.md 1절 review.ts). 새 맥락의 읽기 전용 claude -p가 이 프롬프트와 스키마로 돈다.
// 리뷰는 막지 않고 올리기만 한다: 지적의 raise(예시와 시험 불일치, 보안, 계약 밖 변경, 구조)만 관문에 들어간다.
// 프롬프트는 모델이 읽으므로 영어다. 리뷰·시험을 고치라는 지시를 세션에 넣지 않는다(V4, V8).
// 앱은 리뷰 준비(reviewReady)인 head에 리뷰를 미리 돌리고, 리뷰는 (head, 계약 hash, 프롬프트 판)에 붙는다(V23).

import { contractHash, exampleValueText } from './contract.ts'
import { err, ok, type Result } from './result.ts'
import type {
  Contract,
  EvidenceBundle,
  ExamplesFileCheck,
  LineStatus,
  RaiseReason,
  ReviewFinding,
} from './types.ts'

const SEVERITIES = ['high', 'medium', 'low'] as const
const RAISES: readonly RaiseReason[] = [
  'example_test_mismatch',
  'security',
  'out_of_contract',
  'structure',
]

/** 프롬프트에 넣는 diff의 상한(글자 수). 넘으면 앞쪽만 넣고 알린다 */
export const REVIEW_DIFF_MAX = 60_000

/**
 * 리뷰 프롬프트·스키마의 판. 바꾸면 올린다. 리뷰는 (head, 계약 hash, 이 판)에 붙는다: 앞 판의 리뷰는 내보내기에 다시 쓰지
 * 않는다(V23)
 */
export const REVIEW_PROMPT_VERSION = 1

/**
 * 리뷰 준비(V23): 이 head의 결정론 증거가 통과해 리뷰만 남았다. 계약이 있고, 묶음이 이 계약과 이 head로 만든 것이고(낡지
 * 않음), 못 미침·증거 없음 줄이 없고(줄 판정이 없으면 준비가 아니다), 명령이 모두 pass이고, 풀리지 않은 계약 변경 요청이
 * 없다. 앱은 쉬는 세션의 이 head에 리뷰를 미리 돌린다. human·observe 줄과 신호, 래칫, 없는 증거는 보지 않는다(리뷰 뒤에도
 * 사람에게 가는 사실이고, 리뷰가 그것을 바꾸지 않는다)
 */
export function reviewReady(
  e: Omit<EvidenceBundle, 'review'>,
  contract: Contract | null,
  head: string | null,
): boolean {
  if (contract === null || head === null || e.head !== head) return false
  if (e.contract?.hash !== contractHash(contract)) return false
  if ((contract.change_requested?.trim() ?? '') !== '' || e.contract_change_requested) return false
  if (e.lines === null || e.lines.length === 0) return false
  if (e.lines.some((l) => l.status === 'not_met' || l.status === 'missing_evidence')) return false
  return e.commands.every((c) => c.outcome === 'pass')
}

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

1. \`example_test_mismatch\`: a tagged test does not check its approved example (other input, a weaker assertion, other output or error), or an example has no test that really checks it. relay writes the approved examples to the examples file (see "examples file" in the evidence summary) from the approved contract, and the tests are meant to read the examples from that file. A tagged test that hard-codes example values instead of reading them from the file is also a mismatch.
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
  if (e.examples_file) out.push(examplesFileFact(e.examples_file))
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

/** 커밋된 예시 자료(V27). 다르면 어느 예시의 어느 칸이 어떻게 다른지(앞의 셋) */
function examplesFileFact(f: ExamplesFileCheck): string {
  const at = `examples file ${f.path}`
  if (f.status === 'same') return `${at}: same as the approved examples`
  if (f.status === 'absent') return `${at}: not committed`
  if (f.status !== 'differs') return `${at}: unreadable`
  const value = (v: unknown) => (v === undefined ? 'nothing' : exampleValueText(v))
  const items = f.diffs.slice(0, 3).map((d) => {
    if (d.field !== undefined)
      return `${d.id} ${d.field} (expected ${value(d.expected)}, found ${value(d.found)})`
    if (d.found === undefined) return `${d.id} missing`
    if (d.expected === undefined) return `${d.id} not in the approved examples`
    return `${d.id} (expected ${value(d.expected)}, found ${value(d.found)})`
  })
  const more = f.diffs.length > 3 ? ` and ${f.diffs.length - 3} more` : ''
  return `${at}: differs from the approved examples: ${items.join('; ')}${more}`
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

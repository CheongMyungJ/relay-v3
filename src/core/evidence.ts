// 증거 묶음을 사람이 읽는 몇 줄로 (docs/m1-modules.md evidence.ts).
// 증거는 SHA에 붙는다(V6). head가 바뀌면 낡은 증거다.

import { raises } from './review.ts'
import type {
  CommandOutcome,
  EvidenceBundle,
  ExamplesFileCheck,
  LineStatus,
  RatchetResult,
  Signal,
  SignalKind,
} from './types.ts'

const OUTCOME: Record<CommandOutcome, string> = {
  pass: '통과',
  fail: '실패',
  pre_existing: '원래 실패',
  unstable: '불안정',
  not_run: '돌리지 못함',
}

const LINE: [LineStatus, string][] = [
  ['met', '충족'],
  ['not_met', '못 미침'],
  ['missing_evidence', '증거 없음'],
  ['human', '사람'],
  ['observe', '관찰'],
]

const RATCHET: Record<RatchetResult['status'], string> = {
  better: '좋아짐',
  same: '그대로',
  worse: '나빠짐',
  unknown: '모름',
}

const SIGNAL: [SignalKind, string][] = [
  ['human_path', '사람 경로'],
  ['guard_path', '지킴 파일'],
  ['test_weakening', '시험 약화'],
  ['structure_change', '구조 변경'],
]

export function summarize(e: EvidenceBundle): string[] {
  const d = e.diff
  const binary: unknown = d.binary
  const bin = Array.isArray(binary) && binary.length > 0 ? ` · 바이너리 ${binary.length}` : ''
  const out = [
    `${short(e.base)}..${short(e.head)} · 파일 ${d.files} · +${d.added} −${d.deleted}${bin}`,
  ]
  if (e.contract_change_requested) out.push('계약 변경 요청 있음')
  if (e.commands.length === 0) out.push('명령: 없음')
  for (const c of e.commands) out.push(`명령 ${c.id}: ${label(OUTCOME, c.outcome)}`)
  out.push(linesText(e))
  if (e.examples_file) out.push(examplesFileText(e.examples_file))
  for (const r of e.ratchets) out.push(`래칫 ${r.id}: ${label(RATCHET, r.status)} (${r.detail})`)
  out.push(...signalsText(e.signals))
  if (e.review !== null) out.push(reviewText(e.review))
  const missing = [...e.missing]
  if (e.quality.from === 'none' && !missing.includes('quality.json'))
    missing.unshift('quality.json')
  if (missing.length > 0) out.push(`없는 증거: ${missing.join(', ')}`)
  return out
}

/** 증거가 이 head의 것이 아니면 낡음. head를 모르면 낡음으로 본다 */
export function isStale(e: EvidenceBundle, head: string): boolean {
  const want = head.trim()
  return want === '' || e.head !== want
}

function short(sha: string): string {
  return sha === '' ? '?' : sha.slice(0, 7)
}

function label<K extends string>(labels: Record<K, string>, key: K): string {
  return Object.hasOwn(labels, key) ? labels[key] : key
}

function linesText(e: EvidenceBundle): string {
  if (e.lines === null) return '줄 판정: 없음'
  if (e.lines.length === 0) return '줄 판정: 줄 없음'
  const lines = e.lines
  const parts = LINE.map(
    ([status, name]) => [name, lines.filter((v) => v.status === status).length] as const,
  )
    .filter(([, n]) => n > 0)
    .map(([name, n]) => `${name} ${n}`)
  return `줄 판정 ${lines.length}개: ${parts.join(', ')}`
}

const EXAMPLES_FILE: Record<ExamplesFileCheck['status'], string> = {
  same: '승인본과 같음',
  absent: '커밋되지 않음',
  differs: '승인본과 다름',
  unreadable: '읽지 못함',
}

/** 커밋된 예시 자료(V27). 다르면 다른 예시 id */
function examplesFileText(f: ExamplesFileCheck): string {
  const ids = [...new Set(f.diffs.map((d) => d.id))]
  const which = f.status === 'differs' && ids.length > 0 ? ` (${ids.join(', ')})` : ''
  return `예시 자료 ${f.path}: ${label(EXAMPLES_FILE, f.status)}${which}`
}

function signalsText(signals: Signal[]): string[] {
  if (signals.length === 0) return ['신호: 없음']
  const out: string[] = []
  for (const [kind, name] of SIGNAL) {
    const of = signals.filter((s) => s.kind === kind)
    if (of.length === 0) continue
    // 구조 변경은 무엇이 생겼는지(detail)가, 나머지는 어느 파일인지가 더 알려 준다
    const items = of.map((s) => (kind === 'structure_change' ? s.detail : (s.path ?? s.detail)))
    const shown = [...new Set(items)]
    const list =
      shown.slice(0, 5).join(', ') + (shown.length > 5 ? ` 외 ${shown.length - 5}개` : '')
    out.push(`신호 ${name} ${of.length}: ${list}`)
  }
  return out
}

function reviewText(review: NonNullable<EvidenceBundle['review']>): string {
  const status = review.status === 'done' ? '마침' : review.status === 'failed' ? '실패' : '건너뜀'
  const raised = review.findings.filter(raises).length
  return `리뷰: ${status}, 지적 ${review.findings.length}(올림 ${raised})`
}

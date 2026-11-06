// 관문 (V5, docs/m1-modules.md gate.ts). 모델을 부르지 않는 순수 함수다.
// 결론은 엄격한 쪽으로만 간다. 통과를 보인 증거가 없으면 통과가 아니다.
// 사람 머지로 보내는 사실이 하나라도 있으면 사람 머지. 자동 조건을 채워도
// 스위치·서버 보호·실적 중 하나라도 없으면 그림자(기록만)로 사람 머지.

import { contractHash, exampleValueText } from './contract.ts'
import { isStale } from './evidence.ts'
import { matchAny } from './glob.ts'
import { allLinesTestedAndMet, lineFixText } from './lines.ts'
import { hasRealLimit } from './quality.ts'
import { raises } from './review.ts'
import type {
  AutoCondition,
  CommandOutcome,
  Contract,
  EvidenceBundle,
  ExampleFileDiff,
  GateResult,
  Integration,
  LineStatus,
  LineVerdict,
  Policy,
  RaiseReason,
  ServerProtection,
  Signal,
  SignalKind,
} from './types.ts'

/**
 * head는 지금 브랜치 끝의 SHA다. 묶음의 head와 다르면 낡은 증거라 사람에게 보낸다(V6).
 * 모르면 null을 주고, 그때도 낡았는지 확인하지 못했으니 사람에게 보낸다.
 * whole은 단위 브랜치를 내보낼 때(V22)의 통합 증거다: 그것에 열린 것이 있거나 Work 전체 diff가 같은 조건을 못 채우면, 내보내기는
 * 자동 조건을 채운 것이 아니다(그림자도). 브랜치를 나눠도 한 diff로 낼 때보다 자동 조건을 쉽게 채우지 못한다.
 */
export function gate(
  evidence: EvidenceBundle,
  contract: Contract | null,
  policy: Policy,
  head: string | null,
  whole?: Integration,
): GateResult {
  const change = changeRequest(evidence, contract)
  if (change !== null) {
    return {
      conclusion: 'recontract',
      decisive: change,
      reasons: [change],
      condition: null,
      shadow: false,
    }
  }

  const facts = humanFacts(evidence, contract, head)
  if (facts.length > 0) return human(facts, null, false)
  const open = whole === undefined ? [] : integrationFacts(whole)
  if (open.length > 0) return human(open, null, false)

  const misses: string[] = []
  for (const c of policy.conditions) {
    const all = whole?.evidence ? conditionMisses(c, whole.evidence) : []
    const why = [...conditionMisses(c, evidence), ...all.map((w) => `Work 전체 ${w}`)]
    if (why.length === 0) return decideAuto(c, policy)
    misses.push(`조건 ${c.id}: ${why.join(', ')}`)
  }
  const none = '채운 자동 조건 없음'
  return human([none, ...(misses.length > 0 ? misses : ['정책에 자동 조건이 없음'])], null, false)
}

/**
 * 열린 것(V25, 앱의 [끝내기]): 관문이 계약 다시나 사람 머지로 보내는 사실 그대로다. gate와 같은 함수로 계산하고 새 판단은
 * 없다. 자동 조건을 못 채운 까닭, 스위치, 서버 보호, 실적, 리뷰 메모(올림이 아닌 지적, V26)는 넣지 않는다. 비면 [끝내기]가
 * 상자 없이 끝낸다. review가 거짓이면 리뷰 사실을 보지 않는다(V22의 통합 증거는 리뷰하지 않는다)
 */
export function openItems(
  evidence: EvidenceBundle,
  contract: Contract | null,
  head: string | null,
  review = true,
): string[] {
  const change = changeRequest(evidence, contract)
  return [...(change === null ? [] : [change]), ...humanFacts(evidence, contract, head, review)]
}

/** 통합 증거(V22)의 열린 것: 앱이 본 통합의 사실과, 리뷰를 빼고 계약 전체로 본 묶음의 열린 것 */
export function integrationFacts(w: Integration): string[] {
  const own = w.evidence === null ? [] : openItems(w.evidence, w.contract, w.head, false)
  const facts = [...(w.facts ?? []), ...own].map((f) => `통합 증거: ${f}`)
  return w.evidence === null ? ['통합 증거 없음', ...facts] : facts
}

function human(reasons: string[], condition: string | null, shadow: boolean): GateResult {
  return { conclusion: 'human_merge', decisive: reasons[0] ?? '', reasons, condition, shadow }
}

// ── 1. 계약 다시 ─────────────────────────────────────────────────────────────

function changeRequest(e: EvidenceBundle, contract: Contract | null): string | null {
  const text = contract?.change_requested?.trim() ?? ''
  if (text !== '') return `계약 변경 요청: ${clip(text)}`
  if (e.contract_change_requested) return '계약 변경 요청이 풀리지 않음'
  return null
}

// ── 2. 사람 머지로 보내는 사실 (엄격한 것부터) ─────────────────────────────────

function humanFacts(
  e: EvidenceBundle,
  contract: Contract | null,
  head: string | null,
  review = true,
): string[] {
  const facts = [
    ...staleFacts(e, head),
    ...signalFacts(e.signals, ['human_path', 'guard_path', 'test_weakening']),
    ...signalFacts(e.signals, ['structure_change']),
    ...unknownSignalFacts(e.signals),
    ...commandFacts(e),
    ...ratchetFacts(e),
    ...contractFacts(contract),
    ...bundleContractFacts(e, contract),
    ...lineFacts(e.lines, contract),
    ...examplesFileFacts(e.examples_file),
    ...knowledgeFacts(e.knowledge),
    ...(review ? reviewFacts(e.review) : []),
    ...e.missing.map((name) => `없는 증거: ${name}`),
    ...(e.quality.from === 'base' || e.quality.from === 'head' ? [] : ['품질 기준 없음']),
  ]
  return [...new Set(facts)]
}

function staleFacts(e: EvidenceBundle, head: string | null): string[] {
  if (head === null) return ['지금 head를 모름: 낡은 증거인지 확인하지 못함']
  if (isStale(e, head)) return [`낡은 증거: 묶음은 ${short(e.head)}, 지금 head는 ${short(head)}`]
  return []
}

function signalFacts(signals: Signal[], kinds: SignalKind[]): string[] {
  const out: string[] = []
  for (const kind of kinds) {
    for (const s of signals) {
      if (s.kind !== kind) continue
      const path = s.path ?? ''
      out.push(path === '' || s.detail.includes(path) ? s.detail : `${s.detail} — ${path}`)
    }
  }
  return out
}

const SIGNAL_KINDS = new Set<string>([
  'human_path',
  'guard_path',
  'test_weakening',
  'structure_change',
])

/** 모르는 종류의 신호(오타, 뒤 버전의 새 종류)도 버리지 않고 사람에게 보낸다 */
function unknownSignalFacts(signals: Signal[]): string[] {
  return signals
    .filter((s) => !SIGNAL_KINDS.has(s.kind))
    .map((s) => `알 수 없는 신호: ${String(s.kind)}${s.path === undefined ? '' : ` — ${s.path}`}`)
}

// pass만 통과의 증거다. 원래 실패(pre_existing)도 변경의 영향을 가릴 수 있어 사람에게 보낸다
const COMMAND_FACTS: [CommandOutcome, string][] = [
  ['fail', '명령 실패'],
  ['pre_existing', '원래 실패하던 명령'],
  ['unstable', '불안정한 명령'],
  ['not_run', '돌리지 못한 명령'],
]

function commandFacts(e: EvidenceBundle): string[] {
  const out: string[] = []
  for (const [outcome, label] of COMMAND_FACTS) {
    for (const c of e.commands) if (c.outcome === outcome) out.push(`${label}: ${c.id}`)
  }
  const known = new Set<string>(['pass', ...COMMAND_FACTS.map(([o]) => o)])
  for (const c of e.commands) {
    if (!known.has(c.outcome)) out.push(`결과를 모르는 명령: ${c.id}`)
  }
  return out
}

function ratchetFacts(e: EvidenceBundle): string[] {
  const worse = e.ratchets.filter((r) => r.status === 'worse')
  // 재지 못한 래칫은 나빠지지 않았다는 증거가 없다
  const unknown = e.ratchets.filter(
    (r) => r.status !== 'worse' && r.status !== 'better' && r.status !== 'same',
  )
  return [
    ...worse.map((r) => `래칫 나빠짐: ${r.id} (${clip(r.detail)})`),
    ...unknown.map((r) => `래칫을 재지 못함: ${r.id} (${clip(r.detail)})`),
  ]
}

/** 지식 형식 오류(V38)와 승격된 규칙의 늘어난 허용 목록(V42). anchor·아직 따르지 않는 곳·말로만은 알림이라 사실이 아니다 */
function knowledgeFacts(k: EvidenceBundle['knowledge']): string[] {
  const facts = (k?.issues ?? []).filter((i) => i.kind === 'format' || i.kind === 'allow')
  const label = (kind: string) => (kind === 'format' ? '지식 형식 오류' : '규칙의 허용 목록이 늚')
  return facts.map((i) => `${label(i.kind)}: ${i.path} (${clip(i.detail)})`)
}

function contractFacts(contract: Contract | null): string[] {
  if (contract === null) return ['계약 없음']
  if (contract.approved_by === 'human') return []
  // caller가 승인한 계약은 v3.0에서 늘 사람이 머지한다 (philosophy 5장 단계 2)
  if (contract.approved_by === 'caller') return ['사람이 승인하지 않은 계약(caller)']
  return ['승인되지 않은 계약']
}

/** 묶음을 만든 계약이 넘겨받은 계약과 같은 판인가. 고친 계약에 낡은 판정을 쓰지 못하게 한다 */
function bundleContractFacts(e: EvidenceBundle, contract: Contract | null): string[] {
  if (contract === null) return []
  const made = e.contract
  if (made === null || made === undefined) return ['증거 묶음에 계약 정보가 없음']
  if (made.id !== contract.id) return [`다른 계약으로 만든 증거: ${made.id}`]
  if (made.hash !== contractHash(contract)) return ['증거를 만든 뒤 계약이 바뀜']
  return []
}

/** 줄의 detail. 끝에 붙은 고칠 길(V33)은 자르지 않고 그 앞만 자른다 */
function lineDetail(v: LineVerdict): string {
  const fix = v.fix ? lineFixText(v.fix) : ''
  if (fix === '' || !v.detail.endsWith(fix)) return clip(v.detail)
  const cause = v.detail.slice(0, -fix.length).replace(/[.\s]+$/, '')
  return cause === '' ? fix : `${clip(cause)}. ${fix}`
}

const LINE_FACTS: [LineStatus, (v: LineVerdict) => string][] = [
  ['not_met', (v) => `줄 ${v.line} 못 미침: ${lineDetail(v)}`],
  ['missing_evidence', (v) => `줄 ${v.line} 증거 없음: ${lineDetail(v)}`],
  ['human', (v) => `줄 ${v.line}은 사람이 확인`],
  ['observe', (v) => `줄 ${v.line}은 관찰로 확인`],
]

function lineFacts(lines: LineVerdict[] | null, contract: Contract | null): string[] {
  if (lines === null || lines.length === 0) return contract === null ? [] : ['줄 판정 없음']
  const out: string[] = []
  for (const [status, text] of LINE_FACTS) {
    for (const v of lines) if (v.status === status) out.push(text(v))
  }
  const known = new Set<string>(['met', ...LINE_FACTS.map(([s]) => s)])
  for (const v of lines) if (!known.has(v.status)) out.push(`줄 ${v.line} 판정을 모름`)
  if (contract !== null) out.push(...coverageFacts(lines, contract))
  return out
}

/** 판정이 이 계약의 줄과 하나하나 맞는지. 다른 계약의 증거를 쓰지 못하게 한다 */
function coverageFacts(lines: LineVerdict[], contract: Contract): string[] {
  const out: string[] = []
  const ids = new Set(contract.lines.map((l) => l.id))
  for (const l of contract.lines) {
    const v = lines.find((x) => x.line === l.id)
    if (v === undefined) out.push(`줄 ${l.id} 판정 없음`)
    else if (
      v.kind !== l.kind ||
      (v.status === 'met' && l.check !== 'test') ||
      !sameIds(
        v.examples.map((x) => x.id),
        l.examples,
      )
    )
      out.push(`줄 ${l.id} 판정이 계약과 맞지 않음`)
  }
  for (const v of lines) if (!ids.has(v.line)) out.push(`계약에 없는 줄 판정: ${v.line}`)
  return out
}

/**
 * 커밋된 예시 자료가 승인본과 다르거나 없으면 사람에게 보낸다(V27). 줄 판정은 앱이 얹은 승인본으로 돌았지만, 머지 뒤의 회귀
 * 시험은 커밋된 파일을 읽는다
 */
function examplesFileFacts(f: EvidenceBundle['examples_file']): string[] {
  if (f === null || f === undefined || f.status === 'same') return []
  if (f.status === 'absent') return [`예시 자료 파일이 커밋되지 않음: ${f.path}`]
  if (f.status === 'unreadable')
    return [`예시 자료를 읽지 못함: ${f.path} (${clip(f.error ?? '까닭 모름')})`]
  if (f.status === 'differs')
    return [`예시 자료가 승인본과 다름: ${listText(f.diffs.map(exampleDiffText), 3)}`]
  return [`예시 자료를 견준 결과를 모름: ${f.path}`]
}

function exampleDiffText(d: ExampleFileDiff): string {
  const value = (v: unknown) => (v === undefined ? '없음' : exampleValueText(v))
  if (d.field !== undefined)
    return `${d.id} ${d.field} (기대 ${value(d.expected)}, 실제 ${value(d.found)})`
  if (d.found === undefined) return `${d.id} 없음`
  if (d.expected === undefined) return `${d.id} 승인본에 없는 예시`
  return `${d.id} (기대 ${value(d.expected)}, 실제 ${value(d.found)})`
}

const RAISE_LABEL: Record<RaiseReason, string> = {
  example_test_mismatch: '예시와 시험 불일치',
  security: '보안',
  out_of_contract: '계약 밖 변경',
  structure: '구조',
  request_gap: '요청과 어긋남',
}

/** 리뷰 상태(V15: 끝났어도 요청을 보지 않은 리뷰(V30)는 사실)와 올림(V26 raises). 메모(구조/low, 갈래 없음)는 사실이 아니다 */
function reviewFacts(review: EvidenceBundle['review']): string[] {
  if (review === null) return ['리뷰 없음']
  const out: string[] = []
  if (review.status === 'failed') out.push('리뷰 실패')
  else if (review.status !== 'done') out.push('리뷰를 건너뜀')
  else if (review.request !== true) out.push('리뷰가 요청을 보지 않음')
  for (const f of review.findings) {
    if (f.raise === undefined || !raises(f)) continue
    const label = Object.hasOwn(RAISE_LABEL, f.raise) ? RAISE_LABEL[f.raise] : f.raise
    const where =
      f.file === undefined ? '' : ` — ${f.file}${f.line === undefined ? '' : `:${f.line}`}`
    out.push(`리뷰 올림(${label}): ${clip(f.text)}${where}`)
  }
  return out
}

// ── 4. 자동 조건 (diff에 대한 술어) ──────────────────────────────────────────

/** 조건을 못 채운 까닭. 비면 채운 것 */
function conditionMisses(c: AutoCondition, e: EvidenceBundle): string[] {
  // 크기·범위 제한이 없는 조건은 모든 변경을 자동으로 보낸다. 채운 것으로 보지 않는다
  if (!hasRealLimit(c)) return ['크기·범위 제한이 없는 조건']
  const out: string[] = []
  if (c.max_changed_lines !== undefined) {
    const changed = e.diff.added + e.diff.deleted
    const binary: unknown = e.diff.binary
    if (!(changed <= c.max_changed_lines)) out.push(`바뀐 줄 ${changed} > ${c.max_changed_lines}`)
    // 바이너리는 줄 수로 크기를 잴 수 없다
    if (!Array.isArray(binary)) out.push('바이너리 변경을 모름')
    else if (binary.length > 0) out.push(`바이너리 변경: ${listText(binary.map(String))}`)
  }
  if (c.paths !== undefined) {
    const globs = c.paths
    const outside = e.diff.paths.filter((p) => !matchAny(p, globs))
    if (outside.length > 0) out.push(`조건 경로 밖: ${listText(outside)}`)
  }
  if (c.no_new_dependencies === true && e.diff.new_dependencies.length > 0)
    out.push(`새 의존성: ${listText(e.diff.new_dependencies)}`)
  if (c.no_new_modules === true && e.diff.new_modules.length > 0)
    out.push(`새 모듈: ${listText(e.diff.new_modules)}`)
  if (c.require_all_lines_tested === true) {
    const lines = e.lines
    if (lines === null || lines.length === 0 || !allLinesTestedAndMet(lines))
      out.push('줄이 모두 시험으로 확인되지 않음')
  }
  return out
}

// ── 5. 스위치·서버 보호·실적 ─────────────────────────────────────────────────

function decideAuto(c: AutoCondition, policy: Policy): GateResult {
  const blockers: string[] = []
  if (policy.auto_merge_enabled !== true) blockers.push('프로젝트에서 자동 머지가 꺼져 있음')
  blockers.push(...serverBlockers(policy.server))
  const record =
    Object.hasOwn(policy.track_record_ok, c.id) && policy.track_record_ok[c.id] === true
  if (!record) blockers.push(`조건 ${c.id}의 그림자 실적이 기준에 못 미침`)
  if (blockers.length > 0) return human(blockers, c.id, true)
  return {
    conclusion: 'auto_merge_candidate',
    decisive: `자동 조건을 채움: ${c.id}`,
    reasons: [],
    condition: c.id,
    shadow: false,
  }
}

function serverBlockers(s: ServerProtection | null): string[] {
  if (s === null) return ['서버 보호를 확인하지 못함']
  const out: string[] = []
  if (s.branch_protected !== true) out.push('기본 브랜치 보호가 없음')
  if (s.required_checks !== true) out.push('필수 검사가 없음')
  if (s.merge_queue !== true && s.up_to_date_required !== true)
    out.push('merge queue도 최신 대상 맞춤 요구도 없음')
  return out
}

// ── 공통 ────────────────────────────────────────────────────────────────────

function sameIds(a: string[], b: string[]): boolean {
  const x = new Set(a)
  return x.size === new Set(b).size && b.every((id) => x.has(id))
}

function short(sha: string): string {
  return sha === '' ? '?' : sha.slice(0, 7)
}

function clip(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > 100 ? `${t.slice(0, 99)}…` : t
}

function listText(items: string[], max = 5): string {
  const shown = items.slice(0, max).join(', ')
  return items.length > max ? `${shown} 외 ${items.length - max}개` : shown
}

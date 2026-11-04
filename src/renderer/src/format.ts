// 화면에 보일 글과 꼬리표 (docs/m2-modules.md 4절). DOM을 쓰지 않는 순수 함수만 둔다.
// 렌더러는 core를 'import type'으로만 가져오므로 낡음 판정 같은 작은 규칙은 여기에 다시 쓴다.

import type {
  CommandOutcome,
  Conclusion,
  EvidenceBundle,
  Example,
  GateResult,
  Grounding,
  GroundingCheck,
  LineKind,
  LineStatus,
  RatchetResult,
  ReviewFinding,
  SignalKind,
} from '../../core/types.ts'
import type { SessionState, WorkState, WorkView } from '../../shared/api.ts'

/** 꼬리표의 색 */
export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'muted'

// 상태 이름은 core/work.ts의 STATE_NAME과 같게 한다
export const STATE_LABEL: Record<WorkState, string> = {
  drafting: '계약 초안',
  awaiting_approval: '승인 기다림',
  working: '구현 중',
  recontract: '계약 다시',
  done: '끝남',
  abandoned: '버림',
}

export const SESSION_LABEL: Record<SessionState, string> = {
  starting: '세션 시작 중',
  running: '세션 일하는 중',
  idle: '세션 쉬는 중',
  stopped: '세션 멈춤',
}

export const KIND_LABEL: Record<LineKind, string> = {
  change: '바뀜',
  new: '새로',
  keep: '지킴',
  remove: '없앰',
  observe: '관찰',
  human: '사람',
}

export const CHECK_LABEL: Record<'test' | 'observe' | 'human', string> = {
  test: '시험',
  observe: '관찰',
  human: '사람',
}

export const LINE_STATUS: Record<LineStatus, { label: string; tone: Tone }> = {
  met: { label: '충족', tone: 'ok' },
  not_met: { label: '못 미침', tone: 'bad' },
  missing_evidence: { label: '증거 없음', tone: 'warn' },
  human: { label: '사람 확인', tone: 'info' },
  observe: { label: '관찰 확인', tone: 'info' },
}

export const OUTCOME: Record<CommandOutcome, { label: string; tone: Tone }> = {
  pass: { label: '통과', tone: 'ok' },
  fail: { label: '실패', tone: 'bad' },
  pre_existing: { label: '원래 실패', tone: 'warn' },
  unstable: { label: '불안정', tone: 'warn' },
  not_run: { label: '돌리지 못함', tone: 'muted' },
}

export const SIGNAL_LABEL: Record<SignalKind, string> = {
  human_path: '보호 경로',
  guard_path: '지킴 파일',
  test_weakening: '시험 약화',
  structure_change: '구조 변경',
}

export const RATCHET: Record<RatchetResult['status'], { label: string; tone: Tone }> = {
  better: { label: '나아짐', tone: 'ok' },
  same: { label: '그대로', tone: 'muted' },
  worse: { label: '나빠짐', tone: 'bad' },
  unknown: { label: '모름', tone: 'warn' },
}

export const SEVERITY: Record<ReviewFinding['severity'], { label: string; tone: Tone }> = {
  high: { label: '높음', tone: 'bad' },
  medium: { label: '중간', tone: 'warn' },
  low: { label: '낮음', tone: 'muted' },
}

const CONCLUSION: Record<Conclusion, { label: string; tone: Tone }> = {
  human_merge: { label: '사람 머지', tone: 'info' },
  auto_merge_candidate: { label: '자동 머지 후보', tone: 'ok' },
  recontract: { label: '계약 다시', tone: 'warn' },
}

/** 증거 패널 맨 위의 결론 한 줄. 그림자면 둘째 줄로 그 뜻을 붙인다 */
export function conclusionOf(g: GateResult): { label: string; tone: Tone; shadow: string | null } {
  const c = CONCLUSION[g.conclusion]
  const shadow = g.shadow
    ? `그림자: 자동이었으면 머지했을 것${g.condition ? ` (조건 ${g.condition})` : ''}`
    : null
  return { ...c, shadow }
}

/** 사이드바의 상태 점: 사람의 답을 기다리면 눈에 띄게 */
export function workTone(v: WorkView): Tone {
  if (v.state === 'awaiting_approval' || v.state === 'recontract') return 'warn'
  if (v.error && (v.state === 'drafting' || v.state === 'working')) return 'bad'
  if (v.state === 'done') return 'ok'
  if (v.state === 'abandoned') return 'muted'
  return 'info'
}

export const isActive = (s: WorkState): boolean =>
  s === 'drafting' || s === 'awaiting_approval' || s === 'working' || s === 'recontract'

/** 증거가 지금 HEAD의 것이 아니다(V6). HEAD를 모르면 낡았다고 하지 않는다 */
export function isStale(v: WorkView): boolean {
  return v.evidence !== null && v.head !== null && v.head !== v.evidence.head
}

/**
 * [머지]를 누를 수 있나: 관문이 계산됐고, 구현 중이고, PR이 열려 있고 Work의 기준으로 가며 그 head가 증거의 head이고,
 * 증거를 재는 중(check)이 아님. 리뷰가 도는 동안은 막지 않는다(리뷰는 사람을 막지 않는다, V4)
 */
export function canMergeView(v: WorkView): boolean {
  return (
    v.gate !== null &&
    v.state === 'working' &&
    v.pr?.state === 'OPEN' &&
    v.pr.baseRefName === v.base &&
    v.evidence !== null &&
    v.pr.headRefOid === v.evidence.head &&
    !v.evidenceRunning
  )
}

/** 결론을 정한 사실 한 줄. 리뷰가 도는 중이거나 내보내기가 아니어서 리뷰가 없으면 그 뜻을 풀어 쓴다 */
export function decisiveText(v: WorkView): string {
  const d = v.gate?.decisive ?? ''
  if (v.evidence?.review !== null) return d
  if (v.reviewRunning) return '독립 리뷰 중: 리뷰가 끝나면 결론을 다시 정합니다'
  return d === '리뷰 없음' ? '리뷰 없음 (리뷰는 PR을 열거나 갱신할 때, 끝낼 때 돕니다)' : d
}

/** [리뷰 지적] 펼침의 첫 줄. 지적이 0개라도 리뷰가 돌지 않았거나 실패했으면 '지적 없음'이라고 하지 않는다(V6) */
export function reviewNote(r: EvidenceBundle['review'], running: boolean): string | null {
  if (r === null)
    return running ? '독립 리뷰 중…' : '리뷰 없음: 리뷰는 PR을 열거나 갱신할 때, 끝낼 때 돕니다'
  if (r.status === 'failed') return '리뷰 실패: 지적을 받지 못함'
  if (r.status === 'skipped')
    return '리뷰를 건너뜀: 계약이 없거나, 리뷰 범위가 자동 후보에만인데 자동 조건을 채우지 못함'
  return r.findings.length === 0 ? '지적 없음' : null
}

/** 없는 증거: core summarize와 같은 규칙(품질 기준이 없으면 quality.json을 맨 앞에) */
export function missingOf(e: EvidenceBundle): string[] {
  const out = [...e.missing]
  if (e.quality.from === 'none' && !out.includes('quality.json')) out.unshift('quality.json')
  return out
}

/** 끝난 Work의 결과 한 줄(관문 결론보다 먼저 보인다). 끝나지 않았으면 null */
export function outcomeOf(v: WorkView): string | null {
  if (v.state === 'abandoned') return '버림'
  if (v.state !== 'done') return null
  if (v.pr?.state === 'MERGED') return `머지됨 · PR #${v.pr.number} · ${shortSha(v.pr.headRefOid)}`
  if (v.pr?.state === 'CLOSED') return `머지 없이 끝남 · PR #${v.pr.number} 닫힘`
  return '머지 없이 끝남'
}

/** 구현 중 Work의 다음 할 일 한 줄: PR이 지금 HEAD를 가리키지 않음, PR이 없음, 품질 기준이 없음 */
export function nextStep(v: WorkView): string | null {
  if (v.state !== 'working' && v.state !== 'recontract') return null
  const pr = v.pr?.state === 'OPEN' ? v.pr : null
  if (pr && v.head !== null && pr.headRefOid !== v.head)
    return `PR이 지금 HEAD(${shortSha(v.head)})를 가리키지 않음: 세션에게 push를 요청하세요`
  if (v.evidence?.quality.from === 'none')
    return '품질 기준(.relay/quality.json)이 없어 명령을 돌리지 않았습니다. 레포에서 relay init으로 초안을 만드세요'
  if (!pr && v.evidence)
    return '리뷰와 머지는 PR이 열리면 시작합니다. 세션에게 PR을 열라고 하거나 끝내기를 누르세요'
  return null
}

/** 세션이 끝났을 때 터미널에 쓰는 한 줄. 앱이 끝낸 것(SIGHUP 129, SIGTERM 143, SIGKILL 137)은 오류처럼 보이지 않게 */
export function exitText(code: number): string {
  return [129, 137, 143].includes(code) ? '[세션을 닫음]' : `[세션이 끝남: 종료 코드 ${code}]`
}

export const shortSha = (sha: string | null | undefined): string => (sha ? sha.slice(0, 7) : '—')

export function groundText(g: Grounding): string {
  switch (g.type) {
    case 'code':
      return `${g.path}:${g.line}${g.name ? ` (${g.name})` : ''}`
    case 'request':
      return `요청 “${g.quote}”`
    case 'knowledge':
      return `지식 ${g.id}`
    case 'guess':
      return '추정'
  }
}

/** 근거 하나의 확인: 확인됨, 추정(guess이거나 확인하지 못해 내림), 확인 못 함(근거 확인이 실패해 결과가 없음) */
export function groundStatus(
  g: Grounding,
  check: GroundingCheck | undefined,
): { label: string; tone: Tone } {
  if (g.type === 'guess') return { label: '추정', tone: 'warn' }
  if (!check) return { label: '확인 못 함', tone: 'muted' }
  return check.ok ? { label: '확인됨', tone: 'ok' } : { label: '추정', tone: 'warn' }
}

/** 값 하나를 짧은 한 줄로 */
export function valueText(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(v)
  if (v === undefined) return '—'
  try {
    return JSON.stringify(v) ?? String(v)
  } catch {
    return String(v)
  }
}

/** 예시 하나: 입력 → 출력, 또는 입력 → 오류 */
export function exampleText(e: Example): string {
  const out =
    e.error !== undefined
      ? `오류 ${valueText(e.error)}`
      : e.output !== undefined
        ? valueText(e.output)
        : '—'
  return `${valueText(e.input)} → ${out}`
}

export interface DiffFile {
  path: string
  added: number
  deleted: number
  binary: boolean
  patch: string
}

/** diff(id)의 글(`--stat` 출력, 빈 줄, 전체 patch)에서 patch를 파일마다 나누고 더한·뺀 줄을 센다 */
export function splitDiff(text: string): DiffFile[] {
  const at = text.search(/^diff --git /m)
  if (at < 0) return []
  const files: DiffFile[] = []
  for (const part of text.slice(at).split(/^(?=diff --git )/m)) {
    if (!part.startsWith('diff --git ')) continue
    const first = part.split('\n', 1)[0] ?? ''
    const m = / b\/(.+)$/.exec(first)
    let added = 0
    let deleted = 0
    let inHunk = false
    for (const line of part.split('\n')) {
      // 머리(--- a/…, +++ b/…)는 첫 @@ 앞에만 있다
      if (line.startsWith('@@')) inHunk = true
      else if (inHunk && line.startsWith('+')) added++
      else if (inHunk && line.startsWith('-')) deleted++
    }
    files.push({
      path: m?.[1] ?? first.slice('diff --git '.length),
      added,
      deleted,
      binary: /^(Binary files |GIT binary patch)/m.test(part),
      patch: part,
    })
  }
  return files
}

/** 시각을 '11월 4일 09:00'처럼 */
export function timeText(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 한눈에 보이는 짧은 글 (V78): 접는 칸의 오른쪽 한 마디(숫자 대신 상태), 사이드바의 Work 묶음과 만든 때, 품질 기준 알림의 짧은 글.
// DOM을 쓰지 않는 순수 함수만 둔다(시험: test/unit/renderer-summary.test.ts).

import type { EvidenceBundle } from '../../core/types.ts'
import { needsAnswer } from '../../shared/answer.ts'
import type { QualityState, WorkView } from '../../shared/api.ts'
import { findingGroups } from './findings.ts'
import type { Tone } from './format.ts'

export interface Summary {
  text: string
  tone: Tone
}

const NONE: Summary = { text: '없음', tone: 'muted' }

/** 가장 나쁜 것 하나를 말한다: rules의 앞쪽이 더 나쁘다. 모두 0이면 fallback */
function worst(rules: { n: number; text: (n: number) => string; tone: Tone }[], fallback: Summary) {
  const hit = rules.find((r) => r.n > 0)
  return hit ? { text: hit.text(hit.n), tone: hit.tone } : fallback
}

const count = <T>(xs: readonly T[], pred: (x: T) => boolean) => xs.filter(pred).length

/** 명령: 실패 > 불안정 > 원래 실패 > 돌리지 못함 > 모두 통과 */
export function commandSummary(cs: EvidenceBundle['commands']): Summary {
  if (cs.length === 0) return NONE
  const of = (o: string) => count(cs, (c) => c.outcome === o)
  return worst(
    [
      { n: of('fail'), text: (n) => `실패 ${n}`, tone: 'bad' },
      { n: of('unstable'), text: (n) => `불안정 ${n}`, tone: 'warn' },
      { n: of('pre_existing'), text: (n) => `원래 실패 ${n}`, tone: 'warn' },
      { n: of('not_run'), text: (n) => `돌리지 못함 ${n}`, tone: 'warn' },
    ],
    { text: `${cs.length}개 통과`, tone: 'ok' },
  )
}

/** 줄 판정: 못 미침 > 증거 없음 > 사람·관찰 확인 > 모두 충족 */
export function lineSummary(ls: EvidenceBundle['lines']): Summary {
  if (ls === null) return { text: '계약 없이 잼', tone: 'muted' }
  if (ls.length === 0) return NONE
  const of = (...s: string[]) => count(ls, (l) => s.includes(l.status))
  return worst(
    [
      { n: of('not_met'), text: (n) => `못 미침 ${n}`, tone: 'bad' },
      { n: of('missing_evidence'), text: (n) => `증거 없음 ${n}`, tone: 'warn' },
      { n: of('human', 'observe'), text: (n) => `사람이 볼 줄 ${n}`, tone: 'info' },
    ],
    { text: `${ls.length}개 충족`, tone: 'ok' },
  )
}

/** 래칫: 나빠짐 > 모름 > 나아짐 > 그대로 */
export function ratchetSummary(rs: EvidenceBundle['ratchets']): Summary {
  if (rs.length === 0) return NONE
  const of = (s: string) => count(rs, (r) => r.status === s)
  return worst(
    [
      { n: of('worse'), text: (n) => `나빠짐 ${n}`, tone: 'bad' },
      { n: of('unknown'), text: (n) => `모름 ${n}`, tone: 'warn' },
      { n: of('better'), text: (n) => `나아짐 ${n}`, tone: 'ok' },
    ],
    { text: `${rs.length}개 그대로`, tone: 'muted' },
  )
}

/** 수만 있는 칸(신호, 없는 증거, 사람에게 보낸 까닭, 빚): 있으면 경고 */
export function countSummary(n: number, tone: Tone = 'warn'): Summary {
  return n === 0 ? NONE : { text: `${n}개`, tone }
}

/** 지식(V38): 형식 오류나 허용 목록이 늚은 나쁨, 나머지 문제는 경고. 말로만 남은 규칙은 세지 않는다 */
export function knowledgeSummary(k: NonNullable<EvidenceBundle['knowledge']>): Summary {
  const rest = k.issues.filter((i) => i.kind !== 'spoken')
  const hard = count(rest, (i) => i.kind === 'format' || i.kind === 'allow')
  return worst(
    [
      { n: hard, text: () => `문제 ${rest.length}`, tone: 'bad' },
      { n: rest.length, text: (n) => `알림 ${n}`, tone: 'warn' },
    ],
    NONE,
  )
}

/**
 * 리뷰 지적: 올림이 있으면 경고, 메모만 있으면 흐리게. 리뷰가 끝나지 않았으면(돌지 않음, 도는 중, 실패, 건너뜀, 꺼짐) '없음'이라고
 * 하지 않고 그 상태를 말한다(V6: format.ts reviewNote와 같은 갈래)
 */
export function reviewSummary(
  r: EvidenceBundle['review'],
  o: { running?: boolean; disabled?: boolean } = {},
): Summary {
  if (o.disabled && (r === null || r.status === 'skipped'))
    return { text: '리뷰 꺼짐', tone: 'muted' }
  if (r === null)
    return o.running ? { text: '도는 중', tone: 'info' } : { text: '리뷰 없음', tone: 'muted' }
  if (r.status === 'failed') return { text: '리뷰 실패', tone: 'warn' }
  if (r.status === 'skipped') return { text: '건너뜀', tone: 'muted' }
  const { raised, notes } = findingGroups(r.findings)
  if (raised.length > 0)
    return {
      text: `올림 ${raised.length}${notes.length > 0 ? ` · 메모 ${notes.length}` : ''}`,
      tone: 'warn',
    }
  return notes.length > 0 ? { text: `메모 ${notes.length}`, tone: 'muted' } : NONE
}

// ── 사이드바 ────────────────────────────────────────────────────────────────

/** 열린 Work(답이 필요한 것이 앞: src/shared/answer.ts)와 끝난 Work. 묶음 안의 차례는 받은 그대로(새것이 앞) */
export function splitWorks(works: WorkView[]): { open: WorkView[]; closed: WorkView[] } {
  const closed = works.filter((w) => w.state === 'done' || w.state === 'abandoned')
  const rest = works.filter((w) => !closed.includes(w))
  return { open: [...rest.filter(needsAnswer), ...rest.filter((w) => !needsAnswer(w))], closed }
}

/** 끝난 Work 묶음을 처음에 펼쳐 둘지: 셋까지는 펼치고, 고른 Work가 그 안에 있으면 펼친다 */
export function doneOpen(closed: number, holdsSelected: boolean): boolean {
  return holdsSelected || closed <= 3
}

/** 만든 때를 짧게: 방금, n분 전, n시간 전, n일 전, 그보다 오래면 날짜 */
export function agoText(iso: string, now: number): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const min = Math.floor((now - t) / 60_000)
  if (min < 1) return '방금'
  if (min < 60) return `${min}분 전`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours}시간 전`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}일 전`
  const d = new Date(t)
  return `${d.getMonth() + 1}월 ${d.getDate()}일`
}

/** 사이드바의 품질 기준 알림(V20)의 짧은 글. 온전한 글은 풍선 글과 [증거] 탭에 있다 */
export function qualityShort(q: QualityState): string | null {
  if (q === 'missing') return '품질 기준 없음'
  if (q === 'invalid') return '품질 기준이 깨짐'
  return null
}

// ── [변경] ──────────────────────────────────────────────────────────────────

/**
 * 파일 하나의 patch에서 git의 머리 줄(diff --git, index, ---, +++)을 빼고 첫 @@부터 보인다. 머리 줄이 말하는 것(새 파일,
 * 지운 파일, 이름 바꿈, 권한 바뀜)은 짧은 글로 남긴다. @@가 없으면(바이너리, 권한만 바뀜) body는 빈 글
 */
export function patchView(patch: string): { notes: string[]; body: string } {
  const lines = patch.split('\n')
  const at = lines.findIndex((l) => l.startsWith('@@'))
  const notes: string[] = []
  const note = (t: string) => {
    if (!notes.includes(t)) notes.push(t)
  }
  for (const l of at < 0 ? lines : lines.slice(0, at)) {
    if (l.startsWith('new file')) note('새 파일')
    else if (l.startsWith('deleted file')) note('지운 파일')
    else if (l.startsWith('rename from ')) note(`이름 바꿈: ${l.slice('rename from '.length)}에서`)
    else if (/^(old|new) mode /.test(l)) note('권한 바뀜')
  }
  return { notes, body: at < 0 ? '' : lines.slice(at).join('\n').trimEnd() }
}

/** 경로를 폴더와 파일 이름으로: 좁은 자리에서는 폴더가 먼저 줄고 파일 이름은 남는다 */
export function splitPath(path: string): { dir: string; base: string } {
  const i = path.lastIndexOf('/')
  return i < 0 ? { dir: '', base: path } : { dir: path.slice(0, i + 1), base: path.slice(i + 1) }
}

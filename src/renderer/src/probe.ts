// 계약 판의 제출 때 기준 확인 (V28, docs/m2-modules.md 4절): 머리의 한 줄과 예시마다 꼬리표. DOM을 쓰지 않는 순수 함수만 둔다.
// 꼬리표는 줄이 원하는 것으로 색을 정한다: 바뀜 줄의 예시는 기준에서 실패해야 바뀐 동작을 보이고(버그면 재현),
// 지킴 줄의 예시는 기준에서 통과해야 한다. 돌려보낸 계약은 보이지 않으므로 보이는 확인에는 못 미침 줄이 없다.

import type { ContractLine, ContractProbe } from '../../core/types.ts'
import { shortSha, type Tone } from './format.ts'

export interface ProbeBadge {
  label: string
  tone: Tone
  /** 꼬리표 옆에 보이는 지금 출력(기준의 JUnit 메시지를 줄인 것). 없으면 null */
  now: string | null
  /** 마우스를 올리면 보이는 글(JUnit 메시지 전체, 확인하지 않은 까닭) */
  title: string
}

/** 꼬리표에 보이는 JUnit 메시지의 글자 수 */
export const PROBE_MESSAGE_SHOWN = 60

const short = (s: string): string =>
  s.length > PROBE_MESSAGE_SHOWN ? `${s.slice(0, PROBE_MESSAGE_SHOWN - 1)}…` : s

/** 계약 판 머리의 한 줄. 확인이 없으면(V28 앞의 제출, 확인이 던짐) null */
export function probeSummary(p: ContractProbe | null): string | null {
  if (p === null) return null
  if (!p.ran) return `제출 때 기준 확인 안 함: ${p.note ?? '까닭 모름'}`
  const sec = Math.max(1, Math.round(p.ms / 1000))
  return `제출 때 기준에서 확인함: head ${shortSha(p.head)}의 태그 시험을 기준 ${shortSha(p.base)}에서 돌림 · ${sec}초`
}

/** 예시 하나의 꼬리표. 확인하는 줄(시험으로 확인하는 바뀜·지킴 줄)이 아니면 null */
export function probeBadge(p: ContractProbe, line: ContractLine, id: string): ProbeBadge | null {
  if (line.check !== 'test' || (line.kind !== 'change' && line.kind !== 'keep')) return null
  const change = line.kind === 'change'
  const badge = (label: string, tone: Tone, title = '', now: string | null = null) => ({
    label,
    tone,
    now,
    title,
  })
  if (!p.ran) return badge('확인 안 함', 'muted', p.note ?? '')
  const e = p.lines.find((l) => l.line === line.id)?.examples.find((x) => x.id === id)
  if (e === undefined || e.head === 'missing')
    return badge('확인 안 함', 'muted', 'head에 이 예시의 태그를 단 시험이 없음')
  const message = e.message ?? ''
  const now = message === '' ? null : short(message)
  switch (e.base) {
    case 'failed':
    case 'error':
      return badge('기준에서 실패', change ? 'ok' : 'bad', message, now)
    case 'passed':
      return badge('기준에서 통과', change ? 'info' : 'ok')
    case 'skipped':
      return badge('기준에서 건너뜀', 'muted')
    default:
      return now === null
        ? badge('기준에 그 시험이 없음', 'muted')
        : badge('기준에서 불러오지 못함', change ? 'info' : 'bad', message, now)
  }
}

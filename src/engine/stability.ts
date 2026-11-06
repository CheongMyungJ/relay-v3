// 관문 5회 반복 안정성의 순수한 셈 (M4f, docs/m4-design.md 8절). 앱 장치가 아니라 측정 도구(scripts/gate-repeat.ts)가 쓰는
// 이름표 붙은 측정 자료다(V31처럼). 관문 판의 파일이 아니다: 결론을 바꾸지 않고 여러 번 돈 결과를 견주기만 한다.
// - (A) 결정론 입력: 같은 head에서 check를 여러 번 돈 묶음의 칸마다 값(checkDigest)을 견준다(stabilityOf).
// - (B) 리뷰: 같은 head의 리뷰 여러 번에서 올림 유무와 올림 갈래가 갈렸나(reviewStability).
// - (C) 생성: 같은 요청을 여러 번 새로 돈 실행에서 계약 줄 종류, 사람 줄, 결론, 조건 채움, 사람 머지 까닭이 갈렸나(generationSpread).

import type { EvidenceBundle, GateResult, LineKind } from '../core/types.ts'

/** 한 번 돈 결과의 칸 → 값(글). 칸이 없으면 그 칸이 없는 것이다(견줄 때 '-') */
export type RunDigest = Record<string, string>

const sorted = (xs: readonly string[]) => [...xs].sort().join(',')

/**
 * (A) 묶음과 관문 결과에서 결정론 입력의 칸(m4-design 8절): 명령의 결과(흔들리는 시험 규칙의 판정 포함: unstable,
 * pre_existing), 래칫의 상태와 head 값, 줄 판정, 예시 자료 확인, 신호, 시험 약화, diff 크기, 못 모은 증거, 채운 조건, 결론과
 * 결정한 사실. 시각과 출력 꼬리처럼 판정에 쓰지 않는 칸은 넣지 않는다
 */
export function checkDigest(e: EvidenceBundle, g: GateResult, met: readonly string[]): RunDigest {
  const out: RunDigest = {}
  for (const c of e.commands) out[`commands.${c.id}`] = c.outcome
  for (const r of e.ratchets)
    out[`ratchets.${r.id}`] = r.head === undefined ? r.status : `${r.status} ${r.head}`
  for (const l of e.lines ?? []) out[`lines.${l.line}`] = l.status
  if (e.examples_file) out['examples_file'] = e.examples_file.status
  out['signals'] = sorted(e.signals.map((s) => `${s.kind}:${s.path ?? ''}`))
  out['test_weakening'] = String(e.signals.filter((s) => s.kind === 'test_weakening').length)
  out['diff'] = `${e.diff.files} +${e.diff.added} -${e.diff.deleted}`
  out['missing'] = sorted(e.missing)
  out['met'] = met.join(',')
  out['conclusion'] = g.conclusion
  out['decisive'] = g.decisive
  return out
}

export interface Diverged {
  field: string
  /** 반복마다의 값(차례 그대로). 그 반복에 칸이 없으면 '-' */
  values: string[]
}

export interface Stability {
  runs: number
  /** 값이 갈린 칸(칸 이름 차례) */
  diverged: Diverged[]
  /** 결론이나 채운 조건이 갈렸나(8.4 일곱째 조건: 결정론 입력만으로 결론이 갈림) */
  conclusion_changed: boolean
}

/** (A) 같은 입력을 여러 번 돈 결과에서 갈린 칸. 반복이 하나 이하면 갈린 것이 없다 */
export function stabilityOf(runs: readonly RunDigest[]): Stability {
  const fields = [...new Set(runs.flatMap((r) => Object.keys(r)))].sort()
  const diverged: Diverged[] = []
  for (const field of fields) {
    const values = runs.map((r) => r[field] ?? '-')
    if (new Set(values).size > 1) diverged.push({ field, values })
  }
  const changed = diverged.some((d) => d.field === 'conclusion' || d.field === 'met')
  return { runs: runs.length, diverged, conclusion_changed: changed }
}

/** (B) 리뷰 한 번의 결과: 상태와 올림의 '갈래/심각도'별 수(scripts/review-replay.ts의 줄과 같은 칸) */
export interface ReviewRun {
  status: 'done' | 'failed'
  raises: Record<string, number>
}

export interface ReviewStability {
  /** 끝난 반복 수(실패한 반복은 견주지 않는다) */
  done: number
  failed: number
  /** 올림이 있는 반복과 없는 반복이 함께 있다: 리뷰가 결론(사람 머지인가)을 가른다 */
  presence_flip: boolean
  /** 올린 갈래의 집합(심각도는 보지 않음)이 반복마다 같지 않다 */
  kind_flip: boolean
  /** 반복마다 올린 갈래(차례 그대로, 없으면 빈 배열) */
  kinds: string[][]
}

const kindOf = (key: string) => key.split('/')[0] ?? key

/** (B) 같은 head의 리뷰 여러 번. 끝난 반복이 둘 미만이면 갈린 것이 없다 */
export function reviewStability(runs: readonly ReviewRun[]): ReviewStability {
  const done = runs.filter((r) => r.status === 'done')
  const kinds = done.map((r) =>
    [
      ...new Set(
        Object.keys(r.raises)
          .filter((k) => (r.raises[k] ?? 0) > 0)
          .map(kindOf),
      ),
    ].sort(),
  )
  return {
    done: done.length,
    failed: runs.length - done.length,
    presence_flip: new Set(kinds.map((k) => k.length > 0)).size > 1,
    kind_flip: new Set(kinds.map((k) => k.join(','))).size > 1,
    kinds,
  }
}

/** (C) 같은 요청을 새로 돈 실행 하나(그 실행의 내보내기 묶음을 모은 것) */
export interface GenerationRun {
  /** 견주는 무리: 규약/시나리오/쪽 */
  group: string
  run: number
  /** 계약 줄의 종류(Work마다 줄 id가 겹치지 않게 모은 것) */
  kinds: LineKind[]
  /** 묶음마다의 관문 결론 */
  conclusions: string[]
  /** 실행 단위로 조건을 채웠나(규약의 실행 단위 규칙: 하나라도, 또는 모두) */
  met: boolean
  /** 사람 머지 까닭의 갈래(묶음을 모아 겹치지 않게) */
  facts: string[]
}

export interface GenerationSpread {
  group: string
  runs: number
  /** 줄 종류 다중집합('change×2,keep×1' 꼴) → 실행 수 */
  kinds: Record<string, number>
  /** 사람 줄이 있는 실행 수 */
  human: number
  /** 결론의 모음('human_merge' 또는 'auto_merge_candidate+human_merge') → 실행 수 */
  conclusions: Record<string, number>
  /** 조건을 채운 실행 수 */
  met: number
  /** 어떤 실행에는 있고 어떤 실행에는 없는 사람 머지 까닭의 갈래(사실별 귀인) */
  facts_varying: string[]
  /** 실행마다 같지 않은 것: 줄 종류 다중집합, 사람 줄 유무, 결론, 조건 채움 */
  diverged: { kinds: boolean; human: boolean; conclusion: boolean; met: boolean }
}

/** 줄 종류의 다중집합 글: 종류 이름 차례로 '종류×수' */
export function kindsKey(kinds: readonly LineKind[]): string {
  const n = new Map<string, number>()
  for (const k of kinds) n.set(k, (n.get(k) ?? 0) + 1)
  return (
    [...n]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, c]) => `${k}×${c}`)
      .join(',') || '-'
  )
}

const tally = (xs: readonly string[]) => {
  const out: Record<string, number> = {}
  for (const x of xs) out[x] = (out[x] ?? 0) + 1
  return out
}
const partly = (k: number, n: number) => k > 0 && k < n

/** (C) 무리마다 생성 분산(무리 이름 차례). 관문에서 뺄 입력이 아니고 보고만 한다(8절) */
export function generationSpread(runs: readonly GenerationRun[]): GenerationSpread[] {
  const groups = new Map<string, GenerationRun[]>()
  for (const r of runs) groups.set(r.group, [...(groups.get(r.group) ?? []), r])
  return [...groups]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([group, rs]) => {
      const kinds = tally(rs.map((r) => kindsKey(r.kinds)))
      const human = rs.filter((r) => r.kinds.includes('human')).length
      const conclusions = tally(rs.map((r) => [...new Set(r.conclusions)].sort().join('+')))
      const met = rs.filter((r) => r.met).length
      const facts = [...new Set(rs.flatMap((r) => r.facts))].sort()
      const varying = facts.filter((f) =>
        partly(rs.filter((r) => r.facts.includes(f)).length, rs.length),
      )
      const diverged = {
        kinds: Object.keys(kinds).length > 1,
        human: partly(human, rs.length),
        conclusion: Object.keys(conclusions).length > 1,
        met: partly(met, rs.length),
      }
      return {
        group,
        runs: rs.length,
        kinds,
        human,
        conclusions,
        met,
        facts_varying: varying,
        diverged,
      }
    })
}

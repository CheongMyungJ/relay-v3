// 관문 5회 반복 안정성(M4f, scripts/gate-repeat.ts)의 줄 꼴, 줄 파일 읽기, 요약 글. 돌리기는 gate-repeat.ts다(파일 상한 600줄로 나눔).
import { existsSync, readFileSync, statSync } from 'node:fs'
import {
  generationSpread,
  reviewStability,
  stabilityOf,
  type ReviewRun,
  type RunDigest,
} from '../src/engine/stability.ts'
import { generationRuns, readReplay, type ReplayBundle } from '../test/support/gate-replay.ts'

/** (A)의 한 줄 */
export interface CheckLine {
  name: string
  repeat: number
  status: 'done' | 'failed'
  error?: string
  digest: RunDigest
  ms: number
}

/** (B)의 한 줄. 리뷰 칸은 review-replay.ts reviewFields와 같다 */
export interface ReviewLine extends ReviewRun {
  name: string
  repeat: number
  dry: boolean
  prompt_version: number
  error?: string
  findings: unknown[]
  /** 리뷰어 결과의 usage에서 수인 칸(토큰). 비용 어림에 쓴다. 준비 실패나 결과가 없으면 null */
  usage: Record<string, number> | null
  ms: number
}

// ── 줄 파일 ─────────────────────────────────────────────────────────────────

export function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l, i) => {
      try {
        return JSON.parse(l) as T
      } catch {
        throw new Error(`${file}:${i + 1}: JSON이 아님`)
      }
    })
}

/** 이름마다 시도가 둘 이상인 반복 수(다시 한 반복) */
function retried(lines: readonly { name: string; repeat: number }[]): Map<string, number> {
  const tries = new Map<string, number>()
  for (const l of lines)
    tries.set(`${l.name}#${l.repeat}`, (tries.get(`${l.name}#${l.repeat}`) ?? 0) + 1)
  const out = new Map<string, number>()
  for (const [k, n] of tries) {
    const name = k.slice(0, k.lastIndexOf('#'))
    if (n > 1) out.set(name, (out.get(name) ?? 0) + 1)
  }
  return out
}

/** 이름마다 회의 마지막 줄(끝난 줄이 실패한 줄에 지지 않음), 이름은 나온 차례 */
export function latest<T extends { name: string; repeat: number; status: string }>(
  lines: readonly T[],
): Map<string, T[]> {
  const by = new Map<string, Map<number, T>>()
  for (const l of lines) {
    const m = by.get(l.name) ?? new Map<number, T>()
    const before = m.get(l.repeat)
    if (!(before?.status === 'done' && l.status !== 'done')) m.set(l.repeat, l)
    by.set(l.name, m)
  }
  return new Map(
    [...by].map(([name, m]) => [name, [...m.values()].sort((a, b) => a.repeat - b.repeat)]),
  )
}

// ── (A) 결정론 입력 ─────────────────────────────────────────────────────────

/** met을 가를 수 있는 결정론 입력의 칸(결론·met·decisive·missing이 아닌 것). M4 규약 4.1의 '입력 칸이 갈린 head' */
export const isMetInput = (field: string) =>
  /^(commands|ratchets|lines)\./.test(field) ||
  ['examples_file', 'signals', 'test_weakening', 'diff'].includes(field)

/**
 * (A)의 요약 글: 대상마다 갈린 칸, 끝에 결론이 갈린 head 수(12절 3)와 met을 가를 수 있는 입력 칸이 갈린 head 수. 분모는 끝난
 * 반복이 minDone 이상인 대상이고, 못 미친 대상은 '덜 함'이다
 */
export function checkSummary(lines: readonly CheckLine[], minDone = 2): string {
  const out = ['관문 5회 (A) 결정론 입력: 대상마다 갈린 칸(반복마다의 값)']
  let changed = 0
  let inputs = 0
  let measured = 0
  const short: string[] = []
  const again = retried(lines)
  for (const [name, ls] of latest(lines)) {
    const done = ls.filter((l) => l.status === 'done')
    const s = stabilityOf(done.map((l) => l.digest))
    const failed = ls.length - done.length
    const counted = done.length >= Math.max(2, minDone)
    if (counted) {
      measured++
      if (s.conclusion_changed) changed++
      if (s.diverged.some((d) => isMetInput(d.field))) inputs++
    } else short.push(name)
    const retry = again.get(name) ?? 0
    const head = `${name}: ${done.length}회${failed > 0 ? `, 실패 ${failed}` : ''}${retry > 0 ? `, 다시 한 반복 ${retry}` : ''}`
    const verdict = !counted
      ? '덜 함(분모에서 뺌)'
      : s.conclusion_changed
        ? '결론이 갈림'
        : s.diverged.length > 0
          ? '칸이 갈림(결론은 같음)'
          : '같음'
    out.push(`- ${head} → ${verdict}`)
    for (const d of s.diverged) out.push(`  ${d.field}: ${d.values.join(' | ')}`)
  }
  out.push(
    `결정론 입력만으로 결론(또는 채운 조건)이 갈린 head: ${changed}/${measured}`,
    `met을 가를 수 있는 입력 칸(commands, ratchets, lines, examples_file, signals, test_weakening, diff)이 갈린 head: ${inputs}/${measured}`,
    `덜 함(끝난 반복이 ${Math.max(2, minDone)} 아래): ${short.join(', ') || '-'}`,
  )
  return out.join('\n')
}

// ── (B) 리뷰 ────────────────────────────────────────────────────────────────

/**
 * (B)의 요약 글. 줄은 이 도구의 줄이나 review-replay.ts의 줄(이름 대신 key)이다. check(같은 대상 이름의 (A) 줄)를 주면 올림 유무가
 * 갈린 대상 가운데 (A)의 끝난 반복(minDone 이상)이 모두 small을 채운 대상(결론을 가르는 갈림)을 센다
 */
export function reviewSummary(
  raw: readonly (Partial<ReviewLine> & { key?: string; repeat: number; status: string })[],
  check: readonly CheckLine[] | null = null,
  minDone = 2,
): string {
  const lines = raw.map((l) => ({
    name: l.name ?? l.key ?? '?',
    repeat: l.repeat,
    status: l.status,
    raises: l.raises ?? {},
  }))
  const out = ['관문 5회 (B) 리뷰: 같은 head의 리뷰 반복마다 올린 갈래(● 올림 있음, ○ 없음)']
  let repeated = 0
  let presence = 0
  let kind = 0
  let kindOnly = 0
  const deciding: string[] = []
  const checked = check === null ? null : latest(check)
  const metAll = (name: string) => {
    const done = (checked?.get(name) ?? []).filter((l) => l.status === 'done')
    return (
      done.length >= Math.max(2, minDone) &&
      done.every((l) => (l.digest['met'] ?? '').split(',').includes('small'))
    )
  }
  for (const [name, ls] of latest(lines)) {
    const s = reviewStability(
      ls.map((l) => ({ status: l.status === 'done' ? 'done' : 'failed', raises: l.raises })),
    )
    if (s.done >= 2) repeated++
    if (s.presence_flip) presence++
    if (s.kind_flip) kind++
    if (s.kind_flip && !s.presence_flip) kindOnly++
    if (s.presence_flip && metAll(name)) deciding.push(name)
    const marks = s.kinds.map((k) => (k.length > 0 ? '●' : '○')).join('')
    const kinds = s.kinds.map((k) => k.join('+') || '-').join(' | ')
    out.push(
      `- ${name}: ${marks || '-'}${s.failed > 0 ? ` (실패 ${s.failed})` : ''} ${kinds}${s.presence_flip ? ' [유무 갈림]' : ''}${s.kind_flip ? ' [갈래 갈림]' : ''}`,
    )
  }
  out.push(
    `반복이 둘 이상인 head ${repeated}개 가운데 올림 유무가 갈림 ${presence}, 올림 갈래(심각도는 보지 않음)가 갈림 ${kind}`,
    `유무는 같고 갈래만 갈림 ${kindOnly}`,
    checked === null
      ? '결론을 가르는 갈림: (A) 자료(--check)를 주지 않아 재지 않음'
      : `결론을 가르는 갈림(유무가 갈렸고 (A)의 끝난 반복 ${Math.max(2, minDone)} 이상이 모두 small을 채운 head): ${deciding.length}${deciding.length > 0 ? ` (${deciding.join(', ')})` : ''}`,
    '이 숫자는 8.4 일곱째 조건(결정론 입력)이 아니라 devices.md 독립 리뷰 줄의 지표다(8절)',
  )
  const cost = reviewCost(raw)
  if (cost !== null) out.push(cost)
  return out.join('\n')
}

/** 끝난 리뷰 한 번의 평균 시간과 토큰(배치 비용 어림). 끝난 줄이 없으면 null */
export function reviewCost(
  raw: readonly { status: string; ms?: number; usage?: Record<string, number> | null }[],
): string | null {
  const done = raw.filter((l) => l.status === 'done')
  if (done.length === 0) return null
  const counted = done.flatMap((l) => (l.usage ? [l.usage] : []))
  const tok = (k: string) =>
    counted.length === 0
      ? '-'
      : String(Math.round(counted.reduce((n, u) => n + (u[k] ?? 0), 0) / counted.length))
  const timed = done.filter((l) => typeof l.ms === 'number' && l.ms > 0)
  const secs =
    timed.length === 0
      ? '-'
      : `${Math.round(timed.reduce((n, l) => n + (l.ms ?? 0), 0) / timed.length / 1000)}초`
  return `리뷰 한 번(끝난 반복 ${done.length}, 토큰을 적은 반복 ${counted.length}): 평균 ${secs}, 토큰 평균 입력 ${tok('input_tokens')}, 캐시 읽기 ${tok('cache_read_input_tokens')}, 캐시 쓰기 ${tok('cache_creation_input_tokens')}, 출력 ${tok('output_tokens')}`
}

// ── (C) 생성 ────────────────────────────────────────────────────────────────

/** 재생 자료 읽기: 폴더(그 안의 *.jsonl)나 .jsonl 파일 */
export function readReplayInputs(inputs: string[]): ReplayBundle[] {
  return inputs.flatMap((p) =>
    statSync(p).isDirectory() ? readReplay(p) : readJsonl<ReplayBundle>(p),
  )
}

/** (C)의 요약 글: 실행이 둘 이상인 무리마다 줄 종류, 사람 줄, 결론, 조건 채움, 갈린 까닭 */
export function generationSummary(bundles: readonly ReplayBundle[]): string {
  const spread = generationSpread(generationRuns(bundles)).filter((s) => s.runs >= 2)
  const counts = (r: Record<string, number>) =>
    Object.entries(r)
      .map(([k, n]) => `${k} ${n}`)
      .join('; ')
  const out = [
    '관문 5회 (C) 생성: 같은 요청을 새로 돈 실행(재생 자료, 지금 관문, 초안 정책). 생성 분산이라 관문에서 뺄 입력이 아니고 보고만 한다',
    '| 무리 | 실행 | 줄 종류(실행 수) | 사람 줄 | 결론(실행 수) | 조건 채움 | 실행마다 다른 까닭 |',
    '|---|---|---|---|---|---|---|',
  ]
  for (const s of spread)
    out.push(
      `| ${s.group} | ${s.runs} | ${counts(s.kinds)} | ${s.human}/${s.runs} | ${counts(s.conclusions)} | ${s.met}/${s.runs} | ${s.facts_varying.join(', ') || '-'} |`,
    )
  const n = (k: keyof (typeof spread)[number]['diverged']) => spread.filter((s) => s.diverged[k])
  const list = (xs: typeof spread) =>
    xs.map((s) => `${s.group} ${s.met}/${s.runs}`).join(', ') || '-'
  out.push(
    `무리 ${spread.length}개 가운데 실행마다 갈림: 줄 종류 ${n('kinds').length}, 사람 줄 ${n('human').length}, 결론 ${n('conclusion').length}, 조건 채움 ${n('met').length}`,
    `조건 채움이 갈린 무리: ${list(n('met'))}`,
  )
  return out.join('\n')
}

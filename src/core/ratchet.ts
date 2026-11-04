// 래칫: '나빠지지 않음'만 잰다 (docs/m1-modules.md ratchet.ts, philosophy 원칙 3).
// 옛 빚은 갚으라고 하지 않는다. 이번 변경이 더 나쁘게 만들었는지만 본다.

import { matchAny } from './glob.ts'
import type { RatchetResult, RatchetSpec, TestCase } from './types.ts'

export type FileLinesSpec = Extract<RatchetSpec, { kind: 'file_lines' }>
export type TestCountSpec = Extract<RatchetSpec, { kind: 'test_count' }>
export type CommandRatchetSpec = Extract<RatchetSpec, { kind: 'command' }>

/** 바뀐 파일 하나의 base·head 줄 수. 그쪽에 없으면 null. 셀 수 없으면 NaN(래칫은 모름) */
export interface FileLines {
  path: string
  base: number | null
  head: number | null
}

type Offender = NonNullable<RatchetResult['offenders']>[number]

// ── 파일 크기 상한 ───────────────────────────────────────────────────────────

/** 바뀐 파일만 받는다. 상한을 새로 넘거나, 이미 넘은 파일이 더 커지면 나빠짐 */
export function fileLinesRatchet(spec: FileLinesSpec, files: FileLines[]): RatchetResult {
  const { max } = spec
  const offenders: Offender[] = []
  const shrunk: string[] = []
  const unreadable: string[] = []
  for (const f of files) {
    if (!inScope(f.path, spec)) continue
    // 없음(null)과 셀 수 없음을 가른다. 셀 수 없는 파일을 지운 것으로 보면 나빠짐을 놓친다
    if (!isCountOrNull(f.base) || !isCountOrNull(f.head)) {
      unreadable.push(f.path)
      continue
    }
    const base = f.base
    const head = f.head
    if (head !== null && head > max && (base === null || base <= max || head > base)) {
      offenders.push(base === null ? { path: f.path, head } : { path: f.path, base, head })
    } else if (base !== null && base > max && (head === null || head < base)) {
      shrunk.push(`${f.path}(${base}→${head ?? '지움'})`)
    }
  }
  if (offenders.length > 0) {
    const list = offenders.map(
      (o) => `${o.path}(${o.base === undefined ? '' : `${o.base}→`}${o.head})`,
    )
    return {
      id: spec.id,
      status: 'worse',
      detail: `${max}줄을 넘음: ${listText(list)}`,
      offenders,
    }
  }
  if (unreadable.length > 0) {
    return { id: spec.id, status: 'unknown', detail: `줄 수를 셀 수 없음: ${listText(unreadable)}` }
  }
  if (shrunk.length > 0) {
    return {
      id: spec.id,
      status: 'better',
      detail: `${max}줄을 넘던 파일이 줄어듦: ${listText(shrunk)}`,
    }
  }
  return { id: spec.id, status: 'same', detail: `${max}줄을 새로 넘은 파일 없음` }
}

/** include가 비어 있으면 모든 파일을 본다. exclude에 맞으면 뺀다 */
function inScope(path: string, spec: FileLinesSpec): boolean {
  if (spec.include !== undefined && spec.include.length > 0 && !matchAny(path, spec.include))
    return false
  return !(spec.exclude !== undefined && matchAny(path, spec.exclude))
}

function isCountOrNull(n: number | null): boolean {
  return n === null || (typeof n === 'number' && Number.isInteger(n) && n >= 0)
}

// ── 시험 수 ─────────────────────────────────────────────────────────────────

/**
 * 건너뜀을 뺀 testcase 수. 한쪽이라도 결과가 없으면 모름.
 * 수가 같거나 늘어도, 기준에서 돌던 시험이 head에서 없거나 건너뛰면 나빠짐이다
 * (시험 하나를 주석으로 끄고 새 시험을 하나 더하는 것을 수만으로는 못 본다).
 */
export function testCountRatchet(
  spec: TestCountSpec,
  base: TestCase[] | null,
  head: TestCase[] | null,
): RatchetResult {
  if (base === null || head === null) {
    const which = base === null && head === null ? '양쪽' : base === null ? '기준' : 'head'
    return { id: spec.id, status: 'unknown', detail: `${which} 시험 결과가 없음` }
  }
  const r = compare(spec.id, counted(base), counted(head), 'higher', '시험 수')
  const gone = vanished(base, head)
  if (gone.length === 0) return r
  return {
    ...r,
    status: 'worse',
    detail: `기준에서 돌던 시험이 사라짐: ${listText(gone)} (${r.detail})`,
  }
}

function counted(cases: TestCase[]): number {
  return cases.filter((c) => c.status !== 'skipped').length
}

/** 기준에서 건너뛰지 않은 시험 가운데 head에서 돌지 않은 것의 이름. 파일을 옮겼으면 이름으로 찾는다 */
function vanished(base: TestCase[], head: TestCase[]): string[] {
  const title = (t: TestCase) => (t.suite === undefined ? t.name : `${t.suite} > ${t.name}`)
  const full = (t: TestCase) => `${t.classname ?? ''}\0${t.file ?? ''}\0${title(t)}`
  const ran = head.filter((t) => t.status !== 'skipped')
  const byFull = new Set(ran.map(full))
  const byTitle = new Set(ran.map(title))
  const out: string[] = []
  for (const t of base) {
    if (t.status === 'skipped' || byFull.has(full(t)) || byTitle.has(title(t))) continue
    if (!out.includes(title(t))) out.push(title(t))
  }
  return out
}

// ── 명령 지표 ───────────────────────────────────────────────────────────────

/** 표준 출력의 마지막 숫자 줄을 지표로 읽는다. 못 읽으면 모름 */
export function commandRatchet(
  spec: CommandRatchetSpec,
  base: string | null,
  head: string | null,
): RatchetResult {
  const b = base === null ? null : lastNumber(base)
  const h = head === null ? null : lastNumber(head)
  if (b === null || h === null) {
    const parts: string[] = []
    if (b === null)
      parts.push(base === null ? '기준 출력이 없음' : '기준 출력에서 숫자를 읽지 못함')
    if (h === null)
      parts.push(head === null ? 'head 출력이 없음' : 'head 출력에서 숫자를 읽지 못함')
    return {
      id: spec.id,
      status: 'unknown',
      ...(b === null ? {} : { base: b }),
      ...(h === null ? {} : { head: h }),
      detail: parts.join(', '),
    }
  }
  const label = spec.better === 'lower' ? '낮을수록 좋음' : '높을수록 좋음'
  return compare(spec.id, b, h, spec.better, `${spec.id}(${label})`)
}

const NUMBER_LINE = /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/

/** 마지막 숫자 줄의 값. 숫자 줄이 없으면 null */
export function lastNumber(stdout: string): number | null {
  const lines = stdout.split(/\r\n|\n|\r/)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = (lines[i] ?? '').trim()
    if (!NUMBER_LINE.test(line)) continue
    const n = Number(line)
    if (Number.isFinite(n)) return n
  }
  return null
}

// ── 공통 ────────────────────────────────────────────────────────────────────

function compare(
  id: string,
  base: number,
  head: number,
  better: 'lower' | 'higher',
  label: string,
): RatchetResult {
  const detail = `${label} ${base} → ${head}`
  if (head === base) return { id, status: 'same', base, head, detail }
  const improved = better === 'higher' ? head > base : head < base
  return { id, status: improved ? 'better' : 'worse', base, head, detail }
}

/** 다섯 개까지 쓰고 나머지는 수만 */
function listText(items: string[]): string {
  const shown = items.slice(0, 5).join(', ')
  return items.length > 5 ? `${shown} 외 ${items.length - 5}개` : shown
}

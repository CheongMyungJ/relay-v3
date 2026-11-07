// 바뀐 줄 커버리지 (docs/quality-floor.md 2절, V57): diff가 더한 소스 줄 가운데 레포의 수용 시험이 쓴 커버리지 보고서가
// 덮은 몫. 보고서는 lcov, Cobertura, JaCoCo를 읽는다. 순수 함수다(보고서 파일은 engine/ratchets.ts가 읽는다).
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { err, ok, type Result } from '../core/result.ts'
import type { DiffFacts, RatchetResult, RatchetSpec } from '../core/types.ts'
import { inScan, listText, percent } from './languages.ts'

export type DiffCoverageSpec = Extract<RatchetSpec, { kind: 'diff_coverage' }>

/** 보고서의 파일 하나: 이 파일을 가리킬 수 있는 경로들과 실행 줄마다 덮였나 */
export interface FileCoverage {
  paths: string[]
  lines: Map<number, boolean>
}

/** 바뀐 줄 커버리지가 늘 빼는 곳(타입 선언은 실행 줄이 없다) */
const COVERAGE_EXCLUDE = ['**/*.d.ts', '**/*.d.mts', '**/*.d.cts']

/**
 * 보고서 글을 읽는다. 경로는 '/'로 바꾸고, roots(실행 폴더. 링크를 푼 것도) 아래의 절대 경로는 레포 기준으로 줄인다.
 * 한 파일이 여러 번 나오면(시험 묶음마다) 어느 하나라도 덮었으면 덮음이다
 */
export function parseCoverage(
  text: string,
  format: DiffCoverageSpec['format'],
  roots: readonly string[] = [],
): Result<FileCoverage[]> {
  const raw = format === 'lcov' ? parseLcov(text) : parseXml(text, format)
  if (!raw.ok) return raw
  const merged = new Map<string, FileCoverage>()
  for (const f of raw.value) {
    const paths = [...new Set(f.paths.map((p) => relativeTo(p, roots)))]
    const key = paths.join('\0')
    const have = merged.get(key)
    if (have === undefined) merged.set(key, { paths, lines: f.lines })
    else for (const [n, c] of f.lines) have.lines.set(n, c || have.lines.get(n) === true)
  }
  return ok([...merged.values()])
}

function relativeTo(path: string, roots: readonly string[]): string {
  let p = path.replace(/\\/g, '/')
  for (const r of roots) {
    const root = r.replace(/\\/g, '/').replace(/\/+$/, '')
    if (root !== '' && p.startsWith(`${root}/`)) {
      p = p.slice(root.length + 1)
      break
    }
  }
  while (p.startsWith('./')) p = p.slice(2)
  return p
}

function parseLcov(text: string): Result<FileCoverage[]> {
  const out: FileCoverage[] = []
  let cur: FileCoverage | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('SF:')) {
      cur = { paths: [line.slice(3)], lines: new Map() }
      out.push(cur)
    } else if (line.startsWith('DA:') && cur !== null) {
      const [n, hits] = line.slice(3).split(',')
      const no = Number(n)
      if (Number.isInteger(no) && no > 0 && hits !== undefined && hits !== '')
        cur.lines.set(no, Number(hits) > 0 || cur.lines.get(no) === true)
    } else if (line === 'end_of_record') cur = null
  }
  return out.length === 0 ? err('lcov 보고서에 파일(SF:)이 없음') : ok(out)
}

type Node = Record<string, unknown>
const ARRAYS = new Set(['source', 'package', 'class', 'line', 'sourcefile', 'group'])

const kids = (n: unknown, tag: string): Node[] => {
  const v = typeof n === 'object' && n !== null ? (n as Node)[tag] : undefined
  return Array.isArray(v) ? (v as Node[]) : []
}
const one = (n: unknown, tag: string): Node | undefined => {
  const v = typeof n === 'object' && n !== null ? (n as Node)[tag] : undefined
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Node) : undefined
}
const attr = (n: Node, name: string): string => {
  const v = n[`@${name}`]
  return typeof v === 'string' || typeof v === 'number' ? String(v) : ''
}

function parseXml(text: string, format: 'cobertura' | 'jacoco'): Result<FileCoverage[]> {
  if (XMLValidator.validate(text) !== true) return err(`${format} 보고서가 XML이 아님`)
  const doc = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    parseAttributeValue: false,
    processEntities: true,
    isArray: (name) => ARRAYS.has(name),
  }).parse(text) as Node
  const out: FileCoverage[] = []
  if (format === 'cobertura') {
    const root = one(doc, 'coverage')
    if (root === undefined) return err('Cobertura 보고서에 coverage가 없음')
    const sources = kids(one(root, 'sources'), 'source')
      .map((s) => (typeof s === 'string' ? s : String((s as Node)['#text'] ?? '')))
      .filter((s) => s !== '')
    for (const pkg of kids(one(root, 'packages'), 'package')) {
      for (const cls of kids(one(pkg, 'classes'), 'class')) {
        const name = attr(cls, 'filename')
        if (name === '') continue
        const lines = new Map<number, boolean>()
        for (const l of kids(one(cls, 'lines'), 'line'))
          setLine(lines, attr(l, 'number'), Number(attr(l, 'hits')) > 0)
        const joined = sources.map((s) => `${s.replace(/[\\/]+$/, '')}/${name}`)
        out.push({ paths: [...joined, name], lines })
      }
    }
    return ok(out)
  }
  const report = one(doc, 'report')
  if (report === undefined) return err('JaCoCo 보고서에 report가 없음')
  const walk = (n: Node) => {
    for (const g of kids(n, 'group')) walk(g)
    for (const pkg of kids(n, 'package')) {
      const dir = attr(pkg, 'name')
      for (const sf of kids(pkg, 'sourcefile')) {
        const lines = new Map<number, boolean>()
        for (const l of kids(sf, 'line')) setLine(lines, attr(l, 'nr'), Number(attr(l, 'ci')) > 0)
        out.push({ paths: [dir === '' ? attr(sf, 'name') : `${dir}/${attr(sf, 'name')}`], lines })
      }
    }
  }
  walk(report)
  return ok(out)
}

function setLine(lines: Map<number, boolean>, nr: string, covered: boolean): void {
  const n = Number(nr)
  if (Number.isInteger(n) && n > 0) lines.set(n, covered || lines.get(n) === true)
}

/**
 * 레포 경로의 보고서 파일. 같은 경로가 먼저, 아니면 한쪽이 다른 쪽의 끝 조각인 것(JaCoCo의 패키지 경로, 다른 폴더에서 쓴
 * 상대 경로) 가운데 겹친 조각이 가장 긴 것. 없으면 undefined
 */
export function coverageOf(report: FileCoverage[], path: string): FileCoverage | undefined {
  let best: FileCoverage | undefined
  let score = 0
  for (const f of report) {
    for (const p of f.paths) {
      const s =
        p === path
          ? Number.MAX_SAFE_INTEGER
          : path.endsWith(`/${p}`)
            ? p.length
            : p.endsWith(`/${path}`)
              ? path.length
              : 0
      if (s > score) {
        best = f
        score = s
      }
    }
  }
  return best
}

/** 덮지 않은 줄 번호를 '경로:12,14-16'으로 */
function ranges(path: string, lines: number[]): string {
  const parts: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const from = lines[i] as number
    let to = from
    while (lines[i + 1] === to + 1) to = lines[++i] as number
    parts.push(from === to ? String(from) : `${from}-${to}`)
  }
  return `${path}:${parts.join(',')}`
}

/**
 * head만 잰다(기준에는 더한 줄이 없다). 범위 안(spec, 늘 빼는 곳, 타입 선언, more의 시험 파일)의 더한 줄 가운데 보고서의
 * 실행 줄만 센다. 보고서에 없는 파일은 세지 않고 알린다. 더한 소스 줄이 없으면 그대로. 보고서가 없거나 읽지 못했거나
 * 바뀐 소스 파일이 하나도 보고서에 없으면 '잴 수 없음'(unknown). 덮은 몫이 min 아래면 나빠짐, 아니면 그대로(나아짐은 없다).
 * head 값은 백분율(소수 한 자리)
 */
export function diffCoverageRatchet(
  spec: DiffCoverageSpec,
  report: Result<FileCoverage[]>,
  diff: Pick<DiffFacts, 'files'>,
  more: readonly string[] = [],
): RatchetResult {
  const files = diff.files.filter(
    (f) =>
      f.status !== 'D' &&
      !f.binary &&
      (f.added_at ?? []).length > 0 &&
      inScan(f.path, spec, [...COVERAGE_EXCLUDE, ...more]),
  )
  if (files.length === 0) return { id: spec.id, status: 'same', detail: '더한 소스 줄 없음' }
  if (!report.ok)
    return { id: spec.id, status: 'unknown', detail: `잴 수 없음: ${report.errors.join(', ')}` }
  let total = 0
  let covered = 0
  const absent: string[] = []
  const missed: string[] = []
  for (const f of files) {
    const cov = coverageOf(report.value, f.path)
    if (cov === undefined) {
      absent.push(f.path)
      continue
    }
    const holes: number[] = []
    for (const n of [...new Set(f.added_at)].sort((a, b) => a - b)) {
      const c = cov.lines.get(n)
      if (c === undefined) continue
      total++
      if (c) covered++
      else holes.push(n)
    }
    if (holes.length > 0) missed.push(ranges(f.path, holes))
  }
  const notIn = absent.length === 0 ? '' : ` · 보고서에 없는 파일: ${listText(absent, 3)}`
  if (absent.length === files.length)
    return {
      id: spec.id,
      status: 'unknown',
      detail: `잴 수 없음: 바뀐 소스 파일이 보고서에 없음 (${listText(absent, 3)})`,
    }
  if (total === 0)
    return { id: spec.id, status: 'same', detail: `시험이 덮을 줄이 더해지지 않음${notIn}` }
  const share = covered / total
  const head = Math.round(share * 1000) / 10
  const holes = missed.length === 0 ? '' : ` · 안 덮은 줄: ${listText(missed, 3)}`
  const detail = `바뀐 줄 커버리지 ${percent(share)} (${covered}/${total}줄, 바닥 ${percent(spec.min)})${holes}${notIn}`
  if (share >= spec.min) return { id: spec.id, status: 'same', head, detail }
  const summary = `covered ${covered} of ${total} added lines (${percent(share)}), below the floor ${percent(spec.min)}`
  return {
    id: spec.id,
    status: 'worse',
    head,
    detail,
    where: [summary, ...missed.slice(0, 5).map((m) => `${m} not covered`)],
  }
}

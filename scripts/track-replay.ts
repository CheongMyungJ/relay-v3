// 재생 실적(M4g, docs/m4-design.md 9절, V53)의 자료를 만든다. 저장된 평가 실행의 relay3 쪽 Work 장부(works/<id>/ledger.jsonl)와
// run.json(M3 순차는 Work마다의 칸)에서 Work마다 한 줄을 쓴다. 모델을 부르지 않는다. 표는 test/unit/track-replay.test.ts가
// 찍고(npm run test:track) 자료의 꼴과 셈은 test/support/track-replay.ts다.
//   node scripts/track-replay.ts test/fixtures/track-replay/<규약>.jsonl <결과 폴더>...
// 결과 폴더는 relay-v2 app/eval/results의 배치 폴더다.
// - M2·M2.1(m2-*, m21-sealed-*, m21-design-*): report.json이 있는 배치, <시나리오>/<쪽>-<n>/run.json. 쪽은 gate-replay-fixture.ts와
//   같다(relay3, relay3-noreview, relay3-m21, hands-off는 relay3-handsoff). 오류로 끝났거나 숨긴 시험 결과가 없는 실행은 건너뛴다.
// - M3 순차(m3-seq): <시나리오>/<쪽>-<n>/run.json의 complete가 참이고 works[]가 Work 차례(work)인 실행. 쪽은 relay3, relay3-m2.
//   Work의 장부는 work-<NN>/works/<짧은 id>/ledger.jsonl이다.
// - 장부는 그 relay home의 장부 전체를 그때 복사한 것이라 이 Work의 줄만 남긴다(work 칸). 판 칸(claude_version, relay_version,
//   model 등)과 project는 넣지 않는다. 모양이 다른 줄은 건너뛴다(engine isLedgerEntry). 결론 줄은 지금 앱처럼(V23) 내보내기
//   계기의 것만 남긴다: Work의 events.jsonl에서 export가 참인 evidence 사건과 head가 같고 때가 5초 안인 줄(M2 빌드는 관문마다 썼다).
// - 끝: M3는 앱의 [머지](장부에 끝 줄이 있다)와 [버림]. M2·M2.1은 gh가 없어 PR 없이 [끝내기]했다: 실행 끝의 작업 트리(final/<id>.diff,
//   `git diff --no-index base tree`)의 파일·더한 줄·뺀 줄이 마지막 Work 브랜치 결론 줄의 증거(evidence.json, 그 head일 때만)의
//   diff와 같은가를 same_as_export로 적는다(단위 브랜치 내보내기가 있거나 증거가 다른 head면 null).
// - 숨긴 시험: M2·M2.1은 실행의 outcome.success. M3는 그 Work의 outcome.success(그 Work를 머지한 main의 누적 숨긴 시험),
//   later(그 Work의 숨긴 시험이 뒤 Work의 누적에서 계속 통과했나), main(레포 시험 통과, 새로 깨뜨린 앞 Work 시험 수). 시험의
//   이름·본문·출력은 넣지 않는다.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isLedgerEntry, type LedgerEntry } from '../src/engine/ledger.ts'
import { isConclusionLine } from '../src/engine/follow.ts'
import type { EvidenceBundle } from '../src/core/types.ts'
import type { TrackEnd, TrackLine, TrackWork } from '../test/support/track-replay.ts'

const ARMS = ['relay3', 'relay3-noreview', 'relay3-m21']
const SEQ_ARMS = ['relay3', 'relay3-m2']
const KEEP: (keyof TrackLine)[] = [
  'ts',
  'head',
  'conclusion',
  'condition',
  'shadow',
  'export',
  'by',
  'merged_head',
  'closed',
  'met',
  'ended',
  'same_change',
  'accepted',
]

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T
const note = (text: string) => process.stderr.write(`${text}\n`)
/** 건너뛰거나 가르지 못한 것의 수(까닭마다). trackWorks가 돌 때마다 비운다 */
const counts = new Map<string, number>()
const count = (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1)

/** 내보내기 계기의 증거(events.jsonl의 evidence 사건 가운데 export가 참인 것)의 head와 때. 사건 기록이 없으면 null */
export function exportEvents(file: string): { head: string; ms: number }[] | null {
  if (!existsSync(file)) return null
  const out: { head: string; ms: number }[] = []
  for (const text of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!text.trim()) continue
    try {
      const e = JSON.parse(text) as {
        type?: unknown
        export?: unknown
        head?: unknown
        ts?: unknown
      }
      if (e.type === 'evidence' && e.export === true && typeof e.head === 'string')
        out.push({ head: e.head, ms: Date.parse(String(e.ts)) })
    } catch {
      // 깨진 줄은 건너뛴다
    }
  }
  return out
}

/** 장부 결론 줄과 내보내기 사건을 같은 것으로 보는 때의 차이(앱이 관문 결론과 사건을 잇달아 쓴다) */
const EXPORT_MS = 5000

/**
 * 이 Work의 장부 줄(모양이 맞는 것, 장부 차례). id는 Work의 전체 id, 모르면 짧은 id로 시작하는 것. exports가 있으면 결론 줄
 * 가운데 내보내기 계기의 것만 남긴다: M2 빌드는 관문을 낼 때마다 줄을 썼고, V23 뒤(M2.1, M3, 지금 앱)는 내보내기 계기에서만
 * 쓴다. 끝 줄과 받아들임 줄은 그대로다
 */
export function ledgerLines(
  file: string,
  id: string,
  exports: { head: string; ms: number }[] | null = null,
): TrackLine[] {
  if (!existsSync(file)) {
    // 묶은 기록에서 앱 저장소를 뺐으면(M3 runs/) 장부가 없다: 조용히 빈 장부가 되지 않게 센다
    count('장부 파일 없음(이 Work의 장부 줄 없음)')
    return []
  }
  const out: TrackLine[] = []
  for (const text of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!text.trim()) continue
    let v: unknown
    try {
      v = JSON.parse(text)
    } catch {
      count('건너뜀: 깨진 장부 줄')
      continue
    }
    if (!isLedgerEntry(v)) {
      count('건너뜀: 모양이 다른 장부 줄')
      continue
    }
    if (v.work !== id && !(id.length < 36 && v.work.startsWith(id))) continue
    const ms = Date.parse(v.ts)
    const exported = (x: { head: string; ms: number }) =>
      x.head === v.head && Math.abs(x.ms - ms) <= EXPORT_MS
    if (exports !== null && isConclusionLine(v) && !exports.some(exported)) {
      count('뺌: 내보내기 계기가 아닌 결론 줄')
      continue
    }
    const line: Record<string, unknown> = {}
    for (const k of KEEP) if (v[k] !== undefined) line[k] = v[k]
    out.push(line as TrackLine)
  }
  return out
}

/** 평가의 `git diff --no-index base tree`(a/base/, b/tree/)의 파일, 더한 줄, 뺀 줄 */
export function diffStats(text: string): { paths: string[]; added: number; deleted: number } {
  const paths: string[] = []
  let added = 0
  let deleted = 0
  let hunk = false
  let from: string | null = null
  const strip = (p: string) => p.replace(/^[ab]\/(?:base|tree)\//, '')
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      hunk = false
      from = null
      const m = /^diff --git (\S+) (\S+)$/.exec(line)
      if (m) paths.push(strip(m[2] ?? ''))
    } else if (!hunk && line.startsWith('--- ')) from = line.slice(4)
    else if (!hunk && line.startsWith('+++ ') && line.slice(4) === '/dev/null' && from)
      paths[paths.length - 1] = strip(from)
    else if (line.startsWith('@@')) hunk = true
    else if (hunk && line.startsWith('+')) added++
    else if (hunk && line.startsWith('-')) deleted++
  }
  return { paths: [...new Set(paths)].sort(), added, deleted }
}

/** 실행 끝의 작업 트리가 마지막 Work 브랜치 결론 줄의 증거 그대로인가. 가를 수 없으면 null */
function sameAsExport(dir: string, runDir: string, short: string, lines: TrackLine[]) {
  const conclusions = lines.filter((l) => isConclusionLine(l as LedgerEntry))
  if (conclusions.some((l) => l.export !== undefined)) return null
  const last = conclusions.at(-1)
  const evPath = path.join(dir, 'evidence.json')
  const diffPath = path.join(runDir, 'final', `${short}.diff`)
  if (last === undefined) return null
  if (!existsSync(evPath) || !existsSync(diffPath)) {
    // 묶은 기록이 증거나 final diff를 따로 두었으면(M2 runs/의 *.extra) 함께 풀어야 한다
    count('같은 변경을 가르지 못함: evidence.json이나 final diff 없음')
    return null
  }
  const ev = readJson<EvidenceBundle>(evPath)
  if (ev.head !== last.head) return null
  const d = diffStats(readFileSync(diffPath, 'utf8'))
  return (
    d.added === ev.diff.added &&
    d.deleted === ev.diff.deleted &&
    d.paths.join('\n') === [...ev.diff.paths].sort().join('\n')
  )
}

interface StoredRun {
  error?: unknown
  complete?: boolean
  outcome?: { success?: unknown } | null
  options?: { humanMode?: string }
  works?: StoredWork[]
}

interface StoredWork {
  id?: string
  status?: string
  end?: string | null
  /** M3 순차 */
  work?: number
  outcome?: {
    success?: boolean
    repoTestsPass?: boolean
    checks?: { name: string; regression?: boolean; pass: boolean }[]
  }
  cumulative?: { regressed?: string[] }
  appWorks?: { id: string; workId?: string; merged?: boolean; abandoned?: boolean }[]
}

function m2Works(protocol: string, runDir: string, scenario: string, arm: string, n: number) {
  const run = readJson<StoredRun>(path.join(runDir, 'run.json'))
  if (run.error !== undefined && run.error !== null) {
    count('건너뜀: 오류로 끝난 실행')
    return []
  }
  const success = run.outcome?.success
  if (typeof success !== 'boolean') {
    count('건너뜀: 숨긴 시험 결과가 없는 실행')
    return []
  }
  const side = `${arm}${run.options?.humanMode === 'hands-off' ? '-handsoff' : ''}`
  const out: TrackWork[] = []
  for (const w of run.works ?? []) {
    if (w.id === undefined) continue
    const dir = path.join(runDir, 'works', w.id)
    const workJson = path.join(dir, 'work.json')
    const full = existsSync(workJson) ? (readJson<{ id?: string }>(workJson).id ?? w.id) : w.id
    const events = exportEvents(path.join(dir, 'events.jsonl'))
    if (events === null) count('사건 기록 없음(결론 줄을 모두 둠)')
    const ledger = ledgerLines(path.join(dir, 'ledger.jsonl'), full, events)
    const end: TrackEnd =
      w.end === 'confirmed'
        ? { kind: 'ended', same_as_export: sameAsExport(dir, runDir, w.id, ledger) }
        : w.status === 'abandoned'
          ? { kind: 'abandoned' }
          : { kind: 'open' }
    count(
      `Work: ${side} (끝 ${end.kind}${end.kind === 'ended' ? ` ${String(end.same_as_export)}` : ''})`,
    )
    const work = { protocol, scenario, arm: side, run: n, work: w.id.slice(0, 8) }
    out.push({ ...work, hidden_pass: success, ledger, end })
  }
  return out
}

function m3Works(protocol: string, runDir: string, scenario: string, arm: string, n: number) {
  const run = readJson<StoredRun>(path.join(runDir, 'run.json'))
  if (run.complete !== true) {
    count('건너뜀: 끝나지 않은 순차 실행')
    return []
  }
  const seq = (run.works ?? []).filter((w) => typeof w.work === 'number')
  const own = (w: StoredWork) => (w.outcome?.checks ?? []).filter((c) => !c.regression)
  const out: TrackWork[] = []
  for (const w of seq) {
    const k = w.work ?? 0
    const names = new Set(own(w).map((c) => c.name))
    const after = seq.filter((x) => (x.work ?? 0) > k)
    const seen = after.filter((x) => (x.outcome?.checks ?? []).some((c) => names.has(c.name)))
    const broken = seen.find((x) =>
      (x.outcome?.checks ?? []).some((c) => names.has(c.name) && !c.pass),
    )
    for (const a of w.appWorks ?? []) {
      const dir = path.join(runDir, `work-${String(k).padStart(2, '0')}`, 'works', a.id)
      const events = exportEvents(path.join(dir, 'events.jsonl'))
      if (events === null) count('사건 기록 없음(결론 줄을 모두 둠)')
      const ledger = ledgerLines(path.join(dir, 'ledger.jsonl'), a.workId ?? a.id, events)
      const end: TrackEnd = a.merged
        ? { kind: 'merged' }
        : a.abandoned
          ? { kind: 'abandoned' }
          : { kind: 'open' }
      count(`Work: m3 ${arm} (끝 ${end.kind})`)
      out.push({
        protocol,
        scenario,
        arm,
        run: n,
        seq: k,
        work: a.id.slice(0, 8),
        hidden_pass: w.outcome?.success === true,
        ledger,
        end,
        later: {
          own_pass: names.size > 0 && own(w).every((c) => c.pass),
          checked: seen.length,
          first_broken: broken?.work ?? null,
        },
        main: {
          repo_tests: w.outcome?.repoTestsPass === true,
          regressed: w.cumulative?.regressed?.length ?? 0,
        },
      })
    }
  }
  return out
}

/** M3 순차 실행인가: works[]가 Work 차례(work: 수)다 */
const isSequence = (run: StoredRun) => typeof run.works?.[0]?.work === 'number'

function folderWorks(protocol: string, folder: string): TrackWork[] {
  const batch = existsSync(path.join(folder, 'report.json'))
  const out: TrackWork[] = []
  for (const s of readdirSync(folder, { withFileTypes: true })) {
    if (!s.isDirectory()) continue
    const sDir = path.join(folder, s.name)
    for (const r of readdirSync(sDir, { withFileTypes: true })) {
      const m = /^(.+)-(\d+)$/.exec(r.name)
      const runDir = path.join(sDir, r.name)
      if (!r.isDirectory() || m === null || !existsSync(path.join(runDir, 'run.json'))) continue
      const [arm = '', n = 0] = [m[1], Number(m[2])]
      const seq = isSequence(readJson<StoredRun>(path.join(runDir, 'run.json')))
      if (seq && SEQ_ARMS.includes(arm)) out.push(...m3Works(protocol, runDir, s.name, arm, n))
      else if (!seq && batch && ARMS.includes(arm))
        out.push(...m2Works(protocol, runDir, s.name, arm, n))
    }
  }
  return out
}

/** 결과 폴더들의 Work 줄(정렬, 같은 Work가 두 번이면 던짐)과 건너뛰거나 가르지 못한 것의 수 */
export function trackWorks(
  protocol: string,
  folders: string[],
): { works: TrackWork[]; counts: Map<string, number> } {
  counts.clear()
  // M2·M2.1 배치는 report.json이 있는 것만(끝나지 않은 배치, 예: *.aborted-restart는 건너뜀). M3 순차는 끝난 실행만(complete)
  const all = folders.flatMap((f) => folderWorks(protocol, f))
  const key = (w: TrackWork) =>
    [
      w.scenario,
      w.arm,
      String(w.run).padStart(3, '0'),
      String(w.seq ?? 0).padStart(3, '0'),
      w.work,
    ].join('\0')
  all.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))
  const seen = new Set<string>()
  for (const w of all) {
    if (seen.has(key(w))) throw new Error(`같은 Work가 두 번: ${key(w).replaceAll('\0', '/')}`)
    seen.add(key(w))
  }
  return { works: all, counts: new Map(counts) }
}

function main(args: string[]) {
  const [out, ...folders] = args
  if (out === undefined || !out.endsWith('.jsonl') || folders.length === 0) {
    note('쓰는 법: node scripts/track-replay.ts <규약>.jsonl <결과 폴더>...')
    process.exit(1)
  }
  const { works, counts: seen } = trackWorks(path.basename(out, '.jsonl'), folders)
  writeFileSync(out, works.map((w) => JSON.stringify(w)).join('\n') + '\n')
  for (const [k, n] of [...seen].sort()) note(`${k}: ${n}`)
  note(`${out}: ${works.length}개`)
}

const entry = process.argv[1]
if (entry !== undefined && path.resolve(entry) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2))

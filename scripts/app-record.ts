// M4 평가 (C)의 앱 기록 셈(docs/experiments/m4/protocol.md 4.7·4.8). relay-v2 평가 결과 폴더의 relay3 쪽 Work 기록(works/<id>/의
// ledger.jsonl, session-commits.jsonl, events.jsonl, hooks.log)에서 판 칸 빈 비율과 세션 커밋·트레일러·훅 사고를 센다. 모델을
// 부르지 않는다. 칸의 값(모델 이름 등)은 찍지 않고 수만 찍는다.
//   node scripts/app-record.ts [--build <relay-v3 커밋>] <결과 폴더>...
// - 실행 고르기는 scripts/track-replay.ts와 같다: report.json이 있는 배치, 오류 없고 숨긴 시험 결과가 있는 실행(뺀 실행은 까닭마다 센다).
// - 결론 줄: 그 Work의 장부(그때 relay home 장부의 복사본) 가운데 이 Work의 결론 줄. 판 열쇠는 engine epochKey(줄, 'small').
// - 트레일러 덮임: session-commits.jsonl에서 트레일러를 켠 채 본 커밋(commits 줄의 on) 가운데 트레일러가 있던 것(앱이 그 커밋의
//   메시지에서 이 Work의 Relay-Work를 찾은 값). 집합에 없는데 트레일러가 있는 커밋은 Work 브랜치의 git log가 있어야 해서 여기서 세지 않는다.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { isConclusionLine } from '../src/engine/follow.ts'
import { epochKey, isLedgerEntry, type LedgerEntry } from '../src/engine/ledger.ts'
import { parseSessionLog } from '../src/engine/session-commits.ts'

const ARMS = ['relay3', 'relay3-noreview', 'relay3-m21']
/** 판 열쇠의 칸(engine epochKey와 같은 차례). 조건 hash는 conds.small */
const EPOCH_FIELDS = [
  'conds.small',
  'model_observed',
  'effort',
  'claude_version',
  'gate_version',
  'review_prompt',
] as const

export interface AppRecord {
  runs: number
  skipped: Record<string, number>
  works: number
  /** 이 Work의 결론 줄 */
  lines: number
  /** 판 열쇠가 null인 줄 */
  no_epoch: number
  /** 칸마다 빈 줄 수 */
  empty: Record<(typeof EPOCH_FIELDS)[number], number>
  /** 서로 다른 판 열쇠마다 줄 수(값은 내지 않는다, 많은 차례) */
  epochs: number[]
  /** relay_build가 주어진 커밋으로 시작하는 줄(build를 주지 않으면 null) */
  build_match: number | null
  model_default: number
  /** 세션 커밋 기록이 있는 Work, 띄움 줄(트레일러 켬), 트레일러를 켜지 않은 띄움 */
  session_works: number
  launches: number
  launches_off: number
  /** 집합의 커밋, 트레일러를 켠 채 본 커밋, 그 가운데 트레일러가 있던 커밋 */
  commits: number
  watched: number
  trailered: number
  trailer_missing: number
  hook_incident: number
  hooks_log_lines: number
  /** 사고(hook_incident나 hooks.log 줄)가 있는 Work: 시나리오/쪽-회/Work 앞 8자 */
  incident_works: string[]
}

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T
const text = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '')
const jsonLines = (t: string): unknown[] =>
  t.split(/\r?\n/).flatMap((l) => {
    if (!l.trim()) return []
    try {
      return [JSON.parse(l) as unknown]
    } catch {
      return []
    }
  })

const field = (e: LedgerEntry, f: (typeof EPOCH_FIELDS)[number]): unknown =>
  f === 'conds.small' ? e.conds?.['small'] : e[f]

/** 결과 폴더들의 셈 */
export function appRecord(folders: string[], build: string | null = null): AppRecord {
  const r: AppRecord = {
    runs: 0,
    skipped: {},
    works: 0,
    lines: 0,
    no_epoch: 0,
    empty: Object.fromEntries(EPOCH_FIELDS.map((f) => [f, 0])) as AppRecord['empty'],
    epochs: [],
    build_match: build === null ? null : 0,
    model_default: 0,
    session_works: 0,
    launches: 0,
    launches_off: 0,
    commits: 0,
    watched: 0,
    trailered: 0,
    trailer_missing: 0,
    hook_incident: 0,
    hooks_log_lines: 0,
    incident_works: [],
  }
  const skip = (why: string) => (r.skipped[why] = (r.skipped[why] ?? 0) + 1)
  const epochs = new Map<string, number>()
  for (const folder of folders) {
    if (!existsSync(path.join(folder, 'report.json'))) {
      skip('report.json 없는 결과 폴더')
      continue
    }
    for (const s of readdirSync(folder, { withFileTypes: true })) {
      if (!s.isDirectory()) continue
      for (const d of readdirSync(path.join(folder, s.name), { withFileTypes: true })) {
        const m = /^(.+)-(\d+)$/.exec(d.name)
        if (!d.isDirectory() || m === null || !ARMS.includes(m[1] ?? '')) continue
        const runDir = path.join(folder, s.name, d.name)
        if (!existsSync(path.join(runDir, 'run.json'))) {
          skip('run.json 없음')
          continue
        }
        const run = readJson<{
          error?: unknown
          outcome?: { success?: unknown } | null
          works?: { id?: string }[]
        }>(path.join(runDir, 'run.json'))
        if (run.error !== undefined && run.error !== null) {
          skip('오류로 끝남')
          continue
        }
        if (typeof run.outcome?.success !== 'boolean') {
          skip('숨긴 시험 결과 없음')
          continue
        }
        r.runs++
        for (const w of run.works ?? []) {
          if (w.id === undefined) continue
          r.works++
          const dir = path.join(runDir, 'works', w.id)
          const workJson = path.join(dir, 'work.json')
          const id = existsSync(workJson) ? (readJson<{ id?: string }>(workJson).id ?? w.id) : w.id
          for (const v of jsonLines(text(path.join(dir, 'ledger.jsonl')))) {
            if (!isLedgerEntry(v) || !isConclusionLine(v)) continue
            if (v.work !== id && !(id.length < 36 && v.work.startsWith(id))) continue
            r.lines++
            const key = epochKey(v, 'small')
            if (key === null) r.no_epoch++
            else epochs.set(key, (epochs.get(key) ?? 0) + 1)
            for (const f of EPOCH_FIELDS) {
              const x = field(v, f)
              if (x === undefined || x === null || x === '') r.empty[f]++
            }
            if (build !== null && r.build_match !== null && v.relay_build?.startsWith(build))
              r.build_match++
            if (v.model_requested === 'default') r.model_default++
          }
          const log = text(path.join(dir, 'session-commits.jsonl'))
          if (log !== '') {
            r.session_works++
            const set = parseSessionLog(log)
            for (const v of jsonLines(log)) {
              const l = v as { kind?: unknown; trailer?: unknown }
              if (l.kind === 'launch') {
                r.launches++
                if (l.trailer !== true) r.launches_off++
              }
            }
            for (const c of set.commits.values()) {
              r.commits++
              if (c.watched) r.watched++
              if (c.watched && c.trailer) r.trailered++
            }
          }
          const events = jsonLines(text(path.join(dir, 'events.jsonl'))) as { type?: unknown }[]
          const incidents = events.filter((e) => e.type === 'hook_incident').length
          r.hook_incident += incidents
          r.trailer_missing += events.filter((e) => e.type === 'trailer_missing').length
          const hooks = text(path.join(dir, 'hooks.log'))
            .split(/\r?\n/)
            .filter((l) => l.trim() !== '').length
          r.hooks_log_lines += hooks
          if (incidents > 0 || hooks > 0)
            r.incident_works.push(`${s.name}/${d.name}/${w.id.slice(0, 8)}`)
        }
      }
    }
  }
  r.epochs = [...epochs.values()].sort((a, b) => b - a)
  return r
}

const pct = (a: number, b: number) => (b === 0 ? '-' : `${Math.round((100 * a) / b)}%`)

/** 셈의 글(값 없이 수만) */
export function appRecordText(r: AppRecord): string {
  const skipped = Object.entries(r.skipped).map(([k, n]) => `${k} ${n}`)
  return [
    `앱 기록 (M4 규약 4.7·4.8): 실행 ${r.runs}(뺌: ${skipped.join(', ') || '없음'}), Work ${r.works}`,
    `판 칸: 결론 줄 ${r.lines}, 판 열쇠가 빈 줄 ${r.no_epoch} (${pct(r.no_epoch, r.lines)})`,
    `칸마다 빈 줄: ${EPOCH_FIELDS.map((f) => `${f} ${r.empty[f]}`).join(', ')}`,
    `서로 다른 판 열쇠 ${r.epochs.length}개(판마다 줄 수: ${r.epochs.join(', ') || '-'})`,
    `relay_build가 주어진 커밋: ${r.build_match === null ? '재지 않음(--build 없음)' : `${r.build_match}/${r.lines}`}, model_requested가 default: ${r.model_default}/${r.lines}`,
    `세션 커밋: 기록이 있는 Work ${r.session_works}/${r.works}, 띄움 ${r.launches}(트레일러 끔 ${r.launches_off}), 집합의 커밋 ${r.commits}, 트레일러를 켠 채 본 커밋 ${r.watched}, 그 가운데 트레일러 있음 ${r.trailered} (덮임 ${pct(r.trailered, r.watched)})`,
    `trailer_missing ${r.trailer_missing}, hook_incident ${r.hook_incident}, hooks.log 줄 ${r.hooks_log_lines}, 사고가 있는 Work: ${r.incident_works.join(', ') || '-'}`,
  ].join('\n')
}

function main(args: string[]) {
  const { values: v, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { build: { type: 'string' } },
  })
  if (positionals.length === 0) {
    process.stderr.write('쓰는 법: node scripts/app-record.ts [--build <커밋>] <결과 폴더>...\n')
    process.exit(1)
  }
  console.log(appRecordText(appRecord(positionals, v.build ?? null)))
}

const entry = process.argv[1]
if (entry !== undefined && path.resolve(entry) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2))

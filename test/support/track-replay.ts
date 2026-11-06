// 재생 실적(M4g, docs/m4-design.md 9절, V53)의 자료 꼴, 읽기, 네 표. 자료(test/fixtures/track-replay/<규약>.jsonl)는
// scripts/track-replay.ts가 저장된 평가 실행(relay-v2 app/eval/results)의 relay3 쪽 Work 장부에서 만든다. 한 줄이 Work 하나다.
// 사람은 AI 사람 역할이고 레포는 시나리오 레포라 제품 장부($RELAY_HOME/ledger.jsonl)에 넣지 않고 trackRecord에 쓰지 않는다.
// 숨긴 시험의 본문, 정답, 봉인 글은 넣지 않는다(통과 여부와 수만).
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { ConditionStats } from '../../src/shared/api.ts'
import type { LedgerEntry } from '../../src/engine/ledger.ts'
import { isConclusionLine } from '../../src/engine/follow.ts'
import { shadowStats } from '../../src/engine/shadow.ts'
import { generationSpread, type GenerationSpread } from '../../src/engine/stability.ts'
import { generationRuns, replayNow, RUN_MET, type ReplayBundle } from './gate-replay.ts'

/** 장부 줄 하나에서 남기는 칸(판 칸, project, work는 뺀다: 실행 설정이고 줄의 열쇠는 자료 줄이 준다) */
export type TrackLine = Pick<
  LedgerEntry,
  | 'ts'
  | 'head'
  | 'conclusion'
  | 'condition'
  | 'shadow'
  | 'export'
  | 'by'
  | 'merged_head'
  | 'closed'
  | 'met'
  | 'ended'
  | 'same_change'
  | 'accepted'
>

/**
 * 평가 실행에서 Work의 끝. merged: 앱의 [머지](M3 순차, 장부에 끝 줄이 있다). ended: PR 없이 [끝내기](M2·M2.1: gh가 없는 평가.
 * same_as_export는 실행 끝의 작업 트리(final diff)가 마지막 Work 브랜치 내보내기 증거의 diff와 같은가, 가를 수 없으면 null).
 * abandoned: [버림]. open: 끝을 모름
 */
export type TrackEnd =
  | { kind: 'merged' }
  | { kind: 'ended'; same_as_export: boolean | null }
  | { kind: 'abandoned' }
  | { kind: 'open' }

export interface TrackWork {
  /** 자료를 낸 평가 규약(파일 이름과 같다: m2, m2.1, m3) */
  protocol: string
  scenario: string
  /** relay3, relay3-noreview, relay3-handsoff(M2), relay3-m21(M2.1), relay3, relay3-m2(M3 순차) */
  arm: string
  run: number
  /** M3 순차의 Work 차례(1부터). 아니면 없다 */
  seq?: number
  /** Work id 앞 8자 */
  work: string
  /** 숨긴 시험(M2·M2.1은 실행의 outcome.success, M3 순차는 그 Work를 머지한 main의 누적 숨긴 시험 전부) */
  hidden_pass: boolean
  /** 장부의 이 Work 줄(관문을 낼 때마다 한 줄과 끝 줄, 장부 차례) */
  ledger: TrackLine[]
  end: TrackEnd
  /**
   * M3 순차: 이 Work의 숨긴 시험(own)이 그때 통과했나, 뒤 Work의 누적 숨긴 시험에서 몇 번 다시 봤나(checked), 처음 깨진 뒤
   * Work의 차례(first_broken, 계속 통과면 null)
   */
  later?: { own_pass: boolean; checked: number; first_broken: number | null }
  /** M3 순차: 이 Work를 머지한 main의 레포 시험 통과(머지 뒤 main 실패의 대리)와 이 Work가 새로 깨뜨린 앞 Work 숨긴 시험 수 */
  main?: { repo_tests: boolean; regressed: number }
}

/** 폴더의 *.jsonl을 이름 차례로 읽는다 */
export function readTrack(dir: string): TrackWork[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
    .flatMap((f) =>
      readFileSync(path.join(dir, f), 'utf8')
        .split('\n')
        .filter((l) => l.trim() !== '')
        .map((l) => JSON.parse(l) as TrackWork),
    )
}

/** 실행(프로젝트)의 이름: 규약/시나리오/쪽-회 */
export const runName = (w: Pick<TrackWork, 'protocol' | 'scenario' | 'arm' | 'run'>) =>
  `${w.protocol}/${w.scenario}/${w.arm}-${w.run}`

export const workName = (w: TrackWork) => `${runName(w)}/${w.work}`

/**
 * 평가의 품질 기준은 relay init의 초안(relay-v2 eval lib/overlay.mjs, auto: [small])이라 M4a 앞의 결론 줄도 이 조건을 재었다.
 * 장부에 conds가 없는 결론 줄에 이것을 채워 비교군(그 조건을 못 채운 Work)과 lift를 셀 수 있게 한다(hash는 모름이라 'draft')
 */
export const REPLAY_CONDITIONS = ['small']

/**
 * 장부 줄로(engine/shadow.ts가 읽는 꼴). project는 실행 이름, work는 자료의 Work. 결론 줄의 conds는 REPLAY_CONDITIONS로 채운다.
 * endedAsMerge면 PR 없이 [끝내기]한 Work에 머지 끝 줄을 지어 붙인다(AI 사람 역할의 [끝내기]를 머지로 봄): 작업 트리가 내보낸
 * 그대로면 그 head를 그대로 머지, 더 바꿨으면 다른 head(더 커밋), 가를 수 없으면 같은 변경을 모름
 */
export function ledgerOf(w: TrackWork, endedAsMerge = false): LedgerEntry[] {
  const project = runName(w)
  const conds = Object.fromEntries(REPLAY_CONDITIONS.map((c) => [c, 'draft']))
  const lines: LedgerEntry[] = w.ledger.map((l) => {
    const e: LedgerEntry = { ...l, project, work: w.work, relay_version: '0.0.0' }
    return isConclusionLine(e) && e.conds === undefined ? { ...e, conds } : e
  })
  if (!endedAsMerge || w.end.kind !== 'ended') return lines
  const out = [...lines]
  for (const unit of new Set(lines.filter(isConclusionLine).map((l) => l.export))) {
    const last = lines.findLast((l) => isConclusionLine(l) && l.export === unit)
    if (last === undefined) continue
    const same = unit === undefined ? w.end.same_as_export : null
    out.push({
      ...last,
      condition: null,
      shadow: false,
      by: 'human',
      merged_head: same === true ? last.head : `${last.head}+ended`,
      same_change: same,
    })
  }
  return out
}

// ── 표 1: 조건별 그림자 정밀도·재현율 (숨긴 시험이 이름표) ──────────────────────

export interface PrecisionRow {
  protocol: string
  arm: string
  condition: string
  works: number
  pass: number
  met: number
  /** 숨긴 시험이 실패했는데 조건을 채운 Work */
  false_auto: number
  /** G1 = 채운 것 가운데 통과, G2 = 통과 가운데 채운 것 */
  g1: number | null
  g2: number | null
}

/** Work가 조건 c를 채웠나: 그 Work의 결론 줄 가운데 그림자나 자동 후보이고 met(옛 줄은 condition)에 c가 있는 것 */
export function metBy(w: TrackWork, c: string): boolean {
  return w.ledger.some(
    (l) =>
      isConclusionLine(l as LedgerEntry) &&
      (l.shadow || l.conclusion === 'auto_merge_candidate') &&
      (l.met ? l.met.includes(c) : l.condition === c),
  )
}

const ratio = (a: number, b: number) => (b === 0 ? null : a / b)

/** 표 1(평가 빌드가 장부에 적은 결론): 규약·쪽·조건마다, 단위는 Work */
export function precisionTable(works: readonly TrackWork[], conditions: string[]): PrecisionRow[] {
  const groups = new Map<string, TrackWork[]>()
  for (const w of works)
    groups.set(`${w.protocol}\0${w.arm}`, [...(groups.get(`${w.protocol}\0${w.arm}`) ?? []), w])
  const rows: PrecisionRow[] = []
  for (const [key, ws] of [...groups].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    for (const condition of conditions) {
      const [protocol = '', arm = ''] = key.split('\0')
      const met = ws.filter((w) => metBy(w, condition))
      const pass = ws.filter((w) => w.hidden_pass)
      const both = met.filter((w) => w.hidden_pass).length
      rows.push({
        protocol,
        arm,
        condition,
        works: ws.length,
        pass: pass.length,
        met: met.length,
        false_auto: met.length - both,
        g1: ratio(both, met.length),
        g2: ratio(both, pass.length),
      })
    }
  return rows
}

/**
 * 지금 관문의 재생(V31, test/fixtures/gate-replay/): 규약마다 숨긴 시험이 실패했는데 조건을 채운 묶음 수와 실행 단위 G1·G2
 * (RUN_MET). gate-replay.test.ts의 V26 줄과 같은 셈이다
 */
export function replayPrecision(bundles: readonly ReplayBundle[]) {
  const out = new Map<
    string,
    { false_auto: number; runs: number; met: number; both: number; pass: number }
  >()
  const runs = new Map<string, { protocol: string; pass: boolean; met: boolean[] }>()
  for (const b of bundles) {
    const { g } = replayNow(b)
    const s = out.get(b.protocol) ?? { false_auto: 0, runs: 0, met: 0, both: 0, pass: 0 }
    if (!b.hidden_pass && g.condition !== null) s.false_auto++
    out.set(b.protocol, s)
    const key = `${b.protocol}/${b.scenario}/${b.arm}-${b.run}`
    const r = runs.get(key) ?? { protocol: b.protocol, pass: b.hidden_pass, met: [] }
    r.met.push(g.condition !== null)
    runs.set(key, r)
  }
  for (const r of runs.values()) {
    const s = out.get(r.protocol)
    if (s === undefined) continue
    const met = RUN_MET[r.protocol] === 'all' ? r.met.every(Boolean) : r.met.some(Boolean)
    s.runs++
    if (met) s.met++
    if (r.pass) s.pass++
    if (met && r.pass) s.both++
  }
  return [...out].map(([protocol, s]) => ({
    protocol,
    ...s,
    g1: ratio(s.both, s.met),
    g2: ratio(s.both, s.pass),
  }))
}

// ── 표 2: AI 사람 역할과의 일치 (같은 shadowStats) ─────────────────────────────

/** 규약마다 shadowStats(실행을 넘어 합침, 모든 판, 시계 없음). endedAsMerge는 ledgerOf와 같다 */
export function agreementTable(
  works: readonly TrackWork[],
  endedAsMerge: boolean,
): { protocol: string; stats: Record<string, ConditionStats> }[] {
  const protocols = [...new Set(works.map((w) => w.protocol))].sort()
  return protocols.map((protocol) => ({
    protocol,
    stats: shadowStats({
      entries: works
        .filter((w) => w.protocol === protocol)
        .flatMap((w) => ledgerOf(w, endedAsMerge)),
      scope: { pool: true },
      epoch: 'all',
      now: null,
    }),
  }))
}

// ── 표 3: 머지 뒤 대리 지표 (M3 순차) ─────────────────────────────────────────

export interface AfterProxy {
  works: number
  /** 이 Work가 앞 Work의 숨긴 시험을 새로 깨뜨림(누적 숨긴 시험, regressed > 0) */
  broke: number
  /** 그때는 자기 숨긴 시험을 통과했는데 뒤 Work의 누적에서 깨짐 */
  broken_later: number
  /**
   * 귀속 규칙(6절)의 대리: 이 Work를 머지한 main의 레포 시험이 실패하고 바로 앞 main(앞 Work, 첫 Work는 시작 레포라 통과로 봄)은
   * 통과(부모 통과. 시험이 결정론이라 다시 시도도 실패로 본다). 평가에는 push CI와 되돌림이 없어 이 대리만 잴 수 있다
   */
  attributed: number
  /** 귀속 대리가 잡은 '깨뜨림'(둘 다 참) */
  caught: number
  precision: number | null
  recall: number | null
  /** 그림자 표본(조건을 채운 Work) 가운데 깨뜨림·뒤에 깨짐 */
  shadow: { works: number; broke: number; broken_later: number }
}

/** 표 3: M3 순차 자료(later·main이 있는 Work)만 */
export function afterProxy(works: readonly TrackWork[], condition: string): AfterProxy {
  const seq = works.filter(
    (w) => w.main !== undefined && w.later !== undefined && w.seq !== undefined,
  )
  const prev = (w: TrackWork) =>
    seq.find((x) => runName(x) === runName(w) && x.seq === (w.seq ?? 0) - 1)
  const parentPass = (w: TrackWork) => (w.seq === 1 ? true : (prev(w)?.main?.repo_tests ?? null))
  const broke = (w: TrackWork) => (w.main?.regressed ?? 0) > 0
  const later = (w: TrackWork) => w.later?.own_pass === true && w.later.first_broken !== null
  const attributed = seq.filter((w) => w.main?.repo_tests === false && parentPass(w) === true)
  const caught = attributed.filter(broke).length
  const shadow = seq.filter((w) => metBy(w, condition))
  return {
    works: seq.length,
    broke: seq.filter(broke).length,
    broken_later: seq.filter(later).length,
    attributed: attributed.length,
    caught,
    precision: ratio(caught, attributed.length),
    recall: ratio(caught, seq.filter(broke).length),
    shadow: {
      works: shadow.length,
      broke: shadow.filter(broke).length,
      broken_later: shadow.filter(later).length,
    },
  }
}

// ── 표 4: 생성 안정성 (8절 C) ──────────────────────────────────────────────────

/** 표 4: 관문 5회 (C)와 같은 셈(재생 묶음, 실행이 둘 이상인 무리만) */
export function generationTable(bundles: readonly ReplayBundle[]): GenerationSpread[] {
  return generationSpread(generationRuns(bundles)).filter((s) => s.runs >= 2)
}

// ── 찍기 ───────────────────────────────────────────────────────────────────────

const pct = (x: number | null) => (x === null ? '-' : `${Math.round(100 * x)}%`)
const frac = (k: number, n: number) => `${k}/${n}`

function statsLine(protocol: string, id: string, s: ConditionStats): string {
  const miss = Object.entries(s.miss)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k} ${n}`)
  const out = Object.entries(s.outside)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k} ${n}`)
  const wilson = s.wilson_low === null ? '-' : s.wilson_low.toFixed(2)
  const control = `${s.control.as_is}/${s.control.n}`
  const lift = s.lift === null ? '-' : s.lift.toFixed(2)
  return `| ${protocol} | ${id} | ${frac(s.match, s.n)} | ${wilson} | ${miss.join(', ') || '-'} | ${out.join(', ') || '-'} | ${control} | ${lift} |`
}

/** 네 표의 글(npm run test:track이 찍는다). 판정은 M4 규약(15절)에서 한다 */
export function report(works: readonly TrackWork[], bundles: readonly ReplayBundle[]): string {
  const conditions = REPLAY_CONDITIONS
  const out = [
    `재생 실적 (M4g): Work ${works.length}개(${[...new Set(works.map((w) => w.protocol))]
      .sort()
      .map((p) => `${p} ${works.filter((w) => w.protocol === p).length}`)
      .join(', ')}). 사람은 AI 사람 역할, 레포는 시나리오 레포다(제품 실적과 섞지 않음)`,
    '',
    '표 1. 조건별 그림자 정밀도·재현율(평가 빌드가 장부에 적은 결론, 단위 Work, 숨긴 시험이 이름표)',
    '| 규약 | 쪽 | 조건 | Work | 숨긴 시험 통과 | 조건 채움 | 거짓 자동 | G1 | G2 |',
    '|---|---|---|---|---|---|---|---|---|',
    ...precisionTable(works, conditions).map(
      (r) =>
        `| ${r.protocol} | ${r.arm} | ${r.condition} | ${r.works} | ${r.pass} | ${r.met} | ${r.false_auto} | ${pct(r.g1)} | ${pct(r.g2)} |`,
    ),
    `지금 관문(V31 재생 묶음, 초안 정책): ${replayPrecision(bundles)
      .map(
        (r) =>
          `${r.protocol} 거짓 자동 ${r.false_auto}, 실행 G1 ${pct(r.g1)} (${r.both}/${r.met}), G2 ${pct(r.g2)} (${r.both}/${r.pass})`,
      )
      .join('; ')}`,
    '',
  ]
  for (const asMerge of [false, true]) {
    out.push(
      `표 2${asMerge ? 'b' : 'a'}. AI 사람 역할과의 일치(shadowStats, 실행을 넘어 합침, 모든 판${asMerge ? ', PR 없이 [끝내기]를 머지로 봄' : ', 장부 그대로'})`,
      '| 규약 | 조건 | 일치 k/n | Wilson 하한 | 불일치 | 분모 밖 | 비교군 그대로 | lift |',
      '|---|---|---|---|---|---|---|---|',
    )
    for (const t of agreementTable(works, asMerge))
      for (const [id, s] of Object.entries(t.stats)) out.push(statsLine(t.protocol, id, s))
    out.push('')
  }
  const a = afterProxy(works, 'small')
  out.push(
    '표 3. 머지 뒤 대리 지표(M3 순차: 누적 숨긴 시험, main의 레포 시험)',
    `Work ${a.works}: 앞 Work의 숨긴 시험을 새로 깨뜨림 ${a.broke}, 그때 통과했는데 뒤에서 깨짐 ${a.broken_later}`,
    `귀속 대리(main 레포 시험 실패, 앞 main 통과) ${a.attributed}, 그 가운데 깨뜨림 ${a.caught}: 정밀도 ${pct(a.precision)}, 재현율 ${pct(a.recall)} (분모 0이면 '-': 잴 수 없음)`,
    `그림자 표본(조건 small을 채운 Work) ${a.shadow.works}: 깨뜨림 ${a.shadow.broke}, 뒤에서 깨짐 ${a.shadow.broken_later}`,
    '',
    '표 4. 생성 안정성(8절 C, 재생 묶음, 지금 관문): 무리마다 조건 채움 k/n, 사람 줄 k/n, 결론 갈래 수, 줄 종류 다중집합 수',
  )
  const g = generationTable(bundles)
  for (const s of g.filter((x) => x.diverged.met || x.diverged.human || x.diverged.conclusion))
    out.push(
      `- ${s.group}: 조건 채움 ${frac(s.met, s.runs)}, 사람 줄 ${frac(s.human, s.runs)}, 결론 ${Object.keys(s.conclusions).length}갈래, 줄 종류 ${Object.keys(s.kinds).length}가지`,
    )
  out.push(
    `무리 ${g.length}개 가운데 조건 채움이 갈림 ${g.filter((x) => x.diverged.met).length}, 사람 줄이 갈림 ${g.filter((x) => x.diverged.human).length}, 결론이 갈림 ${g.filter((x) => x.diverged.conclusion).length}`,
  )
  return out.join('\n')
}

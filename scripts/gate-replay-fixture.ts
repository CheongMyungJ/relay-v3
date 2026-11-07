// 관문 재생 래칫(V31, docs/m2.1-design.md 12절)의 자료를 만든다. 저장된 평가 실행에서 relay3 쪽의 내보내기 증거 묶음을
// 모아 관문이 쓰는 칸만 남기고 한 줄에 하나씩 쓴다. 시험은 test/unit/gate-replay.test.ts, 자료의 꼴은 test/support/gate-replay.ts.
//   node scripts/gate-replay-fixture.ts test/fixtures/gate-replay/<규약>.jsonl <결과 폴더>...
// 결과 폴더는 relay-v2 app/eval/results/m2-*, m21-sealed-*, m21-design-* 같은 배치 폴더다(<시나리오>/<쪽>-<n>/run.json,
// works/<id>/evidence.json·contract.json). 쪽은 relay3, relay3-noreview(M2)와 relay3-m21(M2.1)이다. M2.1의 relay3-m2p(기준
// 빌드)와 relay@auto는 넣지 않는다(M2.1 규약 5.3).
// - report.json이 없는 폴더(끝나지 않은 배치, 예: *.aborted-restart)는 건너뛴다.
// - 내보내기 때의 증거만 쓴다: 내보내기의 관문(run.json works[].gates[], M2는 works[].gate 하나)의 export가 참이고 증거의 head가
//   내보낸 head와 같아야 한다. Work 브랜치의 내보내기는 evidence.json·contract.json과 works[].exportedHead다. 단위 브랜치(V22,
//   gates[].unit)는 evidence/unit-<단위>.json·contract.<단위>.json(계약 조각)과 work.json exports[].exported_head이고, 관문이
//   함께 본 통합 증거(evidence/integration.json, 계약 전체 contract.json)를 integration에 둔다. 통합의 사실(단위 브랜치의 커밋이
//   Work 브랜치에 없음)은 앱이 따로 남기지 않아 work.json의 관문 까닭에서 읽는다.
// - 숨긴 시험은 run.json outcome.success다. 참·거짓이 아니거나 실행이 오류로 끝났으면 그 실행을 건너뛴다.
// - 시험 수 래칫은 저장된 수용 시험의 base·head 결과로 지금 코드(core/ratchet.ts)로 다시 잰다. M2·M2.1의 품질 기준은 relay
//   init의 초안(relay-v2 eval lib/overlay.mjs)이라 수용 시험 'test'와 래칫 'tests'다. 기록과 다르면 기록을 recorded_ratchets
//   (통합 증거는 recorded_integration_ratchets)에 둔다.
// - 글(리뷰 지적, 줄 판정과 래칫의 detail)은 관문이 사람 머지 까닭에 쓰는 만큼(clip)만 남기고, raise가 없는 지적은 뺀다.
// - 계약은 관문이 쓰는 칸만 남긴다(타입이 요구하는 나머지는 빈 값). 묶음의 계약 해시가 원래 계약과 맞았으면 남긴 계약의
//   해시로 바꾸고, 맞지 않았으면 그대로 둔다. 관문의 '증거를 만든 뒤 계약이 바뀜'은 어느 쪽이든 그대로 나온다. 통합 증거는
//   앱처럼(main/works-evidence.ts whole) 계약 전체와 맞지 않으면 없는 것(null)으로 둔다.
// - 모델 이름 같은 실행 설정(run.json options)은 넣지 않는다. 증거에 든 모델 이름(review.model, M4a)도 뺀다(관문이 보지 않는다).
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { contractHash } from '../src/core/contract.ts'
import { testCountRatchet } from '../src/core/ratchet.ts'
import type {
  Contract,
  EvidenceBundle,
  Integration,
  RatchetResult,
  ReviewFinding,
} from '../src/core/types.ts'
import type { ReplayBundle } from '../test/support/gate-replay.ts'

const ARMS = ['relay3', 'relay3-noreview', 'relay3-m21']
const ACCEPTANCE = 'test'
const TESTS = { id: 'tests', kind: 'test_count' } as const

/** run.json의 내보내기 관문 요약 (relay-v2 eval lib/relay3-arm.mjs gateSummary) */
interface StoredGate {
  conclusion: ReplayBundle['recorded']['conclusion']
  condition?: string | null
  shadow?: boolean
  export?: boolean
  /** 단위 브랜치(V22)의 내보내기 */
  unit?: string
}

/** run.json에서 읽는 칸 (relay-v2 eval의 relay3 운전자가 쓴다) */
interface StoredRun {
  error?: unknown
  outcome?: { success?: unknown } | null
  options?: { humanMode?: string }
  works?: {
    id: string
    /** 내보내기가 하나일 때 그 내보낸 head */
    exportedHead?: string | null
    gate?: StoredGate | null
    /** M2.1: 내보내기마다(work.json exports[]의 차례). M2는 없고 gate 하나다 */
    gates?: (StoredGate | null)[]
  }[]
}

/** work.json에서 읽는 칸 (M2.1의 내보내기마다) */
interface StoredWork {
  exports?: {
    unit: string | null
    exported_head: string | null
    gate?: { reasons?: string[] } | null
  }[]
}

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T
const note = (text: string) => process.stderr.write(`${text}\n`)

/** 관문의 clip과 같다. 남긴 글을 관문이 다시 잘라도 같은 글이 된다 */
function clip(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > 100 ? `${t.slice(0, 99)}…` : t
}

function slimContract(c: Contract): Contract {
  return {
    version: 1,
    id: c.id,
    goal: '',
    lines: c.lines.map((l) => ({
      id: l.id,
      kind: l.kind,
      text: '',
      grounds: [],
      examples: l.examples,
      check: l.check,
      ...(l.unit === undefined ? {} : { unit: l.unit }),
    })),
    non_goals: [],
    human_rules: [],
    examples: [],
    tidy: [],
    ...(c.delivery === undefined ? {} : { delivery: c.delivery }),
    ...(c.approved_by === undefined ? {} : { approved_by: c.approved_by }),
    ...(c.change_requested === undefined ? {} : { change_requested: c.change_requested }),
  }
}

function slimFinding(f: ReviewFinding): ReviewFinding {
  return {
    id: f.id,
    severity: f.severity,
    ...(f.raise === undefined ? {} : { raise: f.raise }),
    ...(f.file === undefined ? {} : { file: f.file }),
    ...(f.line === undefined ? {} : { line: f.line }),
    text: clip(f.text),
  }
}

/** 지적과 모델 이름(model, 기록에 남기지 않는다) 말고는 기록 그대로(status, prompt_version, 뒤 판의 칸. 예: V30의 request) */
function slimReview(r: NonNullable<EvidenceBundle['review']>): EvidenceBundle['review'] {
  const { findings, ...rest } = r
  delete rest.model
  // raise가 없는 지적은 관문이 보지 않는다
  return { ...rest, findings: findings.filter((f) => f.raise !== undefined).map(slimFinding) }
}

function slimRatchet(r: RatchetResult): RatchetResult {
  return { id: r.id, status: r.status, detail: clip(r.detail) }
}

export function slimEvidence(
  e: EvidenceBundle,
  ratchets: RatchetResult[],
  hash: string | undefined,
): EvidenceBundle {
  return {
    version: 1,
    repo: '',
    base: '',
    head: e.head,
    created_at: '',
    quality: { hash: '', from: e.quality.from },
    contract: e.contract === null ? null : { id: e.contract.id, hash: hash ?? e.contract.hash },
    commands: e.commands.map((c) => ({ id: c.id, outcome: c.outcome, head: [] })),
    lines: e.lines === null ? null : e.lines.map((v) => ({ ...v, detail: clip(v.detail) })),
    ...(e.examples_file === undefined ? {} : { examples_file: e.examples_file }),
    groundings: null,
    ratchets: ratchets.map(slimRatchet),
    signals: e.signals,
    diff: e.diff,
    review: e.review === null ? null : slimReview(e.review),
    claims: null,
    contract_change_requested: e.contract_change_requested,
    missing: e.missing,
  }
}

/** 시험 수 래칫을 지금 코드로 다시 잰다. 수용 시험이나 그 래칫이 없으면 그대로 */
function remeasure(e: EvidenceBundle): RatchetResult[] {
  const acceptance = e.commands.find((c) => c.id === ACCEPTANCE)
  if (acceptance === undefined) return e.ratchets
  // engine/check.ts measureRatchets와 같다: head는 첫 실행, base는 시험을 얹지 않은 base의 수용 시험
  const head = acceptance.head[0]?.tests ?? null
  const base = acceptance.base?.tests ?? null
  return e.ratchets.map((r) => (r.id === TESTS.id ? testCountRatchet(TESTS, base, head) : r))
}

const same = (a: RatchetResult[], b: RatchetResult[]) =>
  a.length === b.length &&
  a.every((r, i) => r.id === b[i]?.id && r.status === b[i]?.status && r.detail === b[i]?.detail)

const counts = new Map<string, number>()
const count = (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1)

/** 묶음과 그 계약을 관문이 쓰는 칸만 남긴다. 시험 수 래칫은 지금 코드로 다시 재고, 기록과 다르면 기록을 recorded에 둔다 */
function slim(ev: EvidenceBundle, full: Contract | null, what: string) {
  const contract = full === null ? null : slimContract(full)
  const hashOk = full !== null && ev.contract !== null && ev.contract.hash === contractHash(full)
  if (full !== null && !hashOk) count(`계약 해시가 맞지 않는 ${what}(그대로 둠)`)
  const ratchets = remeasure(ev)
  const changed = !same(ratchets, ev.ratchets)
  if (changed) count(`시험 수 래칫을 고친 ${what}`)
  return {
    evidence: slimEvidence(ev, ratchets, hashOk && contract ? contractHash(contract) : undefined),
    contract,
    hashOk,
    recorded: changed ? ev.ratchets.map(slimRatchet) : undefined,
  }
}

const readContract = (p: string) => (existsSync(p) ? readJson<Contract>(p) : null)

/** 통합의 사실(main/works-types.ts outsideFact)이 관문 까닭에 든 꼴(core gate integrationFacts) */
const INTEGRATION = '통합 증거: '
const OUTSIDE = `${INTEGRATION}단위 브랜치의 커밋이 Work 브랜치에 없음: `

/**
 * 단위 브랜치의 관문이 함께 본 통합 증거(core gate의 whole). 묶음은 마지막 통합 증거이고, 계약 전체와 맞지 않으면 앱처럼 없는
 * 것으로 둔다. 통합의 사실은 Work의 내보내기 관문 까닭에서 모은다(사람 머지 사실이 앞서 걸린 관문에는 남지 않는다)
 */
function integrationOf(
  dir: string,
  work: StoredWork,
): { whole: Integration; recorded?: RatchetResult[] } {
  const full = readContract(path.join(dir, 'contract.json'))
  const evPath = path.join(dir, 'evidence', 'integration.json')
  const reasons = (work.exports ?? []).flatMap((x) => x.gate?.reasons ?? [])
  const facts = [...new Set(reasons.filter((r) => r.startsWith(OUTSIDE)))].map((r) =>
    r.slice(INTEGRATION.length),
  )
  if (!existsSync(evPath)) {
    count('통합 증거 없음')
    return { whole: { evidence: null, contract: full && slimContract(full), head: null, facts } }
  }
  const ev = readJson<EvidenceBundle>(evPath)
  const s = slim(ev, full, '통합 증거')
  const ok = full === null ? ev.contract === null : s.hashOk
  const whole: Integration = {
    evidence: ok ? s.evidence : null,
    contract: s.contract,
    head: ev.head,
    facts,
  }
  return ok && s.recorded !== undefined ? { whole, recorded: s.recorded } : { whole }
}

function bundlesOf(protocol: string, runDir: string, scenario: string, name: string) {
  const m = /^(.+)-(\d+)$/.exec(name)
  if (m === null || !ARMS.includes(m[1] ?? '')) return []
  const runPath = path.join(runDir, 'run.json')
  if (!existsSync(runPath)) return []
  const run = readJson<StoredRun>(runPath)
  const success = run.outcome?.success
  if (run.error !== undefined && run.error !== null) {
    count('건너뜀: 오류로 끝난 실행')
    return []
  }
  if (typeof success !== 'boolean') {
    count('건너뜀: 숨긴 시험 결과가 없는 실행')
    return []
  }
  const arm = `${m[1]}${run.options?.humanMode === 'hands-off' ? '-handsoff' : ''}`
  const out: ReplayBundle[] = []
  for (const w of run.works ?? []) {
    const dir = path.join(runDir, 'works', w.id)
    for (const g of w.gates ?? [w.gate ?? null]) {
      if (g?.export !== true) {
        count('건너뜀: 내보내기 결론이 없는 내보내기')
        continue
      }
      const unit = g.unit
      const work = unit === undefined ? null : readJson<StoredWork>(path.join(dir, 'work.json'))
      const exported =
        work === null ? w.exportedHead : work.exports?.find((x) => x.unit === unit)?.exported_head
      const evPath =
        unit === undefined
          ? path.join(dir, 'evidence.json')
          : path.join(dir, 'evidence', `unit-${unit}.json`)
      if (!existsSync(evPath)) {
        count('건너뜀: 증거 없음')
        continue
      }
      const ev = readJson<EvidenceBundle>(evPath)
      if (typeof exported !== 'string' || ev.head !== exported) {
        count('건너뜀: 증거가 내보내기 때의 것이 아님')
        continue
      }
      const file = unit === undefined ? 'contract.json' : `contract.${unit}.json`
      const s = slim(ev, readContract(path.join(dir, file)), '묶음')
      const whole = work === null ? null : integrationOf(dir, work)
      out.push({
        protocol,
        scenario,
        arm,
        run: Number(m[2]),
        work: w.id,
        ...(unit === undefined ? {} : { unit }),
        hidden_pass: success,
        recorded: {
          conclusion: g.conclusion,
          condition: g.condition ?? null,
          shadow: g.shadow === true,
        },
        ...(s.recorded === undefined ? {} : { recorded_ratchets: s.recorded }),
        evidence: s.evidence,
        contract: s.contract,
        ...(whole === null ? {} : { integration: whole.whole }),
        ...(whole?.recorded === undefined ? {} : { recorded_integration_ratchets: whole.recorded }),
      })
      count(`묶음: ${arm}${unit === undefined ? '' : ' (단위 브랜치)'}`)
    }
  }
  return out
}

function main(args: string[]) {
  const [out, ...folders] = args
  if (out === undefined || !out.endsWith('.jsonl') || folders.length === 0) {
    note('쓰는 법: node scripts/gate-replay-fixture.ts <규약>.jsonl <결과 폴더>...')
    process.exit(1)
  }
  const protocol = path.basename(out, '.jsonl')
  const all: ReplayBundle[] = []
  for (const folder of folders) {
    if (!existsSync(path.join(folder, 'report.json'))) {
      note(`건너뜀(report.json 없음): ${folder}`)
      continue
    }
    for (const s of readdirSync(folder, { withFileTypes: true })) {
      if (!s.isDirectory()) continue
      const sDir = path.join(folder, s.name)
      for (const r of readdirSync(sDir, { withFileTypes: true })) {
        if (r.isDirectory())
          all.push(...bundlesOf(protocol, path.join(sDir, r.name), s.name, r.name))
      }
    }
  }
  const key = (b: ReplayBundle) =>
    `${b.scenario}\0${b.arm}\0${String(b.run).padStart(3, '0')}\0${b.work}\0${b.unit ?? ''}`
  all.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))
  const seen = new Set<string>()
  for (const b of all) {
    if (seen.has(key(b))) throw new Error(`같은 묶음이 두 번: ${key(b).replaceAll('\0', '/')}`)
    seen.add(key(b))
  }
  writeFileSync(out, all.map((b) => JSON.stringify(b)).join('\n') + '\n')
  for (const [k, n] of [...counts].sort()) note(`${k}: ${n}`)
  note(`${out}: ${all.length}개`)
}

const entry = process.argv[1]
if (entry !== undefined && path.resolve(entry) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2))

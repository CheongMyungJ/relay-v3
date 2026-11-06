// 관문 재생 래칫(V31, docs/m2.1-design.md 12절)의 자료 꼴과 읽기. 자료(test/fixtures/gate-replay/*.jsonl)는
// scripts/gate-replay-fixture.ts가 저장된 평가 실행에서 만든다. 한 줄이 내보내기 증거 묶음 하나다.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { gate } from '../../src/core/gate.ts'
import { DRAFT_AUTO } from '../../src/core/quality.ts'
import type {
  Conclusion,
  Contract,
  EvidenceBundle,
  GateResult,
  Integration,
  Policy,
  RatchetResult,
} from '../../src/core/types.ts'
import type { GenerationRun } from '../../src/engine/stability.ts'
import { conditionsMet } from '../../src/engine/track.ts'

export interface ReplayBundle {
  /** 묶음을 낸 평가 규약(파일 이름과 같다. 예: m2, m2.1) */
  protocol: string
  scenario: string
  /** relay3, relay3-noreview, relay3-handsoff(M2), relay3-m21(M2.1) */
  arm: string
  run: number
  work: string
  /** 단위 브랜치(V22)의 내보내기면 그 단위. Work 브랜치의 내보내기는 없다 */
  unit?: string
  /** 그 실행의 숨긴 시험(run.json outcome.success). 실행의 값이라 한 실행의 Work는 모두 같다 */
  hidden_pass: boolean
  /** 평가 빌드가 내보내기 때 낸 관문 결론 */
  recorded: { conclusion: Conclusion; condition: string | null; shadow: boolean }
  /**
   * 지금 코드로 다시 잰 래칫이 평가 빌드의 것과 다를 때만, 평가 빌드의 래칫 전부. evidence.ratchets는 지금 코드의 것이다
   * (시험 수 래칫이 예시 태그만 붙인 시험을 사라진 시험으로 보던 것을 고침)
   */
  recorded_ratchets?: RatchetResult[]
  /** 관문이 쓰는 칸만 남긴 묶음. 타입이 요구하지만 관문이 쓰지 않는 칸은 빈 값이다 */
  evidence: EvidenceBundle
  /** 관문이 쓰는 칸만 남긴 계약. evidence.contract.hash는 이 계약의 해시다(원래 해시가 맞았을 때만). 단위 브랜치는 조각이다 */
  contract: Contract | null
  /**
   * 단위 브랜치의 내보내기일 때 관문이 함께 본 통합 증거(core gate의 whole). evidence와 contract(계약 전체)는 위처럼 관문이
   * 쓰는 칸만 남겼고 래칫은 지금 코드의 것이다. head는 통합 증거의 head(마지막 통합 증거를 잰 Work 브랜치의 끝)다
   */
  integration?: Integration
  /** 통합 증거의 래칫을 다시 잰 것이 평가 빌드의 것과 다를 때만, 평가 빌드의 래칫 전부(recorded_ratchets와 같다) */
  recorded_integration_ratchets?: RatchetResult[]
}

/** 폴더의 *.jsonl을 이름 차례로 읽는다 */
export function readReplay(dir: string): ReplayBundle[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
  return files.flatMap((f) =>
    readFileSync(path.join(dir, f), 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l) as ReplayBundle),
  )
}

/** 묶음의 이름: 시나리오/쪽-회/Work, 단위 브랜치는 시나리오/쪽-회/Work/단위 */
export function bundleName(b: ReplayBundle): string {
  return `${b.scenario}/${b.arm}-${b.run}/${b.work}${b.unit === undefined ? '' : `/${b.unit}`}`
}

/**
 * 규약마다 실행 단위의 '자동 조건을 채움'. any: 실행의 내보내기 묶음 가운데 하나라도 채웠으면(M2). all: 모두 채웠을 때만
 * (V22, M2.1 규약 5.1의 G1·G2). 묶음을 더한 규약은 여기에 적는다(gate-replay.test.ts가 모든 규약에 있는지 본다)
 */
export const RUN_MET: Record<string, 'any' | 'all'> = { m2: 'any', 'm2.1': 'all' }

/** 사람 머지 까닭의 갈래: 첫 ': ', ' (', ' — ' 앞. 줄 id는 뺀다('줄 C2 못 미침' → '줄 못 미침') */
export function reasonKind(reason: string): string {
  return (reason.split(/: | \(| — /)[0] ?? reason).replace(/^줄 \S+/, '줄')
}

/** 초안 정책: 스위치 꺼짐, 서버 보호 모름, 실적 없음, 초안 조건(V19) */
export const DRAFT_POLICY: Policy = {
  auto_merge_enabled: false,
  conditions: [{ ...DRAFT_AUTO }],
  server: null,
  track_record_ok: {},
}

/**
 * 지금 관문으로 다시 돈 결과와 채운 조건. 리뷰는 요청을 본 것으로 두고(기록에 있으면 그 값) 지금의 올림 규칙과 자료를 만들 때
 * 지금 코드로 다시 잰 래칫을 쓴다(gate-replay.test.ts의 V26·'now', gate-version.ts의 재생 digest와 같다)
 */
export function replayNow(b: ReplayBundle): { g: GateResult; met: string[] } {
  const e = b.evidence
  const review: EvidenceBundle['review'] = e.review === null ? null : { request: true, ...e.review }
  const evidence = { ...e, review }
  return {
    g: gate(evidence, b.contract, DRAFT_POLICY, e.head, b.integration),
    met: conditionsMet(evidence, b.contract, DRAFT_POLICY, e.head, b.integration),
  }
}

/**
 * 관문 5회 (C) 생성 안정성(m4-design 8절)의 입력: 실행(규약/시나리오/쪽-회)마다 묶음을 모은다. 줄 종류는 Work마다 줄 id가
 * 겹치지 않게(단위 브랜치의 조각이 같은 줄을 다시 담아도 한 번), 조건 채움은 규약의 RUN_MET, 까닭은 지금 관문의 reasons 갈래다
 */
export function generationRuns(bundles: readonly ReplayBundle[]): GenerationRun[] {
  const runs = new Map<string, { b: ReplayBundle; g: GateResult }[]>()
  for (const b of bundles) {
    const key = `${b.protocol}/${b.scenario}/${b.arm}\0${b.run}`
    runs.set(key, [...(runs.get(key) ?? []), { b, g: replayNow(b).g }])
  }
  return [...runs].map(([key, rs]) => {
    const first = (rs[0] as { b: ReplayBundle }).b
    const lines = new Map<string, GenerationRun['kinds'][number]>()
    for (const { b } of rs)
      for (const l of b.contract?.lines ?? []) lines.set(`${b.work}\0${l.id}`, l.kind)
    const met = (r: { g: GateResult }) => r.g.condition !== null
    const all = RUN_MET[first.protocol] === 'all'
    return {
      group: key.split('\0')[0] ?? key,
      run: first.run,
      kinds: [...lines.values()],
      conclusions: rs.map((r) => r.g.conclusion),
      met: all ? rs.every(met) : rs.some(met),
      facts: [...new Set(rs.flatMap((r) => r.g.reasons.map(reasonKind)))],
    }
  })
}

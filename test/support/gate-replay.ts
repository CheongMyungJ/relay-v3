// 관문 재생 래칫(V31, docs/m2.1-design.md 12절)의 자료 꼴과 읽기. 자료(test/fixtures/gate-replay/*.jsonl)는
// scripts/gate-replay-fixture.ts가 저장된 평가 실행에서 만든다. 한 줄이 내보내기 증거 묶음 하나다.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { Conclusion, Contract, EvidenceBundle, RatchetResult } from '../../src/core/types.ts'

export interface ReplayBundle {
  /** 묶음을 낸 평가 규약(파일 이름과 같다. 예: m2) */
  protocol: string
  scenario: string
  /** relay3, relay3-noreview, relay3-handsoff */
  arm: string
  run: number
  work: string
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
  /** 관문이 쓰는 칸만 남긴 계약. evidence.contract.hash는 이 계약의 해시다(원래 해시가 맞았을 때만) */
  contract: Contract | null
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

/** 묶음의 이름: 시나리오/쪽-회/Work */
export function bundleName(b: ReplayBundle): string {
  return `${b.scenario}/${b.arm}-${b.run}/${b.work}`
}

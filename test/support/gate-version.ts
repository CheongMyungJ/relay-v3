// 관문 판 래칫(M4a, docs/m4-design.md 3.3)의 셈. 시험(test/unit/gate-version.test.ts)과 자료를 쓰는 스크립트
// (scripts/gate-version-fixture.ts)가 함께 쓴다. 자료는 test/fixtures/gate-version.json이다:
//   { version: 그 파일 hash를 적은 판, files: { 경로: 내용 hash }, replays: { 판: 그 판의 재생 digest } }
// - files: 관문과 그 입력을 만드는 파일의 내용 hash(줄 끝 CRLF는 LF로 본다: Windows checkout에서도 같다).
// - 재생 digest: V31 재생 묶음(test/fixtures/gate-replay/)을 지금 관문, 초안 정책으로 돌린 (결론, condition, met)의 hash.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { bundleName, readReplay, replayNow } from './gate-replay.ts'

export interface GateVersionFixture {
  version: number
  files: Record<string, string>
  replays: Record<string, string>
}

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
export const FIXTURE_PATH = fileURLToPath(new URL('../fixtures/gate-version.json', import.meta.url))
const REPLAY_DIR = fileURLToPath(new URL('../fixtures/gate-replay/', import.meta.url))

/** 관문과 그 입력을 만드는 파일(m4-design 3.3). relay-v3에서는 human_paths에 넣을 목록이다(10절) */
export const GATE_FILES = [
  'src/core/gate.ts',
  'src/core/lines.ts',
  'src/core/quality.ts',
  'src/core/review.ts',
  'src/core/evidence.ts',
  'src/core/contract.ts',
  'src/core/flaky.ts',
  'src/core/signals.ts',
  'src/core/ratchet.ts',
  'src/core/diff.ts',
  'src/core/manifests.ts',
  'src/core/junit.ts',
  'src/engine/check.ts',
  'src/engine/track.ts',
  // 판 2(V59): 앱이 직접 재는 래칫(V55~V57)과 check.ts에서 옮긴 래칫 재기
  'src/engine/ratchets.ts',
  'src/engine/languages.ts',
  'src/engine/suppressions.ts',
  'src/engine/duplication.ts',
  'src/engine/coverage.ts',
] as const

const sha = (text: string) => createHash('sha256').update(text).digest('hex')

export function fileHashes(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of GATE_FILES) {
    const text = readFileSync(`${ROOT}${f}`, 'utf8').replace(/\r\n/g, '\n')
    out[f] = sha(text).slice(0, 16)
  }
  return out
}

/**
 * 재생 줄(이름, 결론, condition, met)과 그 digest. 리뷰는 요청을 본 것으로 두고(기록에 있으면 그 값), 지금 관문의 올림
 * 규칙(V26 그대로)과 지금 코드로 다시 잰 래칫을 쓴다(gate-replay.ts replayNow, gate-replay.test.ts의 'now'·V26과 같다)
 */
export function replayLines(): string[] {
  return readReplay(REPLAY_DIR)
    .map((b) => {
      const { g, met } = replayNow(b)
      return [bundleName(b), g.conclusion, g.condition ?? '-', met.join(',')].join('\t')
    })
    .sort()
}

export const replayDigest = (): string => sha(replayLines().join('\n'))

export function readFixture(): GateVersionFixture {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as GateVersionFixture
}

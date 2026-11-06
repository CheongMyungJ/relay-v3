// 관문 판 래칫(M4a, docs/m4-design.md 3.3)의 자료 test/fixtures/gate-version.json을 쓴다.
//   node scripts/gate-version-fixture.ts
// 관문 파일(test/support/gate-version.ts GATE_FILES)을 고쳤으면 먼저 src/engine/gate-version.ts의 GATE_VERSION을 올리고,
// 새 판의 epoch(GATE_EPOCHS)를 정한다: 이 스크립트가 찍는 재생 digest가 앞 판과 같으면 앞 판의 epoch를 이어 적고(실적을 이어
// 센다), 다르면 새 epoch다. 판을 올리지 않았는데 파일 hash가 바뀌었으면 쓰지 않고 실패한다(래칫을 우회하지 않게).
import { writeFileSync } from 'node:fs'
import { GATE_EPOCHS, GATE_VERSION } from '../src/engine/gate-version.ts'
import {
  FIXTURE_PATH,
  fileHashes,
  readFixture,
  replayDigest,
  type GateVersionFixture,
} from '../test/support/gate-version.ts'

const before = (() => {
  try {
    return readFixture()
  } catch {
    return null
  }
})()
const files = fileHashes()
const same = (a: Record<string, string>, b: Record<string, string>) =>
  JSON.stringify(a) === JSON.stringify(b)
if (before !== null && before.version === GATE_VERSION && !same(before.files, files)) {
  console.error(
    `관문 파일이 바뀌었는데 GATE_VERSION(${GATE_VERSION})이 자료의 판과 같습니다. GATE_VERSION을 올리고 GATE_EPOCHS를 정한 뒤 다시 도세요`,
  )
  process.exit(1)
}
const digest = replayDigest()
const replays = { ...(before?.replays ?? {}), [String(GATE_VERSION)]: digest }
const out: GateVersionFixture = { version: GATE_VERSION, files, replays }
writeFileSync(FIXTURE_PATH, `${JSON.stringify(out, null, 2)}\n`)
const prev = replays[String(GATE_VERSION - 1)]
console.log(`판 ${GATE_VERSION}: 재생 digest ${digest.slice(0, 12)}`)
if (prev !== undefined)
  console.log(
    prev === digest
      ? `앞 판과 재생 결론이 같습니다: GATE_EPOCHS[${GATE_VERSION}] = GATE_EPOCHS[${GATE_VERSION - 1}](${GATE_EPOCHS[GATE_VERSION - 1]})로 이어 셀 수 있습니다`
      : `앞 판과 재생 결론이 다릅니다: 새 epoch입니다(GATE_EPOCHS[${GATE_VERSION}] = ${GATE_VERSION})`,
  )

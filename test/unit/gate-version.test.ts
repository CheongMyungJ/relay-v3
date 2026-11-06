// [단위] 관문 판 래칫(M4a, docs/m4-design.md 3.3). 관문과 그 입력을 만드는 파일이 바뀌면 GATE_VERSION을 올리게 하고, 올린
// 판을 앞 epoch로 이어 셀 때는 V31 재생 결론(결론, condition, met)이 앞 판과 같아야 한다. 자료를 쓰는 것은
// scripts/gate-version-fixture.ts, 셈은 test/support/gate-version.ts다.
import { describe, expect, test } from 'vitest'
import { GATE_EPOCHS, GATE_VERSION, gateEpoch } from '../../src/engine/gate-version.ts'
import { fileHashes, readFixture, replayDigest, replayLines } from '../support/gate-version.ts'

const FIXTURE = readFixture()
const FIX = '판을 올리고 node scripts/gate-version-fixture.ts로 자료를 다시 쓴다'

describe('관문 판 (M4a)', () => {
  test('판은 1부터 GATE_VERSION까지 빠짐없고, epoch는 앞 판의 것을 잇거나 그 판 번호로 새로 연다', () => {
    const versions = Object.keys(GATE_EPOCHS)
      .map(Number)
      .sort((a, b) => a - b)
    expect(versions).toEqual(Array.from({ length: GATE_VERSION }, (_, i) => i + 1))
    expect(GATE_EPOCHS[1]).toBe(1)
    for (let v = 2; v <= GATE_VERSION; v++)
      expect([GATE_EPOCHS[v - 1], v]).toContain(GATE_EPOCHS[v])
    expect(gateEpoch(GATE_VERSION)).toBe(GATE_EPOCHS[GATE_VERSION])
    expect(gateEpoch(undefined)).toBeNull()
    expect(gateEpoch(GATE_VERSION + 1)).toBeNull()
  })

  test('자료의 판이 GATE_VERSION이고 관문 파일이 그 판 그대로다 (바뀌었으면 GATE_VERSION을 올리고 재생을 확인한다)', () => {
    expect(FIXTURE.version, FIX).toBe(GATE_VERSION)
    const now = fileHashes()
    const changed = Object.keys(now).filter((f) => FIXTURE.files[f] !== now[f])
    expect(changed, `관문 파일이 바뀜: GATE_VERSION을 올리고 재생을 확인한다(${FIX})`).toEqual([])
    expect(Object.keys(FIXTURE.files).sort()).toEqual(Object.keys(now).sort())
  })

  test('지금 판의 재생 digest가 자료와 같다', () => {
    expect(replayLines().length).toBe(208)
    expect(FIXTURE.replays[String(GATE_VERSION)], FIX).toBe(replayDigest())
  })

  test('앞 epoch를 잇는 판은 재생 결론이 앞 판과 같다 (다르면 새 epoch)', () => {
    for (let v = 1; v <= GATE_VERSION; v++) expect(FIXTURE.replays[String(v)]).toBeDefined()
    for (let v = 2; v <= GATE_VERSION; v++) {
      if (GATE_EPOCHS[v] !== GATE_EPOCHS[v - 1]) continue
      expect(
        FIXTURE.replays[String(v)],
        `재생 결론이 바뀌었는데 판 ${v}를 앞 epoch로 이어 둠`,
      ).toBe(FIXTURE.replays[String(v - 1)])
    }
  })
})

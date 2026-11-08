// 관문 판 (M4a, docs/m4-design.md 3.3). 장부의 내보내기 결론 줄이 gate_version으로 적고, 판 열쇠(ledger.ts epochKey)는
// 그 판이 속한 epoch를 쓴다. 관문과 그 입력을 만드는 파일(test/fixtures/gate-version.json의 files)이 바뀌면 [단위]
// gate-version.test.ts가 판을 올리게 한다. 올린 판의 V31 재생 결론(결론, condition, met)이 앞 판과 같으면 앞 epoch를 이어
// 적어 실적을 이어 센다(철학의 '재생 평가를 지나면 다시 연다'). 다르면 새 epoch이고 표본은 처음부터다.
// 판은 장부에 숫자로 남고 epoch는 읽을 때 이 표로 계산한다: 이어 세기를 나중에 고쳐도 장부를 다시 쓰지 않는다.

export const GATE_VERSION = 5

/** 판 → 그 판의 실적이 속한 epoch */
// 판 2(V59): 래칫 종류 셋(억누름, 중복, 바뀐 줄 커버리지)을 더함. 재생 digest가 판 1과 같아 epoch 1을 잇는다
// 판 3(V68): 수용 시험 결과의 꼴(go test -json), 중복의 표 같은 반복, quality.json의 test_format. 재생 digest가 판 2와 같아
// epoch 1을 잇는다
// 판 4(V73): quality.json의 test_format에 cargo-test, 수용 시험 결과의 꼴(cargo test 기본 출력). 재생 digest가 판 3과 같아
// epoch 1을 잇는다
// 판 5(V76): 래칫 종류 imports(구조 규칙), quality.ts의 기본 목록을 quality-defaults.ts로 옮김. 재생 digest가 판 4와 같아
// epoch 1을 잇는다
export const GATE_EPOCHS: Readonly<Record<number, number>> = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 }

/** 판의 epoch. 모르는 판(이 코드보다 새 빌드가 쓴 줄, 칸이 없는 옛 줄)은 null: 어떤 판과도 같지 않다 */
export function gateEpoch(version: number | undefined): number | null {
  if (version === undefined || !Object.hasOwn(GATE_EPOCHS, version)) return null
  return GATE_EPOCHS[version] ?? null
}

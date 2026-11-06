# M4 설계: 그림자 실적

- 상태: **만드는 중**(2026-11-06). M4-0(2.1절)과 M4a(3.4절)를 만들었다. M4b~M4g는 아직이고, M4h(자기 실행)는 사용자 결정으로 나중이다. 16절의 질문에 답을 받았다(아래).
- **사용자 결정(2026-11-06, ✅):**
  - Q10 자기 실행: **도구만 만들고 relay-v3 자기 실행은 나중에 따로 정한다.** quality.json PR, main 보호·필수 검사, 앱으로 relay-v3 개발하기는 하지 않는다. 그래서 M4h(10절)는 '나중'이고, M4의 숫자는 재생과 평가 자료로만 낸다.
  - Q2 M5 숫자: **12절의 안 그대로**(일치 ≥ 20, V3 그대로; 끝이 정해진 n ≥ 30; 일치율 ≥ 0.95; lift > 0; 창 30일; 창이 닫힌 이 조건의 머지 ≥ 20에서 귀속 0·미정 0; 결정론 5회 갈림 0; 지금 관문 판의 재생 거짓 자동 0). M5 규약이 이것을 그대로 쓴다.
  - Q7 세션 커밋 트레일러: **붙인다**(앱 로컬 세션 커밋 집합과 `Relay-Work` 트레일러 둘 다).
  - Q13 M4 평가 규모: **같은 요청 5회 새 실행도 한다**(재생 소급 + (A) + (B) + (C) 시나리오 6개 × 5회 = Work 30).
- **설계자 결정(2026-11-06, 나머지는 권장안대로):** Q1 `core/ledger.ts`를 engine으로 옮긴다(상한 5,000 그대로). Q3 판 열쇠는 3.2의 안. Q4 세션 모델은 고정하지 않고 본 모델만 적는다(`model_observed`). Q5 (가) 앱 로컬 blobless 거울. Q6 그림자 줄은 끝이 정해질 때까지 가린다. Q8 권장안. Q9 gh 다시 녹화는 이 환경에서 실제 PR을 만들어야 하므로 하지 않는다: preapproved는 human-override로 남고, 녹화는 자기 실행(Q10)과 함께 정한다. Q11 레포를 넘어 합친 수는 보이기만. Q12 M5 전제에 '재생 거짓 자동 0'을 넣는다(Q2와 같음).
- 철학: [philosophy.md](philosophy.md) 원칙 4(자율은 끝난 변경의 사실과 실적으로 넓힌다), 5장 단계 0, 7장 7(감사 기록), 8.1(제품 안의 측정), 8.4(틀렸다고 볼 조건), 8.5(정직한 한계), 11장 M4. 정한 것은 [design.md](design.md) V3·V5·V19·V20·V23·V31·V40·V44, 장치는 [devices.md](devices.md) '그림자 실적' 줄.
- 무엇을 막으려나: M5(좁은 조건 하나에서 자동 머지)는 M4의 숫자로만 열 수 있다. 그런데 지금의 그림자 실적은 숫자를 내지 못하고, 낸다 해도 틀린 쪽으로 기울 수 있다.
  - 표본이 조용히 빠진다. PR 없이 [끝내기]나 [버림]으로 끝난 Work는 영원히 '열림'이고, Work가 끝난 뒤 머지된 PR은 `fate()`가 `!isActive`에서 돌아가 놓친다(`works-exports.ts`).
  - 관문은 처음 채운 조건 하나만 적는다(`gate.ts`의 조건 순회). 여러 조건을 채운 Work는 `quality.json` 순서상 첫 조건에만 쌓인다.
  - `trackRecord`는 참·거짓만 돌려준다. 일치 수, 불일치 수, 일치율이 밖으로 나오지 않아 화면도 M5도 쓸 숫자가 없다.
  - 판 칸이 비었다. 운영에서 `model`은 늘 비고(`index.ts`가 `deps.model`을 넣지 않음), `relay_version`은 늘 `0.0.0`이며, effort 칸이 없다. 그래서 관문이나 모델이 바뀌어도 실적이 처음부터 다시 재지지 않는다(원칙 4를 못 지킴).
  - 세션 커밋에 relay 트레일러가 없어 '사람 교정'(8.1)과 감사 기록(7장 7)을 셀 수 없다.
  - 머지 뒤 30일(되돌림, main 실패)을 아무도 보지 않는다.
  - 관문의 5회 반복 안정성을 재는 도구가 없다.
  - relay-v3 레포 자신의 `quality.json`은 `"auto": []`, `"ci_checks": []`이고, 개발은 앱 밖에서 main에 바로 커밋했다(머지 커밋 0). 그래서 이 레포의 표본은 0에서 멈춰 있다.

M4는 아무것도 자동으로 열지 않는다. 숫자를 바르게 세고, 보이고, M5가 결과 전에 고정할 판정 규칙의 입력을 만드는 것까지다.

## 1. 켜는 차례

원칙은 셋이다. (1) **나중에 되찾지 못하는 칸부터 낸다.** 머지·닫힘·되돌림은 git과 gh 이력에서 소급해 읽을 수 있지만, 내보낼 때 채운 조건과 판(모델, effort, 관문 판)은 그 순간에만 안다. (2) **그날부터 시계를 돌린다.** 30일 창은 달력으로만 닫힌다. (3) **한 번에 하나씩, 장치마다 끄는 조건과 함께.**

| 차례 | 무엇 | 왜 이 차례 | 소급되나 |
|---|---|---|---|
| M4-0 | 자리 만들기: `core/ledger.ts`를 `engine/ledger.ts`로 옮김 | core가 4,999/5,000줄이라 한 줄도 더할 수 없다. 동작은 그대로 | — |
| M4a | 장부 칸과 판: `met`, 조건 hash, 판 칸, PR·base, 승인 주체 | 이 칸 없이 쌓인 표본은 다시 셀 수 없다. 가장 먼저 내보내고 같은 날 relay-v3 자기 실행(M4h)을 시작한다 | 아니다 |
| M4b | 끝까지 따라가기와 '같은 변경': 끝난 Work의 PR, PR 없음·버림, 앱 로컬 거울, patch-id | 조용히 빠지는 표본을 메운다. Update branch를 불일치로 세지 않게 한다 | 그렇다(work.json과 gh) |
| M4c | 조건별 실적 숫자와 보이기: `shadowStats`, [실적] 표, `relay record` | M4a·M4b가 쌓은 것을 원 숫자로 보인다 | 그렇다 |
| M4d | 머지 뒤 30일 | 창마다 30일을 기다려야 하지만 이력에서 소급해 읽으므로 늦게 내도 잃지 않는다 | 그렇다 |
| M4e | 세션 커밋 가르기: 앱 로컬 세션 커밋 집합, `Relay-Work` 트레일러 | 일치 판정에는 필요 없다(SHA와 같은 변경으로 정해짐). 불일치의 갈래와 사람 교정에만 쓴다 | 집합은 아니다, 트레일러는 아니다 |
| M4f | 관문 5회 반복 안정성(측정 도구, 앱 장치 아님) | 언제든 돌릴 수 있다. 결정론 입력은 모델 비용 0 | — |
| M4g | 재생 실적(지난 평가 장부로 오프라인 셈) | 비용 0. 시험 고정 자료와 M5의 사전 근거 | — |
| M4h | relay-v3 자신부터 돌리기(사람이 할 일과 운영 절차) | M4a와 같은 날 시작 | — |

M4e의 세션 커밋 집합은 소급되지 않으므로 M4a 바로 뒤에 낼 수도 있다. 다만 일치 판정에 필요 없고 사람의 결정(16절 Q7)이 걸려 있어 차례는 뒤에 둔다. 사용자가 Q7에 바로 답하면 M4a와 함께 낸다.

**M4의 '끝'은 숫자가 기준을 넘는 때가 아니다.** 도구와 장치 줄이 바르게 돌고(시험 통과, 판 칸 빈 비율 0), relay-v3에서 머지된 내보내기 하나 이상의 30일 창이 닫혀 `after` 줄이 쓰였고, 첫 주간 기록(10절)이 남은 때다. M5를 열지는 그 뒤 쌓인 원 숫자로 12절의 규칙을 결과 전에 고정해 따로 정한다.

## 2. M4-0 자리 만들기

- **문서 먼저**(CLAUDE.md: 모듈 사이 함수 모양을 바꾸면 m1-modules 먼저): `docs/m1-modules.md`와 `docs/m2-modules.md` 1절의 `src/core/ledger.ts` 항목을 `src/engine/ledger.ts`로 옮겨 적는다. design.md 7절의 'M1은 실적을 읽지 않는다'는 'CLI `relay gate`는 실적을 읽지 않는다'로 좁힌다.
- **옮김:** `src/core/ledger.ts`(limits 셈 152줄, `import type`만 씀)를 `src/engine/ledger.ts`로 옮긴다. 선례는 M3a의 `engine/knowledge-format.ts`다. 가져오는 곳을 바꾼다: `main/store.ts`, `main/works-exports.ts`, `main/works-projects.ts`, `main/works-debt.ts`, `engine/debt-record.ts`, 시험 `test/unit/ledger.test.ts`, `test/flow/works.test.ts`, `test/adapters/debt-unrecorded.test.ts`. `MATCH_RATE`도 함께 옮긴다.
- **결과:** core 4,999 → 약 4,847줄. 상한 5,000은 그대로다(상한을 올리는 것은 사용자 결정이라 건드리지 않는다).
- **core에 더하는 것(M4 전체):** `types.ts`의 `EvidenceBundle.review`에 `model?: string` 한 줄(4절). `Policy`, `GateResult`, `gate()`의 모양은 바꾸지 않는다. 세션 환경 변수는 core `sessionEnv`가 아니라 main에서 합친다(7절).
- 렌더러는 core 타입만 가져갈 수 있으므로 화면용 숫자의 모양(`RecordStats`)은 `src/shared/api.ts`에 둔다(engine 타입을 렌더러가 가져가지 않게).

### 2.1 만든 것 (M4-0)

- `src/core/ledger.ts`를 `git mv`로 `src/engine/ledger.ts`에 옮겼다. 바뀐 것은 `import type`의 경로(`../core/types.ts`)와 머리 주석뿐이다. 가져오는 곳 다섯(`main/store.ts`, `works-exports.ts`, `works-projects.ts`, `works-debt.ts`, `engine/debt-record.ts`)과 시험 셋(`test/unit/ledger.test.ts`, `test/flow/works.test.ts`, `test/adapters/debt-unrecorded.test.ts`)의 경로를 바꿨다. 시험 본문은 그대로다.
- 문서: m2-modules 0절의 배치와 1a절(새 절, engine), m1-modules engine 절의 한 줄, design.md 7절('CLI `relay gate`는 실적을 읽지 않는다'), V45.
- core 4,999 → 4,847줄(limits 셈).

### 2.2 설계와 다른 것 (M4-0)

- 없음. m2-modules에는 engine 절이 없어서 1a절을 새로 만들었다.

## 3. M4a 장부 칸과 판

### 3.1 내보내기 결론 줄에 더하는 칸

모두 선택 칸이다. 옛 줄은 그대로 읽힌다(`isEntry`를 넓힘). 덧붙이기만 하고 옛 줄을 고쳐 쓰지 않는다.

```ts
// src/engine/ledger.ts — 지금 칸(ts, project, work, head, conclusion, condition, shadow, by?, merged_head?, closed?,
// export?, model?, claude_version?, relay_version, worse?, accepted?)은 그대로 둔다
interface LedgerEntry {
  // ── M4a: 내보내기 결론 줄
  met?: string[]                      // 채운 조건 전부. condition(첫 조건)은 그대로 적는다
  conds?: Record<string, string>      // 정책의 조건 id → 조건 정의의 안정 JSON hash(앞 12자). 채우지 못한 조건도 적는다(비교군)
  gate_version?: number               // engine/gate-version.ts의 GATE_VERSION
  review_prompt?: number              // REVIEW_PROMPT_VERSION(core/review.ts)
  model_requested?: string            // 앱이 넘긴 --model, 없으면 'default'
  model_observed?: string             // 이 head 리뷰(claude -p) 출력의 assistant message.model
  effort?: string                     // 세션 훅 본문 effort.level의 마지막 값
  relay_build?: string                // 앱 checkout의 git commit(감사용. 판 열쇠가 아님)
  pr?: number
  base_sha?: string                   // 묶음의 base(merge-base)
  approved_by?: 'human' | 'caller'    // 계약 승인 주체(5장 단계 2: caller 계약은 따로 센다)
}
```

- **`met` (main, gate는 순수):** `exportLine`이 `policy.conditions`의 c마다 `gate(evidence, contract, {...policy, conditions: [c]}, head, whole)`를 부르고, 결과의 `condition === c.id`인 c를 모은다. 사람에게 보낼 사실이 있으면 모든 부름이 condition null이라 `met`은 빈다(맞는 동작). gate는 바뀌지 않고 V31 재생도 그대로 지난다. 순수 함수 `conditionsMet(evidence, contract, policy, head, whole)`는 `engine/track.ts`에 둔다. `works-evidence.ts`(599줄)는 줄 수를 늘리지 않는다: `exportLine`의 인자를 하나로 묶어 부르는 곳의 줄 수를 그대로 둔다.
- **`conds`:** 같은 id라도 사람이 `quality.json`에서 `small`의 줄 수를 100에서 50으로 바꾸면 다른 조건이다. hash는 core `contractHash`와 같은 안정 JSON hash를 engine에서 부른다.
- **`model_observed` (adapters → main):** `adapters/claude.ts` `claudeJson`이 stream-json의 assistant `message.model`(relay-v2 녹화본 `claude.json`의 `stream.shapes.assistant.message.model`에 있음)을 결과에 붙이고, `works-review.ts`가 묶음의 `review.model`로 둔다. 미리 리뷰를 다시 쓰면 그 리뷰의 값이다. 이름에 `observed`를 붙인 까닭: 리뷰어의 모델이지 세션의 모델이 아니다. 둘 다 `deps.model`(지금 빔)을 따르므로 대개 같지만, 사람이 PTY 안에서 `/model`로 바꾼 것은 보이지 않는다. 훅 본문에는 model 칸이 없다.
- **`effort` (main):** 녹화본의 PreToolUse·PostToolUse·Stop 본문에 `effort.level`이 있다. 훅을 받는 쪽은 `works.ts`(598줄) `onHook`이라 자리가 없다. 그래서 `main/hooks.ts`가 본문을 넘기기 전에 새 파일 `main/works-session-log.ts`의 `noteHook(workId, event, body)`를 부르고, 그것이 Work 실행 상태에 마지막 effort를 둔다(7절의 세션 커밋 집합도 같은 파일).
- **`relay_build`:** 앱이 시작할 때 앱 폴더에서 `git rev-parse HEAD`를 읽는다. 패키지 빌드라면 electron-vite `define`으로 빌드 때 박는다. `relay_version 0.0.0`은 그대로 둔다.
- `pr`은 내보내기의 `x.pr?.number`, `base_sha`는 묶음의 base, `approved_by`는 계약의 값이다.

### 3.2 판 열쇠 (원칙 4: 바뀌면 다시 잰다)

판 열쇠는 `engine/ledger.ts`의 순수 함수 하나(`epochKey(entry)`)다. 무엇을 넣을지는 사용자가 정한다(16절 Q3). 제안은 이렇다.

| 칸 | 열쇠에 넣나 | 까닭 |
|---|---|---|
| 조건 id, `conds[id]` | 넣음 | 조건 정의가 바뀌면 다른 표본 |
| `model_observed` | 넣음 | 원칙 4. 'unknown'(못 읽음)은 어떤 판과도 같지 않다(엄격) |
| `effort` | 넣음 | 원칙 4. 없으면 'unknown' |
| `claude_version` | **major.minor만** 넣음, patch는 적기만 | Claude Code patch는 거의 매주 나온다. 글자 그대로 넣으면 표본이 되풀이해 0으로 돌아간다. 이것은 원칙 4의 해석이라 사용자 결정 |
| 관문 판(`gate_version`이 속한 epoch, 3.3) | 넣음 | 결론을 바꾸는 관문 고침은 다시 잰다 |
| `review_prompt` | 넣음 | 리뷰는 결론을 엄격하게 바꾼다. 재생은 저장된 리뷰를 다시 쓰므로 리뷰 프롬프트 바뀜을 보지 못한다 |
| `relay_build` | 넣지 않음 | relay-v3를 앱으로 개발하면 빌드는 날마다 바뀐다. 결론을 바꾸는 바뀜은 관문 판이 잡는다 |
| `relay_version` | 넣지 않음 | 늘 `0.0.0` |

옛 줄(M4a 앞)은 `gate_version`이 없으므로 '판 모름'으로 보이고 지금 판의 셈에 들지 않는다.

### 3.3 관문 판 `GATE_VERSION`과 이어 세기

두 가지를 합친다. 파일 hash 래칫(바뀐 것을 놓치지 않게)과 재생 digest(결론이 그대로면 이어 세게)다.

```ts
// src/engine/gate-version.ts
export const GATE_VERSION = 1
/** 판 → 그 판의 실적이 속한 epoch. 재생 결론이 같으면 올림 PR에서 앞 epoch를 이어 적는다 */
export const GATE_EPOCHS: Readonly<Record<number, number>> = { 1: 1 }
```

- **[단위] `test/unit/gate-version.test.ts`:** `test/fixtures/gate-version.json` `{ version, files, replay }`과 견준다.
  - `files`: 관문과 그 입력을 만드는 파일의 내용 hash. `core/gate.ts`, `lines.ts`, `quality.ts`, `review.ts`(`raises`), `evidence.ts`, `contract.ts`, `flaky.ts`, `signals.ts`, `ratchet.ts`, `diff.ts`, `manifests.ts`, `junit.ts`, `engine/check.ts`, `engine/track.ts`(`conditionsMet`). 이것이 바뀌었는데 `GATE_VERSION`을 올리지 않았으면 실패한다('관문 파일이 바뀜: GATE_VERSION을 올리고 재생을 확인한다').
  - `replay`: V31 재생 묶음 208개(m2 158, m2.1 50)를 지금 관문으로 돌린 (결론, condition, met)의 digest. digest가 바뀌었는데 새 판을 앞 epoch로 이어 두었으면 실패한다('재생 결론이 바뀌었는데 판을 이어 둠').
- **이어 세기:** 올림 PR에서 digest가 그대로면 `GATE_EPOCHS[새 판] = GATE_EPOCHS[앞 판]`으로 이어 둔다. 철학의 '재생 평가를 지나면 다시 연다'의 길을 그대로 쓴다. 바뀌었으면 새 epoch이고 표본은 처음부터다.
- **정직한 한계:** 재생 자료 208개에 보이지 않는 관문 동작 바뀜은 digest가 잡지 못하고, 그런 바뀜은 이어 세어진다. 파일 hash가 올림을 강제하므로 사람이 올림 PR에서 그 바뀜을 본다는 것이 남은 막음이다. relay-v3에서는 이 파일들이 `human_paths`에 들어가 늘 사람이 머지한다(10절). 이 한계를 V 줄에 적는다.
- 판은 장부 줄에 숫자로 남고 epoch는 읽을 때 코드의 표로 계산하므로, 나중에 이어 세기를 고쳐도 장부를 다시 쓰지 않는다.

### 3.4 만든 것 (M4a, V46·V47)

- **장부 칸(3.1):** `engine/ledger.ts` `LedgerEntry`에 `met`, `conds`, `gate_version`, `review_prompt`, `model_requested`, `model_observed`, `effort`, `relay_build`, `pr`, `base_sha`, `approved_by`. `isEntry`(`parseLedger`)는 이 칸이 없으면 옛 줄로 읽고, 있는데 모양이 다르면 그 줄을 버린다. 칸은 내보내기 결론 줄(`exportLine`)에만 쓴다. 머지·닫힘 줄과 [그래도 끝내기]의 받아들임 줄은 그대로다.
- **met과 조건 hash:** `engine/track.ts` `conditionsMet`(조건마다 그 조건 하나만 둔 정책으로 `gate`)과 `condHashes`(core `stableJson`을 내놓고 `qualityHash` 앞 12자). 새 파일 `main/works-ledger.ts` `epochLine`이 줄의 칸을 만들고 `works-exports.ts` `exportLine(deps, job, result)`이 붙인다. `works-evidence.ts`는 부르는 한 줄만 바꿨다(`exportLine(deps, { ...review, bundle }, result)`, 599줄 그대로).
- **model_observed:** `adapters/claude.ts` `claudeJson`이 `--output-format stream-json --verbose`로 부르고 `streamOutput`이 마지막 result 이벤트와 assistant의 마지막 `message.model`을 읽는다. `works-review.ts` `claudeReview`가 결과에 `model`을, 리뷰 끝이 묶음의 `review.model`(core `types.ts`에 한 칸)을 둔다. 가짜 claude는 stream-json(assistant 하나와 result)을 내고 `FAKE_CLAUDE_MODEL`(기본 `fake-review-model`, 빈 글이면 assistant를 내지 않음)을 쓴다.
- **effort:** 새 파일 `main/works-session-log.ts` `SessionLog`(Work마다 마지막 `effort.level`, 메모리). `HookServer`의 새 선택 `noteHook`이 본문을 `onHook` 앞에 넘긴다(던져도 처리는 이어 감). `index.ts`와 [흐름]의 앱이 하나를 만들어 훅 서버와 `WorksDeps.sessionLog`에 함께 준다. `works.ts`(598줄)는 건드리지 않았다.
- **relay_build:** `index.ts`가 시작할 때 앱 폴더(`app.getAppPath()`)가 git checkout의 맨 위면 그 HEAD를 `WorksDeps.relayBuild`로 준다.
- **판 열쇠(3.2):** `engine/ledger.ts` `epochKey(e, 조건)`과 `claudeMinor`. `trackRecord(entries, project, minShadow, current: EpochSource)`는 결론 줄의 열쇠가 지금 판과 같은 줄만 센다(모르는 칸이 있으면 null, 어떤 판과도 같지 않음). 지금 판은 `works-ledger.ts` `epochOf`(그 묶음의 리뷰 모델, Work의 effort, `deps.claudeVersion`, `GATE_VERSION`, `REVIEW_PROMPT_VERSION`, 정책 조건의 hash)이고 `policyFor`가 `trackFor`로 읽는다.
- **관문 판(3.3):** `engine/gate-version.ts`(`GATE_VERSION = 1`, `GATE_EPOCHS = { 1: 1 }`, `gateEpoch`). [단위] `gate-version.test.ts`와 자료 `test/fixtures/gate-version.json`(셈 `test/support/gate-version.ts`, 쓰기 `scripts/gate-version-fixture.ts`). 판 1의 재생: 208개 가운데 조건을 채운 묶음 22개.
- **녹화 칸 목록(14절):** `test/fixtures/recorded-fields.json`(relay-v2 녹화본 `claude.json`의 stream.shapes의 assistant·assistant.message·result 칸, effort가 있는 훅 이벤트의 칸, 앱이 읽는 칸 둘). [어댑터] `claude.test.ts`가 가짜의 출력 칸이 그 안인지 본다.
- **시험:** [단위] `ledger.test.ts`(판 열쇠, M4a 칸 읽기), `track.test.ts`, `gate-version.test.ts`, `session-log.test.ts`. [어댑터] `claude.test.ts`, `hooks.test.ts`. [흐름] `works.test.ts`(내보내기 결론 줄의 M4a 칸 전부, 그 판으로 센 실적), `works-merge.test.ts`·`works-review.test.ts`(앞선 실적을 지금 판으로 적음, `works-flow.ts` `flowEpoch`). `npm run test:replay` 그대로 지남. 렌더러는 바뀌지 않아 [스모크]는 새로 두지 않았고, 메인(리뷰 출력, index.ts)이 바뀌어 있는 [스모크] 5개를 돌려 지났다.
- core 4,847 → 4,850줄(`types.ts` 두 줄, `contract.ts` 주석 한 줄).

### 3.5 설계와 다른 것 (M4a)

- **실적을 리뷰 뒤 다시 읽는다.** 판 열쇠에 리뷰 모델이 들어가는데 `policyFor`는 리뷰 앞에 정책을 만든다. 그래서 리뷰 앞의 묶음은 모델을 몰라 실적이 없는 것(엄격)으로 보고, 리뷰가 끝나면 `works-ledger.ts` `refreshTrack`이 그 묶음의 판으로 그 재기의 정책(`track_record_ok`)을 그 자리에서 고친다(`works-review.ts`의 리뷰 끝. 관문과 내보내기가 같은 정책 객체를 쓴다). 설계에는 이 자리가 없었다.
- **`trackRecord`는 판 열쇠로 세지만 표본은 아직 `condition`(첫 조건)으로 고른다.** `met`으로 세는 것은 M4c `shadowStats`에서 한다. 옛 줄(M4a 앞)은 지금 판에 들지 않는다(3.2 그대로, 엄격하게만 바뀜).
- **자료 꼴:** `{ version, files, replay }` 대신 `{ version, files, replays: { 판: digest } }`. '재생 결론이 바뀌었는데 앞 epoch로 이어 둠'을 보려면 앞 판의 digest가 있어야 해서다. 자료를 쓰는 스크립트 `scripts/gate-version-fixture.ts`를 더했다(판을 올리지 않고 파일 hash가 바뀌었으면 쓰지 않는다). 재생 digest는 V31 시험의 'now' 래칫·V26 올림 규칙·요청을 본 리뷰로 돌린 것이다. 파일 hash는 줄 끝을 LF로 본다(Windows checkout).
- **effort를 받는 자리:** `hooks.ts`가 `works-session-log.ts`를 직접 부르지 않고 `HookServerOptions.noteHook`(선택)을 두어 조립하는 쪽이 같은 `SessionLog`를 훅 서버와 `WorksDeps`에 준다(hooks.ts는 Works를 모른다). 메모리에만 두므로 앱을 다시 켜면 다음 훅까지 effort를 모른다(그 사이의 결론 줄은 판 모름).
- **relay_build:** 패키지 빌드의 electron-vite `define`은 하지 않았다. 앱 폴더가 git checkout의 맨 위가 아니면(패키지 빌드, 다른 레포 안에 놓인 빌드) 칸이 없다.
- 리뷰 뒤 장부를 다시 읽지 못하면 실적이 없는 것으로 두고 log한다(리뷰 결과는 그대로 쓴다).
- **review_prompt**는 늘 `REVIEW_PROMPT_VERSION`이다(다시 쓴 리뷰도 이 판일 때만 다시 쓰인다). **model_requested**는 `deps.model ?? 'default'`이다: 지금 앱은 리뷰에 `--model`을 넘기지 않아 늘 'default'다. **pr**은 그 내보내기에 PR이 있을 때만 적는다([끝내기]의 내보내기는 PR이 없을 수 있다).
- **met**은 관문이 조건을 채웠을 때만 조건마다 다시 본다(아니면 빈 것). 다시 볼 때 head는 묶음의 head, 통합 증거는 그 증거의 head다: 관문이 조건을 채웠다면 둘 다 낡지 않았다.

## 4. M4b 끝까지 따라가기와 '같은 변경'

### 4.1 끝 줄

지금의 끝 줄(`ledgerFate`: `by`, `merged_head`, `closed`, `accepted`)에 칸을 더한다.

```ts
interface LedgerEntry {
  // ── M4b: 끝 줄
  by?: 'human' | 'policy' | 'human-override' | 'human-preapproved'   // preapproved는 다시 녹화한 뒤(Q9)
  ended?: 'no_pr' | 'discarded'       // PR 없이 [끝내기], [버림]
  merge_commit?: string               // gh prView mergeCommit.oid(녹화본에 있음)
  merged_at?: string                  // gh mergedAt(녹화본에 있음)
  same_change?: boolean | null        // 4.3. null은 모름
  after_commits?: { session: number; human: number; relay: number; base_update: number }  // 7절
}
```

### 4.2 끝난 Work도 따라간다 (`src/main/works-record.ts` 새 파일)

- **언제:** 앱 시작, 새 Work를 만들 때(`unrecordedRegressions`와 같은 자리, `works-worktree.ts`), 앱이 도는 동안 6시간마다. 프로젝트마다 한 번에 하나만 돈다.
- **무엇:** 장부에서 끝 줄이 없는 내보내기를 모아 work.json의 `exports`(branch, pr)로 지금 있는 `gh.findPr`(`gh pr list --head <branch> --state all`)를 다시 부른다. Work가 끝났어도 부른다(`fate()`의 `!isActive` 반환을 이쪽이 대신한다. `fate()`와 120초 폴링은 그대로 둔다). 머지됐으면 `prView`로 `mergeCommit`, `mergedAt`을 읽어 끝 줄을 쓴다.
- **PR 없이 끝남:** 끝난 Work의 기록이 PR 없이 [끝내기]였으면 `ended:'no_pr'`, [버림]이었으면 `ended:'discarded'`. work.json에서 읽으므로 지난 Work에도 소급된다. `no_pr`은 바로 불일치로 세지 않는다: 사람이 Work 브랜치를 로컬에서 기준에 합쳤을 수 있다. 거울(4.4)에서 그 head가 90일 안에 기준 브랜치에 닿으면(`merge-base --is-ancestor`, 또는 4.3의 같은 변경) `by:'human-override'` 머지로 쓰고, 닿지 않고 90일이 지나면 불일치 '버려짐'이다.
- **분모 밖으로 보이는 것:** 아직 열림, 14일 넘게 끝이 없음(낡음), 90일 넘게 끝을 모름(추적 잃음), 판이 다름, 정책 머지.

### 4.3 일치는 '같은 변경'으로 본다

지금은 `merged_head === head`다. M5의 전제인 '최신 대상 맞춤' 보호를 켜면 거의 모든 PR이 GitHub Update branch를 거쳐 head SHA가 바뀌고, 그것이 모두 불일치로 찍힌다. 그래서 순수 함수 `sameChange`(`engine/track.ts`)가 거울의 사실로 가른다. 차례대로 본다.

1. `merged_head === head`면 같다.
2. head가 `merged_head`의 조상이고, 사이 커밋이 모두 relay 빚 커밋(작성자 `relay@localhost`, V40)이거나 **깨끗한 기준 맞춤 머지**면 같다. 깨끗한 기준 맞춤 머지 = 부모 하나가 그때의 기준 브랜치에 있고, 그 커밋의 tree가 `git merge-tree --write-tree <부모1> <부모2>`의 결과와 같다(충돌을 손으로 풀지 않음. git 2.38 이상).
3. 아니면(rebase로 맞춤, squash 뒤 head를 잃음 등) `git diff <mb>..<head> | git patch-id --stable`과 `git diff <mb'>..<merged_head> | git patch-id --stable`을 견준다. 같으면 같다.
4. 사이에 다른 커밋이 있으면 다르다(불일치 '더 커밋').
5. 객체를 못 읽으면 `null`(모름)이고 일치로 세지 않는다(엄격).

### 4.4 앱 로컬 거울 (`src/adapters/mirror.ts`, 사용자 결정 Q5)

머지 뒤 30일, 같은 변경, 커밋 가르기는 모두 기준 브랜치의 이력과 PR의 커밋이 로컬에 있어야 한다. 그런데 앱은 사용자 레포에서 fetch하지 않고(m3-design 3절의 리뷰 고침: `gh pr merge`는 로컬 ref를 옮기지 않는다), 기준 브랜치 커밋 목록과 PR 커밋 목록 gh API는 녹화본에 없다. 그래서 사용자 레포를 건드리지 않는 거울을 제안한다.

- `$RELAY_HOME/mirror/<레포 키>.git`: `git clone --bare --filter=blob:none <origin url>`. 4.2의 계기마다 `git fetch origin +refs/heads/<기준>:refs/heads/<기준> +refs/pull/<N>/head:refs/relay/pr/<N>`(따라가는 PR만). 사용자의 git 자격을 그대로 쓴다.
- 사용자 레포의 ref, 설정, 객체를 바꾸지 않는다. V9·V20의 base 읽기도 바뀌지 않는다.
- 비용: blob 없이 받으므로 커밋과 tree만. patch-id가 부르는 blob만 그때 받는다.
- 읽는 adapter(`git.ts`에 더함): `logRange(repo, ref, since, until)`(`-z`, `%H %P %ae %ct %B`), `isAncestor`, `mergeTree`, `patchId`. 모두 실제 git으로 [어댑터] 시험을 둔다.
- 거울을 허락하지 않으면(Q5에서 다른 길): 같은 변경은 1번만 보고 나머지는 모름, 되돌림은 사용자 레포의 `origin/<기준>`을 fetch 없이 읽고, 읽은 ref의 마지막 커밋 시각이 창 끝보다 이르면 '아직 못 봄'(깨끗함이 아님)으로 둔다.

## 5. M4c 조건별 실적 숫자와 보이기

### 5.1 `shadowStats` (engine, 순수, `src/engine/track.ts`)

```ts
shadowStats(entries: LedgerEntry[], scope: { project: string } | { pool: true }, epoch: EpochKey | 'all')
  → Record<조건 id, ConditionStats>

interface ConditionStats {
  cond_hash: string; epoch: string
  n: number                     // 끝이 정해진 표본 = match + miss 합
  match: number                 // 같은 변경을 사람이 머지(human, human-override)
  miss: { more_session: number; more_human: number; more_unknown: number; closed: number; discarded: number; unknown_change: number }
  outside: { open: number; stale: number; lost: number; policy: number; preapproved: number; other_epoch: number }
  rate: number | null; wilson_low: number | null      // 일치율과 Wilson 95% 하한
  correlated: number            // 다른 조건과 같은 Work로 함께 센 표본 수
  after: AfterStats             // 6절. 이 조건을 채운 머지 무리
  control: { as_is: number; n: number; after: AfterStats }  // 비교군: 이 조건을 못 채우고 사람이 머지한 내보내기
  lift: number | null           // 이 조건의 '그대로 머지' 비율 − 비교군의 '그대로 머지' 비율
  inflow: { exports_30d: number; met_30d: number }    // 표본이 들어오는 빠르기
}
```

- **단위**는 (Work, 조건) 한 건이다(V22 그대로). 표본에 드는지는 `met`으로 정하고, 옛 줄은 `condition`으로 대신한다.
- **일치:** 그 조건을 채운 내보내기가 모두 같은 변경(4.3)으로 사람 손에 머지됨.
- **불일치:** 그 head 뒤에 더 커밋해 머지함(갈래는 7절: 세션만, 사람 커밋 있음, 가르지 못함), PR 닫힘, 버림(`discarded`와 90일이 지난 `no_pr`), 같은 변경을 모름(`null`. 엄격하게 일치가 아닌 쪽).
- **분모 밖, 따로 보임:** 열림, 낡음(14일), 추적 잃음(90일), 정책 머지, preapproved(Q9 전까지는 human-override와 가를 수 없음), 판이 다름.
- **lift:** 사람이 거의 다 그대로 머지하면 일치율 95%는 조건이 아무것도 가르지 못해도 나온다. 그래서 비교군의 '그대로 머지' 비율과의 차를 함께 보인다. 비교군은 diff가 더 크므로 차는 원인이 아니라 기술일 뿐이라고 화면에 적지 않고 이 문서와 규약에 적는다.
- **작은 n:** 숫자는 늘 'k/n'이고 Wilson 하한을 곁들인다. 20/20도 하한은 약 0.84다. 사건 0건은 '0/n (위 한계 약 3/n)'으로 적는다(3의 규칙).
- **여러 레포(`pool`):** 같은 `cond_hash`의 실적을 프로젝트를 넘어 합친 값을 계산만 한다. M4에서는 기준에 쓰지 않는다(Q11).
- **`trackRecord`:** `shadowStats` 위의 얇은 함수가 된다: `match ≥ min_shadow`이고 `rate ≥ MATCH_RATE`이고 이 조건의 귀속 되돌림·귀속 main 실패가 0이면 참. 되돌림 0을 더하는 것은 엄격하게만 바꾸는 것이라(V5) 사용자 결정이 아니다. 숫자(`min_shadow` 20, 0.95)는 V3 ✅ 그대로다. 관문의 `Policy.track_record_ok`(참·거짓 맵)는 그대로다.

### 5.2 사람이 보는 것

- **설정 대화상자의 [실적] 칸:** 새 컴포넌트 `src/renderer/src/RecordTable.tsx`(dialogs.tsx 328줄에 붙이지 않음). 조건마다 한 줄, 그리고 '사람 경로(조건 못 채움)' 비교 줄 하나. 예:
  `small (a1b2c3) · 이 판: 모델 claude-…, effort medium, Claude Code 2.4, 관문 판 3 · 일치 7/9 (하한 0.45) · 불일치: 사람이 더 고침 1, 닫음 1 · 분모 밖: 열림 3, 정책 0, 판 다름 4 · 머지 뒤(창 닫힘 4, 지켜보는 중 5): 되돌림 0, main 실패 귀속 0, 미정 1 · 같은 Work로 함께 센 표본 2`
  비교 줄: `사람 경로 · 그대로 머지 21/23 · 머지 뒤(창 닫힘 15): 되돌림 0/15 (위 한계 약 0.2)`.
  기본은 지금 판이고 '모든 판'으로 바꿀 수 있다. 앞 판은 접어 두고 '판이 바뀜: Claude Code 2.3 → 2.4'처럼 바뀐 칸을 적는다. 깨진 장부 줄 수도 보인다.
- **보이지 않는 것:** 'M5까지 몇 건' 진행 막대, '기준까지 몇 주', 알림, 할 일 줄. 숫자는 규칙을 정할 근거이지 할 일 목록이 아니다(philosophy 6장, 0/12).
- **[증거]의 그림자 줄(Q6):** 지금은 '그림자: 자동이었으면 머지했을 것 (조건 X)'(`format.ts` `conclusionOf`)를 머지 전에 보인다. 그것을 본 사람이 그 head를 머지하면 일치가 부풀고 비교군과의 lift도 함께 흐려진다(닻 내림). 제안은 끝이 정해질 때까지 이 줄을 가리고, 끝난 뒤 '그림자 표본: 일치'나 '그림자 표본: 불일치(사람이 더 커밋함)'로 보이는 것이다. 결론('사람 머지')과 열린 것은 그대로 보인다.
- **이의:** [실적]의 귀속된 되돌림·main 실패 줄마다 커밋 링크와 [귀속이 틀림]이 있다. 누르면 장부에 `{kind:'dispute'}` 줄을 쓰고 그 사건은 셈에서 빠진 채 따로 보인다(6장 4: 장부 사건에 이의를 단다). 6절 장치의 끄는 조건에 쓴다.
- **CLI `relay record [--json] [--project <path>] [--all-epochs] [--pool]`** (`src/cli/app.ts`에서 부르는 새 파일 `src/cli/record.ts`): `$RELAY_HOME`의 장부에서 같은 표를 찍는다. 장부 읽기는 `main/store.ts`에서 `adapters/store.ts`로 내려 main과 cli가 함께 쓴다. relay-v3 주간 기록과 M5 판정 문서가 이것을 쓴다.
- 화면을 고치므로 `CONTRIBUTING.md`의 화면 찍기로 띄워 찍어 열어 보고, [스모크] `test/smoke/record.spec.ts`를 돌린다.

## 6. M4d 머지 뒤 30일

- **누구를:** 그림자 표본만이 아니라 앱이 내보낸 머지 전부(사람, human-override, 정책, preapproved). 8.4 다섯째 조건('자동 후보의 되돌림이 사람 검토 변경보다 많으면 열지 않는다')에 비교군이 필요하다.
- **창:** `merged_at`부터 30일. 4.2와 같은 계기에서 돈다. 이력을 소급해 읽으므로 앱이 30일 꺼져 있어도 잃지 않는다. 창 안에서는 처음 본 사건만 쓰고, 창이 닫히면 한 줄을 쓴다.

```ts
interface AfterLine {
  kind: 'after'; ts: string; project: string; work: string; export?: string
  merge_commit: string; window_end: string; closed: boolean      // closed: 창이 닫힘
  revert: { sha: string; form: 'this_reverts' | 'reverts_pr' | 'revert_title' } | null
  main: 'clean' | 'attributed' | 'pending' | 'inherited' | 'unknown' | 'unmeasurable'
  main_run?: { name: string; sha: string; attempts: number }
  seen_until: string                                               // 거울(또는 읽은 ref)의 마지막 커밋 시각
}
```

- **되돌림 (순수 `revertsOf`, `src/engine/after-merge.ts`):** 창 안의 기준 브랜치 커밋 가운데 (가) 본문 `This reverts commit <oid>`의 oid가 이 머지가 기준에 올린 커밋 집합에 있음(merge 머지면 M과 PR 커밋, squash면 M, rebase면 M에서 first-parent로 PR 커밋 수만큼), (나) `Reverts <owner>/<repo>#<pr>`(GitHub 되돌림 PR 본문), (다) 제목 `Revert "<PR 제목>"`. 손으로 한 부분 되돌림은 놓친다(낙관 쪽 맹점, 7.6에 적음).
- **main 실패 (adapter `gh.ts` `runsAt(path, sha)`, 순수 `mainOf`):** `gh api repos/{o}/{r}/actions/runs?head_sha=<M>&event=push`. 녹화본 `run` 모양의 `head_sha`, `conclusion`, `event`, `run_attempt`, `name`, `path`만 쓴다. 판정:
  - 실패한 워크플로가 부모 M^1에서는 성공했고 같은 워크플로의 다시 시도(`run_attempt ≥ 2`)도 실패: **귀속**(원칙 4의 정의).
  - 다시 시도가 없음: **미정**. 앱은 CI를 스스로 다시 돌리지 않는다(사용자 인프라에 생기는 부작용). 미정은 M5를 막는다(엄격).
  - 부모도 실패: 물려받음. 부모 실행이 없음: 모름.
  - 레포에 필수 검사가 없거나(`ci_checks`가 비고 서버 보호의 required contexts도 없음) push 실행이 0: **잴 수 없음**. 0과 다르게 보인다.
- **후속 고침**(같은 줄을 30일 안에 다시 고침)은 8.1대로 참고만이고 M4에서는 만들지 않는다.
- **`AfterStats`:** 창 닫힘 수, 지켜보는 중 수, 되돌림 수, main 실패(귀속, 미정, 물려받음, 모름), 잴 수 없음 수, 이의로 뺀 수, 0이면 위 한계.

## 7. M4e 세션 커밋 가르기와 트레일러

일치 판정에는 필요 없다. 불일치 '더 커밋'을 세션이 더 고침(사람이 터미널에서 시킴)과 사람이 직접 고침(사람 교정, 8.1)으로 가르고, 감사 기록(7장 7)을 채운다. 앱은 사용자 레포에 커밋하지 않는다(V20·V40 밖의 쓰기가 아님).

### 7.1 첫 겹: 앱 로컬 세션 커밋 집합 (결정론, 훅 없음)

- `main/works-session-log.ts`가 세션의 PostToolUse(Bash)와 Stop마다 Work 브랜치 끝(`refHead`)을 읽고, 앞에 읽은 끝에서 지금까지 새로 생긴 커밋(`git rev-list prev..now`)을 work.json `session_commits[]`에 더한다.
- 도구 경계에서 보지 못한 커밋은 '세션 밖'이다(사람이 직접, GitHub 웹 고침, 다른 곳의 push).
- 맹점: 세션의 긴 Bash가 도는 사이 사람이 같은 브랜치에 커밋하면 세션 쪽으로 셈한다.

### 7.2 둘째 겹: `Relay-Work` 트레일러 (사용자 결정 Q7)

- **환경(main에서 합침, core `sessionEnv`는 그대로):** `works-worktree.ts`가 세션 PTY 환경에 `GIT_CONFIG_COUNT=1`, `GIT_CONFIG_KEY_0=core.hooksPath`, `GIT_CONFIG_VALUE_0=$RELAY_HOME/git-hooks`, `RELAY_ORIG_HOOKS=<원래 훅 자리>`를 더한다. 원래 자리는 세션을 띄울 때 worktree에서 `git rev-parse --git-path hooks`로 구한다(레포의 `core.hooksPath`, husky 등을 존중). 세션 프로세스와 그 자식만 물려받는다. 사람의 셸과 앱의 확인 실행기는 물려받지 않는다. git 2.31 미만이면 넣지 않고 장부에 `trailer:false`.
- **심 (`src/adapters/git-hooks.ts`):** git의 표준 훅 이름마다 작은 sh 심을 `$RELAY_HOME/git-hooks`(레포 밖)에 한 번 쓴다. 심은 `$RELAY_ORIG_HOOKS/<이름>`이 있으면 같은 인자와 표준 입력으로 exec한다. `prepare-commit-msg`만 원래 훅을 부른 뒤 `git interpret-trailers --in-place --if-exists addIfDifferent --trailer "Relay-Work: $RELAY_WORK_ID" "$1"`을 더한다. `commit-msg`가 아니라 이것을 쓰는 까닭은 `--no-verify`가 commit-msg는 건너뛰지만 prepare-commit-msg는 건너뛰지 않아서다. 심의 글은 engine의 순수 함수가 만든다.
- **누락 감시:** 7.1의 집합에 든 커밋인데 트레일러가 없으면 events.jsonl에 `trailer_missing`을 남긴다(세션이 `GIT_CONFIG_*`를 지웠거나 rebase·cherry-pick에서 빠짐).
- 맹점: 사람이 claude TUI 안에서 `!git commit` 하면 같은 환경이라 세션 커밋으로 셈한다. Claude Code의 attribution 설정이나 지침 문구는 결정론이 아니므로 세는 데 쓰지 않는다.

### 7.3 가르기 (순수 `classifyCommits`, `engine/track.ts`)

끝 줄을 쓸 때 거울에서 그림자 head 뒤 머지된 head까지의 커밋(squash면 `refs/relay/pr/<N>`)을 넷으로 나눠 `after_commits`에 센다: `relay`(작성자 `relay@localhost`, V40), `base_update`(4.3의 깨끗한 기준 맞춤 머지), `session`(7.1 집합에 있거나 트레일러가 있음), `human`(나머지). 집합과 트레일러가 다르게 가르면 그 커밋은 `human`으로 셈하고(엄격), 다름의 수를 장치 지표로 남긴다.

## 8. M4f 관문 5회 반복 안정성 (측정, 앱 장치 아님)

V31처럼 이름표가 붙은 측정 자료다. 장치가 아니므로 화면에 없고, design.md V 줄로 등록한다. 도구는 `scripts/gate-repeat.ts`, 결과는 `docs/experiments/m4/`.

- **(A) 결정론 입력 (8.4 일곱째 조건):** head K개(제안 10: 지난 평가에서 레포와 계약이 남은 묶음 가운데 조건을 채운 것과 경계의 것, relay-v3 Work의 head 셋. 남은 것은 규약을 쓸 때 확인)마다 새 임시 `RELAY_HOME`으로(SHA 캐시가 없게) engine `check`를 5번 돌린다. 리뷰는 끄고, 정책은 초안 조건, 서버 null, 실적 빈 값이다. 입력 칸마다 digest를 남긴다: `commands.<id>.outcome`, 흔들림 판정, `ratchets.<id>`, `lines.<id>.status`, 신호, 시험 약화, `met`, 결론과 decisive. 순수 함수 `stabilityOf(runs)`(`engine/stability.ts`)가 갈린 칸과 결론이 바뀌었는지를 낸다. 결정론 입력만으로 결론이 갈리면 그 입력을 관문에서 빼는(흔들리는 시험 규칙으로 막을 수 있으면 그것을 먼저 고치는) V 줄을 사용자에게 제안한다.
- **(B) 리뷰 포함:** 같은 head에서 리뷰만 5번. 리뷰는 엄격하게만 바꾸므로 결론을 가르는 것은 '올림이 있나'뿐이다. 올림 유무가 갈린 비율과 올림 갈래가 갈린 비율을 따로 센다. 이 숫자는 8.4 일곱째 조건(결정론 입력)이 아니라 devices.md '독립 리뷰' 줄의 지표로 간다. 이미 있는 자료: `docs/experiments/m2.1/review-replay.jsonl`의 3회 반복 묶음(설계 때 센 값: 8개 가운데 올림 갈래 갈림 4, 올림 유무 갈림 0. 규약에서 다시 센다).
- **(C) 생성 안정성 (8.2, 같은 요청 5회):** 새 실행 없이 지난 n=5 자료에서 시나리오마다 줄 종류 다중집합, '사람' 줄 유무, 결론, 조건 채움 횟수를 센다. 설계 때 센 갈림은 셋이다(결정에 쓰지 않음): m2 `10-invoice-rounding/relay3`(5회 가운데 1회 조건 채움), `14-double-notify/relay3`(4회), m2.1 `07-two-bugs`. 생성 분산이라 관문에서 뺄 입력이 아니고 보고만 한다. 사실별로 귀인하려면 재생 자료에 `reasons`가 필요하므로 `scripts/gate-replay-fixture.ts`가 지금 관문으로 다시 계산한 reasons를 함께 적게 한다.
- CLI에는 두지 않는다(평가 도구). 계기는 마일스톤마다, `GATE_VERSION`을 올릴 때, Claude Code major.minor가 바뀔 때(8.3).

## 9. M4g 재생 실적 (지난 평가, 모델 호출 없음)

- **자료:** `scripts/track-replay.ts`가 relay-v2 `app/eval/results/`의 relay3 쪽 Work 장부(`works/*/ledger.jsonl`, 설계 때 센 수 318개)와 work.json, M3 순차 실행의 sequence 기록을 읽어 칸만 `test/fixtures/track-replay/<규약>.jsonl`에 둔다: 시나리오, 쪽, 회차, work, head, conclusion, met, 끝(AI 사람 역할의 머지·닫힘), 숨긴 시험 통과, M3 순차라면 뒤 Work의 누적 숨긴 시험에서 이 Work의 시험이 계속 통과했는지. 숨긴 시험 본문, 정답, 봉인 글은 넣지 않는다(M3 runs의 봉인 확인 방식).
- **네 표:** (1) 조건별 그림자 정밀도·재현율(G1·G2, 숨긴 시험이 이름표. V31 그대로: 거짓 자동 m2 3, m2.1 0). (2) AI 사람 역할과의 일치(같은 `shadowStats`). (3) 머지 뒤 대리 지표: M3 순차 레포에서 앞 Work의 숨긴 시험이 뒤 누적에서 깨진 수. 6절의 귀속 규칙이 이것을 잡는지(정밀도·재현율)도 본다. (4) 8절 (C).
- **쓰임:** `track.ts`·`after-merge.ts`의 [단위] 고정 자료, M5 판단의 사전 자료, 13절 끄는 조건 (가)의 입력.
- **섞지 않는다:** 사람이 AI이고 레포도 시나리오 레포다. 제품 장부(`$RELAY_HOME/ledger.jsonl`)에 넣지 않고 `trackRecord`에 쓰지 않는다. `relay record`의 `--pool`도 `RELAY_HOME`이 다른 장부를 합치지 않는다.
- 설계 때 손으로 센 값(결정에 쓰지 않음): 재생 묶음에서 조건을 채운 비율은 m2 relay3 5/65(7.7%), m2.1 8/50(16%)이고, M3 순차 실행 90개 가운데 그림자는 2개(일치 1, 불일치 1)였다. 표본이 이만큼 작다는 것 자체가 결과다.

## 10. M4h relay-v3 자신부터 돌리기

사람이 할 일과 운영 절차다. 앱 코드가 아니다.

1. **사람이 PR로 `.relay/quality.json`을 고친다(지킴 파일, V9).** `auto: [small]`(V19 초안 조건 그대로), `full.ci_checks: ["check (ubuntu-latest)", "check (windows-latest)"]`(`.github/workflows/ci.yml`의 matrix 잡 이름), `human_paths`에 관문·실적을 정하는 파일(3.3의 파일 목록, `src/engine/ledger.ts`, `track.ts`, `after-merge.ts`, `gate-version.ts`, `test/fixtures/gate-version.json`)과 `docs/design.md`, `docs/devices.md`. 판정하는 코드를 판정받는 Work가 고치면 늘 사람에게 간다. 시스템이 자기 자율을 스스로 넓히지 못하게 한다(원칙 4: 느슨하게 하는 길은 정책 PR뿐).
2. **GitHub에서 `main` 보호와 필수 검사(위 둘)를 켠다.** 그림자에는 필요 없지만 서버 보호 칸이 '확인 못 함'이 아니게 되고, M5의 전제다. '최신 대상 맞춤'도 켠다(4.3이 Update branch를 같은 변경으로 본다). main에 바로 push하던 흐름이 바뀐다.
3. **앱을 고정 빌드로 돌린다.** `~/relay-v3-run`처럼 따로 둔 checkout의 정한 commit에서 돈다. 사람이 일부러 올릴 때만 바뀌고, 그때 `relay_build`가 바뀐다. Work의 worktree(`$RELAY_HOME/worktrees`)가 바꾼 코드는 그 Work를 판정하는 앱에 들어가지 않는다.
4. **M4a를 낸 날부터 relay-v3의 변경은 앱의 Work로 한다.** 예외(평가 배치, 앱이 깨졌을 때의 고침)는 앱 밖에서 하고 주간 기록에 적는다. `relay record`가 '앱 밖 커밋의 몫'(기준 브랜치 커밋 가운데 장부의 `merge_commit`도 그 PR 커밋도 아닌 것)을 보인다. 몫이 크면 실적이 레포를 대표하지 못한다.
5. **주마다** `relay record --json`을 `docs/experiments/m4/dogfood.md`에 붙인다.
6. **예상:** relay-v3의 변경은 core나 여러 파일을 건드리는 일이 많고, 문서·화면 Work는 observe 줄 때문에 `small`을 채우지 못한다. 첫 몇 달의 숫자는 대부분 '증거 부족'이고, 그대로 보인다(8.5).

평가(AI 사람 역할)에서 나온 장부는 `RELAY_HOME`이 달라 실제 실적과 섞이지 않는다. 평가 쪽 그림자 정밀도는 재생(9절)으로만 본다.

## 11. 30일을 어떻게 다루나

오늘은 2026-11-06이다. M4-0과 M4a를 2026-11-09 무렵 내고 같은 날 relay-v3 Work를 앱으로 시작하면, 첫 30일 창은 빨라야 2026-12-09 무렵 닫힌다.

| 지금(재생과 지난 자료로) 잴 수 있음 | 달력 시간이 있어야 함 |
|---|---|
| 조건별 재생 거짓 자동(V31: m2 3, m2.1 0). M5의 첫 막힘이다 | 실제 사람의 일치·불일치(relay-v3 Work가 머지되는 빠르기) |
| 재생에서 조건을 채운 비율(표본이 들어올 빠르기 어림) | 30일 창이 닫힌 머지의 되돌림·main 실패 |
| AI 사람 역할과의 일치, M3 순차의 누적 숨긴 시험(머지 뒤 대리 지표) | 판 바뀜의 빈도와 그때 잃는 표본 |
| 결정론 입력 5회 안정성(A), 리뷰 5회(B), 생성 5회(C, 지난 자료) | 트레일러 덮임, 세션 커밋 집합과 트레일러의 일치 |
| 판 칸이 바르게 채워지는지(M4a 낸 다음 날부터) | '앱 밖 커밋의 몫'의 추세 |
| 조건 hash와 관문 판 래칫의 동작 | 이의([귀속이 틀림])의 비율 |

- 머지·닫힘·되돌림·CI 실행은 이력에서 소급해 읽으므로, M4b~M4d를 늦게 내도 M4a 뒤의 표본은 잃지 않는다. 잃는 것은 M4a의 칸뿐이다.
- 이 레포에서 '30일'을 줄이거나 흉내 내지 않는다. [흐름] 시험은 가짜 시계(`deps.now`)로 창 경계를 보지만, 실적 숫자는 실제 날짜로만 닫힌다.
- 어림(결정에 쓰지 않음): relay-v3 Work가 하루 3~8개이고 `small`을 채우는 몫이 2~10%라면 조건을 채운 Work는 주 0.5~5개다. 일치 20건에 몇 주에서 몇 달이 걸리고, 마지막 표본의 30일을 더해야 한다. 판이 바뀌면 다시 처음이다.

## 12. M5에 넘기는 것

M4는 아래 숫자를 조건과 판마다 낸다. M5는 이것으로 판정 규칙을 결과 전에 고정한다(숫자는 사용자, 16절 Q2).

1. 지금 판에서 일치 k/n과 Wilson 하한, 불일치 갈래, 분모 밖 수, lift.
2. 30일 창이 닫힌 이 조건의 머지(사람, 정책, preapproved 모두)에서 귀속 되돌림, 귀속 main 실패, 미정, 잴 수 없음. 비교군의 같은 숫자.
3. 결정론 입력 5회에서 결론이 갈린 head 수(8절 A).
4. 지금 `GATE_VERSION`에서 이 조건의 재생 거짓 자동 수(9절 표 1).
5. 판 칸과 다시 여는 규칙(판이 바뀌면 그림자로 돌아가고, 관문 판은 3.3의 이어 세기, 모델·effort·Claude Code는 새 판에서 K건).
6. 표본이 들어오는 빠르기와 앱 밖 커밋의 몫.

제안하는 열기 조건(사용자가 숫자를 정함): 1에서 일치 ≥ `min_shadow`(20, V3 ✅)이고 끝이 정해진 n ≥ 30, 일치율 ≥ 0.95, lift > 0. 2에서 창이 닫힌 이 조건의 머지 ≥ 20, 귀속 0, 미정 0, 그리고 이 레포가 '잴 수 있음'. 되돌림 비율이 비교군보다 높지 않음(8.4 다섯째). 3이 0. 4가 0. 그리고 사용자 허용, 하루 상한, 전체 끄기 스위치(11장 M5). 지금 4는 m2에서 3이라(14-double-notify의 relay3-1, 2, 5) `small`은 관문이나 조건을 고치기 전에는 열 수 없다. 이것은 M4를 기다리지 않고 지금 알 수 있는 숫자다.

## 13. devices.md에 더할 줄

'그림자 실적' 줄(지금 25행)을 고치고 넷을 더한다. '자동 머지' 줄에 덧붙인다. 상태는 모두 M4 동안의 것이다.

| 장치 | 가정 | 붙는 사건 | 비용 | 지표 | 끄는 조건 | 최소 n | 상태 | 마일스톤 |
|---|---|---|---|---|---|---|---|---|
| 그림자 실적 (고침, M4a·M4b·M4c) | 신뢰는 실적을 따라 맞춰야 한다. 조건을 채운 변경을 사람이 고치지 않고 그대로 머지하는 비율이 95%에 가깝고 사람 경로보다 높으면(lift), 그 조건은 사람 없이 머지해도 사람 결정과 같다(가정) | 내보내기 결론(`met`: 조건마다 gate를 따로 부름), 끝(머지, 닫힘, 버림, PR 없이 끝남. 끝난 Work도 6시간마다 따라감) | 장부 칸, gh 읽기, 거울 fetch, patch-id | 조건·판마다 일치 k/n과 Wilson 하한, 불일치 갈래, 분모 밖 수, lift, 들어오는 빠르기 | (가) 재생 실적(9절)에서 일치율이 기준을 넘는 조건의 숨긴 시험 정밀도 G1이 0.9 아래이거나, 조건 사이 일치율 순위가 G1 순위와 반대면 일치율을 M5 기준에서 빼고 알림으로 내린다(머지 뒤 결과와 재생만 쓴다). (나) 앱으로 판정한 레포들에서 내보내기 200개 동안 어느 조건도 끝이 정해진 표본 10건에 닿지 않으면, 조건을 넓히는 정책 PR을 사람에게 묻거나 화면 칸을 접고 기록만 한다(사람 승인) | 조건·판마다 끝이 정해진 30. 기준의 일치 수는 `min_shadow`(V3) | 그림자 | M4 |
| 머지 뒤 30일 추적 (새 줄, M4d) | 사람이 그대로 머지했다는 것만으로는 품질을 모른다(사람이 덜 보면 덜 교정한다, 원칙 4). 사람이 놓친 결함은 30일 안에 되돌림이나 그 커밋에 귀속되는 main 실패로 드러나고, 귀속 규칙(부모 통과, 다시 시도도 실패)은 동시 머지와 흔들리는 CI를 걸러 낸다(가정) | 앱이 내보낸 모든 머지(그림자 후보와 비교군). 앱 시작, 새 Work, 6시간마다 | 거울 fetch, 실행 목록 gh 호출, 장부 줄 하나 | 무리별 창 닫힘 수, 되돌림, main 실패(귀속, 미정, 물려받음, 모름), 잴 수 없음 비율, 이의 수 | (가) 귀속 10건 이상에서 [귀속이 틀림] 비율이 20%를 넘으면 귀속 규칙을 고칠 때까지 M5 근거에서 빼고 기록만 한다. (나) 잴 수 있는 머지가 그 레포 머지의 절반 아래면 그 레포는 '잴 수 없음'으로 보이고 M5 근거로 쓰지 않는다. (다) 재생(9절 표 3)에서 누적 숨긴 시험 실패를 귀속 규칙이 절반도 잡지 못하면 규칙을 고칠 때까지 기록만 한다 | 창이 닫힌 머지 30 | 그림자 | M4 |
| 세션 커밋 가르기 (새 줄, M4e) | 세션 커밋과 사람 커밋을 결정론으로 가르지 못하면 사람 교정(8.1)과 불일치 갈래를 셀 수 없다. 도구 경계에서 본 커밋 집합과, 세션 프로세스에만 거는 prepare-commit-msg 심의 트레일러는 모델에게 맡기지 않고 사용자 레포 설정을 바꾸지 않고 가른다(가정) | 세션 PostToolUse(Bash)·Stop(집합), 세션의 git commit(트레일러, 원래 훅에 위임) | rev-list 한 번, 커밋마다 심 하나, 레포 훅을 감싸는 위험 | 사람 교정 비율, 트레일러 덮임(목표 100%), 집합과 트레일러가 다르게 가른 수, `trailer_missing`, 훅 위임 사고 수(목표 0) | (가) 레포 훅 위임 사고(원래 훅이 돌지 않았거나 커밋이 거절됨) 1건이면 그 프로젝트에서 트레일러를 바로 끈다(바닥을 깨면 안 됨). 집합은 남긴다. (나) Work 30개에서 집합과 트레일러가 모든 커밋을 같게 가르면 트레일러를 기본에서 빼고 집합만 남긴다(사람 승인). (다) 덮임이 커밋 50개에서 95% 아래면 방식을 다시 정한다 | Work 30, 세션 커밋 50 | 그림자(기록만) | M4 |
| 판 다시 재기 (새 줄, M4a) | 모델, effort, Claude Code, 관문, 리뷰 프롬프트가 바뀌면 옛 실적은 새 동작을 말하지 못한다(원칙 4). 관문 바뀜은 재생 결론이 같으면 이어 셀 수 있다(가정) | 장부 결론 줄마다 판 칸, `GATE_VERSION` 올림 PR(파일 hash 래칫과 재생 digest) | 판이 바뀔 때마다 표본을 처음부터 셈 | 판 칸 빈 비율(목표 0), 30일마다 판 바뀜 수와 바뀐 칸, 그때 잃은 표본 수, 판 앞뒤 일치율 차 | 한 칸(예: Claude Code minor)이 바뀐 앞뒤에서 끝이 정해진 표본이 각 15 이상이고 일치율과 머지 뒤 비율의 차가 δ(0.1) 안인 일이 세 번 이어지면 그 칸을 판 열쇠에서 뺄지 사용자에게 묻는다(넓히는 쪽이라 사람 승인. 기록은 계속). 모델과 관문 epoch는 이 규칙으로 빼지 않는다 | 판 앞뒤 각 15 | 그림자(M4에는 연 조건이 없어 표본 고르기에만 씀) | M4 |
| 자동 머지 (V3, 덧붙임) | (그대로) | (그대로) | — | M4d의 숫자를 쓴다 | (그대로) 덧붙임: 미정 1건도 열지 않는다. 판이 바뀌면 그림자로 돌아간다 | 조건별 `min_shadow`, 창이 닫힌 표본 | 꺼짐 | M5 |

관문 5회 반복(8절)과 재생 실적(9절)은 장치가 아니라 V31처럼 이름표가 붙은 측정 자료다. design.md V 줄로 등록하고 등록부에는 올리지 않는다. 관문 5회의 결과 전 규칙(결정론 입력만으로 결론이 갈린 head가 하나라도 있으면 그 입력을 빼는 V 줄을 제안)과 계기를 그 V 줄에 적는다.

## 14. 시험 층

| 층 | 무엇 |
|---|---|
| [단위] `test/unit/` | `ledger.test.ts`(옮김, 옛 줄과 새 칸 읽기, `kind:'after'`·`'dispute'` 줄), `track.test.ts`(`conditionsMet`: 조건 둘을 모두 채운 묶음과 사람 사실이 있는 묶음, `sameChange`의 다섯 경우, `classifyCommits`의 네 갈래와 집합·트레일러가 다른 경우, `shadowStats`의 분모 갈래 하나마다, lift, Wilson과 3의 규칙, 함께 센 표본, `epochKey`의 unknown, `trackRecord`의 참·거짓), `after-merge.test.ts`(되돌림 글 세 꼴과 merge·squash·rebase 귀속, 창 경계, main의 여섯 상태), `gate-version.test.ts`(3.3), `stability.test.ts`, 재생 실적 자료로 고정한 표, 렌더러 `RecordTable`의 글(k/n, 진행 막대 없음), 심 글 만들기 |
| [어댑터] `test/adapters/` | 실제 임시 레포에서: 거울 clone·fetch가 사용자 레포의 ref를 바꾸지 않음, `logRange`·`isAncestor`·`mergeTree`·`patchId`, `git revert`가 만든 글을 찾음, 심으로 `git commit` 했을 때 트레일러가 붙음(`--no-verify`, amend 포함), 원래 훅과 husky식 `core.hooksPath`에 위임됨, 원래 훅이 실패하면 커밋도 실패함. Windows CI에서 심이 sh로 돎 |
| [흐름] `test/flow/` | `works-record`: 가짜 gh로 Work가 끝난 뒤 머지, PR 없이 끝남과 버림, Update branch 뒤 머지(같은 변경), 사람이 더 커밋한 머지, 머지 뒤 되돌림 PR, main 실패와 다시 시도, 미정, 가짜 시계로 30일 창 닫힘, `RELAY_HOME`이 다른 장부를 합치지 않음 |
| [스모크] `test/smoke/` | `record.spec.ts`: 설정 대화상자의 [실적] 표와 가린 그림자 줄(찍어서 열어 봄) |

- 가짜 gh(`test/support/fakes.ts`)와 가짜 claude는 녹화본에 있는 칸만 쓴다: prView `mergeCommit`·`mergedAt`, `run`의 `head_sha`·`conclusion`·`event`·`run_attempt`·`name`·`path`, 훅의 `effort`, stream의 `message.model`. `autoMergeRequest`, `mergedBy`, PR commits API는 지어내지 않는다(Q9에서 다시 녹화한 뒤에만).
- relay-v3에는 `test/contract/`가 없다. 쓰는 녹화 칸의 목록을 `test/fixtures/recorded-fields.json`에 출처(relay-v2 녹화본의 경로)와 함께 적고, [단위]가 가짜가 그 밖의 칸을 쓰지 않는지 본다.
- `npm run test:replay`는 그대로 지나야 한다. push 전 `npm run check`.

## 15. 재는 판 (M4 규약)

`docs/experiments/m4/protocol.md`에 결과를 보기 전에 고정한다. 틀은 m3 규약과 같다(규칙 0: 일어남 = 표본이 최소 n에 이름. 차의 구간이 ±δ 안이면 같음, 걸치면 모름).

- **(가) 재생 실적 소급 셈(9절):** 비용 0. 표 1~3과 13절 끄는 조건 (가)·머지 뒤 (다)를 판정한다.
- **(나) 관문 5회 (A)와 (B)(8절):** head 10 × 5회.
- **(다) 생성 5회 (C):** 지난 자료만. 새 5회 실행은 사용자 결정(Q13).
- **(라) relay-v3 자기 실행:** 주간 기록. M4 판정은 첫 창이 닫힌 뒤 한 번, 그 뒤 철학 8.3의 'Work 50개마다'.
- 판정할 것: 13절 각 줄의 끄는 조건, 8.4 일곱째(결정론 입력의 5회 갈림), 판 칸 빈 비율 0. M5 열기는 판정하지 않는다(12절, M5 규약에서).

## 16. 비용과 사람에게 물을 것

### 16.1 비용

- **만들기(어림):** 새 src와 scripts 약 1,800~2,200줄. engine(옮긴 ledger, `track.ts` 약 250, `after-merge.ts` 약 180, `gate-version.ts` 약 30, `stability.ts` 약 120), adapters(`mirror.ts` 약 100, `git.ts` 더함 약 60, `gh.ts` `runsAt` 약 40, `git-hooks.ts` 약 80), main(`works-record.ts` 약 300, `works-session-log.ts` 약 120, 고침 약 60), cli `record.ts` 약 80, renderer `RecordTable.tsx` 약 150, scripts(`gate-repeat.ts` 약 250, `track-replay.ts` 약 200). 시험은 그 1.5배쯤. 에이전트 작업으로 6~9일. core는 순감(약 −150, 더하는 것은 1줄).
- **측정:** 재생 실적과 (C)는 $0. (A)는 check 50회 × (base+head), relay-v3 check 한 번을 3~6분으로 치면 기계 2.5~5시간, 토큰 0. (B)는 리뷰 50회로 $15~50 어림(규약에 M2.1 리뷰 단가로 미리 적는다).
- **운영:** 6시간마다 프로젝트당 gh 호출(따라가는 내보내기 수 + 창 안 머지 수만큼), 거울 fetch 한 번, 거울 디스크(blob 없이).
- **달력:** 11절. 이것이 진짜 비용이고 줄일 수 없다.

### 16.2 사람에게 물을 것 (각각 권장안)

- **Q1 core 자리.** `core/ledger.ts`를 engine으로 옮겨 자리를 만든다 / 상한 5,000을 올린다. **권장: 옮긴다**(상한 그대로, 동작 그대로, 선례 있음).
- **Q2 M5 숫자(결과 전에 고정, V3 ✅를 다시 정하는 일).** 일치 수 `min_shadow` 20 그대로 / 30. 일치율 0.95(지금 코드 값, ✅ 아님). 끝이 정해진 n 하한, lift > 0을 요구할지, 창 길이 30일, 창이 닫힌 머지 몇 건에서 귀속 0·미정 0을 볼지, 판 비교의 δ. **권장: 12절의 안**(일치 20 그대로, n ≥ 30, 0.95, lift > 0, 창 30일, 닫힌 창 20건에서 귀속 0·미정 0, δ 0.1).
- **Q3 판 열쇠(원칙 4의 해석).** 글자 그대로(모델, effort, Claude Code, relay 버전 하나라도) / 3.2의 안. **권장: 3.2의 안**(모델, effort, Claude Code major.minor, 관문 epoch, 리뷰 프롬프트, 조건 hash. patch와 relay 빌드는 적기만). 관문 판은 재생 결론이 같으면 이어 센다.
- **Q4 세션 모델 고정.** 앱이 `--model`에 실제 모델 id를 늘 준다 / 지금처럼 CLI 기본으로 두고 본 모델만 적는다. **권장: 고정하지 않고 적기만**(사용자의 Claude Code 설정을 바꾸지 않는다. 판 칸의 한계는 `model_observed` 이름으로 드러낸다). 고정은 프로젝트 설정의 선택 칸으로 나중에.
- **Q5 기준 이력을 읽는 길.** (가) `$RELAY_HOME`의 앱 로컬 blobless 거울(사용자 레포를 건드리지 않음, 디스크와 네트워크를 씀) / (나) 앱이 사용자 레포에서 `git fetch`(원격 추적 ref와 V9·V20의 base 읽기가 바뀜) / (다) gh API만(기준 커밋 목록·PR 커밋 API를 다시 녹화해야 하고, 객체가 없어 같은 변경과 커밋 가르기를 못 함). **권장: (가).** 앱이 CI 다시 실행을 부르는 것은 금지하고 '미정'으로 둔다.
- **Q6 그림자 줄 가리기.** [증거]의 '그림자: 자동이었으면 머지했을 것'을 끝이 정해질 때까지 가린다 / 지금처럼 보인다. **권장: 가린다**(닻 내림을 없앰. 결론과 열린 것은 그대로 보임).
- **Q7 세션 커밋 트레일러.** 세션 PTY 환경의 `core.hooksPath` 심으로 `Relay-Work: <id>`를 붙인다(세션 커밋 메시지가 바뀜. 앱의 커밋은 아님) / 집합만 쓴다. **권장: 둘 다 켠다**(철학 7장 7이 약속한 것. 끄는 조건 (가)·(나)가 있다). 이름은 `Relay-Work`(빚 커밋과 같음).
- **Q8 PR 없이 끝남과 버림.** **권장: 버림은 불일치, PR 없이 [끝내기]는 거울에서 90일 동안 기준에 닿는지 보고 닿지 않으면 불일치**(엄격하되 로컬 머지를 잘못 세지 않음). 둘 다 갈래로 따로 보인다.
- **Q9 preapproved와 다시 녹화.** relay-v2 녹화 도구로 gh `autoMergeRequest`(와 `mergedBy`)를 다시 녹화해 `by:'human-preapproved'`를 가를지, 그리고 그것을 어떻게 셀지. 철학 5장은 이것을 '실제 표본'이라 했지만, 세션이 같은 gh 자격으로 auto-merge를 켤 수 있어(7장) 사람이 켰는지 가를 수 없다. **권장: 다시 녹화한다. 일치 표에는 따로 한 줄로 보이고 M5 기준의 일치에는 넣지 않으며, 머지 뒤 결과에는 넣는다.** 녹화 전에는 human-override로 남는다.
- **Q10 relay-v3 자기 실행(10절).** `quality.json` PR(`auto: [small]`, `ci_checks` 둘, `human_paths`), `main` 보호·필수 검사·최신 대상 맞춤 켜기, 고정 빌드에서 앱 돌리기, M4a 뒤 relay-v3 변경을 앱의 Work로 하기와 예외. **권장: 모두 한다**(이것이 없으면 M4는 relay-v3에서 숫자를 하나도 내지 못한다).
- **Q11 여러 레포 합치기.** 같은 조건 hash의 실적을 레포를 넘어 합쳐 기준에 셀지. **권장: M4에서는 계산해 따로 보이기만, 기준에 쓸지는 M5에서**.
- **Q12 M5 전제에 '지금 관문 판의 재생 거짓 자동 0'을 넣을지.** 넣으면 `small`은 m2 거짓 자동 3 때문에 관문이나 조건을 고치기 전에는 열 수 없다. **권장: 넣는다**(알려진 거짓 자동을 안고 열지 않는다). M5 문장의 'E-auto가 8.4에 걸리지 않을 때'를 M2 handsoff 결과로 어떻게 읽을지도 M5 규약에서 함께 정한다.
- **Q13 M4 평가 규모.** 재생 소급 + (A) + (B)만 / 같은 요청 5회 새 실행(C 새로, 시나리오 6개 × 5 = Work 30, M3 판 단가로 약 6시간과 수백 달러)을 더함. **권장: 앞의 것만**(새 실행 없이 지난 자료의 갈림 셋이 이미 보인다).

## 17. 하지 않는 것

- M4에서 아무 조건도 자동으로 열지 않는다. `auto_merge` 스위치, 서버 보호, `min_shadow`의 뜻은 그대로다.
- 앱이 사용자 레포에 커밋하지 않는다(V20·V40 밖). 사용자 레포의 ref·설정·훅 파일을 바꾸지 않는다(트레일러는 세션 프로세스의 환경에만, 거울은 `$RELAY_HOME`에).
- 앱이 CI를 다시 돌리지 않는다. 앱이 머지 커밋을 자기 확인 실행기로 다시 재는 것(미정을 가르기)도 M4에서는 하지 않는다. 미정은 미정으로 둔다(엄격).
- 사람 교정률을 에이전트에게 목표로 주지 않고, 그것이 준 것을 품질 향상으로 읽지 않는다(원칙 4).
- 'M5까지 몇 건' 진행 막대, 남은 주, 알림, 할 일 줄을 만들지 않는다(6장).
- 일치율만으로 M5를 열지 않는다(lift, 머지 뒤 결과, 재생을 함께 본다).
- 평가 장부(AI 사람 역할)와 재생 실적을 제품 실적에 섞지 않는다.
- 녹화본에 없는 gh·claude 칸을 가짜에 지어내지 않는다.
- '눈으로 본 일치'(사람이 diff를 보고 머지했나)는 재지 않는다. 앱은 GitHub에서 본 것을 알 수 없고, 앱 안의 탭 열기만으로는 이름표의 질을 말하지 못한다. 이름표의 질은 사람과 독립인 둘(재생의 숨긴 시험, 머지 뒤 결과)로 본다.
- 같은 줄의 후속 고침은 만들지 않는다(8.1: 참고로만).
- 팀이나 여러 기계의 장부를 합치지 않는다(장부는 `$RELAY_HOME` 로컬, 덧붙이기만).
- `works.ts`(598줄)와 `works-evidence.ts`(599줄)에 줄을 더하지 않는다. 새 일은 새 파일(`works-record.ts`, `works-session-log.ts`)로 보낸다. 이 둘도 600줄 상한과 장치 줄의 끄는 조건을 똑같이 받는다(8.5: 측정 모듈이 새 WorkRunner가 되지 않게).

## 18. 만든 뒤 고칠 문서

- `docs/m1-modules.md`, `docs/m2-modules.md`: ledger의 자리(먼저), 새 모듈(`engine/track.ts`, `after-merge.ts`, `gate-version.ts`, `stability.ts`, `adapters/mirror.ts`, `git-hooks.ts`, `main/works-record.ts`, `works-session-log.ts`, `cli/record.ts`)의 함수 모양.
- `docs/design.md`: V45 이후 줄(후보: 자리 옮김, 장부 v2와 `met`, 판 열쇠와 관문 판, 끝까지 따라가기와 거울과 같은 변경, 머지 뒤 30일, 세션 커밋 가르기, [실적]과 그림자 줄 가리기, 관문 5회 측정, 재생 실적 자료), 7절 한 줄, 사용자 결정 ✅는 답을 받은 날짜로.
- `docs/devices.md`: 13절의 줄.
- `docs/experiments/m4/`: `protocol.md`(먼저), `dogfood.md`, 결과.
- 이 문서의 상태를 '만듦'으로 바꾸고 절마다 '만든 것'과 '설계와 다른 것'을 m3-design처럼 더한다.

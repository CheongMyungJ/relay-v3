# 품질 바닥 넓히기: 래칫 셋과 여러 언어 초안

- 상태: **설계**(2026-11-07). A(①의 래칫 셋: 억누름, 중복, 바뀐 줄 커버리지)는 **만듦**(2026-11-07, [design.md](design.md) V55~V59). B(5절: 여러 언어 초안, 드라이런, 묻는 화면)도 **만듦**(2026-11-07, V60~V63). 실제 레포 시범(정적·드라이런, [experiments/quality-floor-pilot/report.md](experiments/quality-floor-pilot/report.md))은 했고 그 찾은 문제 1·2·3·6을 고쳤다(2026-11-08, V64~V68). 30개로 다시 잰 시범의 새 문제 7~12를 고치고 끄는 조건의 분모에서 환경 탓을 뺐다(2026-11-08, V69~V73). 나머지(6절의 [설정] 안내, 장기 평가)는 만들기 전이다. 만든 절에는 '만든 것'과 '설계와 다른 것'을 더한다.
- 근거: [philosophy.md](philosophy.md) 원칙 3(품질의 바닥은 레포에 산다), [v2-evidence.md](v2-evidence.md)(v2에는 품질 래칫, 커버리지, 복잡도, 아키텍처 규칙을 기계로 보는 층이 없었다), [design.md](design.md) V9·V19·V20(품질 기준, 초안), M3 장기 평가([experiments/m3/report.md](experiments/m3/report.md): 구조 지표가 바닥·천장에 붙어 차이가 보이지 않음).
- 이 글은 relay에 품질 장치가 하나도 없다고 놓고 처음부터 적는다. 지금 relay-v3에 있는 것과 새로 만들 것을 표시한다.

## 1. 왜 넣나

AI 세션이 Work를 거듭하면 품질이 두 가지로 무너진다.

1. **검사를 통과하려고 검사를 약하게 만든다.** 실패하는 시험을 건너뛰거나 지우고, `@ts-ignore`, `# noqa`로 경고를 덮는다. 세션은 '다 됐다'고 하고 검사도 지난다. 사람이 diff를 꼼꼼히 보지 않으면 모른다.
2. **구조가 천천히 나빠진다.** Work 하나만 보면 문제없다. 파일이 조금 커지고, 비슷한 코드가 하나 더 생기고, 경계를 한 번 넘는다. 30번 쌓이면 손대기 어려운 코드가 된다(relay-v2의 핵심 파일이 7,834줄까지 자랐다).

Work마다 사람이나 리뷰어가 diff를 보는 것으로는 둘 다 잘 못 잡는다. 1은 그럴듯해 보이고, 2는 diff 한 번에 보이지 않는다. 그래서 앱이 **숫자로 재고, 그 숫자가 나빠지지 않게만** 지킨다(래칫). '좋아져라'가 아니라 '나빠지지 마라'라서 어떤 프로젝트에 붙여도 과거를 먼저 고칠 필요가 없다.

## 2. 무엇을 넣나 (세 겹)

| 겹 | 장치 | 잡는 것 | 언어 | 지금 |
|---|---|---|---|---|
| ① 앱이 직접 잼 | 파일 줄 수 래칫 | 파일 비대 | 무관 | 있음 |
| | 시험 수 래칫 | 시험 지우기 | 무관(JUnit XML) | 있음 |
| | **억누름 래칫** | `@ts-ignore`, `# noqa`, `//nolint`, `@SuppressWarnings`, 건너뛴 시험 | 언어별 무늬표를 앱이 가짐 | 새로 |
| | **중복 코드 래칫** | 복사-붙여넣기 | 토큰 창 비교라 무관 | 새로 |
| | **바뀐 줄 커버리지** | 새 코드를 시험이 안 덮음 | 표준 보고서(lcov, Cobertura, JaCoCo)를 읽음 | 새로 |
| ② 레포가 고르는 명령 | 복잡도, 순환 의존, 취약점 수 | 구조·의존성의 나빠짐 | 언어마다 도구가 다름 | 틀은 있음(`kind: "command"`) |
| ③ 사람이 정하는 규칙 | 아키텍처 규칙('ui는 db를 직접 부르지 않는다') | 경계 넘기 | 내용이 프로젝트마다 다름 | 틀은 있음(`rules`) |

①은 relay를 쓰는 모든 프로젝트가 설정 없이 받는 몫이고, ②·③은 레포마다 고르는 몫이다.

**만든 것 (A).** ①의 새 셋을 `.relay/quality.json`의 래칫 종류로 만들었다: `{ "kind": "suppressions" }`(V55), `{ "kind": "duplication" }`(V56), `{ "kind": "diff_coverage", "report", "format": "lcov" | "cobertura" | "jacoco", "min" }`(V57). 셋 다 선택 `include`·`exclude` glob을 받는다. 레포의 도구는 쓰지 않는다(커버리지만 레포의 수용 시험이 쓴 보고서를 읽는다).

**설계와 다른 것.** '설정 없이 받는 몫'은 아직 아니다: 레포가 quality.json에 그 래칫을 적어야 켜진다. 초안(V19)에 넣는 것은 5절의 여러 언어 초안과 함께 정한다(V58).

**만든 것 (B).** 초안(`relay init`, [초안 만들기])이 `suppressions`·`duplication`을 늘 넣고 `diff_coverage`는 수용 시험이 앱이 읽을 보고서를 쓸 때만 넣는다(V63, V60). 그래도 켜는 곳은 레포의 quality.json이다: 사람이 초안을 커밋해야 쓰이고 지울 수 있다.

## 3. 앱에 어떻게 넣나 (부품)

```
레포                                   앱
.relay/quality.json  ──읽음──▶  ① 확인 실행기: 명령을 깨끗한 폴더에서 돌림
(무엇을 잴지, 사람만 고침)         ② 래칫 비교: 기준 커밋 값 vs 결과 커밋 값
.relay/debt/         ◀──씀───  ③ 증거 묶음 → 관문 → [증거] 화면
                                  ④ 초안 만들기: 레포를 훑어 quality.json 제안
```

1. **`.relay/quality.json`(있음).** 레포마다 하나. 설치, 빠른 검사, 시험, 래칫, 규칙, 자동 조건. 지킴 파일이라 세션이 기준을 느슨하게 하면 늘 사람에게 간다.
2. **확인 실행기(있음).** 적힌 명령을 Work 시작 전 커밋과 끝 커밋에 각각 돌리고 커밋마다 캐시한다.
3. **래칫 비교(있음).** 두 값을 견줘 같음·좋아짐·나빠짐. 종류는 파일 줄 수, 시험 수, 숫자를 찍는 아무 명령.
4. **새로 만들 것:**
   - 래칫 종류 셋: `suppressions`, `duplication`, `diff_coverage`. 도구 없이 앱이 직접 센다(커버리지는 레포의 시험이 쓴 표준 보고서를 읽는다).
   - 초안 만들기를 여러 언어로 넓힌다(지금은 `package.json`이 있는 JS만 채운다).
   - 초안의 드라이런과, 사람에게 몇 가지만 묻는 화면.
   - 장치 등록부에 장치마다 가정과 끄는 조건.

**만든 것 (A).** 4의 첫째(래칫 종류 셋)와 넷째(장치 등록부의 세 줄)를 만들었다. 부품: 셈은 engine의 순수 함수(`languages.ts` 언어 표와 범위, `suppressions.ts` 무늬표, `duplication.ts` 토큰 창, `coverage.ts` 보고서 읽기와 교집합. src/core 상한 때문에 engine), 재기는 `engine/ratchets.ts`(check.ts에서 옮김), git 읽기는 adapters `grepLines`·`readBlobs`, 더한 줄의 줄 번호는 core diff의 `added_at`. 관문은 바꾸지 않았다: 나빠짐은 '래칫 나빠짐', 잴 수 없음은 '래칫을 재지 못함'으로 늘 그랬듯 사람 머지다. 관문 판은 2로 올렸고 재생 결론이 같아 실적을 이어 센다(V59).

**만든 것 (B).** 4의 둘째·셋째(여러 언어 초안, 드라이런과 묻는 화면)를 만들었다(V60~V62). 부품: 레시피는 engine `recipes.ts`(언어 단위와 단위마다의 설치·빠른 검사·수용 시험·커버리지·명령 래칫·제안. JS는 core `draftQuality` 그대로), 합치기·묻는 것·답은 `draft.ts`, 드라이런은 `dry-run.ts`(확인 실행기의 `prepareCheckout`·`runIn`·worktree 잠금을 그대로), 훑기·쓰기·요약은 `init.ts`. 셋 모두 순수 셈은 engine이다(src/core 4,932줄 그대로). 앱은 `draftQuality`(짜서 돌려 봄) → 초안 화면(`DraftDialog.tsx`) → `writeQualityDraft`(답을 넣어 씀), CLI는 `relay init --try`·`--write`. 관문 파일은 바꾸지 않아 관문 판은 2 그대로다.

## 4. 어떻게 실행되나 (Work 하나)

1. 사람이 요청을 쓰고 세션과 계약을 맞춘다.
2. 세션이 구현한다.
3. 세션이 멈추거나 [끝내기]를 누르면 앱이 `quality.json`대로 두 커밋에서 잰다. 예: 기준 억누름 312, 결과 **313**. 바뀐 줄 커버리지 **58%**. 중복 2.1% 그대로.
4. [증거]에 '래칫 나빠짐: 억누름 312 → 313 (`src/api.ts:41` `@ts-ignore`)'이 뜬다.
5. 앱이 그 사실을 쉬는 세션에 되먹임으로 보낸다(V24). 세션이 고치면 다시 잰다.
6. 고치지 않은 채 사람이 머지하면 '빚으로 남길까요?'를 한 번 묻는다(V40). 남기면 `.relay/debt/`에 기록되고, 다음 Work가 그 파일을 건드리면 계약 초안에 '같이 갚을 거리'로 뜬다(V41).
7. 래칫이 나빠진 Work는 자동 머지 후보가 되지 않는다(자동 머지를 켰을 때만 뜻이 있다).

막지 않는다. 사람이 보고 정한다. 앱은 '몰래 나빠지는 것'만 없앤다.

**만든 것 (A).** 3~6은 새 래칫에도 그대로 이어진다. [흐름] `test/flow/works-floor.test.ts`: 세션이 `// @ts-ignore`를 더한 Work에서 [증거]의 `억누름 0 → 1: src/calc.js:8 @ts-ignore`, 관문의 '래칫 나빠짐', 쉬는 세션에 간 되먹임(`- src/calc.js:8 @ts-ignore`), [빚으로 남기고 머지]의 `r-suppressions-src-calc-js`(그 파일에 단 빚)까지. 7(자동 머지 후보가 되지 않음)은 관문이 나빠짐을 사람 머지의 사실로 보는 것 그대로다.

**설계와 다른 것.** 3의 예 '바뀐 줄 커버리지 58%'는 그대로지만 나빠짐의 기준은 기준 커밋이 아니라 사람이 정한 바닥 `min`이다(V57: 기준에는 더한 줄이 없다). 보고서가 없으면 '잴 수 없음'이고 사람 머지로 간다(V5의 엄격한 쪽).

## 5. 처음 등록할 때 앱이 채워 주는 법

### 5.1 흐름

1. **등록.** 사람이 레포를 relay 프로젝트로 연다. 앱은 기본 브랜치에서 `.relay/quality.json`을 찾고, 없으면 '품질 기준이 없어 앱이 결과를 잴 수 없습니다. 초안을 만들까요?'라고 알린다(V20).
2. **훑기.** 매니페스트(`package.json`, `pyproject.toml`, `go.mod`, `pom.xml`, `build.gradle(.kts)`, `Cargo.toml`), 잠금 파일, CI 설정(`.github/workflows`), 이미 있는 lint·형식 설정, 시험 폴더를 읽는다.
3. **언어별 레시피로 명령을 고른다**(5.2). 레포에 이미 있는 도구만 쓴다. 도구를 몰래 설치하지 않는다.
4. **한 번 돌려 본다(드라이런).** 고른 명령을 지금 커밋에서 돌린다. 되는 명령은 현재 값과 함께 보인다(예: 억누름 312, 시험 1,204, 600줄 넘는 파일 3). 실패하는 명령은 까닭과 함께 '고칠 것'으로 표시하고 기본에서 뺀다.
5. **물을 것만 묻는다(셋 안팎).** 늘 사람이 볼 경로(예: `migrations/`, `auth/`), 지킬 경계(폴더 구조로 후보를 낸다, 예: `ui/ → db/` 금지), CI 필수 검사 이름.
6. **초안을 작업 트리에 쓴다.** 앱은 커밋하지 않는다. 사람이 읽고 고쳐 커밋한다. 그때부터 그 값이 그 레포의 바닥이다.
7. **빠진 도구는 제안만.** 예: '복잡도 래칫을 쓰려면 `radon`을 dev 의존성에 더하는 Work를 만들 수 있습니다.' 원하면 그것이 첫 Work가 된다.

### 5.2 언어별 레시피 (앱이 고르는 것의 예)

| 언어 | 설치 | 빠른 검사 | 시험(JUnit) | 커버리지 | ②의 명령 래칫 후보 | 억누름 무늬(①) |
|---|---|---|---|---|---|---|
| JS/TS | 잠금 파일대로(`npm ci` 등) | `tsc`, `eslint` | vitest·jest junit 출력 | lcov | 순환 의존(madge), 취약점(`npm audit`) | `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `.skip(` |
| Python | `uv sync`, `poetry install`, `pip install -r` | `ruff`, `mypy`/`pyright` | `pytest --junitxml` | coverage.py → Cobertura | 복잡도(ruff C901, radon), 의존 경계(import-linter), 취약점(pip-audit) | `# noqa`, `# type: ignore`, `@pytest.mark.skip` |
| Go | `go mod download` | `go vet`, `golangci-lint` | `gotestsum --junitfile` | `-coverprofile` | 취약점(govulncheck) | `//nolint`, `t.Skip(` |
| Java/Kotlin | Gradle·Maven | 컴파일, ktlint·checkstyle | 기본이 JUnit XML | JaCoCo | 아키텍처(ArchUnit), 취약점 | `@SuppressWarnings`, `@Disabled`, `@Ignore` |
| Rust | `cargo fetch` | `cargo clippy` | `cargo nextest`(JUnit) | cargo-llvm-cov → lcov | 취약점(cargo-audit) | `#[allow(`, `#[ignore]` |

여러 언어가 섞인 레포는 언어마다 명령을 그 폴더에서 돌리게 적는다. ①은 레포 전체에 한 번 센다.

**만든 것 (B).** 5.1의 2~7과 5.2의 표를 만들었다([design.md](design.md) V60~V63).

- 훑기(2): `git ls-files`(무시하지 않는 새 파일 포함)와 매니페스트(깊이 둘까지의 폴더), 잠금 파일, 도구 설정(`.golangci.*`, `rustfmt.toml`, `clippy.toml`, `.config/nextest.toml`, pom·Gradle 플러그인), `.github/workflows/*.yml`(작업 이름, clippy를 쓰는지)을 읽는다.
- 레시피(3): 위 표에서 레포의 매니페스트·설정에 있는 도구만 고른다. 빠진 도구는 제안 글(예: 'radon을 dev 의존성에 더하면 복잡도 래칫을 쓸 수 있습니다')로만 낸다. 여러 언어는 `cd <폴더> && …`, setup은 이어 붙이고 명령 id에 단위 이름을 붙인다. 수용 시험은 하나라 소스가 가장 많은 단위가 맡고 나머지 단위의 시험은 빠른 검사다.
- 드라이런(4): 지금 커밋에서 setup과 명령을 확인 실행기의 head check worktree에서 한 번씩 돌리고 명령마다 됨·안 됨과 까닭, 래칫마다 지금 값을 낸다. 안 된 명령은 초안에서 빼고 결과의 '고칠 것'에 둔다(quality.json은 모르는 칸을 받지 않아 파일에 주석으로 남길 수 없다).
- 묻기(5): 셋까지. 늘 볼 경로(늘), 경계(위층·아래층 폴더가 함께 있을 때), CI 필수 검사(워크플로가 있을 때). 기본으로 고른 답은 없다.
- 쓰기(6): 작업 트리에만 쓰고 커밋하지 않는다(V20 그대로). 이미 있으면 덮지 않는다.
- 이 레포에서 `relay init --try`: JS, setup·typecheck·lint·수용 시험 모두 됨, 시험 1848, 600줄 넘는 파일 6(기록·문서), 억누름 5, 중복 4.7%, 묻는 것 둘(늘 볼 경로, CI 검사 `check`), 제안 하나(`@vitest/coverage-v8`).

**설계와 다른 것.**

- 경계(5)는 `rules`가 아니라 command 래칫이다(`boundary-<앞>-<뒤>`: 앞 폴더에서 뒤 폴더 이름을 가져오는 줄 수, `git grep … | wc -l`, 낮을수록 좋음). `rules`는 승격된 검사의 이름(V42)이라 경계를 잴 수 없고, 래칫이면 지금 넘는 곳을 먼저 고치라고 하지 않는다. 5.3의 `"rules": [{ "id": "layers", "run": "uv run lint-imports" }]`는 지금 모양이 아니어서 import-linter가 있으면 빠른 검사 `imports`로 넣는다.
- ②의 명령 래칫 후보 가운데 만든 것은 Python의 radon 복잡도(`radon cc -n C -i .venv . | awk …`로 C 이상 블록 수)뿐이다. 순환 의존(madge), 취약점(npm audit, pip-audit, govulncheck, cargo-audit), ArchUnit은 넣지 않았다(govulncheck만 제안 글).
- 커버리지: Go의 `-coverprofile`은 앱이 읽는 형식이 아니라 넣지 않는다. Rust의 cargo-llvm-cov는 매니페스트에 적히지 않는 도구라 제안만. JS는 vitest에 커버리지 제공자가 있을 때만(node:test의 커버리지는 실험 플래그라 넣지 않음). Maven은 여러 모듈이면, Gradle은 XML 보고서가 꺼져 있으면 넣지 않는다.
- Java·Kotlin의 시험 결과는 클래스마다 파일이라 수용 시험 명령 끝에 셸 조각으로 하나의 JUnit(`.relay-out/junit.xml`)에 묶는다(앱의 JUnit 읽기는 파일 하나). Maven·Gradle에는 setup을 두지 않는다(의존성은 컴파일 명령이 받는다).
- 빠른 검사의 엄격함: Rust는 엄격한 clippy 표시가 있을 때만 `-D warnings`, 아니면 `cargo check`(경고만으로 빠진 초안을 줄이려고).
- 5.3의 예와 다른 칸: mypy 대상은 `src/`가 있으면 `src`, 아니면 `.`. pytest-cov가 있으면 수용 시험이 `--cov=. --cov-report=xml:.relay-out/coverage.xml`을 쓰고 `diff_coverage`(Cobertura, min 0.8)를 넣는다.

**만든 것 (시범 뒤 고침, V64~V67).** 시범(9개 레포)의 찾은 문제를 고쳤다.

- JS의 이어 붙인 test 스크립트(문제 1, V64): `pnpm lint && vitest run --typecheck`처럼 `&&`로 이은 스크립트는 러너 마디 하나만 JUnit 출력으로 수용 시험에 쓰고(`pnpm vitest run --typecheck --reporter=junit …`. 스크립트가 쓴 패키지 관리자 꼴 그대로, 맨 러너는 레포의 꼴), 이미 빠른 검사인 마디(lint)는 빼고, 나머지는 빠른 검사, 러너 앞의 build류는 수용 시험 앞에 잇는다. core 초안(`draftQuality`)은 바꾸지 않고 engine recipes.ts가 한다.
- Go(문제 2, V65): gotestsum이 없어도 수용 시험 `go test -json ./... > .relay-out/go-test.json`을 넣고 앱이 그 출력을 직접 읽는다(engine `test-report.ts`). quality.json의 명령에 선택 칸 `test_format: "go-test-json"`을 더했다(없으면 JUnit, 옛 파일은 그대로). 위 5.2 표의 Go '시험' 칸은 이제 'gotestsum이 tool이면 JUnit, 아니면 go test -json'이다.
- 초안의 줄 수 래칫(문제 6, V66): 소스 파일(언어 표의 확장자와 css·vue 같은 화면 소스)만 본다. CHANGELOG, 시험 자료 JSON, 잠금 파일은 빠진다. 래칫의 기본은 그대로라 옛 quality.json은 같다.
- 중복(문제 3, V67)은 2절 아래 '만든 것'이 아니라 [design.md](design.md) V67: 한 파일 안의 표 같은 반복을 세지 않는다. Rust의 `fuzz/`(문제 5)는 늘 빼는 곳에 더하지 않았다(그 쌍이 모두 표 같은 반복이었다).
- 문제 4(기계에 없는 golangci-lint)는 고치지 않았다: 드라이런이 빼는 설계 그대로이고 시범 기계에는 있었다.

**만든 것 (30개 시범 뒤 고침, V69~V72).** 다시 잰 시범(레포 30개)의 새 문제 7~12를 고쳤다.

- Python(문제 7·8, V69): 도구(pytest, pytest-cov, ruff·flake8, mypy·pyright, import-linter, radon)는 setup이 실제로 까는 묶음에 있을 때만 쓴다. pyproject의 extra·PEP 735 묶음·poetry group·uv 기본 묶음을 읽어(engine `python-deps.ts`, 작은 TOML 읽개 `toml-lite.ts`) 늘 까는 것에 없는 도구가 든 묶음을 setup에 더한다(uv `--extra`·`--group`, poetry `-E`·`--with`, pip `-e '.[x]'`·`--group`). pip의 `--group`은 pip 25.1부터라 venv의 pip을 먼저 올린다(`pip install 'pip>=25.1'`). 어디에도 깔 길이 없는 도구는 빼고 제안한다. 이름이 좁은 쓰임(mypy, typing, lint, docs, tools 등)인 requirements는 설치 본으로 고르지 않는다. `--cov`는 pytest-cov를 깔 때만. 위 5.2 표의 Python '설치' 칸은 이제 'uv sync(·--extra·--group), poetry install(·-E·--with), pip install -r 설치 본 requirements -e .[extra] --group 묶음'이다.
- Go(문제 9, V70): go.mod 없는 옛 Go 레포는 Go로 알아보지만 명령은 넣지 않는다(`GO111MODULE=off`는 GOPATH 밖에서 레포 자신의 가져오기 경로를 찾지 못한다. `go mod init`은 레포를 바꿔 제안 글).
- Java(문제 10, V70): 여러 모듈 Maven의 빠른 검사는 `-DskipTests verify`, 수용 시험은 `verify`(install은 ~/.m2에 SNAPSHOT을 써서 쓰지 않는다).
- Kotlin(문제 11, V70): 멀티플랫폼(Gradle 판 목록의 별칭까지 읽음)은 `jvmTestClasses`·`jvmTest`와 `build/test-results/jvmTest`. JVM 하위 프로젝트가 함께 있으면 두 작업 모두.
- Rust(문제 12, V71): nextest가 없으면 수용 시험 `cargo test --no-fail-fast > .relay-out/cargo-test.txt`(`test_format: 'cargo-test'`)를 앱이 읽어(engine test-report.ts `parseCargoTest`) 시험 수 래칫이 든다. 위 5.2 표의 Rust '시험' 칸은 'nextest의 JUnit profile이면 JUnit, 아니면 cargo test 출력'이다.
- 드라이런(V72): 안 된 명령의 출력이 뚜렷한 환경 탓의 무늬(플러그인 저장소, JDK 판, 네트워크, Gradle 받기 실패, 도구 판)면 요약에 `[환경 탓으로 보임: …]`과 '가름' 줄을 찍는다. 8절 끄는 조건의 분모에서 환경 탓을 뺀다.

### 5.3 Python 초안의 예

```json
{
  "setup": { "run": "uv sync", "inputs": ["uv.lock"] },
  "commands": {
    "fast": [{ "id": "lint", "run": "uv run ruff check ." }, { "id": "types", "run": "uv run mypy src" }],
    "acceptance": { "id": "test", "run": "uv run pytest --junitxml=.relay-out/junit.xml", "junit": ".relay-out/junit.xml" }
  },
  "human_paths": ["migrations/**"],
  "ratchets": [
    { "id": "tests", "kind": "test_count" },
    { "id": "file-size", "kind": "file_lines", "max": 600 },
    { "id": "suppressions", "kind": "suppressions" },
    { "id": "duplication", "kind": "duplication" },
    { "id": "complexity", "kind": "command", "run": "uv run radon cc -s -n C src | wc -l", "better": "lower" }
  ],
  "rules": [{ "id": "layers", "run": "uv run lint-imports" }]
}
```

## 6. 개발하는 동안의 안내

- 새로 쓸 수 있는 래칫이 생기거나 레포에 도구가 새로 들어오면 [설정]에 '새로 쓸 수 있는 래칫'으로 보인다. 더하는 것은 사람이 PR로 한다.
- 나빠짐은 Work마다 [증거]와 빚 장부로 남는다. 같은 래칫이 자주 나빠지면 '이 경계를 규칙으로 만들까요?'(규칙 승격, V42).
- 오래된 레포도 처음 값이 곧 바닥이다. 줄여 나가는 것은 곁들일 정리로 조금씩.

## 7. 어떻게 시험하나

CLAUDE.md의 층대로, 한 동작은 가장 낮은 층에서 한 번만 자세히 본다.

| 층 | 무엇을 보나 |
|---|---|
| [단위] `test/unit/` | 억누름 무늬표(확장자마다 센 수, 빼는 경로, 문자열 안의 무늬), 중복의 토큰 창(이름만 바꾼 복사, 짧은 줄 무시), 커버리지 보고서 읽기(lcov, Cobertura, JaCoCo)와 바뀐 줄과의 교집합, 새 래칫 종류의 비교(같음·좋아짐·나빠짐, 새 파일, 보고서 없음은 '잴 수 없음'), 언어별 초안(매니페스트 묶음마다 기대한 quality.json), 품질 기준 읽기의 새 칸 검증 |
| [어댑터] `test/adapters/` | 실제 git 레포의 기준·결과 커밋에서 억누름과 중복을 셈, 시험 명령이 쓴 커버리지 파일을 실행 폴더에서 읽음, 드라이런이 임시 폴더에서 명령을 돌리고 실패를 까닭과 함께 냄 |
| [흐름] `test/flow/` | 세션이 `@ts-ignore`를 더한 Work: [증거]에 래칫 나빠짐 → 되먹임 → 빚 확인. Python·Go 레포 고정 자료로 [초안 만들기] → 드라이런 값 → 작업 트리의 초안. 옛 quality.json(새 칸 없음)은 동작이 그대로 |
| [스모크] `test/smoke/` | [초안 만들기] 화면(현재 값, 고칠 것, 묻는 것), [증거]의 새 래칫 줄. 찍은 그림을 열어 본다 |
| 관문 재생 | `npm run test:replay`가 그대로 지나야 한다(옛 묶음에는 새 래칫이 없다). 관문 파일이 바뀌면 `GATE_VERSION`을 올리거나, 재생 결론이 같음을 보이고 이어 센다(V47, `gate-version.test.ts`) |
| 실제 레포 시범 | 언어마다 작은 공개 레포 하나씩(JS, Python, Go, Java, Rust)에 [초안 만들기]와 `relay check`를 돌린다. 볼 것: 초안이 바로 도는가, 드라이런 시간, 억누름·중복의 거짓 양성(벤더 코드, 생성된 파일, 시험 고정 자료). 결과는 `docs/experiments/` 아래 기록 |
| 장기 평가 | 효과(끄는 조건)는 구조가 실제로 무너지는 판에서만 잴 수 있다: 30 Work 이상, 래칫이 잡을 미끼(억누름으로 통과시키기 쉬운 요청, 복사하기 쉬운 코드), 구조에 기대는 봉인 과제. 새 래칫 켬 대 끔. M3 판(3천 줄, 15 Work)으로는 부족했다 |

**만든 것 (A).** [단위] `suppressions.test.ts`(확장자마다 표식, 그 언어에서만, 빼는 경로, 한 줄 글 안의 표식은 세지 않음·주석 속 따옴표, 기준과 견줌: 같음·나아짐·나빠짐·새 파일·옮긴 파일), `duplication.test.ts`(토큰, 이름만 바꾼 복사, 짧은 복사와 `}`만 있는 줄, import 묶음, 결정론, ε), `coverage.test.ts`(lcov·Cobertura·JaCoCo, 경로 맞추기, 더한 줄과의 교집합, 바닥 위·아래, 새 파일, 보고서에 없는 파일, 잴 수 없음), `quality.test.ts`(새 칸 검증), `diff.test.ts`(`added_at`), `review-feedback.test.ts`(where). [어댑터] `ratchets.test.ts`(실제 git의 기준·결과 커밋에서 억누름·중복, 수용 시험 명령이 check worktree에 쓴 lcov). [흐름] `works-floor.test.ts`(위 4절). 옛 quality.json의 동작은 옛 흐름 시험과 관문 재생이 그대로 지나는 것으로 본다.

**설계와 다른 것.** [스모크]의 '[증거]의 새 래칫 줄' 그림은 찍지 않았다: 렌더러 코드를 바꾸지 않았고 래칫 줄은 종류와 상관없이 상태·id·detail로 그려진다(V58). 실제 레포 시범과 장기 평가는 하지 않았다.

**만든 것 (B).** [단위] `draft-recipes.test.ts`(매니페스트 묶음마다의 초안: JS는 core 초안 그대로에 래칫 둘(칸 차례까지), vitest 커버리지, bun / Python uv·poetry·pip·PEP 621, 의존성 이름 찾기 / Go(tool 지시문) / Java Maven·Gradle, Kotlin(ktlint, jacoco XML), JUnit 묶기 / Rust(clippy 표시, nextest profile) / 섞인 레포(폴더마다 cd, setup 잇기, 수용 시험 고르기, 단위 폴더 고르기) / 묻는 것의 후보, 워크플로 작업 이름, 답 넣기와 깨진 답, 경계 무늬). [어댑터] `draft-dry-run.test.ts`: 이 기계에서 실제 go(1.24)·python3(3.13, venv와 pip로 PyPI에서 pytest·pytest-cov)·cargo로 작은 레포마다 드라이런을 돌렸다(Go: setup·`go test` 됨, `go vet`은 unreachable code로 고칠 것, 억누름 `//nolint` 1 / Python: JUnit과 coverage.py의 Cobertura를 앱이 읽음 / Rust: `cargo check`·`cargo test` 됨 / 커밋 없는 레포). 도구가 없거나 PyPI에 닿지 못하면 그 시험은 까닭을 이름에 적고 건너뛴다. Java(Maven·Gradle)는 의존성을 받아야 해서 [어댑터]에 넣지 않았다. [흐름] `works-draft.test.ts`(Python(uv) 레포: [초안 만들기] → 요약(됨·안 됨, 지금 값, 고칠 것 lint, 묻는 것 셋) → [초안 쓰기](답이 들어가고 lint가 빠짐, 작업 트리에만), 가짜 uv `test/support/fake-uv`), `cli.test.ts`(`relay init --try`·`--write`·`--no-try`·답). [스모크] `draft.spec.ts`(초안 화면: `smoke-draft-01-dialog.png`, `-02-answers.png`, `-03-written.png`를 열어 봄), `app.spec.ts`(둘째 프로젝트는 초안 화면을 거쳐 쓴다). 관문 파일은 바꾸지 않았다(`gate-version.test.ts`, `npm run test:replay` 그대로).

**만든 것 (시범 뒤 고침).** [단위] `draft-js-split.test.ts`(defu·ufo의 package.json 모양 그대로, 나누기와 나누지 않음, 주 단위가 아닐 때), `draft-recipes.test.ts`(Go: pflag·uuid 모양에 go test -json 수용 시험, 줄 수 래칫의 소스 범위), `test-report.test.ts`(이 기계의 go 1.24가 낸 `go test -json` 출력 두 벌: 통과·실패·건너뜀·하위 시험·시험 없는 패키지·빌드 실패, 시간 초과), `quality.test.ts`(`test_format`), `duplication.test.ts`(itoa `fuzz_itoa.rs`의 match 팔 12줄, markupsafe의 split·rsplit·splitlines와 번갈아 이어진 위임 메서드는 쌍이 아님, 표를 다른 파일에 복사하면 한 쌍, 바로 아래 복사와 셋이 이어진 함수는 셈). [어댑터] `draft-dry-run.test.ts`의 Go: 실제 go로 `go test -json` 수용 시험이 되고 시험 3을 읽는다. 관문 판 3(V68, 재생 digest 같음, epoch 1을 이음).

**만든 것 (30개 시범 뒤 고침).** [단위] `draft-pilot30.test.ts`(시범 레포의 매니페스트 그대로 `test/fixtures/draft-repos/`: tenacity의 `--group dev`와 [tool.mypy] files, humanize의 `-e '.[tests]'`와 requirements-mypy.txt 제안, itsdangerous의 uv 기본 묶음, uv·poetry의 묶음 플래그, 묶음 고르기, 좁은 requirements 가르기와 `-r`, pkg/errors의 'Go (go.mod 없음)', gson의 verify, turbine·kotlinpoet의 jvmTest, 플러그인·판 목록 읽기, TOML 읽개, 환경 탓 무늬와 요약의 가름 줄), `test-report.test.ts`(이 기계의 cargo 1.99가 낸 출력 네 벌), `quality.test.ts`(`cargo-test`), `draft-recipes.test.ts`(Rust의 수용 시험). [어댑터] `draft-dry-run.test.ts`: 실제 pip(venv)으로 PEP 735 dev 묶음을 `--group`으로 깔아 ruff·pytest가 돎, 실제 cargo로 cargo test 출력의 시험 4(통합 시험·doc 시험·ignored), 환경 탓 무늬로 끝난 명령의 표시. 관문 판 4(V73, 재생 digest 같음, epoch 1을 이음).

**설계와 다른 것 (B).** [흐름]의 Go 레포 고정 자료는 따로 두지 않았다: Go 레시피는 [단위]가, Go 드라이런은 [어댑터]가 실제 go로 보고, [흐름]은 이어지는 것(앱의 두 단계와 작업 트리)을 Python 하나로 본다.

## 8. 끄는 조건 (devices.md에 올릴 것, 안)

| 장치 | 가정 | 끄는 조건(안) | 최소 n |
|---|---|---|---|
| 억누름 래칫 | 세션이 경고를 덮어 통과하는 일을 드러내면 사람이 고치게 한다 | 나빠짐이 뜬 Work의 절반 넘게를 사람이 고치지 않고 머지하면 알림만 남기고 래칫에서 뺀다. 거짓 양성(사람이 '틀린 셈'으로 표시)이 20%를 넘으면 무늬표를 좁힌다 | 나빠짐 Work 30 |
| 중복 래칫 | 복사-붙여넣기가 쌓이는 것을 드러낸다 | 위와 같음. 장기 평가에서 켬·끔의 중복 지표가 δ 안이면 기본에서 뺀다 | 나빠짐 Work 30 |
| 바뀐 줄 커버리지 | 새 코드가 시험 없이 들어오는 것을 드러낸다 | 보고서가 없어 '잴 수 없음'이 Work의 절반을 넘으면 초안에서 기본으로 넣지 않는다. 나빠짐을 그대로 머지한 Work의 숨긴 시험 통과가 고친 Work와 δ 안이면 알림으로 내린다 | 잰 Work 30 |
| 여러 언어 초안 | 레포를 훑어 고른 명령이 대개 바로 돈다 | 드라이런에서 고친 것 없이 도는 초안이 절반 아래면 그 언어의 레시피를 '제안만'으로 내린다 | 언어마다 레포 5 |

**만든 것 (A).** 위 셋을 [devices.md](devices.md)에 올렸다(억누름 래칫, 중복 래칫, 바뀐 줄 커버리지). 지표에 '거짓 양성(사람이 틀린 셈으로 표시)'을 두었지만 표시할 자리(화면의 [틀린 셈])는 아직 없어 손으로 센다. 바뀐 줄 커버리지에는 '보고서에 없어 세지 않은 파일 수'를 지표로 더했다(V57의 낙관 쪽 선택을 지켜보려고).

**만든 것 (끄는 조건 고침, V72).** 사용자 결정(2026-11-08 ✅)으로 '여러 언어 초안'의 분모에서 환경 탓(이 기계의 네트워크, JDK·Gradle·도구 판)으로만 안 된 레포를 뺀다. 드라이런이 뚜렷한 환경 탓을 출력의 무늬로 표시하고, 무늬 없는 것과 relay·레포의 가름은 사람이 시범 기록에 적는다.

**만든 것 (B).** '여러 언어 초안'을 [devices.md](devices.md)에 올렸다(끄는 조건은 위 표 그대로에 '사람이 쓴 뒤 같은 칸을 절반 넘게 고치면 그 칸의 레시피를 고친다'를 더함). 초안 결과는 장부에 남기지 않아 지표는 지금 손으로 센다. 억누름·중복 래칫의 상태 칸에 '초안이 늘 넣는다(V63)'를 더했다.

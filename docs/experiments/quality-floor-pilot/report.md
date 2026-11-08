# 품질 바닥 시범: 공개 레포 9개 (정적)

2026-11-07. [quality-floor.md](../../quality-floor.md) 7절의 '실제 레포 시범'. relay-v3 `c43cc3e`(main).

## 한 줄 요약

**초안은 9개 가운데 8개가 고친 것 없이 바로 돌았고(남은 하나는 이 환경의 네트워크 탓), 억누름 셈은 204개 가운데 잘못 센 것이 0이었다. 다만 JS의 합친 test 스크립트와 Go에서 시험 수 래칫이 빠지고, 중복 래칫은 표처럼 반복되는 코드를 크게 세며, 파일 줄 수 래칫이 시험 자료(JSON)와 CHANGELOG까지 센다.**

## 무엇을 했나

- 레포 9개(JS 2, Python 2, Go 2, Rust 1, Java 1, Kotlin 1)를 `git clone --depth 1`로 받았다.
- 레포의 코드를 하나도 돌리지 않는 것만 했다.
  - 초안: `draftFor`(파일 목록과 매니페스트만 읽음).
  - 억누름·중복: 앱이 git 객체를 읽어 셈(래칫이 실제로 쓰는 함수 그대로: `grepLines` → `suppressionsInLine`, `lsTree`·`readBlobs` → `scoped` → `duplication`).
  - 억누름의 나빠짐: itsdangerous에 임시 커밋으로 `# noqa` 한 줄을 더해 `suppressionsRatchet`이 `worse 11 → 12`를 내는지 봤다(냈다. 커밋은 지움). 이 확인에서 새 표식의 자리(`where`)가 빈 것은 시범 스크립트가 diff를 잘못 넘긴 탓이다. 앱의 흐름 시험(`works-floor.test.ts`)은 자리를 보인다.
- 억누름 표식은 모두 손으로 읽었고, 중복 쌍은 레포마다 앞의 최대 15개를 읽었다.

### 드라이런 (사용자가 외부 코드 실행을 허용한 뒤, 같은 날)

처음에는 이 환경의 권한 규칙이 외부 레포의 코드 실행을 막아 위의 정적 시범만 했다. 사용자가 허용한 뒤 레포마다 `relay init --try`(설치와 명령을 앱의 확인 worktree에서 한 번씩 돌림)를 돌렸다. `RELAY_HOME`은 시범 전용 폴더.

| 레포 | 결과 | 걸린 시간 | 시험 수 | 레포 작업 트리 |
|---|---|---|---|---|
| itsdangerous | 넷 모두 됨(`uv sync`, ruff, mypy, pytest) | 12초 | 297 | 깨끗 |
| markupsafe | 넷 모두 됨 | 6초 | 80 | 깨끗 |
| defu | 셋 모두 됨(설치, lint, test) | 15초 | 없음(문제 1) | 깨끗 |
| ufo | 셋 모두 됨 | 14초 | 없음(문제 1) | 깨끗 |
| pflag | 넷 모두 됨(golangci-lint도 이 기계에 있었음) | 10초 | 없음(문제 2) | 깨끗 |
| uuid | 셋 모두 됨 | 3초 | 없음(문제 2) | 깨끗 |
| itoa | 셋 모두 됨(fetch, clippy, test) | 34초 | 없음(Rust는 nextest가 있어야 함) | 깨끗 |
| jsoup | 둘 모두 됨(컴파일, `mvn test` + JUnit 합치기) | 49초 | 2,648 | 깨끗 |
| kotlinpoet | **둘 다 안 됨**, 초안에서 뺌 | 43초 | 잴 수 없음 | 깨끗 |

- **고친 것 없이 바로 돈 초안: 8/9.** kotlinpoet는 Gradle 플러그인 저장소(`plugins.gradle.org`)에 이 환경의 네트워크가 닿지 않아 `org.jetbrains.dokka` 플러그인을 받지 못했다(`BUILD FAILED`). relay의 잘못이 아니고, 드라이런이 설계대로 실패를 까닭과 함께 보이고 초안에서 뺐다.
- 아홉 레포 모두 드라이런 뒤 레포의 작업 트리가 깨끗했다(앱은 자기 확인 worktree에서만 돈다).

## 레포마다

| 레포(커밋) | 언어 | 설치 | 빠른 검사 | 수용 시험(JUnit) | 래칫 | 억누름(시험 파일 몫) | 중복 비율 | 소스 파일 | 셈 시간(억누름·중복, ms) |
|---|---|---|---|---|---|---|---|---|---|
| unjs/defu `82632b6` | TS, pnpm | `pnpm install --frozen-lockfile` | lint, test | **없음** | 줄 수, 억누름, 중복 | 12 (8) | 0.0% | 9 | 15·31 |
| unjs/ufo `f06c800` | TS, pnpm | 같음 | lint, test | **없음** | 같음 | 4 (0) | 2.6% | 22 | 15·54 |
| pallets/itsdangerous `672971d` | Python, uv | `uv sync` | ruff, mypy | `pytest --junitxml` | 시험 수, 줄 수, 억누름, 중복 | 11 (5) | 10.0% | 15 | 12·60 |
| pallets/markupsafe `4e11127` | Python, uv | `uv sync` | ruff, mypy | `pytest --junitxml` | 같음 | 15 (10) | 16.0% | 13 | 12·37 |
| spf13/pflag `f8a9906` | Go | `go mod download` | vet, golangci-lint, test | **없음** | 줄 수, 억누름, 중복 | 10 (2) | **64.6%** | 76 | 10·212 |
| google/uuid `2d3c2a9` | Go | `go mod download` | vet, test | **없음** | 같음 | 4 (2) | 12.7% | 23 | 8·46 |
| dtolnay/itoa `1577ed9` | Rust | `cargo fetch` | clippy, test | **없음** | 같음 | 3 (1) | 21.5% | 5 | 11·36 |
| jhy/jsoup `d90d575` | Java, Maven | - | test-compile | `mvn -B test` + JUnit 합치기 | 시험 수, 줄 수, 억누름, 중복 | 20 (5) | 16.1% | 216 | 29·615 |
| square/kotlinpoet `e54784d` | Kotlin, Gradle | - | testClasses | `./gradlew test` + JUnit 합치기 | 같음 | 125 (49) | 15.4% | 134 | 19·323 |

- 셈은 빠르다. 억누름은 레포마다 30ms 아래, 중복은 0.6초 아래(소스 216개).
- 시험 수 래칫은 9개 가운데 4개(Python 둘, Java, Kotlin)에만 들었다.

## 거짓 양성

**억누름: 204개 가운데 잘못 센 것 0.** 문자열 안의 표식 0, 주석이나 표식이 아닌 줄 0. 모두 실제 억누름이었다(`# type: ignore[override]`, `//nolint:errorlint`, `@Suppress("unused")` 등). 다만 '실제 억누름'이 곧 '나쁜 억누름'은 아니다. 호환성 같은 까닭을 적은 것이 많다. 래칫은 늘어난 것만 보므로 이것은 문제가 아니다. 82개(40%)가 시험 파일에 있다(건너뛴 시험과 시험 안의 억누름. 설계대로 센다).

**중복: 두 갈래가 '잘못 센 것'에 가깝다.**

1. **표처럼 반복되는 코드.** 이름과 값을 같게 치므로(설계), 모양이 같은 줄이 이어지면 모두 중복이 된다. itoa의 `match` 팔 12줄(`IntegerInput::I8(val) => test_itoa!(val),` …) 한 덩어리가 쌍 10개를 만들어 비율이 21.5%다. markupsafe의 `split`/`rsplit`/`splitlines`처럼 생김새만 같은 짧은 위임 메서드도 그렇다.
2. **겹친 자기 쌍.** 같은 파일의 같은 구역이 한두 줄 밀려 자기와 짝을 이룬다(읽은 쌍 74개 가운데 6개: markupsafe 4, itoa 1, kotlinpoet 1).

pflag의 64.6%는 타입마다 거의 같은 파일(`bool_slice.go`, `int_slice.go` …)을 둔 설계라 진짜 중복이다. 래칫은 늘어날 때만 알리므로 쓸 수는 있지만, 초안 화면에 64.6%가 그대로 보이면 사람이 놀란다.

## 찾은 문제 (재현 방법)

1. **JS: 합친 test 스크립트면 수용 시험이 빠진다.** defu `"test": "pnpm lint && pnpm test:types && pnpm vitest run"`, ufo `"test": "pnpm lint && vitest run --typecheck"`. 초안은 JUnit을 붙이지 못해 `test`를 빠른 검사로 넣고 시험 수 래칫을 빼며, lint가 두 번 돈다. 재현: 두 레포에 `relay init`. 고칠 길: 스크립트를 `&&`로 나눠 vitest·jest 마디만 JUnit 출력으로 수용 시험에 쓴다. **고침(2026-11-08, [design.md](../../design.md) V64)**: 러너 마디 하나를 JUnit 출력으로 수용 시험에 쓰고 이미 빠른 검사인 마디는 뺀다. 정적으로 본 초안: defu 빠른 검사 `pnpm run lint`·`pnpm run test:types`, 수용 시험 `pnpm vitest run --reporter=junit --outputFile=.relay-out/junit.xml`(+ lcov), ufo 빠른 검사 `pnpm run lint`, 수용 시험 `pnpm vitest run --typecheck --reporter=junit …`(+ lcov). 둘 다 시험 수 래칫과 바뀐 줄 커버리지가 든다. jest는 아직 알아보지 않는다. 드라이런은 다시 돌려 봐야 한다.
2. **Go: gotestsum이 없으면 시험 수 래칫이 없다.** 고칠 길: 앱이 `go test -json` 출력을 직접 읽는다(도구를 더하지 않아도 됨). **고침(V65)**: 수용 시험 `go test -json ./... > .relay-out/go-test.json`과 quality.json의 `test_format: "go-test-json"`. pflag·uuid 초안에 수용 시험과 시험 수 래칫이 든다(정적). 드라이런은 다시 돌려 봐야 한다.
3. **중복: 표처럼 반복되는 코드와 겹친 자기 쌍.** 재현: itoa `fuzz/fuzz_targets/fuzz_itoa.rs` 38~49줄, markupsafe `src/markupsafe/__init__.py` 173~186줄. 고칠 길: 같은 파일에서 겹치거나 맞닿아 밀린 쌍을 빼고, 한 구역 안의 반복(같은 모양 줄이 n줄 넘게 이어짐)은 한 번만 센다. **고침(V67)**: 한 파일 안에서 이어진 덩어리를 되풀이하는 단위가 다섯 코드 줄 아래면 쌍이 아니고, 이어진 덩어리는 한 쌍이다. 중복 몫(정적, 같은 커밋): itoa 21.5% → 18.0%, markupsafe 16.0% → 8.2%, pflag 64.6% → 64.2%(타입별 파일 그대로), jsoup 16.1% → 15.5%, kotlinpoet 15.4% → 12.5%, 나머지 그대로. 재현 자리 둘(itoa 38~49줄, markupsafe 173~186줄)의 쌍은 없다.
4. **초안이 기계에 없는 도구를 고른다.** pflag는 `.golangci` 설정이 있어 `golangci-lint run`을 넣었다. 이 기계에는 없다. 드라이런이 빼 줄 것이지만(설계) 확인하지 못했다.
6. **파일 줄 수 래칫이 코드가 아닌 파일도 센다.** ufo에서 600줄 넘는 파일 셋 가운데 둘이 `test/fixture/urltestdata.json`(7,433줄)과 `CHANGELOG.md`(853줄)다. 래칫은 늘어날 때만 알리지만, CHANGELOG는 Work마다 자라므로 거의 늘 '나빠짐'이 된다. 고칠 길: 초안의 file-size 래칫을 소스 파일(언어표에 있는 확장자)로만 좁히거나, 문서·자료 파일을 빼는 기본값. **고침(V66)**: 초안의 file-size는 언어 표의 확장자와 화면 소스(css, vue 등)만 본다(래칫의 기본은 그대로). ufo 600줄 넘는 파일 3 → 1(`src/utils.ts`), jsoup 32 → 29, kotlinpoet 19 → 17.
5. **Rust의 `fuzz/`가 소스로 들어간다.** itoa의 중복 쌍 10개가 모두 `fuzz/` 안이다. 빼는 경로 기본값에 `fuzz/`를 더할지 정할 거리다. **정함(V67)**: 더하지 않는다. 쌍 10개가 모두 3의 고침으로 사라졌고 fuzz 대상은 사람이 쓰는 코드다(빼려면 레포가 exclude에 적는다).

## 끄는 조건에 주는 뜻

- 억누름의 '틀린 셈 20% 넘음'(quality-floor 8절)은 이 표본에서는 0%라 걸릴 일이 적다. 남은 물음은 '나빠짐을 사람이 고치는가'이고, 실제 Work가 있어야 잰다.
- 중복은 3을 고치기 전에는 실제 레포에 기본으로 넣기 이르다. 고친 뒤 같은 레포로 다시 잰다.
- 여러 언어 초안의 끄는 조건('고친 것 없이 도는 초안이 절반 아래', 언어마다 레포 5)은 아직 n이 모자라다. 이번 값: JS 2/2, Python 2/2, Go 2/2, Rust 1/1, Java 1/1, Kotlin 0/1(환경 탓).

## 다음

1. ~~1·2·3·6을 고친다~~ 고쳤다(2026-11-08, V64~V68). 같은 레포로 드라이런을 다시 돌려 이번 값(위 '고침')을 확인한다.
2. 언어마다 레포를 다섯까지 늘려 여러 언어 초안의 끄는 조건을 잰다(이번에 길이 열림: 외부 코드 실행 허용).

## 고친 뒤 다시 잼: 레포 30개 (2026-11-08)

relay-v3 `ff41612`(문제 1·2·3·6 고침, V64~V68). 언어마다 레포 5개, 모두 `relay init --try`(드라이런). 레포의 작업 트리는 30개 모두 깨끗하게 남았다.

### 처음 9개: 고치기 전과 후

| 레포 | 고치기 전 시험 수 | 고친 뒤 |
|---|---|---|
| defu | 없음 | 23 (수용 시험 `pnpm vitest run --reporter=junit …`, lint는 한 번) |
| ufo | 없음 | 491 |
| pflag | 없음 | 228 (`go test -json`) |
| uuid | 없음 | 213 |

중복 비율(정적): itoa 21.5% → 18.0%, markupsafe 16.0% → 8.2%, pflag 64.6% → 64.2%(타입별 파일은 진짜 중복이라 남음). 줄 수 래칫(초안): ufo의 600줄 넘는 파일 3 → 1(시험 자료 JSON과 CHANGELOG가 빠짐).

### 언어마다 '고친 것 없이 바로 도는 초안'

모든 명령이 된 레포를 셌다. 안 된 것은 까닭을 셋으로 나눴다: **relay**(초안이 고른 명령이나 설치가 틀림), **레포**(레포의 코드나 시험이 이 도구판에서 실제로 실패함. 드라이런이 설계대로 뺌), **환경**(이 기계의 네트워크나 JDK·Gradle 판).

| 언어 | 바로 돎 | 안 된 레포와 까닭 |
|---|---|---|
| JS/TS | **5/5** (defu, ufo, pathe, destr, scule) | - |
| Python | **3/5** (itsdangerous, markupsafe, blinker) | tenacity: **relay**. 설치는 `pip install -e '.[test]'`인데 ruff·mypy는 다른 묶음에 있어 `.venv/bin/ruff`가 없음. humanize: **relay**. 설치가 `requirements-mypy.txt`만 골라 pytest·pytest-cov가 없음(pytest 종료 코드 4). 그와 별개로 mypy 오류 1(**레포**) |
| Go | **3/5** (pflag, uuid, cast) | go-cmp: **레포**. `go vet`이 레포 시험 코드의 실제 경고로 실패(뺌, 시험은 733개로 됨). pkg/errors: **relay**. `go.mod`가 없는 옛 Go 레포를 Go로 알아보지 못함(앱이 직접 재는 래칫만 남음) |
| Rust | **3/5** (itoa, ryu, semver) | anyhow: **레포·환경**. 이 컴파일러 판에서 `test_fmt` 시험이 실패. log: **레포·환경**. clippy 경고가 `-D warnings`로 실패. 둘 다 드라이런이 뺌. 다섯 모두 시험 수 래칫 없음(nextest가 없으면 JUnit을 못 냄) |
| Java | **2/5** (jsoup, commons-cli) | gson: **relay**. 여러 모듈 Maven에서 `test-compile`은 JPMS 시험 모듈이 쓸 jar를 만들지 않아 컴파일 실패(`install`이나 `verify`가 맞음). javapoet: **환경**. 이 JDK에서 옛 `release` 설정이 `java.io.IOException`을 찾지 못함. commons-text: **레포·환경**. 이 JDK의 XML 엔티티 상한에 시험이 걸림 |
| Kotlin | **0/5** | turbine: **relay**. 멀티플랫폼 프로젝트에는 `testClasses`가 없고 `jvmTestClasses`·`jvmTest`를 써야 함. kotlin-result, moshi: **환경**. Gradle 플러그인 저장소에 닿지 못함. kotlinx-cli: **환경**. Gradle 7.6이 이 JDK(21)를 못 읽음. kotlinpoet: **환경**. Kotlin 컴파일 변환 실패(이 JDK) |

### 끄는 조건 (devices.md '여러 언어 초안': 언어마다 레포 5, 바로 도는 초안이 절반 아래면 그 언어 레시피를 '제안만'으로)

- 글자 그대로 읽으면 **JS, Python, Go, Rust는 남고(5/5, 3/5, 3/5, 3/5), Java(2/5)와 Kotlin(0/5)은 걸린다.**
- 다만 Java와 Kotlin의 실패 일곱 가운데 다섯이 이 기계의 네트워크나 JDK·Gradle 판 탓(환경)이다. 끄는 조건은 환경 탓을 따로 두지 않았다. relay 탓만 세면 Java는 relay 탓 1(gson), Kotlin은 relay 탓 1(turbine)이다.
- 그래서 등록부의 상태는 바꾸지 않고 사용자에게 올린다(아래 '다음').

### 새로 찾은 relay 문제

7. **Python 설치가 lint 도구를 안 깐다**(tenacity): 초안이 고른 도구가 설치한 묶음에 있는지 보지 않는다. → **고침**(V69)
8. **Python 설치 파일을 잘못 고른다**(humanize: `requirements-mypy.txt`): 이름에 `mypy`, `docs`, `lint`가 든 requirements를 설치 본으로 고르지 말아야 한다. → **고침**(V69)
9. **`go.mod` 없는 Go 레포를 모른다**(pkg/errors). → **고침**(V70: 알아보기만 하고 명령은 넣지 않음)
10. **여러 모듈 Maven**(gson): 빠른 검사로 `test-compile` 대신 `-DskipTests install`(로컬 저장소에 씀) 또는 `verify`. → **고침**(V70: verify)
11. **Kotlin 멀티플랫폼**(turbine): `jvmTestClasses`, `jvmTest`, 결과 경로 `build/test-results/jvmTest`. → **고침**(V70)
12. **Rust 시험 수**: nextest가 없으면 시험 수가 없다. `cargo test -- -Z unstable-options --format json`은 안정판에서 안 되므로, 기본 출력의 `test result:` 줄을 읽는 길을 볼 만하다. → **고침**(V71: `test_format: 'cargo-test'`)

### 다음

1. 7~12를 고친다.
2. 환경 탓을 줄인 기계(Gradle 플러그인 저장소에 닿고, JDK를 고를 수 있는 곳)에서 Java·Kotlin을 다시 잰 뒤 끄는 조건을 판정한다. 그 전에는 레시피를 그대로 둔다(사용자 결정 대상).
3. 끄는 조건에 '환경 탓은 분모에서 뺀다'를 더할지 정한다(사용자 결정 대상).

### 사용자 결정 (2026-11-08, ✅)

- '여러 언어 초안'의 끄는 조건은 지금 적용하지 않는다. relay 탓 문제 7~12를 고친 뒤, 끄는 조건에 **'환경 탓(이 기계의 네트워크, JDK·Gradle 판)은 분모에서 뺀다'**를 더해 다시 잰다. 그때까지 Java·Kotlin 레시피는 그대로 둔다.

## 7~12를 고친 뒤 (2026-11-08)

relay-v3에서 문제 7~12를 고쳤다(V69~V71). 끄는 조건에 사용자 결정대로 '환경 탓은 분모에서 뺀다'를 더하고, 드라이런이 뚜렷한 환경 탓을 출력의 무늬로 표시한다(V72). 관문 판 4(V73, 재생 digest 같음). 같은 기계에서 문제의 레포와, 고친 레시피가 닿는 앞서 되던 레포를 `relay init --try`로 다시 돌렸다(레포의 작업 트리는 모두 깨끗하게 남았다). 레시피가 그대로인 레포(JS 5개, pflag·uuid·cast·go-cmp, jsoup·commons-cli·commons-text·javapoet)는 다시 돌리지 않았다.

| 레포 | 고치기 전 | 고친 뒤 |
|---|---|---|
| tenacity | relay: `.[test]`만 깔아 ruff·mypy 없음 | setup `pip install 'pip>=25.1'` 뒤 `-e . --group dev`(297초), lint·types(`mypy`, [tool.mypy] files)·수용 시험 됨, 시험 185 |
| humanize | relay: `requirements-mypy.txt`만 깔아 pytest 종료 코드 4 | setup `-e '.[tests]'`, 수용 시험(`--cov`) 됨, 시험 878, Cobertura 읽음. mypy는 requirements-mypy.txt에만 있어 빼고 제안 |
| itsdangerous·markupsafe·blinker | 됨 | 됨(`uv sync` 그대로, mypy는 [tool.mypy] files로 대상 없이). 시험 297·80·25 |
| pkg/errors | relay: Go를 모름 | 'Go (go.mod 없음)', 명령 없음과 `go mod init` 제안(`GO111MODULE=off go test ./...`는 GOPATH 밖에서 `cannot find package "github.com/pkg/errors"`로 안 됨을 확인), 래칫 셋의 지금 값 |
| gson | relay: test-compile이 JPMS 시험 모듈에서 `module not found` | `-DskipTests verify`(43초)·`spotless:check`·수용 시험 `verify` 됨, 시험 4,910 |
| turbine | relay: `testClasses` 없음 | 첫 판: `jvmTestClasses`·`jvmTest`가 `:compileKotlinJvm`까지 돌고 Maven Central의 429(Too Many Requests)로 끝남(드라이런이 '네트워크'로 표시). 몇 분 뒤 다시: 수용 시험 `jvmTest` 됨(시험 144, `build/test-results/jvmTest`), `jvmTestClasses`는 또 429: **환경** |
| kotlinpoet | 환경(Kotlin 컴파일 변환) | 첫 판은 같은 429. 다시: `testClasses jvmTestClasses`(65초)·수용 시험 `test jvmTest` 됨, 시험 1,188(interop의 test와 kotlinpoet의 jvmTest를 함께 묶음) |
| itoa·ryu·semver | 됨, 시험 수 없음 | 됨, 수용 시험 `cargo test --no-fail-fast > .relay-out/cargo-test.txt`로 시험 13·51·38 |
| log | 레포(clippy `-D warnings`) | 같음(clippy만 빠짐), 시험 59 |
| anyhow | 레포·환경(`test_fmt`) | 같음: 수용 시험이 빠짐(`종료 코드 101: --test test_fmt`), 무늬 없음 |
| kotlin-result·moshi·kotlinx-cli | 환경 | 같음. 드라이런이 '네트워크'·'Gradle 플러그인 저장소'·'JDK 판'으로 표시 |

**언어마다 다시 센 것(환경 탓을 분모에서 뺌, 다시 돌리지 않은 레포는 앞의 결과).** JS 5/5. Python 5/5(tenacity, humanize가 더해짐). Go 3/5(pkg/errors는 명령 없는 초안이라 '바로 돎'에 넣지 않았다, go-cmp는 레포 탓). Rust 3/5(anyhow·log는 레포 탓으로 셈. anyhow는 이 컴파일러 판에서만 실패해 환경이라 볼 수도 있지만 무늬가 없어 손으로 레포로 둠). Java 3/4(gson이 더해짐, javapoet은 환경이라 분모에서 뺌, commons-text는 레포·환경이라 레포로 둠). Kotlin 1/1(kotlinpoet. turbine은 수용 시험이 되었지만 컴파일이 429로 안 돼 환경, kotlin-result·moshi·kotlinx-cli도 환경이라 분모에서 뺌). 끄는 조건에 걸리는 언어는 없다. Kotlin은 남은 분모가 최소 n(레포 5)에 모자라 판정하지 않고, 환경 탓을 줄인 기계(Maven Central·Gradle 플러그인 저장소에 닿고 JDK를 고를 수 있는 곳)에서 다시 잰다(devices.md의 고친 끄는 조건 그대로).

**남은 것.** turbine의 컴파일 검사가 한 번에 되는 것은 이 기계에서 보지 못했다(Maven Central 429, 수용 시험은 됨). 환경 탓 무늬는 첫 가름이고, 무늬 없는 환경 탓(javapoet의 옛 release 설정, commons-text의 XML 엔티티 상한, anyhow)은 손으로 가른다. 앱의 초안 화면은 환경 탓 표시를 아직 보이지 않는다(`relay init` 요약에만).

## 마지막 다시 잼: 30개 모두, 한 빌드로 (2026-11-08)

relay-v3 `1d9c28d`(문제 1~3, 6~12 고침, 끄는 조건에 환경 탓 빼기). 30개를 같은 빌드로 처음부터 다시 돌렸다(레포마다 확인 worktree를 지우며. 처음 돌릴 때 디스크가 차서 멈췄고, 이 세션이 만든 시범 작업 폴더와 지난 평가의 작업 폴더를 지운 뒤 다시 했다). 30개 모두 레포의 작업 트리가 깨끗했다.

| 언어 | 모든 명령이 됨 | 안 된 레포 | 가름 | 환경 탓을 뺀 셈 | 끄는 조건 |
|---|---|---|---|---|---|
| JS/TS | 5/5 (defu 23, ufo 491, pathe 483, destr 22, scule 75 시험) | - | - | 5/5 | 남음 |
| Python | 5/5 (itsdangerous 297, tenacity 185, markupsafe 80, blinker 25, humanize 878) | - | - | 5/5 | 남음 |
| Go | 3/5 (pflag 228, uuid 213, cast 8,987) | go-cmp(`go vet`이 레포 코드의 경고로 실패, 시험 733은 됨), pkg/errors(`go.mod` 없음: 명령 없이 제안만) | 레포, relay(설계대로 제안만) | 3/5 | 남음 |
| Rust | 3/5 (itoa 13, ryu 51, semver 38) | anyhow(`cargo test`의 `test_fmt` 실패), log(clippy `-D warnings` 실패, 시험 59는 됨) | 레포·도구판(무늬 없음, 손으로 가름) | 3/5 | 남음 |
| Java | 3/5 (commons-cli 1,002, gson 4,910, jsoup 2,648) | commons-text(이 JDK의 XML 엔티티 상한에 시험이 걸림), javapoet(이 JDK에서 옛 `release` 설정이 컴파일 실패) | 환경(JDK, 무늬 없음, 손으로 가름) | 3/3 | **판정 없음**(환경을 빼면 n 3 < 5) |
| Kotlin | 2/5 (turbine 144, kotlinpoet 1,188) | kotlinx-cli(Gradle 7.6이 JDK 21을 못 읽음), kotlin-result·moshi(Gradle 플러그인 저장소에 못 닿음) | 환경(드라이런이 셋 모두 '환경 탓으로 보임'으로 표시) | 2/2 | **판정 없음**(n 2 < 5) |

- **끄는 조건(devices.md '여러 언어 초안', V72): 걸린 언어 없음.** JS, Python, Go, Rust는 n 5에서 절반 넘게 바로 돌아 레시피를 그대로 둔다. Java와 Kotlin은 환경 탓을 빼면 n이 5에 못 미쳐 판정하지 않는다. 남은 레포는 모두 바로 돌았다(3/3, 2/2). 레시피는 그대로 두고, Gradle 플러그인 저장소에 닿고 JDK를 고를 수 있는 기계에서 다시 잰다.
- 처음 9개 시범(고치기 전)과 견주면: 바로 돈 레포 8/9 → 9/9(kotlinpoet가 멀티플랫폼 고침으로 됨), 시험 수 래칫이 있는 레포 4/9 → 9/9.
- 손으로 가른 환경 탓 둘(commons-text, javapoet)과 레포·도구판 탓 둘(anyhow, log)은 드라이런의 무늬에 걸리지 않았다. 무늬를 늘릴지는 다음 일이다.

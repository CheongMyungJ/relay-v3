# 품질 바닥 시범: 공개 레포 9개 (정적)

2026-11-07. [quality-floor.md](../../quality-floor.md) 7절의 '실제 레포 시범'. relay-v3 `c43cc3e`(main).

## 한 줄 요약

**초안은 다섯 언어 모두에서 알맞은 명령을 골랐고, 억누름 셈은 204개 가운데 잘못 센 것이 0이었다. 다만 JS의 합친 test 스크립트와 Go에서 시험 수 래칫이 빠지고, 중복 래칫은 표처럼 반복되는 코드를 중복으로 크게 센다. 레포의 명령을 실제로 돌려 보는 드라이런은 하지 못했다(아래 '하지 못한 것').**

## 무엇을 했나

- 레포 9개(JS 2, Python 2, Go 2, Rust 1, Java 1, Kotlin 1)를 `git clone --depth 1`로 받았다.
- 레포의 코드를 하나도 돌리지 않는 것만 했다.
  - 초안: `draftFor`(파일 목록과 매니페스트만 읽음).
  - 억누름·중복: 앱이 git 객체를 읽어 셈(래칫이 실제로 쓰는 함수 그대로: `grepLines` → `suppressionsInLine`, `lsTree`·`readBlobs` → `scoped` → `duplication`).
  - 억누름의 나빠짐: itsdangerous에 임시 커밋으로 `# noqa` 한 줄을 더해 `suppressionsRatchet`이 `worse 11 → 12`를 내는지 봤다(냈다. 커밋은 지움). 이 확인에서 새 표식의 자리(`where`)가 빈 것은 시범 스크립트가 diff를 잘못 넘긴 탓이다. 앱의 흐름 시험(`works-floor.test.ts`)은 자리를 보인다.
- 억누름 표식은 모두 손으로 읽었고, 중복 쌍은 레포마다 앞의 최대 15개를 읽었다.

### 하지 못한 것

- **드라이런(레포의 설치와 시험을 실제로 돌리기).** 이 환경의 권한 규칙이 외부 레포의 코드를 실행하는 것(의존성 설치, 레포의 시험 실행)을 막았다. 그래서 '초안이 고친 것 없이 바로 도는가', 드라이런 시간, 시험 수와 바뀐 줄 커버리지 값은 재지 못했다.

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

1. **JS: 합친 test 스크립트면 수용 시험이 빠진다.** defu `"test": "pnpm lint && pnpm test:types && pnpm vitest run"`, ufo `"test": "pnpm lint && vitest run --typecheck"`. 초안은 JUnit을 붙이지 못해 `test`를 빠른 검사로 넣고 시험 수 래칫을 빼며, lint가 두 번 돈다. 재현: 두 레포에 `relay init`. 고칠 길: 스크립트를 `&&`로 나눠 vitest·jest 마디만 JUnit 출력으로 수용 시험에 쓴다.
2. **Go: gotestsum이 없으면 시험 수 래칫이 없다.** 고칠 길: 앱이 `go test -json` 출력을 직접 읽는다(도구를 더하지 않아도 됨).
3. **중복: 표처럼 반복되는 코드와 겹친 자기 쌍.** 재현: itoa `fuzz/fuzz_targets/fuzz_itoa.rs` 38~49줄, markupsafe `src/markupsafe/__init__.py` 173~186줄. 고칠 길: 같은 파일에서 겹치거나 맞닿아 밀린 쌍을 빼고, 한 구역 안의 반복(같은 모양 줄이 n줄 넘게 이어짐)은 한 번만 센다.
4. **초안이 기계에 없는 도구를 고른다.** pflag는 `.golangci` 설정이 있어 `golangci-lint run`을 넣었다. 이 기계에는 없다. 드라이런이 빼 줄 것이지만(설계) 확인하지 못했다.
5. **Rust의 `fuzz/`가 소스로 들어간다.** itoa의 중복 쌍 10개가 모두 `fuzz/` 안이다. 빼는 경로 기본값에 `fuzz/`를 더할지 정할 거리다.

## 끄는 조건에 주는 뜻

- 억누름의 '틀린 셈 20% 넘음'(quality-floor 8절)은 이 표본에서는 0%라 걸릴 일이 적다. 남은 물음은 '나빠짐을 사람이 고치는가'이고, 실제 Work가 있어야 잰다.
- 중복은 3을 고치기 전에는 실제 레포에 기본으로 넣기 이르다. 고친 뒤 같은 레포로 다시 잰다.
- 여러 언어 초안의 끄는 조건('고친 것 없이 도는 초안이 절반 아래')은 드라이런을 못 해 재지 못했다.

## 다음

1. 1·2·3을 고친다(작은 고침, 단위 시험으로 덮을 수 있음).
2. 드라이런: 외부 레포의 설치·시험을 실제로 돌려야 한다. 사람이 정할 일이다. (가) 이 환경에서 허용, (나) 사용자의 기계에서 `relay init --try`로, (다) 믿을 수 있는 레포(relay-v2, relay-v3, 평가 시나리오 레포)로만.

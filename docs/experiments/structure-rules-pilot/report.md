# 구조 규칙 래칫 시범: 레포 28개 (2026-11-08)

- 무엇: [structure-rules.md](../../structure-rules.md) 1단계의 시범(7절 '실제 레포 시범'). import 읽기, 구조 후보 내기, imports 래칫의 지금 값을 실제 레포에서 본다.
- 빌드: relay-v3 `345abf1`에 이 시범에서 고친 다섯 가지(아래 3절)를 더한 것. 이 문서와 같은 커밋이다.
- 방법: 정적으로만 했다. 레포를 `--depth 1`로 받아 읽기만 하고, 레포의 명령은 돌리지 않았다. 도구는 `scanRepo`(작업 트리의 import 그래프), `structureCandidates`, `importsAt`(커밋을 git으로 읽음)과 `violations`다.
- 사람 고르기는 없다. 후보를 사람이 받아들일지는 레포에 이미 있는 경계 설정과 견주는 대리 지표로만 본다.

## 1. 판

| 묶음 | 레포 | 까닭 |
|---|---|---|
| 품질 바닥 시범의 JS/Python/Go 15개 | defu, ufo, destr, pathe, scule / itsdangerous, tenacity, markupsafe, blinker, humanize / go-cmp, pflag, pkg/errors, cast, uuid | 지난 시범과 같은 판. 대부분 작은 단일 패키지 |
| 경계 설정이 있는 12개(새로 받음) | Python import-linter 5: import-linter, kopf, ggshield, wemake-python-styleguide, django-eav2. JS dependency-cruiser 4: realworld-react-fsd, castore, nestjs-cls, json-schema-to-ts. Go depguard 3: FerretDB, todo-api-microservice-example, eventhorizon | 후보를 사람이 적은 설정과 견주려고 골랐다. GitHub 코드 검색에서 설정 파일이 있고 크기가 알맞은 것 |
| relay-v3 자신 | | 맞춤 시험(eslint.config.mjs의 층) |

## 2. 결과

| 언어 | 레포 | 소스 파일 | 레포 안 import | 못 봄 | 푼 비율 | 후보 | 시간(ms) |
|---|---|---|---|---|---|---|---|
| JS | defu | 9 | 2 | 3 | 40% | 0 | 28 |
| JS | ufo | 22 | 17 | 0 | 100% | 0 | 41 |
| JS | destr | 6 | 0 | 1 | 0% | 0 | 12 |
| JS | pathe | 12 | 5 | 1 | 83% | 0 | 26 |
| JS | scule | 4 | 1 | 0 | 100% | 0 | 7 |
| JS | castore | 315 | 495 | 1 | 99.8% | 5 | 135 |
| JS | nestjs-cls | 153 | 207 | 0 | 100% | 2 | 92 |
| JS | json-schema-to-ts | 99 | 102 | 0 | 100% | 2 | 50 |
| JS | realworld-react-fsd | 73 | 145 | 47 | 75.5% | 2 | 26 |
| JS | relay-v3 | 263 | 579 | 0 | 100% | 2 | 239 |
| Python | itsdangerous | 15 | 21 | 0 | 100% | 0 | 16 |
| Python | tenacity | 20 | 32 | 0 | 100% | 0 | 20 |
| Python | markupsafe | 13 | 1 | 1 | 50% | 0 | 9 |
| Python | blinker | 7 | 2 | 0 | 100% | 0 | 8 |
| Python | humanize | 13 | 9 | 1 | 90% | 0 | 16 |
| Python | kopf | 311 | 389 | 1 | 99.7% | 4 | 125 |
| Python | import-linter | 134 | 84 | 0 | 100% | 1 | 49 |
| Python | ggshield | 418 | 823 | 0 | 100% | 5 | 257 |
| Python | wemake-python-styleguide | 416 | 548 | 0 | 100% | 2 | 139 |
| Python | django-eav2 | 74 | 80 | 0 | 100% | 0 | 28 |
| Go | go-cmp | 42 | 22 | 0 | 100% | 0 | 43 |
| Go | pflag | 76 | 0 | 0 | — | 0 | 33 |
| Go | pkg/errors | 10 | 0 | 0 | — | 0 | 8 |
| Go | cast | 21 | 1 | 0 | 100% | 0 | 13 |
| Go | uuid | 23 | 0 | 0 | — | 0 | 11 |
| Go | FerretDB | 443 | 359 | 0 | 100% | 5 | 207 |
| Go | todo-api-microservice-example | 69 | 83 | 0 | 100% | 1 | 170 |
| Go | eventhorizon | 180 | 184 | 0 | 100% | 1 | 64 |

- 레포 안 import와 못 봄은 시험 파일 밖만 센다. '레포 안 import'는 (가져오는 파일, 대상)의 짝 수다. 푼 비율은 레포 안 import ÷ (레포 안 import + 못 봄)이다.
- 시간은 `scanRepo`가 작업 트리를 읽어 그래프를 만든 시간이다. 래칫이 커밋 하나를 읽는 시간(`importsAt`)은 25~207ms였고, relay-v3만 1.6초였다.

**언어마다 합친 값.** 아래 '후보를 낸 레포'는 끄는 조건의 '고른 후보'가 아니라 '낸 후보'다.

| 언어 | 레포 | 레포 안 import | 못 봄 | 푼 비율 | 후보를 낸 레포 |
|---|---|---|---|---|---|
| JS | 10 | 1,553 | 53 | 96.7% | 5 |
| Python | 10 | 1,989 | 3 | 99.8% | 4 |
| Go | 8 | 649 | 0 | 100% | 3 |

**못 봄 56개의 까닭.** 모두 레포에 없는 대상이다. 읽개가 놓친 것은 고친 뒤 없다(3절의 castore).

| 까닭 | 수 | 예 |
|---|---|---|
| 만든 코드(커밋하지 않음) | 47 | realworld-react-fsd `~shared/api/generated/…` |
| 빌드 결과물(`dist/`) | 5 | defu `../dist/defu.cjs` 등 3, destr 1, pathe 1 |
| C 확장·만든 판 파일 | 3 | markupsafe `._speedups`, humanize `._version`, kopf `_cogs.helpers.versions` |
| `.d.ts`가 가리키는 없는 파일 | 1 | castore `swaggerClient.d.ts` → `./types` |

작은 레포의 낮은 푼 비율(defu 40%, destr 0%)은 `dist/`를 가리키는 다시 내보내기 한두 줄 때문이다. 분모가 작아서 생긴 숫자다.

## 3. 시범에서 찾고 고친 것

| # | 찾은 것 | 고침 | 고친 뒤 |
|---|---|---|---|
| 1 | castore의 못 봄 97개. 하위 tsconfig가 `extends`로 루트의 `paths`(`~/*`)를 물려받는데 읽지 않았다 | `extends`(레포 안 상대 경로, 다섯 겹까지)를 따라간다. baseUrl은 자식 것이 이기고, paths의 대상은 baseUrl이 있으면 그 기준, 없으면 paths를 적은 tsconfig의 폴더 기준이다(TypeScript와 같음) | 못 봄 1, 레포 안 import 399 → 495 |
| 2 | castore 루트의 층 후보에 `eslint.config.js`, `.dependency-cruiser.js`가 마디로 들어갔다. 파일 대상에도 Go 패키지처럼 폴더 표시를 붙였다 | 대상이 폴더일 때만(`ImportEdge.folder`) 폴더 아래로 본다 | 마디는 폴더만 |
| 3 | **wemake의 층 후보가 사람이 적은 설정과 반대 순서를 지었다.** logic과 violations는 서로 가져오지 않는데, 후보는 violations를 맨 아래에 두어 'violations는 logic을 가져오지 않음'이 됐다. 설정은 violations가 logic 위다. 층은 관계없는 마디 사이에도 순서를 매긴다 | 근거 있는 층만 낸다(`evidencedLayers`). 위 층의 마디는 아래 층의 마디마다 가져오는 경로가 있어야 한다. 근거 없는 쌍이 가장 많은 마디를 규칙 밖으로 빼기를 되풀이하고, 셋 미만이나 단계 셋 미만이 되면 층 후보가 없다(쌍 후보로) | 설정과 어긋난 후보 0 |
| 4 | castore `packages`의 층 글이 마디 18개를 다 늘어놓아 읽을 수 없었다 | 층에 마디가 넷을 넘으면 '셋 외 N' | |
| 5 | eventhorizon 루트 층에 `.`(Go 루트 패키지)이 마디로 들어갔다 | `.`은 마디가 아니다 | |
| 6 | (시험을 쓰다 찾음) Node 하위 경로 import `#/x`를 쿼리로 보고 지웠다 | 맨 앞의 `#`은 두고 그 뒤의 `?`·`#`만 지운다 | 시범 숫자는 그대로 |

3의 결과로 relay-v3 자신의 층 후보는 `cli·main > engine > adapters·shared > core`이다. 고치기 전에는 preload·renderer가 engine과 같은 층에 있었다. preload·renderer는 다른 층과 경로가 고르게 있지 않아 규칙 밖으로 빠진다. eslint가 막는 방향은 여전히 모두 막는다([어댑터] structure.test.ts).

## 4. 후보와 레포의 경계 설정 견주기

**맞음의 뜻.** 후보가 막는 방향을 설정이 허락하는 곳이 없고, 설정이 막는 방향을 후보가 허락한다고 적는 곳도 없다. 후보는 설정보다 느슨해도 된다. 같은 층에 둔 것은 서로 제약하지 않는다.

| 레포 | 설정 | 후보 | 견줌 |
|---|---|---|---|
| import-linter | 층 8: cli > ui > api > contracts > configuration > adapters > application > domain | `adapters·contracts·ui > application > domain` | **맞음.** cli·api·configuration은 파일 모듈이라 마디가 아니다(후보는 폴더만) |
| kopf | 층 계약 셋: on > _kits > _core > _cogs / reactor > engines > intents > actions / clients > configs > structs > aiokits > helpers | `_kits > _core > _cogs` / `reactor > engines > intents > actions` / `clients > configs > structs > helpers`, 그리고 'kopf는 examples를 가져오지 않음' | **셋 모두 맞음.** 둘째는 같고, 셋째는 aiokits가 빠짐(근거 부족), 첫째는 on이 파일 모듈 |
| ggshield | 층: __main__ > cmd.* > verticals.* > core > utils | `cmd > verticals > core > utils`, core 안의 층(설정에 없음, 지금 어긴 곳 1), 'cmd/utils는 cmd/secret·hmsl·config를 가져오지 않음' | **맞음.** 첫 후보는 설정의 층과 같음. cmd 안의 쌍은 설정의 '형제끼리 독립'과 맞음 |
| wemake-python-styleguide | 층 11: checker > formatter > transformations > presets > visitors > violations > logic > compat > options > constants > types | `presets > visitors > logic > compat·options`, logic 안의 층 | **맞음(고친 뒤).** 고치기 전에는 logic·violations의 순서가 반대였다(3절의 3) |
| django-eav2 | 층 12(모두 파일 모듈) | 없음 | 견줄 것 없음: 폴더 마디만 보는 한계 |
| nestjs-cls | dependency-cruiser `not-to-test`(src는 test를 가져오지 않음) | 'packages/core/src는 packages/core/test를 가져오지 않음', packages의 층 | **맞음** |
| realworld-react-fsd | 설정은 순환만 막는다. 레포의 설계는 Feature-Sliced(app > pages > widgets > features > entities > shared) | `app > pages > shared`, `ui > lib > api`(shared 안) | **설계와 맞음**(widgets·features·entities 폴더는 이 레포에 없다) |
| castore, json-schema-to-ts | 순환만 막는다 | 층·쌍 | 견줄 경계 없음 |
| FerretDB, todo-api, eventhorizon | depguard는 바깥 패키지만 막는다. FerretDB만 'tools는 internal을 가져오지 않음' | 층·쌍 | 견줄 내부 경계 없음. FerretDB의 tools 규칙은 tools가 internal을 가져오는 곳이 없어 후보가 덮지 않는다 |
| relay-v3 | eslint `no-restricted-imports` 층 | `cli·main > engine > adapters·shared > core`, 'src는 scripts를 가져오지 않음' | **맞음** |

**요약.** 폴더 단위의 경계 설정이 있는 레포는 7개다(import-linter, kopf, ggshield, wemake, nestjs-cls, realworld-react-fsd의 설계, relay-v3).

- 고친 뒤 그 7개 모두에서 설정과 맞는 후보가 첫 자리에 나왔다.
- 설정과 어긋난 후보는 0개다. 고치기 전에는 1개였다(wemake).
- 설정이 파일 모듈 단위인 django-eav2는 후보가 없었다.

## 5. imports 래칫의 지금 값

후보마다 `structureRatchet`으로 규칙을 만들고, HEAD 커밋을 `importsAt`(git)으로 읽어 어긴 import를 셌다.

- 모든 후보에서 그 값은 후보 글의 '지금 어긴 곳'과 같았다. 작업 트리로 센 값과 커밋으로 센 값이 같다는 뜻이다.
- ggshield `layers-core`만 1이고, 나머지는 0이다.
- 규칙 묶음 안의 못 봄은 realworld-react-fsd `layers-src`만 47(만든 코드)이고, 나머지는 0~1이다.

## 6. 끄는 조건에 비추어 (devices.md, 판정 아님)

- **'구조 후보 내기'의 푼 비율 조건(90% 아래면 그 언어는 후보를 내지 않음): 세 언어 모두 넘는다.** JS 96.7%, Python 99.8%, Go 100%다.
- **'구조 후보 내기'의 고른 비율 조건(고른 후보가 없는 레포가 절반을 넘으면): 이 시범으로는 잴 수 없다.** 사람이 고르지 않았다.
  - 작은 단일 패키지 15개에서는 후보가 하나도 나오지 않았다. 마디가 될 폴더가 없기 때문이다.
  - 그래서 '레포 5개 이상'을 채우려면 폴더 구조가 있는 레포를 골라야 한다.
- **'구조 규칙 래칫'의 조건:** 나빠짐 Work와 장기 평가가 있어야 한다. 이 시범의 몫이 아니다.

## 7. 한계

- 레포를 고른 방식이 치우쳤다. 경계 설정이 있는 레포는 이미 구조가 깔끔한 쪽이다. 엉킨 레포에서 후보가 어떤지는 모른다. 작은 레포 15개는 후보가 없어 그쪽을 말하지 못한다.
- '맞음'은 어긋나지 않는다는 뜻이다. 후보가 사람이 원하는 설계인지는 사람이 골라야 안다.
- 마디는 폴더뿐이다. 파일 모듈 사이의 층(eav2, import-linter의 cli·api)은 후보가 되지 않는다. 손으로 적은 규칙(glob)은 파일도 된다.
- Java/Kotlin·Rust는 읽지 않는다(2단계).

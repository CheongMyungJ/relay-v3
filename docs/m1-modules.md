# M1 모듈 약속

M1(V12)은 앱 없이 CLI로 확인 실행기와 관문을 만든다. 타입의 정본은 `src/core/types.ts`다. 아래 함수 모양은 모듈 사이의 약속이라, 바꾸려면 이 문서를 먼저 고친다.

공통 규칙
- TypeScript, ESM. 상대 import는 `.ts` 확장자를 쓴다(`import { x } from './glob.ts'`). Node 22.18+의 타입 지우기로 빌드 없이 돈다. 그래서 enum, 매개변수 속성, namespace 같은 지울 수 없는 문법을 쓰지 않는다(`erasableSyntaxOnly`).
- `src/core`는 순수하다. Node 내장 모듈, `src/adapters`, `src/engine`, `src/cli`를 가져오지 않는다. 시간·난수가 필요하면 인자로 받는다.
- 오류는 던지지 말고 결과로 돌려줄 수 있으면 돌려준다. 파싱 함수는 `{ ok: true, value } | { ok: false, errors: string[] }`를 돌려준다(`Result<T>`, `src/core/result.ts`).
- 사람에게 보이는 글(detail, errors)은 한국어, 짧은 문장.
- 파일 600줄 이하. 시험은 `test/unit/<모듈>.test.ts`, `test/adapters/<모듈>.test.ts`.

## core

### `src/core/result.ts` (이미 있음)
`Result<T>`, `ok(value)`, `err(...errors)`.

### `src/core/glob.ts`
- `matchAny(path: string, globs: string[]): boolean` — picomatch, `dot: true`. 경로는 `/` 구분, 레포 루트 기준. 폴더처럼 쓴 glob은 그 아래도 맞는다: `/`로 끝나면(`src/auth/`) `src/auth/**`로, 와일드카드가 없으면(`migrations`) 그 경로와 `migrations/**` 둘 다로 본다.
- `firstMatch(path: string, globs: string[]): string | null` — 처음 맞은 glob.
- `globProblem(glob: string): string | null` — 아무 파일에도 맞지 않는 모양(`/`로 시작, `\` 포함, 드라이브 문자)이면 까닭. parseQuality가 glob 칸마다 쓴다.

### `src/core/quality.ts`
- `DEFAULT_GUARD_PATHS: string[]` — `.relay/quality.json`, `.github/workflows/**`, `.gitlab-ci.yml`, `.circleci/**`, `**/eslint.config.*`, `**/.eslintrc*`, `**/tsconfig*.json`, `**/.prettierrc*`, `**/vitest.*`, `**/vite.config.*`, `**/jest.*`, `**/.mocharc*`, `**/playwright.config.*`, `**/pytest.ini`, `**/conftest.py`, `**/tox.ini`, `**/setup.cfg`, `**/.coveragerc`, `**/.gitattributes`, `CODEOWNERS`, `.github/CODEOWNERS`, `docs/CODEOWNERS`. 명령이 기대는 다른 파일(Makefile, justfile, 명령이 부르는 scripts/*.sh)은 레포마다 다르므로 사람이 `guard_paths`에 더한다. package.json의 `scripts`와 pyproject의 `[tool.pytest]`는 signals가 따로 본다.
- `DEFAULT_TEST_GLOBS: string[]` — `**/*.test.*`, `**/*.spec.*`, `**/test_*.py`, `**/*_test.py`, `**/*_test.go`, `**/*Test.java`, `**/*Tests.java`, `**/*Test.kt`, `**/*Tests.kt`, `**/src/test/**`, `test/**`, `tests/**`, `__tests__/**`, `spec/**`.
- `parseQuality(text: string): Result<QualityConfig>` — JSON 파싱, 모양 검사(알 수 없는 키는 오류), 빠진 선택 칸에 기본값(`human_paths: []`, `guard_paths: []`, `public_api: []`, `test_globs: DEFAULT_TEST_GLOBS`, `examples_dir: '.relay/examples'`, `ratchets: []`, `rules: []`, `auto: []`). `version`은 1만. id는 명령·래칫·조건 안에서 겹치면 안 된다. glob 칸(human_paths, guard_paths, public_api, test_globs, auto.paths, 래칫 include·exclude)은 `globProblem`이 있으면 오류. 문자열에 NUL은 오류. `timeout_sec`은 0보다 크고 86400(하루) 이하. 자동 조건은 `max_changed_lines`나 `paths`가 있어야 한다(`hasRealLimit`). 부울 제한(`no_new_dependencies`, `no_new_modules`, `require_all_lines_tested`)은 관문 2단계가 이미 거르므로 다른 제한과 함께만 쓴다.
- `hasRealLimit(c: AutoCondition): boolean` — `max_changed_lines`나 `paths`가 있으면 참. parseQuality와 gate가 같이 쓴다.
- `effectiveGuardPaths(q: QualityConfig): string[]` — 기본 + 사용자.
- `qualityHash(text: string): string` — 내용 해시(순수 JS, 예: FNV-1a 64비트 16진수). 암호 강도는 필요 없다.
- `draftQuality(input: { packageJson?: string; files: string[] }): QualityConfig` — `relay init`의 초안. package.json의 scripts에 `typecheck`·`lint`·`test`가 있으면 명령으로 넣는다. `files`(레포의 파일 목록)에 lockfile이 있으면 setup(`npm ci`/`pnpm install --frozen-lockfile`/`yarn install --frozen-lockfile`)과 `keep: ['node_modules']`. acceptance는 테스트 러너를 알아볼 수 있을 때만(`acceptanceRun`). 러너 뒤의 인자(`--config`, 경로 등)와 앞의 환경 변수·`cross-env`는 남기고 JUnit 출력만 더한다(vitest → `npx vitest run <인자> --reporter=junit --outputFile=.relay-out/junit.xml`, node:test → `node <옵션> --test --test-reporter=junit --test-reporter-destination=.relay-out/junit.xml <인자>`). 이어 붙인 명령, 따옴표·셸 글자, 이미 reporter를 정한 스크립트는 알아보지 못한 것으로 보고 fast의 `test`로 둔다. 래칫 기본 `test_count`(acceptance가 있을 때), `file_lines` max 600. CI 파일(`.github/workflows/*.yml`)이 있으면 `full.ci_checks`는 비워 두고 주석 대신 `rules`에 넣지 않는다(사람이 채운다). `auto`는 늘 `DRAFT_AUTO` 하나: `{ id: 'small', max_changed_lines: 100, no_new_dependencies: true, no_new_modules: true, require_all_lines_tested: true }`(V19: 스위치가 꺼져 있어도 그림자 실적이 첫날부터 쌓이게).

### `src/core/contract.ts`
- `parseContract(text: string): Result<Contract>` — 모양 검사. 줄 id는 `C<숫자>`, 예시 id는 `<줄 id>.<숫자>`. 줄의 `examples`가 계약의 `examples`에 있어야 한다. `check: 'test'`인 change·new·keep 줄은 예시가 하나 이상이어야 한다(remove는 예시 없이도 됨). `human` 종류 줄은 `check: 'human'`. 줄의 선택 칸 `unit`(V21)은 `^[a-z][a-z0-9-]{0,20}$`(영문 소문자로 시작, 영문 소문자·숫자·`-`, 21자까지: V22의 단위 브랜치 이름 `<Work 브랜치>--<단위>`에도 쓸 수 있게). 계약의 선택 칸 `delivery`는 `'one_branch' | 'branch_per_unit'`이고, `branch_per_unit`이면 단위가 둘 이상이고 change·new·remove 줄마다 단위가 있어야 한다(keep·observe·human 줄은 모든 단위에 걸칠 수 있다). 두 칸이 없는 계약은 그 칸 없이 읽힌다(옛 계약의 `contractHash`가 그대로).
- `unitsOf(c: Contract): string[]` — 단위 이름을 줄에 처음 나온 차례로, 겹침 없이(V21).
- `sliceContract(c: Contract, unit: string): Contract` — 한 단위의 조각(V22가 단위 브랜치를 잴 때): 그 단위의 줄과 단위가 없는 줄, 그 줄들의 예시(예시 id의 주인 줄로 고름). 계약 id와 줄 밖의 칸은 그대로이고 `delivery`만 뺀다(조각은 제 브랜치 하나로 간다. branch_per_unit은 단위가 둘 이상이어야 해 조각이 모양 검사를 지나지 못한다).
- `unitBranch(workBranch: string, unit: string): string` — 단위 브랜치의 이름 `<Work 브랜치>--<단위>`(V22).
- `checkRequestQuote(request: string, quote: string): boolean` — 공백 정규화 뒤 포함 여부.
- `checkCodeGround(fileText: string | null, ground: { line: number; name?: string }): { ok: boolean; detail: string }` — 파일이 없으면 실패, 줄 번호가 범위 밖이면 실패, name을 주면 그 줄 ±2줄 안에 있어야 함.
- `exampleTag(contractId: string, id: string): string` → `[<계약 id>:C1.1]`. 태그에 계약 id를 넣어, 머지된 앞 Work의 수용 시험이 레포에 남아도 새 계약의 C1.1 증거로 잡히지 않게 한다. `findExampleTags(testName: string, contractId: string): string[]` — 이름 속 `[<그 계약 id>:C<n>.<n>]`의 예시 id를 모두. 다른 계약의 태그와 계약 id 없는 `[C1.1]`은 찾지 않는다. `withoutExampleTags(testName: string): string` — 어느 계약이든 예시 태그를 뺀 이름(래칫이 같은 시험을 찾을 때).
- `examplesFile(examplesDir: string, contractId: string): string` → `<dir>/<id>.json`.
- `contractHash(c: Contract): string` — 키 순서와 상관없는 내용 해시. 묶음이 어느 계약(어느 판)으로 만들어졌는지 가린다.
- `examplesFileText(c: Contract): string` — 예시 자료의 정규 꼴(V27). 예시 id에서 `{ input, output?, error?, note? }`로 가는 객체다: 예시 id는 번호 차례(C1.2가 C1.10 앞), 예시 안은 input·output·error·note, 값은 계약 그대로(값 속 객체의 열쇠 차례도. 열쇠 차례에 기대는 코드에는 차례가 승인된 자료다). 두 칸 들여쓰기와 끝 줄바꿈. 같은 계약은 예시와 예시 안 칸의 순서와 상관없이 같은 글이다. 앱이 Work의 worktree에 쓰고, check가 수용 시험에 얹는다.
- `checkExamplesFile(contract: Contract, text: string | null): { status: 'same' | 'absent' | 'differs' | 'unreadable'; diffs: ExampleFileDiff[]; error?: string }` — head에 커밋된 예시 자료를 얹은 파일(`examplesFileText`)과 값으로 견준다(V27). 둘 다 JSON.parse한 값이다(시험이 읽는 값: 계약의 Infinity는 얹은 파일에서 null이다). text가 null이면 absent. BOM으로 시작하거나(JSON.parse가 읽지 못한다) JSON이 아니거나 예시 id를 열쇠로 하는 객체가 아니면(계약의 `examples` 같은 배열도) unreadable과 까닭. 그 밖에는 얹은 파일의 예시마다 칸(input, output, error, note, 더 붙은 칸)을 견주고 얹은 파일에 없는 예시를 끝에 더한다. 칸의 값은 엄격히 견준다: 값 속 객체의 열쇠 차례, -0과 0, Infinity와 null이 다르면 다르다. `ExampleFileDiff = { id, field?, expected?, found? }`: field가 없으면 예시가 통째로 없거나(found 없음) 승인본에 없거나(expected 없음) 객체가 아니다. 들여쓰기, 예시와 칸의 차례(시험은 이름으로 찾는다), 숫자를 쓴 꼴(1.0과 1)은 보지 않는다.
- `exampleValueText(v: unknown, max = 40): string` — 차이를 보이는 값(한 줄 JSON, 앞쪽 max자. JSON이 0과 null로 쓰는 -0과 Infinity는 그대로 보인다). gate와 review가 쓴다.

### `src/core/junit.ts`
- `parseJUnit(xml: string): Result<TestCase[]>` — fast-xml-parser. `testsuites`/`testsuite` 중첩, 하나뿐인 testcase, `failure`·`error`·`skipped` 자식, 속성 `name`·`classname`·`file`. 감싼 testsuite 이름은 ` > `로 이어 `suite`에 둔다(맨 위 `testsuites`와 classname·file과 같은 이름은 뺀다. node:test는 describe 이름을 여기에만 낸다). 빈 파일은 오류.

### `src/core/lines.ts`
- `judgeLines(contract: Contract, head: TestCase[] | null, base: TestCase[] | null): LineVerdict[]`
  - 예시 id마다 이 계약의 태그(`findExampleTags(.., contract.id)`)를 이름이나 suite에 담은 testcase를 찾는다(여럿이면 하나라도 failed/error면 failed, 모두 skipped면 skipped).
  - change: 예시마다 head passed이고, 하나 이상이 base에서 failed(단언 실패)여야 met. base에서도 passed인 예시는 그 줄의 지킴으로 보고 detail에 '기준에서도 통과(지킴): C1.2'(M2 평가 배치 1: '하나라도 base에서 passed면 not_met'이 계약 바꾸기 요청의 반을 만들었다). base가 null이면 base는 `not_run`이고 head만으로 met 가능하되 detail에 '기준 실패를 확인하지 못함'. 예시가 모두 base에서 passed면 not_met('기준에서도 통과: 바뀐 동작을 시험하지 않음'). 나머지 판정은 base에서 passed가 아닌 예시로 한다. base가 error면 met으로 보되 detail에 적는다. base가 skipped면 missing_evidence. base에 태그가 없으면(missing) 기준에서 그 시험 파일을 불러오지 못한 경우만 met(+detail)이고 아니면 missing_evidence. 실제 러너는 import 실패를 태그 없는 파일 단위 testcase로 낸다(vitest: name = classname = 파일, node:test: name = 파일, classname = 'test'). head 시험의 파일(file·classname)을 알면 같은 파일의 파일 단위 실패가 있어야 하고, 모르면(node:test) 파일 단위 실패가 하나라도 있어야 하며 detail에 '파일은 확인하지 못함'.
  - new: head passed면 met.
  - keep: head passed이고 base가 null이 아니면 base도 passed여야 met.
  - remove: 예시가 있으면 head passed면 met, 없으면 missing_evidence('쓰는 곳 없음을 보일 시험이 없음').
  - observe → observe, human → human.
  - head가 null(수용 시험을 돌리지 못함)이면 test 줄은 모두 missing_evidence.
  - 태그를 단 testcase가 없으면 missing_evidence.
- `allLinesTestedAndMet(verdicts: LineVerdict[]): boolean` — observe·human 줄이 없고 모두 met.
- `confirmFailures(first: TestCase[], second: TestCase[]): TestCase[]` — 바뀜 줄의 base 실행을 두 번 돌렸을 때 합친다. failed는 두 번 모두 failed여야 남고, 한 번이라도 passed면 passed(V7을 base 실패에도).
- `probeVerdicts(contract: Contract, base: TestCase[], tagged: TestCase[]): LineVerdict[]` — 제출 때 기준 확인(V28). 시험으로 확인하는 바뀜·지킴 줄만 돌려준다. head는 돌리지 않는다: tagged는 head의 시험 파일에서 찾은 태그(TestCase 하나에 태그 하나, file만 본다)이고, 예시의 head는 태그가 있으면 passed, 없으면 missing이다. 태그가 없는 예시는 base not_run으로 두고 judgeChange·judgeKeep(증거의 기준 쪽)을 그대로 부른다. 줄에 태그 시험이 하나도 없으면 missing_evidence('태그를 단 시험이 없어 확인 안 함'). 지킴 줄은 태그 시험이 있는 예시가 기준 결과에 없고 같은 파일의 파일 단위 실패가 있으면 not_met('기준에서 시험 파일을 불러오지 못함 (C2.1)'). 예시의 `message`는 기준의 JUnit 메시지(failed·error의 것, 불러오지 못했으면 `<파일>: <메시지>`). not_met 줄이 있으면 제출을 돌려보낸다.

### `src/core/flaky.ts`
- `classify(head: CommandRun[], base: CommandRun | undefined): CommandOutcome` — V7. head가 비면 not_run. head[0] 통과(exit 0, 시간 초과 아님) → pass. head[0] 실패이고 head[1] 통과 → unstable. head 두 번 실패: base 없음 → fail, base 실패 → pre_existing, base 통과 → fail. head 하나뿐이고 실패 → base로 같은 규칙.
- `needsRerun(first: CommandRun): boolean`, `needsBase(head: CommandRun[]): boolean`.

### `src/core/diff.ts`
- `parseNameStatus(out: string): { status: ChangeStatus; path: string; old_path?: string }[]` — `git diff --name-status -M -z` 출력(NUL 구분).
- `parseNumstat(out: string): { path: string; added: number; deleted: number; binary: boolean }[]` — `git diff --numstat -M -z`(이름 바뀜은 `0\t0\t\0old\0new\0` 모양).
- `parsePatch(out: string): Map<string, { added: string[]; removed: string[] }>` — `git diff -M --no-color --unified=0` 출력. `+++ b/<path>`로 파일을 가르고 `+`/`-` 줄을 모은다(`+++`/`---` 머리는 빼고). `/dev/null`은 지운 파일.
- `buildDiffFacts(base: string, head: string, nameStatus: string, numstat: string, patch: string): DiffFacts`.

### `src/core/signals.ts`
- `detectSignals(input: { diff: DiffFacts; quality: QualityConfig; baseDirs: Set<string>; manifests: ManifestPair[] }): { signals: Signal[]; new_dependencies: string[]; new_modules: string[] }`
  - `ManifestPair = { path: string; base: string | null; head: string | null }` — package.json, requirements*.txt, go.mod, Cargo.toml, pyproject.toml의 base·head 내용.
  - human_path: 바뀐 파일(이름 바뀜은 옛 경로도)이 `human_paths`에 맞으면.
  - guard_path: `effectiveGuardPaths`에 맞으면 / 매니페스트(`src/core/manifests.ts`)에서 명령 정의가 바뀜 — package.json의 `scripts`가 하나라도 바뀜(더함·지움 포함. quality.json은 base 것이지만 `npm run lint`의 뜻은 head의 scripts가 정한다, V9), pyproject의 `[tool.pytest*]` 표가 바뀜.
  - test_weakening: test_globs에 맞는 파일이 지워짐 / 시험 파일을 glob 밖으로 옮기거나 확장자를 바꿈(`a.test.ts` → `a.test.ts.bak`) / 시험 파일의 추가된 줄(주석 줄과 같은 줄을 지운 옮긴 줄은 뺀다)에 건너뛰기·하나만 표식(`\.(skip|only|todo)(\(|\.)`, `\.(skipIf|runIf|fails|failing|fixme)\(`, `\bx(it|describe|test)\(`, `\bf(it|describe)\(`, node:test 옵션 `\b(skip|todo)\s*:\s*`(false·null·undefined·0이 아닌 값), `@pytest\.mark\.(skip|xfail)`, `pytest\.(skip|xfail)\(`, `unittest\.(skip|expectedFailure)`, `skipTest\(`, `t\.Skip(f|Now)?\(`, `#\[ignore\]`, `@Disabled`, `@Ignore`) / 지운 시험·단언 줄이 주석으로 다시 더해짐 / 닫지 않은 블록 주석(`/*`, 문서 주석 `/**`는 뺀다)을 엶 / 시험 파일에서 지운 단언 줄(`expect\(`, `assert`, `should\.`. 주석 줄은 세지 않는다)이 더한 단언 줄보다 많음.
  - structure_change: 새 모듈 — 추가된 파일(test_globs·examples_dir·`.relay/` 밖)의 디렉터리가 baseDirs에 없음(가장 위의 새 디렉터리만 하나로 센다) / 새 의존성 — 매니페스트에서 새 이름(package.json은 dependencies·devDependencies·peerDependencies·optionalDependencies의 키, requirements는 주석·빈 줄·`-r`·`-c`·해시 줄을 뺀 줄의 패키지 이름이고 VCS·주소·옵션 줄은 `#egg=` 이름이나 줄 자체, go.mod는 require의 모듈 경로, Cargo.toml·pyproject는 의존성 표의 키와 배열·인라인 표 속 이름) / 의존성 출처 바뀜 — package.json에 있던 의존성의 버전 글이 레지스트리 밖(`npm:`, `git`, `github:`, `file:`, `link:`, 주소, `user/repo`)으로 바뀜(new_dependencies에도 넣는다) / 새 공개 이름 — public_api 파일의 추가된 줄이 `^\s*export\s`(JS/TS), `^pub\s`(Rust), `^def [A-Za-z]`·`^class [A-Za-z]`(Python 최상위)에 맞음. JS는 여러 줄 export 목록의 식별자 한 줄(`  newThing,`)도 이름으로 센다(--unified=0이라 `export {` 줄은 diff에 없다).
  - 신호의 순서는 human_path, guard_path(경로, 매니페스트), test_weakening, structure_change.

### `src/core/ratchet.ts`
- `fileLinesRatchet(spec, files: { path: string; base: number | null; head: number | null }[]): RatchetResult` — 바뀐 파일만 받는다. null은 그쪽에 없음, 셀 수 없으면 NaN(engine이 남은 파일의 줄 수를 못 읽은 경우). include/exclude glob. head > max이고 (base가 null이거나 base ≤ max이거나 head > base)면 offender. offender가 있으면 worse, 없고 범위 안에 셀 수 없는 파일(0 이상의 정수가 아님)이 있으면 unknown, 없고 base > max였던 파일이 줄었으면 better, 아니면 same.
- `testCountRatchet(spec, base: TestCase[] | null, head: TestCase[] | null): RatchetResult` — 건너뜀 제외 수. 하나라도 null이면 unknown. 수가 같거나 늘어도 base에서 돌던(건너뛰지 않은) 시험이 head에서 없거나 건너뛰면 worse(classname·file·suite·name이 같거나, 파일을 옮겼으면 suite·name이 같은 것을 같은 시험으로 본다. 그래도 짝이 없는 base 시험은 예시 태그 `[<계약 id>:C1.1]`를 경로(suite > name) 마디마다 빼고(태그뿐인 마디는 버림), 앞에서 짝이 없던 head 시험과 하나씩만 짝짓는다: 있던 시험에 태그를 붙이거나 태그 묶음으로 감싸도 같은 시험이고, 태그만 다른 base 시험 둘을 head 하나가 함께 가리지 못한다. detail에는 원래 이름).
- `commandRatchet(spec, base: string | null, head: string | null): RatchetResult` — 표준 출력의 마지막 숫자 줄. 못 읽으면 unknown.

### `src/core/gate.ts`
- `gate(evidence: EvidenceBundle, contract: Contract | null, policy: Policy, head: string | null, whole?: Integration): GateResult` — V5. head는 지금 브랜치 끝의 SHA(모르면 null). whole은 단위 브랜치를 내보낼 때(V22)의 통합 증거 `{ evidence: EvidenceBundle | null; contract; head; facts?: string[] }`(Work 브랜치를 계약 전체로 잰 결정론 증거, 지금 Work 브랜치의 끝, 앱이 본 통합의 사실: 커밋이 Work 브랜치에 다 있지 않은 단위 브랜치)다. 순서:
  1. `contract_change_requested` → recontract.
  2. 사람 머지로 보내는 사실을 모두 모은다(엄격한 것부터): 낡은 증거(묶음의 head ≠ head, head가 null이면 '확인하지 못함', V6), 사람 경로·지킴 파일·시험 약화 신호, 구조 변경 신호, 모르는 종류의 신호, 명령 fail, 명령 unstable·not_run, 래칫 worse, 계약 없음, 묶음의 계약(`contract`의 id·hash)이 넘겨받은 계약과 다름, 줄 not_met·missing_evidence·human·observe, 줄 판정이 계약 줄과 맞지 않음(줄 id·kind·예시 id 집합), 커밋된 예시 자료(`examples_file`, V27)가 없음('예시 자료 파일이 커밋되지 않음: <경로>')·다름('예시 자료가 승인본과 다름: C1.2 output (기대 10, 실제 8)', 차이는 셋까지)·읽지 못함(same이거나 null·없는 칸이면 사실이 아니다), 리뷰 status가 done이 아님, done인데 리뷰가 요청을 보지 않음(`review.request`가 참이 아님, V30이 V15를 넓힘: '리뷰가 요청을 보지 않음'), 리뷰 지적 중 올림인 것(review.ts `raises`, V26: structure/low와 raise가 없는 지적은 메모라 사실이 아니다), `missing`이 빈 배열이 아님, quality.from이 none.
  3. 하나라도 있으면 human_merge, decisive는 첫 사실, reasons는 전부, condition null, shadow false. whole이 있으면 이어서 통합 증거의 열린 것(`integrationFacts(whole)`)을 보고, 있으면 같은 꼴의 human_merge다.
  4. 없으면 policy.conditions에서 처음 채운 조건(diff에 대한 술어: max_changed_lines, paths, no_new_dependencies, no_new_modules, require_all_lines_tested)을 찾는다. whole이 있으면 같은 조건을 Work 전체 diff(통합 증거)로도 채워야 한다(못 채운 까닭 앞에 'Work 전체'). 그래서 브랜치를 나눠도 한 diff로 낼 때보다 자동 조건을 쉽게 채우지 못한다. `hasRealLimit`이 거짓인 조건은 채우지 못한다. max_changed_lines는 `diff.binary`가 비어 있어야 채운다(바이너리는 줄 수로 크기를 잴 수 없다). 없으면 human_merge('채운 자동 조건 없음').
  5. 채웠으면: auto_merge_enabled, server(branch_protected && required_checks && (merge_queue || up_to_date_required)), track_record_ok[id] 셋이 모두 참이면 auto_merge_candidate(shadow false). 하나라도 거짓이면 human_merge이고 shadow true, decisive는 막은 것('프로젝트에서 자동 머지가 꺼져 있음' 등), condition은 그 id.
  - 결론은 엄격한 쪽으로만: 리뷰가 없거나 실패이거나 요청을 보지 않았으면 자동으로 가지 않는다. 올림의 갈래 이름(`RAISE_LABEL`): 예시와 시험 불일치, 보안, 계약 밖 변경, 구조, 요청과 어긋남(request_gap, V30).
- `integrationFacts(w: Integration): string[]` — 통합 증거(V22)의 열린 것: `w.facts`와 리뷰를 뺀 묶음의 열린 것(`openItems(…, false)`)에 앞에 '통합 증거: '를 붙인다. 묶음이 없으면 맨 앞에 '통합 증거 없음'. gate와 앱의 [끝내기]가 같이 쓴다.
- `openItems(evidence: EvidenceBundle, contract: Contract | null, head: string | null, review = true): string[]` — 열린 것(V25, 앱의 [끝내기]): 위 1의 계약 변경 요청(있으면 맨 앞)과 2의 사실 그대로다. gate와 같은 함수로 계산하고 새 판단은 없다. 4·5(자동 조건을 못 채운 까닭, 스위치, 서버 보호, 실적)와 리뷰 메모(올림이 아닌 지적, V26)는 넣지 않는다. review가 거짓이면 리뷰 사실(리뷰 없음, 올림 등)을 보지 않는다(V22의 통합 증거는 리뷰하지 않는다). 비면 [끝내기]가 상자 없이 끝낸다.

### `src/core/debt.ts`
- `parseDebt(text: string, id: string): Result<DebtItem>` / `formatDebt(item: DebtItem): string` — 머리글은 `---` 사이의 `key: value` 줄(anchor는 `anchor.path`, `anchor.name`, `anchor.metric`), 본문은 reason. 한 줄에 그대로 못 쓰는 값(앞뒤·연속 공백, 공백 아닌 빈칸, 제어 글자, 역슬래시, `"`로 시작)은 JSON 문자열로 감싸 쓰고 parseDebt가 푼다. 감싸지 않은 anchor.path의 역슬래시는 오류(사람이 쓴 Windows 경로). 둘은 서로 되돌아온다(까닭의 앞뒤 공백은 빼고).
- `debtFromRatchet(r: RatchetResult, source: string, date: string): DebtItem[]` — worse인 래칫의 offender마다 accepted_regression 항목. id는 `r-<래칫 id>-<경로 슬러그>`. offender가 없는 worse 래칫(시험 수, 명령 지표)은 `anchor.path: .relay/quality.json`, `anchor.metric: <래칫 id>`인 항목 하나(id `r-<래칫 id>`, 까닭에 base → head). date가 시각이면 날짜(YYYY-MM-DD)만 쓴다.
- `touching(items: DebtItem[], paths: string[]): DebtItem[]` — anchor.path가 바뀐 경로와 같거나 그 아래.
- `vanished(items: DebtItem[], exists: (path: string) => boolean): DebtItem[]`.

### `src/core/evidence.ts`
- `summarize(e: EvidenceBundle): string[]` — 사람이 읽는 몇 줄(diff 머리와 바이너리 수, 명령마다 결과, 줄 판정 수, 예시 자료(V27: 승인본과 같음·커밋되지 않음·다름(예시 id)·읽지 못함), 래칫, 신호, 리뷰(상태, 지적 수, 올림 수: review.ts `raises`, V26), 없는 증거).
- `isStale(e: EvidenceBundle, head: string): boolean`.

## adapters

### `src/adapters/exec.ts`
- `run(cmd: string, opts: { cwd: string; timeoutMs: number; env?: Record<string, string> }): Promise<{ exit: number | null; timed_out: boolean; duration_ms: number; stdout: string; stderr: string }>` — `sh -c`(Windows는 `cmd /d /s /c`). 던지지 않는다(명령이나 환경 값의 NUL도 exit null과 stderr로). 시간이 넘으면 프로세스 묶음을 끝낸다. 시간 제한은 타이머 상한(2^31-1ms)으로 자른다. 출력은 뒤쪽 64KB만 남긴다.
- `scrubbedEnv(base: NodeJS.ProcessEnv): Record<string, string>` — 자격 증명을 뺀다: `GH_TOKEN`, `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `NPM_TOKEN`, `SSH_AUTH_SOCK`, `SSH_AGENT_PID`, `GPG_AGENT_INFO`, 그리고 이름(대문자로 바꿔)에 `TOKEN`, `SECRET`, `PASSWORD`·`PASSWD`, `PASSPHRASE`, `CREDENTIAL`, `API_KEY`·`APIKEY`, `ACCESS_KEY`·`PRIVATE_KEY`·`SIGNING_KEY`·`ENCRYPTION_KEY`·`DEPLOY_KEY`·`SSH_KEY`, `ASKPASS`가 들었거나, `_KEY`·`_PAT`로 끝나거나, 조각 머리에 `AUTH`(`AUTHOR`는 뺀다)가 있거나, `NPM_CONFIG_*AUTH*`인 것. git 위치 변수(`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_COMMON_DIR`, `GIT_NAMESPACE`, `GIT_PREFIX`)도 뺀다(git 훅 안에서 relay를 부르면 명령의 git이 사용자 레포를 건드린다). `CI=1`을 넣는다. HOME 아래 설정 파일(~/.npmrc, gh 설정 등)의 자격 증명은 막지 못한다.
- `git(args: string[], cwd: string): Promise<string>` — 실패하면 던진다(stderr 포함. 메시지는 `-c` 설정을 빼고 긴 SHA를 줄여 잘려도 까닭이 남게). git 위치 변수는 뺀다.

### `src/adapters/git.ts`
- `repoRoot(cwd)`, `revParse(repo, ref)`, `mergeBase(repo, a, b)`, `defaultBase(repo)`(origin/HEAD → origin/main → main → master 순으로 있는 것).
- `containsTip(repo, head, tip): Promise<boolean>` — head가 tip의 변경을 모두 담나(V22: 단위 브랜치가 Work 브랜치에 있나). tip이 head의 조상이거나(`merge-base --is-ancestor`), tip을 head에 합쳐도 head의 트리가 그대로면(옮겨 심은 커밋, `merge-tree --write-tree`, git 2.38부터) 참. 충돌하거나 그 명령을 모르면 거짓. merge-tree는 트리 객체만 쓰고 ref는 바꾸지 않는다.
- `diffRaw(repo, base, head): Promise<{ nameStatus: string; numstat: string; patch: string }>`.
- `showFile(repo, sha, path): Promise<string | null>` — 없으면 null.
- `lsTree(repo, sha): Promise<string[]>` — 파일 목록(`ls-tree -r --name-only -z`).
- `dirsOf(files: string[]): Set<string>` — 모든 조상 디렉터리.
- `lineCounts(repo, sha, paths): Promise<Map<string, number | null>>` — 없으면 null, 바이너리는 건너뜀.

### `src/adapters/store.ts`
- `relayHome(env)` — `RELAY_HOME` 또는 `~/.relay-v3`.
- `repoKey(repoRoot: string): string` — 경로 해시 + 폴더 이름.
- `evidencePath(home, key, sha)`, `writeJson(path, value)`, `readJson<T>(path): Promise<T | null>`.
- `baseCache` — `(key, sha, commandId, runHash) → CommandRun` 읽기·쓰기.

### `src/adapters/worktrees.ts`
- `prepareCheckout(home, repoKey, repoRoot, slot: 'base' | 'head', sha, setup?: SetupSpec): Promise<{ dir: string; setupRan: boolean; setupError?: string }>` — V10. 처음이면 `git worktree add --force --detach <dir> <sha>`(폴더가 없는데 등록만 남은 자리를 다시 쓴다. 사용자의 다른 worktree를 지우는 `worktree prune`은 부르지 않는다), 아니면 `git checkout --force --detach <sha>` + `git clean -ffdx` + keep마다 `-e`. 다시 쓰기가 실패하면(남은 index.lock 등) 지우고 처음처럼 만든다. git은 훅 없이 돈다. setup.inputs의 내용 해시가 마지막 setup 때와 다르거나, 그때 있던 keep 경로가 하나라도 없으면 setup.run. keep이 비었거나 setup이 keep 밖에 결과물을 남겼으면 상태를 남기지 않는다(clean이 지우므로 늘 다시 돈다). setup 결과물은 모두 keep 안에 있어야 다시 쓴다.
- `lockWorktrees(home, repoKey, waitMs): Promise<() => Promise<void>>` — 레포 키의 check worktree를 한 check만 쓰게 잠근다(`<home>/worktrees/<키>/.lock`, O_EXCL, pid를 적음). 잡은 프로세스가 죽었으면 넘겨받는다. waitMs 동안 못 잡으면 던진다. 돌려주는 함수로 푼다.
- `overlay(home, dir, repoRoot, fromSha, paths)` — `git checkout <sha> -- <paths>`(바뀜 줄의 base 실행용). 훅 없이 돈다. 지울 경로의 위쪽 조각이 심볼릭 링크면 링크만 지우고 그 너머로 가지 않는다(`removeInside(dir, p)`).
- `writeInside(dir, rel, content): Promise<Buffer | null>` — dir 안의 rel에 쓰고 쓰기 전 내용(없었으면 null)을 돌려준다(V27: 예시 자료의 정규 파일을 check worktree와 Work의 worktree에 쓴다). 없는 폴더는 만든다. `./`와 겹친 `/`는 버린다. 레포 밖·절대 경로·`..`·`.git`, 위쪽 조각이 링크나 파일, 그 자리가 링크나 폴더면 쓰지 않고 던진다(링크 너머에 쓰거나 사람의 폴더를 지우지 않는다).

## engine

### `src/engine/check.ts`
- `check(opts: { repo: string; base?: string; head?: string; contractPath?: string; examplesContractPath?: string; requestPath?: string; home: string; now: string; rerun?: boolean; lockWaitMs?: number }): Promise<EvidenceBundle>` — examplesContractPath는 예시 자료(V27)를 얹고 커밋된 것과 견줄 계약이다(없으면 contractPath). 앱이 단위 브랜치(V22)를 조각으로 잴 때 계약 전체를 준다: 세션이 커밋하는 예시 자료는 앱이 계약 전체에서 쓴 파일 하나다.
  1. repo 루트, head(기본 HEAD), base(기본 `mergeBase(defaultBase, head)`).
  2. quality.json: base에 있으면 base 것, 없으면 head 것, 둘 다 없으면 from none(V9).
  3. diff, 신호(base 디렉터리, 매니페스트 base·head 내용).
  4. worktree 잠금(`lockWorktrees`, 기본 30분 기다림. 못 잡으면 missing에 적고 명령은 not_run). head checkout + setup, fast 명령마다 run → 실패면 한 번 다시 → 두 번 실패면 base checkout에서 그 명령(캐시) → classify. JUnit 자리를 준비하지 못하면(폴더이거나 worktree 밖을 가리키는 링크) 명령은 돌리되 시험 결과는 없다. 계약에 예시가 있으면 acceptance의 head 실행(다시 돌 때도)에는 정규 예시 자료(`examplesFile(examples_dir, 계약 id)`에 `examplesFileText`)를 `writeInside`로 얹고 실행 뒤 되돌린다(V27. 못 되돌리면 head worktree를 다음에 다시 준비한다). fast 명령과 얹지 않은 base 실행(test_count 래칫, V7의 base)은 커밋된 그대로 돈다. 얹지 못하면 missing에 `예시 자료 얹기(<slot>) <경로>: <까닭>`을 적고 커밋된 그대로 돈다.
  5. 계약이 있고 acceptance가 있으면: head의 acceptance 결과(JUnit). change·keep 줄이 있으면 base checkout에 시험 파일(test_globs에 맞는 바뀐 파일)과 examples_dir를 head에서 얹고 그 위에 정규 예시 자료를 써서 acceptance. judgeLines. 바뀜 줄의 예시가 base에서 failed면 얹은 base를 한 번 더 돌려 `confirmFailures`로 합친 뒤 다시 판정한다. 줄 판정은 이렇게 승인된 자료로 돈다. 계약과 품질 기준이 있고 계약에 예시가 있으면 head에 커밋된 예시 자료를 `checkExamplesFile`로 견줘 `examples_file`(`{ path, status, diffs, error? }`)에 둔다(acceptance가 없어도. git이 실패하면 missing). 자료가 달라도 줄 판정은 바꾸지 않는다(관문의 사람 머지 사실). 근거 확인(groundings).
  6. 래칫: file_lines(바뀐 파일의 base·head 줄 수. 남은 파일의 줄 수를 못 읽으면 NaN), test_count(acceptance JUnit base·head. base는 얹지 않은 base에서 돌린 것), command(base·head).
  7. 잠금을 풀고 묶음을 만들어 `evidencePath`에 쓴다. `contract`는 `{ id, hash: contractHash }`(계약이 없으면 null), `diff.binary`는 바이너리 파일 경로, `examples_file`은 5의 견줌(견주지 않았으면 null). review는 null(M2), claims null.
- 어떤 단계든 실패하면 묶음에 `missing`으로 적고 다음으로 간다(명령·래칫·줄 판정이 던져도). 묶음은 늘 나온다.

- check.ts는 `resolveRefs({ repo, base?, head? })`, `loadQuality(root, base, head, missing)`, `readDiff(root, base, head, missing)`를, judge.ts는 `overlayPaths(diff, q)`(바뀐 시험 파일과 옛 자리, 예시 자료 폴더)를 내놓는다. probe.ts가 같은 길을 쓴다.

### `src/engine/probe.ts` — 제출 때 기준 확인 (V28)
- `probeContract(o: { repo: string; head: string; base: string; contract: Contract; home: string; lockWaitMs?: number }): Promise<ContractProbe>` — `ContractProbe { head; base; contract: contractHash(o.contract); ran: boolean; note: string | null; lines: LineVerdict[]; ms: number }`(core/types.ts).
  1. `resolveRefs`(레포나 ref를 찾지 못하면 CheckInputError를 던진다), `loadQuality`(V9). 수용 명령이 없으면 ran false('품질 기준에 수용 시험 명령이 없음').
  2. `overlayPaths(readDiff(..), q)` 가운데 head에서 읽히고 계약 id가 든 파일에서 `:C<n>.<m>]`로 끝나는 태그를 찾는다(`fileTags(text, path, contractId): TestCase[]`, 순수: `[<id>:C1.1]`과 id를 상수로 쓴 `[${T}:C1.1]`. 다른 계약 id를 글자 그대로 쓴 태그는 같은 파일에 남은 앞 Work의 시험이라 세지 않는다). 시험으로 확인하는 바뀜·지킴 줄의 예시 태그가 없으면 ran false('바뀜·지킴 줄의 예시 태그를 단 시험 파일이 head에 없음').
  3. worktree 잠금(check와 같다, 못 잡으면 ran false), `workspace(..).overlaidBaseRun(acceptance, overlayPaths, [canonicalExamples(q, contract)])`를 한 번. 돌리지 못함, 시간 초과('시간 제한 N초를 넘음'), JUnit 없음은 ran false와 note.
  4. `probeVerdicts(contract, run.tests, tagged)`. ms는 부른 때부터.

### `src/engine/init.ts` — 품질 기준 초안 (V19, V20)
- `draftFor(root): Promise<QualityConfig>` — `git ls-files -z --cached --others --exclude-standard`의 파일 목록과 작업 트리의 `package.json`으로 `draftQuality`.
- `draftText(q): string` — 들여 쓴 JSON과 끝 줄바꿈.
- `writeDraft(root): Promise<{ written: boolean; path: string }>` — 작업 트리의 `.relay/quality.json`에 쓴다(`wx`). 이미 있으면 덮지 않고 written false. `relay init --write`와 앱의 [초안 만들기]가 쓴다.

## cli (`src/cli/main.ts`, bin `relay`)

- `relay init [--write]` — 초안을 출력. `--write`면 `.relay/quality.json`이 없을 때만 쓴다.
- `relay check [--base <ref>] [--head <ref>] [--contract <file>] [--request <file>] [--json]` — 요약 줄을 찍고 묶음 경로를 알린다. `--json`이면 묶음 JSON.
- `relay gate [--evidence <file>] [--contract <file>] [--head <ref>] [--auto-merge] [--json]` — 결론과 decisive, reasons. 묶음의 레포에서 `--head`(기본 HEAD)를 읽어 gate에 넘긴다(못 읽으면 null). 서버 보호는 M1에서 null(그래서 자동 조건을 채워도 그림자다. 다만 M1 묶음은 리뷰가 없어 그 전에 '리뷰 없음'으로 사람 머지다).
- `relay debt list|scan` — 목록, 사라진 anchor.
- 종료 코드: 0 성공(결론과 상관없이), 1 사용 오류, 2 내부 오류. SIGINT·SIGTERM·SIGHUP(Windows는 SIGBREAK도)을 받으면 돌던 레포 명령의 프로세스 묶음을 끝내고 128+신호 번호로 끝난다(명령은 자기 묶음에서 돌아 터미널의 신호를 받지 않는다).

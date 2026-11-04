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
- `matchAny(path: string, globs: string[]): boolean` — picomatch, `dot: true`. 경로는 `/` 구분, 레포 루트 기준.
- `firstMatch(path: string, globs: string[]): string | null` — 처음 맞은 glob.

### `src/core/quality.ts`
- `DEFAULT_GUARD_PATHS: string[]` — `.relay/quality.json`, `.github/workflows/**`, `.gitlab-ci.yml`, `.circleci/**`, `**/eslint.config.*`, `**/.eslintrc*`, `**/tsconfig*.json`, `**/.prettierrc*`, `**/vitest.config.*`, `**/vite.config.*`, `**/jest.config.*`, `**/pytest.ini`, `**/.coveragerc`, `CODEOWNERS`, `.github/CODEOWNERS`, `docs/CODEOWNERS`.
- `DEFAULT_TEST_GLOBS: string[]` — `**/*.test.*`, `**/*.spec.*`, `**/test_*.py`, `**/*_test.py`, `**/*_test.go`, `test/**`, `tests/**`, `__tests__/**`, `spec/**`.
- `parseQuality(text: string): Result<QualityConfig>` — JSON 파싱, 모양 검사(알 수 없는 키는 오류), 빠진 선택 칸에 기본값(`human_paths: []`, `guard_paths: []`, `public_api: []`, `test_globs: DEFAULT_TEST_GLOBS`, `examples_dir: '.relay/examples'`, `ratchets: []`, `rules: []`, `auto: []`). `version`은 1만. id는 명령·래칫·조건 안에서 겹치면 안 된다.
- `effectiveGuardPaths(q: QualityConfig): string[]` — 기본 + 사용자.
- `qualityHash(text: string): string` — 내용 해시(순수 JS, 예: FNV-1a 64비트 16진수). 암호 강도는 필요 없다.
- `draftQuality(input: { packageJson?: string; files: string[] }): QualityConfig` — `relay init`의 초안. package.json의 scripts에 `typecheck`·`lint`·`test`가 있으면 명령으로 넣는다. `files`(레포의 파일 목록)에 lockfile이 있으면 setup(`npm ci`/`pnpm install --frozen-lockfile`/`yarn install --frozen-lockfile`)과 `keep: ['node_modules']`. acceptance는 테스트 러너를 알아볼 수 있을 때만(vitest → `npx vitest run --reporter=junit --outputFile=.relay-out/junit.xml`, node:test(`node --test`) → `node --test --test-reporter=junit --test-reporter-destination=.relay-out/junit.xml`). 래칫 기본 `test_count`(acceptance가 있을 때), `file_lines` max 600. CI 파일(`.github/workflows/*.yml`)이 있으면 `full.ci_checks`는 비워 두고 주석 대신 `rules`에 넣지 않는다(사람이 채운다).

### `src/core/contract.ts`
- `parseContract(text: string): Result<Contract>` — 모양 검사. 줄 id는 `C<숫자>`, 예시 id는 `<줄 id>.<숫자>`. 줄의 `examples`가 계약의 `examples`에 있어야 한다. `check: 'test'`인 change·new·keep 줄은 예시가 하나 이상이어야 한다(remove는 예시 없이도 됨). `human` 종류 줄은 `check: 'human'`.
- `checkRequestQuote(request: string, quote: string): boolean` — 공백 정규화 뒤 포함 여부.
- `checkCodeGround(fileText: string | null, ground: { line: number; name?: string }): { ok: boolean; detail: string }` — 파일이 없으면 실패, 줄 번호가 범위 밖이면 실패, name을 주면 그 줄 ±2줄 안에 있어야 함.
- `exampleTag(id: string): string` → `[C1.1]`. `findExampleTags(testName: string): string[]` — 이름 속 `[C<n>.<n>]`를 모두.
- `examplesFile(examplesDir: string, contractId: string): string` → `<dir>/<id>.json`.

### `src/core/junit.ts`
- `parseJUnit(xml: string): Result<TestCase[]>` — fast-xml-parser. `testsuites`/`testsuite` 중첩, 하나뿐인 testcase, `failure`·`error`·`skipped` 자식, 속성 `name`·`classname`·`file`. 빈 파일은 오류.

### `src/core/lines.ts`
- `judgeLines(contract: Contract, head: TestCase[] | null, base: TestCase[] | null): LineVerdict[]`
  - 예시 id마다 그 태그를 이름에 담은 testcase를 찾는다(여럿이면 하나라도 failed/error면 failed, 모두 skipped면 skipped).
  - change: 예시마다 head passed이고, base에서 failed(단언 실패)여야 met. base가 null이면 base는 `not_run`이고 head만으로 met 가능하되 detail에 '기준 실패를 확인하지 못함'. base에서 passed면 not_met('기준에서도 통과: 바뀐 동작을 시험하지 않음'). base가 error면 met으로 보되 detail에 적는다(새 이름이라 못 불러오는 경우).
  - new: head passed면 met.
  - keep: head passed이고 base가 null이 아니면 base도 passed여야 met.
  - remove: 예시가 있으면 head passed면 met, 없으면 missing_evidence('쓰는 곳 없음을 보일 시험이 없음').
  - observe → observe, human → human.
  - head가 null(수용 시험을 돌리지 못함)이면 test 줄은 모두 missing_evidence.
  - 태그를 단 testcase가 없으면 missing_evidence.
- `allLinesTestedAndMet(verdicts: LineVerdict[]): boolean` — observe·human 줄이 없고 모두 met.

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
  - guard_path: `effectiveGuardPaths`에 맞으면.
  - test_weakening: test_globs에 맞는 파일이 지워짐 / 시험 파일의 추가된 줄에 건너뛰기·하나만 표식(`\.skip\(`, `\.only\(`, `\bx(it|describe|test)\(`, `\bf(it|describe)\(`, `\.todo\(`, `@pytest\.mark\.(skip|xfail)`, `unittest\.skip`, `t\.Skip\(`, `#\[ignore\]`, `@Disabled`, `@Ignore`) / 시험 파일에서 지운 단언 줄(`expect\(`, `assert`, `should\.`)이 더한 단언 줄보다 많음.
  - structure_change: 새 모듈 — 추가된 파일(test_globs·examples_dir·`.relay/` 밖)의 디렉터리가 baseDirs에 없음(가장 위의 새 디렉터리만 하나로 센다) / 새 의존성 — 매니페스트에서 새 이름(package.json은 dependencies·devDependencies·peerDependencies·optionalDependencies의 키, requirements는 주석·빈 줄을 뺀 줄의 패키지 이름, go.mod는 require의 모듈 경로, Cargo.toml·pyproject는 의존성 표의 키) / 새 공개 이름 — public_api 파일의 추가된 줄이 `^\s*export\s`(JS/TS), `^pub\s`(Rust), `^def [A-Za-z]`·`^class [A-Za-z]`(Python 최상위)에 맞음.
  - 신호의 순서는 human_path, guard_path, test_weakening, structure_change.

### `src/core/ratchet.ts`
- `fileLinesRatchet(spec, files: { path: string; base: number | null; head: number | null }[]): RatchetResult` — 바뀐 파일만 받는다. include/exclude glob. head > max이고 (base가 null이거나 base ≤ max이거나 head > base)면 offender. offender가 있으면 worse, 없고 base > max였던 파일이 줄었으면 better, 아니면 same.
- `testCountRatchet(spec, base: TestCase[] | null, head: TestCase[] | null): RatchetResult` — 건너뜀 제외 수. 하나라도 null이면 unknown.
- `commandRatchet(spec, base: string | null, head: string | null): RatchetResult` — 표준 출력의 마지막 숫자 줄. 못 읽으면 unknown.

### `src/core/gate.ts`
- `gate(evidence: EvidenceBundle, contract: Contract | null, policy: Policy): GateResult` — V5. 순서:
  1. `contract_change_requested` → recontract.
  2. 사람 머지로 보내는 사실을 모두 모은다(엄격한 것부터): 사람 경로·지킴 파일·시험 약화 신호, 구조 변경 신호, 명령 fail, 명령 unstable·not_run, 래칫 worse, 계약 없음, 줄 not_met·missing_evidence·human·observe, 리뷰 status가 done이 아님, 리뷰 지적 중 raise가 있는 것, `missing`이 빈 배열이 아님, quality.from이 none.
  3. 하나라도 있으면 human_merge, decisive는 첫 사실, reasons는 전부, condition null, shadow false.
  4. 없으면 policy.conditions에서 처음 채운 조건(diff에 대한 술어: max_changed_lines, paths, no_new_dependencies, no_new_modules, require_all_lines_tested)을 찾는다. 없으면 human_merge('채운 자동 조건 없음').
  5. 채웠으면: auto_merge_enabled, server(branch_protected && required_checks && (merge_queue || up_to_date_required)), track_record_ok[id] 셋이 모두 참이면 auto_merge_candidate(shadow false). 하나라도 거짓이면 human_merge이고 shadow true, decisive는 막은 것('프로젝트에서 자동 머지가 꺼져 있음' 등), condition은 그 id.
  - 결론은 엄격한 쪽으로만: 리뷰가 없거나 실패면 자동으로 가지 않는다.

### `src/core/debt.ts`
- `parseDebt(text: string, id: string): Result<DebtItem>` / `formatDebt(item: DebtItem): string` — 머리글은 `---` 사이의 `key: value` 줄(anchor는 `anchor.path`, `anchor.name`, `anchor.metric`), 본문은 reason. 둘은 서로 되돌아온다.
- `debtFromRatchet(r: RatchetResult, source: string, date: string): DebtItem[]` — worse인 래칫의 offender마다 accepted_regression 항목. id는 `r-<래칫 id>-<경로 슬러그>`.
- `touching(items: DebtItem[], paths: string[]): DebtItem[]` — anchor.path가 바뀐 경로와 같거나 그 아래.
- `vanished(items: DebtItem[], exists: (path: string) => boolean): DebtItem[]`.

### `src/core/evidence.ts`
- `summarize(e: EvidenceBundle): string[]` — 사람이 읽는 몇 줄(명령마다 결과, 줄 판정 수, 래칫, 신호, 없는 증거).
- `isStale(e: EvidenceBundle, head: string): boolean`.

## adapters

### `src/adapters/exec.ts`
- `run(cmd: string, opts: { cwd: string; timeoutMs: number; env?: Record<string, string> }): Promise<{ exit: number | null; timed_out: boolean; duration_ms: number; stdout: string; stderr: string }>` — `sh -c`(Windows는 `cmd /d /s /c`). 시간이 넘으면 프로세스 묶음을 끝낸다. 출력은 뒤쪽 64KB만 남긴다.
- `scrubbedEnv(base: NodeJS.ProcessEnv): Record<string, string>` — `GH_TOKEN`, `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `RELAY_*_TOKEN`, `NPM_TOKEN`, `*_SECRET`, `*_PASSWORD`를 뺀다. `CI=1`을 넣는다.
- `git(args: string[], cwd: string): Promise<string>` — 실패하면 던진다(stderr 포함).

### `src/adapters/git.ts`
- `repoRoot(cwd)`, `revParse(repo, ref)`, `mergeBase(repo, a, b)`, `defaultBase(repo)`(origin/HEAD → origin/main → main → master 순으로 있는 것).
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
- `prepareCheckout(home, repoKey, repoRoot, slot: 'base' | 'head', sha, setup?: SetupSpec): Promise<{ dir: string; setupRan: boolean; setupError?: string }>` — V10. 처음이면 `git worktree add --detach <dir> <sha>`, 아니면 `git checkout --force --detach <sha>` + `git clean -ffdx` + keep마다 `-e`. setup.inputs의 내용 해시가 마지막 setup 때와 다르면 setup.run.
- `overlay(dir, repoRoot, fromSha, paths)` — `git checkout <sha> -- <paths>`(바뀜 줄의 base 실행용).

## engine

### `src/engine/check.ts`
- `check(opts: { repo: string; base?: string; head?: string; contractPath?: string; requestPath?: string; home: string; now: string; rerun?: boolean }): Promise<EvidenceBundle>`
  1. repo 루트, head(기본 HEAD), base(기본 `mergeBase(defaultBase, head)`).
  2. quality.json: base에 있으면 base 것, 없으면 head 것, 둘 다 없으면 from none(V9).
  3. diff, 신호(base 디렉터리, 매니페스트 base·head 내용).
  4. head checkout + setup, fast 명령마다 run → 실패면 한 번 다시 → 두 번 실패면 base checkout에서 그 명령(캐시) → classify.
  5. 계약이 있고 acceptance가 있으면: head에서 acceptance(JUnit). change 줄이 있으면 base checkout에 시험 파일(test_globs에 맞는 바뀐 파일)과 examples_dir를 head에서 얹어 acceptance. judgeLines. 근거 확인(groundings).
  6. 래칫: file_lines(바뀐 파일의 base·head 줄 수), test_count(acceptance JUnit base·head. base는 얹지 않은 base에서 돌린 것), command(base·head).
  7. 묶음을 만들어 `evidencePath`에 쓴다. review는 null(M2), claims null.
- 어떤 단계든 실패하면 묶음에 `missing`으로 적고 다음으로 간다. 묶음은 늘 나온다.

## cli (`src/cli/main.ts`, bin `relay`)

- `relay init [--write]` — 초안을 출력. `--write`면 `.relay/quality.json`이 없을 때만 쓴다.
- `relay check [--base <ref>] [--head <ref>] [--contract <file>] [--request <file>] [--json]` — 요약 줄을 찍고 묶음 경로를 알린다. `--json`이면 묶음 JSON.
- `relay gate [--evidence <file>] [--contract <file>] [--auto-merge] [--json]` — 결론과 decisive, reasons. 서버 보호는 M1에서 null(그래서 자동 후보는 늘 그림자).
- `relay debt list|scan` — 목록, 사라진 anchor.
- 종료 코드: 0 성공(결론과 상관없이), 1 사용 오류, 2 내부 오류.

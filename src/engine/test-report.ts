// 수용 시험의 시험 결과 파일 읽기 (V11, V65, V71). 꼴은 CommandSpec.test_format: 없거나 'junit'이면 JUnit XML(core junit.ts),
// 'go-test-json'이면 `go test -json`의 줄마다 JSON(test2json 이벤트), 'cargo-test'면 cargo test의 기본 출력(stdout). 모두 같은
// TestCase[]를 낸다. 순수 함수다(src/core 상한 때문에 engine. JUnit 읽기는 core 그대로).
import { parseJUnit } from '../core/junit.ts'
import { err, ok, type Result } from '../core/result.ts'
import type { CommandSpec, TestCase, TestStatus } from '../core/types.ts'

export type TestFormat = NonNullable<CommandSpec['test_format']>

export function parseTestReport(text: string, format: TestFormat | undefined): Result<TestCase[]> {
  if (format === 'go-test-json') return parseGoTestJson(text)
  if (format === 'cargo-test') return parseCargoTest(text)
  return parseJUnit(text)
}

/** 드라이런·check의 글에서 이 꼴을 부르는 이름 */
export function formatLabel(format: TestFormat | undefined): string {
  return format === 'go-test-json'
    ? 'go test -json 출력'
    : format === 'cargo-test'
      ? 'cargo test 출력'
      : 'JUnit'
}

const MESSAGE_MAX = 500
const RANK: Record<TestStatus, number> = { passed: 0, skipped: 1, error: 2, failed: 3 }
/** go test가 시험마다 찍는 머리 줄(=== RUN, --- FAIL 등). 실패 까닭이 아니다 */
const HEADER = /^(?:=== (?:RUN|PAUSE|CONT|NAME)|--- (?:PASS|FAIL|SKIP):)/

interface Event {
  Action?: unknown
  Package?: unknown
  Test?: unknown
  Output?: unknown
  FailedBuild?: unknown
  ImportPath?: unknown
}

interface Open {
  pkg: string
  name: string
  status: TestStatus | null
  output: string[]
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '')

/** 출력 줄 가운데 머리 줄을 뺀 첫 줄(500자까지) */
function firstMessage(lines: string[]): string | undefined {
  const line = lines.map((l) => l.trim()).find((l) => l !== '' && !HEADER.test(l))
  return line === undefined
    ? undefined
    : line.length > MESSAGE_MAX
      ? `${line.slice(0, MESSAGE_MAX - 1)}…`
      : line
}

/**
 * `go test -json` 출력. 시험(Test가 있는 pass·fail·skip)마다 testcase 하나(classname은 패키지, 하위 시험도 하나씩: gotestsum의
 * JUnit과 같다). 시작했는데 끝나지 않은 시험(시간 초과, 패닉)은 error. 패키지가 실패했는데 실패한 시험이 없으면(빌드 실패,
 * TestMain) 패키지 이름의 error testcase를 하나 더한다. JSON이 아닌 줄은 건너뛰고, 이벤트가 하나도 없으면 오류
 */
export function parseGoTestJson(input: string): Result<TestCase[]> {
  const tests = new Map<string, Open>()
  const failedPackages = new Map<string, string>()
  const buildOutput = new Map<string, string[]>()
  let events = 0
  for (const raw of input.split(/\r?\n/)) {
    if (!raw.trimStart().startsWith('{')) continue
    let e: Event
    try {
      e = JSON.parse(raw) as Event
    } catch {
      continue
    }
    const action = text(e.Action)
    if (action === '') continue
    events++
    const pkg = text(e.Package)
    const name = text(e.Test)
    if (action === 'build-output') {
      // ImportPath는 '패키지 [패키지.test]' 꼴이다
      const path = text(e.ImportPath).split(' ')[0] ?? ''
      buildOutput.set(path, [...(buildOutput.get(path) ?? []), text(e.Output)])
      continue
    }
    if (name === '') {
      if (action === 'fail') failedPackages.set(pkg, text(e.FailedBuild).split(' ')[0] ?? '')
      continue
    }
    const key = `${pkg}\0${name}`
    const t = tests.get(key) ?? { pkg, name, status: null, output: [] }
    tests.set(key, t)
    const status: TestStatus | null =
      action === 'pass'
        ? 'passed'
        : action === 'fail'
          ? 'failed'
          : action === 'skip'
            ? 'skipped'
            : null
    if (action === 'output') t.output.push(...text(e.Output).split('\n'))
    // 같은 시험을 여러 번 돌리면(-count) 센 쪽을 쓴다
    else if (status !== null && (t.status === null || RANK[status] > RANK[t.status]))
      t.status = status
  }
  if (events === 0) return err('go test -json 출력이 아님: 이벤트 줄이 없음')
  const out: TestCase[] = []
  for (const t of tests.values()) {
    const status = t.status ?? 'error'
    const tc: TestCase = { name: t.name, status, classname: t.pkg }
    const message =
      t.status === null
        ? '끝나지 않음(시간 초과나 패닉)'
        : status === 'passed'
          ? undefined
          : firstMessage(t.output)
    if (message !== undefined) tc.message = message
    out.push(tc)
  }
  for (const [pkg, build] of failedPackages) {
    if (out.some((c) => c.classname === pkg && (c.status === 'failed' || c.status === 'error')))
      continue
    // 빌드 출력의 첫 줄은 '# 패키지' 머리다
    const lines = (buildOutput.get(build || pkg) ?? []).filter((l) => !l.startsWith('# '))
    const message = firstMessage(lines) ?? '패키지 실패'
    out.push({ name: pkg, status: 'error', classname: pkg, message })
  }
  return ok(out)
}

// ── cargo test 기본 출력 (V71) ─────────────────────────────────────────────

/** `test 이름 ... ok` / `FAILED` / `ignored`(, 까닭) */
const CARGO_LINE = /^test (.+?) \.\.\. (ok|FAILED|ignored)(?:, (.*))?$/
/** -q(점 꼴)에서 실패한 시험의 줄 */
const CARGO_QUIET_FAIL = /^(.+) --- FAILED$/
const CARGO_SUMMARY =
  /^test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored; \d+ measured; \d+ filtered out/
/** 실패 까닭 덩어리의 머리(`---- 이름 stdout ----`) */
const CARGO_FAILURE = /^---- (.+) (?:stdout|stderr) ----$/
/** 패닉 줄(`thread 'x' (123) panicked at src/lib.rs:5:9:`). 다음 줄이 까닭이다 */
const PANIC = /^thread '.*?'(?: \(\d+\))? panicked at (.+?):?$/

/** 실패 덩어리의 줄들에서 까닭 한 줄: 패닉이면 자리와 다음 줄, 아니면 첫 줄 */
function cargoMessage(lines: string[]): string | undefined {
  const body = lines.map((l) => l.trim()).filter((l) => l !== '' && !/^(?:stdout|stderr):$/.test(l))
  const k = body.findIndex((l) => PANIC.test(l))
  const line =
    k < 0
      ? body[0]
      : `panicked at ${PANIC.exec(body[k] ?? '')?.[1] ?? ''}: ${body[k + 1] ?? ''}`.trim()
  if (line === undefined) return undefined
  return line.length > MESSAGE_MAX ? `${line.slice(0, MESSAGE_MAX - 1)}…` : line
}

/**
 * cargo test의 기본 출력(stdout: 시험 바이너리마다 `running N tests`, 시험마다 `test 이름 ... ok`, 끝에 `test result:` 줄).
 * ok는 passed, FAILED는 failed(까닭은 `---- 이름 stdout ----` 덩어리의 패닉 줄), ignored는 skipped(까닭이 있으면 message).
 * `should panic`의 꼬리는 이름에서 뺀다. -q(점 꼴)는 실패한 시험만 이름(`이름 --- FAILED`)이 있어 나머지는 요약의 수만큼 이름 없는
 * 시험을 더해 수를 맞춘다.
 * 시험 줄도 요약도 없으면(컴파일 실패로 시험이 돌지 않음: 컴파일 오류는 stderr다) 오류
 */
export function parseCargoTest(input: string): Result<TestCase[]> {
  const out: TestCase[] = []
  const messages = new Map<string, string[]>()
  let block: TestCase[] = []
  let failure: string | null = null
  let summaries = 0
  const count = (s: TestStatus) => block.filter((c) => c.status === s).length
  for (const raw of input.split(/\r?\n/)) {
    const line = raw.trimEnd()
    const head = CARGO_FAILURE.exec(line)
    if (head !== null) {
      failure = head[1] ?? ''
      messages.set(failure, [])
      continue
    }
    if (/^failures:$/.test(line) || /^running \d+ tests?$/.test(line)) {
      failure = null
      if (line.startsWith('running')) block = []
      continue
    }
    const sum = CARGO_SUMMARY.exec(line)
    if (sum !== null) {
      summaries++
      failure = null
      const want: [TestStatus, number][] = [
        ['passed', Number(sum[1])],
        ['failed', Number(sum[2])],
        ['skipped', Number(sum[3])],
      ]
      for (const [status, n] of want)
        for (let k = count(status); k < n; k++)
          out.push({ name: `(이름 없는 시험 ${out.length + 1})`, status })
      block = []
      continue
    }
    if (failure !== null) {
      messages.get(failure)?.push(line)
      continue
    }
    const quiet = CARGO_QUIET_FAIL.exec(line)
    const m = CARGO_LINE.exec(line) ?? (quiet === null ? null : [line, quiet[1], 'FAILED'])
    if (m === null) continue
    const status: TestStatus = m[2] === 'ok' ? 'passed' : m[2] === 'FAILED' ? 'failed' : 'skipped'
    const tc: TestCase = { name: (m[1] ?? '').replace(/ - should panic(?: with .*)?$/, ''), status }
    if (status === 'skipped' && m[3] !== undefined && m[3] !== '') tc.message = m[3]
    out.push(tc)
    block.push(tc)
  }
  if (out.length === 0 && summaries === 0)
    return err('cargo test 출력이 아님: 시험 줄도 test result 줄도 없음')
  for (const tc of out) {
    if (tc.status !== 'failed') continue
    const message = cargoMessage(messages.get(tc.name) ?? [])
    if (message !== undefined) tc.message = message
  }
  return ok(out)
}

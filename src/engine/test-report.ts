// 수용 시험의 시험 결과 파일 읽기 (V11, V65). 꼴은 CommandSpec.test_format: 없거나 'junit'이면 JUnit XML(core junit.ts),
// 'go-test-json'이면 `go test -json`의 줄마다 JSON(test2json 이벤트). 둘 다 같은 TestCase[]를 낸다. 순수 함수다(src/core 상한
// 때문에 engine. JUnit 읽기는 core 그대로).
import { parseJUnit } from '../core/junit.ts'
import { err, ok, type Result } from '../core/result.ts'
import type { CommandSpec, TestCase, TestStatus } from '../core/types.ts'

export type TestFormat = NonNullable<CommandSpec['test_format']>

export function parseTestReport(text: string, format: TestFormat | undefined): Result<TestCase[]> {
  return format === 'go-test-json' ? parseGoTestJson(text) : parseJUnit(text)
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

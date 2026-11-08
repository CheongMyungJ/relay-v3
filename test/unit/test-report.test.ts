// [단위] 시험 결과 파일 읽기(V65, engine/test-report.ts): `go test -json`의 출력을 JUnit과 같은 TestCase로. 자료는 이 기계의
// go 1.24가 실제로 낸 출력이다(test/fixtures/go-test-json/: 통과·실패·건너뜀·하위 시험·시험 없는 패키지·빌드 실패, 시간 초과).
// 수용 시험이 실제 go로 그 파일을 쓰고 앱이 읽는 것은 [어댑터] draft-dry-run.test.ts.
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { parseGoTestJson, parseTestReport } from '../../src/engine/test-report.ts'

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/go-test-json/${name}`, import.meta.url), 'utf8')

describe('go test -json', () => {
  test('시험마다 testcase 하나(하위 시험 포함), classname은 패키지, 실패·건너뜀은 첫 출력 줄이 까닭', () => {
    expect(parseGoTestJson(fixture('mixed.jsonl'))).toEqual({
      ok: true,
      value: [
        { name: 'TestAdd', status: 'passed', classname: 'example.com/calc/calc' },
        { name: 'TestSub', status: 'failed', classname: 'example.com/calc/calc' },
        { name: 'TestSub/zero', status: 'passed', classname: 'example.com/calc/calc' },
        {
          name: 'TestSub/neg',
          status: 'failed',
          classname: 'example.com/calc/calc',
          message: 'calc_test.go:13: want 1, got 2',
        },
        {
          name: 'TestSkip',
          status: 'skipped',
          classname: 'example.com/calc/calc',
          message: 'calc_test.go:16: later',
        },
        // 빌드가 안 된 패키지는 시험이 없어 패키지 이름의 error 하나(시험 수가 준다)
        {
          name: 'example.com/calc/broken',
          status: 'error',
          classname: 'example.com/calc/broken',
          message: 'broken/broken_test.go:5:28: undefined: undefined',
        },
      ],
    })
  })

  test('끝나지 않은 시험(시간 초과)은 error이고 패키지 실패를 따로 더하지 않는다', () => {
    expect(parseGoTestJson(fixture('timeout.jsonl'))).toEqual({
      ok: true,
      value: [
        { name: 'TestFast', status: 'passed', classname: 'example.com/calc/slow' },
        {
          name: 'TestHang',
          status: 'error',
          classname: 'example.com/calc/slow',
          message: '끝나지 않음(시간 초과나 패닉)',
        },
      ],
    })
  })

  test('같은 시험을 여러 번 돌리면(-count) 센 결과 하나, JSON이 아닌 줄은 건너뜀', () => {
    const ev = (Action: string) =>
      JSON.stringify({ Action, Package: 'p', Test: 'TestA', Elapsed: 0 })
    const text = ['go: downloading x', ev('run'), ev('pass'), ev('run'), ev('fail'), '{bad'].join(
      '\n',
    )
    expect(parseGoTestJson(text)).toEqual({
      ok: true,
      value: [{ name: 'TestA', status: 'failed', classname: 'p' }],
    })
  })

  test('시험 없는 패키지뿐이면 빈 목록, 이벤트가 없으면 오류', () => {
    const skip = JSON.stringify({ Action: 'skip', Package: 'p', Elapsed: 0 })
    expect(parseGoTestJson(skip)).toEqual({ ok: true, value: [] })
    expect(parseGoTestJson('')).toMatchObject({ ok: false })
    expect(parseGoTestJson('<testsuites/>')).toMatchObject({ ok: false })
  })

  test('꼴을 고른다: 없거나 junit이면 JUnit XML', () => {
    const xml = '<testsuites><testcase name="a" classname="c"/></testsuites>'
    const one = { ok: true, value: [{ name: 'a', status: 'passed', classname: 'c' }] }
    expect(parseTestReport(xml, undefined)).toEqual(one)
    expect(parseTestReport(xml, 'junit')).toEqual(one)
    expect(parseTestReport(xml, 'go-test-json')).toMatchObject({ ok: false })
  })
})

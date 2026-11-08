// [단위] 시험 결과 파일 읽기(V65·V69, engine/test-report.ts): `go test -json`과 cargo test의 기본 출력을 JUnit과 같은 TestCase로.
// 자료는 이 기계의 go 1.24와 cargo 1.99가 실제로 낸 출력이다(test/fixtures/go-test-json/: 통과·실패·건너뜀·하위 시험·시험 없는
// 패키지·빌드 실패, 시간 초과 / test/fixtures/cargo-test/: 작은 crate의 --no-fail-fast(실패·ignored·should_panic·통합 시험·doc
// 시험), -q, RUST_BACKTRACE=1, 시범 레포 itoa). 수용 시험이 실제 도구로 그 파일을 쓰고 앱이 읽는 것은 [어댑터] draft-dry-run.test.ts.
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  formatLabel,
  parseCargoTest,
  parseGoTestJson,
  parseTestReport,
} from '../../src/engine/test-report.ts'

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
    expect(parseTestReport(xml, 'cargo-test')).toMatchObject({ ok: false })
    expect(
      ['junit', 'go-test-json', 'cargo-test', undefined].map((f) => formatLabel(f as never)),
    ).toEqual(['JUnit', 'go test -json 출력', 'cargo test 출력', 'JUnit'])
  })
})

const cargo = (name: string) =>
  readFileSync(new URL(`../fixtures/cargo-test/${name}`, import.meta.url), 'utf8')

describe('cargo test 기본 출력 (V69)', () => {
  const ASSERT = 'panicked at src/lib.rs:26:9: assertion `left == right` failed: math is broken'
  test('시험 줄마다 testcase 하나: ok·FAILED·ignored(까닭), should panic 꼬리 뺌, 통합 시험과 doc 시험, 실패 까닭은 패닉 줄', () => {
    expect(parseCargoTest(cargo('fail.txt'))).toEqual({
      ok: true,
      value: [
        { name: 'tests::online', status: 'skipped', message: 'needs network' },
        { name: 'tests::slow', status: 'skipped' },
        { name: 'tests::breaks', status: 'failed', message: ASSERT },
        { name: 'tests::panics', status: 'passed' },
        { name: 'tests::adds', status: 'passed' },
        { name: 'adds', status: 'passed' },
        { name: 'src/lib.rs - add (line 3)', status: 'passed' },
        {
          name: 'src/lib.rs - two (line 10)',
          status: 'failed',
          message: 'panicked at src/lib.rs:5:1: assertion `left == right` failed',
        },
      ],
    })
  })

  test('RUST_BACKTRACE=1의 스택은 까닭이 아니다. 시범 레포 itoa: 빈 대상, 시험 11, doc 시험 2', () => {
    const bt = parseCargoTest(cargo('backtrace.txt'))
    expect(bt.ok && bt.value.find((c) => c.status === 'failed')).toEqual({
      name: 'tests::breaks',
      status: 'failed',
      message: ASSERT,
    })
    const itoa = parseCargoTest(cargo('itoa.txt'))
    expect(itoa.ok && itoa.value.length).toBe(13)
    expect(itoa.ok && itoa.value.every((c) => c.status === 'passed')).toBe(true)
  })

  test('-q(점 꼴): 실패한 시험은 이름으로, 나머지는 요약의 수만큼 이름 없는 시험', () => {
    const r = parseCargoTest(cargo('quiet.txt'))
    if (!r.ok) throw new Error(r.errors.join('; '))
    const by = (s: string) => r.value.filter((c) => c.status === s).length
    expect([r.value.length, by('passed'), by('failed'), by('skipped')]).toEqual([8, 4, 2, 2])
    expect(r.value.filter((c) => c.status === 'failed').map((c) => c.name)).toEqual([
      'tests::breaks',
      'src/lib.rs - two (line 10)',
    ])
    expect(r.value.find((c) => c.status === 'failed')?.message).toBe(ASSERT)
  })

  test('시험 0개(test result 줄만)는 빈 목록, 시험 줄도 요약도 없으면(컴파일 실패) 오류', () => {
    const empty =
      '\nrunning 0 tests\n\ntest result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s\n'
    expect(parseCargoTest(empty)).toEqual({ ok: true, value: [] })
    expect(parseCargoTest('')).toMatchObject({ ok: false })
    expect(
      parseTestReport('{"Action":"pass","Test":"T","Package":"p"}', 'cargo-test'),
    ).toMatchObject({
      ok: false,
    })
  })
})

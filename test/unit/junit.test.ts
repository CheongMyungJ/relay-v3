import { describe, expect, test } from 'vitest'
import { parseJUnit } from '../../src/core/junit.ts'
import type { TestCase } from '../../src/core/types.ts'

function casesOf(xml: string): TestCase[] {
  const r = parseJUnit(xml)
  if (!r.ok) throw new Error(`통과를 기대함: ${r.errors.join(' / ')}`)
  return r.value
}

function errorsOf(xml: string): string[] {
  const r = parseJUnit(xml)
  if (r.ok) throw new Error('오류를 기대했지만 통과함')
  return r.errors
}

// 아래 고정 자료는 각 러너를 실제로 돌려 뜬 것이다. 스택과 경로만 줄였다.

// node --test --test-reporter=junit (Node 22.23)
const NODE_TEST = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
	<testcase name="broken.test.mjs" time="0.061929" classname="test" failure="test failed">
		<failure type="testCodeFailure" message="test failed">
[Error: test failed] { code: 'ERR_TEST_FAILURE', failureType: 'testCodeFailure', cause: 'test failed', exitCode: 1, signal: null }
		</failure>
	</testcase>
	<testsuite name="합계 [C1.1]" time="0.005681" disabled="0" errors="0" tests="5" failures="2" skipped="2" hostname="vm">
		<testsuite name="안 [C1.2]" time="0.001473" disabled="0" errors="0" tests="1" failures="0" skipped="0" hostname="vm">
			<testcase name="깊은 시험 [C1.2]" time="0.000628" classname="test"/>
		</testsuite>
		<testcase name="빈 줄은 건너뛴다 [C1.1]" time="0.001003" classname="test"/>
		<testcase name="숫자 아님은 오류 [C2.1]" time="0.001061" classname="test" failure="Expected values to be strictly equal:1 !== 2">
			<failure type="testCodeFailure" message="Expected values to be strictly equal:1 !== 2">
Error [ERR_TEST_FAILURE]: Expected values to be strictly equal:

1 !== 2

      at TestContext.&lt;anonymous> (file:///repo/sample.test.mjs:5:43)
			</failure>
		</testcase>
		<testcase name="건너뜀 [C3.1]" time="0.000207" classname="test">
			<skipped type="skipped" message="나중에"/>
		</testcase>
		<testcase name="할 일 [C3.2]" time="0.000177" classname="test">
			<skipped type="todo" message="true"/>
		</testcase>
		<testcase name="던짐 &lt;&amp;> &amp;quot;q&amp;quot;" time="0.000180" classname="test" failure="x is not a function">
			<failure type="testCodeFailure" message="x is not a function">
[Error [ERR_TEST_FAILURE]: x is not a function] { code: 'ERR_TEST_FAILURE' }
			</failure>
		</testcase>
		<testcase name="시간 초과" time="0.010152" classname="test" failure="test timed out after 10ms">
			<failure type="testTimeoutFailure" message="test timed out after 10ms">
[Error [ERR_TEST_FAILURE]: test timed out after 10ms] { code: 'ERR_TEST_FAILURE', failureType: 'testTimeoutFailure' }
			</failure>
		</testcase>
	</testsuite>
	<testsuite name="훅" time="0.002082" disabled="0" errors="0" tests="2" failures="2" skipped="0" hostname="vm">
		<testcase name="훅 뒤 [C4.1]" time="0.000000" classname="test" failure="test did not finish before its parent and was cancelled">
			<failure type="cancelledByParent" message="test did not finish before its parent and was cancelled">
[Error [ERR_TEST_FAILURE]: test did not finish before its parent and was cancelled] { code: 'ERR_TEST_FAILURE' }
			</failure>
		</testcase>
		<testcase name="훅 뒤 [C4.2]" time="0.000955" classname="test" failure="failed running beforeEach hook">
			<failure type="hookFailed" message="failed running beforeEach hook">
Error [ERR_TEST_FAILURE]: failed running beforeEach hook
			</failure>
		</testcase>
	</testsuite>
	<testcase name="최상위" time="0.000125" classname="test"/>
	<!-- tests 9 -->
	<!-- duration_ms 121.036367 -->
</testsuites>
`

// vitest run --reporter=junit (vitest 5.1, addFileAttribute 켬)
const VITEST = `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites name="vitest tests" tests="5" failures="2" errors="0" time="0.017083833">
    <testsuite name="a.test.ts" timestamp="2026-11-04T03:17:10.183Z" hostname="vm" tests="4" failures="1" errors="0" skipped="2" time="0.017083833">
        <testcase classname="a.test.ts" file="a.test.ts" name="합계 &gt; 안쪽 &gt; 빈 줄은 건너뛴다 [C1.1]" time="0.002988565">
        </testcase>
        <testcase classname="a.test.ts" file="a.test.ts" name="합계 &gt; 숫자 아님은 오류 [C2.1]" time="0.009415476">
            <failure message="expected 1 to be 2 // Object.is equality" type="AssertionError">
AssertionError: expected 1 to be 2 // Object.is equality

- Expected
+ Received

- 2
+ 1

 ❯ a.test.ts:6:46
            </failure>
        </testcase>
        <testcase classname="a.test.ts" file="a.test.ts" name="합계 &gt; 건너뜀 [C3.1]" time="0">
            <skipped/>
        </testcase>
        <testcase classname="a.test.ts" file="a.test.ts" name="합계 &gt; 던짐 &lt;&amp;&gt; &quot;q&quot;" time="0.00161725">
            <failure message="x is not a function" type="TypeError">
TypeError: x is not a function
 ❯ a.test.ts:9:34
            </failure>
        </testcase>
    </testsuite>
    <testsuite name="c.test.ts" timestamp="2026-11-04T03:17:10.191Z" hostname="vm" tests="1" failures="1" errors="0" skipped="0" time="0">
        <testcase classname="c.test.ts" file="c.test.ts" name="c.test.ts" time="0">
            <failure message="Cannot find module &apos;./missing-module.ts&apos; imported from /repo/c.test.ts" type="Error">
Error: Cannot find module &apos;./missing-module.ts&apos; imported from /repo/c.test.ts
 ❯ c.test.ts:1:1
            </failure>
        </testcase>
    </testsuite>
</testsuites>
`

// pytest --junitxml (pytest 9.2, 기본 xunit2). 한 줄로 쓴다
const PYTEST =
  '<?xml version="1.0" encoding="utf-8"?><testsuites name="pytest tests"><testsuite name="pytest" errors="2" failures="2" skipped="2" tests="8" time="0.041" timestamp="2026-11-04T03:20:49.063574+00:00" hostname="vm">' +
  '<testcase classname="tests.test_sum" name="test_blank[C1.1]" time="0.001" />' +
  '<testcase classname="tests.test_sum" name="test_not_number_C2_1" time="0.001"><failure message="assert 1 == 2">def test_not_number_C2_1():\n&gt;       assert 1 == 2\nE       assert 1 == 2\n\ntests/test_sum.py:17: AssertionError</failure></testcase>' +
  '<testcase classname="tests.test_sum" name="test_skip" time="0.000"><skipped type="pytest.skip" message="나중에">/repo/tests/test_sum.py:19: 나중에</skipped></testcase>' +
  '<testcase classname="tests.test_sum" name="test_xfail" time="0.000"><skipped type="pytest.xfail" message="알려진 버그" /></testcase>' +
  '<testcase classname="tests.test_sum" name="test_setup_error" time="0.000"><error message="failed on setup with &quot;RuntimeError: boom&quot;">@pytest.fixture\n    def broken():\n&gt;       raise RuntimeError("boom")</error></testcase>' +
  '<testcase classname="tests.test_sum" name="test_fail_and_teardown" time="0.000"><failure message="assert 0">E       assert 0</failure></testcase>' +
  '<testcase classname="tests.test_sum" name="test_fail_and_teardown" time="0.000"><error message="failed on teardown with &quot;RuntimeError: teardown boom&quot;">E       RuntimeError: teardown boom</error></testcase>' +
  '<testcase classname="tests.test_sum.TestKlass" name="test_method" time="0.000" />' +
  '</testsuite></testsuites>'

// pytest -o junit_family=xunit1: testcase에 file·line이 붙는다
const PYTEST_XUNIT1 =
  '<?xml version="1.0" encoding="utf-8"?><testsuites name="pytest tests"><testsuite name="pytest" errors="0" failures="0" skipped="0" tests="1" time="0.033" hostname="vm">' +
  '<testcase classname="tests.test_sum" name="test_blank[C1.1]" file="tests/test_sum.py" line="11" time="0.001" />' +
  '</testsuite></testsuites>'

// pytest 수집 실패: 모듈 이름의 testcase 하나, classname은 빈 글
const PYTEST_COLLECT =
  '<?xml version="1.0" encoding="utf-8"?><testsuites name="pytest tests"><testsuite name="pytest" errors="1" failures="0" skipped="0" tests="1" time="0.123" hostname="vm">' +
  '<testcase classname="" name="tests.test_broken_import" time="0.000"><error message="collection failure">ImportError while importing test module</error></testcase>' +
  '</testsuite></testsuites>'

// jest 29 + jest-junit 16 (addFileAttribute, reportTestSuiteErrors 켬)
const JEST = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="jest tests" tests="4" failures="1" errors="1" time="0.368">
  <testsuite name="합계" errors="0" failures="1" skipped="1" timestamp="2026-11-04T03:21:22" time="0.249" tests="4">
    <testcase classname="합계 안쪽 빈 줄은 건너뛴다 [C1.1]" name="합계 안쪽 빈 줄은 건너뛴다 [C1.1]" time="0.003" file="sum.test.js">
    </testcase>
    <testcase classname="합계 숫자 아님은 오류 [C2.1]" name="합계 숫자 아님은 오류 [C2.1]" time="0.004" file="sum.test.js">
      <failure>Error: expect(received).toBe(expected) // Object.is equality

Expected: 2
Received: 1
    at Object.toBe (/repo/sum.test.js:5:46)
    at new Promise (&lt;anonymous&gt;)</failure>
    </testcase>
    <testcase classname="합계 건너뜀 [C3.1]" name="합계 건너뜀 [C3.1]" time="0" file="sum.test.js">
      <skipped/>
    </testcase>
    <testcase classname="합계 할 일 [C3.2]" name="합계 할 일 [C3.2]" time="0" file="sum.test.js">
    </testcase>
    <testcase classname=" 최상위" name=" 최상위" time="0" file="sum.test.js">
    </testcase>
  </testsuite>
  <testsuite name="broken.test.js" errors="1" failures="0" skipped="0" timestamp="1970-01-01T00:00:00" time="0" tests="0">
    <testcase classname="Test suite failed to run" name="broken.test.js" time="0" file="broken.test.js">
      <error>  ● Test suite failed to run

    Cannot find module &apos;./nowhere&apos; from &apos;broken.test.js&apos;
</error>
    </testcase>
  </testsuite>
</testsuites>
`

describe('parseJUnit: 러너별 실제 모양', () => {
  test('node:test의 겹친 testsuite와 testsuites 바로 아래 testcase를 문서 순서대로 모두 읽는다', () => {
    const cases = casesOf(NODE_TEST)
    expect(cases.map((c) => c.name)).toEqual([
      'broken.test.mjs',
      '깊은 시험 [C1.2]',
      '빈 줄은 건너뛴다 [C1.1]',
      '숫자 아님은 오류 [C2.1]',
      '건너뜀 [C3.1]',
      '할 일 [C3.2]',
      '던짐 <&> &quot;q&quot;',
      '시간 초과',
      '훅 뒤 [C4.1]',
      '훅 뒤 [C4.2]',
      '최상위',
    ])
  })

  test('node:test의 실패·건너뜀·할 일을 상태와 메시지로 옮긴다', () => {
    const byName = new Map(casesOf(NODE_TEST).map((c) => [c.name, c]))
    expect(byName.get('빈 줄은 건너뛴다 [C1.1]')).toEqual({
      name: '빈 줄은 건너뛴다 [C1.1]',
      suite: '합계 [C1.1]',
      classname: 'test',
      status: 'passed',
    })
    expect(byName.get('숫자 아님은 오류 [C2.1]')).toEqual({
      name: '숫자 아님은 오류 [C2.1]',
      suite: '합계 [C1.1]',
      classname: 'test',
      status: 'failed',
      message: 'Expected values to be strictly equal:1 !== 2',
    })
    expect(byName.get('건너뜀 [C3.1]')?.status).toBe('skipped')
    expect(byName.get('건너뜀 [C3.1]')?.message).toBe('나중에')
    expect(byName.get('할 일 [C3.2]')?.status).toBe('skipped')
    expect(byName.get('시간 초과')?.status).toBe('failed')
  })

  test('node:test의 훅 실패와 부모 취소는 단언 실패가 아니라 error다', () => {
    const byName = new Map(casesOf(NODE_TEST).map((c) => [c.name, c]))
    expect(byName.get('훅 뒤 [C4.1]')?.status).toBe('error')
    expect(byName.get('훅 뒤 [C4.2]')).toMatchObject({
      status: 'error',
      message: 'failed running beforeEach hook',
    })
  })

  test('node:test의 describe 이름(testsuite)은 겹친 순서대로 suite에 남긴다', () => {
    const byName = new Map(casesOf(NODE_TEST).map((c) => [c.name, c]))
    expect(byName.get('깊은 시험 [C1.2]')?.suite).toBe('합계 [C1.1] > 안 [C1.2]')
    expect(byName.get('최상위')?.suite).toBeUndefined()
  })

  test('node:test가 못 불러온 파일은 파일 이름의 testcase 하나로 나온다', () => {
    expect(casesOf(NODE_TEST)[0]).toMatchObject({ name: 'broken.test.mjs', status: 'failed' })
  })

  test('vitest는 testsuite가 파일 이름(classname과 같음)이라 suite를 남기지 않는다', () => {
    expect(casesOf(VITEST).every((c) => c.suite === undefined)).toBe(true)
  })

  test('vitest의 describe 경로 이름, file 속성, 엔티티를 그대로 읽는다', () => {
    const cases = casesOf(VITEST)
    expect(cases).toEqual([
      {
        name: '합계 > 안쪽 > 빈 줄은 건너뛴다 [C1.1]',
        classname: 'a.test.ts',
        file: 'a.test.ts',
        status: 'passed',
      },
      {
        name: '합계 > 숫자 아님은 오류 [C2.1]',
        classname: 'a.test.ts',
        file: 'a.test.ts',
        status: 'failed',
        message: 'expected 1 to be 2 // Object.is equality',
      },
      {
        name: '합계 > 건너뜀 [C3.1]',
        classname: 'a.test.ts',
        file: 'a.test.ts',
        status: 'skipped',
      },
      {
        name: '합계 > 던짐 <&> "q"',
        classname: 'a.test.ts',
        file: 'a.test.ts',
        status: 'failed',
        message: 'x is not a function',
      },
      {
        name: 'c.test.ts',
        classname: 'c.test.ts',
        file: 'c.test.ts',
        status: 'failed',
        message: "Cannot find module './missing-module.ts' imported from /repo/c.test.ts",
      },
    ])
  })

  test('pytest의 매개변수 id, skip·xfail, 준비 오류를 읽는다', () => {
    const cases = casesOf(PYTEST)
    expect(cases.map((c) => [c.name, c.status])).toEqual([
      ['test_blank[C1.1]', 'passed'],
      ['test_not_number_C2_1', 'failed'],
      ['test_skip', 'skipped'],
      ['test_xfail', 'skipped'],
      ['test_setup_error', 'error'],
      ['test_fail_and_teardown', 'failed'],
      ['test_fail_and_teardown', 'error'],
      ['test_method', 'passed'],
    ])
    expect(cases[4]?.message).toBe('failed on setup with "RuntimeError: boom"')
    expect(cases[7]?.classname).toBe('tests.test_sum.TestKlass')
  })

  test('pytest xunit1의 file 속성을 읽는다', () => {
    expect(casesOf(PYTEST_XUNIT1)).toEqual([
      {
        name: 'test_blank[C1.1]',
        suite: 'pytest',
        classname: 'tests.test_sum',
        file: 'tests/test_sum.py',
        status: 'passed',
      },
    ])
  })

  test('pytest 수집 실패는 빈 classname을 빼고 error로 읽는다', () => {
    expect(casesOf(PYTEST_COLLECT)).toEqual([
      {
        name: 'tests.test_broken_import',
        suite: 'pytest',
        status: 'error',
        message: 'collection failure',
      },
    ])
  })

  test('jest-junit의 message 없는 failure는 본문 첫 줄을 메시지로 쓴다', () => {
    const cases = casesOf(JEST)
    expect(cases[1]).toEqual({
      name: '합계 숫자 아님은 오류 [C2.1]',
      suite: '합계',
      classname: '합계 숫자 아님은 오류 [C2.1]',
      file: 'sum.test.js',
      status: 'failed',
      message: 'Error: expect(received).toBe(expected) // Object.is equality',
    })
    expect(cases[5]).toMatchObject({
      name: 'broken.test.js',
      status: 'error',
      message: '● Test suite failed to run',
    })
  })

  test('jest-junit의 todo는 자식이 없어 통과로 읽힌다(러너의 모양 그대로)', () => {
    const cases = casesOf(JEST)
    expect(cases.map((c) => [c.name, c.status])).toEqual([
      ['합계 안쪽 빈 줄은 건너뛴다 [C1.1]', 'passed'],
      ['합계 숫자 아님은 오류 [C2.1]', 'failed'],
      ['합계 건너뜀 [C3.1]', 'skipped'],
      ['합계 할 일 [C3.2]', 'passed'],
      ['최상위', 'passed'],
      ['broken.test.js', 'error'],
    ])
  })
})

describe('parseJUnit: 일반 모양', () => {
  test('testsuite가 맨 위여도 읽는다', () => {
    const xml = '<testsuite name="s" tests="1"><testcase name="하나 [C1.1]"/></testsuite>'
    expect(casesOf(xml)).toEqual([{ name: '하나 [C1.1]', suite: 's', status: 'passed' }])
  })

  test('testcase가 하나뿐이어도 배열로 돌려준다', () => {
    const xml = '<testsuites><testsuite><testcase name="t" classname="k"/></testsuite></testsuites>'
    expect(casesOf(xml)).toEqual([{ name: 't', classname: 'k', status: 'passed' }])
  })

  test('testcase가 없는 문서는 빈 배열이다', () => {
    expect(casesOf('<testsuites/>')).toEqual([])
    expect(
      casesOf('<testsuites name="x"><testsuite name="s" tests="0"></testsuite></testsuites>'),
    ).toEqual([])
  })

  test('한 testcase에 failure와 error가 함께 있으면 failure를 쓴다', () => {
    const xml =
      '<testsuite><testcase name="t"><error message="뒷정리"/><failure message="단언"/></testcase></testsuite>'
    expect(casesOf(xml)).toEqual([{ name: 't', status: 'failed', message: '단언' }])
  })

  test('skipped와 error가 함께 있으면 error를 쓴다', () => {
    const xml =
      '<testsuite><testcase name="t"><skipped/><error message="e"/></testcase></testsuite>'
    expect(casesOf(xml)[0]?.status).toBe('error')
  })

  test('system-out, properties, 다시 돌려 통과한 기록은 결과를 바꾸지 않는다', () => {
    const xml =
      '<testsuite><properties><property name="go.version" value="1.22"/></properties>' +
      '<testcase name="t"><system-out>로그</system-out><system-err>경고</system-err>' +
      '<flakyFailure message="처음엔 실패"/><rerunFailure message="다시"/></testcase></testsuite>'
    expect(casesOf(xml)).toEqual([{ name: 't', status: 'passed' }])
  })

  test('name이 없는 testcase는 빈 이름으로 둔다', () => {
    expect(casesOf('<testsuite><testcase classname="k"/></testsuite>')).toEqual([
      { name: '', classname: 'k', status: 'passed' },
    ])
  })

  test('숫자 문자 참조는 한 번만 푼다', () => {
    const xml = '<testsuite><testcase name="a&#65;&#x42; &amp;#67; &#x1F600;"/></testsuite>'
    expect(casesOf(xml)[0]?.name).toBe('aAB &#67; 😀')
  })

  test('숫자처럼 보이는 이름과 메시지도 글로 남긴다', () => {
    const xml =
      '<testsuite><testcase name="007" classname="1e3"><failure>42</failure></testcase></testsuite>'
    expect(casesOf(xml)).toEqual([
      { name: '007', classname: '1e3', status: 'failed', message: '42' },
    ])
  })

  test('CDATA 본문의 첫 줄을 메시지로 쓴다', () => {
    const xml =
      '<testsuite><testcase name="t"><failure><![CDATA[\n  기대 <1> 실제 <2>\n  at x]]></failure></testcase></testsuite>'
    expect(casesOf(xml)[0]?.message).toBe('기대 <1> 실제 <2>')
  })

  test('여러 줄 message 속성은 공백을 하나로 줄인다', () => {
    const xml =
      '<testsuite><testcase name="t"><failure message="첫 줄&#10;  둘째 줄"/></testcase></testsuite>'
    expect(casesOf(xml)[0]?.message).toBe('첫 줄 둘째 줄')
  })

  test('긴 메시지는 500자로 자른다', () => {
    const xml = `<testsuite><testcase name="t"><failure message="${'가'.repeat(800)}"/></testcase></testsuite>`
    const m = casesOf(xml)[0]?.message ?? ''
    expect(m).toHaveLength(500)
    expect(m.endsWith('…')).toBe(true)
  })

  test('빈 failure는 메시지 없이 실패다', () => {
    expect(casesOf('<testsuite><testcase name="t"><failure/></testcase></testsuite>')).toEqual([
      { name: 't', status: 'failed' },
    ])
  })

  test('BOM과 XML 선언, 주석이 있어도 읽는다', () => {
    const xml =
      '\uFEFF<?xml version="1.0"?>\n<!-- 머리 -->\n<testsuites><testcase name="t"/></testsuites>'
    expect(casesOf(xml)).toEqual([{ name: 't', status: 'passed' }])
  })

  test('testsuite 밖의 낯선 요소 안 testcase는 세지 않는다', () => {
    const xml =
      '<testsuites><other><testcase name="숨음"/></other><testcase name="보임"/></testsuites>'
    expect(casesOf(xml).map((c) => c.name)).toEqual(['보임'])
  })
})

describe('parseJUnit: 잘못된 입력', () => {
  test('빈 파일은 오류다', () => {
    expect(errorsOf('')).toEqual(['JUnit 파일이 비어 있음'])
    expect(errorsOf('  \n\t')).toEqual(['JUnit 파일이 비어 있음'])
    expect(errorsOf('\uFEFF')).toEqual(['JUnit 파일이 비어 있음'])
  })

  test('XML이 아니면 오류다', () => {
    expect(errorsOf('hello')[0]).toMatch(/^XML을 읽지 못함: /)
  })

  test('닫히지 않은 태그는 오류다(중간에 끊긴 파일)', () => {
    const xml = '<testsuites><testsuite name="s"><testcase name="t">'
    expect(errorsOf(xml)[0]).toMatch(/^XML을 읽지 못함: .*\(1줄\)$/)
  })

  test('선언만 있는 파일은 오류다', () => {
    expect(errorsOf('<?xml version="1.0"?>')[0]).toMatch(/^XML을 읽지 못함/)
  })

  test('맨 위가 testsuites·testsuite가 아니면 오류다', () => {
    expect(errorsOf('<html><body/></html>')).toEqual(['JUnit 모양이 아님: 맨 위 요소가 <html>'])
  })

  test('맨 위 요소가 여럿이면 오류다', () => {
    expect(errorsOf('<testsuite/><testsuite/>')).toEqual([
      'JUnit 모양이 아님: 맨 위 요소가 하나가 아님',
    ])
  })

  test('너무 깊게 겹친 문서는 던지지 않고 오류로 돌려준다', () => {
    const xml = `${'<testsuite>'.repeat(150)}<testcase name="t"/>${'</testsuite>'.repeat(150)}`
    expect(errorsOf(xml)[0]).toMatch(/^XML을 읽지 못함: /)
  })
})

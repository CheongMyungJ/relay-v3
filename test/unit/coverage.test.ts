// [단위] 바뀐 줄 커버리지(V57, engine/coverage.ts): lcov·Cobertura·JaCoCo 읽기, 보고서 경로와 레포 경로 맞추기, 더한 줄과의
// 교집합, 래칫 결과(바닥 위·아래, 새 파일, 보고서에 없는 파일, 더한 소스 줄 없음, 잴 수 없음). 수용 시험이 실행 폴더에 쓴
// 보고서를 읽는 것은 [어댑터] ratchets.test.ts.
import { describe, expect, test } from 'vitest'
import { err, ok } from '../../src/core/result.ts'
import type { FileChange } from '../../src/core/types.ts'
import {
  coverageOf,
  diffCoverageRatchet,
  parseCoverage,
  type DiffCoverageSpec,
  type FileCoverage,
} from '../../src/engine/coverage.ts'

const spec: DiffCoverageSpec = {
  id: 'diff-coverage',
  kind: 'diff_coverage',
  report: 'coverage/lcov.info',
  format: 'lcov',
  min: 0.8,
}

const LCOV = `TN:
SF:/work/head/src/calc.ts
FN:1,add
DA:1,1
DA:2,4
DA:5,0
DA:6,0
LF:4
LH:2
end_of_record
SF:src/util.ts
DA:3,2
end_of_record
SF:src/util.ts
DA:3,0
DA:4,1
end_of_record
`

const COBERTURA = `<?xml version="1.0" ?>
<!DOCTYPE coverage SYSTEM "http://cobertura.sourceforge.net/xml/coverage-04.dtd">
<coverage line-rate="0.5" version="7.6.1">
  <sources><source>/work/head/app</source></sources>
  <packages><package name="app">
    <classes>
      <class name="calc.py" filename="calc.py" line-rate="0.5">
        <methods/>
        <lines><line number="1" hits="1"/><line number="2" hits="0"/></lines>
      </class>
      <class name="a&amp;b.py" filename="sub/a&amp;b.py"><lines><line number="7" hits="3"/></lines></class>
    </classes>
  </package></packages>
</coverage>
`

const JACOCO = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<!DOCTYPE report PUBLIC "-//JACOCO//DTD Report 1.1//EN" "report.dtd">
<report name="demo">
  <sessioninfo id="x" start="1" dump="2"/>
  <group name="core">
    <package name="com/acme">
      <class name="com/acme/Calc" sourcefilename="Calc.java"/>
      <sourcefile name="Calc.java">
        <line nr="3" mi="0" ci="4" mb="0" cb="0"/>
        <line nr="4" mi="2" ci="0" mb="0" cb="0"/>
        <counter type="LINE" missed="1" covered="1"/>
      </sourcefile>
    </package>
  </group>
  <package name="">
    <sourcefile name="Main.java"><line nr="1" mi="0" ci="1" mb="0" cb="0"/></sourcefile>
  </package>
</report>
`

const lines = (f: FileCoverage | undefined) => (f === undefined ? null : [...f.lines])

const change = (path: string, added_at: number[], status: FileChange['status'] = 'M') =>
  ({
    path,
    status,
    added: added_at.length,
    deleted: 0,
    binary: false,
    added_lines: [],
    removed_lines: [],
    added_at,
  }) as FileChange

describe('보고서 읽기', () => {
  test('lcov: 실행 폴더 아래 절대 경로는 레포 기준으로 줄이고, 같은 파일이 두 번이면 하나라도 덮으면 덮음', () => {
    const r = parseCoverage(LCOV, 'lcov', ['/work/head'])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.map((f) => f.paths)).toEqual([['src/calc.ts'], ['src/util.ts']])
    expect(lines(r.value[0])).toEqual([
      [1, true],
      [2, true],
      [5, false],
      [6, false],
    ])
    expect(lines(r.value[1])).toEqual([
      [3, true],
      [4, true],
    ])
  })

  test('Cobertura: sources와 filename을 잇고 글자 참조를 푼다', () => {
    const r = parseCoverage(COBERTURA, 'cobertura', ['/work/head'])
    if (!r.ok) throw new Error(r.errors.join())
    expect(r.value.map((f) => f.paths)).toEqual([
      ['app/calc.py', 'calc.py'],
      ['app/sub/a&b.py', 'sub/a&b.py'],
    ])
    expect(lines(r.value[0])).toEqual([
      [1, true],
      [2, false],
    ])
  })

  test('JaCoCo: 패키지 경로/소스 파일 이름, 덮음은 ci > 0, group 안도 읽는다', () => {
    const r = parseCoverage(JACOCO, 'jacoco')
    if (!r.ok) throw new Error(r.errors.join())
    expect(r.value.map((f) => f.paths)).toEqual([['com/acme/Calc.java'], ['Main.java']])
    expect(lines(r.value[0])).toEqual([
      [3, true],
      [4, false],
    ])
  })

  test('읽지 못하면 까닭', () => {
    expect(parseCoverage('TN:\n', 'lcov')).toEqual(err('lcov 보고서에 파일(SF:)이 없음'))
    expect(parseCoverage('<coverage', 'cobertura')).toEqual(err('cobertura 보고서가 XML이 아님'))
    expect(parseCoverage('<report/>', 'cobertura')).toEqual(
      err('Cobertura 보고서에 coverage가 없음'),
    )
    expect(parseCoverage('<coverage/>', 'jacoco')).toEqual(err('JaCoCo 보고서에 report가 없음'))
  })

  test('레포 경로 맞추기: 같은 경로, 끝 조각(JaCoCo 패키지, 다른 폴더의 절대 경로), 가장 긴 겹침', () => {
    const r = [
      { paths: ['com/acme/Calc.java'], lines: new Map() },
      { paths: ['src/a.ts'], lines: new Map() },
      { paths: ['/elsewhere/repo/lib/b.ts'], lines: new Map() },
      { paths: ['b.ts'], lines: new Map() },
    ]
    expect(coverageOf(r, 'core/src/main/java/com/acme/Calc.java')).toBe(r[0])
    expect(coverageOf(r, 'src/a.ts')).toBe(r[1])
    expect(coverageOf(r, 'lib/b.ts')).toBe(r[2])
    expect(coverageOf(r, 'other/b.ts')).toBe(r[3])
    expect(coverageOf(r, 'src/aa.ts')).toBeUndefined()
  })
})

describe('더한 줄과의 교집합', () => {
  const report = parseCoverage(LCOV, 'lcov', ['/work/head'])

  test('바닥 위면 그대로: 실행 줄이 아닌 더한 줄(빈 줄, 선언)은 세지 않는다', () => {
    const r = diffCoverageRatchet(spec, report, { files: [change('src/calc.ts', [1, 2, 3, 4])] })
    expect(r).toEqual({
      id: 'diff-coverage',
      status: 'same',
      head: 100,
      detail: '바뀐 줄 커버리지 100.0% (2/2줄, 바닥 80.0%)',
    })
  })

  test('바닥 아래면 나빠짐: 안 덮은 줄을 줄 범위로 알린다', () => {
    const r = diffCoverageRatchet(spec, report, {
      files: [change('src/calc.ts', [2, 5, 6]), change('src/util.ts', [3])],
    })
    expect(r).toEqual({
      id: 'diff-coverage',
      status: 'worse',
      head: 50,
      detail: '바뀐 줄 커버리지 50.0% (2/4줄, 바닥 80.0%) · 안 덮은 줄: src/calc.ts:5-6',
      where: [
        'covered 2 of 4 added lines (50.0%), below the floor 80.0%',
        'src/calc.ts:5-6 not covered',
      ],
    })
  })

  test('새 파일도 같은 셈이다', () => {
    const r = diffCoverageRatchet(spec, report, { files: [change('src/calc.ts', [1, 5], 'A')] })
    expect(r).toMatchObject({ status: 'worse', head: 50 })
  })

  test('보고서에 없는 파일은 세지 않고 알린다. 모두 없으면 잴 수 없음', () => {
    const some = diffCoverageRatchet(spec, report, {
      files: [change('src/calc.ts', [1]), change('src/cli.ts', [1, 2])],
    })
    expect(some).toMatchObject({
      status: 'same',
      detail: '바뀐 줄 커버리지 100.0% (1/1줄, 바닥 80.0%) · 보고서에 없는 파일: src/cli.ts',
    })
    const none = diffCoverageRatchet(spec, report, { files: [change('src/cli.ts', [1])] })
    expect(none).toEqual({
      id: 'diff-coverage',
      status: 'unknown',
      detail: '잴 수 없음: 바뀐 소스 파일이 보고서에 없음 (src/cli.ts)',
    })
  })

  test('더한 소스 줄이 없으면(문서·시험·지운 파일·타입 선언·표에 없는 확장자) 보고서 없이도 그대로', () => {
    const r = diffCoverageRatchet(
      spec,
      err('보고서가 없음 (coverage/lcov.info)'),
      {
        files: [
          change('README.md', [1]),
          change('test/calc.test.ts', [1]),
          change('src/old.ts', [], 'D'),
          change('src/types.d.ts', [1]),
        ],
      },
      ['test/**'],
    )
    expect(r).toEqual({ id: 'diff-coverage', status: 'same', detail: '더한 소스 줄 없음' })
  })

  test('보고서가 없으면 잴 수 없음(나빠짐도 그대로도 아님)', () => {
    const r = diffCoverageRatchet(spec, err('보고서가 없음 (coverage/lcov.info)'), {
      files: [change('src/calc.ts', [1])],
    })
    expect(r).toEqual({
      id: 'diff-coverage',
      status: 'unknown',
      detail: '잴 수 없음: 보고서가 없음 (coverage/lcov.info)',
    })
  })

  test('더한 줄이 모두 실행 줄이 아니면 그대로', () => {
    const r = diffCoverageRatchet(
      spec,
      ok([{ paths: ['src/a.ts'], lines: new Map([[9, false]]) }]),
      {
        files: [change('src/a.ts', [1, 2])],
      },
    )
    expect(r).toEqual({
      id: 'diff-coverage',
      status: 'same',
      detail: '시험이 덮을 줄이 더해지지 않음',
    })
  })

  test('include·exclude로 범위를 좁힌다', () => {
    const r = diffCoverageRatchet({ ...spec, exclude: ['src/calc.ts'] }, report, {
      files: [change('src/calc.ts', [5])],
    })
    expect(r.status).toBe('same')
  })
})

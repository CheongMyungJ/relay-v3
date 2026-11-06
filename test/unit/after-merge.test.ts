// [단위] 머지 뒤 30일의 순수한 셈(M4d, docs/m4-design.md 6절, src/engine/after-merge.ts): 되돌림 글 세 꼴과 merge·squash·rebase가
// 올린 커밋에 대한 귀속, 창 끝, main의 여섯 상태(귀속은 부모 통과와 다시 시도도 실패일 때만, 다시 시도가 없으면 미정), 장부의
// after·dispute 줄 읽기, 무리의 셈(창 닫힘·지켜보는 중, 이의로 뺀 사건, 3의 규칙)
import { describe, expect, test } from 'vitest'
import {
  AFTER_DAYS,
  afterStats,
  lastAfter,
  mainOf,
  parseRecord,
  repoSlug,
  revertsOf,
  windowEnd,
  type AfterLine,
  type RunFact,
} from '../../src/engine/after-merge.ts'

const M = 'a'.repeat(40)
const P = 'b'.repeat(40)
const PR1 = 'c'.repeat(40)
const PR2 = 'd'.repeat(40)

describe('revertsOf', () => {
  const base = { pr: 7, slug: 'acme/calc' }
  test('(가) This reverts commit <oid>: 이 머지가 올린 커밋(merge 머지면 M과 PR 커밋)이어야 한다', () => {
    const commits = [
      { sha: 'r1', body: `Revert "x"\n\nThis reverts commit ${'e'.repeat(40)}.\n` },
      { sha: 'r2', body: `Revert "y"\n\nThis reverts commit ${PR2}.\n` },
    ]
    expect(revertsOf(commits, { ...base, landed: [M, PR1, PR2], subjects: [] })).toEqual({
      sha: 'r2',
      form: 'this_reverts',
    })
    // squash: 올린 커밋은 M 하나라 PR 커밋을 되돌린 것은 이 머지의 되돌림이 아니다
    expect(revertsOf(commits, { ...base, landed: [M], subjects: [] })).toBeNull()
    // 머지 커밋을 되돌림(git revert -m 1), 짧은 oid
    const merge = [
      {
        sha: 'r3',
        body: `This reverts commit ${M.slice(0, 10)}, reversing\nchanges made to ${P}.`,
      },
    ]
    expect(revertsOf(merge, { ...base, landed: [M], subjects: [] })?.sha).toBe('r3')
  })

  test('(나) Reverts owner/repo#pr: 번호와 레포가 맞아야 한다(레포를 모르면 번호만)', () => {
    const body = (s: string) => [{ sha: 'r', body: `Revert "fix"\n\nReverts ${s}\n` }]
    const o = { landed: [M], subjects: [] }
    expect(revertsOf(body('acme/calc#7'), { ...o, ...base })).toEqual({
      sha: 'r',
      form: 'reverts_pr',
    })
    expect(revertsOf(body('acme/calc#8'), { ...o, ...base })).toBeNull()
    expect(revertsOf(body('other/calc#7'), { ...o, ...base })).toBeNull()
    expect(revertsOf(body('other/calc#7'), { ...o, pr: 7, slug: null })?.form).toBe('reverts_pr')
    expect(revertsOf(body('acme/calc#7'), { ...o, pr: null, slug: null })).toBeNull()
  })

  test('(다) 제목 Revert "<올린 커밋의 제목>"', () => {
    const commits = [{ sha: 'r', body: 'Revert "clamp 고침 (#7)"\n\nbody' }]
    const o = { ...base, pr: null, landed: [M] }
    expect(revertsOf(commits, { ...o, subjects: ['clamp 고침 (#7)'] })).toEqual({
      sha: 'r',
      form: 'revert_title',
    })
    expect(revertsOf(commits, { ...o, subjects: ['다른 제목'] })).toBeNull()
  })

  test('창 안의 첫 되돌림(오래된 것부터 준다)', () => {
    const commits = [
      { sha: 'first', body: `This reverts commit ${M}.` },
      { sha: 'second', body: `This reverts commit ${M}.` },
    ]
    expect(revertsOf(commits, { ...base, landed: [M], subjects: [] })?.sha).toBe('first')
  })
})

test('repoSlug: GitHub URL에서 owner/repo, 아니면 null', () => {
  expect(repoSlug('https://github.com/acme/calc.git')).toBe('acme/calc')
  expect(repoSlug('git@github.com:acme/calc.git')).toBe('acme/calc')
  expect(repoSlug('/tmp/origin.git')).toBeNull()
  expect(repoSlug(null)).toBeNull()
})

test('windowEnd: merged_at에서 30일', () => {
  expect(AFTER_DAYS).toBe(30)
  expect(windowEnd('2026-11-07T10:00:00Z')).toBe('2026-12-07T10:00:00.000Z')
  expect(windowEnd('모름')).toBeNull()
})

describe('mainOf', () => {
  const run = (sha: string, more: Partial<RunFact> = {}): RunFact => ({
    name: 'ci',
    path: '.github/workflows/ci.yml',
    head_sha: sha,
    event: 'push',
    status: 'completed',
    conclusion: 'success',
    run_attempt: 1,
    ...more,
  })
  const at = (runs: RunFact[] | null, parentRuns: RunFact[] | null, measurable = true) =>
    mainOf({ sha: M, parent: P, runs, parentRuns, measurable })

  test('귀속: 부모는 통과, 이 커밋은 다시 시도도 실패', () => {
    expect(at([run(M, { conclusion: 'failure', run_attempt: 2 })], [run(P)])).toEqual({
      main: 'attributed',
      main_run: { name: 'ci', sha: M, attempts: 2 },
    })
  })

  test('미정: 다시 시도가 없음(앱은 CI를 다시 돌리지 않는다), 또는 아직 돎', () => {
    expect(at([run(M, { conclusion: 'failure' })], [run(P)]).main).toBe('pending')
    expect(at([run(M, { status: 'in_progress', conclusion: null })], [run(P)]).main).toBe('pending')
  })

  test('물려받음: 부모도 실패. 모름: 부모 실행이 없거나 실행을 읽지 못함, 취소', () => {
    const fail = run(M, { conclusion: 'failure', run_attempt: 2 })
    expect(at([fail], [run(P, { conclusion: 'failure' })]).main).toBe('inherited')
    expect(at([fail], []).main).toBe('unknown')
    expect(at([fail], null).main).toBe('unknown')
    expect(at(null, [run(P)]).main).toBe('unknown')
    expect(at([run(M, { conclusion: 'cancelled' })], [run(P)]).main).toBe('unknown')
    // 다른 워크플로의 부모 실행은 견주지 않는다
    expect(at([fail], [run(P, { path: 'other.yml', name: 'other' })]).main).toBe('unknown')
  })

  test('깨끗함과 잴 수 없음(필수 검사가 없거나 push 실행이 0, pull_request 실행은 세지 않음)', () => {
    expect(at([run(M), run(M, { path: 'lint.yml', conclusion: 'skipped' })], [run(P)]).main).toBe(
      'clean',
    )
    expect(at([run(M)], [run(P)], false).main).toBe('unmeasurable')
    expect(at([], [run(P)]).main).toBe('unmeasurable')
    expect(at([run(M, { event: 'pull_request' })], [run(P)]).main).toBe('unmeasurable')
  })

  test('워크플로 사이는 엄격한 쪽: 귀속 > 미정 > 모름 > 물려받음 > 깨끗', () => {
    const runs = [
      run(M),
      run(M, { path: 'a.yml', conclusion: 'failure' }),
      run(M, { path: 'b.yml', conclusion: 'failure', run_attempt: 3 }),
    ]
    const parents = [run(P), run(P, { path: 'a.yml' }), run(P, { path: 'b.yml' })]
    expect(at(runs, parents).main).toBe('attributed')
    expect(at(runs.slice(0, 2), parents).main).toBe('pending')
  })
})

const after = (more: Partial<AfterLine> = {}): AfterLine => ({
  kind: 'after',
  ts: '2026-12-08T00:00:00Z',
  project: 'p1',
  work: 'w1',
  merge_commit: M,
  merged_at: '2026-11-07T10:00:00Z',
  window_end: '2026-12-07T10:00:00.000Z',
  closed: true,
  revert: null,
  main: 'clean',
  seen_until: '2026-12-01T00:00:00.000Z',
  ...more,
})

test('parseRecord: 결론 줄, after 줄, dispute 줄을 가르고 깨진 줄과 모양이 다른 줄을 센다', () => {
  const entry = {
    ts: 't',
    project: 'p1',
    work: 'w1',
    head: 'h',
    conclusion: 'human_merge',
    condition: null,
    shadow: false,
    relay_version: '0',
  }
  const dispute = { kind: 'dispute', ts: 't', project: 'p1', merge_commit: M, event: 'revert' }
  const text = [
    JSON.stringify(entry),
    JSON.stringify(after({ revert: { sha: 'r', form: 'this_reverts' } })),
    JSON.stringify(dispute),
    JSON.stringify({ ...after(), main: '모름' }),
    JSON.stringify({ ...dispute, event: 'other' }),
    '{깨짐',
    '',
  ].join('\n')
  const r = parseRecord(text)
  expect(r.entries).toHaveLength(1)
  expect(r.after).toHaveLength(1)
  expect(r.disputes).toHaveLength(1)
  expect(r.broken).toBe(3)
})

describe('afterStats', () => {
  test('창이 닫힌 머지와 지켜보는 중(after 줄이 없거나 닫히지 않음), 0이면 3의 규칙', () => {
    const last = lastAfter([after(), after({ merge_commit: P, closed: false })], 'p1')
    const s = afterStats(
      [
        { work: 'w1', commit: M },
        { work: 'w2', commit: P },
        { work: 'w3', commit: PR1 },
      ],
      last,
      [],
    )
    expect(s).toMatchObject({ merges: 3, closed: 1, watching: 2, reverts: 0, upper: 1 })
  })

  test('되돌림·귀속은 사건으로 남고, 이의가 달린 사건은 셈에서 빠진다', () => {
    const lines = [
      after({ revert: { sha: 'r', form: 'reverts_pr' } }),
      after({ merge_commit: P, main: 'attributed', main_run: { name: 'ci', sha: P, attempts: 2 } }),
      after({ merge_commit: PR1, main: 'pending' }),
      after({ merge_commit: PR2, main: 'unmeasurable' }),
    ]
    const merges = [M, P, PR1, PR2].map((commit) => ({ work: 'w', commit }))
    const s = afterStats(merges, lastAfter(lines, 'p1'), [
      { kind: 'dispute', ts: 't', project: 'p1', merge_commit: P, event: 'main' },
    ])
    expect(s).toMatchObject({
      closed: 4,
      reverts: 1,
      main: { attributed: 0, pending: 1, inherited: 0, unknown: 0 },
      unmeasurable: 1,
      disputed: 1,
      upper: null,
    })
    expect(s.events).toEqual([
      { merge_commit: M, work: 'w', event: 'revert', sha: 'r', disputed: false },
      { merge_commit: P, work: 'w', event: 'main', sha: P, disputed: true },
    ])
  })

  test('lastAfter는 그 프로젝트의 머지마다 마지막 줄', () => {
    const last = lastAfter([after({ closed: false }), after(), after({ project: 'p2' })], 'p1')
    expect(last.get(M)?.closed).toBe(true)
    expect(last.size).toBe(1)
  })
})

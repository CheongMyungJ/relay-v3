// [단위] 세션 커밋 가르기의 순수한 셈(M4e, docs/m4-design.md 7절, src/engine/session-commits.ts): 머지 뒤 커밋의 네 갈래와
// 집합·트레일러가 다른 경우(엄격하게 사람), 트레일러를 끈 세션의 집합만 가르기, 트레일러 읽기, 세션 환경 변수, 심의 글, git 판,
// 세션 커밋 집합 파일 읽기와 셈, [실적]의 장치 지표, 그리고 불일치 갈래(세션이 더 고침·사람이 더 고침, engine/shadow.ts)
import { describe, expect, test } from 'vitest'
import { exportHeads } from '../../src/engine/follow.ts'
import { GATE_VERSION } from '../../src/engine/gate-version.ts'
import { isLedgerEntry, parseLedger, type LedgerEntry } from '../../src/engine/ledger.ts'
import {
  classifyCommits,
  GIT_HOOK_NAMES,
  gitVersionOf,
  NO_COMMITS,
  parseSessionLog,
  sessionStats,
  sessionSummary,
  shimFiles,
  shimText,
  trailerEnv,
  trailerGitOk,
  workTrailers,
} from '../../src/engine/session-commits.ts'
import { recordStats, shadowStats } from '../../src/engine/shadow.ts'
import { earlierPick } from '../../src/main/works-change.ts'

const RELAY = 'relay@localhost'

describe('classifyCommits: 머지 뒤 커밋의 갈래', () => {
  const set = new Set(['s1', 's2', 'x1'])
  const commits = [
    { sha: 'd1', author: RELAY, relay: true, baseUpdate: false, trailers: ['w1'] },
    // 작성자만 relay@localhost(앱이 적은 빚 커밋이 아님): 사람으로 센다
    { sha: 'f1', author: RELAY, baseUpdate: false },
    { sha: 'b1', author: 'gh@x', baseUpdate: true },
    { sha: 's1', author: 'me@x', baseUpdate: false, trailers: ['w1'] },
    { sha: 's2', author: 'me@x', baseUpdate: false, trailers: ['w1'] },
    { sha: 'h1', author: 'me@x', baseUpdate: false },
    // 집합에는 있는데 트레일러가 없음(세션이 GIT_CONFIG_*를 지움): 사람으로 센다
    { sha: 'x1', author: 'me@x', baseUpdate: false, trailers: [] },
    // 트레일러는 있는데 집합에 없음(TUI 안의 !git commit, 앱을 다시 켠 사이): 사람으로 센다
    { sha: 'x2', author: 'me@x', baseUpdate: false, trailers: ['w1'] },
    // 다른 Work의 트레일러는 이 Work의 세션이 아니다
    { sha: 'x3', author: 'me@x', baseUpdate: false, trailers: ['w2'] },
  ]

  test('relay, 기준 맞춤, 세션(둘 다), 사람(나머지), 다름은 사람으로 셈', () => {
    expect(classifyCommits(commits, { set, work: 'w1', trailer: true })).toEqual({
      session: 2,
      human: 5,
      relay: 1,
      base_update: 1,
      disagree: 2,
    })
  })

  test('트레일러를 끈 세션이 있으면 집합만으로 가른다', () => {
    expect(classifyCommits(commits, { set, work: 'w1', trailer: false })).toEqual({
      session: 3,
      human: 4,
      relay: 1,
      base_update: 1,
      disagree: 0,
    })
  })

  test('커밋이 없으면 모두 0', () => {
    expect(classifyCommits([], { set, work: 'w1', trailer: true })).toEqual(NO_COMMITS)
  })
})

describe('workTrailers', () => {
  test('마지막 문단의 Relay-Work 값(이름은 대소문자를 가리지 않음)', () => {
    expect(workTrailers('fix\n\nbody\n\nRelay-Work: w1\nSigned-off-by: a <a@x>\n')).toEqual(['w1'])
    expect(workTrailers('fix\r\n\r\nrelay-work:  w2 \r\n')).toEqual(['w2'])
    expect(workTrailers('Relay-Work: w1')).toEqual([])
    expect(workTrailers('fix\n\nRelay-Work: w1\n\nmore body')).toEqual([])
    expect(workTrailers('fix\n\nX-Relay-Work: w1')).toEqual([])
  })
})

describe('trailerEnv', () => {
  const o = { shimDir: '/h/git-hooks', gitCommon: '/r/.git', hookLog: '/h/works/w1/hooks.log' }

  test('물려받은 GIT_CONFIG_COUNT가 없으면 0번에 core.hooksPath', () => {
    expect(trailerEnv({ ...o, inherited: {} })).toEqual({
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.hooksPath',
      GIT_CONFIG_VALUE_0: '/h/git-hooks',
      RELAY_GIT_CONFIG_BASE: '0',
      RELAY_HOOKS_DIR: '/h/git-hooks',
      RELAY_GIT_COMMON: '/r/.git',
      RELAY_HOOK_LOG: '/h/works/w1/hooks.log',
    })
  })

  test('물려받은 설정 뒤에 붙인다(심은 그 설정만으로 원래 훅을 찾는다)', () => {
    const env = trailerEnv({ ...o, inherited: { GIT_CONFIG_COUNT: '2' } })
    expect(env).toMatchObject({
      GIT_CONFIG_COUNT: '3',
      GIT_CONFIG_KEY_2: 'core.hooksPath',
      GIT_CONFIG_VALUE_2: '/h/git-hooks',
      RELAY_GIT_CONFIG_BASE: '2',
    })
    expect(trailerEnv({ ...o, inherited: { GIT_CONFIG_COUNT: 'x' } }).GIT_CONFIG_COUNT).toBe('1')
  })

  test('이미 relay 세션 환경이면 그 심 자리를 바꾼다(겹친 심이 서로를 부르지 않게). 모양이 다르면 뒤에 붙인다', () => {
    const outer = {
      GIT_CONFIG_COUNT: '3',
      GIT_CONFIG_KEY_2: 'core.hooksPath',
      GIT_CONFIG_VALUE_2: '/outer/git-hooks',
      RELAY_GIT_CONFIG_BASE: '2',
      RELAY_HOOKS_DIR: '/outer/git-hooks',
    }
    expect(trailerEnv({ ...o, inherited: outer })).toMatchObject({
      GIT_CONFIG_COUNT: '3',
      GIT_CONFIG_KEY_2: 'core.hooksPath',
      GIT_CONFIG_VALUE_2: '/h/git-hooks',
      RELAY_GIT_CONFIG_BASE: '2',
      RELAY_HOOKS_DIR: '/h/git-hooks',
    })
    const odd = { ...outer, GIT_CONFIG_VALUE_2: '/elsewhere' }
    expect(trailerEnv({ ...o, inherited: odd })).toMatchObject({
      GIT_CONFIG_COUNT: '4',
      GIT_CONFIG_VALUE_3: '/h/git-hooks',
      RELAY_GIT_CONFIG_BASE: '3',
    })
  })
})

describe('심의 글', () => {
  test('모든 표준 훅 이름에 심이 있고, 트레일러는 prepare-commit-msg와 commit-msg만', () => {
    const files = shimFiles()
    expect(Object.keys(files)).toEqual([...GIT_HOOK_NAMES])
    for (const [name, text] of Object.entries(files)) {
      expect(text.startsWith('#!/bin/sh\n')).toBe(true)
      expect(text).toContain(`name='${name}'`)
      expect(text).not.toContain('\r')
      expect(text.includes('interpret-trailers')).toBe(
        name === 'prepare-commit-msg' || name === 'commit-msg',
      )
    }
    expect(shimText('pre-commit')).toContain('exec "$orig/$name" "$@"')
    expect(shimText('prepare-commit-msg')).toContain('--trailer "Relay-Work: $RELAY_WORK_ID"')
    expect(() => shimText('../x')).toThrow()
  })
})

describe('git 판', () => {
  test('2.31 이상만', () => {
    expect(gitVersionOf('git version 2.43.0')).toEqual([2, 43])
    expect(trailerGitOk('git version 2.31.0')).toBe(true)
    expect(trailerGitOk('git version 2.30.9')).toBe(false)
    expect(trailerGitOk('git version 3.0.0.windows.1')).toBe(true)
    expect(trailerGitOk('뭔가')).toBe(false)
  })
})

describe('세션 커밋 집합 파일', () => {
  test('띄움 줄과 커밋 줄, 깨진 줄은 건너뜀, 트레일러를 켠 채 본 커밋의 덮임', () => {
    const text = [
      JSON.stringify({ ts: 't', kind: 'launch', trailer: true }),
      JSON.stringify({
        ts: 't',
        kind: 'commits',
        on: true,
        tool: 'u1',
        commits: [
          { sha: 'a', trailer: true },
          { sha: 'b', trailer: false },
        ],
      }),
      '{"끊긴',
      JSON.stringify({ ts: 't', kind: 'launch', trailer: false, why: 'setting' }),
      JSON.stringify({ ts: 't', kind: 'commits', on: false, tool: null, commits: [{ sha: 'c' }] }),
    ].join('\n')
    const s = parseSessionLog(text)
    expect(s.launched).toBe(true)
    expect(s.trailerOff).toBe(true)
    expect([...s.commits.keys()]).toEqual(['a', 'b', 'c'])
    expect(sessionSummary(s, 2)).toEqual({ commits: 3, watched: 2, trailered: 1, incidents: 2 })
    expect(parseSessionLog('').launched).toBe(false)
  })
})

describe('장부의 M4e 칸과 셈', () => {
  const base = {
    ts: '2026-11-20T00:00:00Z',
    project: 'p1',
    head: 'h',
    conclusion: 'human_merge' as const,
    condition: null,
    shadow: false,
    relay_version: '0',
  }
  const epoch = {
    conds: { small: 'a1b2c3d4e5f6' },
    model_observed: 'm',
    effort: 'medium',
    claude_version: '2.1.3',
    gate_version: GATE_VERSION,
    review_prompt: 4,
  }
  const sample = (work: string): LedgerEntry => ({
    ...base,
    work,
    condition: 'small',
    shadow: true,
    met: ['small'],
    ...epoch,
  })
  const merged = (work: string, more: Partial<LedgerEntry>): LedgerEntry => ({
    ...base,
    work,
    by: 'human-override',
    merged_head: 'h2',
    same_change: false,
    ...more,
  })
  const after = (o: Partial<typeof NO_COMMITS>) => ({ ...NO_COMMITS, ...o })

  test('모양이 다른 칸은 그 줄을 버린다', () => {
    const ok = merged('a', { after_commits: after({ human: 1 }), trailer: false })
    expect(isLedgerEntry(ok)).toBe(true)
    expect(isLedgerEntry({ ...ok, after_commits: { session: 1 } })).toBe(false)
    expect(isLedgerEntry({ ...ok, after_commits: after({ human: -1 }) })).toBe(false)
    expect(isLedgerEntry({ ...ok, trailer: 'no' })).toBe(false)
    expect(isLedgerEntry({ ...ok, session_set: { commits: 1 } })).toBe(false)
    expect(parseLedger(`${JSON.stringify(ok)}\n`)).toHaveLength(1)
  })

  test('불일치 갈래: 사람 커밋이 있으면 사람, 세션 커밋만이면 세션, 가르지 못했으면 모름', () => {
    const entries = [
      sample('a'),
      merged('a', { after_commits: after({ human: 1, session: 2 }) }),
      sample('b'),
      merged('b', { after_commits: after({ session: 1, base_update: 1 }) }),
      sample('c'),
      merged('c', {}),
    ]
    const s = shadowStats({ entries, scope: { project: 'p1' }, epoch, now: null })['small']
    expect(s?.miss).toMatchObject({ more_human: 1, more_session: 1, more_unknown: 1 })
  })

  test('[실적]의 장치 지표: 사람 교정, 갈래 합, 다름, 집합만, Work마다 마지막 집합의 셈', () => {
    const set = (n: number) => ({ commits: n, watched: n, trailered: n - 1, incidents: 0 })
    const entries = [
      merged('a', { after_commits: after({ human: 1, disagree: 1 }), session_set: set(3) }),
      merged('b', { after_commits: after({ session: 2 }), trailer: false, session_set: set(2) }),
      { ...merged('c', { after_commits: after({}) }), merged_head: 'h' },
      // 닫힘 끝 줄도 집합의 셈은 센다(같은 Work는 마지막 줄)
      { ...base, work: 'd', closed: true, session_set: set(1) },
      { ...base, work: 'd', closed: true, session_set: { ...set(4), incidents: 1 } },
      // 다른 프로젝트
      { ...merged('e', { after_commits: after({ human: 5 }) }), project: 'p2' },
    ]
    expect(sessionStats(entries.filter((e) => e.project === 'p1'))).toEqual({
      merges: 3,
      corrected: 1,
      unclassified: 0,
      commits: { session: 2, human: 1, relay: 0, base_update: 0 },
      disagree: 1,
      set_only: 1,
      works: 3,
      session_commits: 9,
      watched: 9,
      trailered: 6,
      incidents: 1,
    })
    const r = recordStats({
      entries,
      scope: { project: 'p1' },
      now: null,
      allEpochs: true,
      broken: 0,
    })
    expect(r.sessions.merges).toBe(3)
    expect(
      recordStats({ entries, scope: { pool: true }, now: null, allEpochs: true, broken: 0 })
        .sessions.corrected,
    ).toBe(2)
  })

  test('가를 앞 head가 많으면 첫 head(사람 교정의 셈)와 최근 것을 남긴다', () => {
    const hs = Array.from({ length: 30 }, (_, i) => `h${i}`)
    const picked = earlierPick(hs, 'h29')
    expect(picked).toHaveLength(20)
    expect(picked[0]).toBe('h0')
    expect(picked.at(-1)).toBe('h28')
    expect(earlierPick(['a', 'b', 'm'], 'm')).toEqual(['a', 'b'])
  })

  test('앞 head 뒤에 기준 맞춤 머지와 빚 커밋만 있으면(Update branch를 받아 다시 내보냄) 같은 변경으로 일치', () => {
    const entries = [
      { ...sample('a'), head: 'h1' },
      { ...sample('a'), head: 'u1' },
      merged('a', {
        head: 'u1',
        merged_head: 'u1',
        same_change: true,
        after_commits: after({}),
        after_heads: { h1: after({ base_update: 1, relay: 1 }) },
      }),
    ]
    const s = shadowStats({ entries, scope: { project: 'p1' }, epoch, now: null })['small']
    expect(s).toMatchObject({ match: 1, n: 1, miss: { more_unknown: 0 } })
  })

  test('다시 내보낸 Work: 앞 head의 갈래(after_heads)로 불일치 갈래와 사람 교정(첫 결론 줄 뒤)을 센다', () => {
    const entries = [
      { ...sample('a'), head: 'h1' },
      { ...sample('a'), head: 'h2' },
      merged('a', {
        head: 'h2',
        merged_head: 'h2',
        same_change: true,
        after_commits: after({}),
        after_heads: { h1: after({ human: 1, session: 1 }) },
      }),
      { ...sample('b'), head: 'k1' },
      { ...sample('b'), head: 'k2' },
      // 앞 head를 가르지 못했다(rebase로 잃음)
      merged('b', { head: 'k2', merged_head: 'k2', same_change: true, after_commits: after({}) }),
    ]
    expect(exportHeads(entries, 'a', null)).toEqual(['h1', 'h2'])
    const s = shadowStats({ entries, scope: { project: 'p1' }, epoch, now: null })['small']
    expect(s).toMatchObject({ match: 0, miss: { more_human: 1, more_unknown: 1 } })
    // 앞 head를 가르지 못한 머지(b)는 분모에 넣지 않고 따로 센다
    expect(sessionStats(entries)).toMatchObject({
      merges: 1,
      corrected: 1,
      unclassified: 1,
      commits: { session: 1, human: 1 },
    })
  })
})

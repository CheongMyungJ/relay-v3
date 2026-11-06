// [단위] 규칙 승격(M3d, V42, src/engine/promote.ts): 규칙 항목의 `check:` 읽기, 말로만 남은 규칙(spoken)과 승격된 규칙의
// 늘어난 허용 목록(allow), rule_violation의 사실과 갚음, 빠른 명령의 결과, 지침의 문단. git을 읽는 쪽은 [흐름]
// check-promote.test.ts.
import { describe, expect, test } from 'vitest'
import { instructionsText } from '../../src/core/instructions.ts'
import { parseQuality } from '../../src/core/quality.ts'
import type { CommandEvidence, DebtItem, QualityConfig } from '../../src/core/types.ts'
import { checkOf, isRule, type KnowledgeEntry } from '../../src/engine/knowledge-format.ts'
import {
  fastOutcome,
  promoteIssues,
  ruleFacts,
  rulePayoff,
  type PromoteInput,
} from '../../src/engine/promote.ts'
import { QUALITY } from '../support/calc.ts'

const quality = (more: object = {}): QualityConfig => {
  const q = parseQuality(JSON.stringify({ ...QUALITY, ...more }))
  if (!q.ok) throw new Error(q.errors.join(', '))
  return q.value
}

/** 규칙 항목. check가 null이면 머리글에 없다. notYet은 `## 아직 규칙을 따르지 않는 곳`의 경로 */
function rule(
  path: string,
  check: string | null,
  notYet: string[] = [],
  kind = 'rule',
): KnowledgeEntry {
  const head = [
    '---',
    `kind: ${kind}`,
    'source: human',
    ...(check === null ? [] : [`check: ${check}`]),
    '---',
  ]
  const body = [`# ${path}`, '', kind === 'rule' ? '## 규칙' : '## 내용', '', '콘솔에 쓰지 않는다.']
  const list =
    notYet.length === 0
      ? []
      : ['', '## 아직 규칙을 따르지 않는 곳', '', ...notYet.map((p) => `- \`${p}\``)]
  return { path: `docs/knowledge/${path}`, text: [...head, '', ...body, ...list, ''].join('\n') }
}

const input = (o: Partial<PromoteInput>): PromoteInput => ({
  base: [],
  head: [],
  renamed: new Map(),
  rules: ['no-console'],
  headRules: null,
  ...o,
})

describe('check: 머리글', () => {
  test('규칙 항목의 check만 읽고, 규칙이 아니거나 머리글이 깨졌으면 null', () => {
    expect(checkOf(rule('a.md', 'no-console').text)).toBe('no-console')
    expect(checkOf(rule('a.md', null).text)).toBeNull()
    expect(checkOf(rule('a.md', 'no-console', [], 'fact').text)).toBeNull()
    expect(checkOf('# 머리글 없음\n')).toBeNull()
    expect(checkOf('---\nkind: rule\ncheck: "npm run lint:imports"\n---\n')).toBe(
      'npm run lint:imports',
    )
    expect(isRule(rule('a.md', null).text)).toBe(true)
    expect(isRule(rule('a.md', null, [], 'pitfall').text)).toBe(false)
  })
})

describe('promoteIssues', () => {
  test('말로만: head의 규칙 가운데 check가 없거나 rules에 없는 것. 규칙이 아닌 항목은 보지 않는다', () => {
    const head = [
      rule('ok.md', 'no-console'),
      rule('none.md', null),
      rule('other.md', 'no-eval'),
      rule('fact.md', null, [], 'fact'),
    ]
    expect(promoteIssues(input({ head }))).toEqual([
      { path: 'docs/knowledge/none.md', kind: 'spoken', detail: '검사(`check:`)가 없음' },
      {
        path: 'docs/knowledge/other.md',
        kind: 'spoken',
        detail: '검사 `no-eval`가 quality.json rules에 없음',
      },
    ])
  })

  test('말로만의 까닭: 이 diff가 head의 rules에 더한 검사, 품질 기준이 없음', () => {
    const head = [rule('a.md', 'no-eval')]
    expect(promoteIssues(input({ head, headRules: ['no-eval'] }))[0]?.detail).toBe(
      '검사 `no-eval`가 기준의 quality.json rules에 없음(이 diff가 더함: 머지 뒤 승격)',
    )
    expect(promoteIssues(input({ head, rules: null }))[0]?.detail).toBe(
      '검사 `no-eval`: 품질 기준이 없어 승격을 확인하지 못함',
    )
  })

  test('허용 목록: 기준에서 승격된 규칙의 목록에 더한 경로는 allow(줄거나 같으면 없음)', () => {
    const base = [rule('a.md', 'no-console', ['src/a.js', 'src/b.js'])]
    const grew = [rule('a.md', 'no-console', ['src/a.js', 'src/b.js', 'src/c.js', 'src/d.js'])]
    expect(promoteIssues(input({ base, head: grew }))).toEqual([
      {
        path: 'docs/knowledge/a.md',
        kind: 'allow',
        detail:
          '검사 `no-console`의 허용 목록(`## 아직 규칙을 따르지 않는 곳`)에 `src/c.js`, `src/d.js`가 더해짐: 줄어들기만 한다',
      },
    ])
    for (const head of [
      [rule('a.md', 'no-console', ['src/a.js'])],
      base,
      [rule('a.md', 'no-console')],
    ])
      expect(promoteIssues(input({ base, head }))).toEqual([])
    // 바꿔 넣으면(하나 빼고 하나 더함) 는 것이다
    const swapped = [rule('a.md', 'no-console', ['src/a.js', 'src/c.js'])]
    expect(promoteIssues(input({ base, head: swapped })).map((i) => i.kind)).toEqual(['allow'])
  })

  test('허용 목록: 옮긴 항목은 새 자리와 견주고, head에서 check를 지워도 기준의 승격으로 본다', () => {
    const base = [rule('a.md', 'no-console', ['src/a.js'])]
    const moved = [rule('area/a.md', 'no-console', ['src/a.js', 'src/b.js'])]
    const renamed = new Map([['docs/knowledge/a.md', 'docs/knowledge/area/a.md']])
    expect(
      promoteIssues(input({ base, head: moved, renamed })).map((i) => [i.path, i.kind]),
    ).toEqual([['docs/knowledge/area/a.md', 'allow']])
    const unchecked = [rule('a.md', null, ['src/a.js', 'src/b.js'])]
    expect(promoteIssues(input({ base, head: unchecked })).map((i) => i.kind)).toEqual([
      'allow',
      'spoken',
    ])
  })

  test('허용 목록이 아닌 것: 기준에서 승격되지 않은 규칙(말로만), 새 항목, 지운 항목', () => {
    const grew = [rule('a.md', 'no-eval', ['src/a.js', 'src/b.js'])]
    const base = [rule('a.md', 'no-eval', ['src/a.js'])]
    expect(promoteIssues(input({ base, head: grew })).map((i) => i.kind)).toEqual(['spoken'])
    const fresh = [rule('a.md', 'no-console', ['src/a.js', 'src/b.js'])]
    expect(promoteIssues(input({ head: fresh }))).toEqual([])
    expect(promoteIssues(input({ base: [rule('a.md', 'no-console', ['src/a.js'])] }))).toEqual([])
  })
})

describe('rule_violation의 갚음', () => {
  const item = (o: Partial<DebtItem['anchor']> = {}): DebtItem => ({
    id: 'r1',
    anchor: { path: 'src/a.js', metric: 'no-console', ...o },
    kind: 'rule_violation',
    source: 'w0',
    reason: '콘솔에 씀',
    created: '2026-01-01',
  })
  const q = quality({ rules: ['no-console'] })

  test('ruleFacts: anchor.metric을 check에 적은 head 규칙과 그 허용 목록에 경로가 있는 것', () => {
    const head = [
      rule('a.md', 'no-console', ['src/a.js']),
      rule('b.md', 'no-console'),
      rule('c.md', 'no-eval', ['src/a.js']),
    ]
    expect(ruleFacts(item(), head, 'pass')).toEqual({
      entries: ['docs/knowledge/a.md', 'docs/knowledge/b.md'],
      allowed: ['docs/knowledge/a.md'],
      commands: 'pass',
    })
    expect(ruleFacts(item({ metric: undefined }), head, 'pass').entries).toEqual([])
  })

  test('rulePayoff: 허용 목록에서 빠지고 빠른 명령이 통과하면 갚음, 목록에 남았거나 명령이 실패하면 못 갚음', () => {
    const facts = (o: object = {}) => ({
      entries: ['docs/knowledge/a.md'],
      allowed: [],
      commands: 'pass' as const,
      ...o,
    })
    const f = '항목 파일을 지움'
    expect(rulePayoff(item(), q, facts(), f)).toEqual({
      status: 'paid',
      detail: '`src/a.js`가 허용 목록에서 빠지고 빠른 명령이 통과 (항목 파일을 지움)',
    })
    expect(rulePayoff(item(), q, facts({ allowed: ['docs/knowledge/a.md'] }), f)).toEqual({
      status: 'open',
      detail: '`src/a.js`가 아직 허용 목록에 있음: docs/knowledge/a.md (항목 파일을 지움)',
    })
    expect(rulePayoff(item(), q, facts({ commands: 'fail' }), f)).toEqual({
      status: 'open',
      detail: '`src/a.js`가 허용 목록에서 빠졌지만 빠른 명령이 실패 (항목 파일을 지움)',
    })
    expect(rulePayoff(item(), q, facts({ commands: 'unknown' }), f)).toEqual({
      status: 'unknown',
      detail: '`src/a.js`가 허용 목록에서 빠졌지만 빠른 명령의 결과를 모름 (항목 파일을 지움)',
    })
  })

  test('rulePayoff: 가르지 못함(장치 꺼짐, 검사 이름 없음, 말로만, 검사를 적은 항목 없음)', () => {
    const facts = { entries: ['docs/knowledge/a.md'], allowed: [], commands: 'pass' as const }
    const f = '항목 파일이 남음'
    const detail = (...a: Parameters<typeof rulePayoff>) => {
      const r = rulePayoff(...a)
      expect(r.status).toBe('unknown')
      return r.detail
    }
    expect(detail(item(), q, undefined, f)).toBe(
      '규칙 승격(M3d)이 꺼져 있어 가르지 못함 (항목 파일이 남음)',
    )
    expect(detail(item({ metric: undefined }), q, facts, f)).toBe(
      '검사 이름(anchor.metric)이 없어 가르지 못함 (항목 파일이 남음)',
    )
    for (const qq of [quality(), null])
      expect(detail(item(), qq, facts, f)).toBe(
        '검사 `no-console`가 quality.json rules에 없어(말로만) 가르지 못함 (항목 파일이 남음)',
      )
    expect(detail(item(), q, { ...facts, entries: [] }, f)).toBe(
      '검사 `no-console`를 `check:`에 적은 규칙 항목이 head에 없음 (항목 파일이 남음)',
    )
  })

  test('fastOutcome: 빠른 명령만 본다. 실패·원래 실패는 fail, 불안정·돌리지 못함·없음은 unknown', () => {
    const run = (id: string, outcome: CommandEvidence['outcome']): CommandEvidence => ({
      id,
      outcome,
      head: [],
    })
    const fast = quality().commands.fast.map((s) => s.id)
    expect(fast.length).toBeGreaterThan(0)
    const all = (o: CommandEvidence['outcome']) => fast.map((id) => run(id, o))
    expect(fastOutcome(quality(), all('pass'))).toBe('pass')
    expect(fastOutcome(quality(), [...all('pass'), run('acceptance', 'fail')])).toBe('pass')
    expect(fastOutcome(quality(), all('fail'))).toBe('fail')
    expect(fastOutcome(quality(), all('pre_existing'))).toBe('fail')
    expect(fastOutcome(quality(), all('unstable'))).toBe('unknown')
    expect(fastOutcome(quality(), all('not_run'))).toBe('unknown')
    expect(fastOutcome(quality(), [])).toBe('unknown')
    expect(fastOutcome(null, all('pass'))).toBe('unknown')
  })
})

describe('지침', () => {
  const base = {
    workId: 'w',
    contractId: 'c',
    examplesDir: '.relay/examples',
    baseBranch: 'main',
    workBranch: 'relay/c',
    questionMode: 'confirm_each',
  } as const

  test('켜면 검사를 더하고 check:와 rules에 적는 한 문단, 끄면 M3c까지와 같은 글', () => {
    const on = instructionsText({ ...base, m3: { promote: true } })
    for (const s of [
      'a machine can check the rule, add the check to the repository',
      '`check: <command or lint rule name>`',
      'list the same name in `rules` of `.relay/quality.json`',
      "is that check's allow list",
      'the list only shrinks',
      'A `rule_violation` debt item names the check in `anchor.metric`',
    ])
      expect(on, s).toContain(s)
    const off = instructionsText(base)
    expect(off).not.toContain('Rule checks')
    expect(instructionsText({ ...base, m3: { promote: false } })).toBe(off)
    // 지식 잇기와 함께 켜면 지식 문단 뒤에 온다
    const both = instructionsText({ ...base, m3: { knowledge: true, promote: true } })
    expect(both.indexOf('Rule checks')).toBeGreaterThan(both.indexOf('Knowledge: '))
  })
})

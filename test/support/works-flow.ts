// [흐름] Works 시험의 바탕: 계약·고침 커밋·push와 PR 단계, 임시 레포와 bare origin, 가짜 gh 상태, 가짜 claude의 시나리오와
// 기록, 앱 열기. test/flow/works*.test.ts가 함께 쓴다.
//
//   const kit = flowKit()                       // beforeAll·afterEach·afterAll을 건다
//   await kit.scenario([{ do: 'mcp', tool: 'submit_contract', args: CONTRACT }, FIX_COMMIT, ...PUSH_AND_PR])
//   const app = await kit.openApp(home)         // 시험이 끝나면 닫는다

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'
import type { WorkView } from '../../src/shared/api.ts'
import { calc, QUALITY_TEXT, TESTS_BASE } from './calc.ts'
import { fakeGhOnPath } from './fakes.ts'
import { cleanupAll, makeRepo, makeTempDir, runGit, type TestRepo } from './repo.ts'
import { jsonl, openApp as open, until as wait, type TestApp } from './works-app.ts'

export const RELAY_VERSION = '0.0.0-test'
export const CLAUDE_VERSION = '0.0.0 (가짜 Claude Code)'
export const REQUEST = 'clamp fix: 값이 위로 넘으면 hi로 잘라야 하는데 lo가 나와요.'

// 계약 id는 지침이 준 것(작업 브랜치 relay/<계약 id>). 가짜 claude가 {contractId}를 채운다
export const CONTRACT = {
  version: 1,
  id: '{contractId}',
  goal: 'clamp가 hi보다 큰 값을 hi로 자른다',
  lines: [
    {
      id: 'C1',
      kind: 'change',
      text: 'hi보다 큰 값은 hi가 된다',
      grounds: [
        { type: 'code', path: 'src/calc.js', line: 5, name: 'clamp' },
        { type: 'request', quote: '위로 넘으면 hi로' },
      ],
      examples: ['C1.1'],
      check: 'test',
    },
    {
      id: 'C2',
      kind: 'keep',
      text: '더하기는 그대로',
      grounds: [{ type: 'guess' }],
      examples: ['C2.1'],
      check: 'test',
    },
  ],
  examples: [
    { id: 'C1.1', input: [15, 0, 10], output: 10 },
    { id: 'C2.1', input: [2, 3], output: 5 },
  ],
  non_goals: [],
  human_rules: [],
  tidy: [],
}

const TESTS_FIXED = `${TESTS_BASE}
import { readFileSync } from 'node:fs'
const examples = JSON.parse(
  readFileSync(new URL('../.relay/examples/{contractId}.json', import.meta.url), 'utf8'),
)

test('더하기는 그대로 [{contractId}:C2.1]', () => {
  assert.equal(add(2, 3), 5)
})

test('위로 넘는 값은 hi로 [{contractId}:C1.1]', () => {
  const { input, output } = examples['C1.1']
  assert.equal(clamp(...input), output)
})
`

export const FIX_COMMIT = {
  do: 'commit',
  message: 'clamp 고침',
  files: {
    'src/calc.js': calc('hi'),
    'test/calc.test.js': TESTS_FIXED,
    '.relay/examples/{contractId}.json': '{ "C1.1": { "input": [15, 0, 10], "output": 10 } }\n',
  },
}

export const PUSH_AND_PR = [
  { do: 'bash', command: 'git push -u origin HEAD' },
  { do: 'bash', command: 'gh pr create --title "clamp 고침" --body b --base main' },
]

export type Entry = Record<string, unknown>

export const settled = (v: WorkView) => !v.evidenceRunning && !v.reviewRunning

export interface FlowKit {
  /** 임시 폴더(가짜 gh 상태, 시나리오, 기록) */
  readonly tmp: string
  readonly repo: TestRepo
  readonly ghState: string
  readonly ghLog: string
  /** 가짜 claude의 시나리오와 기록 파일을 정한다. 세션을 띄우기 전에 부른다 */
  scenario(s: unknown): Promise<void>
  /** 가짜 claude의 기록(마지막 시나리오) */
  fake(): Promise<Entry[]>
  mcpResults(tool: string): Promise<Entry[]>
  openApp(
    home: string,
    o?: { prPollMs?: number; claudeBin?: string; reviewDisabled?: boolean },
  ): Promise<TestApp>
  /** 시험이 열고 스스로 닫은 앱을 목록에서 뺀다 */
  forget(app: TestApp): void
  until(ok: () => boolean | Promise<boolean>, what: string): Promise<void>
  /** 가짜 gh 상태를 고친다 */
  gh(edit: (state: Entry & { prs?: Entry[] }) => void): Promise<void>
}

export function flowKit(): FlowKit {
  let tmp = ''
  let repo: TestRepo | null = null
  let claudeLog = ''
  let scenarios = 0
  const logs: string[] = []
  const apps: TestApp[] = []

  beforeAll(async () => {
    tmp = await makeTempDir('relay-works-')
    const origin = join(tmp, 'origin.git')
    await runGit(tmp, ['init', '--quiet', '--bare', '--initial-branch', 'main', origin])
    repo = await makeRepo({
      files: {
        'package.json': '{ "name": "calc", "private": true, "type": "module" }\n',
        '.gitignore': '.relay-out/\n',
        '.relay/quality.json': QUALITY_TEXT,
        'src/calc.js': calc('lo'),
        'test/calc.test.js': TESTS_BASE,
      },
    })
    await repo.git('remote', 'add', 'origin', origin)
    await repo.git('push', '--quiet', 'origin', 'main')
    for (const [k, v] of Object.entries(await fakeGhOnPath(tmp))) vi.stubEnv(k, v)
    await writeFile(kit.ghState, '{}')
    vi.stubEnv('FAKE_GH_STATE', kit.ghState)
    vi.stubEnv('FAKE_GH_LOG', kit.ghLog)
    const review = join(tmp, 'review.json')
    await writeFile(
      review,
      JSON.stringify({
        findings: [{ severity: 'low', text: '이름이 짧음', file: 'src/calc.js', line: 5 }],
      }),
    )
    vi.stubEnv('FAKE_CLAUDE_REVIEW', review)
    vi.stubEnv('FAKE_CLAUDE_VERSION', CLAUDE_VERSION)
  })

  afterEach(async (ctx) => {
    for (const a of apps.splice(0)) await a.close()
    if (ctx.task.result?.state === 'fail' && logs.length) console.error(logs.join('\n'))
    logs.length = 0
  })

  afterAll(async () => {
    vi.unstubAllEnvs()
    await cleanupAll()
  })

  const kit: FlowKit = {
    get tmp() {
      return tmp
    },
    get repo() {
      if (!repo) throw new Error('flowKit의 beforeAll 전')
      return repo
    },
    get ghState() {
      return join(tmp, 'gh-state.json')
    },
    get ghLog() {
      return join(tmp, 'gh.jsonl')
    },
    async scenario(s) {
      const file = join(tmp, `scenario-${++scenarios}.json`)
      await writeFile(file, JSON.stringify(s))
      claudeLog = join(tmp, `claude-${scenarios}.jsonl`)
      vi.stubEnv('FAKE_CLAUDE_SCENARIO', file)
      vi.stubEnv('FAKE_CLAUDE_LOG', claudeLog)
    },
    fake: () => jsonl(claudeLog),
    async mcpResults(tool) {
      const log = await jsonl(claudeLog)
      return log.filter((e) => e.type === 'mcp' && e.tool === tool).map((e) => e.result as Entry)
    },
    async openApp(home, o = {}) {
      const log = (m: string, e?: unknown) =>
        void logs.push(`${m} ${e instanceof Error ? e.stack : String(e ?? '')}`)
      const app = await open({
        home,
        relayVersion: RELAY_VERSION,
        claudeVersion: CLAUDE_VERSION,
        log,
        ...(o.prPollMs ? { prPollMs: o.prPollMs } : {}),
        ...(o.claudeBin ? { claudeBin: o.claudeBin } : {}),
        ...(o.reviewDisabled ? { reviewDisabled: true } : {}),
      })
      apps.push(app)
      return app
    },
    forget(app) {
      const i = apps.indexOf(app)
      if (i >= 0) apps.splice(i, 1)
    },
    until: (ok, what) =>
      wait(ok, what).catch((e: Error) => {
        throw new Error(`${e.message}\n${logs.join('\n')}`)
      }),
    async gh(edit) {
      const state = JSON.parse(await readFile(kit.ghState, 'utf8')) as Entry & { prs?: Entry[] }
      edit(state)
      await writeFile(kit.ghState, JSON.stringify(state))
    },
  }
  return kit
}

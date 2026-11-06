// [흐름] 리뷰 재생(m2.1-design 14절 O2, scripts/review-replay.ts)을 명령줄로 돌린다: 저장된 평가 결과의 꼴(results/m2-main-*,
// run.json, works/<id>/, final/<id>.diff)과 시나리오 레포를 임시 폴더에 만들고, 묶음 고르기 → 임시 checkout(덧씌우기, git apply
// -p2) → 프롬프트 → 리뷰어 → JSONL → 요약이 이어지는지 본다. --dry(가짜 리뷰어)와 가짜 claude(-p, 같은 어댑터)를 쓴다. 고르기
// 차례, 리뷰 칸, 통과 기준의 자세한 경우는 [단위] test/unit/review-replay.test.ts가 본다. claude는 호출마다 새 설정 폴더로 뜬다.
import { execFile, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { git } from '../../src/adapters/exec.ts'
import { contractHash } from '../../src/core/contract.ts'
import { REVIEW_PROMPT_VERSION } from '../../src/core/review.ts'
import type { Contract } from '../../src/core/types.ts'
import { draftFor, draftText } from '../../src/engine/init.ts'
import { calc, TESTS_BASE } from '../support/calc.ts'
import { FAKE_CLAUDE } from '../support/fakes.ts'
import { cleanupAll, makeTempDir } from '../support/repo.ts'

afterAll(cleanupAll)

const SCRIPT = resolve(import.meta.dirname, '../../scripts/review-replay.ts')
const run = promisify(execFile)

const CONTRACT: Contract = {
  version: 1,
  id: 'fix-clamp',
  goal: 'clamp가 hi보다 큰 값을 hi로 자른다',
  lines: [
    {
      id: 'C1',
      kind: 'change',
      text: 'hi보다 큰 값은 hi가 된다',
      grounds: [{ type: 'request', quote: '위로 넘으면 hi로' }],
      examples: ['C1.1'],
      check: 'test',
    },
  ],
  non_goals: [],
  human_rules: [],
  examples: [{ id: 'C1.1', input: [11, 0, 10], output: 10 }],
  tidy: [],
}
const REQUEST =
  'clamp가 위로 넘으면 lo를 돌려준다. 위로 넘으면 hi로 고쳐 달라.\n\n## 일의 성격 제안\n\n버그 고침\n'
const FIXED_TEST = `${TESTS_BASE}
test('위로 넘는 값은 hi로 [fix-clamp:C1.1]', () => {
  assert.equal(clamp(11, 0, 10), 10)
})
`
const REPO = {
  'package.json': '{ "name": "calc", "type": "module", "scripts": { "test": "node --test" } }\n',
  'src/calc.js': calc('lo'),
  'test/calc.test.js': TESTS_BASE,
}
const CHANGE = { 'src/calc.js': calc('hi'), 'test/calc.test.js': FIXED_TEST }

let root = ''
let results = ''
let scenarios = ''

function writeFiles(dir: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true })
    writeFileSync(join(dir, rel), text)
  }
}

/** 평가의 diffTree처럼 `git diff --no-index base tree`(a/base/, b/tree/) */
function evalDiff(cwd: string, extra: string[]): string {
  const args = [
    'diff',
    '--no-index',
    '--src-prefix=a/',
    '--dst-prefix=b/',
    ...extra,
    'base',
    'tree',
  ]
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0 && r.status !== 1) throw new Error(r.stderr)
  return r.stdout
}

/** 평가가 첫 커밋에 넣은 품질 기준 덧씌우기(relay init 초안)의 글 */
async function overlayText(scenario: string): Promise<string> {
  const dir = await makeTempDir('relay-replay-overlay-')
  cpSync(join(scenarios, scenario, 'repo'), dir, { recursive: true })
  await git(['init', '-q', '-b', 'main'], dir)
  return draftText(await draftFor(dir))
}

interface WorkSpec {
  id: string
  /** 증거의 diff 경로에서 뺄 것(내보낸 head 뒤에 바뀐 파일 흉내) */
  notCommitted?: string[]
  exported?: boolean
  /** request.md(없으면 REQUEST) */
  request?: string
}

/** 실행 폴더 하나: run.json, works/<id>/{evidence,contract,request}, final/<id>.diff */
async function makeRun(
  scenario: string,
  name: string,
  o: { success: boolean; works: WorkSpec[]; overlay?: string; report?: boolean },
): Promise<void> {
  const batch = join(results, `m2-main-${scenario}`)
  const dir = join(batch, scenario, name)
  if (o.report !== false) writeFiles(batch, { 'report.json': '{}\n' })
  const works = []
  for (const w of o.works) {
    const tmp = await makeTempDir('relay-replay-tree-')
    const base = { ...REPO, ...(o.overlay ? { '.relay/quality.json': o.overlay } : {}) }
    writeFiles(join(tmp, 'base'), base)
    writeFiles(join(tmp, 'tree'), { ...base, ...CHANGE })
    const rows = evalDiff(tmp, ['--numstat'])
      .split('\n')
      .filter((l) => l !== '')
      .map((l) => l.split('\t'))
    // {base => tree}/src/calc.js, /dev/null => tree/new.js
    const paths = rows.map((r) => (r[2] ?? '').replace(/^\{base => tree\}\/|^.* => tree\//, ''))
    const kept = rows.filter((_, i) => !(w.notCommitted ?? []).includes(paths[i] ?? ''))
    const head = `${w.id}`.padEnd(40, '0')
    writeFiles(join(dir, 'works', w.id), {
      'contract.json': JSON.stringify(CONTRACT, null, 2),
      'request.md': w.request ?? REQUEST,
      'evidence.json': JSON.stringify({
        version: 1,
        repo: '',
        base: 'b'.repeat(40),
        head,
        created_at: '',
        quality: { hash: '', from: 'base' },
        contract: { id: CONTRACT.id, hash: contractHash(CONTRACT) },
        commands: [{ id: 'test', outcome: 'pass', head: [] }],
        lines: [{ line: 'C1', kind: 'change', status: 'met', examples: [], detail: '' }],
        groundings: null,
        ratchets: [],
        signals: [],
        diff: {
          files: kept.length,
          added: kept.reduce((n, r) => n + Number(r[0]), 0),
          deleted: kept.reduce((n, r) => n + Number(r[1]), 0),
          new_dependencies: [],
          new_modules: [],
          paths: paths.filter((p) => !(w.notCommitted ?? []).includes(p)),
          binary: [],
        },
        review: null,
        claims: null,
        contract_change_requested: false,
        missing: [],
      }),
    })
    writeFiles(join(dir, 'final'), { [`${w.id}.diff`]: evalDiff(tmp, []) })
    works.push({ id: w.id, exportedHead: head, gate: { export: w.exported ?? true } })
  }
  const options = {
    effort: 'medium',
    humanMode: 'normal',
    ...(o.overlay ? { qualityOverlay: { sha256: sha(o.overlay) } } : {}),
  }
  writeFiles(dir, {
    'run.json': JSON.stringify({ error: null, outcome: { success: o.success }, options, works }),
  })
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex')

async function replay(args: string[], env: Record<string, string> = {}) {
  const all = ['--results', results, '--scenarios', scenarios, ...args]
  try {
    const r = await run(process.execPath, [SCRIPT, ...all], { env: { ...process.env, ...env } })
    return { code: 0, ...r }
  } catch (e) {
    const x = e as { code?: number; stdout?: string; stderr?: string }
    return { code: x.code ?? 1, stdout: x.stdout ?? '', stderr: x.stderr ?? '' }
  }
}

const readLines = (file: string) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => JSON.parse(l) as Record<string, unknown>)
const callKeys = (lines: Record<string, unknown>[]) =>
  lines.map((l) => `${String(l['key'])}#${String(l['repeat'])}`).sort()

const A = '14-double-notify/relay3-1/aaaa0001'
const B1 = '07-two-bugs/relay3-1/bbbb0001'
const B2 = '07-two-bugs/relay3-1/bbbb0002'
const B3 = '07-two-bugs/relay3-2/eeee0002'
/** Work 둘인 실행에서 07의 리포트 둘을 다 받은 Work: B에서 뺀다 */
const WIDE = '07-two-bugs/relay3-2/eeee0001'
const KEYS = [`${A}#1`, `${A}#2`, `${A}#3`, `${B1}#1`, `${B2}#1`, `${B3}#1`].sort()
/** 07의 리포트 둘(scenario.json report): REQUEST는 첫째만 담는다 */
const REPORTS = [
  'clamp가 위로 넘으면 lo를 돌려준다. (src/calc.js)',
  'sum이 빈 목록에 NaN을 돌려준다. (src/sum.js)',
]

beforeAll(async () => {
  root = await makeTempDir('relay-review-replay-flow-')
  results = join(root, 'results')
  scenarios = join(root, 'scenarios')
  for (const s of ['14-double-notify', '07-two-bugs', '08-timezone'])
    writeFiles(join(scenarios, s, 'repo'), REPO)
  writeFiles(join(scenarios, '07-two-bugs'), {
    'scenario.json': JSON.stringify({ report: REPORTS }),
  })
  const overlay = await overlayText('14-double-notify')
  // 대상 A: 14의 숨긴 시험 실패. 14의 통과는 대상이 아니다
  await makeRun('14-double-notify', 'relay3-1', {
    success: false,
    overlay,
    works: [{ id: 'aaaa0001' }],
  })
  await makeRun('14-double-notify', 'relay3-2', {
    success: true,
    overlay,
    works: [{ id: 'aaaa0002' }],
  })
  // 대상 B: 07의 통과. 둘째 Work는 내보낸 뒤 테스트 파일이 바뀐 것처럼 증거에 그 파일이 없다
  await makeRun('07-two-bugs', 'relay3-1', {
    success: true,
    works: [{ id: 'bbbb0001' }, { id: 'bbbb0002', notCommitted: ['test/calc.test.js'] }],
  })
  // Work 둘인 실행에서 리포트 둘을 다 받은 Work는 B에서 빠지고 그 실행의 다른 Work가 고른다
  await makeRun('07-two-bugs', 'relay3-2', {
    success: true,
    works: [{ id: 'eeee0001', request: REPORTS.join('\n') }, { id: 'eeee0002' }],
  })
  // 빠지는 것: 내보내기 결론이 없는 Work, report.json이 없는 배치
  await makeRun('07-two-bugs', 'relay3-noreview-1', {
    success: true,
    works: [{ id: 'cccc0001', exported: false }],
  })
  await makeRun('08-timezone', 'relay3-1', {
    success: true,
    report: false,
    works: [{ id: 'dddd0001' }],
  })
})

describe('리뷰 재생', () => {
  test('--dry: 고른 묶음마다 레포를 다시 만들어 프롬프트를 짓고 가짜 리뷰어의 줄을 쓴다', async () => {
    const out = join(root, 'dry.jsonl')
    const prompts = join(root, 'prompts')
    const r = await replay(['--dry', '--out', out, '--prompts', prompts])
    expect(r.stderr).not.toContain('준비 실패')
    expect(r.code).toBe(0)
    const lines = readLines(out)
    expect(callKeys(lines)).toEqual(KEYS)
    for (const l of lines)
      expect(l).toMatchObject({
        status: 'done',
        dry: true,
        prompt_version: REVIEW_PROMPT_VERSION,
        request: true,
        request_gap: true,
        raises: { 'structure/medium': 1 },
        memos: 3,
      })
    const at = (key: string) => lines.find((l) => l['key'] === key)?.['checkout']
    expect(at(A)).toEqual({ overlay: 'same', same_as_evidence: true, contract_same: true })
    expect(at(B1)).toEqual({ overlay: 'not_recorded', same_as_evidence: true, contract_same: true })
    expect(at(B2)).toMatchObject({ same_as_evidence: false })
    expect(lines.find((l) => l['key'] === A)).toMatchObject({ target: 'A', hidden_pass: false })

    const prompt = readFileSync(join(prompts, `${A.replaceAll('/', '_')}.md`), 'utf8')
    expect(prompt).toContain('## Request')
    expect(prompt).toContain('> clamp가 위로 넘으면 lo를 돌려준다.')
    expect(prompt).toContain('> ## 일의 성격 제안')
    expect(prompt).toContain('- command test: pass')
    expect(prompt).toContain('diff --git a/src/calc.js b/src/calc.js')
    expect(prompt).toContain('+  return n < lo ? lo : n > hi ? hi : n')
    expect(prompt).not.toContain('.relay/quality.json')

    expect(r.stdout).toContain('--dry: 가짜 리뷰어의 고정 지적이라 판정에 쓰지 않는다')
    expect(r.stdout).toContain('호출: 계획 6, 끝남 6, 실패 0, 남음 0')
    expect(r.stdout).toContain('주의: 계획(A 1묶음, B 3묶음, 6번)이 설계')
    expect(r.stdout).toContain(`diff가 증거와 다른 묶음 1 (${B2})`)
    expect(r.stdout).toContain(`요청이 Work의 몫보다 넓음): 1 (${WIDE} (full_report))`)

    // --dry는 다시 돌면 파일을 갈아 쓰고, --resume은 끝난 호출을 건너뛴다
    expect((await replay(['--dry', '--out', out])).code).toBe(0)
    const again = await replay(['--dry', '--resume', '--out', out])
    expect(again.stderr).toContain('0번 부른다')
    expect(readLines(out)).toHaveLength(6)
  })

  test('claude -p: 앱의 어댑터와 읽기 도구로 부르고, --limit 뒤 --resume으로 잇는다', async () => {
    const out = join(root, 'real.jsonl')
    const log = join(root, 'fake-claude.jsonl')
    const review = join(root, 'review.json')
    writeFileSync(
      review,
      JSON.stringify({
        findings: [
          { severity: 'high', raise: 'request_gap', text: '다른 원인' },
          { severity: 'low', raise: 'structure', text: '시험 없음' },
        ],
      }),
    )
    // 운영자의 Claude Code 세션 변수(CLAUDECODE 등)는 리뷰어에게 가지 않는다
    const operator = { CLAUDECODE: '1', CLAUDE_CODE_SYNC_SKILLS: '1', ANTHROPIC_BASE_URL: 'x' }
    const env = {
      ...operator,
      CLAUDE_BIN: FAKE_CLAUDE,
      FAKE_CLAUDE_REVIEW: review,
      FAKE_CLAUDE_LOG: log,
    }
    const first = await replay(['--out', out, '--limit', '2', '--jobs', '1'], env)
    expect(first.code).toBe(0)
    expect(readLines(out)).toHaveLength(2)
    expect(first.stdout).toContain('끝남 2, 실패 0, 남음 4 (--resume으로 잇는다)')

    const refused = await replay(['--out', out], env)
    expect(refused.code).toBe(1)
    expect(refused.stderr).toContain('이미 있음')

    const rest = await replay(['--out', out, '--resume'], env)
    expect(rest.code).toBe(0)
    const lines = readLines(out)
    expect(callKeys(lines)).toEqual(KEYS)
    for (const l of lines)
      expect(l).toMatchObject({
        status: 'done',
        dry: false,
        request_gap: true,
        raises: {},
        memos: 2,
        usage: { input_tokens: 1000, output_tokens: 50 },
      })
    expect(rest.stdout).toContain('토큰: 입력(캐시 포함) 6000, 출력 300')

    const calls = readLines(log).filter((e) => e['type'] === 'review')
    expect(calls).toHaveLength(6)
    // 호출마다 새 설정 폴더(평가의 makeClaudeConfig와 같은 내용). 운영자의 설정 폴더를 쓰지 않고, 끝나면 지운다
    const configs = calls.map((c) => c['config'] as Record<string, unknown>)
    expect(new Set(configs.map((c) => c['dir'])).size).toBe(6)
    for (const c of configs) {
      expect(c['dir']).not.toBe(process.env.CLAUDE_CONFIG_DIR)
      expect(c).toMatchObject({
        names: ['.claude.json', 'settings.json'],
        claudeJson: JSON.stringify({ hasCompletedOnboarding: true }, null, 2),
        settings: JSON.stringify({ promptSuggestionEnabled: false }, null, 2),
      })
      expect(existsSync(String(c['dir']))).toBe(false)
    }
    for (const c of calls)
      expect(c['claudeEnv']).toEqual([
        'CLAUDE_CODE_EFFORT_LEVEL',
        'CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION',
        'CLAUDE_CONFIG_DIR',
      ])
    for (const c of calls) {
      const args = c['args'] as string[]
      expect(args[args.indexOf('--tools') + 1]).toBe('Read,Grep,Glob')
      expect(args[args.indexOf('--setting-sources') + 1]).toBe('user')
      expect(args).toContain('--json-schema')
      expect(String(c['prompt'])).toContain('## Request')
      // 임시 checkout은 끝나면 지운다
      expect(existsSync(String(c['cwd']))).toBe(false)
    }
  })
})

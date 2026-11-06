// [흐름] 관문 5회 반복 안정성(M4f, m4-design 8절, scripts/gate-repeat.ts)을 명령줄로 돌린다. 실제 git 임시 레포에서 (A) check
// 반복(반복마다 새 RELAY_HOME, 고정 리뷰, 초안 정책) → JSONL → 갈린 칸 요약, (B) 리뷰 반복(--dry 가짜 리뷰어) → 요약, 평가 결과의
// 꼴에서 대상 만들기(targets)가 이어지는지 본다. 원래 레포의 ref·worktree 등록은 바뀌지 않는다. 갈린 칸과 리뷰·생성 셈의
// 자세한 경우는 [단위] test/unit/stability.test.ts가 본다. 비용이 드는 실제 측정(5회, claude)은 돌리지 않는다.
import { execFile, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { contractHash, examplesFileText } from '../../src/core/contract.ts'
import type { Contract } from '../../src/core/types.ts'
import type { CheckLine, ReviewLine, Target } from '../../scripts/gate-repeat.ts'
import { calc, QUALITY_TEXT, TESTS_BASE } from '../support/calc.ts'
import { cleanupAll, makeRepo, makeTempDir, writeFiles, type TestRepo } from '../support/repo.ts'

afterAll(cleanupAll)

const SCRIPT = resolve(import.meta.dirname, '../../scripts/gate-repeat.ts')
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
  approved_by: 'human',
}
const REQUEST = 'clamp가 위로 넘으면 lo를 돌려준다. 위로 넘으면 hi로 고쳐 달라.\n'
const FIXED_TEST = `${TESTS_BASE}
test('위로 넘는 값은 hi로 [fix-clamp:C1.1]', () => {
  assert.equal(clamp(11, 0, 10), 10)
})
`

/** 처음 한 번만 실패하는 시험(카운터 파일이 레포 밖에 있다): 첫 반복의 fast 명령만 흔들린다 */
const flakyTest = (counter: string) => `import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

test('처음 한 번만 실패', () => {
  const n = existsSync(${JSON.stringify(counter)}) ? Number(readFileSync(${JSON.stringify(counter)}, 'utf8')) : 0
  writeFileSync(${JSON.stringify(counter)}, String(n + 1))
  assert.ok(n > 0)
})
`

async function gateRepeat(args: string[]) {
  try {
    const r = await run(process.execPath, [SCRIPT, ...args], { maxBuffer: 16 * 1024 * 1024 })
    return { code: 0, ...r }
  } catch (e) {
    const x = e as { code?: number; stdout?: string; stderr?: string }
    return { code: x.code ?? 1, stdout: x.stdout ?? '', stderr: x.stderr ?? '' }
  }
}

const readLines = <T>(file: string): T[] =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => JSON.parse(l) as T)

/** 원래 레포의 ref와 worktree 등록(바뀌면 안 된다) */
const repoState = async (repo: TestRepo) =>
  `${await repo.git('for-each-ref')}\n${await repo.git('worktree', 'list', '--porcelain')}`

describe('gate-repeat: (A) check와 (B) 리뷰 반복', () => {
  let repo: TestRepo
  let dir: string
  let targets: string
  let before: string

  beforeAll(async () => {
    dir = await makeTempDir('relay-gate-repeat-test-')
    const counter = join(dir, 'flaky-counter')
    repo = await makeRepo({
      files: {
        'package.json': '{ "name": "calc", "private": true, "type": "module" }\n',
        '.gitignore': '.relay-out/\n',
        '.relay/quality.json': QUALITY_TEXT,
        'src/calc.js': calc('lo'),
        'test/calc.test.js': TESTS_BASE,
      },
    })
    await repo.branch('fix')
    await repo.commit('clamp 고침', {
      'src/calc.js': calc('hi'),
      'test/calc.test.js': FIXED_TEST,
      '.relay/examples/fix-clamp.json': examplesFileText(CONTRACT),
    })
    await repo.branch('flaky', 'fix')
    await repo.commit('처음 한 번 실패하는 시험', { 'test/flaky.test.js': flakyTest(counter) })
    await repo.checkout('main')
    await writeFile(join(dir, 'contract.json'), JSON.stringify(CONTRACT))
    await writeFile(join(dir, 'request.md'), REQUEST)
    const list: Target[] = [
      { name: 'fix', repo: repo.dir, base: 'main', head: 'fix', contract: 'contract.json' },
      { name: 'flaky', repo: repo.dir, base: 'main', head: 'flaky', contract: 'contract.json' },
    ].map((t) => ({ ...t, request: 'request.md' }))
    targets = join(dir, 'targets.json')
    await writeFile(targets, JSON.stringify(list))
    before = await repoState(repo)
  })

  test('(A) 반복마다 새 RELAY_HOME으로 돌고, 같은 입력은 같고 흔들린 명령은 갈린 칸으로 나온다', async () => {
    const out = join(dir, 'check.jsonl')
    const r = await gateRepeat(['check', '--targets', targets, '--repeats', '2', '--out', out])
    expect(r.code, r.stderr).toBe(0)
    const lines = readLines<CheckLine>(out)
    expect(lines.map((l) => `${l.name}#${l.repeat}:${l.status}`)).toEqual([
      'fix#1:done',
      'fix#2:done',
      'flaky#1:done',
      'flaky#2:done',
    ])
    const fix = lines.filter((l) => l.name === 'fix')
    expect(fix[0]?.digest).toEqual(fix[1]?.digest)
    expect(fix[0]?.digest).toMatchObject({
      'commands.unit': 'pass',
      'commands.accept': 'pass',
      'lines.C1': 'met',
      examples_file: 'same',
      met: 'small',
      conclusion: 'human_merge',
      decisive: '프로젝트에서 자동 머지가 꺼져 있음',
    })
    // 첫 반복의 첫 실행만 실패: 흔들리는 시험 규칙이 unstable로 본다. 다음 반복은 통과
    const flaky = lines.filter((l) => l.name === 'flaky')
    expect(flaky.map((l) => l.digest['commands.unit'])).toEqual(['unstable', 'pass'])
    expect(r.stdout).toContain('- fix: 2회 → 같음')
    expect(r.stdout).toMatch(/- flaky: 2회 → (결론이 갈림|칸이 갈림)/)
    expect(r.stdout).toContain('  commands.unit: unstable | pass')
    expect(r.stdout).toMatch(/결정론 입력만으로 결론\(또는 채운 조건\)이 갈린 head: \d\/2/)
    expect(await repoState(repo)).toBe(before)
  })

  test('(A) 이미 있는 결과는 --resume 없이 덮지 않고, --resume은 끝난 반복을 건너뛴다', async () => {
    const out = join(dir, 'check.jsonl')
    const again = await gateRepeat(['check', '--targets', targets, '--repeats', '2', '--out', out])
    expect(again.code).toBe(1)
    expect(again.stderr).toContain('이미 있음')
    const resume = ['check', '--targets', targets, '--repeats', '2', '--out', out, '--resume']
    expect((await gateRepeat(resume)).code).toBe(0)
    expect(readLines<CheckLine>(out)).toHaveLength(4)
  })

  test('(B) --dry 리뷰 반복: 앱처럼 만든 프롬프트로 리뷰만 반복하고 올림 갈래를 센다', async () => {
    const out = join(dir, 'review.jsonl')
    const r = await gateRepeat([
      'review',
      '--targets',
      targets,
      '--repeats',
      '2',
      '--dry',
      '--out',
      out,
    ])
    expect(r.code, r.stderr).toBe(0)
    const lines = readLines<ReviewLine>(out)
    expect(lines).toHaveLength(4)
    expect(lines.every((l) => l.status === 'done' && l.dry)).toBe(true)
    // 가짜 리뷰어의 지적 가운데 지금 올림 규칙(core raises)이 올리는 것만
    expect(lines[0]?.raises).toEqual({ 'structure/medium': 1 })
    expect(r.stdout).toContain('반복이 둘 이상인 head 2개 가운데 올림 유무가 갈림 0, 올림 갈래')
    expect(r.stdout).toContain('--dry: 가짜 리뷰어')
    // 줄에 모델 이름 칸이 없고, 비용 어림의 토큰 칸(가짜 리뷰어는 빈 usage)과 요약의 한 번 비용이 있다
    expect(lines.some((l) => 'model' in l)).toBe(false)
    expect(lines.map((l) => l.usage)).toEqual([{}, {}, {}, {}])
    expect(r.stdout).toContain('리뷰 한 번(끝난 반복 4, 토큰을 적은 반복 4)')
    expect(await repoState(repo)).toBe(before)
  })

  test('(B) --from: 이미 있는 리뷰 반복 자료(review-replay.ts의 줄)를 세기만 한다', async () => {
    const from = join(dir, 'replay.jsonl')
    const line = (repeat: number, raises: Record<string, number>) =>
      JSON.stringify({ key: 'a/relay3-1/w', repeat, status: 'done', raises })
    const rows = [line(1, { 'structure/medium': 1 }), line(2, {}), line(3, { 'structure/high': 1 })]
    await writeFile(from, `${rows.join('\n')}\n`)
    const r = await gateRepeat(['review', '--from', from])
    expect(r.code, r.stderr).toBe(0)
    expect(r.stdout).toContain(
      '- a/relay3-1/w: ●○● structure | - | structure [유무 갈림] [갈래 갈림]',
    )
  })
})

describe('gate-repeat targets: 평가 결과의 묶음에서 대상 만들기', () => {
  /** results/<batch>-<시나리오>/<시나리오>/<run>에 묶음 w1 하나인 평가 결과와 시나리오 레포 */
  async function evalResults(batch: string, run: string) {
    const root = await makeTempDir('relay-gate-repeat-eval-')
    const scenarios = join(root, 'scenarios')
    const results = join(root, 'results')
    const s = '14-double-notify'
    const base = {
      'package.json':
        '{ "name": "calc", "type": "module", "scripts": { "test": "node --test" } }\n',
      'src/calc.js': calc('lo'),
      'test/calc.test.js': TESTS_BASE,
    }
    await writeFiles(join(scenarios, s, 'repo'), base)
    // 평가의 diffTree처럼 `git diff --no-index base tree`(a/base/, b/tree/)
    const tmp = await makeTempDir('relay-gate-repeat-tree-')
    await writeFiles(join(tmp, 'base'), base)
    await writeFiles(join(tmp, 'tree'), {
      ...base,
      'src/calc.js': calc('hi'),
      'test/calc.test.js': FIXED_TEST,
    })
    const diff = spawnSync('git', ['diff', '--no-index', 'base', 'tree'], {
      cwd: tmp,
      encoding: 'utf8',
    }).stdout
    const runDir = join(results, `${batch}-${s}`, s, run)
    const head = 'a'.repeat(40)
    await writeFiles(join(results, `${batch}-${s}`), { 'report.json': '{}\n' })
    await writeFiles(runDir, {
      'run.json': JSON.stringify({
        error: null,
        outcome: { success: false },
        options: { effort: 'medium', humanMode: 'normal' },
        works: [{ id: 'w1', exportedHead: head, gate: { export: true } }],
      }),
      'final/w1.diff': diff,
      'works/w1/contract.json': JSON.stringify(CONTRACT),
      'works/w1/request.md': REQUEST,
      'works/w1/evidence.json': JSON.stringify({
        head,
        contract: { id: CONTRACT.id, hash: contractHash(CONTRACT) },
        diff: { files: 2, added: 4, deleted: 1, paths: ['src/calc.js', 'test/calc.test.js'] },
      }),
    })
    return { root, results, scenarios, s }
  }

  test('시나리오 레포 + 품질 기준 덧씌우기가 base, final diff가 head인 checkout과 targets.json', async () => {
    const { root, results, scenarios, s } = await evalResults('m2-main', 'relay3-1')
    const into = join(root, 'targets')
    const args = ['targets', '--bundle', `${s}/relay3-1/w1`, '--into', into]
    const r = await gateRepeat([...args, '--results', results, '--scenarios', scenarios])
    expect(r.code, r.stderr).toBe(0)
    const list = JSON.parse(readFileSync(join(into, 'targets.json'), 'utf8')) as Target[]
    const name = `${s}_relay3-1_w1`
    expect(list).toEqual([
      {
        name: `${s}/relay3-1/w1`,
        repo: name,
        base: 'HEAD~1',
        head: 'HEAD',
        contract: `${name}.contract.json`,
        request: `${name}.request.md`,
        options: { effort: 'medium' },
      },
    ])
    expect(existsSync(join(into, `${name}.contract.json`))).toBe(true)
    // head는 final diff를 얹은 커밋, base는 덧씌운 품질 기준을 담는다
    const show = (ref: string) =>
      spawnSync('git', ['show', ref], { cwd: join(into, name), encoding: 'utf8' }).stdout
    expect(show('HEAD:src/calc.js')).toBe(calc('hi'))
    expect(show('HEAD~1:.relay/quality.json')).toContain('"auto"')
    // 그 대상으로 (A)가 돈다
    const out = join(root, 'check.jsonl')
    const target = join(into, 'targets.json')
    const c = await gateRepeat(['check', '--targets', target, '--repeats', '1', '--out', out])
    expect(c.code, c.stderr).toBe(0)
    expect(readLines<CheckLine>(out).map((l) => l.status)).toEqual(['done'])
  })

  test('M2.1 배치(m21-design, m21-sealed)의 relay3-m21 묶음에서도 만든다', async () => {
    for (const batch of ['m21-design', 'm21-sealed']) {
      const { root, results, scenarios, s } = await evalResults(batch, 'relay3-m21-2')
      const into = join(root, 'targets')
      const args = ['targets', '--bundle', `${s}/relay3-m21-2/w1`, '--into', into]
      const r = await gateRepeat([...args, '--results', results, '--scenarios', scenarios])
      expect(r.code, r.stderr).toBe(0)
      const list = JSON.parse(readFileSync(join(into, 'targets.json'), 'utf8')) as Target[]
      expect(list.map((t) => t.name)).toEqual([`${s}/relay3-m21-2/w1`])
      const show = spawnSync('git', ['show', 'HEAD:src/calc.js'], {
        cwd: join(into, `${s}_relay3-m21-2_w1`),
        encoding: 'utf8',
      }).stdout
      expect(show).toBe(calc('hi'))
    }
    // M2 배치에 없는 쪽 이름은 M2 배치에서 찾지 않는다
    const { root, results, scenarios, s } = await evalResults('m2-main', 'relay3-m21-1')
    const args = ['targets', '--bundle', `${s}/relay3-m21-1/w1`, '--into', join(root, 'targets')]
    const r = await gateRepeat([...args, '--results', results, '--scenarios', scenarios])
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('묶음을 찾지 못함')
  })
})

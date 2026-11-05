// [흐름] check: 실제 git 임시 레포에서 diff → 명령 → 수용 시험 → 줄 판정 → 래칫 → 묶음 → 관문.
// 레포는 의존성 없는 작은 node 프로젝트이고 시험은 node:test로 돈다.

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { evidencePath, repoKey } from '../../src/adapters/store.ts'
import { gate } from '../../src/core/gate.ts'
import {
  contractHash,
  examplesFileText,
  parseContract,
  sliceContract,
} from '../../src/core/contract.ts'
import { parseQuality, qualityHash } from '../../src/core/quality.ts'
import type {
  AutoCondition,
  Contract,
  EvidenceBundle,
  GateResult,
  Policy,
} from '../../src/core/types.ts'
import { check } from '../../src/engine/check.ts'
import { cleanupAll, makeRepo, makeTempDir, nodeCommand, type TestRepo } from '../support/repo.ts'

afterAll(cleanupAll)

import { byId, calc, MAIN, NOW, QUALITY, QUALITY_TEXT, TESTS_BASE } from '../support/calc.ts'

// 예시 자료(.relay/examples/<계약 id>.json)를 읽는 바뀜 시험. base에 얹으면 단언에서 실패한다
const TESTS_FIXED = `${TESTS_BASE}
import { readFileSync } from 'node:fs'
const examples = JSON.parse(
  readFileSync(new URL('../.relay/examples/fix-clamp.json', import.meta.url), 'utf8'),
)

test('위로 넘는 값은 hi로 [fix-clamp:C1.1]', () => {
  const { input, output } = examples['C1.1']
  assert.equal(clamp(...input), output)
})
`

const CONTRACT = {
  version: 1,
  id: 'fix-clamp',
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
  approved_by: 'human',
}

const REQUEST = 'clamp가 이상해요. 값이 위로 넘으면 hi로 잘라야 하는데 lo가 나와요.'

const parsedQuality = parseQuality(QUALITY_TEXT)
if (!parsedQuality.ok) throw new Error(parsedQuality.errors.join('\n'))
const AUTO: AutoCondition[] = parsedQuality.value.auto
const parsedContract = parseContract(JSON.stringify(CONTRACT))
if (!parsedContract.ok) throw new Error(parsedContract.errors.join('\n'))
const contract: Contract = parsedContract.value

function policy(over: Partial<Policy> = {}): Policy {
  return {
    auto_merge_enabled: false,
    conditions: AUTO,
    server: null,
    track_record_ok: {},
    ...over,
  }
}

function relay(
  cwd: string,
  home: string,
  ...args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((done) => {
    execFile(
      process.execPath,
      [MAIN, ...args],
      { cwd, env: { ...process.env, RELAY_HOME: home }, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === 'number' ? error.code : -1
        done({ code, stdout, stderr })
      },
    )
  })
}

describe('계약이 있는 버그 고침', () => {
  let repo: TestRepo
  let home: string
  let contractPath: string
  let requestPath: string
  let bundle: EvidenceBundle

  beforeAll(async () => {
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
      'test/calc.test.js': TESTS_FIXED,
      // 앱이 계약에서 쓴 정규 파일을 세션이 커밋했다(V27)
      '.relay/examples/fix-clamp.json': examplesFileText(contract),
    })
    home = await makeTempDir('relay-home-')
    const files = await makeTempDir('relay-work-')
    contractPath = join(files, 'contract.json')
    requestPath = join(files, 'request.txt')
    await writeFile(contractPath, JSON.stringify(CONTRACT))
    await writeFile(requestPath, REQUEST)
    bundle = await check({
      repo: repo.dir,
      base: 'main',
      head: 'fix',
      contractPath,
      requestPath,
      home,
      now: NOW,
    })
  })

  test('묶음은 base 기준의 품질 기준과 두 커밋을 담는다', async () => {
    expect(bundle.version).toBe(1)
    expect(bundle.repo).toBe(repo.dir)
    expect(bundle.base).toBe(await repo.sha('main'))
    expect(bundle.head).toBe(await repo.sha('fix'))
    expect(bundle.created_at).toBe(NOW)
    expect(bundle.quality).toEqual({ hash: qualityHash(QUALITY_TEXT), from: 'base' })
    expect(bundle.contract).toEqual({ id: 'fix-clamp', hash: contractHash(contract) })
    expect(bundle.missing).toEqual([])
    expect(bundle.review).toBeNull()
    expect(bundle.claims).toBeNull()
    expect(bundle.contract_change_requested).toBe(false)
    expect(bundle.examples_file).toEqual({
      path: '.relay/examples/fix-clamp.json',
      status: 'same',
      diffs: [],
    })
  })

  test('fast 명령과 수용 시험이 통과한다', () => {
    expect(bundle.commands.map((c) => [c.id, c.outcome])).toEqual([
      ['unit', 'pass'],
      ['accept', 'pass'],
    ])
    const accept = byId(bundle.commands, 'accept')
    expect(accept?.head).toHaveLength(1)
    expect(accept?.head[0]?.tests?.map((t) => t.status)).toEqual(['passed', 'passed', 'passed'])
    // test_count 래칫 때문에 base에서도 돈다(시험을 얹지 않은 base)
    expect(accept?.base?.tests).toHaveLength(2)
    expect(byId(bundle.commands, 'unit')?.base).toBeUndefined()
  })

  test('바뀜 줄은 base에서 실패를 확인하고 met, 지킴 줄은 양쪽 통과로 met', () => {
    expect(bundle.lines).toEqual([
      {
        line: 'C1',
        kind: 'change',
        status: 'met',
        detail: '기준에서 실패, 결과에서 통과',
        examples: [{ id: 'C1.1', head: 'passed', base: 'failed' }],
      },
      {
        line: 'C2',
        kind: 'keep',
        status: 'met',
        detail: '기준과 결과에서 모두 통과',
        examples: [{ id: 'C2.1', head: 'passed', base: 'passed' }],
      },
    ])
  })

  test('커밋한 예시 자료가 틀려도 base에 얹은 시험은 승인본을 읽는다: 바뀜 줄은 승인본으로 판정(V27)', async () => {
    // 커밋된 자료의 기대 출력(0)은 base의 잘못된 동작과 같아서, 그대로 얹으면 '기준에서도 통과'가 된다
    await repo.branch('fix-wrong-data', 'main')
    await repo.commit('clamp 고침, 자료는 틀림', {
      'src/calc.js': calc('hi'),
      'test/calc.test.js': TESTS_FIXED,
      '.relay/examples/fix-clamp.json': examplesFileText({
        ...contract,
        examples: contract.examples.map((x) => (x.id === 'C1.1' ? { ...x, output: 0 } : x)),
      }),
    })
    const b = await check({
      repo: repo.dir,
      base: 'main',
      head: 'fix-wrong-data',
      contractPath,
      home,
      now: NOW,
    })
    expect(b.lines?.[0]).toMatchObject({
      line: 'C1',
      status: 'met',
      examples: [{ id: 'C1.1', head: 'passed', base: 'failed' }],
    })
    expect(b.examples_file).toMatchObject({
      status: 'differs',
      diffs: [{ id: 'C1.1', field: 'output', expected: 10, found: 0 }],
    })
  })

  test('단위 브랜치(V22): 조각의 줄만 재고, 예시 자료는 계약 전체(examplesContractPath)로 얹고 견준다', async () => {
    // 세션이 커밋하는 예시 자료는 앱이 계약 전체에서 쓴 파일 하나다
    const units: Contract = {
      ...contract,
      delivery: 'branch_per_unit',
      lines: contract.lines.map((l, i) => ({ ...l, unit: i === 0 ? 'clamp' : 'add' })),
    }
    const files = await makeTempDir('relay-work-')
    const whole = join(files, 'contract.json')
    const slice = join(files, 'contract.clamp.json')
    await writeFile(whole, JSON.stringify(units))
    await writeFile(slice, JSON.stringify(sliceContract(units, 'clamp')))
    // 다른 head에서 잰다(같은 head의 묶음 파일을 덮지 않게)
    await repo.branch('fix-units', 'main')
    await repo.commit('clamp 고침(단위)', {
      'src/calc.js': calc('hi'),
      'test/calc.test.js': TESTS_FIXED,
      '.relay/examples/fix-clamp.json': examplesFileText(contract),
    })
    const head = 'fix-units'
    const opts = { repo: repo.dir, base: 'main', head, contractPath: slice, home, now: NOW }
    const b = await check({ ...opts, examplesContractPath: whole })
    expect(b.lines?.map((l) => [l.line, l.status])).toEqual([['C1', 'met']])
    expect(b.contract).toEqual({
      id: 'fix-clamp',
      hash: contractHash(sliceContract(units, 'clamp')),
    })
    expect(b.examples_file).toEqual({
      path: '.relay/examples/fix-clamp.json',
      status: 'same',
      diffs: [],
    })
    // 조각으로 견주면 다른 단위의 예시가 승인본에 없는 예시로 보인다
    const alone = await check(opts)
    expect(alone.examples_file).toMatchObject({ status: 'differs', diffs: [{ id: 'C2.1' }] })
  })

  test('근거: 코드 줄과 요청 인용은 확인되고 추측은 확인되지 않는다', () => {
    expect(bundle.groundings?.map((g) => [g.line, g.ground.type, g.ok])).toEqual([
      ['C1', 'code', true],
      ['C1', 'request', true],
      ['C2', 'guess', false],
    ])
  })

  test('래칫: 시험 수는 늘고 파일 크기는 그대로', () => {
    expect(bundle.ratchets).toEqual([
      { id: 'tests', status: 'better', base: 2, head: 3, detail: '시험 수 2 → 3' },
      { id: 'file-size', status: 'same', detail: '600줄을 새로 넘은 파일 없음' },
    ])
  })

  test('신호가 없고 diff 요약이 맞다', () => {
    expect(bundle.signals).toEqual([])
    expect(bundle.diff.files).toBe(3)
    expect(bundle.diff.new_dependencies).toEqual([])
    expect(bundle.diff.new_modules).toEqual([])
    expect([...bundle.diff.paths].sort()).toEqual([
      '.relay/examples/fix-clamp.json',
      'src/calc.js',
      'test/calc.test.js',
    ])
    expect(bundle.diff.added + bundle.diff.deleted).toBeLessThanOrEqual(50)
  })

  test('묶음을 evidencePath에 쓴다', async () => {
    const path = evidencePath(home, repoKey(repo.dir), bundle.head)
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(bundle)
  })

  test('관문: 지금 head가 묶음의 head와 다르면 낡은 증거라 사람 머지', () => {
    const reviewed: EvidenceBundle = {
      ...bundle,
      review: { status: 'done', findings: [], request: true },
    }
    const r = gate(reviewed, contract, policy(), bundle.base)
    expect(r.decisive).toMatch(/^낡은 증거: /)
  })

  test('관문: M1은 리뷰가 없어 사람 머지(그림자 아님)', () => {
    const r = gate(bundle, contract, policy(), bundle.head)
    expect(r).toEqual<GateResult>({
      conclusion: 'human_merge',
      decisive: '리뷰 없음',
      reasons: ['리뷰 없음'],
      condition: null,
      shadow: false,
    })
  })

  test('관문: 리뷰가 붙으면 자동 조건을 채우고 스위치가 꺼져 그림자 사람 머지', () => {
    const reviewed: EvidenceBundle = {
      ...bundle,
      review: { status: 'done', findings: [], request: true },
    }
    const shadow = gate(reviewed, contract, policy(), bundle.head)
    expect(shadow.conclusion).toBe('human_merge')
    expect(shadow.shadow).toBe(true)
    expect(shadow.condition).toBe('small')
    expect(shadow.decisive).toBe('프로젝트에서 자동 머지가 꺼져 있음')

    const auto = gate(
      reviewed,
      contract,
      policy({
        auto_merge_enabled: true,
        server: {
          branch_protected: true,
          required_checks: true,
          merge_queue: false,
          up_to_date_required: true,
        },
        track_record_ok: { small: true },
      }),
      bundle.head,
    )
    expect(auto.conclusion).toBe('auto_merge_candidate')
    expect(auto.condition).toBe('small')
  })

  test('CLI: relay check --json과 relay gate를 프로세스로 돌린다', async () => {
    await repo.checkout('fix')
    const cliHome = await makeTempDir('relay-cli-home-')
    const checked = await relay(
      repo.dir,
      cliHome,
      'check',
      '--json',
      '--contract',
      contractPath,
      '--request',
      requestPath,
    )
    expect(checked.stderr).toBe('')
    expect(checked.code).toBe(0)
    const fromCli = JSON.parse(checked.stdout) as EvidenceBundle
    expect(fromCli.head).toBe(bundle.head)
    expect(fromCli.base).toBe(bundle.base)
    expect(fromCli.commands.map((c) => c.outcome)).toEqual(['pass', 'pass'])
    expect(fromCli.lines?.map((l) => l.status)).toEqual(['met', 'met'])
    expect(existsSync(evidencePath(cliHome, repoKey(repo.dir), bundle.head))).toBe(true)

    const json = await relay(repo.dir, cliHome, 'gate', '--contract', contractPath, '--json')
    expect(json.code).toBe(0)
    expect(JSON.parse(json.stdout)).toMatchObject({
      conclusion: 'human_merge',
      decisive: '리뷰 없음',
      shadow: false,
    })

    const text = await relay(repo.dir, cliHome, 'gate', '--contract', contractPath)
    expect(text.code).toBe(0)
    expect(text.stdout).toContain('결론: 사람 머지 (human_merge)')
    expect(text.stdout).toContain('결정한 사실: 리뷰 없음')

    const summary = await relay(repo.dir, cliHome, 'check')
    expect(summary.code).toBe(0)
    expect(summary.stdout).toContain('명령 unit: 통과')
    expect(summary.stdout).toContain(
      `증거: ${evidencePath(cliHome, repoKey(repo.dir), bundle.head)}`,
    )
  })
})

describe('관문을 사람에게 보내는 diff', () => {
  let repo: TestRepo
  let home: string

  beforeAll(async () => {
    repo = await makeRepo({
      files: {
        'package.json': '{ "name": "calc", "private": true, "type": "module" }\n',
        '.relay/quality.json': QUALITY_TEXT,
        'src/calc.js': calc('hi'),
        'test/calc.test.js': TESTS_BASE,
      },
    })
    await repo.branch('skip')
    await repo.commit('시험 건너뜀', {
      'test/calc.test.js': TESTS_BASE.replace("test('범위 안의", "test.skip('범위 안의"),
    })
    await repo.branch('loosen', 'main')
    const loose = { ...QUALITY, commands: { fast: [{ id: 'nothing', run: 'node --version' }] } }
    await repo.commit('기준 낮춤', { '.relay/quality.json': JSON.stringify(loose) })
    home = await makeTempDir('relay-home-')
  })

  test('시험을 .skip으로 바꾸면 시험 약화 신호와 시험 수 래칫 나빠짐', async () => {
    const b = await check({ repo: repo.dir, base: 'main', head: 'skip', home, now: NOW })
    expect(b.signals).toEqual([
      expect.objectContaining({ kind: 'test_weakening', path: 'test/calc.test.js' }),
    ])
    expect(b.commands.map((c) => c.outcome)).toEqual(['pass', 'pass'])
    expect(byId(b.ratchets, 'tests')).toMatchObject({ status: 'worse', base: 2, head: 1 })
    expect(b.lines).toBeNull()
    const r = gate(b, null, policy(), b.head)
    expect(r.conclusion).toBe('human_merge')
    expect(r.decisive).toContain('건너뛰기')
  })

  test('quality.json을 바꾸면 지킴 파일 신호이고 판정은 base의 기준으로 한다(V9)', async () => {
    const b = await check({ repo: repo.dir, base: 'main', head: 'loosen', home, now: NOW })
    expect(b.quality).toEqual({ hash: qualityHash(QUALITY_TEXT), from: 'base' })
    expect(b.signals).toEqual([
      expect.objectContaining({ kind: 'guard_path', path: '.relay/quality.json' }),
    ])
    // head의 기준('nothing')이 아니라 base의 명령이 돈다
    expect(b.commands.map((c) => c.id)).toEqual(['unit', 'accept'])
    expect(gate(b, null, policy(), b.head).decisive).toContain('지킴 파일')
  })

  test('package.json의 scripts를 바꾸면 명령 정의를 바꾼 것이라 지킴 파일 신호다(V9)', async () => {
    await repo.branch('scripts', 'main')
    const pkg = {
      name: 'calc',
      private: true,
      type: 'module',
      scripts: { lint: 'node -e 0' },
    }
    await repo.commit('lint 무력화', { 'package.json': `${JSON.stringify(pkg)}\n` })
    const b = await check({ repo: repo.dir, base: 'main', head: 'scripts', home, now: NOW })
    expect(b.signals).toEqual([
      {
        kind: 'guard_path',
        path: 'package.json',
        detail: '명령 정의(scripts)가 바뀜: scripts.lint',
      },
    ])
  })
})

describe('흔들리는 명령과 원래 실패하던 명령 (V7)', () => {
  let bundle: EvidenceBundle

  beforeAll(async () => {
    const markers = await makeTempDir('relay-marker-')
    // 표식 파일은 worktree 밖에 둔다. 첫 실행만 실패한다
    const flaky = await nodeCommand(
      `const fs = require('fs')
if (fs.existsSync(process.argv[2])) process.exit(0)
fs.writeFileSync(process.argv[2], 'x')
process.exit(1)`,
      join(markers, 'flaky'),
    )
    const broken = await nodeCommand('process.exit(1)')
    // head에만 BROKEN 파일이 있다
    const regress = await nodeCommand(`process.exit(require('fs').existsSync('BROKEN') ? 1 : 0)`)
    const quality = {
      version: 1,
      commands: {
        fast: [
          { id: 'flaky', run: flaky },
          { id: 'broken', run: broken },
          { id: 'regress', run: regress },
        ],
      },
    }
    const repo = await makeRepo({
      files: { '.relay/quality.json': JSON.stringify(quality), 'src/a.js': 'export const a = 1\n' },
    })
    await repo.branch('work')
    await repo.commit('바꿈', { 'src/a.js': 'export const a = 2\n', BROKEN: 'x\n' })
    const files = await makeTempDir('relay-work-')
    const contractPath = join(files, 'contract.json')
    await writeFile(
      contractPath,
      JSON.stringify({
        version: 1,
        id: 'a2',
        goal: 'a는 2',
        lines: [{ id: 'C1', kind: 'new', text: 'a는 2', examples: ['C1.1'], check: 'test' }],
        examples: [{ id: 'C1.1', input: null, output: 2 }],
        approved_by: 'human',
      }),
    )
    const home = await makeTempDir('relay-home-')
    bundle = await check({
      repo: repo.dir,
      base: 'main',
      head: 'work',
      contractPath,
      home,
      now: NOW,
    })
  })

  test('첫 실행만 실패하면 불안정, 다시 돌지만 base에서는 돌지 않는다', () => {
    const c = byId(bundle.commands, 'flaky')
    expect(c?.outcome).toBe('unstable')
    expect(c?.head.map((r) => r.exit)).toEqual([1, 0])
    expect(c?.base).toBeUndefined()
  })

  test('base에서도 실패하면 원래 실패', () => {
    const c = byId(bundle.commands, 'broken')
    expect(c?.outcome).toBe('pre_existing')
    expect(c?.head.map((r) => r.exit)).toEqual([1, 1])
    expect(c?.base?.exit).toBe(1)
    expect(c?.base?.sha).toBe(bundle.base)
  })

  test('head에서 두 번 실패하고 base에서 통과하면 실패', () => {
    const c = byId(bundle.commands, 'regress')
    expect(c?.outcome).toBe('fail')
    expect(c?.base?.exit).toBe(0)
  })

  test('수용 시험이 없으면 시험 줄은 증거 없음이고 acceptance가 없는 증거다', () => {
    expect(bundle.lines?.map((l) => [l.line, l.status, l.detail])).toEqual([
      ['C1', 'missing_evidence', '수용 시험을 돌리지 못함'],
    ])
    expect(bundle.missing).toEqual(['acceptance'])
    expect(gate(bundle, null, policy(), bundle.head).reasons).toEqual(
      expect.arrayContaining([
        '명령 실패: regress',
        '원래 실패하던 명령: broken',
        '불안정한 명령: flaky',
      ]),
    )
  })
})

describe('품질 기준이 없거나 setup이 실패할 때', () => {
  test('quality.json이 없으면 명령 없이 from none이고 신호는 기본 목록으로 찾는다', async () => {
    const repo = await makeRepo({ files: { '.github/workflows/ci.yml': 'on: push\n' } })
    await repo.branch('work')
    await repo.commit('ci 바꿈', { '.github/workflows/ci.yml': 'on: pull_request\n' })
    const home = await makeTempDir('relay-home-')
    const b = await check({ repo: repo.dir, base: 'main', head: 'work', home, now: NOW })
    expect(b.quality).toEqual({ hash: '', from: 'none' })
    expect(b.commands).toEqual([])
    expect(b.ratchets).toEqual([])
    expect(b.signals.map((s) => s.kind)).toEqual(['guard_path'])
    expect(gate(b, null, policy(), b.head).reasons).toContain('품질 기준 없음')
  })

  test('setup이 실패하면 명령은 돌리지 못함이고 없는 증거에 까닭을 적는다', async () => {
    const quality = {
      version: 1,
      setup: { run: await nodeCommand('process.exit(3)'), inputs: [], keep: [] },
      commands: { fast: [{ id: 'unit', run: 'node --version' }] },
    }
    const repo = await makeRepo({ files: { '.relay/quality.json': JSON.stringify(quality) } })
    const home = await makeTempDir('relay-home-')
    const b = await check({ repo: repo.dir, base: 'main', head: 'main', home, now: NOW })
    expect(b.commands).toEqual([{ id: 'unit', outcome: 'not_run', head: [] }])
    expect(b.missing).toEqual([expect.stringMatching(/^setup\(head\): setup 실패 \(종료 코드 3\)/)])
  })
})

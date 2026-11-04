// [흐름] relay 명령줄: 인자, 종료 코드, init·gate·debt. check의 자세한 흐름은 check.test.ts.
// main()을 바로 부른다. 프로세스로 도는 것은 check.test.ts가 한 번 본다.

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { evidencePath, repoKey } from '../../src/adapters/store.ts'
import { main, USAGE, type Io } from '../../src/cli/app.ts'
import { parseQuality } from '../../src/core/quality.ts'
import { cleanupAll, makeRepo, makeTempDir, nodeCommand, type TestRepo } from '../support/repo.ts'

afterAll(cleanupAll)

const NOW = '2026-11-04T09:00:00.000Z'

type TestIo = Io & { stdout: string[]; stderr: string[] }

function io(cwd: string, home?: string): TestIo {
  const stdout: string[] = []
  const stderr: string[] = []
  return {
    cwd,
    env: home === undefined ? {} : { RELAY_HOME: home },
    out: (t) => stdout.push(t),
    err: (t) => stderr.push(t),
    now: () => new Date(NOW),
    stdout,
    stderr,
  }
}

describe('인자와 종료 코드', () => {
  let repo: TestRepo
  let outside: string

  beforeAll(async () => {
    repo = await makeRepo({ files: { 'a.txt': 'a\n' } })
    outside = await makeTempDir('relay-outside-')
  })

  test('명령이 없으면 쓰는 법을 오류로 찍고 1', async () => {
    const t = io(repo.dir)
    expect(await main([], t)).toBe(1)
    expect(t.stderr).toEqual([USAGE])
  })

  test('--help는 쓰는 법을 찍고 0', async () => {
    for (const argv of [['--help'], ['-h'], ['help'], ['check', '--help']]) {
      const t = io(repo.dir)
      expect(await main(argv, t)).toBe(0)
      expect(t.stdout).toEqual([USAGE])
    }
  })

  test('알 수 없는 명령과 옵션은 사용 오류 1', async () => {
    const a = io(repo.dir)
    expect(await main(['merge'], a)).toBe(1)
    expect(a.stderr[0]).toContain('알 수 없는 명령: merge')
    const b = io(repo.dir)
    expect(await main(['check', '--fast'], b)).toBe(1)
    expect(b.stderr[0]).toMatch(/^relay check: /)
    const c = io(repo.dir)
    expect(await main(['constructor'], c)).toBe(1)
  })

  test('레포 밖에서는 사용 오류 1', async () => {
    for (const argv of [['init'], ['check'], ['gate'], ['debt', 'list']]) {
      const t = io(outside, outside)
      expect(await main(argv, t)).toBe(1)
      expect(t.stderr.join('\n')).toMatch(/git 레포/)
    }
  })

  test('없는 ref, 기준 브랜치를 못 찾음은 사용 오류 1', async () => {
    const home = await makeTempDir('relay-home-')
    const a = io(repo.dir, home)
    expect(await main(['check', '--head', 'no-such-ref'], a)).toBe(1)
    expect(a.stderr[0]).toContain('ref를 찾지 못함: no-such-ref')

    const trunk = await makeRepo({ files: { 'a.txt': 'a\n' }, branch: 'trunk' })
    const b = io(trunk.dir, home)
    expect(await main(['check'], b)).toBe(1)
    expect(b.stderr[0]).toContain('--base로 기준을 주세요')
    const c = io(trunk.dir, home)
    expect(await main(['check', '--base', 'trunk'], c)).toBe(0)
  })
})

describe('relay init', () => {
  test('초안을 찍고, --write는 없을 때만 쓴다', async () => {
    const pkg = { name: 'x', scripts: { lint: 'eslint .', test: 'node --test' } }
    const repo = await makeRepo({
      files: { 'package.json': JSON.stringify(pkg), 'package-lock.json': '{}\n' },
    })
    const shown = io(repo.dir)
    expect(await main(['init'], shown)).toBe(0)
    const draft = parseQuality(shown.stdout.join('\n'))
    expect(draft.ok).toBe(true)
    if (!draft.ok) return
    expect(draft.value.setup?.run).toBe('npm ci')
    expect(draft.value.commands.fast.map((c) => c.id)).toEqual(['lint'])
    expect(draft.value.commands.acceptance?.junit).toBe('.relay-out/junit.xml')

    const wrote = io(repo.dir)
    expect(await main(['init', '--write'], wrote)).toBe(0)
    expect(wrote.stdout).toEqual(['씀: .relay/quality.json'])
    const text = await readFile(repo.path('.relay/quality.json'), 'utf8')
    expect(JSON.parse(text)).toEqual(JSON.parse(shown.stdout.join('\n')))

    await writeFile(repo.path('.relay/quality.json'), '{"사람이":"고침"}\n')
    const again = io(repo.dir)
    expect(await main(['init', '--write'], again)).toBe(1)
    expect(again.stderr[0]).toContain('이미 있음')
    expect(await readFile(repo.path('.relay/quality.json'), 'utf8')).toBe('{"사람이":"고침"}\n')
  })
})

describe('relay gate', () => {
  let repo: TestRepo
  let home: string

  beforeAll(async () => {
    repo = await makeRepo({ files: { 'a.txt': 'a\n' } })
    home = await makeTempDir('relay-home-')
  })

  test('묶음이 없으면 relay check를 먼저 돌리라는 사용 오류', async () => {
    const t = io(repo.dir, home)
    expect(await main(['gate'], t)).toBe(1)
    expect(t.stderr[0]).toContain('relay check를 먼저 돌린다')
  })

  test('check 뒤에는 지금 HEAD의 묶음으로 결론을 낸다', async () => {
    expect(await main(['check'], io(repo.dir, home))).toBe(0)
    const t = io(repo.dir, home)
    expect(await main(['gate', '--json'], t)).toBe(0)
    const r = JSON.parse(t.stdout.join('\n'))
    expect(r.conclusion).toBe('human_merge')
    expect(r.reasons).toEqual(expect.arrayContaining(['계약 없음', '리뷰 없음', '품질 기준 없음']))
  })

  test('모양이 아닌 묶음, 잘못된 계약은 사용 오류', async () => {
    const dir = await makeTempDir('relay-files-')
    const junk = join(dir, 'junk.json')
    await writeFile(junk, '{"version":2}')
    const a = io(repo.dir, home)
    expect(await main(['gate', '--evidence', junk], a)).toBe(1)
    expect(a.stderr[0]).toContain('모양이 아님')

    const bad = join(dir, 'contract.json')
    await writeFile(bad, '{"version":1}')
    const b = io(repo.dir, home)
    expect(await main(['gate', '--contract', bad], b)).toBe(1)
    expect(b.stderr[0]).toContain('계약이 올바르지 않음')
  })

  test('묶음의 품질 기준을 다시 읽지 못하면 알리고 자동 조건 없이 판정한다', async () => {
    const sha = await repo.sha()
    const path = evidencePath(home, repoKey(repo.dir), sha)
    const bundle = JSON.parse(await readFile(path, 'utf8'))
    bundle.quality = { hash: 'ffffffffffffffff', from: 'base' }
    const dir = await makeTempDir('relay-files-')
    const edited = join(dir, 'bundle.json')
    await writeFile(edited, JSON.stringify(bundle))
    const t = io(repo.dir, home)
    expect(await main(['gate', '--evidence', edited, '--auto-merge'], t)).toBe(0)
    expect(t.stderr).toEqual(['주의: 묶음의 품질 기준을 다시 읽지 못함. 자동 조건 없이 판정함'])
    expect(t.stdout[0]).toBe('결론: 사람 머지 (human_merge)')
  })

  test('커밋을 더한 뒤 옛 묶음으로 판정하면 낡은 증거가 맨 앞이다(V6)', async () => {
    const prev = await repo.sha()
    const old = evidencePath(home, repoKey(repo.dir), prev)
    const next = await repo.commit('다음')
    const t = io(repo.dir, home)
    expect(await main(['gate', '--evidence', old, '--json'], t)).toBe(0)
    const r = JSON.parse(t.stdout.join('\n'))
    expect(r.decisive).toBe(
      `낡은 증거: 묶음은 ${prev.slice(0, 7)}, 지금 head는 ${next.slice(0, 7)}`,
    )
    // --head로 묶음의 커밋을 주면 낡지 않았다
    const u = io(repo.dir, home)
    expect(await main(['gate', '--evidence', old, '--head', prev, '--json'], u)).toBe(0)
    expect(JSON.parse(u.stdout.join('\n')).reasons).not.toContainEqual(
      expect.stringMatching(/^낡은 증거/),
    )
  })
})

describe('relay debt', () => {
  let repo: TestRepo

  const item = (path: string) => `---
anchor.path: ${path}
anchor.metric: file-size
kind: accepted_regression
source: PR 1
created: 2026-11-01
---

래칫 file-size: 나빠진 채로 머지됨
`

  beforeAll(async () => {
    repo = await makeRepo({
      files: {
        'src/big.js': 'x\n',
        '.relay/debt/r-file-size-src-big-js.md': item('src/big.js'),
        '.relay/debt/r-file-size-src-gone-js.md': item('src/gone.js'),
        '.relay/debt/broken.md': 'no header\n',
        '.relay/debt/notes.txt': 'md만 읽는다\n',
      },
    })
  })

  test('list는 항목을 찍고 읽지 못한 파일은 오류로 알린다', async () => {
    const t = io(repo.dir)
    expect(await main(['debt', 'list'], t)).toBe(0)
    expect(t.stdout).toEqual([
      'r-file-size-src-big-js · accepted_regression · src/big.js (file-size) · 2026-11-01 · 래칫 file-size: 나빠진 채로 머지됨',
      'r-file-size-src-gone-js · accepted_regression · src/gone.js (file-size) · 2026-11-01 · 래칫 file-size: 나빠진 채로 머지됨',
    ])
    expect(t.stderr).toEqual([expect.stringMatching(/^읽지 못함: \.relay\/debt\/broken\.md: /)])
  })

  test('scan은 anchor가 사라진 항목만 찍는다', async () => {
    const t = io(repo.dir)
    expect(await main(['debt', 'scan', '--json'], t)).toBe(0)
    const out = JSON.parse(t.stdout.join('\n'))
    expect(out.vanished.map((i: { id: string }) => i.id)).toEqual(['r-file-size-src-gone-js'])
  })

  test('장부가 없으면 빚 없음, 하위 명령이 없으면 사용 오류', async () => {
    const empty = await makeRepo({ files: { 'a.txt': 'a\n' } })
    const a = io(empty.dir)
    expect(await main(['debt', 'list'], a)).toBe(0)
    expect(a.stdout).toEqual(['빚 없음'])
    const b = io(empty.dir)
    expect(await main(['debt', 'scan'], b)).toBe(0)
    expect(b.stdout).toEqual(['anchor가 사라진 빚 없음'])
    for (const argv of [['debt'], ['debt', 'fix'], ['debt', 'list', 'extra']]) {
      expect(await main(argv, io(empty.dir))).toBe(1)
    }
  })
})

/** 좀비(끝났지만 거두지 않은 프로세스)도 죽은 것으로 본다 */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
  try {
    return !/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, 'utf8'))
  } catch {
    return true
  }
}

// 레포 명령은 자기 프로세스 묶음(setsid)에서 돌아 터미널의 신호를 받지 않는다. relay가 함께 끝내야 한다
describe.skipIf(process.platform === 'win32')('relay가 신호로 끝날 때', () => {
  const MAIN = resolve(import.meta.dirname, '../../src/cli/main.ts')

  test.each([
    ['SIGHUP', 129],
    ['SIGTERM', 143],
  ] as const)('%s를 받으면 돌던 레포 명령도 끝내고 %i로 끝난다', async (signal, code) => {
    const dir = await makeTempDir('relay-signal-')
    const pidFile = join(dir, 'pid')
    const wait = await nodeCommand(
      `require('fs').writeFileSync(process.argv[2], String(process.pid)); setTimeout(() => {}, 60000)`,
      pidFile,
    )
    const quality = { version: 1, commands: { fast: [{ id: 'wait', run: wait }] } }
    const repo = await makeRepo({ files: { '.relay/quality.json': JSON.stringify(quality) } })
    const home = await makeTempDir('relay-home-')
    const relay = spawn(process.execPath, [MAIN, 'check', '--base', 'main'], {
      cwd: repo.dir,
      env: { ...process.env, RELAY_HOME: home },
      stdio: 'ignore',
    })
    const exited = new Promise<number | null>((done) => relay.on('exit', (c) => done(c)))
    const until = Date.now() + 20_000
    let pid = 0
    while (pid === 0 && Date.now() < until) {
      if (existsSync(pidFile)) pid = Number(await readFile(pidFile, 'utf8')) || 0
      if (pid === 0) await sleep(50)
    }
    expect(pid).toBeGreaterThan(0)
    relay.kill(signal)
    expect(await exited).toBe(code)
    const deadline = Date.now() + 5_000
    while (alive(pid) && Date.now() < deadline) await sleep(50)
    expect(alive(pid)).toBe(false)
  })
})

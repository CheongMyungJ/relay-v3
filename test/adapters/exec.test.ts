import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  GitError,
  OUTPUT_TAIL_BYTES,
  git,
  gitBytes,
  killActive,
  run,
  scrubbedEnv,
} from '../../src/adapters/exec.ts'
import { cleanupAll, makeRepo, makeTempDir, nodeCommand } from '../support/repo.ts'

const isWindows = process.platform === 'win32'
let tmp: string

beforeAll(async () => {
  tmp = await makeTempDir('relay-exec-')
})
afterAll(cleanupAll)

const script = nodeCommand

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

async function waitDead(pid: number, ms = 5_000): Promise<boolean> {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (!alive(pid)) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return !alive(pid)
}

/** 자식을 하나 띄워 pid를 적고, 자기는 keepAlive면 계속 산다 */
const SPAWN_CHILD = `
const { spawn } = require('child_process')
const fs = require('fs')
const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' })
fs.writeFileSync(process.argv[2], JSON.stringify({ parent: process.pid, child: c.pid }))
process.stdout.write('started\\n')
if (process.argv[3] === 'keep') setInterval(() => {}, 1000)
else process.exit(0)
`

describe('run', () => {
  test('종료 코드와 표준 출력·오류를 돌려준다', async () => {
    const cmd = await script(
      `process.stdout.write('나와\\n'); process.stderr.write('오류\\n'); process.exit(3)`,
    )
    const r = await run(cmd, { cwd: tmp, timeoutMs: 30_000 })
    expect(r).toMatchObject({ exit: 3, timed_out: false, stdout: '나와\n', stderr: '오류\n' })
    expect(r.duration_ms).toBeGreaterThanOrEqual(0)
  })

  test('작업 폴더에서 돈다', async () => {
    const sub = join(tmp, 'cwd 폴더')
    await mkdir(sub, { recursive: true })
    const r = await run(await script(`process.stdout.write(process.cwd())`), {
      cwd: sub,
      timeoutMs: 30_000,
    })
    expect(r.stdout).toBe(sub)
  })

  test('셸을 거쳐 종료 코드를 그대로 돌려준다', async () => {
    const r = await run('exit 7', { cwd: tmp, timeoutMs: 30_000 })
    expect(r.exit).toBe(7)
    expect(r.timed_out).toBe(false)
  })

  test('없는 명령이면 0이 아닌 종료 코드를 돌려준다', async () => {
    const r = await run('relay-no-such-command-xyz', { cwd: tmp, timeoutMs: 30_000 })
    expect(r.exit).not.toBe(0)
    expect(r.exit).not.toBeNull()
    expect(r.timed_out).toBe(false)
  })

  test('env를 주면 그 환경 변수만 쓴다', async () => {
    process.env.RELAY_TEST_PARENT = 'parent'
    try {
      const env: Record<string, string> = { RELAY_X: 'y' }
      for (const k of ['PATH', 'Path', 'SystemRoot', 'ComSpec']) {
        const v = process.env[k]
        if (v !== undefined) env[k] = v
      }
      const cmd = await script(
        `process.stdout.write(JSON.stringify([process.env.RELAY_X, process.env.RELAY_TEST_PARENT ?? null]))`,
      )
      const r = await run(cmd, { cwd: tmp, timeoutMs: 30_000, env })
      expect(JSON.parse(r.stdout)).toEqual(['y', null])
    } finally {
      delete process.env.RELAY_TEST_PARENT
    }
  })

  test('env를 주지 않으면 지금 프로세스의 환경을 물려받는다', async () => {
    process.env.RELAY_TEST_PARENT = 'parent'
    try {
      const cmd = await script(`process.stdout.write(process.env.RELAY_TEST_PARENT ?? '')`)
      const r = await run(cmd, { cwd: tmp, timeoutMs: 30_000 })
      expect(r.stdout).toBe('parent')
    } finally {
      delete process.env.RELAY_TEST_PARENT
    }
  })

  test('시간이 넘으면 timed_out이고 손자 프로세스까지 끝낸다', async () => {
    const pids = join(tmp, 'pids-timeout.json')
    const r = await run(await script(SPAWN_CHILD, pids, 'keep'), { cwd: tmp, timeoutMs: 1_500 })
    expect(r.timed_out).toBe(true)
    expect(r.exit).toBeNull()
    expect(r.stdout).toBe('started\n')
    expect(r.duration_ms).toBeGreaterThanOrEqual(1_400)
    expect(r.duration_ms).toBeLessThan(10_000)
    const { parent, child } = JSON.parse(await readFile(pids, 'utf8')) as Record<string, number>
    expect(await waitDead(parent as number)).toBe(true)
    expect(await waitDead(child as number)).toBe(true)
  })

  test.skipIf(isWindows)(
    '맨 앞 프로세스가 끝나면 배경에 남은 자식을 끝내고 기다리지 않는다',
    async () => {
      const pids = join(tmp, 'pids-exit.json')
      const r = await run(await script(SPAWN_CHILD, pids, 'exit'), { cwd: tmp, timeoutMs: 30_000 })
      expect(r.exit).toBe(0)
      expect(r.timed_out).toBe(false)
      expect(r.duration_ms).toBeLessThan(4_000)
      const { child } = JSON.parse(await readFile(pids, 'utf8')) as Record<string, number>
      expect(await waitDead(child as number)).toBe(true)
    },
  )

  test('killActive는 돌고 있는 run을 묶음째 끝낸다', async () => {
    const pids = join(tmp, 'pids-kill.json')
    const pending = run(await script(SPAWN_CHILD, pids, 'keep'), { cwd: tmp, timeoutMs: 60_000 })
    const until = Date.now() + 10_000
    while (!existsSync(pids) && Date.now() < until) await new Promise((r) => setTimeout(r, 50))
    killActive()
    const r = await pending
    expect(r.exit).toBeNull()
    expect(r.timed_out).toBe(false)
    expect(r.duration_ms).toBeLessThan(10_000)
    const { parent, child } = JSON.parse(await readFile(pids, 'utf8')) as Record<string, number>
    expect(await waitDead(parent as number)).toBe(true)
    expect(await waitDead(child as number)).toBe(true)
  })

  test('아주 큰 시간 제한도 바로 끝내지 않는다 (타이머 넘침)', async () => {
    const cmd = await script(`setTimeout(() => process.stdout.write('done'), 300)`)
    for (const timeoutMs of [2 ** 32, Number.POSITIVE_INFINITY]) {
      const r = await run(cmd, { cwd: tmp, timeoutMs })
      expect(r).toMatchObject({ exit: 0, timed_out: false, stdout: 'done' })
    }
  })

  test.each([0, -1, Number.NaN])('시간 제한이 %s이면 돌리지 않고 오류를 돌려준다', async (ms) => {
    const marker = join(tmp, `marker-${String(ms)}`)
    const cmd = await script(`require('fs').writeFileSync(process.argv[2], 'x')`, marker)
    const r = await run(cmd, { cwd: tmp, timeoutMs: ms })
    expect(r.exit).toBeNull()
    expect(r.timed_out).toBe(false)
    expect(r.stderr).toContain('시간 제한이 잘못됨')
    expect(existsSync(marker)).toBe(false)
  })

  test('작업 폴더가 없으면 던지지 않고 오류를 돌려준다', async () => {
    const r = await run('exit 0', { cwd: join(tmp, '없는 폴더'), timeoutMs: 30_000 })
    expect(r).toMatchObject({ exit: null, timed_out: false, stdout: '' })
    expect(r.stderr).toContain('작업 폴더가 없음')
  })

  test('작업 폴더 자리에 파일이 있으면 오류를 돌려준다', async () => {
    const file = join(tmp, 'not-a-dir.txt')
    await writeFile(file, 'x')
    const r = await run('exit 0', { cwd: file, timeoutMs: 30_000 })
    expect(r.exit).toBeNull()
    expect(r.stderr).toContain('작업 폴더가 아님')
  })

  test('출력이 64KB를 넘으면 표준 출력·오류 모두 뒤쪽 64KB만 남긴다', async () => {
    const cmd = await script(`
      for (let i = 0; i < 20; i++) process.stdout.write('a'.repeat(10000))
      process.stdout.write('END')
      process.stderr.write('b'.repeat(100000) + 'ERR')
    `)
    const r = await run(cmd, { cwd: tmp, timeoutMs: 30_000 })
    expect(r.exit).toBe(0)
    expect(OUTPUT_TAIL_BYTES).toBe(64 * 1024)
    expect(r.stdout).toHaveLength(OUTPUT_TAIL_BYTES)
    expect(r.stdout.endsWith('aEND')).toBe(true)
    expect(r.stderr).toHaveLength(OUTPUT_TAIL_BYTES)
    expect(r.stderr.endsWith('bERR')).toBe(true)
  })

  test('64KB와 같은 크기의 출력은 그대로 남긴다', async () => {
    const cmd = await script(`process.stdout.write('c'.repeat(${OUTPUT_TAIL_BYTES - 1}) + 'Z')`)
    const r = await run(cmd, { cwd: tmp, timeoutMs: 30_000 })
    expect(r.stdout).toBe('c'.repeat(OUTPUT_TAIL_BYTES - 1) + 'Z')
  })

  test('여러 바이트 글자의 중간이 잘려도 깨진 글자로 시작하지 않는다', async () => {
    // '한'은 3바이트. 90000바이트의 뒤 65536바이트는 글자 중간에서 시작한다
    const r = await run(await script(`process.stdout.write('한'.repeat(30000))`), {
      cwd: tmp,
      timeoutMs: 30_000,
    })
    expect(r.stdout).not.toContain('�')
    expect(r.stdout).toBe('한'.repeat(Math.floor(OUTPUT_TAIL_BYTES / 3)))
  })
})

describe('run: 던지지 않는다', () => {
  test('명령 글에 NUL이 있으면 돌리지 않고 오류를 돌려준다', async () => {
    const r = await run('echo a\u0000b', { cwd: tmp, timeoutMs: 5_000 })
    expect(r).toMatchObject({ exit: null, timed_out: false, stderr: '명령에 NUL 글자가 있음' })
  })

  test('spawn이 바로 던지는 환경(값의 NUL)도 오류로 돌려준다', async () => {
    const env = { PATH: process.env.PATH ?? '', BAD: 'a\u0000b' }
    const r = await run('echo ok', { cwd: tmp, timeoutMs: 5_000, env })
    expect(r.exit).toBeNull()
    expect(r.stderr).toMatch(/^실행하지 못함: /)
  })
})

describe('레포 명령과 git 위치 변수', () => {
  test('GIT_DIR·GIT_WORK_TREE가 걸린 채 relay를 불러도 명령의 git은 작업 폴더의 레포를 본다', async () => {
    const user = await makeRepo({ files: { 'v.txt': 'A\n' } })
    await user.write({ 'v.txt': 'UNSAVED WORK\n' })
    const work = await makeRepo({ files: { 'v.txt': 'W\n' } })
    const env = scrubbedEnv({
      ...process.env,
      GIT_DIR: user.path('.git'),
      GIT_WORK_TREE: user.dir,
      GIT_INDEX_FILE: user.path('.git/index'),
    })
    const r = await run('git rev-parse --show-toplevel && git checkout -- .', {
      cwd: work.dir,
      timeoutMs: 10_000,
      env,
    })
    expect(r.exit).toBe(0)
    expect(r.stdout.trim().replace(/\\/g, '/')).toBe(work.dir.replace(/\\/g, '/'))
    expect(await user.read('v.txt')).toBe('UNSAVED WORK\n')
  })
})

describe('scrubbedEnv', () => {
  const secrets = {
    GH_TOKEN: 'x',
    GITHUB_TOKEN: 'x',
    ANTHROPIC_API_KEY: 'x',
    CLAUDE_CODE_OAUTH_TOKEN: 'x',
    NPM_TOKEN: 'x',
    RELAY_GH_TOKEN: 'x',
    RELAY_REVIEW_API_TOKEN: 'x',
    RELAY_TOKEN: 'x',
    DB_SECRET: 'x',
    AWS_CLIENT_SECRET: 'x',
    MYSQL_PASSWORD: 'x',
    github_token: 'x',
    Db_Password: 'x',
    AWS_SECRET_ACCESS_KEY: 'x',
    AWS_SESSION_TOKEN: 'x',
    OPENAI_API_KEY: 'x',
    ANTHROPIC_AUTH_TOKEN: 'x',
    GITLAB_TOKEN: 'x',
    NODE_AUTH_TOKEN: 'x',
    GH_ENTERPRISE_TOKEN: 'x',
    GITHUB_PAT: 'x',
    HF_TOKEN: 'x',
    npm_config__authToken: 'x',
    npm_config__auth: 'x',
    SSH_AUTH_SOCK: '/tmp/agent.sock',
    GPG_AGENT_INFO: 'x',
    GOOGLE_APPLICATION_CREDENTIALS: '/k.json',
    DB_PASSWD: 'x',
    GIT_ASKPASS: '/bin/askpass',
    STRIPE_APIKEY: 'x',
    DEPLOY_KEY: 'x',
    SIGNING_KEY: 'x',
    TOKEN_COUNT: 'x',
    SECRET_NAME: 'x',
  }

  test('자격 증명 변수를 대소문자와 상관없이 뺀다', () => {
    const out = scrubbedEnv({ ...secrets, PATH: '/bin' })
    for (const name of Object.keys(secrets)) expect(out).not.toHaveProperty(name)
    expect(out.PATH).toBe('/bin')
  })

  test('자격 증명과 상관없는 흔한 이름은 남긴다', () => {
    const keep = {
      RELAY_HOME: '/h',
      HOME: '/home/u',
      PATH: '/bin',
      PWD: '/w',
      OLDPWD: '/v',
      LANG: 'ko_KR.UTF-8',
      GIT_AUTHOR_NAME: 'a',
      GIT_AUTHOR_EMAIL: 'a@b',
      NODE_OPTIONS: '--max-old-space-size=4096',
      MONKEY: 'x',
      KEYBOARD: 'x',
      XAUTHORITY: '/x',
    }
    expect(scrubbedEnv(keep)).toEqual({ ...keep, CI: '1' })
  })

  test('git 위치 변수(GIT_DIR 등)를 대소문자와 상관없이 뺀다', () => {
    const out = scrubbedEnv({
      GIT_DIR: '/r/.git',
      git_work_tree: '/r',
      GIT_INDEX_FILE: '.git/index',
      GIT_OBJECT_DIRECTORY: 'x',
      GIT_ALTERNATE_OBJECT_DIRECTORIES: 'x',
      GIT_COMMON_DIR: 'x',
      GIT_NAMESPACE: 'x',
      GIT_PREFIX: 'x',
      GIT_EDITOR: 'vi',
    })
    expect(out).toEqual({ GIT_EDITOR: 'vi', CI: '1' })
  })

  test('CI=1을 넣고, 이미 있으면 대소문자와 상관없이 하나로 덮어쓴다', () => {
    expect(scrubbedEnv({}).CI).toBe('1')
    const out = scrubbedEnv({ CI: 'false', ci: 'no' })
    expect(out).toEqual({ CI: '1' })
  })

  test('값이 없는(undefined) 변수는 뺀다', () => {
    expect(scrubbedEnv({ EMPTY: undefined, A: '' })).toEqual({ A: '', CI: '1' })
  })

  test('받은 env를 바꾸지 않는다', () => {
    const base = { GH_TOKEN: 't', A: 'a' }
    scrubbedEnv(base)
    expect(base).toEqual({ GH_TOKEN: 't', A: 'a' })
  })
})

describe('git', () => {
  test('표준 출력을 돌려준다', async () => {
    const repo = await makeRepo()
    expect(await git(['config', 'user.name'], repo.dir)).toBe('relay test\n')
  })

  test('실패하면 stderr를 담은 GitError를 던진다', async () => {
    const repo = await makeRepo({ files: { 'a.txt': 'a' } })
    const e = await git(['cat-file', 'blob', 'HEAD:없는파일'], repo.dir).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(GitError)
    const ge = e as GitError
    expect(ge.exit).not.toBe(0)
    expect(ge.stderr).toContain('없는파일')
    expect(ge.message).toContain('git cat-file blob')
    expect(ge.message).toContain('실패')
    expect(ge.args).toEqual(['cat-file', 'blob', 'HEAD:없는파일'])
  })

  test('메시지는 -c 설정을 빼고 긴 SHA를 줄여 잘려도 까닭이 남게 한다', async () => {
    const repo = await makeRepo({ files: { 'a.txt': 'a' } })
    const sha = '0123456789abcdef0123456789abcdef01234567'
    const args = ['-c', `core.hooksPath=${join(tmp, 'h'.repeat(80))}`, 'checkout', '--detach', sha]
    const e = (await git(args, repo.dir).catch((x: unknown) => x)) as GitError
    expect(e.message).toMatch(/^git checkout --detach 0123456789ab 실패 \(종료 \d+\): /)
    expect(e.message).not.toContain('core.hooksPath')
    expect(e.args).toEqual(args)
  })

  test('작업 폴더가 없으면 GitError를 던진다', async () => {
    await expect(git(['status'], join(tmp, '없는 곳'))).rejects.toBeInstanceOf(GitError)
  })

  test('GIT_DIR 같은 바깥 환경 변수에 흔들리지 않는다', async () => {
    const repo = await makeRepo({ files: { 'a.txt': 'a' } })
    const saved = { dir: process.env.GIT_DIR, tree: process.env.GIT_WORK_TREE }
    process.env.GIT_DIR = join(tmp, 'bogus.git')
    process.env.GIT_WORK_TREE = tmp
    try {
      expect((await git(['ls-files'], repo.dir)).trim()).toBe('a.txt')
    } finally {
      if (saved.dir === undefined) delete process.env.GIT_DIR
      else process.env.GIT_DIR = saved.dir
      if (saved.tree === undefined) delete process.env.GIT_WORK_TREE
      else process.env.GIT_WORK_TREE = saved.tree
    }
  })

  test('큰 출력도 자르지 않고 바이트 그대로 돌려준다', async () => {
    const big = Buffer.alloc(300_000, 0x61)
    big[10] = 0
    const repo = await makeRepo({ files: { 'big.bin': big } })
    const out = await gitBytes(['cat-file', 'blob', 'HEAD:big.bin'], repo.dir)
    expect(out.equals(big)).toBe(true)
  })
})

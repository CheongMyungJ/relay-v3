import { readFile, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  claudeJson,
  claudeJsonArgs,
  claudeVersion,
  findClaude,
  streamOutput,
} from '../../src/adapters/claude.ts'
import { runFile } from '../../src/adapters/pty.ts'
import { FAKE_CLAUDE } from '../support/fakes.ts'
import { cleanupAll, makeTempDir } from '../support/repo.ts'

/** 녹화본에 있는 출력 칸(test/fixtures/recorded-fields.json) */
const RECORDED = JSON.parse(
  readFileSync(new URL('../fixtures/recorded-fields.json', import.meta.url), 'utf8'),
) as { stream: Record<string, string[]> }

let tmp: string
let reviewFile: string

const SCHEMA = {
  type: 'object',
  properties: { findings: { type: 'array' } },
  required: ['findings'],
}

beforeAll(async () => {
  tmp = await makeTempDir('relay-claude-')
  reviewFile = join(tmp, 'review.json')
  await writeFile(
    reviewFile,
    JSON.stringify({ findings: [{ severity: 'high', raise: 'security', text: '비밀이 샌다' }] }),
  )
})
afterAll(cleanupAll)

describe('findClaude', () => {
  const has =
    (...files: string[]) =>
    (f: string) =>
      files.includes(f)

  test('CLAUDE_BIN이 먼저다: 경로면 있어야 하고, 이름이면 그대로', () => {
    const env = { CLAUDE_BIN: '/opt/claude', PATH: '/usr/bin' }
    expect(
      findClaude(env, { platform: 'linux', exists: has('/opt/claude', '/usr/bin/claude') }),
    ).toBe('/opt/claude')
    expect(findClaude(env, { platform: 'linux', exists: has('/usr/bin/claude') })).toBeNull()
    expect(findClaude({ CLAUDE_BIN: 'claude-dev' }, { platform: 'linux', exists: has() })).toBe(
      'claude-dev',
    )
  })

  test('그다음 PATH를 차례로, 마지막으로 ~/.local/bin', () => {
    const env = { PATH: '/a::/b', HOME: '/home/u' }
    const linux = { platform: 'linux' as const }
    expect(
      findClaude(env, { ...linux, exists: has('/b/claude', '/home/u/.local/bin/claude') }),
    ).toBe('/b/claude')
    expect(findClaude(env, { ...linux, exists: has('/home/u/.local/bin/claude') })).toBe(
      '/home/u/.local/bin/claude',
    )
    expect(findClaude(env, { ...linux, exists: has() })).toBeNull()
  })

  test('Windows는 Path의 claude.exe, claude.cmd와 %USERPROFILE%\\.local\\bin\\claude.exe', () => {
    const env = { Path: 'C:\\x;C:\\npm', USERPROFILE: 'C:\\Users\\u' }
    const win = { platform: 'win32' as const }
    expect(findClaude(env, { ...win, exists: has('C:\\npm\\claude.cmd') })).toBe(
      'C:\\npm\\claude.cmd',
    )
    expect(findClaude(env, { ...win, exists: has('C:\\Users\\u\\.local\\bin\\claude.exe') })).toBe(
      'C:\\Users\\u\\.local\\bin\\claude.exe',
    )
  })

  test('실제 파일로: 가짜 claude를 CLAUDE_BIN으로 찾는다', () => {
    expect(findClaude({ CLAUDE_BIN: FAKE_CLAUDE })).toBe(FAKE_CLAUDE)
    expect(findClaude({ CLAUDE_BIN: join(tmp, 'none', 'claude') })).toBeNull()
  })
})

describe('claudeVersion', () => {
  test('--version의 첫 줄', async () => {
    expect(await claudeVersion(FAKE_CLAUDE)).toBe('0.0.0 (가짜 Claude Code)')
    expect(await claudeVersion(FAKE_CLAUDE, { FAKE_CLAUDE_VERSION: '2.1.318 (Claude Code)' })).toBe(
      '2.1.318 (Claude Code)',
    )
  })

  test('돌리지 못하면 던진다', async () => {
    await expect(claudeVersion(join(tmp, 'no-claude'))).rejects.toThrow(/claude --version 실패/)
  })
})

describe('claudeJsonArgs', () => {
  test('-p, stream-json 출력(--verbose), 스키마, 도구 제한, 권한 모드 default, 세션 안 남김', () => {
    const args = claudeJsonArgs({
      schema: SCHEMA,
      allowedTools: ['Read', 'Grep', 'Glob', 'Bash(git diff:*)'],
      model: 'opus',
    })
    expect(args[0]).toBe('-p')
    const val = (name: string) => args[args.indexOf(name) + 1]
    expect(val('--output-format')).toBe('stream-json')
    expect(args).toContain('--verbose')
    expect(JSON.parse(val('--json-schema') ?? '')).toEqual(SCHEMA)
    expect(val('--tools')).toBe('Read,Grep,Glob,Bash')
    expect(val('--allowedTools')).toBe('Read,Grep,Glob,Bash(git diff:*)')
    expect(val('--permission-mode')).toBe('default')
    expect(val('--model')).toBe('opus')
    expect(args).toContain('--no-session-persistence')
    // 레포의 프로젝트·로컬 설정(세션이 써 둔 훅)을 읽지 않는다
    expect(val('--setting-sources')).toBe('user')
  })

  test('도구가 없으면 --tools ""이고 --allowedTools와 --model은 없다', () => {
    const args = claudeJsonArgs({ schema: SCHEMA, allowedTools: [] })
    expect(args[args.indexOf('--tools') + 1]).toBe('')
    expect(args).not.toContain('--allowedTools')
    expect(args).not.toContain('--model')
  })
})

describe('claudeJson (가짜 claude -p)', () => {
  const call = (env: Record<string, string>, timeoutMs = 30_000) =>
    claudeJson({
      bin: FAKE_CLAUDE,
      cwd: tmp,
      prompt: 'Review this diff.\n'.repeat(5_000),
      schema: SCHEMA,
      allowedTools: ['Read', 'Grep', 'Glob'],
      timeoutMs,
      env: { FAKE_CLAUDE_REVIEW: reviewFile, ...env },
    })

  test('structured_output, usage, 리뷰어의 모델을 돌려주고 프롬프트는 표준 입력으로 간다', async () => {
    const log = join(tmp, 'ok.jsonl')
    const r = await call({ FAKE_CLAUDE_LOG: log, FAKE_CLAUDE_MODEL: 'fake-model-a' })
    expect(r).toEqual({
      ok: true,
      value: { findings: [{ severity: 'high', raise: 'security', text: '비밀이 샌다' }] },
      usage: expect.objectContaining({ input_tokens: 1000, output_tokens: 50 }),
      model: 'fake-model-a',
    })
    const entry = JSON.parse((await readFile(log, 'utf8')).trim()) as Record<string, unknown>
    expect(entry).toMatchObject({ type: 'review', cwd: tmp })
    expect(entry.prompt).toBe('Review this diff.\n'.repeat(5_000))
    expect(entry.args).toEqual(
      claudeJsonArgs({ schema: SCHEMA, allowedTools: ['Read', 'Grep', 'Glob'] }),
    )
  })

  test('assistant 이벤트가 없으면 모델 없이 돌려준다(M4a: 판 칸은 모름)', async () => {
    const r = await call({ FAKE_CLAUDE_MODEL: '' })
    expect(r.ok).toBe(true)
    expect(r).not.toHaveProperty('model')
  })

  test('가짜의 출력 칸은 relay-v2 녹화본에 있는 것뿐이다 (recorded-fields.json)', async () => {
    const out = await runFile(
      FAKE_CLAUDE,
      [...claudeJsonArgs({ schema: SCHEMA, allowedTools: [] })],
      {
        cwd: tmp,
        timeoutMs: 30_000,
        input: 'x',
        env: { FAKE_CLAUDE_REVIEW: reviewFile },
      },
    )
    const recorded = RECORDED.stream
    const events = out.stdout
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l) as Record<string, unknown>)
    expect(events.map((e) => e['type'])).toEqual(['assistant', 'result'])
    for (const e of events) {
      const part = String(e['type'])
      expect(Object.keys(e).filter((k) => !(recorded[part] ?? []).includes(k))).toEqual([])
      const message = e['message'] as Record<string, unknown> | undefined
      if (message)
        expect(
          Object.keys(message).filter((k) => !(recorded[`${part}.message`] ?? []).includes(k)),
        ).toEqual([])
    }
  })

  test('실패는 던지지 않고 까닭과 함께 돌려준다', async () => {
    expect(await call({ FAKE_CLAUDE_REVIEW_FAIL: 'exit' })).toEqual({
      ok: false,
      error: expect.stringMatching(/종료 1.*가짜 리뷰 실패/s),
    })
    expect(await call({ FAKE_CLAUDE_REVIEW_FAIL: 'error' })).toEqual({
      ok: false,
      error: expect.stringContaining('가짜 오류'),
    })
    expect(await call({ FAKE_CLAUDE_REVIEW_FAIL: 'garbage' })).toEqual({
      ok: false,
      error: expect.stringContaining('출력을 읽지 못함'),
    })
    expect(await call({ FAKE_CLAUDE_REVIEW_FAIL: 'empty' })).toEqual({
      ok: false,
      error: '구조화된 출력 없음',
    })
    const missing = await claudeJson({
      bin: join(tmp, 'no-claude'),
      cwd: tmp,
      prompt: 'x',
      schema: SCHEMA,
      allowedTools: [],
      timeoutMs: 5_000,
    })
    expect(missing).toEqual({ ok: false, error: expect.stringContaining('실행하지 못함') })
  })

  test('시간이 넘으면 끝내고 시간 초과로 돌려준다', async () => {
    const started = Date.now()
    expect(await call({ FAKE_CLAUDE_REVIEW_FAIL: 'hang' }, 1_000)).toEqual({
      ok: false,
      error: 'claude -p 시간 초과 (1000ms)',
    })
    expect(Date.now() - started).toBeLessThan(10_000)
  })
})

describe('streamOutput', () => {
  test('마지막 result 이벤트와 assistant의 마지막 message.model. JSON이 아닌 줄과 다른 이벤트는 건너뛴다', () => {
    const lines = [
      JSON.stringify({ type: 'system', subtype: 'init' }),
      'not json',
      JSON.stringify({ type: 'assistant', message: { model: 'm1', content: [] } }),
      JSON.stringify({ type: 'user', message: { content: [] } }),
      JSON.stringify({ type: 'assistant', message: { model: 'm2', content: [] } }),
      JSON.stringify({ type: 'assistant', message: { content: [] } }),
      JSON.stringify({ type: 'result', is_error: false, structured_output: { findings: [] } }),
    ]
    expect(streamOutput(lines.join('\r\n'))).toEqual({
      result: { type: 'result', is_error: false, structured_output: { findings: [] } },
      model: 'm2',
    })
    expect(streamOutput('')).toEqual({ result: null })
  })
})

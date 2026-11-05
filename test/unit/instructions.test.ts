// [단위] 세션에 주는 글과 파일: 실행 인자 순서, 훅 설정과 MCP 설정 모양, 지침이 담는 사실
import { describe, expect, test } from 'vitest'
import {
  sessionEnv,
  firstPrompt,
  HOOK_EVENTS,
  instructionsText,
  launchArgs,
  MCP_SERVER,
  mcpConfig,
  sessionSettings,
  TOOL_CHANGE,
  TOOL_CHECK,
  TOOL_SUBMIT,
} from '../../src/core/instructions.ts'

const paths = {
  settingsPath: '/h/works/w1/settings.json',
  instructionsPath: '/h/works/w1/instructions.md',
  mcpConfigPath: '/h/works/w1/mcp.json',
}

describe('launchArgs', () => {
  test('새 세션: 권한 확인 끔, --session-id, --mcp-config는 --settings 앞, 첫 프롬프트는 맨 뒤', () => {
    expect(
      launchArgs({ ...paths, sessionId: 'S1', resume: false, prompt: 'go', model: 'opus' }),
    ).toEqual([
      '--dangerously-skip-permissions',
      '--session-id',
      'S1',
      '--mcp-config',
      '/h/works/w1/mcp.json',
      '--settings',
      '/h/works/w1/settings.json',
      '--append-system-prompt-file',
      '/h/works/w1/instructions.md',
      '--model',
      'opus',
      'go',
    ])
  })

  test('재개는 --resume에 같은 설정·지침·MCP를 다시 주고, 프롬프트가 없으면 넣지 않는다', () => {
    const args = launchArgs({
      ...paths,
      sessionId: 'S1',
      resume: true,
      prompt: null,
      effort: 'high',
    })
    expect(args.slice(0, 3)).toEqual(['--dangerously-skip-permissions', '--resume', 'S1'])
    expect(args).not.toContain('--session-id')
    expect(args).toContain('--append-system-prompt-file')
    expect(args.slice(-2)).toEqual(['--effort', 'high'])
    expect(args.indexOf('--mcp-config')).toBeLessThan(args.indexOf('--settings'))
  })
})

describe('sessionSettings', () => {
  test('이벤트마다 http 훅 하나, 토큰은 환경 변수 이름으로, 훅을 끄지 못하게, 자동 메모리 끔', () => {
    const s = sessionSettings({ port: 4321, workId: 'w1' })
    expect(Object.keys(s.hooks)).toEqual([...HOOK_EVENTS])
    expect(HOOK_EVENTS).toEqual([
      'UserPromptSubmit',
      'Stop',
      'SessionEnd',
      'PreToolUse',
      'PostToolUse',
      'PostToolUseFailure',
    ])
    expect(s.hooks.PreToolUse).toEqual([
      {
        hooks: [
          {
            type: 'http',
            url: 'http://127.0.0.1:4321/hook/w1/PreToolUse',
            headers: { Authorization: 'Bearer $RELAY_HOOK_TOKEN' },
            allowedEnvVars: ['RELAY_HOOK_TOKEN'],
            timeout: 30,
          },
        ],
      },
    ])
    expect(s.hooks.Stop[0]?.hooks[0]?.url).toBe('http://127.0.0.1:4321/hook/w1/Stop')
    expect(s.autoMemoryEnabled).toBe(false)
    // 레포 설정의 disableAllHooks: true를 --settings가 덮는다
    expect(s.disableAllHooks).toBe(false)
    expect(JSON.parse(JSON.stringify(s))).toEqual(s)
  })
})

describe('mcpConfig', () => {
  test('relay_work stdio 서버 하나', () => {
    const env = { ELECTRON_RUN_AS_NODE: '1', RELAY_WORK_ID: 'w1' }
    expect(
      mcpConfig({ command: '/app/relay', args: ['/app/out/main/mcp-bridge.js'], env }),
    ).toEqual({
      mcpServers: {
        relay_work: {
          type: 'stdio',
          command: '/app/relay',
          args: ['/app/out/main/mcp-bridge.js'],
          env,
        },
      },
    })
    expect(MCP_SERVER).toBe('relay_work')
  })
})

describe('instructionsText', () => {
  const base = {
    workId: 'w1',
    contractId: 'k7',
    examplesDir: '.relay/examples',
    baseBranch: 'develop',
    workBranch: 'relay/median-a1b2',
  }

  test('계약, 도구, 예시 자료 위치, 태그, 브랜치, 막는 동작을 담는다', () => {
    const t = instructionsText({ ...base, questionMode: 'confirm_each' })
    for (const s of [
      TOOL_SUBMIT,
      TOOL_CHANGE,
      TOOL_CHECK,
      MCP_SERVER,
      '`id`: `k7`',
      '.relay/examples/k7.json',
      '[k7:C1.1]',
      'relay/median-a1b2',
      '`develop`, `main` or `master`',
      'force pushes',
      'gh pr merge',
      'AskUserQuestion',
    ])
      expect(t, s).toContain(s)
    for (const kind of ['change', 'new', 'keep', 'remove', 'observe', 'human'])
      expect(t).toContain(`\`${kind}\``)
    for (const g of ['code', 'request', 'knowledge', 'guess']) expect(t).toContain(`type: "${g}"`)
  })

  test('질문 방식: 결정마다 확인은 입출력 예시와 오류 동작을 따로, 초안 우선은 초안을 먼저', () => {
    const each = instructionsText({ ...base, questionMode: 'confirm_each' })
    expect(each).toContain('one decision per question')
    expect(each).toContain('what happens on bad input or errors')
    expect(each).not.toContain('Draft the contract first')
    const draft = instructionsText({ ...base, questionMode: 'draft_first' })
    expect(draft).toContain('Draft the contract first')
    expect(draft).not.toContain('one decision per question')
  })

  test('리뷰·시험을 하라는 지시가 없고 영어다', () => {
    const t = instructionsText({ ...base, questionMode: 'draft_first' })
    expect(t).not.toMatch(/\b(write|add|run) (the )?tests?\b/i)
    expect(t).not.toMatch(/\breview (your|the) (code|change)/i)
    expect(t).not.toMatch(/[가-힣]/)
  })

  test('기준 브랜치가 main이면 막는 브랜치를 겹쳐 쓰지 않는다', () => {
    const t = instructionsText({ ...base, baseBranch: 'main', questionMode: 'draft_first' })
    expect(t).toContain('pushing to `main` or `master`;')
  })

  test('예시 자료(V27): 앱이 초안과 승인본을 쓰고, 세션은 바꾸지 않고 시험과 함께 커밋한다', () => {
    const t = instructionsText({ ...base, questionMode: 'confirm_each' })
    expect(t).toContain("relay writes the contract's examples to `.relay/examples/k7.json`")
    expect(t).toContain(`a draft when \`${TOOL_SUBMIT}\` accepts the contract`)
    expect(t).toContain(
      'the approved version when the human approves it or approves a contract change',
    )
    expect(t).toContain('Do not edit this file. Commit it with your tests')
    expect(t).toContain('missing or differs from the approved one sends the change to the human')
    // 앞 판의 '세션이 손으로 옮긴다'는 말이 남지 않는다
    expect(t).not.toContain('Commit the approved examples to')
    expect(t).not.toContain("the contract's `examples` array")
  })

  test('JSON에 없는 값은 계약에 문자열로 쓰고 note에 적는다(V27)', () => {
    const t = instructionsText({ ...base, questionMode: 'draft_first' })
    expect(t).toContain('JSON has no NaN, Infinity or undefined: write such a value as a string')
  })

  test('예시 폴더 끝의 / 는 하나로', () => {
    expect(
      instructionsText({ ...base, examplesDir: 'ex/', questionMode: 'draft_first' }),
    ).toContain('`ex/k7.json`')
  })
})

test('firstPrompt는 요청 파일 경로를 담는다', () => {
  expect(firstPrompt('/h/works/w1/request.md')).toContain('/h/works/w1/request.md')
})

describe('sessionEnv', () => {
  test('훅 토큰, Work id, 하루짜리 MCP 도구 제한 시간을 준다', () => {
    expect(sessionEnv({ hookToken: 't', workId: 'w' })).toEqual({
      RELAY_HOOK_TOKEN: 't',
      RELAY_WORK_ID: 'w',
      MCP_TOOL_TIMEOUT: String(24 * 60 * 60 * 1000),
    })
  })
})

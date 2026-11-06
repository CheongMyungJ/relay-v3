// [단위] 세션 기록(M4a, src/main/works-session-log.ts): 훅 본문의 effort.level(relay-v2 녹화본의 PreToolUse·PostToolUse·
// PostToolUseFailure·Stop 본문)의 마지막 값을 Work마다 둔다.
import { describe, expect, test } from 'vitest'
import { effortOf, SessionLog } from '../../src/main/works-session-log.ts'

describe('세션 기록 (M4a effort)', () => {
  test('effortOf: effort.level 글만, 앞뒤 빈칸은 뗀다', () => {
    expect(effortOf({ effort: { level: 'medium' } })).toBe('medium')
    expect(effortOf({ effort: { level: ' high ' } })).toBe('high')
    expect(effortOf({ effort: { level: '' } })).toBeNull()
    expect(effortOf({ effort: { level: 3 } })).toBeNull()
    expect(effortOf({ effort: 'medium' })).toBeNull()
    expect(effortOf({ effort: null })).toBeNull()
    expect(effortOf({})).toBeNull()
  })

  test('Work마다 마지막 값. effort가 없는 본문은 앞의 값을 그대로 둔다', () => {
    const log = new SessionLog()
    expect(log.effort('w1')).toBeUndefined()
    log.noteHook('w1', 'PreToolUse', { effort: { level: 'medium' } })
    log.noteHook('w2', 'Stop', { effort: { level: 'low' } })
    log.noteHook('w1', 'PostToolUse', { effort: { level: 'high' } })
    log.noteHook('w1', 'UserPromptSubmit', { prompt: 'x' })
    log.noteHook('w1', 'SessionEnd', { reason: 'other' })
    expect(log.effort('w1')).toBe('high')
    expect(log.effort('w2')).toBe('low')
  })
})

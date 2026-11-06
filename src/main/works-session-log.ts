// 세션 기록 (M4, docs/m4-design.md 3.1·7절). 훅 서버(hooks.ts)가 본문을 Works에 넘기기 전에 noteHook을 부른다. M4a는
// 세션 훅 본문의 effort.level(relay-v2 녹화본의 PreToolUse·PostToolUse·PostToolUseFailure·Stop 본문에 있음)의 마지막 값을
// Work마다 메모리에 둔다: 내보내기 결론 줄의 effort 칸과 지금 판(판 열쇠)이 읽는다. 앱을 다시 켜면 다음 훅까지 모른다(엄격:
// 모르는 판은 어떤 판과도 같지 않다). M4e의 세션 커밋 집합도 이 파일에 둔다.

import type { HookEvent } from '../core/instructions.ts'

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** 훅 본문의 effort.level. 없거나 글이 아니면 null */
export function effortOf(body: Record<string, unknown>): string | null {
  const level = isObject(body['effort']) ? body['effort']['level'] : undefined
  return typeof level === 'string' && level.trim() !== '' ? level.trim() : null
}

export class SessionLog {
  private readonly efforts = new Map<string, string>()

  /** 훅 하나를 본다. effort가 없는 본문(UserPromptSubmit, SessionEnd 등)은 마지막 값을 그대로 둔다 */
  noteHook(workId: string, _event: HookEvent, body: Record<string, unknown>): void {
    const effort = effortOf(body)
    if (effort !== null) this.efforts.set(workId, effort)
  }

  /** 이 Work의 세션이 마지막으로 알린 effort. 이 앱이 켜진 뒤 훅이 없었으면 없다 */
  effort(workId: string): string | undefined {
    return this.efforts.get(workId)
  }
}

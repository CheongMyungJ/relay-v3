// 단축키 (V78). macOS는 ⌘, 다른 OS는 터미널의 Ctrl 조합(세션이 쓰는 Ctrl+N 등)과 겹치지 않게 Alt·Ctrl+Shift를 쓴다.
// DOM을 쓰지 않는 순수 함수만 둔다(시험: test/unit/renderer-keys.test.ts).

export interface KeyLike {
  key: string
  code?: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

export const isMac = (platform: string): boolean => /mac/i.test(platform)

const platform = (): string => (typeof navigator === 'undefined' ? '' : navigator.platform)

/** 탭 단축키: ⌘1~4(macOS), Alt+1~4(그 밖). 탭의 차례(0부터)를 돌려주고, 아니면 null */
export function tabKey(e: KeyLike, mac = isMac(platform())): number | null {
  const mod = mac ? e.metaKey && !e.ctrlKey && !e.altKey : e.altKey && !e.ctrlKey && !e.metaKey
  if (!mod || e.shiftKey) return null
  // Alt는 글자를 바꿀 수 있으므로(¡ 등) 자리(code)를 먼저 본다
  const m = /^Digit([1-4])$/.exec(e.code ?? '') ?? /^([1-4])$/.exec(e.key)
  return m ? Number(m[1]) - 1 : null
}

/** 새 Work 단축키: ⌘N(macOS), Ctrl+Shift+N(그 밖) */
export function newWorkKey(e: KeyLike, mac = isMac(platform())): boolean {
  const mod = mac ? e.metaKey && !e.ctrlKey && !e.shiftKey : e.ctrlKey && e.shiftKey && !e.metaKey
  return mod && !e.altKey && e.key.toLowerCase() === 'n'
}

/** 단추의 풍선 글에 붙일 단축키 이름 */
export function newWorkKeyText(mac = isMac(platform())): string {
  return mac ? '⌘N' : 'Ctrl+Shift+N'
}

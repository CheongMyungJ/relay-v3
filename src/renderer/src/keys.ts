// 단축키 (V78). macOS는 ⌘, 다른 OS는 터미널의 Ctrl 조합(세션이 쓰는 Ctrl+N 등)과 겹치지 않게 Alt·Ctrl+Shift를 쓴다.
// DOM을 쓰지 않는 순수 함수만 둔다(시험: test/unit/renderer-summary.test.ts). 대화상자가 떠 있는가는 ui.tsx의 modalOpen이 본다.

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
  return mod && !e.altKey && letterOf(e) === 'n'
}

/**
 * 누른 글쇠의 라틴 글자. 한글·키릴 자판이나 IME가 켜진 상태에서는 key가 다른 글자('ㅜ', 'Т', 'Process')로 오므로 그때는
 * 자리(code)로 읽는다. key가 라틴 글자면 그것을 믿는다(Dvorak 등 자리가 다른 라틴 자판)
 */
function letterOf(e: KeyLike): string {
  const k = e.key.toLowerCase()
  if (/^[a-z]$/.test(k)) return k
  const m = /^Key([A-Z])$/.exec(e.code ?? '')
  return m?.[1] ? m[1].toLowerCase() : k
}

/** 단추의 풍선 글에 붙일 단축키 이름 */
export function newWorkKeyText(mac = isMac(platform())): string {
  return mac ? '⌘N' : 'Ctrl+Shift+N'
}

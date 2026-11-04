// Work마다 xterm 하나를 React 수명주기 밖에서 들고 있는다(v2 app/src/renderer/src/terminals.ts의 뜻).
// React가 컴포넌트를 다시 붙여도(StrictMode, Work 바꾸기) 화면과 구독이 끊기지 않는다.
// 출력 이벤트는 모든 Work의 것이 오므로 하나만 구독해 id로 나눈다. attach보다 먼저 구독한다(termSize.ts의 chunkOrder).

import { FitAddon } from '@xterm/addon-fit'
import { Terminal, type ITheme } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { EVENTS } from '../../shared/api.ts'
import { exitText } from './format.ts'
import { chunkOrder, sizeSender, type ChunkOrder } from './termSize.ts'

interface TermEntry {
  term: Terminal
  fit: FitAddon
  order: ChunkOrder
  sendSize: (s: { cols: number; rows: number }) => void
}

const entries = new Map<string, TermEntry>()
let listening = false

function listen(): void {
  if (listening) return
  listening = true
  window.relay.on(EVENTS.terminalData, (c) => entries.get(c.id)?.order.chunk(c))
  // 세션이 끝나면 한 줄 알린다(지난 출력에는 남지 않는 화면 표시)
  window.relay.on(EVENTS.terminalExit, ({ id, code }) =>
    entries.get(id)?.term.write(`\r\n\x1b[2m${exitText(code)}\x1b[0m\r\n`),
  )
  // 테마가 바뀌면 터미널 색도 바꾼다
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    for (const e of entries.values()) e.term.options.theme = terminalTheme()
  })
}

/** styles.css의 --term-* 색. 둘레의 .terminal-host와 같은 바탕이어야 테두리 띠가 보이지 않는다 */
function terminalTheme(): ITheme {
  const css = getComputedStyle(document.documentElement)
  const token = (name: string) => css.getPropertyValue(name).trim()
  const foreground = token('--term-fg')
  return {
    background: token('--term-bg'),
    foreground,
    cursor: foreground,
    selectionBackground: token('--term-selection'),
  }
}

/** Work의 xterm. 없으면 만들고 지난 출력을 붙인다 */
function ensure(id: string): TermEntry {
  const existing = entries.get(id)
  if (existing) return existing
  listen()
  const api = window.relay.terminal
  const term = new Terminal({
    fontFamily:
      "ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, 'D2Coding', 'DejaVu Sans Mono', monospace",
    fontSize: 13,
    lineHeight: 1.15,
    scrollback: 10_000,
    cursorBlink: true,
    theme: terminalTheme(),
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  // 일반 터미널처럼 Ctrl+V는 붙여넣기, 선택이 있을 때 Ctrl+C는 복사(false면 브라우저 기본 동작)
  term.attachCustomKeyEventHandler((ev) => {
    if (ev.type !== 'keydown' || !ev.ctrlKey || ev.altKey || ev.metaKey) return true
    const k = ev.key.toLowerCase()
    if (k === 'v' && !ev.shiftKey) return false
    if (k === 'c' && term.hasSelection()) {
      setTimeout(() => term.clearSelection(), 0)
      return false
    }
    return true
  })
  const order = chunkOrder((data, cb) => term.write(data, cb))
  const sendSize = sizeSender(({ cols, rows }) => api.resize(id, cols, rows))
  term.onData((d) => {
    if (!order.replaying) api.write(id, d)
  })
  term.onResize(({ cols, rows }) => sendSize({ cols, rows }))
  const entry: TermEntry = { term, fit, order, sendSize }
  entries.set(id, entry)
  api.attach(id).then(
    (b) => order.backlog(b),
    (e: unknown) => {
      term.write(`\r\n[터미널을 붙이지 못함: ${e instanceof Error ? e.message : String(e)}]\r\n`)
      order.backlog({ data: '', seq: 0 })
    },
  )
  return entry
}

/** 화면에 보여 크기를 잴 수 있다. 숨은 요소는 크기가 0이다 */
function measurable(el: HTMLElement | null | undefined): el is HTMLElement {
  return !!el && el.clientWidth > 0 && el.clientHeight > 0
}

/** 보일 때만 화면에 맞추고, 그 크기를 PTY에 보낸다(처음이거나 바뀌었을 때만) */
function fitIfVisible(entry: TermEntry, el: HTMLElement): void {
  if (!measurable(el) || !entry.fit.proposeDimensions()) return
  entry.fit.fit()
  entry.sendSize({ cols: entry.term.cols, rows: entry.term.rows })
}

/** host에 Work의 터미널을 붙인다. 창 크기를 따라 맞춘다. 돌려준 함수로 뗀다(xterm은 남는다) */
export function mountTerminal(id: string, host: HTMLElement): () => void {
  const entry = ensure(id)
  const { term } = entry
  if (!term.element) term.open(host)
  else if (term.element.parentElement !== host) {
    // 떼어 둔 동안 쓴 출력을 다시 그린다
    host.appendChild(term.element)
    term.refresh(0, term.rows - 1)
  }
  const ro = new ResizeObserver(() => fitIfVisible(entry, host))
  ro.observe(host)
  fitIfVisible(entry, host)
  term.focus()
  return () => ro.disconnect()
}

/** 세션이 멈췄으면 입력을 받지 않는다 */
export function setTerminalLive(id: string, live: boolean): void {
  const entry = entries.get(id)
  if (entry) entry.term.options.disableStdin = !live
}

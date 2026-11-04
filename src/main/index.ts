// Electron 메인 (docs/m2-modules.md 3절 index.ts): 창 하나, IPC, 훅·control 서버, Works 조립, 앱이 끝날 때 세션 정리.
// 'electron'을 가져오는 곳은 이 파일과 ipc.ts뿐이다. 조율은 Electron을 모르는 Works가 한다.
// MCP 브리지는 이 앱의 실행 파일을 Node로 돌린다(ELECTRON_RUN_AS_NODE=1 <앱> out/main/mcp-bridge.js).

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { claudeVersion, findClaude } from '../adapters/claude.ts'
import * as gh from '../adapters/gh.ts'
import { relayHome } from '../adapters/store.ts'
import { check } from '../engine/check.ts'
import { HookServer } from './hooks.ts'
import { registerIpc } from './ipc.ts'
import { SessionHost } from './sessions.ts'
import { Store } from './store.ts'
import { claudeReview, Works } from './works.ts'

let win: BrowserWindow | null = null
let works: Works | null = null
let hooks: HookServer | null = null
let quitting = false

const log = (text: string, error?: unknown) => console.error(`[relay] ${text}`, error ?? '')

const HOME = relayHome(process.env)
// 창의 저장소와 하나만 띄우기 잠금을 $RELAY_HOME 아래에 둔다: 홈이 다른 앱(시험의 임시 홈)은 따로 뜬다
app.setPath('userData', join(HOME, 'electron'))

function createWindow(): void {
  win = new BrowserWindow({
    width: 1400,
    height: 880,
    // 사이드바(252)와 패널(340) 사이에서 터미널이 70열쯤 남는 너비. 질문(AskUserQuestion)은 터미널에서 답한다
    minWidth: 1180,
    minHeight: 560,
    title: 'relay',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  // 창 안에서 다른 곳으로 가지 않는다. 바깥 주소(PR 링크 등)는 기본 브라우저로 연다
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!devUrl || !url.startsWith(devUrl)) e.preventDefault()
  })
  win.on('closed', () => {
    win = null
  })
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
}

async function start(): Promise<void> {
  const store = new Store({
    home: HOME,
    now: () => new Date().toISOString(),
    newId: () => randomUUID(),
  })
  const sessions = new SessionHost()
  hooks = new HookServer({
    controlTokenFor: (id) => works?.controlToken(id) ?? null,
    tokenFor: (id) => works?.hookToken(id) ?? null,
    protectedBranches: (id) => works?.protectedBranches(id) ?? [],
    onHook: async (id, event, body) => (works ? works.onHook(id, event, body) : null),
    onControl: async (id, tool, args, signal) =>
      works
        ? works.onControl(id, tool, args, signal)
        : { status: 'error', error: 'relay is starting. Call again.' },
    log,
  })
  const port = await hooks.listen()
  const claudeBin = findClaude(process.env) ?? 'claude'
  const version = await claudeVersion(claudeBin).catch((e: unknown) => {
    log('claude --version 실패', e)
    return undefined
  })
  const debounceMs = Number(process.env['RELAY_DEBOUNCE_MS'] ?? '')
  const w = new Works({
    store,
    sessions,
    hooksPort: port,
    controlUrl: `http://127.0.0.1:${port}/control`,
    bridgeCommand: {
      command: process.execPath,
      args: [join(import.meta.dirname, 'mcp-bridge.js')],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    },
    claudeBin,
    check,
    // RELAY_ABLATE=review: 평가에서 리뷰를 뺀 쪽(docs/experiments/m2/protocol.md). 제품 설정이 아니다
    review: (process.env['RELAY_ABLATE'] ?? '').split(',').includes('review')
      ? async () => ({ status: 'skipped' as const, findings: [] })
      : claudeReview({ bin: claudeBin, log }),
    gh,
    now: () => new Date().toISOString(),
    newId: () => randomUUID(),
    emit: (event, payload) => {
      for (const bw of BrowserWindow.getAllWindows())
        if (!bw.isDestroyed()) bw.webContents.send(event, payload)
    },
    relayVersion: app.getVersion(),
    // 스모크 시험이 Stop 뒤 20초를 기다리지 않게 줄일 수 있다
    ...(debounceMs > 0 ? { debounceMs } : {}),
    ...(version ? { claudeVersion: version } : {}),
    log,
  })
  await w.init()
  works = w
  registerIpc({ works: w, sessions, window: () => win })
  createWindow()
}

// 한 $RELAY_HOME을 두 앱이 같이 쓰지 않게 하나만 띄운다. 두 번째로 켜면 떠 있는 창을 앞으로 가져온다
if (!app.requestSingleInstanceLock()) {
  app.exit(0)
} else {
  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })
  void app.whenReady().then(() =>
    start().catch((e: unknown) => {
      log('시작 실패', e)
      app.exit(1)
    }),
  )
}

app.on('window-all-closed', () => app.quit())

// 끝나기 전에 세션(claude)을 프로세스 트리째 끝내고 훅 서버를 닫는다
app.on('before-quit', (e) => {
  if (quitting) return
  quitting = true
  e.preventDefault()
  void (async () => {
    try {
      await works?.shutdown()
      await hooks?.close()
    } catch (err) {
      log('정리 실패', err)
    } finally {
      app.quit()
    }
  })()
})

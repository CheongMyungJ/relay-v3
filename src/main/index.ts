// Electron 메인 (docs/m2-modules.md 3절 index.ts): 창 하나, IPC, 훅·control 서버, Works 조립, 앱이 끝날 때 세션 정리.
// 'electron'을 가져오는 곳은 이 파일과 ipc.ts뿐이다. 조율은 Electron을 모르는 Works가 한다.
// MCP 브리지는 이 앱의 실행 파일을 Node로 돌린다(ELECTRON_RUN_AS_NODE=1 <앱> out/main/mcp-bridge.js).

import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { app, BrowserWindow, Notification, shell } from 'electron'
import { claudeVersion, findClaude } from '../adapters/claude.ts'
import { git } from '../adapters/exec.ts'
import * as gh from '../adapters/gh.ts'
import { relayHome } from '../adapters/store.ts'
import { check } from '../engine/check.ts'
import { m3Switches } from '../engine/m3.ts'
import { EVENTS, type WorkView } from '../shared/api.ts'
import { AttentionWatch } from './attention.ts'
import { HookServer } from './hooks.ts'
import { registerIpc } from './ipc.ts'
import { SessionHost } from './sessions.ts'
import { Store } from './store.ts'
import { claudeReview, Works } from './works.ts'
import { SessionLog } from './works-session-log.ts'
import { RecordFollower } from './works-record.ts'
import { RecordDesk } from './works-stats.ts'

let win: BrowserWindow | null = null
let works: Works | null = null
let follower: RecordFollower | null = null
let hooks: HookServer | null = null
let quitting = false

const log = (text: string, error?: unknown) => console.error(`[relay] ${text}`, error ?? '')

const attention = new AttentionWatch()

/**
 * 사람의 답이 필요해진 Work(V78): 독 배지에 그 수를 쓰고, 창을 보고 있지 않으면 OS 알림을 띄운다. 알림을 누르면 창을 앞으로
 * 가져오고 그 Work를 고른다. 알림을 쓸 수 없는 곳(알림 서버가 없는 Linux 등)에서는 조용히 넘어간다
 */
function attend(v: WorkView): void {
  const a = attention.note(v)
  try {
    app.setBadgeCount(attention.count())
    if (!a || win?.isFocused() || !Notification.isSupported()) return
    const n = new Notification({ title: a.title, body: a.body })
    n.on('click', () => {
      if (!win || win.isDestroyed()) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      win.webContents.send(EVENTS.show, { id: a.id })
    })
    n.show()
  } catch (e) {
    log('알림 실패', e)
  }
}

const HOME = relayHome(process.env)
// 창의 저장소와 하나만 띄우기 잠금을 $RELAY_HOME 아래에 둔다: 홈이 다른 앱(시험의 임시 홈)은 따로 뜬다
app.setPath('userData', join(HOME, 'electron'))

function createWindow(): void {
  win = new BrowserWindow({
    width: 1400,
    height: 880,
    // 사이드바(264)와 가장 좁은 패널(340) 사이에서 터미널이 70열쯤(560px) 남는 너비. 질문(AskUserQuestion)은 터미널에서 답한다
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

/** 앱 폴더가 git checkout의 맨 위면 그 HEAD(M4a relay_build). 다른 레포 안에 놓인 빌드는 그 레포의 commit이 아니므로 null */
async function appBuild(dir: string): Promise<string | null> {
  const top = (await git(['rev-parse', '--show-toplevel'], dir)).trim()
  if (resolve(top) !== resolve(dir)) return null
  return (await git(['rev-parse', 'HEAD'], dir)).trim()
}

async function start(): Promise<void> {
  const store = new Store({
    home: HOME,
    now: () => new Date().toISOString(),
    newId: () => randomUUID(),
  })
  const sessions = new SessionHost()
  // 세션 기록(M4a: 훅 본문의 effort, M4e: 세션 커밋 집합과 트레일러). 훅 서버가 보고 Works가 장부 줄에 읽는다
  const sessionLog = new SessionLog({
    store,
    work: (id) => works?.find(id) ?? null,
    note: (id, event) => works?.note(id, event),
    // 훅 위임 사고(devices.md '세션 커밋 가르기' 끄는 조건 (가)): 그 프로젝트의 트레일러를 끈다
    disableTrailer: async (project) => works?.updateSettings(project, { trailer: false }),
    log,
  })
  hooks = new HookServer({
    controlTokenFor: (id) => works?.controlToken(id) ?? null,
    tokenFor: (id) => works?.hookToken(id) ?? null,
    protectedBranches: (id) => works?.protectedBranches(id) ?? [],
    onHook: async (id, event, body) => (works ? works.onHook(id, event, body) : null),
    noteHook: (id, event, body, denied) => sessionLog.noteHook(id, event, body, denied),
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
  // 앱 checkout의 git commit(M4a 장부의 relay_build, 감사용). 패키지 빌드처럼 git 폴더가 없으면 모른다
  const relayBuild = await appBuild(app.getAppPath()).catch(() => null)
  const debounceMs = Number(process.env['RELAY_DEBOUNCE_MS'] ?? '')
  // RELAY_ABLATE=review: 평가에서 리뷰를 뺀 쪽(docs/experiments/m2/protocol.md). 제품 설정이 아니다
  const reviewDisabled = (process.env['RELAY_ABLATE'] ?? '').split(',').includes('review')
  // RELAY_M3: 평가가 M3 장치를 모두 끄거나 고른 것만 켠다(V38). 있으면 프로젝트 설정을 덮는다
  const m3 = process.env['RELAY_M3']
  for (const e of m3Switches(undefined, m3).errors) log(e)
  const now = () => new Date().toISOString()
  const relayVersion = app.getVersion()
  // 끝까지 따라가기(M4b): 끝난 Work의 PR과 PR 없이 끝남을 앱 시작, 새 Work, 6시간마다 따라간다
  const record = new RecordFollower({
    store,
    gh,
    now,
    relayVersion,
    ...(version ? { claudeVersion: version } : {}),
    log,
    // 장부에 줄이 더해졌다: 화면의 [실적]과 그림자 줄을 다시 읽게 한다
    onChange: (project) => {
      for (const bw of BrowserWindow.getAllWindows())
        if (!bw.isDestroyed()) bw.webContents.send(EVENTS.record, { project })
    },
  })
  follower = record
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
    review: claudeReview({ bin: claudeBin, log }),
    reviewDisabled,
    ...(m3 === undefined ? {} : { m3 }),
    sessionLog,
    ...(relayBuild ? { relayBuild } : {}),
    follow: (projectId) => void record.follow(projectId),
    gh,
    now,
    newId: () => randomUUID(),
    emit: (event, payload) => {
      for (const bw of BrowserWindow.getAllWindows())
        if (!bw.isDestroyed()) bw.webContents.send(event, payload)
      if (event === EVENTS.work) attend(payload as WorkView)
    },
    relayVersion,
    // 스모크 시험이 Stop 뒤 5초를 기다리지 않게 줄일 수 있다
    ...(debounceMs > 0 ? { debounceMs } : {}),
    ...(version ? { claudeVersion: version } : {}),
    log,
  })
  await w.init()
  works = w
  attention.prime(w.list().works)
  record.start()
  registerIpc({ works: w, record: new RecordDesk({ store, now }), sessions, window: () => win })
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
      follower?.stop()
      await works?.shutdown()
      await hooks?.close()
    } catch (err) {
      log('정리 실패', err)
    } finally {
      app.quit()
    }
  })()
})

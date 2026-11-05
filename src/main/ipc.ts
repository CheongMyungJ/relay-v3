// 렌더러 ↔ 메인 (docs/m2-modules.md 3절 ipc.ts). RelayApi의 채널을 Works와 SessionHost에 잇는다.
// 처리는 던지지 않고 IpcResult로 돌려준다(오류 글이 'Error invoking remote method …'에 묻히지 않게). preload가 Error로 바꾼다.
// 'electron'을 가져오는 곳은 이 파일과 index.ts뿐이다.

import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { IPC, type IpcResult, type NewWorkInput, type ProjectSettings } from '../shared/api.ts'
import type { SessionHost } from './sessions.ts'
import { exportable } from './works-evidence.ts'
import type { Works } from './works.ts'

type Handler = (...args: unknown[]) => unknown

const str = (v: unknown, what: string): string => {
  if (typeof v !== 'string') throw new Error(`${what}가 글이 아님`)
  return v
}

const obj = (v: unknown, what: string): Record<string, unknown> => {
  if (typeof v !== 'object' || v === null || Array.isArray(v))
    throw new Error(`${what}가 객체가 아님`)
  return v as Record<string, unknown>
}

/** 단위(V22): 없으면 Work 브랜치의 내보내기 */
const unitArg = (v: unknown): string | undefined => (v === undefined ? undefined : str(v, '단위'))

/** 단위 브랜치의 끝(V22): 브랜치 → SHA 또는 null */
const tipsArg = (v: unknown): Record<string, string | null> => {
  const out: Record<string, string | null> = {}
  for (const [k, x] of Object.entries(obj(v, '단위 브랜치의 끝')))
    out[k] = x === null ? null : str(x, '끝')
  return out
}

export function registerIpc(o: {
  works: Works
  sessions: SessionHost
  window: () => BrowserWindow | null
}): () => void {
  const { works, sessions } = o
  const handlers: Record<string, Handler> = {
    // 처음 목록(창을 열거나 다시 읽을 때): 기본 브랜치의 품질 기준 상태를 다시 잰다(V20)
    [IPC.list]: async () => {
      await works.refreshProjects()
      return works.list()
    },
    [IPC.addProject]: async () => {
      const win = o.window()
      const options = { title: '프로젝트 폴더 고르기', properties: ['openDirectory' as const] }
      // dialog.showOpenDialog를 부를 때마다 찾는다: 스모크 시험이 메인에서 바꿔 끼운다
      const r = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
      const path = r.canceled ? undefined : r.filePaths[0]
      return path ? works.addProject(path) : null
    },
    [IPC.updateSettings]: (id, s) =>
      works.updateSettings(str(id, 'id'), obj(s, '설정') as Partial<ProjectSettings>),
    [IPC.createWork]: (input) => {
      const i = obj(input, '입력')
      const w: NewWorkInput = {
        project: str(i.project, 'project'),
        request: str(i.request, '요청'),
      }
      if (typeof i.hint === 'string') w.hint = i.hint
      if (typeof i.base === 'string') w.base = i.base
      return works.createWork(w)
    },
    [IPC.resumeWork]: (id) => works.resumeWork(str(id, 'id')),
    [IPC.approveContract]: (id) => works.approveContract(str(id, 'id')),
    [IPC.askChanges]: (id, msg) => works.askChanges(str(id, 'id'), str(msg, '글')),
    [IPC.answerChange]: (id, a) => {
      const x = obj(a, '답')
      return works.answerChange(str(id, 'id'), {
        approved: x.approved === true,
        message: typeof x.message === 'string' ? x.message : '',
      })
    },
    [IPC.merge]: (id, unit) => works.merge(str(id, 'id'), unitArg(unit)),
    // [끝내기]와 [그래도 끝내기](V25): head는 화면의 HEAD나 상자의 head, force는 [그래도 끝내기], tips는 화면의 단위
    // 브랜치의 끝(V22)
    [IPC.end]: (id, input) => {
      const x = obj(input, '입력')
      return works.end(str(id, 'id'), {
        ...(x.head === undefined ? {} : { head: str(x.head, 'head') }),
        ...(x.force === true ? { force: true } : {}),
        ...(x.tips === undefined ? {} : { tips: tipsArg(x.tips) }),
      })
    },
    [IPC.cancelEnd]: (id) => works.cancelEnd(str(id, 'id')),
    [IPC.abandon]: (id) => works.abandon(str(id, 'id')),
    // [증거 다시 재기]: 열린 PR이 지금 끝을 가리키고 Work의 기준으로 가면 내보내기 후보로(리뷰 포함, V22: 그런 내보내기만).
    // PR이 뒤처진 끝을 내보내기로 재지 않는다(PR head가 아니면 머지할 수 없다)
    [IPC.runEvidence]: (id) => {
      const view = works.view(str(id, 'id'))
      const candidate =
        exportable(view.pr, view.base, view.head) ||
        view.exports.some((x) => exportable(x.pr, view.base, x.head))
      return works.runEvidence(view.id, { exportCandidate: candidate })
    },
    // [세션에 넘기기](V24): 지금 HEAD의 리뷰 지적 id들. unit은 단위 브랜치의 내보내기(V22)
    [IPC.sendFindings]: (id, ids, unit) => {
      if (!Array.isArray(ids) || !ids.every((x) => typeof x === 'string'))
        throw new Error('지적 id 목록이 아님')
      return works.sendFindings(str(id, 'id'), ids, unitArg(unit))
    },
    [IPC.terminalAttach]: (id) => {
      works.view(str(id, 'id'))
      return sessions.backlog(id as string)
    },
    [IPC.diff]: (id) => works.diff(str(id, 'id')),
    [IPC.debt]: (id) => works.debt(str(id, 'id')),
    [IPC.draftQuality]: (id) => works.draftQuality(str(id, 'projectId')),
  }
  for (const [channel, fn] of Object.entries(handlers)) {
    ipcMain.handle(channel, async (_e, ...args: unknown[]): Promise<IpcResult<unknown>> => {
      try {
        return { ok: true, value: (await fn(...args)) ?? null }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    })
  }
  // 사람이 화면에서 터미널에 친 글: 되먹임(V24)은 그 뒤 60초 동안 보내지 않는다. 앱의 tell은 이 길을 지나지 않는다
  const write = (_e: unknown, id: unknown, data: unknown) => {
    if (typeof id !== 'string' || typeof data !== 'string') return
    works.typed(id, data)
    sessions.write(id, data)
  }
  const resize = (_e: unknown, id: unknown, cols: unknown, rows: unknown) => {
    if (typeof id === 'string' && typeof cols === 'number' && typeof rows === 'number')
      sessions.resize(id, cols, rows)
  }
  ipcMain.on(IPC.terminalWrite, write)
  ipcMain.on(IPC.terminalResize, resize)
  return () => {
    for (const channel of Object.keys(handlers)) ipcMain.removeHandler(channel)
    ipcMain.removeListener(IPC.terminalWrite, write)
    ipcMain.removeListener(IPC.terminalResize, resize)
  }
}

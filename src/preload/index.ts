// preload (docs/m2-modules.md 3절): RelayApi를 window.relay로 내놓는다. 샌드박스 안에서 돌므로 CommonJS로 빌드한다
// (out/preload/index.cjs). 메인의 IpcResult를 풀어 실패는 Error로 던진다.

import { contextBridge, ipcRenderer } from 'electron'
import {
  EVENTS,
  IPC,
  type IpcResult,
  type RelayApi,
  type RelayEvent,
  type RelayEventPayload,
} from '../shared/api.ts'

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const r = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>
  if (!r.ok) throw new Error(r.error)
  return r.value
}

const events = new Set<string>(Object.values(EVENTS))

const api: RelayApi = {
  list: () => call(IPC.list),
  addProject: () => call(IPC.addProject),
  updateSettings: (id, s) => call(IPC.updateSettings, id, s),
  createWork: (o) => call(IPC.createWork, o),
  resumeWork: (id) => call(IPC.resumeWork, id),
  approveContract: (id) => call(IPC.approveContract, id),
  askChanges: (id, message) => call(IPC.askChanges, id, message),
  answerChange: (id, o) => call(IPC.answerChange, id, o),
  merge: (id, unit, o) => call(IPC.merge, id, unit, o),
  end: (id, o) => call(IPC.end, id, o),
  cancelEnd: (id) => call(IPC.cancelEnd, id),
  handEnd: (id, o) => call(IPC.handEnd, id, o),
  abandon: (id) => call(IPC.abandon, id),
  runEvidence: (id) => call(IPC.runEvidence, id),
  sendFindings: (id, ids, unit) => call(IPC.sendFindings, id, ids, unit),
  terminal: {
    attach: (id) => call(IPC.terminalAttach, id),
    write: (id, data) => ipcRenderer.send(IPC.terminalWrite, id, data),
    resize: (id, cols, rows) => ipcRenderer.send(IPC.terminalResize, id, cols, rows),
  },
  diff: (id) => call(IPC.diff, id),
  debt: (id) => call(IPC.debt, id),
  draftQuality: (projectId) => call(IPC.draftQuality, projectId),
  on<E extends RelayEvent>(event: E, cb: (payload: RelayEventPayload[E]) => void): () => void {
    if (!events.has(event)) throw new Error(`모르는 이벤트: ${String(event)}`)
    const listener = (_e: unknown, payload: RelayEventPayload[E]) => cb(payload)
    ipcRenderer.on(event, listener)
    return () => void ipcRenderer.removeListener(event, listener)
  },
}

contextBridge.exposeInMainWorld('relay', api)

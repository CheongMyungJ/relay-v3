// [흐름]의 앱: src/main/index.ts와 같은 차례로 훅 서버, SessionHost, Store, Works를 Electron 없이 조립한다.
// claude는 가짜(test/support/fake-claude), gh는 src/adapters/gh.ts 그대로(RELAY_GH_BIN으로 가짜 gh를 준다).
//
//   const app = await openApp({ home, log })   // 닫기: await app.close() (세션을 끝내고 서버를 닫는다)
//   await until(() => app.works.view(id).state === 'working', '승인')

import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import * as gh from '../../src/adapters/gh.ts'
import { check } from '../../src/engine/check.ts'
import { HookServer } from '../../src/main/hooks.ts'
import { SessionHost } from '../../src/main/sessions.ts'
import { Store } from '../../src/main/store.ts'
import { claudeReview, Works } from '../../src/main/works.ts'
import { FAKE_CLAUDE } from './fakes.ts'

export const BRIDGE = resolve(import.meta.dirname, '../../src/main/mcp-bridge.ts')

export interface TestApp {
  works: Works
  sessions: SessionHost
  store: Store
  port: number
  /** Works가 화면에 보낸 이벤트 */
  emitted: { event: string; payload: unknown }[]
  close(): Promise<void>
}

export interface OpenAppOptions {
  home: string
  relayVersion?: string
  claudeVersion?: string
  /** 기본 200ms (앱은 20초) */
  debounceMs?: number
  /** 열린 PR을 다시 읽는 간격. 기본 60초(시험이 기다리지 않게) */
  prPollMs?: number
  /** 세션의 claude. 기본 가짜 claude */
  claudeBin?: string
  /** 평가에서 리뷰를 뺀 쪽(RELAY_ABLATE=review)처럼 리뷰를 끈다 */
  reviewDisabled?: boolean
  /** 엔진 check. 기본 그대로. 시험이 감싸서 재기를 붙잡아 둔다(재기가 도는 사이의 일) */
  check?: typeof check
  log?: (message: string, error?: unknown) => void
}

export async function openApp(o: OpenAppOptions): Promise<TestApp> {
  const now = () => new Date().toISOString()
  const store = new Store({ home: o.home, now, newId: () => randomUUID() })
  const sessions = new SessionHost()
  const emitted: TestApp['emitted'] = []
  const log = o.log ?? (() => {})
  // 훅 서버가 먼저 떠야 포트를 Works에 줄 수 있다
  const ref: { works?: Works } = {}
  const hooks = new HookServer({
    controlTokenFor: (id) => ref.works?.controlToken(id) ?? null,
    tokenFor: (id) => ref.works?.hookToken(id) ?? null,
    protectedBranches: (id) => ref.works?.protectedBranches(id) ?? [],
    onHook: async (id, event, body) => (ref.works ? ref.works.onHook(id, event, body) : null),
    onControl: async (id, tool, args, signal) =>
      ref.works ? ref.works.onControl(id, tool, args, signal) : null,
    log,
  })
  const port = await hooks.listen()
  const works = new Works({
    store,
    sessions,
    hooksPort: port,
    controlUrl: `http://127.0.0.1:${port}/control`,
    bridgeCommand: { command: process.execPath, args: [BRIDGE], env: {} },
    claudeBin: o.claudeBin ?? FAKE_CLAUDE,
    check: o.check ?? check,
    review: claudeReview({ bin: FAKE_CLAUDE, log }),
    gh,
    now,
    newId: () => randomUUID(),
    emit: (event, payload) => void emitted.push({ event, payload }),
    relayVersion: o.relayVersion ?? '0.0.0-test',
    ...(o.claudeVersion ? { claudeVersion: o.claudeVersion } : {}),
    debounceMs: o.debounceMs ?? 200,
    prPollMs: o.prPollMs ?? 60_000,
    ...(o.reviewDisabled ? { reviewDisabled: true } : {}),
    log,
  })
  await works.init()
  ref.works = works
  return {
    works,
    sessions,
    store,
    port,
    emitted,
    async close() {
      await works.shutdown()
      await hooks.close()
    },
  }
}

/** 한 줄에 JSON 하나인 기록 파일(가짜 claude·gh의 로그). 없으면 [] */
export async function jsonl(path: string): Promise<Record<string, unknown>[]> {
  const text = await readFile(path, 'utf8').catch(() => '')
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>)
}

/** ok가 참이 될 때까지 50ms마다 본다. ms가 지나면 what을 담아 던진다 */
export async function until(
  ok: () => boolean | Promise<boolean>,
  what: string,
  ms = 120_000,
): Promise<void> {
  const started = Date.now()
  while (!(await ok())) {
    if (Date.now() - started > ms) throw new Error(`기다리다 지침: ${what}`)
    await new Promise((r) => setTimeout(r, 50))
  }
}

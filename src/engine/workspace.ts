// check worktree에서 명령을 돌린다 (docs/m1-modules.md engine, V7·V10·V11).
// slot(base, head)은 처음 쓸 때 한 번 준비한다. base 결과는 캐시에 둔다.
// 준비하지 못하면 missing에 적고 null을 돌려준다. 부르는 쪽은 not_run이나 결과 없음으로 본다.

import { mkdir, readFile, realpath, rm } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { classify, needsBase, needsRerun } from '../core/flaky.ts'
import { parseJUnit } from '../core/junit.ts'
import { qualityHash } from '../core/quality.ts'
import type { CommandEvidence, CommandRun, SetupSpec } from '../core/types.ts'
import { run, scrubbedEnv } from '../adapters/exec.ts'
import { baseCache } from '../adapters/store.ts'
import { overlay, prepareCheckout, type Slot } from '../adapters/worktrees.ts'

/** 명령의 시간 제한이 없을 때(초) */
export const DEFAULT_COMMAND_TIMEOUT_SEC = 600

/** 묶음에 남기는 표준 출력·오류의 뒤쪽 글자 수 */
export const BUNDLE_TAIL_CHARS = 16_000

/** 돌릴 명령. CommandSpec과 command 래칫이 함께 쓴다 */
export interface RunSpec {
  id: string
  run: string
  timeout_sec?: number
  junit?: string
}

export interface WorkspaceOptions {
  home: string
  key: string
  root: string
  base: string
  head: string
  setup?: SetupSpec
  /** 참이면 base 캐시를 읽지 않는다(쓰기는 한다) */
  rerun: boolean
  /** 없는 증거를 적는 곳. check의 묶음과 같은 배열 */
  missing: string[]
  /** 주면 worktree를 쓰지 않는다(잠금을 못 잡음 등). 까닭은 부르는 쪽이 missing에 적었다 */
  blocked?: boolean
}

export interface Workspace {
  /** slot의 폴더. 준비나 setup이 실패했으면 null */
  dir(slot: Slot): Promise<string | null>
  /** head에서 V7 규칙으로 돌리고 분류한다. withBase면 head가 통과해도 base에서 돈다 */
  command(spec: RunSpec, withBase: boolean): Promise<CommandEvidence>
  /** head에서 한 번 */
  headRun(spec: RunSpec): Promise<CommandRun | null>
  /** base에서 한 번(캐시). cacheId는 명령과 래칫의 id가 겹치지 않게 부르는 쪽이 정한다 */
  baseRun(spec: RunSpec, cacheId: string): Promise<CommandRun | null>
  /** base 소스에 head의 paths를 얹어 한 번 돌린다(바뀜 줄 판정, V11). 캐시하지 않는다 */
  overlaidBaseRun(spec: RunSpec, paths: string[]): Promise<CommandRun | null>
}

export function workspace(o: WorkspaceOptions): Workspace {
  const ready = new Map<Slot, Promise<string | null>>()
  const sha = (slot: Slot) => (slot === 'base' ? o.base : o.head)

  const dir = (slot: Slot): Promise<string | null> => {
    let p = ready.get(slot)
    if (p === undefined) {
      p = prepare(o, slot, sha(slot))
      ready.set(slot, p)
    }
    return p
  }

  const headRun = async (spec: RunSpec): Promise<CommandRun | null> => {
    const d = await dir('head')
    return d === null ? null : runIn(d, o.head, spec)
  }

  const baseRun = async (spec: RunSpec, cacheId: string): Promise<CommandRun | null> => {
    const hash = runHash(spec, o.setup)
    if (!o.rerun) {
      const hit = await baseCache.read(o.home, o.key, o.base, cacheId, hash).catch(() => null)
      if (hit !== null) return hit
    }
    const d = await dir('base')
    if (d === null) return null
    const r = await runIn(d, o.base, spec)
    // 시간 초과나 신호로 끝난 것은 다음에 다시 돌려 본다
    if (r.exit !== null && !r.timed_out) {
      await baseCache.write(o.home, o.key, o.base, cacheId, hash, r).catch(() => {})
    }
    return r
  }

  return {
    dir,
    headRun,
    baseRun,

    async command(spec, withBase) {
      const first = await headRun(spec)
      if (first === null) return { id: spec.id, outcome: 'not_run', head: [] }
      const head = [first]
      if (needsRerun(first)) {
        const second = await headRun(spec)
        if (second !== null) head.push(second)
      }
      const base = needsBase(head) || withBase ? await baseRun(spec, `cmd.${spec.id}`) : null
      const ev: CommandEvidence = { id: spec.id, outcome: classify(head, base ?? undefined), head }
      if (base !== null) ev.base = base
      return ev
    },

    async overlaidBaseRun(spec, paths) {
      const d = await dir('base')
      if (d === null) return null
      try {
        await overlay(o.home, d, o.root, o.head, paths)
      } catch (e) {
        o.missing.push(`base에 시험 얹기: ${message(e)}`)
        return null
      } finally {
        // 얹은 뒤의 base는 base가 아니다. 다음에 쓰면 다시 준비한다
        ready.delete('base')
      }
      return runIn(d, o.base, spec)
    },
  }
}

async function prepare(o: WorkspaceOptions, slot: Slot, sha: string): Promise<string | null> {
  if (o.blocked === true) return null
  try {
    const c = await prepareCheckout(o.home, o.key, o.root, slot, sha, o.setup)
    if (c.setupError !== undefined) {
      o.missing.push(`setup(${slot}): ${message(c.setupError)}`)
      return null
    }
    return c.dir
  } catch (e) {
    o.missing.push(`worktree(${slot}): ${message(e)}`)
    return null
  }
}

/** base 캐시의 열쇠: 결과를 바꿀 수 있는 명령 글, 시간 제한, JUnit 경로, setup */
function runHash(spec: RunSpec, setup: SetupSpec | undefined): string {
  return qualityHash(
    JSON.stringify([spec.run, spec.timeout_sec ?? null, spec.junit ?? null, setup ?? null]),
  )
}

/**
 * 명령을 한 번 돌린다. 던지지 않는다. junit이 있으면 지난 파일을 지우고 폴더를 만든 뒤 돌려서 읽는다.
 * 그 자리를 준비하지 못하면(폴더이거나 위쪽이 파일. head 내용이 만들 수 있다) 명령은 돌리되 시험 결과는 없다.
 */
export async function runIn(dir: string, sha: string, spec: RunSpec): Promise<CommandRun> {
  let junit = spec.junit === undefined ? null : insideDir(dir, spec.junit)
  if (junit !== null) {
    try {
      await mkdir(dirname(junit), { recursive: true })
      // 위쪽 조각이 worktree 밖을 가리키는 링크면 쓰지 않는다
      if (!within(await realpath(dir), await realpath(dirname(junit)))) junit = null
      else await rm(junit, { force: true })
    } catch {
      junit = null
    }
  }
  const sec = spec.timeout_sec ?? DEFAULT_COMMAND_TIMEOUT_SEC
  const out = await run(spec.run, {
    cwd: dir,
    timeoutMs: sec * 1000,
    env: scrubbedEnv(process.env),
  })
  const r: CommandRun = {
    id: spec.id,
    sha,
    exit: out.exit,
    timed_out: out.timed_out,
    duration_ms: out.duration_ms,
    stdout_tail: tail(out.stdout),
    stderr_tail: tail(out.stderr),
  }
  if (junit !== null) {
    const xml = await readFile(junit, 'utf8').catch(() => null)
    const parsed = xml === null ? null : parseJUnit(xml)
    if (parsed?.ok === true) r.tests = parsed.value
  }
  return r
}

/** dir 안의 경로면 절대 경로, 밖이면 null */
function insideDir(dir: string, rel: string): string | null {
  if (rel === '' || isAbsolute(rel)) return null
  const full = resolve(dir, rel)
  const back = relative(dir, full)
  if (back === '' || back === '..' || back.startsWith(`..${sep}`) || isAbsolute(back)) return null
  return full
}

/** path가 root이거나 그 아래인가(둘 다 절대 경로) */
function within(root: string, path: string): boolean {
  const back = relative(root, path)
  return back === '' || !(back === '..' || back.startsWith(`..${sep}`) || isAbsolute(back))
}

function tail(text: string): string {
  return text.length > BUNDLE_TAIL_CHARS ? text.slice(text.length - BUNDLE_TAIL_CHARS) : text
}

export function message(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e)
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > 200 ? `${line.slice(0, 199)}…` : line
}

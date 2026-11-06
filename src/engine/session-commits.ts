// 세션 커밋 가르기의 순수한 셈 (M4e, docs/m4-design.md 7절). 두 겹으로 세션 커밋과 사람 커밋을 가른다.
// - 첫 겹(앱 로컬 세션 커밋 집합): 세션의 셸 도구(PreToolUse·PostToolUse) 사이에 Work 브랜치에 새로 생긴 커밋. 집합은
//   main/works-session-log.ts가 works/<id>/session-commits.jsonl에 쓰고 이 파일의 parseSessionLog가 읽는다.
// - 둘째 겹(Relay-Work 트레일러, 사용자 결정 Q7): 세션 프로세스 환경에만 core.hooksPath를 $RELAY_HOME/git-hooks의 심으로
//   준다(trailerEnv). 심(shimText)은 원래 훅에 같은 인자와 표준 입력으로 넘기고, prepare-commit-msg와 commit-msg만 그 뒤에
//   이 Work의 레포 커밋에 `Relay-Work: <Work id>`를 더한다. 사용자 레포의 설정·훅 파일은 바꾸지 않는다.
// - 끝 줄을 쓸 때 머지 뒤 커밋을 넷으로 나눈다(classifyCommits): relay(V40 빚 커밋), base_update(깨끗한 기준 맞춤 머지),
//   session(집합과 트레일러가 둘 다 세션), human(나머지). 두 겹이 다르게 가르면 human으로 세고(엄격) 다름의 수를 남긴다.
// 관문 판의 파일이 아니다(결론을 바꾸지 않고 끝 줄의 칸과 불일치 갈래만 정한다).

import type { SessionStats } from '../shared/api.ts'
import { isConclusionLine } from './follow.ts'
import { exportKey, type AfterCommits, type LedgerEntry, type SessionSetSummary } from './ledger.ts'

/** 세션 커밋의 트레일러 이름(V40 빚 커밋과 같다) */
export const TRAILER_KEY = 'Relay-Work'

/** 세션 환경의 GIT_CONFIG_COUNT·GIT_CONFIG_KEY_<n>이 들어온 git(2.31). --path-format도 이때 들어왔다 */
export const TRAILER_GIT: readonly [number, number] = [2, 31]

/**
 * 심을 두는 git 훅 이름(githooks(5)). core.hooksPath는 폴더 하나를 가리키므로 모든 이름에 심을 둔다: 심이 없는 이름은 원래
 * 훅이 있어도 돌지 않는다(바닥을 깨면 안 된다)
 */
export const GIT_HOOK_NAMES: readonly string[] = [
  'applypatch-msg',
  'pre-applypatch',
  'post-applypatch',
  'pre-commit',
  'pre-merge-commit',
  'prepare-commit-msg',
  'commit-msg',
  'post-commit',
  'pre-rebase',
  'post-checkout',
  'post-merge',
  'pre-push',
  'pre-receive',
  'update',
  'proc-receive',
  'post-receive',
  'post-update',
  'reference-transaction',
  'push-to-checkout',
  'pre-auto-gc',
  'post-rewrite',
  'sendemail-validate',
  'fsmonitor-watchman',
  'p4-changelist',
  'p4-prepare-changelist',
  'p4-post-changelist',
  'p4-pre-submit',
  'post-index-change',
]

/** 트레일러를 더하는 훅: prepare-commit-msg(--no-verify도 건너뛰지 않음)와 commit-msg(편집기로 쓴 메시지) */
const TRAILER_HOOKS = new Set(['prepare-commit-msg', 'commit-msg'])

// 심의 몸통. NAME은 훅 이름으로 바꾼다. 셸의 '${'를 쓰지 않는다(String.raw 안이다)
const SHIM_HEAD = String.raw`#!/bin/sh
# relay 세션 훅 심 (relay-v3 M4e, docs/m4-design.md 7.2). relay가 세션 프로세스의 환경(GIT_CONFIG_*)으로만 core.hooksPath를
# 이 폴더로 준다. 원래 훅(그 설정을 뺀 git이 고르는 자리: 레포의 core.hooksPath, husky 등)에 같은 인자와 표준 입력으로 넘긴다.
name='NAME'
relay_note() {
  if [ -n "$RELAY_HOOK_LOG" ]; then printf '%s\n' "$name: $1" >> "$RELAY_HOOK_LOG"; fi
}
base=$RELAY_GIT_CONFIG_BASE
[ -n "$base" ] || base=0
orig=$(GIT_CONFIG_COUNT=$base git rev-parse --path-format=absolute --git-path hooks 2>/dev/null)
if [ -z "$orig" ] || [ "$orig" = "$RELAY_HOOKS_DIR" ]; then
  relay_note "원래 훅 자리를 찾지 못함 ($orig)"
  exit 1
fi
`

const SHIM_PASS = String.raw`[ -x "$orig/$name" ] || exit 0
exec "$orig/$name" "$@"
`

const SHIM_TRAILER = String.raw`if [ -x "$orig/$name" ]; then "$orig/$name" "$@" || exit $?; fi
[ -n "$RELAY_WORK_ID" ] || exit 0
# 이 Work의 레포 커밋만(세션이 시험에서 만든 다른 레포에는 더하지 않는다)
[ "$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" = "$RELAY_GIT_COMMON" ] || exit 0
# 빈 메시지(편집기를 열 커밋의 첫 메시지)는 그대로 둔다: git이 빈 메시지의 커밋을 그만두게
sed '/^. -\{24\} >8 -\{24\}$/,$d' "$1" | git stripspace --strip-comments | grep -q . || exit 0
git interpret-trailers --in-place --if-exists addIfDifferent --trailer "KEY: $RELAY_WORK_ID" "$1" ||
  relay_note "트레일러를 더하지 못함"
exit 0
`

/** 훅 이름 하나의 심(sh). 원래 훅에 넘기고, 트레일러 훅이면 그 뒤에 이 Work의 레포 커밋에 트레일러를 더한다 */
export function shimText(name: string): string {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`훅 이름이 잘못됨: ${name}`)
  const body = TRAILER_HOOKS.has(name) ? SHIM_TRAILER.replace('KEY', TRAILER_KEY) : SHIM_PASS
  return SHIM_HEAD.replace('NAME', name) + body
}

/** 모든 훅 이름의 심 */
export function shimFiles(): Record<string, string> {
  return Object.fromEntries(GIT_HOOK_NAMES.map((n) => [n, shimText(n)]))
}

/** `git --version`의 [major, minor]. 못 읽으면 null */
export function gitVersionOf(text: string): [number, number] | null {
  const m = /(\d+)\.(\d+)/.exec(text)
  return m ? [Number(m[1]), Number(m[2])] : null
}

/** 이 git이 세션 환경의 훅 자리를 받나(2.31 이상) */
export function trailerGitOk(text: string): boolean {
  const v = gitVersionOf(text)
  if (v === null) return false
  const [major, minor] = TRAILER_GIT
  return v[0] > major || (v[0] === major && v[1] >= minor)
}

/**
 * 세션 PTY 환경에 더할 변수(m4-design 7.2): core.hooksPath를 심 폴더로(물려받은 GIT_CONFIG_COUNT가 있으면 그 뒤에 붙인다.
 * 물려받은 환경이 이미 relay 세션의 것이면 그 심 자리를 바꾼다),
 * 심이 원래 훅을 찾을 때 쓸 앞 설정의 수, 심 폴더, 이 Work의 레포(git common dir), 심이 사고를 적는 파일. 세션 프로세스와 그
 * 자식만 물려받는다(사람의 셸, 앱의 확인 실행기는 물려받지 않는다)
 */
export function trailerEnv(o: {
  inherited: Readonly<Record<string, string | undefined>>
  shimDir: string
  gitCommon: string
  hookLog: string
}): Record<string, string> {
  const n = Number(o.inherited['GIT_CONFIG_COUNT'] ?? '0')
  const count = Number.isInteger(n) && n >= 0 ? n : 0
  // 이미 relay 세션 환경 안이면(앱이나 시험을 세션 안에서 띄움) 그 심 자리를 이 심으로 바꾼다: 두 심이 서로를 원래 훅으로 부르며
  // 끝없이 돌지 않게, 원래 훅 자리는 바깥 심을 뺀 설정으로 찾는다
  const prev = Number(o.inherited['RELAY_GIT_CONFIG_BASE'] ?? NaN)
  const nested =
    Number.isInteger(prev) &&
    prev >= 0 &&
    prev < count &&
    o.inherited[`GIT_CONFIG_KEY_${String(prev)}`] === 'core.hooksPath' &&
    o.inherited[`GIT_CONFIG_VALUE_${String(prev)}`] === o.inherited['RELAY_HOOKS_DIR']
  const base = nested ? prev : count
  return {
    GIT_CONFIG_COUNT: String(nested ? count : count + 1),
    [`GIT_CONFIG_KEY_${String(base)}`]: 'core.hooksPath',
    [`GIT_CONFIG_VALUE_${String(base)}`]: o.shimDir,
    RELAY_GIT_CONFIG_BASE: String(base),
    RELAY_HOOKS_DIR: o.shimDir,
    RELAY_GIT_COMMON: o.gitCommon,
    RELAY_HOOK_LOG: o.hookLog,
  }
}

/** 커밋 메시지의 마지막 문단에 있는 `Relay-Work:` 트레일러의 값(이름은 대소문자를 가리지 않는다, git과 같다) */
export function workTrailers(message: string): string[] {
  const paragraphs = message
    .replace(/\r\n/g, '\n')
    .trim()
    .split(/\n[ \t]*\n/)
  const last = paragraphs.length > 1 ? (paragraphs.at(-1) ?? '') : ''
  const out: string[] = []
  const key = new RegExp(`^${TRAILER_KEY}:\\s*(\\S+)\\s*$`, 'i')
  for (const line of last.split('\n')) {
    const m = key.exec(line.trim())
    if (m?.[1]) out.push(m[1])
  }
  return out
}

/** 가를 커밋 하나(거울에서 읽은 head..merged 사이 커밋, engine/follow.ts BetweenCommit) */
export interface ClassifyCommit {
  sha: string
  /** 작성자 이메일 */
  author: string
  /** 앱이 쓴 빚 커밋(V40, engine/follow.ts BetweenCommit.relay: 앱이 적은 SHA. 작성자만으로는 정하지 않는다) */
  relay?: boolean
  /** 깨끗한 기준 맞춤 머지 */
  baseUpdate: boolean
  /** 메시지의 Relay-Work 트레일러 값 */
  trailers?: readonly string[]
}

export const NO_COMMITS: Readonly<AfterCommits> = {
  session: 0,
  human: 0,
  relay: 0,
  base_update: 0,
  disagree: 0,
}

/**
 * 머지 뒤 커밋의 갈래(m4-design 7.3). relay(앱이 쓴 빚 커밋, V40: relay 칸), base_update(깨끗한 기준 맞춤 머지), session(집합에
 * 있고 이 Work의 트레일러가 있음), human(나머지). trailer가 거짓(트레일러를 켜지 않은 세션이 있음)이면 집합만으로 가른다.
 * 집합과 트레일러가 다르게 가르면 human으로 세고 disagree에 더한다(엄격)
 */
export function classifyCommits(
  commits: readonly ClassifyCommit[],
  o: { set: ReadonlySet<string>; work: string; trailer: boolean },
): AfterCommits {
  const out = { ...NO_COMMITS }
  for (const c of commits) {
    if (c.relay === true) out.relay++
    else if (c.baseUpdate) out.base_update++
    else {
      const inSet = o.set.has(c.sha)
      const marked = c.trailers?.includes(o.work) ?? false
      if (!o.trailer) out[inSet ? 'session' : 'human']++
      else if (inSet && marked) out.session++
      else {
        out.human++
        if (inSet !== marked) out.disagree++
      }
    }
  }
  return out
}

// ── 세션 커밋 집합의 파일(works/<id>/session-commits.jsonl) ─────────────────

/** 세션을 띄울 때 한 줄: 트레일러를 켰나. 끈 까닭은 setting(프로젝트 설정), git(2.31 미만), error(심을 두지 못함) */
export interface LaunchLine {
  ts: string
  kind: 'launch'
  trailer: boolean
  why?: 'setting' | 'git' | 'error'
}

/** 셸 도구 하나(또는 Stop까지) 동안 Work 브랜치에 새로 생긴 커밋. on은 그때 트레일러가 켜져 있었나 */
export interface CommitsLine {
  ts: string
  kind: 'commits'
  on: boolean
  tool: string | null
  commits: { sha: string; trailer: boolean }[]
}

export type SessionLine = LaunchLine | CommitsLine

/** 읽은 세션 커밋 집합 */
export interface SessionSet {
  /** 세션을 띄운 기록이 있나(M4e 앞의 Work는 없다: 집합을 모른다) */
  launched: boolean
  /** 트레일러를 켜지 않고 띄운 세션이 있었나 */
  trailerOff: boolean
  /** sha → 트레일러를 켠 채 봤나(watched)와 그때 트레일러가 있었나 */
  commits: Map<string, { watched: boolean; trailer: boolean }>
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** session-commits.jsonl을 읽는다. 깨진 줄과 모양이 다른 줄은 건너뛴다 */
export function parseSessionLog(text: string): SessionSet {
  const out: SessionSet = { launched: false, trailerOff: false, commits: new Map() }
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    let v: unknown
    try {
      v = JSON.parse(line)
    } catch {
      continue
    }
    if (!isObject(v)) continue
    if (v['kind'] === 'launch' && typeof v['trailer'] === 'boolean') {
      out.launched = true
      if (!v['trailer']) out.trailerOff = true
    } else if (v['kind'] === 'commits' && Array.isArray(v['commits'])) {
      const on = v['on'] === true
      for (const c of v['commits']) {
        if (!isObject(c) || typeof c['sha'] !== 'string') continue
        const before = out.commits.get(c['sha'])
        out.commits.set(c['sha'], {
          watched: (before?.watched ?? false) || on,
          trailer: (before?.trailer ?? false) || c['trailer'] === true,
        })
      }
    }
  }
  return out
}

/** 끝 줄의 session_set(Work의 집합 전체): 커밋 수, 트레일러를 켠 채 본 수, 그 가운데 트레일러가 있는 수, 훅 위임 사고 수 */
export function sessionSummary(s: SessionSet, incidents: number): SessionSetSummary {
  let watched = 0
  let trailered = 0
  for (const c of s.commits.values()) {
    if (!c.watched) continue
    watched++
    if (c.trailer) trailered++
  }
  return { commits: s.commits.size, watched, trailered, incidents }
}

/**
 * 세션 커밋 가르기의 장치 지표(devices.md '세션 커밋 가르기'): 머지마다 그 내보내기의 첫 결론 줄('준비됨') head 뒤 머지된
 * head까지의 커밋을 가른 것(끝 줄의 head면 after_commits, 앞 head면 after_heads)의 수와 사람 교정(사람 커밋이 하나라도 있는
 * 머지, philosophy 8.1), 가르지 못한 머지(분모에 넣지 않고 따로 셈: 빠진 것이 보이게), 갈래 합, 집합과 트레일러가 다름, 집합만으로 가른 머지. Work마다 마지막 끝 줄의 session_set으로 트레일러
 * 덮임과 훅 위임 사고. 판은 보지 않는다(장치의 지표다)
 */
export function sessionStats(entries: readonly LedgerEntry[]): SessionStats {
  const out: SessionStats = {
    merges: 0,
    corrected: 0,
    unclassified: 0,
    commits: { session: 0, human: 0, relay: 0, base_update: 0 },
    disagree: 0,
    set_only: 0,
    works: 0,
    session_commits: 0,
    watched: 0,
    trailered: 0,
    incidents: 0,
  }
  const sets = new Map<string, SessionSetSummary>()
  // 내보내기마다 첫 결론 줄의 head('준비됨'): 사람 교정은 그 뒤 머지까지의 커밋으로 센다
  const first = new Map<string, string>()
  for (const e of entries) {
    const key = JSON.stringify([e.project, exportKey(e)])
    if (isConclusionLine(e) && !first.has(key)) first.set(key, e.head)
    if (e.session_set) sets.set(JSON.stringify([e.project, e.work]), e.session_set)
    if (!e.merged_head) continue
    const from = first.get(key) ?? e.head
    // 첫 head 그대로 머지했으면 사이 커밋이 없다(M4e 앞의 끝 줄도)
    const a =
      from === e.merged_head
        ? NO_COMMITS
        : from === e.head
          ? e.after_commits
          : e.after_heads?.[from]
    if (!a) {
      out.unclassified++
      continue
    }
    out.merges++
    if (a.human > 0) out.corrected++
    out.commits.session += a.session
    out.commits.human += a.human
    out.commits.relay += a.relay
    out.commits.base_update += a.base_update
    out.disagree += a.disagree
    if (e.trailer === false) out.set_only++
  }
  for (const s of sets.values()) {
    out.works++
    out.session_commits += s.commits
    out.watched += s.watched
    out.trailered += s.trailered
    out.incidents += s.incidents
  }
  return out
}

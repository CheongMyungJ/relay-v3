// Work의 worktree와 세션 (docs/m2-modules.md 3절 works.ts의 createWork·resumeWork, docs/m2-app.md 3절).
// worktree는 $RELAY_HOME/worktrees/<workId>, 작업 브랜치는 relay/<짧은 이름>-<4자>(git worktree add -b).
// 세션은 PTY의 claude: --settings(훅), --append-system-prompt-file(지침), --mcp-config(relay 도구). 설정과 MCP 파일은
// 포트·토큰이 앱 실행마다 바뀌므로 띄울 때마다 새로 쓴다. [변경]과 [빚]도 worktree에서 읽는다.

import { randomBytes } from 'node:crypto'
import { git } from '../adapters/exec.ts'
import { lsTree, mergeBase, repoRoot, showFile } from '../adapters/git.ts'
import { parseDebt, touching } from '../core/debt.ts'
import {
  firstPrompt,
  sessionEnv,
  instructionsText,
  launchArgs,
  mcpConfig,
  sessionSettings,
  TOOL_CHANGE,
  TOOL_SUBMIT,
} from '../core/instructions.ts'
import { parseQuality } from '../core/quality.ts'
import type { DebtItem } from '../core/types.ts'
import { QUALITY_PATH } from '../engine/check.ts'
import { EVENTS, type NewWorkInput } from '../shared/api.ts'
import type { ProjectRecord, WorkRecord } from './store.ts'
import { headOf } from './works-evidence.ts'
import { message, type WorkCtx, type WorksDeps } from './works-types.ts'

const BRANCH_NAME = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]+$/

// 한글 음절의 로마자(국어의 로마자 표기법의 자모 대응만, 소리 바뀜은 무시): 첫소리, 가운뎃소리, 끝소리
const INITIAL = 'g kk n d tt r m b pp s ss - j jj ch k t p h'.split(' ')
const MEDIAL = 'a ae ya yae eo e yeo ye o wa wae oe yo u wo we wi yu eu ui i'.split(' ')
const FINAL = '- k k k n n n t l k m l l l p l m p p t t ng t t k t p t'.split(' ')

/** 한글 음절을 로마자로 옮긴다(브랜치 이름용). 다른 글자는 그대로 */
export function romanize(text: string): string {
  return text.replace(/[\uAC00-\uD7A3]/g, (ch) => {
    const n = ch.charCodeAt(0) - 0xac00
    const part = (list: string[], i: number) => (list[i] === '-' ? '' : (list[i] ?? ''))
    return (
      part(INITIAL, Math.floor(n / 588)) +
      part(MEDIAL, Math.floor((n % 588) / 28)) +
      part(FINAL, n % 28)
    )
  })
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
}

const hasLetter = (text: string): boolean => /[a-z]/.test(text)

/**
 * 요청 글에서 브랜치·계약 id에 쓸 짧은 이름(영문 소문자·숫자·-, 24자까지). 영문 낱말이 없으면(한국어로만 쓴 요청,
 * '청구서 합계가 3원 크다'처럼 한글에 숫자만 섞인 요청) 한글을 로마자로 옮겨 쓴다. 숫자만으로 된 이름은 짓지 않는다:
 * 그래도 글자가 없으면 'work-'를 앞에 붙이고, 아무것도 없으면 'work'
 */
export function shortName(request: string): string {
  const plain = words(request)
  const named = plain.some(hasLetter) ? plain : words(romanize(request))
  const ws = named.some(hasLetter) ? named : ['work', ...named]
  let out = ''
  for (const w of ws) {
    const next = out ? `${out}-${w}` : w
    if (next.length > 24) break
    out = next
  }
  return out || ws[0]?.slice(0, 24) || 'work'
}

/** 요청의 첫 줄(60자) */
function titleOf(request: string): string {
  const first = request.trim().split(/\r?\n/)[0]?.trim() ?? ''
  return first.length > 60 ? `${first.slice(0, 59)}…` : first
}

async function refExists(root: string, ref: string): Promise<boolean> {
  return git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], root)
    .then(() => true)
    .catch(() => false)
}

/** worktree를 만들 ref(품질 기준을 읽는 곳도): origin/<base>가 있으면 그것, 없으면 로컬 <base> */
export async function baseRef(root: string, base: string): Promise<string> {
  for (const ref of [`origin/${base}`, base]) if (await refExists(root, ref)) return ref
  throw new Error(`기준 브랜치를 찾지 못함: ${base}`)
}

/** 기준의 quality.json이 정한 예시 자료 폴더(없으면 기본값). 지침과 앱이 쓰는 예시 자료(V27)가 함께 쓴다 */
export async function examplesDir(root: string, ref: string): Promise<string> {
  const sha = (await git(['rev-parse', ref], root)).trim()
  const text = await showFile(root, sha, QUALITY_PATH).catch(() => null)
  const parsed = text === null ? null : parseQuality(text)
  return parsed?.ok ? parsed.value.examples_dir : '.relay/examples'
}

/**
 * 새 Work의 worktree·작업 브랜치·요청 글·지침을 만들고 기록을 돌려준다(아직 저장하지 않음). 브랜치 꼬리는 Work id의 앞
 * 4자이고, 그 브랜치가 이미 있으면 더 길게 쓴다
 */
export async function newWork(
  deps: WorksDeps,
  project: ProjectRecord,
  o: NewWorkInput,
): Promise<WorkRecord> {
  const { store } = deps
  const request = o.request.trim()
  if (!request) throw new Error('요청이 비었음')
  const base = (o.base ?? '').trim() || project.defaultBranch
  if (!base || !BRANCH_NAME.test(base)) throw new Error(`기준 브랜치가 잘못됨: ${base ?? '없음'}`)
  const ref = await baseRef(project.path, base)
  const id = deps.newId()
  const short = shortName(request)
  const hex = id.replace(/[^0-9a-z]/gi, '').toLowerCase()
  let tail = hex.slice(0, 4)
  while ((await refExists(project.path, `refs/heads/relay/${short}-${tail}`)) && tail.length < 12)
    tail = hex.slice(0, tail.length + 2)
  const branch = `relay/${short}-${tail}`
  const worktree = store.worktreeDir(id)
  // --no-track: origin/<base>를 upstream으로 두면 인자 없는 `git push`가 push.default=upstream에서 기준 브랜치로 간다
  await git(['worktree', 'add', '--quiet', '--no-track', '-b', branch, worktree, ref], project.path)
  const hint = o.hint?.trim() || null
  const at = deps.now()
  const rec: WorkRecord = {
    version: 1,
    id,
    project: project.id,
    title: titleOf(request),
    state: 'drafting',
    branch,
    base,
    base_ref: ref,
    worktree: await repoRoot(worktree),
    session_id: deps.newId(),
    session_started: false,
    contract_id: `${short}-${tail}`,
    hint,
    created_at: at,
    updated_at: at,
    pending_contract: null,
    pending_change: null,
    groundings: null,
    pr: null,
    evidence_path: null,
    gate: null,
    exported_head: null,
    error: null,
    notice: null,
    end_pending: null,
    prepared_reviews: 0,
  }
  const text = hint ? `${request}\n\n## 일의 성격 제안\n\n${hint}\n` : `${request}\n`
  await store.writeText(id, 'request.md', text)
  await store.writeText(
    id,
    'instructions.md',
    instructionsText({
      workId: id,
      contractId: rec.contract_id,
      examplesDir: await examplesDir(project.path, ref),
      baseBranch: base,
      workBranch: branch,
      questionMode: project.settings.question_mode,
    }),
  )
  return rec
}

/** 재개의 첫 프롬프트: 멈춘 사이 사람이 답한 것, 또는 끊긴 도구를 다시 부르라는 안내. 없으면 null */
function resumePrompt(rec: WorkRecord): string | null {
  if (rec.notice) return rec.notice
  if (rec.state === 'awaiting_approval')
    return `relay restarted while your ${TOOL_SUBMIT} call was waiting for the human. Call ${TOOL_SUBMIT} again with the same contract.`
  if (rec.state === 'recontract')
    return `relay restarted while your ${TOOL_CHANGE} call was waiting for the human. Call ${TOOL_CHANGE} again.`
  return null
}

/**
 * 세션 파일을 쓰고 claude를 PTY에 띄운다. 새 세션은 --session-id, 재개는 --resume. 다만 그 session_id의 세션에서 훅을
 * 받은 적이 없으면(claude가 대화를 만들기 전에 끝남: 실행 파일, 로그인, 인자) 그 대화가 없으므로 새 session id와 첫
 * 프롬프트로 새로 띄운다
 */
export async function launch(ctx: WorkCtx, rec: WorkRecord, wantResume: boolean): Promise<void> {
  const { deps } = ctx
  const { store, sessions } = deps
  const id = rec.id
  const rt = ctx.runtime(id)
  const resume = wantResume && rec.session_started
  if (wantResume && !resume) rec.session_id = deps.newId()
  rt.token = randomBytes(24).toString('hex')
  rt.controlToken = randomBytes(24).toString('hex')
  const bridge = deps.bridgeCommand
  await store.writeJson(id, 'settings.json', sessionSettings({ port: deps.hooksPort, workId: id }))
  await store.writeJson(
    id,
    'mcp.json',
    mcpConfig({
      command: bridge.command,
      args: bridge.args,
      env: {
        ...bridge.env,
        RELAY_CONTROL_URL: deps.controlUrl,
        RELAY_CONTROL_TOKEN: rt.controlToken,
        RELAY_WORK_ID: id,
      },
    }),
  )
  const args = launchArgs({
    sessionId: rec.session_id,
    resume,
    settingsPath: store.workPath(id, 'settings.json'),
    instructionsPath: store.workPath(id, 'instructions.md'),
    mcpConfigPath: store.workPath(id, 'mcp.json'),
    prompt: resume ? resumePrompt(rec) : firstPrompt(store.workPath(id, 'request.md')),
    ...(deps.model ? { model: deps.model } : {}),
  })
  wire(ctx, id)
  try {
    sessions.start(id, {
      bin: deps.claudeBin,
      args,
      cwd: rec.worktree,
      env: sessionEnv({ hookToken: rt.token, workId: id }),
    })
  } catch (e) {
    rt.session = 'stopped'
    rec.error = `세션을 띄우지 못함: ${message(e)}`
    await ctx.save(rec)
    return
  }
  rt.session = 'starting'
  // 사람의 답(notice)은 세션이 받은 뒤(UserPromptSubmit)에 지운다: 재개가 곧바로 실패해도 남는다
  rt.noticeSent = resume && rec.notice !== null
  rec.error = null
  await ctx.save(rec)
  ctx.note(id, { type: resume ? 'resumed' : 'started', session: rec.session_id })
}

/** 세션 출력과 끝을 화면에 잇는다(Work마다 한 번, 재개해도 이어진다) */
function wire(ctx: WorkCtx, id: string): void {
  const rt = ctx.runtime(id)
  if (rt.wired) return
  rt.wired = true
  const { sessions, emit } = ctx.deps
  sessions.onData(id, (data, seq) => emit(EVENTS.terminalData, { id, data, seq }))
  sessions.onExit(id, (code) => {
    // 훅 하나 없이 실패로 끝났으면 claude를 띄우지 못한 것이다(실행 파일, 인자, 로그인)
    if (rt.session === 'starting' && code !== 0) {
      const rec = ctx.record(id)
      rec.error = `세션이 시작하자마자 끝남 (종료 코드 ${code}). 터미널의 출력을 보세요`
      void ctx.save(rec).catch((e) => ctx.log('저장 실패', e))
    }
    rt.session = 'stopped'
    rt.token = null
    rt.controlToken = null
    emit(EVENTS.terminalExit, { id, code })
    ctx.note(id, { type: 'session_exit', code })
    ctx.publish(id)
  })
}

/** [변경]: 기준과 HEAD의 공통 조상부터 `git diff --stat`, 빈 줄, 파일별 diff */
export async function workDiff(rec: WorkRecord): Promise<string> {
  const base = await mergeBase(rec.worktree, rec.base_ref, 'HEAD')
  const [stat, patch] = await Promise.all([
    git(['diff', '--stat', '--no-color', base, 'HEAD'], rec.worktree),
    git(['diff', '--no-color', '--no-ext-diff', base, 'HEAD'], rec.worktree),
  ])
  return `${stat.trimEnd()}\n\n${patch}`
}

/** [빚]: HEAD의 .relay/debt/*.md 가운데 이 Work가 바꾼 경로에 닿은 것 */
export async function workDebt(rec: WorkRecord): Promise<DebtItem[]> {
  const head = await headOf(rec.worktree)
  const base = await mergeBase(rec.worktree, rec.base_ref, head)
  const changed = (await git(['diff', '--name-only', '-z', base, head], rec.worktree))
    .split('\0')
    .filter(Boolean)
  const items: DebtItem[] = []
  for (const path of await lsTree(rec.worktree, head)) {
    const m = /^\.relay\/debt\/([^/]+)\.md$/.exec(path)
    if (!m?.[1]) continue
    const text = await showFile(rec.worktree, head, path)
    const parsed = text === null ? null : parseDebt(text, m[1])
    if (parsed?.ok) items.push(parsed.value)
  }
  return touching(items, changed)
}

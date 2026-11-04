// gh CLI (docs/m2-modules.md 2절): PR 찾기·읽기·머지와 서버 쪽 브랜치 보호 읽기.
// gh는 셸 없이 인자 배열로 부르고(runFile), repoDir에서 돌려 gh가 그 레포의 원격으로 OWNER/REPO를 고르게 한다.
// 실패는 던지지 않고 결과로 돌려준다. 실행 파일은 RELAY_GH_BIN(시험의 가짜 gh), 없으면 PATH의 gh다.

import type { ServerProtection } from '../core/types.ts'
import { runFile } from './pty.ts'

export type PrState = 'OPEN' | 'CLOSED' | 'MERGED'

/** `gh pr list --json number,url,state,headRefOid,baseRefName,isDraft,mergedAt`의 한 줄 */
export interface PrInfo {
  number: number
  url: string
  state: PrState
  headRefOid: string
  baseRefName: string
  isDraft: boolean
  /** 머지된 시각. 머지되지 않았으면 null */
  mergedAt: string | null
}

/** statusCheckRollup 한 항목의 요약. bucket은 `gh pr checks`의 갈래와 같다 */
export interface PrCheck {
  name: string
  /** CheckRun은 끝났으면 conclusion, 아니면 status. StatusContext는 state */
  state: string
  bucket: 'pass' | 'fail' | 'pending' | 'skipping' | 'cancel'
}

/** `gh pr view --json mergeable,mergeStateStatus,statusCheckRollup,headRefOid,state` */
export type PrStatus =
  | {
      ok: true
      state: PrState
      headRefOid: string
      /** MERGEABLE | CONFLICTING | UNKNOWN */
      mergeable: string
      /** CLEAN, BLOCKED, BEHIND, DIRTY, UNSTABLE, HAS_HOOKS, DRAFT, UNKNOWN 따위 */
      mergeStateStatus: string
      checks: PrCheck[]
    }
  | { ok: false; error: string }

export type MergeMethod = 'merge' | 'squash' | 'rebase'

const TIMEOUT_MS = 60_000

function ghBin(): string {
  return process.env.RELAY_GH_BIN || 'gh'
}

/** 앱에는 gh가 물을 터미널이 없다. 묻지 않게 하고 업데이트 안내를 끈다 (gh help environment) */
const GH_ENV = { GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1' }

type GhResult = { ok: true; stdout: string } | { ok: false; error: string }

async function gh(repoDir: string, args: string[]): Promise<GhResult> {
  const r = await runFile(ghBin(), args, { cwd: repoDir, timeoutMs: TIMEOUT_MS, env: GH_ENV })
  if (r.exit === 0) return { ok: true, stdout: r.stdout }
  const why = (r.stderr.trim() || r.stdout.trim() || '출력 없음').slice(-2_000)
  return {
    ok: false,
    error: `gh ${args.slice(0, 2).join(' ')} 실패 (종료 ${String(r.exit)}): ${why}`,
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

const isPrNumber = (n: number) => Number.isSafeInteger(n) && n > 0

function prState(v: unknown): PrState {
  return v === 'MERGED' || v === 'CLOSED' ? v : 'OPEN'
}

/** gh가 로그인되어 있는가 (`gh auth status`의 종료 코드). gh가 없어도 false */
export async function ghAvailable(): Promise<boolean> {
  const r = await gh(process.cwd(), ['auth', 'status'])
  return r.ok
}

const PR_LIST_FIELDS = 'number,url,state,headRefOid,baseRefName,isDraft,mergedAt'

/** branch를 head로 하는 가장 최근 PR(열림·닫힘·머지됨 모두). 없거나 읽지 못하면 null */
export async function findPr(repoDir: string, branch: string): Promise<PrInfo | null> {
  const r = await gh(repoDir, [
    'pr',
    'list',
    '--head',
    branch,
    '--state',
    'all',
    '--json',
    PR_LIST_FIELDS,
  ])
  if (!r.ok) return null
  const list = parseJson(r.stdout)
  if (!Array.isArray(list)) return null
  const prs = list.filter(isObject).filter((p) => typeof p.number === 'number' && p.url)
  // gh는 최근 것부터 준다. 그래도 번호가 가장 큰 것을 고른다
  prs.sort((a, b) => Number(b.number) - Number(a.number))
  const p = prs[0]
  if (!p) return null
  return {
    number: Number(p.number),
    url: str(p.url),
    state: prState(p.state),
    headRefOid: str(p.headRefOid),
    baseRefName: str(p.baseRefName),
    isDraft: p.isDraft === true,
    mergedAt: typeof p.mergedAt === 'string' && p.mergedAt !== '' ? p.mergedAt : null,
  }
}

export function checkBucket(state: string): PrCheck['bucket'] {
  switch (state) {
    case 'SUCCESS':
      return 'pass'
    case 'SKIPPED':
    case 'NEUTRAL':
      return 'skipping'
    case 'ERROR':
    case 'FAILURE':
    case 'TIMED_OUT':
    case 'ACTION_REQUIRED':
    case 'STARTUP_FAILURE':
      return 'fail'
    case 'CANCELLED':
      return 'cancel'
    default:
      // EXPECTED, REQUESTED, WAITING, QUEUED, PENDING, IN_PROGRESS, STALE
      return 'pending'
  }
}

/**
 * statusCheckRollup을 체크 목록으로. 같은 체크(StatusContext는 context, CheckRun은 워크플로·이름)가 여럿이면 시작이 가장
 * 늦은 것만 남긴다(gh의 eliminateDuplicates). 출처: v2 app/src/core/pr.ts checksOf
 */
export function rollupChecks(rollup: unknown): PrCheck[] {
  const latest = new Map<string, { check: PrCheck; startedAt: string }>()
  for (const raw of Array.isArray(rollup) ? rollup : []) {
    if (!isObject(raw)) continue
    const isStatus = raw.__typename === 'StatusContext' || typeof raw.context === 'string'
    let check: PrCheck
    if (isStatus) {
      const state = str(raw.state) || 'PENDING'
      check = { name: str(raw.context) || '(이름 없음)', state, bucket: checkBucket(state) }
    } else {
      const status = str(raw.status)
      const state = status === 'COMPLETED' ? str(raw.conclusion) : status
      const workflow = str(raw.workflowName)
      const name = str(raw.name) || '(이름 없음)'
      check = { name: workflow ? `${workflow} / ${name}` : name, state, bucket: checkBucket(state) }
    }
    const key = `${isStatus ? 'status' : 'check'}:${check.name}`
    const startedAt = str(raw.startedAt)
    const prior = latest.get(key)
    if (!prior || startedAt > prior.startedAt) latest.set(key, { check, startedAt })
  }
  return [...latest.values()].map((x) => x.check)
}

/** PR의 머지 가능 상태와 체크. 읽지 못하면 `{ ok: false, error }` */
export async function prStatus(repoDir: string, number: number): Promise<PrStatus> {
  if (!isPrNumber(number)) return { ok: false, error: `PR 번호가 아님: ${String(number)}` }
  const r = await gh(repoDir, [
    'pr',
    'view',
    String(number),
    '--json',
    'mergeable,mergeStateStatus,statusCheckRollup,headRefOid,state',
  ])
  if (!r.ok) return r
  const j = parseJson(r.stdout)
  if (!isObject(j))
    return { ok: false, error: `gh pr view의 출력을 읽지 못함: ${r.stdout.slice(0, 200)}` }
  return {
    ok: true,
    state: prState(j.state),
    headRefOid: str(j.headRefOid),
    mergeable: str(j.mergeable) || 'UNKNOWN',
    mergeStateStatus: str(j.mergeStateStatus) || 'UNKNOWN',
    checks: rollupChecks(j.statusCheckRollup),
  }
}

/**
 * PR을 머지한다. `--match-head-commit`으로 headSha가 아니면 GitHub가 거절한다(그사이 push된 커밋을 머지하지 않게).
 * 브랜치는 지우지 않는다
 */
export async function mergePr(
  repoDir: string,
  number: number,
  headSha: string,
  method: MergeMethod,
): Promise<{ ok: boolean; error?: string }> {
  if (!isPrNumber(number)) return { ok: false, error: `PR 번호가 아님: ${String(number)}` }
  if (!/^[0-9a-f]{40,64}$/.test(headSha)) return { ok: false, error: `head SHA가 아님: ${headSha}` }
  const r = await gh(repoDir, [
    'pr',
    'merge',
    String(number),
    `--${method}`,
    '--match-head-commit',
    headSha,
  ])
  return r.ok ? { ok: true } : { ok: false, error: r.error }
}

/** gh api가 받는 경로 조각. 브랜치 이름의 '/'는 그대로 두고 나머지는 %로 바꾼다 */
function branchPath(branch: string): string {
  return branch.split('/').map(encodeURIComponent).join('/')
}

const PROTECTING_RULES = new Set(['pull_request', 'required_status_checks', 'merge_queue'])

/**
 * 기준 브랜치의 서버 쪽 보호. 브랜치 보호(`repos/{owner}/{repo}/branches/<b>`의 protected,
 * protection.required_status_checks)와 규칙 모음(`repos/{owner}/{repo}/rules/branches/<b>`의 required_status_checks,
 * merge_queue, pull_request)을 합친다. 둘 중 하나라도 못 읽으면 null
 */
export async function serverProtection(
  repoDir: string,
  baseBranch: string,
): Promise<ServerProtection | null> {
  const b = branchPath(baseBranch)
  const [branchRes, rulesRes] = await Promise.all([
    gh(repoDir, ['api', `repos/{owner}/{repo}/branches/${b}`]),
    gh(repoDir, ['api', `repos/{owner}/{repo}/rules/branches/${b}`]),
  ])
  if (!branchRes.ok || !rulesRes.ok) return null
  const branch = parseJson(branchRes.stdout)
  const rules = parseJson(rulesRes.stdout)
  if (!isObject(branch) || !Array.isArray(rules)) return null
  return protectionOf(branch, rules)
}

/** 두 API 응답을 ServerProtection으로. 시험과 serverProtection이 쓴다 */
export function protectionOf(branch: Record<string, unknown>, rules: unknown[]): ServerProtection {
  const protection = isObject(branch.protection) ? branch.protection : {}
  const classic = isObject(protection.required_status_checks)
    ? protection.required_status_checks
    : null
  const classicChecks =
    classic !== null &&
    classic.enforcement_level !== 'off' &&
    ((Array.isArray(classic.contexts) && classic.contexts.length > 0) ||
      (Array.isArray(classic.checks) && classic.checks.length > 0))
  const ruleList = rules.filter(isObject)
  const params = (r: Record<string, unknown>) => (isObject(r.parameters) ? r.parameters : {})
  const ruleChecks = ruleList.filter((r) => r.type === 'required_status_checks')
  return {
    branch_protected:
      branch.protected === true ||
      ruleList.some((r) => typeof r.type === 'string' && PROTECTING_RULES.has(r.type)),
    required_checks:
      classicChecks ||
      ruleChecks.some((r) => {
        const list = params(r).required_status_checks
        return Array.isArray(list) && list.length > 0
      }),
    merge_queue: ruleList.some((r) => r.type === 'merge_queue'),
    up_to_date_required:
      (classicChecks && classic?.strict === true) ||
      ruleChecks.some((r) => params(r).strict_required_status_checks_policy === true),
  }
}

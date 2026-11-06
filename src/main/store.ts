// 앱 저장소 (docs/m2-modules.md 3절 store.ts). $RELAY_HOME(기본 ~/.relay-v3) 아래:
//   projects.json                         프로젝트 목록과 설정
//   works/<id>/work.json                  Work의 상태(WorkRecord)
//   works/<id>/request.md                 요청 글과 일의 성격 제안
//   works/<id>/contract.json              승인된 계약
//   works/<id>/contract.<단위>.json       단위 브랜치(V22)를 잴 때 쓰는 계약의 조각
//   works/<id>/evidence/<자리>.json        단위 브랜치(V22)의 내보내기(unit-<단위>)와 통합(integration)의 마지막 묶음
//   works/<id>/events.jsonl               훅과 사람의 동작 기록(한 줄에 하나)
//   works/<id>/settings.json, instructions.md, mcp.json   세션에 주는 파일
//   works/<id>/feedback/<n>.md            쉬는 세션에 준 되먹임(V24, 자료)
//   ledger.jsonl                          실적 장부(그림자)
//   worktrees/<id>                        Work의 git worktree
// 파일을 통째로 쓸 때는 임시 파일에 쓴 뒤 rename한다(반쯤 쓴 파일이 남지 않게). 줄 기록은 끝에 덧붙인다.
// 파일은 0600, 만드는 폴더는 0700이다(mcp.json의 control 토큰, 요청과 계약을 같은 기계의 다른 사용자가 읽지 못하게).
// 시계와 id는 주입한다.

import { randomBytes } from 'node:crypto'
import { appendFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { readJson, relayHome } from '../adapters/store.ts'
import { parseLedger, type LedgerEntry } from '../core/ledger.ts'
import type { Contract, GateResult, GroundingCheck, M3Switches } from '../core/types.ts'
import type { WorkState } from '../core/work.ts'
import { M3_OFF } from '../engine/m3.ts'
import type { EndMemo, EndPending, FeedbackRound, PrInfo, ProjectSettings } from '../shared/api.ts'

export interface ProjectRecord {
  id: string
  path: string
  name: string
  defaultBranch: string | null
  settings: ProjectSettings
  added_at: string
}

/**
 * 내보내기 하나(V22): PR, 리뷰, 관문, 장부가 따로 있는 브랜치. one_branch는 Work 브랜치 하나(unit null, 계약 전체),
 * branch_per_unit은 단위마다 `<Work 브랜치>--<단위>`(계약의 조각)다
 */
export interface ExportRecord {
  /** 단위. Work 브랜치의 내보내기(one_branch)는 null */
  unit: string | null
  branch: string
  pr: PrInfo | null
  /** 마지막 증거 묶음 파일 */
  evidence_path: string | null
  gate: GateResult | null
  /**
   * 지금 묶음을 내보내기(리뷰 포함)로 쟀으면 그 head(V23). 내보내기가 아닌 재기가 묶음을 바꾸거나 내보내기 리뷰가 도는
   * 동안은 null: 같은 head로 되돌아와 다시 잰 묶음이 내보내기로 보이지 않게
   */
  exported_head: string | null
  /**
   * 미리 리뷰(V23, works-review.ts)를 부른 수. 내보내기마다 4번까지다(처음 1번과 되먹임 라운드 상한 3, works-feedback.ts
   * PREPARED_MAX)
   */
  prepared_reviews: number
}

export interface WorkRecord {
  version: 1
  id: string
  project: string
  title: string
  state: WorkState
  /** 작업 브랜치 */
  branch: string
  /** 기준 브랜치 이름(PR의 base, 지킬 브랜치) */
  base: string
  /** worktree를 만든 ref(origin/<base> 또는 <base>). check는 이것과 head의 공통 조상을 base로 쓴다 */
  base_ref: string
  worktree: string
  session_id: string
  /** 이 session_id의 세션에서 훅을 받은 적이 있나. 없으면 그 대화가 없으니 [다시 열기]는 --resume이 아닌 새 세션이다 */
  session_started: boolean
  /** 지침이 준 계약 id */
  contract_id: string
  hint: string | null
  created_at: string
  updated_at: string
  pending_contract: Contract | null
  pending_change: string | null
  groundings: GroundingCheck[] | null
  /**
   * 내보내기(V22): 승인된 계약의 전달 방식으로 정한다(one_branch는 Work 브랜치 하나, branch_per_unit은 단위 브랜치마다). 옛
   * 기록의 pr·evidence_path·gate·exported_head·prepared_reviews는 읽을 때 Work 브랜치의 내보내기 하나로 옮긴다(upgradeWork)
   */
  exports: ExportRecord[]
  /** branch_per_unit의 통합 증거(V22: Work 브랜치를 계약 전체로 잰 결정론 증거) 묶음 파일. 아니면 null */
  integration_path: string | null
  error: string | null
  /** 세션이 멈춘 사이 사람이 답한 것. 다음 재개의 프롬프트로 전한다 */
  notice: string | null
  /** [끝내기]의 걸린 끝이나 상자(V25, works-end.ts). 옛 기록에는 없다(읽을 때 null) */
  end_pending: EndPending | null
  /** [끝내기]로 끝낼 때 남은 리뷰 메모(V37, works-end.ts). 끝내기 전이나 다른 길로 끝났으면 빈 것. 옛 기록에는 없다(읽을 때 빈 것) */
  end_memos: EndMemo[]
  /**
   * 쉬는 세션에 준 되먹임(V24, works-feedback.ts). rounds는 relay가 저절로 보낸 라운드(두 종류를 합쳐 Work마다 3까지), sent는
   * 보낸 파일마다 한 줄(사람의 [세션에 넘기기]도). 옛 기록에는 없다(읽을 때 빈 것)
   */
  feedback: { rounds: number; sent: FeedbackRound[] }
  /** M3 장치의 스위치(V38). Work를 만들 때 정해 끝까지 지닌다. 옛 기록(M3 앞)에는 없다(읽을 때 모두 끔) */
  m3: M3Switches
  /**
   * 기록 안 된 나빠짐(M3b): 새 Work를 만들 때 실적 장부의 앞 기록과 기준 브랜치를 견줘 찾은 것(request.md 끝과 [계약]에 보인다).
   * 장치가 꺼졌거나 없으면 빈 것. 옛 기록에는 없다(읽을 때 빈 것)
   */
  unrecorded: string[]
}

export type WorkFile =
  | 'work.json'
  | 'request.md'
  | 'contract.json'
  | `contract.${string}.json`
  | 'events.jsonl'
  | 'settings.json'
  | 'instructions.md'
  | 'mcp.json'

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function checkId(id: string): string {
  if (!SAFE_ID.test(id) || id.includes('..')) throw new Error(`잘못된 Work id: '${id}'`)
  return id
}

/** 만드는 파일과 폴더의 권한(Windows는 무시한다) */
const FILE_MODE = 0o600
const DIR_MODE = 0o700

async function atomicWrite(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: DIR_MODE })
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  try {
    await writeFile(tmp, text, { encoding: 'utf8', mode: FILE_MODE })
    await rename(tmp, path)
  } catch (e) {
    await rm(tmp, { force: true })
    throw e
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Work 브랜치의 내보내기(one_branch) 하나 */
export function branchExport(branch: string): ExportRecord {
  return {
    unit: null,
    branch,
    pr: null,
    evidence_path: null,
    gate: null,
    exported_head: null,
    prepared_reviews: 0,
  }
}

/** 옛 기록(V22 앞)의 내보내기 칸 */
type OldRecord = Partial<Pick<ExportRecord, 'pr' | 'evidence_path' | 'gate' | 'exported_head'>> & {
  prepared_reviews?: number
  /** V28(제출 때 기준 확인)의 칸. V32에서 뺐다: 읽을 때 버린다 */
  probe?: unknown
}

/**
 * 읽은 기록에 뒤에 더한 칸을 채운다: 옛 기록에는 없는 칸(세션이 떴던 것으로 보고 --resume, 빈 되먹임 등)과, V22 앞의 기록이
 * Work에 둔 PR·증거·관문·내보낸 head·미리 리뷰 수를 Work 브랜치의 내보내기 하나로 옮긴다. 뺀 장치의 칸(V28 probe)은 버린다
 */
export function upgradeWork(raw: WorkRecord): WorkRecord {
  const old = raw as WorkRecord & OldRecord
  const { pr, evidence_path, gate, exported_head, prepared_reviews, ...rec } = old
  delete rec.probe
  const exports = rec.exports ?? [
    {
      ...branchExport(rec.branch),
      pr: pr ?? null,
      evidence_path: evidence_path ?? null,
      gate: gate ?? null,
      exported_head: exported_head ?? null,
      prepared_reviews: prepared_reviews ?? 0,
    },
  ]
  return {
    ...rec,
    notice: rec.notice ?? null,
    session_started: rec.session_started ?? true,
    end_pending: rec.end_pending ?? null,
    end_memos: rec.end_memos ?? [],
    feedback: rec.feedback ?? { rounds: 0, sent: [] },
    exports,
    integration_path: rec.integration_path ?? null,
    m3: { ...M3_OFF, ...rec.m3 },
    unrecorded: rec.unrecorded ?? [],
  }
}

export class Store {
  readonly home: string
  readonly now: () => string
  readonly newId: () => string
  /**
   * 같은 파일에 쓰는 일을 차례로(늦게 부른 쓰기가 먼저 끝나 덮이지 않게). 읽기는 그 파일에 앞서 줄 선 쓰기를 기다린다:
   * Works는 기록(events.jsonl)을 기다리지 않고 남기므로, 바로 뒤에 읽어도 마지막 기록을 놓치지 않게
   */
  private readonly chains = new Map<string, Promise<void>>()

  constructor(o: { home?: string; now: () => string; newId: () => string }) {
    this.home = o.home ?? relayHome(process.env)
    this.now = o.now
    this.newId = o.newId
  }

  get projectsFile(): string {
    return join(this.home, 'projects.json')
  }

  get ledgerFile(): string {
    return join(this.home, 'ledger.jsonl')
  }

  workDir(id: string): string {
    return join(this.home, 'works', checkId(id))
  }

  workPath(id: string, name: WorkFile): string {
    return join(this.workDir(id), name)
  }

  /** 되먹임 파일(V24): works/<id>/feedback/<n>.md */
  feedbackPath(id: string, n: number): string {
    return join(this.workDir(id), 'feedback', `${n}.md`)
  }

  /** 단위 브랜치(V22)의 내보내기(unit-<단위>)와 통합(integration)의 마지막 묶음: works/<id>/evidence/<자리>.json */
  bundlePath(id: string, slot: string): string {
    return join(this.workDir(id), 'evidence', `${slot}.json`)
  }

  /** Work의 git worktree 자리 */
  worktreeDir(id: string): string {
    return join(this.home, 'worktrees', checkId(id))
  }

  private serial(path: string, job: () => Promise<void>): Promise<void> {
    const next = (this.chains.get(path) ?? Promise.resolve()).catch(() => {}).then(job)
    this.chains.set(path, next)
    void next.finally(() => {
      if (this.chains.get(path) === next) this.chains.delete(path)
    })
    return next
  }

  /** 이 파일에 줄 선 쓰기가 끝날 때까지(실패는 삼킨다) */
  private async written(path: string): Promise<void> {
    await this.chains.get(path)?.catch(() => {})
  }

  /** 글을 통째로 쓴다(임시 파일 뒤 rename) */
  writeFileAtomic(path: string, text: string): Promise<void> {
    return this.serial(path, () => atomicWrite(path, text))
  }

  // ── 프로젝트 ───────────────────────────────────────────────────────────────

  async readProjects(): Promise<ProjectRecord[]> {
    await this.written(this.projectsFile)
    const list = await readJson<unknown>(this.projectsFile)
    if (!Array.isArray(list)) return []
    return list.filter(
      (p): p is ProjectRecord =>
        isObject(p) &&
        typeof p.id === 'string' &&
        typeof p.path === 'string' &&
        isObject(p.settings),
    )
  }

  writeProjects(list: ProjectRecord[]): Promise<void> {
    return this.writeFileAtomic(this.projectsFile, `${JSON.stringify(list, null, 2)}\n`)
  }

  // ── Work ───────────────────────────────────────────────────────────────────

  async listWorkIds(): Promise<string[]> {
    try {
      const names = await readdir(join(this.home, 'works'))
      return names.filter((n) => SAFE_ID.test(n)).sort()
    } catch {
      return []
    }
  }

  async readWork(id: string): Promise<WorkRecord | null> {
    const path = this.workPath(id, 'work.json')
    await this.written(path)
    const w = await readJson<unknown>(path).catch(() => null)
    if (!isObject(w) || w.version !== 1 || w.id !== id || typeof w.worktree !== 'string')
      return null
    return w as unknown as WorkRecord
  }

  writeWork(rec: WorkRecord): Promise<void> {
    // 부른 때의 모양을 쓴다(뒤에 바뀐 값이 섞이지 않게)
    const text = `${JSON.stringify(rec, null, 2)}\n`
    return this.writeFileAtomic(this.workPath(rec.id, 'work.json'), text)
  }

  writeText(id: string, name: WorkFile, text: string): Promise<void> {
    return this.writeFileAtomic(this.workPath(id, name), text)
  }

  writeJson(id: string, name: WorkFile, value: unknown): Promise<void> {
    return this.writeText(id, name, `${JSON.stringify(value, null, 2)}\n`)
  }

  async readText(id: string, name: WorkFile): Promise<string | null> {
    const path = this.workPath(id, name)
    await this.written(path)
    return readFile(path, 'utf8').catch(() => null)
  }

  async removeFile(id: string, name: WorkFile): Promise<void> {
    const path = this.workPath(id, name)
    await this.serial(path, () => rm(path, { force: true }))
  }

  /** events.jsonl에 한 줄. ts는 시계에서 */
  appendEvent(id: string, event: Record<string, unknown>): Promise<void> {
    const path = this.workPath(id, 'events.jsonl')
    const line = `${JSON.stringify({ ts: this.now(), ...event })}\n`
    return this.serial(path, async () => {
      await mkdir(dirname(path), { recursive: true, mode: DIR_MODE })
      await appendFile(path, line, { encoding: 'utf8', mode: FILE_MODE })
    })
  }

  async readEvents(id: string): Promise<Record<string, unknown>[]> {
    const text = (await this.readText(id, 'events.jsonl')) ?? ''
    const out: Record<string, unknown>[] = []
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try {
        const v: unknown = JSON.parse(line)
        if (isObject(v)) out.push(v)
      } catch {
        // 끊긴 줄
      }
    }
    return out
  }

  // ── 장부 ───────────────────────────────────────────────────────────────────

  appendLedger(entry: LedgerEntry): Promise<void> {
    const path = this.ledgerFile
    const line = `${JSON.stringify(entry)}\n`
    return this.serial(path, async () => {
      await mkdir(dirname(path), { recursive: true, mode: DIR_MODE })
      await appendFile(path, line, { encoding: 'utf8', mode: FILE_MODE })
    })
  }

  async readLedger(): Promise<LedgerEntry[]> {
    await this.written(this.ledgerFile)
    const text = await readFile(this.ledgerFile, 'utf8').catch(() => '')
    return parseLedger(text)
  }
}

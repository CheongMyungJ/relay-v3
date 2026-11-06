// 프로젝트(레포)의 기록·설정과 품질 기준 상태 (docs/m2-modules.md 3절 works.ts의 addProject·updateSettings·draftQuality,
// V20). works.ts가 600줄을 넘지 않게 나눴다. Electron을 모른다.
// 품질 기준 상태는 기본 브랜치(origin/<기본>이 있으면 그것)의 .relay/quality.json으로 정한다: 관문은 base의 기준으로
// 재므로(V9) 작업 트리에만 있는 파일은 쓰이지 않는다. [초안 만들기]는 작업 트리에 쓰고, 커밋은 사람이 한다.

import { access } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { git } from '../adapters/exec.ts'
import { defaultBase, repoRoot, showFile } from '../adapters/git.ts'
import { repoKey } from '../adapters/store.ts'
import { acceptedUnrecorded } from '../engine/ledger.ts'
import { parseQuality } from '../core/quality.ts'
import { QUALITY_PATH } from '../engine/check.ts'
import { writeDraft } from '../engine/init.ts'
import { m3Settings } from '../engine/m3.ts'
import {
  DEFAULT_SETTINGS,
  EVENTS,
  type DraftQualityResult,
  type ProjectSettings,
  type SettingsInput,
  type ProjectView,
  type QualityState,
} from '../shared/api.ts'
import type { ProjectRecord } from './store.ts'
import type { WorksDeps } from './works-types.ts'
import { baseRef } from './works-worktree.ts'

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** 저장된 설정을 읽는다. 없거나 틀린 칸은 기본값 */
export function settingsOf(raw: unknown): ProjectSettings {
  const s = isObject(raw) ? raw : {}
  const pick = <K extends keyof ProjectSettings>(k: K, ok: (v: unknown) => boolean) =>
    (ok(s[k]) ? s[k] : DEFAULT_SETTINGS[k]) as ProjectSettings[K]
  return {
    auto_merge: pick('auto_merge', (v) => typeof v === 'boolean'),
    min_shadow: pick('min_shadow', (v) => Number.isInteger(v) && (v as number) >= 0),
    review: pick('review', (v) => v === 'all' || v === 'auto_only'),
    merge_method: pick('merge_method', (v) => v === 'merge' || v === 'squash' || v === 'rebase'),
    question_mode: pick('question_mode', (v) => v === 'confirm_each' || v === 'draft_first'),
    m3: m3Settings(s['m3']),
    trailer: pick('trailer', (v) => typeof v === 'boolean'),
  }
}

/** ref의 품질 기준: 있음, 없음(파일이 없음), 깨짐(parseQuality 실패) */
export async function qualityState(root: string, ref: string): Promise<QualityState> {
  const sha = (await git(['rev-parse', ref], root)).trim()
  const text = await showFile(root, sha, QUALITY_PATH)
  if (text === null) return 'missing'
  return parseQuality(text).ok ? 'present' : 'invalid'
}

interface Quality {
  state: QualityState
  draft: boolean
  /** 읽은 ref(origin/<기본>이 있으면 그것). 기본 브랜치를 모르면 null */
  ref: string | null
}

/** 프로젝트의 품질 기준 상태와, 기본 브랜치에 없을 때 작업 트리에 초안이 있는지 */
async function qualityOf(p: ProjectRecord): Promise<Quality> {
  const ref = p.defaultBranch ? await baseRef(p.path, p.defaultBranch).catch(() => null) : null
  const state =
    ref === null ? 'missing' : await qualityState(p.path, ref).catch(() => 'missing' as const)
  const draft =
    state === 'missing' &&
    (await access(join(p.path, QUALITY_PATH)).then(
      () => true,
      () => false,
    ))
  return { state, draft, ref }
}

export class ProjectDesk {
  private readonly deps: WorksDeps
  private readonly records = new Map<string, ProjectRecord>()
  private readonly quality = new Map<string, Quality>()
  /** 받아들였지만 빚으로 기록하지 않은 내보내기의 수(M3b, 실적 장부) */
  private readonly unrecorded = new Map<string, number>()

  constructor(deps: WorksDeps) {
    this.deps = deps
  }

  /** 저장소에서 프로젝트를 읽고 품질 기준 상태를 잰다 */
  async load(): Promise<void> {
    for (const p of await this.deps.store.readProjects())
      this.records.set(p.id, { ...p, settings: settingsOf(p.settings) })
    await this.refresh()
  }

  get(id: string): ProjectRecord | undefined {
    return this.records.get(id)
  }

  view(p: ProjectRecord): ProjectView {
    return {
      id: p.id,
      path: p.path,
      name: p.name,
      defaultBranch: p.defaultBranch,
      settings: { ...p.settings },
      quality: this.quality.get(p.id)?.state ?? 'missing',
      qualityDraft: this.quality.get(p.id)?.draft ?? false,
      qualityRef: this.quality.get(p.id)?.ref ?? null,
      unrecordedDebt: this.unrecorded.get(p.id) ?? 0,
    }
  }

  views(): ProjectView[] {
    return [...this.records.values()].map((p) => this.view(p))
  }

  private emit(): void {
    this.deps.emit(EVENTS.projects, this.views())
  }

  private async save(): Promise<void> {
    await this.deps.store.writeProjects([...this.records.values()])
    this.emit()
  }

  async add(path: string): Promise<ProjectView> {
    let root: string
    try {
      root = await repoRoot(path)
    } catch {
      throw new Error(`git 레포가 아님: ${path}`)
    }
    const id = repoKey(root)
    const existing = this.records.get(id)
    if (existing) {
      await this.refresh(id)
      return this.view(existing)
    }
    const base = await defaultBase(root).catch(() => null)
    const p: ProjectRecord = {
      id,
      path: root,
      name: basename(root),
      defaultBranch: base === null ? null : base.replace(/^origin\//, '').replace(/^HEAD$/, ''),
      settings: { ...DEFAULT_SETTINGS },
      added_at: this.deps.now(),
    }
    if (base === 'origin/HEAD') {
      const ref = await git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], root).catch(
        () => '',
      )
      p.defaultBranch = ref.trim().replace(/^origin\//, '') || null
    }
    this.records.set(id, p)
    this.quality.set(id, await qualityOf(p))
    await this.save()
    return this.view(p)
  }

  async updateSettings(projectId: string, s: SettingsInput): Promise<ProjectView> {
    const p = this.records.get(projectId)
    if (!p) throw new Error(`프로젝트가 없음: ${projectId}`)
    // m3은 장치마다 덮는다(준 장치만 바뀐다). 모르는 장치나 참·거짓이 아닌 값은 잘못된 값이다
    const merged = { ...p.settings, ...s, m3: { ...p.settings.m3, ...s.m3 } }
    const checked = settingsOf(merged)
    const bad = (Object.keys(s) as (keyof ProjectSettings)[]).filter(
      (k) => k in checked && JSON.stringify(checked[k]) !== JSON.stringify(merged[k]),
    )
    if (bad.length > 0) throw new Error(`설정 값이 잘못됨: ${bad.join(', ')}`)
    p.settings = checked
    await this.save()
    return this.view(p)
  }

  /**
   * 품질 기준 상태와 장부의 '받아들였지만 기록하지 않음'(M3b)을 다시 잰다. id가 없으면 모든 프로젝트. 바뀌었으면 화면에
   * 알린다. 기본 브랜치에 커밋(origin이 있으면 push)한 기준은 다음에 잴 때(목록을 다시 읽을 때, 새 Work, 증거) 보인다
   */
  async refresh(id?: string): Promise<void> {
    const targets = id === undefined ? [...this.records.values()] : [this.records.get(id)]
    const ledger = await this.deps.store.readLedger()
    let changed = false
    for (const p of targets) {
      if (!p) continue
      const n = acceptedUnrecorded(ledger, p.id)
      if (this.unrecorded.get(p.id) !== n) changed = true
      this.unrecorded.set(p.id, n)
      const q = await qualityOf(p)
      const before = this.quality.get(p.id)
      if (before?.state === q.state && before.draft === q.draft && before.ref === q.ref) continue
      this.quality.set(p.id, q)
      changed = true
    }
    if (changed) this.emit()
  }

  /** [초안 만들기]: core draftQuality의 초안을 프로젝트의 작업 트리에 쓴다. 이미 있으면 덮지 않는다 */
  async draft(projectId: string): Promise<DraftQualityResult> {
    const p = this.records.get(projectId)
    if (!p) throw new Error(`프로젝트가 없음: ${projectId}`)
    const r = await writeDraft(p.path)
    await this.refresh(projectId)
    return r
  }
}

// 품질 기준 초안 (docs/m1-modules.md engine init.ts, V19·V20·V60~V62). `relay init`과 앱의 [초안 만들기]가 함께 쓴다.
// 레포의 파일 목록(git이 아는 파일과 무시하지 않는 새 파일)과 작업 트리의 매니페스트·설정 글로 언어별 초안(draft.ts)을 짜고,
// 드라이런(dry-run.ts)으로 지금 커밋에서 한 번 돌려 본 뒤 안 된 명령을 뺀다. 작업 트리에 쓰기만 하고 커밋하지 않는다.

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { git } from '../adapters/exec.ts'
import { matchAny } from '../core/glob.ts'
import { draftQuality } from '../core/quality.ts'
import type { QualityConfig } from '../core/types.ts'
import { QUALITY_PATH } from './check.ts'
import { applyAnswers, planDraft, type DraftAnswers, type DraftPlan } from './draft.ts'
import { dryRun, type DryRun } from './dry-run.ts'
import { SCAN_EXCLUDE } from './languages.ts'
import { manifestLang, type RepoScan } from './recipes.ts'

/** 읽는 설정 글의 상한(바이트). 매니페스트는 작다 */
const MAX_TEXT_BYTES = 1_000_000

async function listFiles(root: string): Promise<string[]> {
  const listed = await git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], root)
  return listed.split('\0').filter((f) => f !== '')
}

/** 레시피가 읽는 글: 매니페스트(깊이 둘까지), .config/nextest.toml, CI 워크플로 */
function wanted(path: string): boolean {
  if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(path)) return true
  if (path.split('/').length > 4 || matchAny(path, [...SCAN_EXCLUDE])) return false
  return manifestLang(path) !== null || path.endsWith('.config/nextest.toml')
}

/** 레포 루트(작업 트리)를 훑는다 */
export async function scanRepo(root: string): Promise<RepoScan> {
  const files = await listFiles(root)
  const texts = new Map<string, string>()
  for (const f of files.filter(wanted)) {
    const full = join(root, f)
    const st = await stat(full).catch(() => null)
    if (st === null || !st.isFile() || st.size > MAX_TEXT_BYTES) continue
    const text = await readFile(full, 'utf8').catch(() => null)
    if (text !== null) texts.set(f, text)
  }
  return { files, texts }
}

export async function planFor(root: string): Promise<DraftPlan> {
  return planDraft(await scanRepo(root))
}

/** 레포 루트(작업 트리)의 품질 기준 초안(돌려 보지 않은 것) */
export async function draftFor(root: string): Promise<QualityConfig> {
  return (await planFor(root)).config
}

/**
 * JS만 보는 옛 초안(core draftQuality, 래칫 둘을 더하기 전). 평가 기록(M2·M2.1)의 품질 기준 덧씌우기를 그때와 같게 다시
 * 만들 때 쓴다(scripts/review-replay.ts)
 */
export async function jsDraftFor(root: string): Promise<QualityConfig> {
  const files = await listFiles(root)
  const packageJson = await readFile(join(root, 'package.json'), 'utf8').catch(() => undefined)
  return draftQuality(packageJson === undefined ? { files } : { packageJson, files })
}

/** 초안의 글: 들여 쓴 JSON과 끝 줄바꿈 */
export function draftText(q: QualityConfig): string {
  return `${JSON.stringify(q, null, 2)}\n`
}

/** [초안 만들기]의 결과: 짠 초안, 드라이런, 드라이런으로 고친 초안 */
export interface DraftReport {
  plan: DraftPlan
  /** 돌려 보지 않았으면(relay init --no-try) null */
  dry: DryRun | null
  /** 쓸 초안(답을 넣기 전) */
  config: QualityConfig
  /** 작업 트리에 이미 .relay/quality.json이 있다(쓰면 덮지 않는다) */
  exists: boolean
}

export async function tryDraft(
  root: string,
  home: string,
  o: { run?: boolean; lockWaitMs?: number } = {},
): Promise<DraftReport> {
  const plan = await planFor(root)
  const dry =
    o.run === false
      ? null
      : await dryRun({
          root,
          home,
          config: plan.config,
          ...(o.lockWaitMs === undefined ? {} : { lockWaitMs: o.lockWaitMs }),
        })
  const exists = await stat(join(root, QUALITY_PATH)).then(
    () => true,
    () => false,
  )
  return { plan, dry, config: dry?.config ?? plan.config, exists }
}

/** 작업 트리에 `.relay/quality.json`으로 초안을 쓴다. 이미 있으면 덮지 않고 written false. 주지 않으면 돌려 보지 않은 초안 */
export async function writeDraft(
  root: string,
  config?: QualityConfig,
  answers: DraftAnswers = {},
): Promise<{ written: boolean; path: string }> {
  const path = join(root, QUALITY_PATH)
  const text = draftText(applyAnswers(config ?? (await draftFor(root)), answers))
  await mkdir(dirname(path), { recursive: true })
  try {
    await writeFile(path, text, { flag: 'wx' })
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return { written: false, path }
    throw e
  }
  return { written: true, path }
}

const secs = (ms: number | undefined) =>
  ms === undefined ? '' : ` (${(Math.round(ms / 100) / 10).toFixed(1)}초)`

/** 사람이 볼 요약(relay init --try·--write). 앱의 초안 화면과 같은 칸: 단위, 명령, 지금 값, 고칠 것, 묻는 것, 제안 */
export function summaryLines(r: DraftReport): string[] {
  const out: string[] = []
  const units = r.plan.units.map((u) => (u.dir === '.' ? u.label : `${u.label} ${u.dir}/`))
  out.push(`언어: ${units.length === 0 ? '찾지 못함(앱이 직접 재는 래칫만)' : units.join(', ')}`)
  if (r.dry === null) out.push('돌려 보지 않음(--no-try): 명령이 되는지 모른다')
  else {
    out.push(
      r.dry.head === null
        ? '돌려 보지 못함: 커밋이 없음'
        : `돌려 본 커밋: ${r.dry.head.slice(0, 7)} (check worktree에서 한 번씩)`,
    )
    if (r.dry.commands.length > 0) out.push('명령:')
    for (const c of r.dry.commands)
      out.push(
        `  ${c.ok ? '됨  ' : '안 됨'} ${c.id}: ${c.run}${secs(c.duration_ms)}${c.ok ? '' : ` — ${c.reason ?? ''}`}`,
      )
    if (r.dry.values.length > 0) out.push('지금 값:')
    for (const v of r.dry.values) out.push(`  ${v.id}: ${v.text}`)
    if (r.dry.fixes.length > 0) out.push('고칠 것(초안에서 뺌):')
    for (const f of r.dry.fixes) out.push(`  - ${f.id} \`${f.run}\`: ${f.reason ?? ''}`)
  }
  if (r.plan.questions.length > 0)
    out.push('묻는 것(답: --human-path, --boundary 앞:뒤, --ci-check):')
  r.plan.questions.forEach((q, i) => {
    const opts = q.options.map((o) => o.value)
    out.push(`  ${i + 1}. ${q.text}${opts.length > 0 ? `. 후보: ${opts.join(', ')}` : ''}`)
  })
  if (r.plan.suggestions.length > 0) out.push('제안(설치하지 않음):')
  for (const s of r.plan.suggestions) out.push(`  - ${s}`)
  return out
}

// 확인 실행기 (docs/m1-modules.md engine/check.ts).
// 품질 기준(V9), diff와 신호, 명령(V7), 래칫, 수용 시험과 줄 판정(V11), 예시 자료(V27)를 모아 증거 묶음을 쓴다.
// 어느 단계가 실패해도 묶음은 나온다. 못 모은 증거는 missing에 적는다.

import { readFile } from 'node:fs/promises'
import { contractHash, parseContract } from '../core/contract.ts'
import { buildDiffFacts } from '../core/diff.ts'
import { judgeLines } from '../core/lines.ts'
import { parseQuality, QUALITY_PATH, qualityHash } from '../core/quality.ts'
import { detectSignals, type ManifestPair, type SignalReport } from '../core/signals.ts'
import type {
  CommandEvidence,
  Contract,
  DiffFacts,
  EvidenceBundle,
  ExamplesFileCheck,
  GroundingCheck,
  LineVerdict,
  M3Switches,
  QualityConfig,
  RatchetResult,
} from '../core/types.ts'
import {
  defaultBase,
  diffRaw,
  dirsOf,
  lsTree,
  mergeBase,
  repoRoot,
  revParse,
  showFile,
} from '../adapters/git.ts'
import { evidencePath, repoKey, writeJson } from '../adapters/store.ts'
import { lockWorktrees } from '../adapters/worktrees.ts'
import {
  canonicalExamples,
  checkGroundings,
  committedExamples,
  judgeContract,
  testsOf,
} from './judge.ts'
import { measureRatchets } from './ratchets.ts'
import { coveredDebt } from './debt-record.ts'
import { checkKnowledge, knowledgeChanged } from './knowledge.ts'
import { checkPromote } from './promote.ts'
import { checkTidy } from './tidy.ts'
import { message, workspace } from './workspace.ts'

export { QUALITY_PATH }

/** M3 장치(V39)는 장치 이름 그대로 받는다(앱은 WorkRecord.m3를 펼쳐 준다) */
export interface CheckOptions extends Partial<M3Switches> {
  /** 레포 안의 아무 폴더 */
  repo: string
  /** 기준 ref. 기본은 기본 브랜치. head와의 공통 조상을 기준으로 쓴다 */
  base?: string
  /** 기본 HEAD */
  head?: string
  contractPath?: string
  /**
   * 예시 자료(V27)를 얹고 커밋된 것과 견줄 계약 파일. 없으면 contractPath. 단위 브랜치(V22)는 조각의 줄을 재지만, 세션이
   * 커밋하는 예시 자료는 앱이 계약 전체에서 쓴 파일 하나다
   */
  examplesContractPath?: string
  /** 요청 글 파일. 계약 근거의 request 인용을 확인한다 */
  requestPath?: string
  home: string
  /** 묶음의 created_at */
  now: string
  /** 참이면 base 캐시를 읽지 않고 다시 돈다 */
  rerun?: boolean
  /** 다른 check가 이 레포의 worktree를 쓰고 있을 때 기다리는 시간(밀리초). 기본 30분 */
  lockWaitMs?: number
  /** 지식 잇기(M3a, V38): 지식 확인(묶음의 knowledge)과 근거 knowledge 확인. 기본 꺼짐(knowledge null) */
  knowledge?: boolean
  /** 빚 기록(M3b, V40): 이 diff가 이미 둔 빚이 나빠진 래칫을 덮나(묶음의 debt_covered). 기본 꺼짐(null) */
  debt?: boolean
  /** 곁들일 정리(M3c, V41): 빚의 갚음과 정리 몫(묶음의 tidy). 계약은 examplesContractPath(없으면 contractPath). 기본 꺼짐(null) */
  tidy?: boolean
  /**
   * 규칙 승격(M3d, V42): 말로만 남은 규칙과 승격된 규칙의 늘어난 허용 목록(묶음의 knowledge.issues), tidy가 켜졌으면
   * rule_violation의 갚음. 기본 꺼짐
   */
  promote?: boolean
}

/** worktree 잠금을 기다리는 기본 시간 */
export const DEFAULT_LOCK_WAIT_MS = 30 * 60 * 1000

/** 레포나 ref를 찾지 못해 묶음을 만들 수 없음 (cli의 사용 오류) */
export class CheckInputError extends Error {
  constructor(text: string) {
    super(text)
    this.name = 'CheckInputError'
  }
}

export async function check(opts: CheckOptions): Promise<EvidenceBundle> {
  const { root, base, head } = await resolveRefs(opts)
  const missing: string[] = []
  const quality = await loadQuality(root, base, head, missing)
  const q = quality.config
  const diff = await readDiff(root, base, head, missing)
  const report = await findSignals(root, diff, q ?? defaultQuality(), missing)
  const contract = await loadContract(opts.contractPath, missing)
  const whole =
    opts.examplesContractPath === undefined
      ? contract
      : await loadContract(opts.examplesContractPath, missing)
  const request = await loadRequest(opts.requestPath, missing)

  const key = repoKey(root)
  // 한 레포의 worktree(base, head)는 한 번에 한 check만 쓴다. 섞인 출력이 다른 SHA의 증거가 되지 않게
  let release: (() => Promise<void>) | null = null
  try {
    release = await lockWorktrees(opts.home, key, opts.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS)
  } catch (e) {
    missing.push(`worktree: ${message(e)}`)
  }
  const ws = workspace({
    home: opts.home,
    key,
    root,
    base,
    head,
    ...(q?.setup === undefined ? {} : { setup: q.setup }),
    rerun: opts.rerun === true,
    missing,
    blocked: release === null,
  })

  const commands: CommandEvidence[] = []
  let ratchets: RatchetResult[] = []
  let lines: LineVerdict[] | null = null
  let examplesFile: ExamplesFileCheck | null = null
  let groundings: GroundingCheck[] | null = null
  // 수용 시험은 계약의 예시 자료(정규 파일)를 얹어 돈다(V27)
  const examples = q !== null && whole !== null ? canonicalExamples(q, whole) : null
  try {
    // 4. 명령. 수용 시험도 명령으로 돈다(래칫 test_count가 있으면 base에서도)
    let acceptance: CommandEvidence | null = null
    let acceptanceStarted: number | null = null
    if (q !== null) {
      for (const spec of q.commands.fast)
        commands.push(await guarded(ws.command(spec, false), spec.id, missing))
      const spec = q.commands.acceptance
      if (spec !== undefined) {
        const counted = q.ratchets.some((r) => r.kind === 'test_count')
        const files = examples === null ? [] : [examples]
        acceptanceStarted = Date.now()
        acceptance = await guarded(ws.command(spec, counted, files), spec.id, missing)
        commands.push(acceptance)
        if (acceptance.head.length > 0 && testsOf(acceptance.head) === null)
          missing.push(`acceptance: JUnit을 읽지 못함 (${spec.junit ?? '경로 없음'})`)
      }
      for (const name of fullMissing(q)) missing.push(name)
    }

    // 6. 래칫. base worktree에 시험을 얹기 전에 돈다
    if (q !== null) {
      ratchets = await measureRatchets({
        q,
        ws,
        root,
        diff,
        acceptance,
        acceptanceStarted,
        missing,
      }).catch((e) => {
        missing.push(`래칫: ${message(e)}`)
        return []
      })
    }

    // 5. 계약 줄, 커밋된 예시 자료, 근거
    if (contract !== null) {
      lines = await judgeContract(contract, q, ws, diff, acceptance, examples, missing).catch(
        (e) => {
          missing.push(`줄 판정: ${message(e)}`)
          return judgeLines(contract, null, null)
        },
      )
      if (q !== null && whole !== null)
        examplesFile = await committedExamples(root, head, q, whole, missing)
      groundings = await checkGroundings(root, head, contract, request, opts.knowledge === true)
    }
  } finally {
    await release?.().catch(() => {})
  }
  const known =
    opts.knowledge === true
      ? await checkKnowledge(root, diff).catch((e) => {
          missing.push(`지식 확인: ${message(e)}`)
          return null
        })
      : null
  const promoted =
    opts.promote === true
      ? await checkPromote(root, diff, q).catch((e) => {
          missing.push(`규칙 승격 확인: ${message(e)}`)
          return null
        })
      : null
  // 두 장치가 한 칸에 문제를 둔다. 하나만 켜졌으면 그 장치의 문제만
  const knowledge =
    known === null && promoted === null
      ? null
      : {
          changed: known?.changed ?? knowledgeChanged(diff),
          issues: [...(known?.issues ?? []), ...(promoted ?? [])],
        }
  const paths = diff.files.map((f) => f.path)
  const debt =
    opts.debt === true
      ? await coveredDebt(root, head, paths, ratchets).catch((e) => {
          missing.push(`빚 확인: ${message(e)}`)
          return null
        })
      : null
  const tidy =
    opts.tidy === true
      ? await checkTidy(root, diff, q, whole, opts.promote === true ? commands : null).catch(
          (e) => {
            missing.push(`빚 갚음 확인: ${message(e)}`)
            return null
          },
        )
      : null

  const bundle: EvidenceBundle = {
    version: 1,
    repo: root,
    base,
    head,
    created_at: opts.now,
    quality: { hash: quality.hash, from: quality.from },
    contract: contract === null ? null : { id: contract.id, hash: contractHash(contract) },
    commands,
    lines,
    examples_file: examplesFile,
    groundings,
    knowledge,
    debt_covered: debt,
    tidy,
    ratchets,
    signals: report.signals,
    diff: diffSummary(diff, report),
    review: null,
    claims: null,
    contract_change_requested: (contract?.change_requested?.trim() ?? '') !== '',
    missing,
  }
  try {
    await writeJson(evidencePath(opts.home, key, head), bundle)
  } catch (e) {
    missing.push(`증거 저장: ${message(e)}`)
  }
  return bundle
}

/** 명령 하나가 던져도(예상 못 한 파일 오류 등) 묶음은 나오게: 돌리지 못함으로 적는다 */
async function guarded(
  p: Promise<CommandEvidence>,
  id: string,
  missing: string[],
): Promise<CommandEvidence> {
  try {
    return await p
  } catch (e) {
    missing.push(`명령 ${id}: ${message(e)}`)
    return { id, outcome: 'not_run', head: [] }
  }
}

// ── 1. 레포와 ref ───────────────────────────────────────────────────────────

/** 레포 루트, head SHA, base(기준 ref와 head의 공통 조상). 찾지 못하면 CheckInputError */
async function resolveRefs(
  opts: Pick<CheckOptions, 'repo' | 'base' | 'head'>,
): Promise<{ root: string; base: string; head: string }> {
  let root: string
  try {
    root = await repoRoot(opts.repo)
  } catch {
    throw new CheckInputError(`git 레포가 아님: ${opts.repo}`)
  }
  const head = await resolveRef(root, opts.head ?? 'HEAD')
  let baseRef = opts.base
  if (baseRef === undefined) {
    try {
      baseRef = await defaultBase(root)
    } catch (e) {
      throw new CheckInputError(`${message(e)}. --base로 기준을 주세요`)
    }
  }
  const tip = await resolveRef(root, baseRef)
  try {
    return { root, base: await mergeBase(root, tip, head), head }
  } catch {
    throw new CheckInputError(`${baseRef}와 head의 공통 조상을 찾지 못함`)
  }
}

async function resolveRef(root: string, ref: string): Promise<string> {
  try {
    return await revParse(root, ref)
  } catch {
    throw new CheckInputError(`ref를 찾지 못함: ${ref}`)
  }
}

// ── 2. 품질 기준 (V9: base 것이 먼저) ───────────────────────────────────────

interface LoadedQuality {
  config: QualityConfig | null
  hash: string
  from: 'base' | 'head' | 'none'
}

async function loadQuality(
  root: string,
  base: string,
  head: string,
  missing: string[],
): Promise<LoadedQuality> {
  for (const [from, sha] of [
    ['base', base],
    ['head', head],
  ] as const) {
    let text: string | null
    try {
      text = await showFile(root, sha, QUALITY_PATH)
    } catch (e) {
      missing.push(`quality.json(${from}): ${message(e)}`)
      continue
    }
    if (text === null) continue
    const parsed = parseQuality(text)
    if (parsed.ok) return { config: parsed.value, hash: qualityHash(text), from }
    // base 것이 깨졌으면 head 것을 쓴다. 이때 diff가 quality.json을 바꾸므로 지킴 파일 신호가 난다
    missing.push(`quality.json(${from}): ${firstError(parsed.errors)}`)
  }
  return { config: null, hash: '', from: 'none' }
}

/** 품질 기준이 없을 때 신호에 쓰는 기본값(지킴 파일·시험 glob은 기본 목록) */
function defaultQuality(): QualityConfig {
  const parsed = parseQuality('{"version":1,"commands":{"fast":[]}}')
  if (!parsed.ok) throw new Error(parsed.errors.join(', '))
  return parsed.value
}

/** M1은 CI를 읽지 않고 전체 시험(full.local)은 내보낼 때 돈다. 선언됐으면 없는 증거다 */
function fullMissing(q: QualityConfig): string[] {
  const out: string[] = []
  if ((q.commands.full?.ci_checks ?? []).length > 0) out.push('ci')
  if ((q.commands.full?.local ?? []).length > 0) out.push('full')
  return out
}

// ── 3. diff와 신호 ──────────────────────────────────────────────────────────

async function readDiff(
  root: string,
  base: string,
  head: string,
  missing: string[],
): Promise<DiffFacts> {
  try {
    const raw = await diffRaw(root, base, head)
    return buildDiffFacts(base, head, raw.nameStatus, raw.numstat, raw.patch)
  } catch (e) {
    missing.push(`diff: ${message(e)}`)
    return { base, head, files: [] }
  }
}

const MANIFEST = /^(?:package\.json|requirements[^/]*\.txt|go\.mod|Cargo\.toml|pyproject\.toml)$/

const fileName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

async function findSignals(
  root: string,
  diff: DiffFacts,
  quality: QualityConfig,
  missing: string[],
): Promise<SignalReport> {
  let baseDirs = new Set<string>()
  try {
    baseDirs = dirsOf(await lsTree(root, diff.base))
  } catch (e) {
    // 비어 있으면 새 파일이 모두 새 모듈로 보인다(엄격한 쪽)
    missing.push(`base 파일 목록: ${message(e)}`)
  }
  const manifests: ManifestPair[] = []
  for (const f of diff.files) {
    if (!MANIFEST.test(fileName(f.path))) continue
    try {
      const from = f.status === 'R' || f.status === 'C' ? f.old_path : f.path
      const before =
        f.status === 'A' || from === undefined ? null : await showFile(root, diff.base, from)
      const after = f.status === 'D' ? null : await showFile(root, diff.head, f.path)
      manifests.push({ path: f.path, base: before, head: after })
    } catch (e) {
      missing.push(`매니페스트 ${f.path}: ${message(e)}`)
    }
  }
  return detectSignals({ diff, quality, baseDirs, manifests })
}

function diffSummary(diff: DiffFacts, report: SignalReport): EvidenceBundle['diff'] {
  const paths = new Set<string>()
  const binary: string[] = []
  let added = 0
  let deleted = 0
  for (const f of diff.files) {
    added += f.added
    deleted += f.deleted
    if (f.binary) binary.push(f.path)
    // 옮긴 파일의 옛 자리도 넣는다. 자동 조건 paths 밖에서 안으로 옮긴 것을 놓치지 않게
    paths.add(f.path)
    if (f.old_path !== undefined) paths.add(f.old_path)
  }
  return {
    files: diff.files.length,
    added,
    deleted,
    new_dependencies: report.new_dependencies,
    new_modules: report.new_modules,
    paths: [...paths],
    binary,
  }
}

// ── 계약과 요청 글 ──────────────────────────────────────────────────────────

async function readText(path: string): Promise<string | null> {
  return readFile(path, 'utf8').catch(() => null)
}

async function loadContract(path: string | undefined, missing: string[]): Promise<Contract | null> {
  if (path === undefined) return null
  const text = await readText(path)
  if (text === null) {
    missing.push(`계약: 파일을 읽지 못함 (${path})`)
    return null
  }
  const parsed = parseContract(text)
  if (parsed.ok) return parsed.value
  missing.push(`계약: ${firstError(parsed.errors)}`)
  return null
}

async function loadRequest(path: string | undefined, missing: string[]): Promise<string | null> {
  if (path === undefined) return null
  const text = await readText(path)
  if (text === null) missing.push(`요청 글: 파일을 읽지 못함 (${path})`)
  return text
}

function firstError(errors: string[]): string {
  const first = errors[0] ?? '읽지 못함'
  return errors.length > 1 ? `${first} 외 ${errors.length - 1}개` : first
}

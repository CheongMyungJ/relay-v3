// relay 명령줄 (docs/m1-modules.md cli, V12). main.ts가 부른다. 시험은 이 함수를 바로 부른다.
// 종료 코드: 0 성공(결론과 상관없이), 1 사용 오류, 2 내부 오류.

import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { parseContract } from '../core/contract.ts'
import { parseDebt, vanished } from '../core/debt.ts'
import { summarize } from '../core/evidence.ts'
import { gate } from '../core/gate.ts'
import { parseQuality, qualityHash } from '../core/quality.ts'
import type {
  AutoCondition,
  Conclusion,
  Contract,
  DebtItem,
  EvidenceBundle,
  GateResult,
} from '../core/types.ts'
import { repoRoot, revParse, showFile } from '../adapters/git.ts'
import { evidencePath, readJson, relayHome, repoKey } from '../adapters/store.ts'
import { check, CheckInputError, QUALITY_PATH } from '../engine/check.ts'
import { draftFor, draftText, writeDraft } from '../engine/init.ts'
import { m3Switches } from '../engine/m3.ts'
import { recordCommand } from './record.ts'

export interface Io {
  cwd: string
  env: NodeJS.ProcessEnv
  out(text: string): void
  err(text: string): void
  now(): Date
}

export const USAGE = `쓰는 법: relay <명령> [옵션]

  relay init [--write]
      quality.json 초안을 찍는다. --write면 .relay/quality.json이 없을 때만 쓴다.
  relay check [--base <ref>] [--head <ref>] [--contract <파일>] [--request <파일>] [--rerun] [--json]
      head를 base와 견줘 증거 묶음을 만든다. --rerun은 base 캐시를 쓰지 않는다.
  relay gate [--evidence <파일>] [--contract <파일>] [--head <ref>] [--auto-merge] [--json]
      증거 묶음으로 결론을 낸다. 묶음을 주지 않으면 지금 HEAD의 것을 쓴다.
      묶음의 head가 --head(기본 HEAD)와 다르면 낡은 증거로 본다.
  relay debt list|scan [--json]
      빚 장부(.relay/debt)의 목록, anchor가 사라진 항목.
  relay record [--json] [--project <경로>] [--all-epochs] [--pool]
      $RELAY_HOME 실적 장부의 조건별 그림자 실적(일치 k/n, 불일치, 분모 밖, 머지 뒤 30일, lift).
      기본은 지금 폴더의 레포와 그 마지막 판. --pool은 레포를 넘어 합친 값(보이기만).

종료 코드: 0 성공(결론과 상관없이), 1 사용 오류, 2 내부 오류`

/** 사람이 고칠 수 있는 잘못(인자, 없는 파일, 레포 밖). 종료 코드 1 */
export class UsageError extends Error {
  constructor(text: string) {
    super(text)
    this.name = 'UsageError'
  }
}

type Command = (io: Io, args: string[]) => Promise<number>

const COMMANDS: Record<string, Command> = {
  init: initCommand,
  check: checkCommand,
  gate: gateCommand,
  debt: debtCommand,
  record: (io, args) => recordCommand(io, args, (text) => new UsageError(text)),
}

export async function main(argv: string[], io: Io): Promise<number> {
  const [name, ...rest] = argv
  if (name === undefined) {
    io.err(USAGE)
    return 1
  }
  if (name === '--help' || name === '-h' || name === 'help') {
    io.out(USAGE)
    return 0
  }
  const command = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined
  if (command === undefined) {
    io.err(`알 수 없는 명령: ${name}\n\n${USAGE}`)
    return 1
  }
  if (rest.includes('--help') || rest.includes('-h')) {
    io.out(USAGE)
    return 0
  }
  try {
    return await command(io, rest)
  } catch (e) {
    if (e instanceof UsageError || e instanceof CheckInputError || isParseArgsError(e)) {
      io.err(`relay ${name}: ${(e as Error).message}`)
      return 1
    }
    io.err(`relay ${name}: 내부 오류: ${e instanceof Error ? e.message : String(e)}`)
    if (io.env.RELAY_DEBUG && e instanceof Error && e.stack) io.err(e.stack)
    return 2
  }
}

function isParseArgsError(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code
  return typeof code === 'string' && code.startsWith('ERR_PARSE_ARGS_')
}

async function rootOf(cwd: string): Promise<string> {
  try {
    return await repoRoot(cwd)
  } catch {
    throw new UsageError(`git 레포 안에서 돌려야 함: ${cwd}`)
  }
}

// ── init ────────────────────────────────────────────────────────────────────

async function initCommand(io: Io, args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { write: { type: 'boolean' } }, strict: true })
  const root = await rootOf(io.cwd)
  if (values.write !== true) {
    io.out(draftText(await draftFor(root)).trimEnd())
    return 0
  }
  if (!(await writeDraft(root)).written)
    throw new UsageError(`이미 있음: ${QUALITY_PATH}. 고치려면 직접 고친다`)
  io.out(`씀: ${QUALITY_PATH}`)
  return 0
}

// ── check ───────────────────────────────────────────────────────────────────

async function checkCommand(io: Io, args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      base: { type: 'string' },
      head: { type: 'string' },
      contract: { type: 'string' },
      request: { type: 'string' },
      rerun: { type: 'boolean' },
      json: { type: 'boolean' },
    },
    strict: true,
  })
  const home = relayHome(io.env)
  // M3 장치(V38·V40): CLI에는 프로젝트 설정이 없어 RELAY_M3만 본다(없으면 프로젝트 설정의 기본, V44: 지식 잇기만 끔)
  const m3 = m3Switches(undefined, io.env['RELAY_M3'])
  for (const e of m3.errors) io.err(e)
  const bundle = await check({
    repo: io.cwd,
    ...(values.base === undefined ? {} : { base: values.base }),
    ...(values.head === undefined ? {} : { head: values.head }),
    ...(values.contract === undefined ? {} : { contractPath: resolve(io.cwd, values.contract) }),
    ...(values.request === undefined ? {} : { requestPath: resolve(io.cwd, values.request) }),
    home,
    now: io.now().toISOString(),
    rerun: values.rerun === true,
    ...m3.switches,
  })
  if (values.json === true) {
    io.out(JSON.stringify(bundle, null, 2))
    return 0
  }
  for (const line of summarize(bundle)) io.out(line)
  const path = evidencePath(home, repoKey(bundle.repo), bundle.head)
  if (existsSync(path)) io.out(`증거: ${path}`)
  return 0
}

// ── gate ────────────────────────────────────────────────────────────────────

const CONCLUSION: Record<Conclusion, string> = {
  human_merge: '사람 머지',
  auto_merge_candidate: '자동 머지 후보',
  recontract: '계약 다시',
}

async function gateCommand(io: Io, args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      evidence: { type: 'string' },
      contract: { type: 'string' },
      head: { type: 'string' },
      'auto-merge': { type: 'boolean' },
      json: { type: 'boolean' },
    },
    strict: true,
  })
  const path =
    values.evidence === undefined
      ? await headEvidencePath(io, values.head ?? 'HEAD')
      : resolve(io.cwd, values.evidence)
  const bundle = await readJson<unknown>(path)
  if (bundle === null) throw new UsageError(`증거가 없음: ${path}. relay check를 먼저 돌린다`)
  if (!isBundle(bundle)) throw new UsageError(`증거 묶음의 모양이 아님: ${path}`)
  const contract = values.contract === undefined ? null : await readContract(io, values.contract)
  // 증거는 SHA에 붙는다(V6). 묶음의 레포에서 지금 head를 읽고, 못 읽으면 관문이 낡았는지 모름으로 본다
  const head = await revParse(bundle.repo, values.head ?? 'HEAD').catch(() => null)
  const result = gate(
    bundle,
    contract,
    {
      auto_merge_enabled: values['auto-merge'] === true,
      conditions: await autoConditions(io, bundle),
      // M1은 서버 보호(gh)와 그림자 실적을 읽지 않는다
      server: null,
      track_record_ok: {},
    },
    head,
  )
  if (values.json === true) io.out(JSON.stringify(result, null, 2))
  else for (const line of gateText(result)) io.out(line)
  return 0
}

async function headEvidencePath(io: Io, ref: string): Promise<string> {
  const root = await rootOf(io.cwd)
  const head = await revParse(root, ref).catch(() => {
    throw new UsageError(`커밋을 찾지 못함: ${ref}`)
  })
  return evidencePath(relayHome(io.env), repoKey(root), head)
}

const isObject = (v: unknown): boolean => typeof v === 'object' && v !== null && !Array.isArray(v)

/** 관문이 읽는 칸의 모양만 본다. 깨진 묶음으로 내부 오류가 나지 않게 */
function isBundle(v: unknown): v is EvidenceBundle {
  if (!isObject(v)) return false
  const b = v as Record<string, unknown>
  return (
    b.version === 1 &&
    typeof b.repo === 'string' &&
    typeof b.base === 'string' &&
    typeof b.head === 'string' &&
    isObject(b.quality) &&
    Array.isArray(b.commands) &&
    (b.lines === null || Array.isArray(b.lines)) &&
    Array.isArray(b.ratchets) &&
    Array.isArray(b.signals) &&
    isObject(b.diff) &&
    Array.isArray((b.diff as Record<string, unknown>).paths) &&
    (b.review === null || isObject(b.review)) &&
    typeof b.contract_change_requested === 'boolean' &&
    Array.isArray(b.missing)
  )
}

async function readContract(io: Io, file: string): Promise<Contract> {
  const path = resolve(io.cwd, file)
  const text = await readFile(path, 'utf8').catch(() => null)
  if (text === null) throw new UsageError(`계약 파일을 읽지 못함: ${path}`)
  const parsed = parseContract(text)
  if (!parsed.ok) throw new UsageError(`계약이 올바르지 않음:\n- ${parsed.errors.join('\n- ')}`)
  return parsed.value
}

/** 묶음을 만들 때 쓴 품질 기준(V9)의 자동 조건. 같은 내용인지 해시로 확인한다 */
async function autoConditions(io: Io, bundle: EvidenceBundle): Promise<AutoCondition[]> {
  if (bundle.quality.from === 'none') return []
  const sha = bundle.quality.from === 'base' ? bundle.base : bundle.head
  const text = await showFile(bundle.repo, sha, QUALITY_PATH).catch(() => null)
  const parsed = text === null ? null : parseQuality(text)
  if (text === null || qualityHash(text) !== bundle.quality.hash || parsed?.ok !== true) {
    io.err('주의: 묶음의 품질 기준을 다시 읽지 못함. 자동 조건 없이 판정함')
    return []
  }
  return parsed.value.auto
}

function gateText(r: GateResult): string[] {
  const out = [`결론: ${CONCLUSION[r.conclusion]} (${r.conclusion})`, `결정한 사실: ${r.decisive}`]
  if (r.reasons.length > 0) out.push('까닭:', ...r.reasons.map((x) => `- ${x}`))
  if (r.condition !== null)
    out.push(`채운 자동 조건: ${r.condition}${r.shadow ? ' (그림자: 기록만 함)' : ''}`)
  return out
}

// ── debt ────────────────────────────────────────────────────────────────────

const DEBT_DIR = '.relay/debt'

async function debtCommand(io: Io, args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    options: { json: { type: 'boolean' } },
    allowPositionals: true,
    strict: true,
  })
  const [sub, ...extra] = positionals
  if ((sub !== 'list' && sub !== 'scan') || extra.length > 0)
    throw new UsageError('relay debt list 또는 relay debt scan')
  const root = await rootOf(io.cwd)
  const { items, errors } = await readDebt(join(root, DEBT_DIR))
  for (const e of errors) io.err(`읽지 못함: ${e}`)
  const shown = sub === 'list' ? items : vanished(items, (p) => existsSync(join(root, p)))
  if (values.json === true) {
    io.out(
      JSON.stringify(sub === 'list' ? { items, errors } : { vanished: shown, errors }, null, 2),
    )
    return 0
  }
  if (shown.length === 0) io.out(sub === 'list' ? '빚 없음' : 'anchor가 사라진 빚 없음')
  for (const item of shown) io.out(debtLine(item, sub === 'scan'))
  return 0
}

async function readDebt(dir: string): Promise<{ items: DebtItem[]; errors: string[] }> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { items: [], errors: [] }
    throw e
  }
  const items: DebtItem[] = []
  const errors: string[] = []
  for (const name of names.filter((n) => n.endsWith('.md')).sort()) {
    const parsed = parseDebt(await readFile(join(dir, name), 'utf8'), name.slice(0, -3))
    if (parsed.ok) items.push(parsed.value)
    else errors.push(`${DEBT_DIR}/${name}: ${parsed.errors.join(', ')}`)
  }
  return { items, errors }
}

function debtLine(item: DebtItem, gone: boolean): string {
  const a = item.anchor
  const anchor = `${a.path}${a.name === undefined ? '' : `#${a.name}`}${a.metric === undefined ? '' : ` (${a.metric})`}`
  if (gone) return `${item.id} · ${anchor} 없음`
  return `${item.id} · ${item.kind} · ${anchor} · ${item.created} · ${item.reason.split('\n')[0] ?? ''}`
}

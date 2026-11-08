// 초안의 드라이런 (docs/quality-floor.md 5.1의 4, V61). 초안의 setup과 명령을 지금 커밋에서 한 번씩 돌리고(확인 실행기의 head
// check worktree: adapters prepareCheckout, engine workspace.ts runIn) 명령마다 됨·안 됨과 까닭, 래칫마다 지금 값을 낸다.
// 안 된 명령은 초안에서 빼고 '고칠 것'으로 돌려준다(조용히 남기지 않는다). 앱은 커밋하지 않는다.

import { readFile, realpath, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { matchAny } from '../core/glob.ts'
import { lastNumber } from '../core/ratchet.ts'
import type { CommandRun, CommandSpec, QualityConfig, RatchetSpec } from '../core/types.ts'
import { grepLines, lineCounts, lsTree, readBlobs, revParse } from '../adapters/git.ts'
import { repoKey } from '../adapters/store.ts'
import { lockWorktrees, prepareCheckout } from '../adapters/worktrees.ts'
import { parseCoverage } from './coverage.ts'
import { duplication, MAX_FILE_BYTES, scoped } from './duplication.ts'
import { inScan, langOf, listText, percent, SCAN_EXCLUDE } from './languages.ts'
import { GREP_NEEDLES, suppressionsInLine } from './suppressions.ts'
import { formatLabel } from './test-report.ts'
import { DEFAULT_COMMAND_TIMEOUT_SEC, message, runIn } from './workspace.ts'

export type DryKind = 'setup' | 'fast' | 'acceptance' | 'ratchet'

/** 돌려 본 명령 하나 */
export interface DryCommand {
  id: string
  kind: DryKind
  run: string
  ok: boolean
  /** 안 됐으면 까닭 */
  reason?: string
  /**
   * 안 된 까닭이 이 기계의 환경(네트워크, JDK·Gradle·도구 판)으로 보이면 그 무늬의 이름(V72). 출력의 무늬로만 가른다: 없으면
   * relay(고른 명령·설치가 틀림)인지 레포(코드·시험이 실제로 실패)인지 앱은 모르고 사람이 가른다
   */
  environment?: string
  duration_ms?: number
}

/** 래칫 하나의 지금 값 */
export interface DryValue {
  id: string
  kind: RatchetSpec['kind']
  /** 숫자 값(억누름 수, 중복 %, 시험 수, 넘는 파일 수, 명령 출력). 잴 수 없으면 null */
  value: number | null
  text: string
}

export interface DryRun {
  /** 돌린 커밋. 커밋이 없으면 null */
  head: string | null
  commands: DryCommand[]
  values: DryValue[]
  /** 안 된 명령과 그것에 기대는 래칫을 뺀 초안 */
  config: QualityConfig
  /** 초안에서 뺀 것(고칠 것) */
  fixes: DryCommand[]
}

export interface DryRunOptions {
  root: string
  home: string
  config: QualityConfig
  /** worktree 잠금을 기다리는 시간. 기본 10분 */
  lockWaitMs?: number
}

const ok = (r: CommandRun) => r.exit === 0 && !r.timed_out
const lastLine = (t: string) =>
  t
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .at(-1) ?? ''

/**
 * 환경 탓으로 보이는 실패의 무늬(V72, devices.md '여러 언어 초안'의 끄는 조건: 환경 탓은 분모에서 뺀다). 앞의 것이 먼저.
 * 'Could not resolve'는 Gradle의 받기 실패 꼴만 본다(Maven의 'Could not resolve dependencies for project'는 모듈 사이의
 * SNAPSHOT처럼 고른 명령 탓일 수 있다)
 */
const ENVIRONMENT: readonly [string, RegExp][] = [
  ['Gradle 플러그인 저장소', /Plugin \[id: '[^']+'[^\]]*\] was not found/],
  [
    'JDK 판',
    /Unsupported class file major version|has been compiled by a more recent version of the Java Runtime|Unsupported major\.minor version|No matching toolchains? found|Cannot find a Java installation|invalid (?:source|target) release/,
  ],
  [
    '네트워크',
    /UnknownHostException|Connection (?:refused|reset|timed out)|Network is unreachable|Temporary failure in name resolution|Could not resolve host|Failed to connect to|Could not (?:GET|HEAD) '|Could not transfer artifact|PKIX path building failed|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|failed to download from|Max retries exceeded/,
  ],
  [
    '받기 실패(Gradle)',
    /Could not resolve (?:all (?:files|dependencies|artifacts) for configuration|plugin artifact|[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+:)/,
  ],
  [
    '도구 판',
    /requires rustc [\d.]+ or newer|is not supported by the current version of|go: go\.mod requires go >=|requires a different Python|Could not determine java version|Gradle .* requires Java|Unsupported Java\. ?Your build is currently configured to use Java/,
  ],
]

/** 실행의 출력(setup은 오류 글)이 환경 탓의 무늬에 맞으면 그 이름 */
export function environmentCause(text: string): string | null {
  for (const [name, re] of ENVIRONMENT) if (re.test(text)) return name
  return null
}

/** 안 된 실행의 까닭 한 줄 */
export function failReason(r: CommandRun, sec: number): string {
  if (r.timed_out) return `시간 초과 (${sec}초)`
  const tail = lastLine(r.stderr_tail) || lastLine(r.stdout_tail)
  const text = tail.length > 160 ? `${tail.slice(0, 159)}…` : tail
  if (r.exit === null) return `돌지 못함${text ? `: ${text}` : ''}`
  return `종료 코드 ${r.exit}${text ? `: ${text}` : ''}`
}

export async function dryRun(o: DryRunOptions): Promise<DryRun> {
  const q = o.config
  const head = await revParse(o.root, 'HEAD').catch(() => null)
  const commands: DryCommand[] = []
  const values: DryValue[] = []
  const planned = plannedCommands(q)
  if (head === null) {
    const why = '커밋이 없어 돌려 보지 못함'
    for (const c of planned) commands.push({ ...c, ok: false, reason: why })
    return finish(q, head, commands, values)
  }

  const key = repoKey(o.root)
  const release = await lockWorktrees(o.home, key, o.lockWaitMs ?? 10 * 60 * 1000).catch(
    (e: unknown) => message(e),
  )
  if (typeof release === 'string') {
    for (const c of planned) commands.push({ ...c, ok: false, reason: `worktree: ${release}` })
    return finish(q, head, commands, values)
  }
  try {
    let dir: string | null = null
    let blocked: string | null = null
    let setupText: string | null = null
    const t0 = Date.now()
    try {
      const c = await prepareCheckout(o.home, key, o.root, 'head', head, q.setup)
      if (c.setupError !== undefined) {
        blocked = message(c.setupError)
        setupText = c.setupError
      } else dir = c.dir
    } catch (e) {
      blocked = `worktree: ${message(e)}`
    }
    for (const c of planned) {
      if (c.kind === 'setup') {
        const env = blocked === null ? null : environmentCause(setupText ?? blocked)
        commands.push({
          ...c,
          ok: blocked === null,
          duration_ms: Date.now() - t0,
          ...(blocked === null ? {} : { reason: blocked }),
          ...(env === null ? {} : { environment: env }),
        })
        continue
      }
      if (dir === null) {
        const why =
          q.setup !== undefined && blocked !== null && !blocked.startsWith('worktree')
            ? 'setup이 안 돼 돌려 보지 못함'
            : (blocked ?? '')
        commands.push({ ...c, ok: false, reason: why })
        continue
      }
      commands.push(await runOne(dir, head, c, q, values))
    }
    await measure(o.root, head, q, commands, values)
  } finally {
    await release().catch(() => {})
  }
  return finish(q, head, commands, values)
}

type Planned = Omit<DryCommand, 'ok'> & {
  spec?: CommandSpec | Extract<RatchetSpec, { kind: 'command' }>
}

/** 돌릴 차례: setup, 빠른 검사, 수용 시험, 명령 래칫 */
function plannedCommands(q: QualityConfig): Planned[] {
  const out: Planned[] = []
  if (q.setup !== undefined) out.push({ id: 'setup', kind: 'setup', run: q.setup.run })
  for (const c of q.commands.fast) out.push({ id: c.id, kind: 'fast', run: c.run, spec: c })
  const a = q.commands.acceptance
  if (a !== undefined) out.push({ id: a.id, kind: 'acceptance', run: a.run, spec: a })
  for (const r of q.ratchets)
    if (r.kind === 'command') out.push({ id: r.id, kind: 'ratchet', run: r.run, spec: r })
  return out
}

/** 명령 하나를 돌린다. 수용 시험은 JUnit과 커버리지 보고서까지 보고, 명령 래칫은 숫자를 읽는다 */
async function runOne(
  dir: string,
  head: string,
  c: Planned,
  q: QualityConfig,
  values: DryValue[],
): Promise<DryCommand> {
  const { spec, ...base } = c
  if (spec === undefined) return { ...base, ok: false, reason: '명령이 없음' }
  const sec = ('timeout_sec' in spec ? spec.timeout_sec : undefined) ?? DEFAULT_COMMAND_TIMEOUT_SEC
  const started = Date.now()
  const r = await runIn(dir, head, spec)
  const done = { ...base, duration_ms: r.duration_ms }
  if (!ok(r)) {
    const env = r.timed_out ? null : environmentCause(`${r.stderr_tail}\n${r.stdout_tail}`)
    return {
      ...done,
      ok: false,
      reason: failReason(r, sec),
      ...(env === null ? {} : { environment: env }),
    }
  }
  if (c.kind === 'ratchet') {
    const n = lastNumber(r.stdout_tail)
    if (n === null) return { ...done, ok: false, reason: '출력에서 숫자를 읽지 못함' }
    values.push({ id: c.id, kind: 'command', value: n, text: `${c.id} ${n}` })
    return { ...done, ok: true }
  }
  if (c.kind !== 'acceptance') return { ...done, ok: true }
  if ('junit' in spec && spec.junit !== undefined && r.tests === undefined) {
    const what = formatLabel(spec.test_format)
    return { ...done, ok: false, reason: `${what}을 읽지 못함 (${spec.junit})` }
  }
  const tests = r.tests ?? []
  for (const t of q.ratchets) {
    if (t.kind === 'test_count')
      values.push({ id: t.id, kind: t.kind, value: tests.length, text: `시험 ${tests.length}` })
    if (t.kind === 'diff_coverage') values.push(await coverageValue(dir, t, started))
  }
  return { ...done, ok: true }
}

/** 수용 시험이 쓴 보고서를 읽을 수 있나(드라이런에는 diff가 없어 값은 없다) */
async function coverageValue(
  dir: string,
  spec: Extract<RatchetSpec, { kind: 'diff_coverage' }>,
  started: number,
): Promise<DryValue> {
  const v = (value: number | null, text: string): DryValue => ({
    id: spec.id,
    kind: spec.kind,
    value,
    text,
  })
  try {
    const path = resolve(dir, spec.report)
    const st = await stat(path).catch(() => null)
    if (st === null || !st.isFile()) return v(null, `잴 수 없음: 보고서가 없음 (${spec.report})`)
    if (st.mtimeMs < started - 2000)
      return v(null, `잴 수 없음: 보고서가 이번 실행 앞에 쓰임 (${spec.report})`)
    const parsed = parseCoverage(await readFile(path, 'utf8'), spec.format, [
      dir,
      await realpath(dir),
    ])
    if (!parsed.ok) return v(null, `잴 수 없음: ${parsed.errors[0] ?? '보고서를 읽지 못함'}`)
    if (parsed.value.length === 0)
      return v(null, `잴 수 없음: 보고서에 파일이 없음 (${spec.report})`)
    const floor = percent(spec.min)
    return v(
      parsed.value.length,
      `바뀐 줄 커버리지: 보고서를 읽음(파일 ${parsed.value.length}개), 바닥 ${floor}`,
    )
  } catch (e) {
    return v(null, `잴 수 없음: ${message(e)}`)
  }
}

/** 앱이 직접 재는 래칫(줄 수, 억누름, 중복)의 지금 값. git의 커밋을 읽는다(engine ratchets.ts와 같은 범위) */
async function measure(
  root: string,
  head: string,
  q: QualityConfig,
  commands: DryCommand[],
  values: DryValue[],
): Promise<void> {
  const acceptance = commands.find((c) => c.kind === 'acceptance')
  for (const spec of q.ratchets) {
    const v = (value: number | null, text: string) =>
      values.push({ id: spec.id, kind: spec.kind, value, text })
    try {
      if (spec.kind === 'file_lines') {
        const paths = (await lsTree(root, head)).filter(
          (p) =>
            (spec.exclude === undefined || !matchAny(p, spec.exclude)) &&
            (spec.include === undefined || spec.include.length === 0 || matchAny(p, spec.include)),
        )
        const counts = await lineCounts(root, head, paths)
        const over = [...counts]
          .filter(([, n]) => n !== null && n > spec.max)
          .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
        const list =
          over.length === 0
            ? ''
            : ` (${listText(
                over.map(([p, n]) => `${p} ${n}`),
                3,
              )})`
        v(over.length, `${spec.max}줄 넘는 파일 ${over.length}${list}`)
      } else if (spec.kind === 'suppressions') {
        const hits = (await grepLines(root, head, GREP_NEEDLES))
          .flatMap((h) => suppressionsInLine(h.path, h.line, h.text))
          .filter((s) => inScan(s.path, spec))
        const by = new Map<string, number>()
        for (const s of hits) by.set(s.marker, (by.get(s.marker) ?? 0) + 1)
        const top = [...by].sort((a, b) => b[1] - a[1]).map(([m, n]) => `${m} ${n}`)
        v(hits.length, `억누름 ${hits.length}${top.length > 0 ? ` (${listText(top, 3)})` : ''}`)
      } else if (spec.kind === 'duplication') {
        const paths = (await lsTree(root, head)).filter(
          (p) => langOf(p) !== null && !matchAny(p, [...SCAN_EXCLUDE]),
        )
        const r = duplication(
          scoped(await readBlobs(root, head, paths, MAX_FILE_BYTES), spec, q.test_globs),
        )
        v(
          Math.round(r.share * 1000) / 10,
          `중복 ${percent(r.share)} (코드 줄 ${r.code}, 쌍 ${r.pairs.length})`,
        )
      } else if (spec.kind === 'test_count' || spec.kind === 'diff_coverage') {
        // 수용 시험이 돌지 않았으면 runOne이 값을 내지 않았다
        if (acceptance?.ok !== true && !values.some((x) => x.id === spec.id))
          v(null, `잴 수 없음: 수용 시험이 ${acceptance === undefined ? '없음' : '안 됨'}`)
      }
    } catch (e) {
      v(null, `잴 수 없음: ${message(e)}`)
    }
  }
}

/** 안 된 명령을 빼고, 그것에 기대는 래칫(시험 수, 바뀐 줄 커버리지)도 뺀다 */
function finish(
  q: QualityConfig,
  head: string | null,
  commands: DryCommand[],
  values: DryValue[],
): DryRun {
  const bad = new Set(commands.filter((c) => !c.ok).map((c) => `${c.kind}:${c.id}`))
  const fixes = commands.filter((c) => !c.ok)
  const config: QualityConfig = structuredClone(q)
  if (bad.has('setup:setup')) delete config.setup
  config.commands.fast = config.commands.fast.filter((c) => !bad.has(`fast:${c.id}`))
  const acc = config.commands.acceptance
  const accGone = acc !== undefined && bad.has(`acceptance:${acc.id}`)
  if (accGone) delete config.commands.acceptance
  const covBad = values.find((v) => v.kind === 'diff_coverage' && v.value === null)
  config.ratchets = config.ratchets.filter((r) => {
    if (r.kind === 'command') return !bad.has(`ratchet:${r.id}`)
    if (r.kind === 'test_count') return config.commands.acceptance !== undefined
    if (r.kind === 'diff_coverage') {
      if (config.commands.acceptance === undefined) return false
      return covBad === undefined
    }
    return true
  })
  // 보고서를 읽지 못한 바뀐 줄 커버리지도 고칠 것이다(수용 시험이 빠진 탓이면 그 줄로 이미 보인다)
  if (covBad !== undefined && !accGone) {
    const r = q.ratchets.find((x) => x.id === covBad.id)
    fixes.push({
      id: covBad.id,
      kind: 'ratchet',
      run: r?.kind === 'diff_coverage' ? r.report : '',
      ok: false,
      reason: covBad.text,
    })
  }
  return { head, commands, values, config, fixes }
}

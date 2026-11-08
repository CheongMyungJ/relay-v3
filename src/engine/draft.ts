// 품질 기준 초안 짜기 (docs/quality-floor.md 5절, V60~V62). 언어 단위(recipes.ts)를 하나의 quality.json으로 합치고, 앱이 직접
// 재는 래칫(V55~V57)을 더하고, 사람에게 물을 것(늘 볼 경로, 지킬 경계, CI 필수 검사)의 후보를 낸다. 순수 함수다.
// JS 하나뿐인 레포의 초안은 core draftQuality(V19)와 같고, 래칫 둘(suppressions, duplication)만 끝에 더한다.

import { DRAFT_AUTO, DEFAULT_TEST_GLOBS, parseQuality } from '../core/quality.ts'
import type { CommandSpec, QualityConfig, RatchetSpec, SetupSpec } from '../core/types.ts'
import {
  buildUnit,
  sourceCount,
  unitDirs,
  type CommandRatchet,
  type RepoScan,
  type Unit,
} from './recipes.ts'
import { SOURCE_EXTENSIONS } from './languages.ts'

/** 초안의 바뀐 줄 커버리지 바닥. 사람이 고친다(V57: min은 사람이 정한다) */
export const DRAFT_COVERAGE_MIN = 0.8

export type QuestionId = 'human_paths' | 'boundaries' | 'ci_checks'

/** 사람에게 묻는 것 하나. options는 앱이 고른 후보이고, 답은 후보를 고르거나 글로 더 적는다 */
export interface DraftQuestion {
  id: QuestionId
  text: string
  /** 답이 초안의 어디로 가나, 글로 적는 꼴 */
  hint: string
  options: { value: string; label: string }[]
}

export type DraftAnswers = Partial<Record<QuestionId, string[]>>

export interface DraftPlan {
  config: QualityConfig
  /** 찾은 언어 단위(보이기용) */
  units: { label: string; dir: string }[]
  questions: DraftQuestion[]
  /** 빠진 도구의 제안(글로만. 설치하지 않는다) */
  suggestions: string[]
}

/**
 * 초안의 줄 수 래칫이 보는 파일(V66): 언어 표의 확장자와 화면 소스(스타일·컴포넌트 파일. 표에 없지만 JS 레포의 코드다). 문서·
 * 자료·잠금 파일은 Work마다 자라거나(CHANGELOG) 사람이 쓴 코드가 아니다(시험 자료 JSON, 잠금 파일)
 */
const VIEW_EXTENSIONS = ['css', 'scss', 'sass', 'less', 'vue', 'svelte', 'astro']
export const SOURCE_GLOB = `**/*.{${[...SOURCE_EXTENSIONS, ...VIEW_EXTENSIONS].join(',')}}`

const TAG: Readonly<Record<Unit['lang'], string>> = {
  js: 'js',
  py: 'py',
  go: 'go',
  java: 'java',
  rust: 'rust',
}

/** 돌릴 것이 있는 단위 */
const runs = (u: Unit) => u.fast.length > 0 || !!u.acceptance || !!u.test || u.ratchets.length > 0

export function planDraft(scan: RepoScan): DraftPlan {
  const files = scan.files.map((f) => (f.startsWith('./') ? f.slice(2) : f))
  const s: RepoScan = { files, texts: scan.texts }
  const { dirs, skipped } = unitDirs(files)
  const units: Unit[] = []
  for (const d of dirs) {
    const u = buildUnit(s, d.lang, d.dir)
    // 돌릴 것이 없는 단위(설치만 있음)는 넣지 않는다. 알아보기만 한 단위(bare, V70)는 언어와 제안을 보이려고 넣는다
    if (u !== null && (u.bare === true || runs(u))) units.push(u)
  }
  // 루트 package.json이 없어도 JS 잠금 파일이 있으면 core 초안이 setup을 넣는다(V19 그대로)
  if (!units.some((u) => u.lang === 'js' && u.dir === '.')) {
    const js = buildUnit(s, 'js', '.')
    if (js?.setup !== undefined) units.unshift(js)
  }
  const tags = tagsOf(units)
  const primary = pickPrimary(units, files)
  // 명령이 있는 단위가 하나면 id를 그대로 둔다(JS 하나뿐인 레포는 core 초안과 같다)
  const single = units.filter(runs).length <= 1

  const fast: CommandSpec[] = []
  const ratchetCmds: CommandRatchet[] = []
  let acceptance: CommandSpec | undefined
  let coverage: RatchetSpec | undefined
  units.forEach((u, i) => {
    const tag = tags[i] ?? ''
    const name = (id: string) => (single ? id : `${tag}-${id}`)
    for (const c of u.fast) fast.push(inDir(u.dir, { ...c, id: name(c.id) }))
    if (u === primary && u.acceptance) {
      acceptance = inDir(u.dir, u.acceptance)
      if (u.coverage)
        coverage = {
          id: 'diff-coverage',
          kind: 'diff_coverage',
          report: at(u.dir, u.coverage.report),
          format: u.coverage.format,
          min: DRAFT_COVERAGE_MIN,
        }
    } else if (u.test) fast.push(inDir(u.dir, { ...u.test, id: name(u.test.id) }))
    for (const r of u.ratchets) ratchetCmds.push({ ...r, id: name(r.id), run: cd(u.dir, r.run) })
  })

  const hasCi = files.some((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f))
  const ratchets: RatchetSpec[] = []
  if (acceptance) ratchets.push({ id: 'tests', kind: 'test_count' })
  ratchets.push({ id: 'file-size', kind: 'file_lines', max: 600, include: [SOURCE_GLOB] })
  ratchets.push(
    { id: 'suppressions', kind: 'suppressions' },
    { id: 'duplication', kind: 'duplication' },
  )
  if (coverage) ratchets.push(coverage)
  ratchets.push(...ratchetCmds)

  const config = prune({
    version: 1 as const,
    setup: mergeSetup(units),
    commands: prune({ fast, acceptance, full: hasCi ? { ci_checks: [] } : undefined }),
    human_paths: [],
    guard_paths: [],
    public_api: [],
    test_globs: [...DEFAULT_TEST_GLOBS],
    examples_dir: '.relay/examples',
    ratchets,
    rules: [],
    auto: [{ ...DRAFT_AUTO }],
  })
  // 단위가 하나면(알아보기만 한 단위 포함) 제안에 단위 이름을 붙이지 않는다
  const one = units.length <= 1
  const suggestions = units.flatMap((u) =>
    u.suggestions.map((t) => (one || (single && runs(u)) ? t : `${u.label}(${u.dir}): ${t}`)),
  )
  for (const s of skipped)
    suggestions.push(`매니페스트가 여러 폴더에 있어 초안에 넣지 않음(사람이 고름): ${s}`)
  return {
    config,
    units: units.map((u) => ({ label: u.label, dir: u.dir })),
    questions: questionsFor(s, units),
    suggestions,
  }
}

const at = (dir: string, p: string): string => (dir === '.' ? p : `${dir}/${p}`)

/** 단위 폴더에서 돌게: `cd <dir> && …`. 여러 명령을 이은 글은 묶는다 */
function cd(dir: string, run: string): string {
  if (dir === '.') return run
  return /[;&|]/.test(run) ? `cd ${dir} && { ${run}; }` : `cd ${dir} && ${run}`
}

function inDir(dir: string, c: CommandSpec): CommandSpec {
  const out: CommandSpec = { ...c, run: cd(dir, c.run) }
  if (c.junit !== undefined) out.junit = at(dir, c.junit)
  return out
}

function mergeSetup(units: Unit[]): SetupSpec | undefined {
  const parts = units.filter((u) => u.setup !== undefined)
  if (parts.length === 0) return undefined
  if (parts.length === 1) {
    const u = parts[0] as Unit & { setup: SetupSpec }
    return u.dir === '.'
      ? u.setup
      : {
          run: cd(u.dir, u.setup.run),
          inputs: u.setup.inputs.map((p) => at(u.dir, p)),
          keep: u.setup.keep.map((p) => at(u.dir, p)),
        }
  }
  const run = parts
    .map((u) => (u.dir === '.' ? `{ ${u.setup?.run}; }` : `(${cd(u.dir, u.setup?.run ?? '')})`))
    .join(' && ')
  return {
    run,
    inputs: parts.flatMap((u) => (u.setup?.inputs ?? []).map((p) => at(u.dir, p))),
    keep: parts.flatMap((u) => (u.setup?.keep ?? []).map((p) => at(u.dir, p))),
  }
}

/** 단위의 명령 id 앞에 붙일 이름: 루트면 언어, 아니면 폴더 끝 이름(겹치면 번호) */
function tagsOf(units: Unit[]): string[] {
  const seen = new Map<string, number>()
  return units.map((u) => {
    const raw = u.dir === '.' ? TAG[u.lang] : (u.dir.split('/').at(-1) ?? u.lang)
    const base = raw.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[^A-Za-z0-9]+/, '') || TAG[u.lang]
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return n === 1 ? base : `${base}${n}`
  })
}

/** 수용 시험을 맡을 단위: 수용 시험이 있는 단위 가운데 그 언어의 소스 파일이 가장 많은 것(같으면 앞의 것) */
function pickPrimary(units: Unit[], files: string[]): Unit | undefined {
  let best: Unit | undefined
  let most = -1
  for (const u of units) {
    if (!u.acceptance) continue
    const n = sourceCount(files, u.dir, u.lang)
    if (n > most) {
      best = u
      most = n
    }
  }
  return best
}

function prune<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
}

// ── 묻는 것 (5.1의 5) ──────────────────────────────────────────────────────

const HUMAN_NAMES = new Set(
  ['migrations', 'migration', 'alembic', 'auth', 'authentication', 'security'].concat([
    'payments',
    'payment',
    'billing',
    'secrets',
    'infra',
    'terraform',
    'deploy',
    'helm',
  ]),
)
/** 경계 후보: 위층 폴더 이름 → 아래층 폴더 이름을 직접 부르지 않는다 */
const UPPER = [
  'ui',
  'web',
  'frontend',
  'client',
  'components',
  'views',
  'pages',
  'cli',
  'cmd',
].concat(['api', 'handlers', 'routes', 'controllers'])
const LOWER = ['db', 'database', 'storage', 'repository', 'repositories', 'persistence', 'dao']
const SAFE_DIR = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)*$/
const MAX_OPTIONS = 5

/** 레포의 폴더(깊이 셋까지) */
function foldersOf(files: string[]): string[] {
  const out = new Set<string>()
  for (const f of files) {
    const parts = f.split('/').slice(0, -1)
    for (let i = 1; i <= Math.min(parts.length, 3); i++) out.add(parts.slice(0, i).join('/'))
  }
  return [...out].filter(
    (d) => !/(^|\/)(node_modules|vendor|dist|build|target|\.[^/]*)(\/|$)/.test(d),
  )
}

function questionsFor(scan: RepoScan, units: Unit[]): DraftQuestion[] {
  const folders = foldersOf(scan.files)
  const out: DraftQuestion[] = []
  const human = folders
    .filter((d) => HUMAN_NAMES.has(d.split('/').at(-1) ?? ''))
    .sort((a, b) => a.split('/').length - b.split('/').length || (a < b ? -1 : 1))
    .slice(0, MAX_OPTIONS)
  out.push({
    id: 'human_paths',
    text: '늘 사람이 볼 경로(이 경로를 건드린 Work는 늘 사람 머지)',
    hint: 'human_paths에 들어갑니다. glob으로 적습니다(예: migrations/**)',
    options: human.map((d) => ({ value: `${d}/**`, label: `${d}/**` })),
  })
  const parents = new Set(['.', ...units.map((u) => u.dir)])
  for (const d of folders)
    if (/^(?:src|app|lib|pkg|internal)$/.test(d.split('/').at(-1) ?? '')) parents.add(d)
  const pairs: string[] = []
  for (const p of [...parents].sort()) {
    const kids = new Set(
      folders
        .filter((d) => d.startsWith(p === '.' ? '' : `${p}/`))
        .filter((d) => {
          const rest = p === '.' ? d : d.slice(p.length + 1)
          return !rest.includes('/')
        }),
    )
    const name = (n: string) => (p === '.' ? n : `${p}/${n}`)
    for (const u of UPPER)
      for (const l of LOWER)
        if (kids.has(name(u)) && kids.has(name(l))) pairs.push(`${name(u)}:${name(l)}`)
  }
  if (pairs.length > 0)
    out.push({
      id: 'boundaries',
      text: '지킬 경계(앞 폴더의 코드가 뒤 폴더를 직접 가져오지 않는다)',
      hint: '경계마다 가져오는 줄 수를 세는 래칫(command)이 들어갑니다. "앞:뒤"로 적습니다(예: src/ui:src/db)',
      options: pairs.slice(0, MAX_OPTIONS).map((v) => ({ value: v, label: v.replace(':', ' → ') })),
    })
  const jobs = [...scan.texts]
    .filter(([p]) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p))
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .flatMap(([, t]) => workflowJobs(t))
  if (jobs.length > 0 || scan.files.some((f) => f.startsWith('.github/workflows/')))
    out.push({
      id: 'ci_checks',
      text: 'CI 필수 검사 이름(머지 뒤 main 실패를 잴 때 씀)',
      hint: 'commands.full.ci_checks에 들어갑니다. 앱은 아직 CI 결과를 읽지 않아 증거에는 없는 증거(ci)로 적힙니다',
      options: [...new Set(jobs)].slice(0, MAX_OPTIONS).map((j) => ({ value: j, label: j })),
    })
  return out
}

/** GitHub Actions 워크플로 글의 작업 이름(name이 있으면 그것, 없으면 작업 id). 식(${{ }})이 든 이름은 뺀다 */
export function workflowJobs(text: string): string[] {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((l) => /^jobs:\s*(#.*)?$/.test(l))
  if (start < 0) return []
  const out: string[] = []
  let indent = -1
  let job: { id: string; name: string | null; child: number } | null = null
  const flush = () => {
    if (job !== null) {
      const n = job.name ?? job.id
      if (!n.includes('${{')) out.push(n)
    }
  }
  for (const line of lines.slice(start + 1)) {
    if (/^\s*(#.*)?$/.test(line)) continue
    const lead = line.length - line.trimStart().length
    if (lead === 0) break
    if (indent < 0) indent = lead
    if (lead === indent) {
      flush()
      const m = /^\s*([A-Za-z0-9_-]+)\s*:\s*$/.exec(line)
      job = m ? { id: m[1] ?? '', name: null, child: -1 } : null
    } else if (job !== null && lead > indent) {
      if (job.child < 0) job.child = lead
      const m = lead === job.child ? /^\s*name\s*:\s*(.+?)\s*$/.exec(line) : null
      if (m) job.name = (m[1] ?? '').replace(/^(['"])(.*)\1$/, '$2')
    }
  }
  flush()
  return out
}

// ── 답 넣기 ────────────────────────────────────────────────────────────────

/** 경계 "앞:뒤"를 래칫으로: 앞 폴더 파일에서 뒤 폴더 이름을 가져오는 줄 수(낮을수록 좋음) */
export function boundaryRatchet(value: string): CommandRatchet {
  const [from = '', to = '', ...rest] = value.split(':').map((s) => s.trim().replace(/\/+$/, ''))
  if (rest.length > 0 || !SAFE_DIR.test(from) || !SAFE_DIR.test(to) || from === to)
    throw new Error(`경계는 "앞 폴더:뒤 폴더"로 적습니다: ${value}`)
  const seg = (to.split('/').at(-1) ?? to).replace(/[.]/g, '\\.')
  const B = '[^A-Za-z0-9_-]'
  const re = [
    `^[[:space:]]*(import|from|use|export|#include)([[:space:]].*)?${B}${seg}(${B}|$)`,
    `require\\(.*${B}${seg}(${B}|$)`,
    `^[[:space:]]*"([^"]*/)?${seg}(/[^"]*)?"`,
  ].join('|')
  const id = `boundary-${from.split('/').at(-1)}-${to.split('/').at(-1)}`.replace(
    /[^A-Za-z0-9._-]/g,
    '-',
  )
  return {
    id,
    kind: 'command',
    run: `git grep -h -I -E '${re}' -- '${from}/' | wc -l`,
    better: 'lower',
  }
}

/** 답을 초안에 넣는다. 넣은 뒤 quality.json으로 읽히지 않으면 던진다 */
export function applyAnswers(config: QualityConfig, answers: DraftAnswers): QualityConfig {
  const clean = (k: QuestionId) => [
    ...new Set((answers[k] ?? []).map((v) => v.trim()).filter((v) => v !== '')),
  ]
  const out: QualityConfig = structuredClone(config)
  const human = clean('human_paths')
  if (human.length > 0) out.human_paths = [...new Set([...out.human_paths, ...human])]
  const ids = new Set(out.ratchets.map((r) => r.id))
  for (const b of clean('boundaries')) {
    const r = boundaryRatchet(b)
    if (ids.has(r.id)) continue
    ids.add(r.id)
    out.ratchets.push(r)
  }
  const ci = clean('ci_checks')
  if (ci.length > 0)
    out.commands.full = {
      ...out.commands.full,
      ci_checks: [...new Set([...(out.commands.full?.ci_checks ?? []), ...ci])],
    }
  const parsed = parseQuality(JSON.stringify(out))
  if (!parsed.ok) throw new Error(`답을 넣은 초안이 품질 기준으로 읽히지 않음: ${parsed.errors[0]}`)
  return out
}

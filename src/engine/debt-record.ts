// 받아들인 나빠짐의 빚 기록 (M3b, docs/m3-design.md 3절, V40). 앱이 [빚으로 남기고 머지·끝내기]에서 쓸 빚 파일과 커밋
// 메시지(트레일러), 새 Work를 만들 때 실적 장부의 앞 기록과 기준 브랜치를 견줘 찾는 '기록 안 된 나빠짐'. 빚의 모양은 core
// debt.ts(debtFromRatchet, formatDebt, parseDebt)다. git은 읽기만 한다(커밋은 adapters/git-write.ts).

import { changedPaths, lineCounts, lsTree, mergeBase, revParse, showFile } from '../adapters/git.ts'
import { debtFromRatchet, formatDebt, parseDebt } from '../core/debt.ts'
import type { LedgerEntry } from './ledger.ts'
import { parseQuality, QUALITY_PATH } from '../core/quality.ts'
import { fileLinesRatchet, type FileLines } from '../core/ratchet.ts'
import type { DebtItem, RatchetResult } from '../core/types.ts'

export const DEBT_DIR = '.relay/debt'

/** 빚 기록 커밋의 작성자 */
export const RELAY_AUTHOR = { name: 'relay', email: 'relay@localhost' }

/** request.md에 붙이는 '기록 안 된 나빠짐'의 제목 */
export const UNRECORDED_TITLE = '## 기록 안 된 나빠짐 (relay가 찾음)'

/** 많으면 이만큼만 쓰고 수를 단다 */
const UNRECORDED_MAX = 20

export const worseOf = (ratchets: RatchetResult[]): RatchetResult[] =>
  ratchets.filter((r) => r.status === 'worse')

/** sha의 .relay/debt/<id>.md: 있는 id 모두와 읽은 항목. 형식이 깨진 파일도 id는 있다 */
export async function debtAt(
  repo: string,
  sha: string,
): Promise<{ ids: Set<string>; items: DebtItem[] }> {
  const ids = new Set<string>()
  const items: DebtItem[] = []
  for (const path of await lsTree(repo, sha)) {
    const m = /^\.relay\/debt\/([^/]+)\.md$/.exec(path)
    if (!m?.[1]) continue
    ids.add(m[1])
    const text = await showFile(repo, sha, path)
    const parsed = text === null ? null : parseDebt(text, m[1])
    if (parsed?.ok) items.push(parsed.value)
  }
  return { ids, items }
}

/**
 * 나빠진 래칫마다 core debtFromRatchet의 항목과 파일(.relay/debt/<id>.md → 내용). taken(head에 이미 있는 id)과 겹치면
 * '-2', '-3'을 붙인다: 같은 파일이 다시 나빠져도 앞 빚을 덮지 않는다
 */
export function debtFiles(
  worse: RatchetResult[],
  source: string,
  date: string,
  taken: Set<string>,
): { items: DebtItem[]; files: Record<string, string> } {
  const used = new Set(taken)
  const items: DebtItem[] = []
  for (const r of worse) {
    for (const item of debtFromRatchet(r, source, date)) {
      let id = item.id
      for (let n = 2; used.has(id); n++) id = `${item.id}-${n}`
      used.add(id)
      items.push({ ...item, id })
    }
  }
  const files: Record<string, string> = {}
  for (const item of items) files[`${DEBT_DIR}/${item.id}.md`] = formatDebt(item)
  return { items, files }
}

/** 빚 기록 커밋 메시지: 제목, 항목마다 한 줄, 트레일러(Relay-Work, 항목마다 Relay-Debt) */
export function debtMessage(workId: string, worse: RatchetResult[], items: DebtItem[]): string {
  const ids = worse.map((r) => r.id).join(', ')
  return [
    `relay: 받아들인 나빠짐을 빚으로 기록 (${ids})`,
    '',
    '사람이 래칫이 나빠진 채로 받아들였다. 다음 Work가 갚을 수 있게 빚 장부에 남긴다.',
    '',
    ...items.map((i) => `- ${i.id}: ${i.reason}`),
    '',
    `Relay-Work: ${workId}`,
    ...items.map((i) => `Relay-Debt: ${i.id}`),
    '',
  ].join('\n')
}

interface Regression {
  path: string
  metric: string
  text: string
}

/** 래칫 하나의 나빠짐. 파일이 없는 래칫은 그 래칫을 정한 품질 기준에 단다(debtFromRatchet와 같다) */
function regressions(r: RatchetResult, why: string): Regression[] {
  const offenders = r.offenders ?? []
  if (offenders.length === 0)
    return [{ path: QUALITY_PATH, metric: r.id, text: `${r.id}: ${r.detail} (${why})` }]
  return offenders.map((o) => ({
    path: o.path,
    metric: r.id,
    text: `${r.id}: ${o.path} ${o.base ?? '없음'} → ${o.head} (${why})`,
  }))
}

/** 빚 항목이 그 나빠짐(경로, 래칫)을 덮나: 같은 anchor의 accepted_regression */
const covers = (d: DebtItem, g: Pick<Regression, 'path' | 'metric'>) =>
  d.kind === 'accepted_regression' && d.anchor.path === g.path && d.anchor.metric === g.metric

/**
 * 나빠진 래칫 가운데 items가 덮지 않는 것. offender가 있는 래칫은 덮이지 않은 offender만 남기고, 모두 덮였으면 뺀다. 빚으로
 * 기록할 것이다(같은 나빠짐을 두 번 적지 않게)
 */
export function uncoveredWorse(ratchets: RatchetResult[], items: DebtItem[]): RatchetResult[] {
  return worseOf(ratchets).flatMap((r) => {
    if ((r.offenders ?? []).length === 0)
      return items.some((d) => covers(d, { path: QUALITY_PATH, metric: r.id })) ? [] : [r]
    const offenders = (r.offenders ?? []).filter(
      (o) => !items.some((d) => covers(d, { path: o.path, metric: r.id })),
    )
    return offenders.length === 0 ? [] : [{ ...r, offenders }]
  })
}

/** 이 diff(paths: 바꾼 파일)가 더하거나 고친 .relay/debt/의 항목(head에서 읽음). 지운 것과 형식이 깨진 것은 없다 */
export async function workDebt(repo: string, head: string, paths: string[]): Promise<DebtItem[]> {
  const items: DebtItem[] = []
  for (const path of new Set(paths)) {
    const m = /^\.relay\/debt\/([^/]+)\.md$/.exec(path)
    const text = m?.[1] ? await showFile(repo, head, path) : null
    const parsed = text === null || !m?.[1] ? null : parseDebt(text, m[1])
    if (parsed?.ok) items.push(parsed.value)
  }
  return items
}

/**
 * 묶음의 debt_covered: 이 diff가 이미 둔 빚 가운데 나빠진 래칫을 덮는 항목과, 모두 덮인 래칫. 같은 Work에서 빚을 기록한 뒤 다시
 * 재도 다시 묻거나 '-2'로 또 적지 않게. 나빠진 래칫이 없으면 null
 */
export async function coveredDebt(
  repo: string,
  head: string,
  paths: string[],
  ratchets: RatchetResult[],
): Promise<{ ratchets: string[]; items: string[] } | null> {
  const worse = worseOf(ratchets)
  if (worse.length === 0) return null
  const mine = await workDebt(repo, head, paths)
  const open = new Set(uncoveredWorse(worse, mine).map((r) => r.id))
  const used = mine.filter((d) => worse.some((r) => regressions(r, '').some((g) => covers(d, g))))
  return {
    ratchets: worse.filter((r) => !open.has(r.id)).map((r) => r.id),
    items: used.map((d) => d.id),
  }
}

const exportOf = (e: LedgerEntry) => e.export ?? null

/**
 * 새 Work의 기준(base)에 기록 안 된 나빠짐이 있나. 앞 기록은 실적 장부에서 이 프로젝트의, 같은 기준 브랜치(sameBase)로 간
 * Work의 마지막 머지(merged_head)다. (1) 그 머지가 앱 밖(human-override)이었으면 장부의 그 head 결론 줄에 남은 나빠진 래칫.
 * (2) 그 head와 기준의 공통 조상에서 기준까지 바뀐 파일을 기준의 품질 기준의 file_lines 래칫으로 잰 나빠짐(앞 기록 뒤 앱을
 * 거치지 않고 들어온 것. 기준이 그 머지를 아직 받지 않았으면(fetch 전) 공통 조상이 기준이라 없고, squash 머지면 앞 기록과
 * 같은 파일은 나빠짐이 아니다). 기준의 .relay/debt/에 같은 경로·래칫의 accepted_regression 항목이 있으면 기록된 것이다. 시험
 * 수·명령 래칫은 기준에서 돌리지 않으므로 (1)로만 본다. 장부에 머지가 없으면 빈 것
 */
export async function unrecordedRegressions(o: {
  repo: string
  base: string
  ledger: LedgerEntry[]
  project: string
  /** 장부의 그 Work가 이 Work와 같은 기준 브랜치로 갔나(장부 줄에는 기준이 없다) */
  sameBase: (work: string) => Promise<boolean>
}): Promise<string[]> {
  const mine = o.ledger.filter((e) => e.project === o.project)
  let last: LedgerEntry | undefined
  for (const e of mine.toReversed())
    if (e.merged_head !== undefined && (await o.sameBase(e.work))) {
      last = e
      break
    }
  const prev = last?.merged_head
  if (last === undefined || prev === undefined) return []
  const base = await revParse(o.repo, o.base)
  const found: Regression[] = []
  if (last.by === 'human-override') {
    const line = mine.findLast(
      (e) => e.work === last.work && exportOf(e) === exportOf(last) && e.head === prev && e.worse,
    )
    for (const r of line?.worse ?? []) found.push(...regressions(r, '앱 밖에서 머지됨'))
  }
  const known = await revParse(o.repo, prev).catch(() => null)
  const from = known === null ? null : await mergeBase(o.repo, known, base).catch(() => null)
  if (known !== null && from !== null && from !== base)
    found.push(...(await sinceRecord(o.repo, known, from, base)))
  const { items } = await debtAt(o.repo, base)
  const recorded = (g: Regression) => items.some((d) => covers(d, g))
  const lines = [...new Set(found.filter((g) => !recorded(g)).map((g) => g.text))]
  const shown = lines.slice(0, UNRECORDED_MAX)
  return lines.length > shown.length ? [...shown, `외 ${lines.length - shown.length}개`] : shown
}

/**
 * 공통 조상(from)에서 기준(base)까지 바뀐 파일의 file_lines 래칫 나빠짐. 줄 수는 앞 기록(prev)과 기준으로 견준다. 품질 기준이
 * 없거나 깨졌으면 빈 것
 */
async function sinceRecord(
  repo: string,
  prev: string,
  from: string,
  base: string,
): Promise<Regression[]> {
  const text = await showFile(repo, base, QUALITY_PATH)
  const q = text === null ? null : parseQuality(text)
  const specs = q?.ok ? q.value.ratchets.filter((r) => r.kind === 'file_lines') : []
  if (specs.length === 0) return []
  const paths = await changedPaths(repo, from, base)
  const [before, after] = await Promise.all([
    lineCounts(repo, prev, paths),
    lineCounts(repo, base, paths),
  ])
  // 바이너리(줄 수에 없음)는 뺀다
  const files: FileLines[] = paths
    .filter((p) => before.has(p) && after.has(p))
    .map((p) => ({ path: p, base: before.get(p) ?? null, head: after.get(p) ?? null }))
  return specs.flatMap((spec) => {
    const r = fileLinesRatchet(spec, files)
    return r.status === 'worse' ? regressions(r, '앞 기록 뒤 기준에 들어옴') : []
  })
}

/** request.md 끝에 붙이는 절. 없으면 빈 글 */
export function unrecordedSection(lines: string[]): string {
  if (lines.length === 0) return ''
  return [
    '',
    UNRECORDED_TITLE,
    '',
    '실적 장부의 앞 기록과 견주면, 기준 브랜치에 래칫이 나빠진 채 들어왔는데 `.relay/debt/`에 빚으로 적히지 않았습니다. 계약을 쓸 때 사람에게 알리세요(이번 일의 범위는 사람과 정합니다).',
    '',
    ...lines.map((l) => `- ${l}`),
    '',
  ].join('\n')
}

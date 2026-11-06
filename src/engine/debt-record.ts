// 받아들인 나빠짐의 빚 기록 (M3b, docs/m3-design.md 3절, V40). 앱이 [빚으로 남기고 머지·끝내기]에서 쓸 빚 파일과 커밋
// 메시지(트레일러), 새 Work를 만들 때 실적 장부의 앞 기록과 기준 브랜치를 견줘 찾는 '기록 안 된 나빠짐'. 빚의 모양은 core
// debt.ts(debtFromRatchet, formatDebt, parseDebt)다. git은 읽기만 한다(커밋은 adapters/git-write.ts).

import { changedPaths, lineCounts, lsTree, revParse, showFile } from '../adapters/git.ts'
import { debtFromRatchet, formatDebt, parseDebt } from '../core/debt.ts'
import type { LedgerEntry } from '../core/ledger.ts'
import { parseQuality } from '../core/quality.ts'
import { fileLinesRatchet, type FileLines } from '../core/ratchet.ts'
import type { DebtItem, RatchetResult } from '../core/types.ts'
import { QUALITY_PATH } from './check.ts'

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

const exportOf = (e: LedgerEntry) => e.export ?? null

/**
 * 새 Work의 기준(base)에 기록 안 된 나빠짐이 있나. 앞 기록은 실적 장부에서 이 프로젝트의 마지막 머지(merged_head)다.
 * (1) 그 머지가 앱 밖(human-override)이었으면 장부의 그 head 결론 줄에 남은 나빠진 래칫. (2) 그 head에서 기준까지 바뀐
 * 파일을 기준의 품질 기준의 file_lines 래칫으로 잰 나빠짐(앞 기록 뒤 앱을 거치지 않고 들어온 것). 기준의 .relay/debt/에
 * 같은 경로·래칫의 accepted_regression 항목이 있으면 기록된 것이다. 시험 수·명령 래칫은 기준에서 돌리지 않으므로 (1)로만
 * 본다. 장부에 머지가 없으면 빈 것
 */
export async function unrecordedRegressions(o: {
  repo: string
  base: string
  ledger: LedgerEntry[]
  project: string
}): Promise<string[]> {
  const mine = o.ledger.filter((e) => e.project === o.project)
  const last = mine.findLast((e) => e.merged_head !== undefined)
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
  if (known !== null && known !== base) found.push(...(await sinceRecord(o.repo, known, base)))
  const { items } = await debtAt(o.repo, base)
  const recorded = (g: Regression) =>
    items.some(
      (d) =>
        d.kind === 'accepted_regression' &&
        d.anchor.path === g.path &&
        d.anchor.metric === g.metric,
    )
  const lines = [...new Set(found.filter((g) => !recorded(g)).map((g) => g.text))]
  const shown = lines.slice(0, UNRECORDED_MAX)
  return lines.length > shown.length ? [...shown, `외 ${lines.length - shown.length}개`] : shown
}

/** 앞 기록(prev)에서 기준(base)까지 바뀐 파일의 file_lines 래칫 나빠짐. 품질 기준이 없거나 깨졌으면 빈 것 */
async function sinceRecord(repo: string, prev: string, base: string): Promise<Regression[]> {
  const text = await showFile(repo, base, QUALITY_PATH)
  const q = text === null ? null : parseQuality(text)
  const specs = q?.ok ? q.value.ratchets.filter((r) => r.kind === 'file_lines') : []
  if (specs.length === 0) return []
  const paths = await changedPaths(repo, prev, base)
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

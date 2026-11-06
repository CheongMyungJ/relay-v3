// 곁들일 정리 (M3c, docs/m3-design.md 4절, V41). 빚의 모양과 읽기는 core debt.ts와 debt-record.ts(debtAt)다.
// - 읽기: 새 Work의 request.md 끝에 기준의 `.relay/debt/` 목록(나이 순, 경로와 한 줄, 30개까지. 넘으면 수만). 다른 진행 중
//   Work가 계약 tidy로 집은 항목은 '진행 중: 잡힘(<Work id>)'(잡힘은 앱이 저장소에서 읽는다, main/works-debt.ts claimedDebt).
// - 확인(증거, 알림): 기준의 빚 가운데 계약 tidy의 것, 이 diff가 바꾼 경로에 닿은 것, 이 diff가 항목 파일을 바꾼 것마다
//   종류별 결정론 갚음(paid·open·unknown), 계약 tidy 항목의 anchor에 닿은 바뀐 파일의 바뀐 줄(정리 몫)과 상한
//   (quality.json tidy_max_lines, 기본 100). 사람 머지 사실이 아니다.

import { dirsOf, lineCounts, lsTree, revParse } from '../adapters/git.ts'
import { touching } from '../core/debt.ts'
import type {
  Contract,
  DebtItem,
  DebtPayoff,
  DiffFacts,
  EvidenceBundle,
  QualityConfig,
} from '../core/types.ts'
import { DEBT_DIR, debtAt } from './debt-record.ts'

/** request.md에 붙이는 빚 목록의 제목 */
export const TIDY_TITLE = '## 이 레포의 빚 (relay가 읽음)'

/** 목록은 이만큼까지. 넘으면 수만 쓴다 */
export const TIDY_LIST_MAX = 30

/** quality.json에 tidy_max_lines가 없을 때 정리 몫의 상한 */
export const DEFAULT_TIDY_MAX_LINES = 100

export type TidyEvidence = NonNullable<EvidenceBundle['tidy']>

const debtFile = (id: string) => `${DEBT_DIR}/${id}.md`
const inDebtDir = (path: string) => path.startsWith(`${DEBT_DIR}/`)
const firstLine = (text: string) => text.trim().split(/\r?\n/)[0]?.trim() ?? ''

/** 나이 순: created가 이른 것부터, 같으면 id */
export function byAge(items: DebtItem[]): DebtItem[] {
  return [...items].sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id))
}

/** request.md 끝에 붙이는 절(앞에 빈 줄). claims는 빚 id → 집은 Work id. 항목이 없으면 빈 글 */
export function debtSection(items: DebtItem[], claims: ReadonlyMap<string, string>): string {
  if (items.length === 0) return ''
  const head = [
    '',
    TIDY_TITLE,
    '',
    `\`${DEBT_DIR}/\`의 빚 ${items.length}개입니다(오래된 것부터). 이번 Work가 바꿀 경로의 항목은 계약의 \`tidy\`에 넣을 수 있고, 사람이 계약에서 받거나 뺍니다. '진행 중'은 다른 Work가 집은 항목입니다.`,
    '',
  ]
  if (items.length > TIDY_LIST_MAX) {
    const taken = items.filter((i) => claims.has(i.id)).length
    const note = `${TIDY_LIST_MAX}개가 넘어 목록을 붙이지 않습니다(진행 중 ${taken}개). \`${DEBT_DIR}/\`를 읽으세요.`
    return [...head, note, ''].join('\n')
  }
  const lines = byAge(items).map((i) => {
    const by = claims.get(i.id)
    const tail = by === undefined ? '' : `, 진행 중: 잡힘(${by})`
    return `- \`${i.anchor.path}\`: ${firstLine(i.reason)} (${i.id}, ${i.kind}, ${i.created}${tail})`
  })
  return [...head, ...lines, ''].join('\n')
}

/** 기준(ref)의 빚 목록 절. 없으면 빈 글 */
export async function repoDebtSection(
  root: string,
  ref: string,
  claims: ReadonlyMap<string, string>,
): Promise<string> {
  const { items } = await debtAt(root, await revParse(root, ref))
  return debtSection(items, claims)
}

/** 한 항목의 head 사실 */
export interface PayoffFacts {
  /** 항목 파일(.relay/debt/<id>.md)이 head에 없다 */
  deleted: boolean
  /** anchor 파일의 head 줄 수. 파일이 없으면 null, 셀 수 없으면(폴더, 바이너리) undefined */
  lines: number | null | undefined
}

/**
 * 종류마다 갚았나. accepted_regression(file_lines 래칫): 그 파일이 max 이하가 되었거나 없어졌으면 갚음. tidy·test_gap: 세션이
 * 항목 파일을 지웠으면 갚음(한 일은 사람이 PR에서 본다). rule_violation은 규칙 승격(M3d) 전이라 가르지 못한다
 */
export function payoff(
  item: DebtItem,
  q: QualityConfig | null,
  f: PayoffFacts,
): Pick<DebtPayoff, 'status' | 'detail'> {
  const file = f.deleted ? '항목 파일을 지움' : '항목 파일이 남음'
  switch (item.kind) {
    case 'tidy':
    case 'test_gap':
      return { status: f.deleted ? 'paid' : 'open', detail: file }
    case 'rule_violation':
      return { status: 'unknown', detail: `규칙 승격(M3d) 전이라 가르지 못함 (${file})` }
    case 'accepted_regression': {
      const metric = item.anchor.metric ?? '?'
      const spec = q?.ratchets.find((r) => r.id === metric)
      if (spec === undefined)
        return {
          status: 'unknown',
          detail: `래칫 ${metric}이 품질 기준에 없어 가르지 못함 (${file})`,
        }
      if (spec.kind !== 'file_lines')
        return {
          status: 'unknown',
          detail: `래칫 ${metric}은 파일 줄 수가 아니라 가르지 못함 (${file})`,
        }
      if (f.lines === null) return { status: 'paid', detail: `파일이 없어짐 (${file})` }
      if (f.lines === undefined)
        return { status: 'unknown', detail: `줄 수를 셀 수 없음 (${file})` }
      return f.lines <= spec.max
        ? { status: 'paid', detail: `${f.lines}줄 ≤ ${spec.max} (${file})` }
        : { status: 'open', detail: `${f.lines}줄 > ${spec.max} (${file})` }
    }
  }
}

/** tidyEvidence의 입력: 기준의 빚과 head의 사실 */
export interface TidyInput {
  /** 기준(diff.base)의 빚 항목 */
  items: DebtItem[]
  /** 기준에 파일은 있는데 형식이 깨져 읽지 못한 id */
  broken: ReadonlySet<string>
  /** 계약의 tidy */
  taken: string[]
  diff: DiffFacts
  q: QualityConfig | null
  /** head에 있는 파일인가(폴더도) */
  exists: (path: string) => boolean
  /** head의 파일 줄 수(셀 수 있는 것만) */
  lines: ReadonlyMap<string, number>
}

/** 묶음의 tidy 칸(순수). 항목은 계약 tidy의 차례, 그 뒤 나이 순 */
export function tidyEvidence(o: TidyInput): TidyEvidence {
  const taken = [...new Set(o.taken)]
  const changed = new Set(o.diff.files.flatMap((f) => [f.path, f.old_path ?? f.path]))
  const code = [...changed].filter((p) => !inDebtDir(p))
  const touched = new Set(touching(o.items, code).map((i) => i.id))
  const judge = (i: DebtItem): DebtPayoff => ({
    id: i.id,
    path: i.anchor.path,
    kind: i.kind,
    reason: firstLine(i.reason),
    ...payoff(i, o.q, {
      deleted: !o.exists(debtFile(i.id)),
      lines: !o.exists(i.anchor.path) ? null : o.lines.get(i.anchor.path),
    }),
  })
  const byId = new Map(o.items.map((i) => [i.id, i]))
  const mine = taken.map((id): DebtPayoff => {
    const item = byId.get(id)
    if (item !== undefined) return judge(item)
    const detail = o.broken.has(id) ? '기준의 항목 파일을 읽지 못함(형식)' : '기준의 빚 장부에 없음'
    return { id, path: '', kind: null, reason: '', status: 'unknown', detail }
  })
  const others = byAge(o.items)
    .filter((i) => !taken.includes(i.id) && (touched.has(i.id) || changed.has(debtFile(i.id))))
    .map(judge)
  // 정리 몫: 계약 tidy 항목의 anchor에 닿은 바뀐 파일(빚 폴더 밖)의 더한 줄과 뺀 줄
  const takenItems = o.items.filter((i) => taken.includes(i.id))
  const lines = o.diff.files
    .filter((f) => !inDebtDir(f.path))
    .filter((f) => touching(takenItems, [f.path, ...(f.old_path ? [f.old_path] : [])]).length > 0)
    .reduce((n, f) => n + f.added + f.deleted, 0)
  return {
    taken,
    items: [...mine, ...others],
    lines,
    max: o.q?.tidy_max_lines ?? DEFAULT_TIDY_MAX_LINES,
  }
}

/** 이 diff의 곁들일 정리 확인. 증거 묶음의 tidy 칸이다. git만 읽는다 */
export async function checkTidy(
  root: string,
  diff: DiffFacts,
  q: QualityConfig | null,
  contract: Contract | null,
): Promise<TidyEvidence> {
  const { ids, items } = await debtAt(root, diff.base)
  const read = new Set(items.map((i) => i.id))
  const paths = await lsTree(root, diff.head)
  const files = new Set(paths)
  const dirs = dirsOf(paths)
  const exists = (p: string) => files.has(p) || dirs.has(p.replace(/\/+$/, ''))
  const anchors = items
    .filter((i) => i.kind === 'accepted_regression' && files.has(i.anchor.path))
    .map((i) => i.anchor.path)
  const lines = new Map<string, number>()
  for (const [p, n] of await lineCounts(root, diff.head, anchors)) if (n !== null) lines.set(p, n)
  return tidyEvidence({
    items,
    broken: new Set([...ids].filter((id) => !read.has(id))),
    taken: contract?.tidy ?? [],
    diff,
    q,
    exists,
    lines,
  })
}

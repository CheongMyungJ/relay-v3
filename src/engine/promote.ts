// 규칙 승격 (M3d, docs/m3-design.md 5절, V42). 지식의 규칙 항목은 선택 머리글 `check: <명령이나 lint 규칙 이름>`으로 그
// 규칙을 보는 검사를 적는다. 그 이름이 품질 기준(V9: base 먼저)의 `rules`에 있으면 승격된 규칙이다.
// - 확인(증거, 묶음의 knowledge.issues): head의 규칙 항목 가운데 승격되지 않은 것은 spoken(말로만, 알림). 기준에서 승격된
//   규칙의 `## 아직 규칙을 따르지 않는 곳`은 그 검사의 허용 목록이라 줄어들기만 한다: 늘었으면 allow(사람 머지 사실).
// - 갚음(곁들일 정리 M3c의 rule_violation): anchor.metric이 승격된 검사이고, anchor 경로가 그 검사를 적은 head 규칙 항목의
//   허용 목록에 없고, 빠른 명령이 모두 통과하면 갚음.
// 순수 함수(promoteIssues, ruleFacts, fastOutcome, rulePayoff)와 git 읽기(checkPromote)를 함께 둔다(src/core 상한).

import { showFile } from '../adapters/git.ts'
import { parseQuality, QUALITY_PATH } from '../core/quality.ts'
import type {
  CommandEvidence,
  DebtItem,
  DebtPayoff,
  DiffFacts,
  KnowledgeIssue,
  QualityConfig,
} from '../core/types.ts'
import { readEntries } from './knowledge.ts'
import { NOT_YET, checkOf, isRule, notYetPaths, type KnowledgeEntry } from './knowledge-format.ts'

const code = (s: string) => `\`${s}\``

export interface PromoteInput {
  /** 기준(diff.base)의 지식 항목 */
  base: readonly KnowledgeEntry[]
  /** head의 지식 항목 */
  head: readonly KnowledgeEntry[]
  /** 이 diff가 옮긴 파일: 기준 경로 → head 경로 */
  renamed: ReadonlyMap<string, string>
  /** 판정에 쓴 품질 기준의 rules. 품질 기준이 없으면 null */
  rules: readonly string[] | null
  /** head의 quality.json rules(없거나 읽지 못하면 null). 이 diff가 rules에 더한 검사를 알린다 */
  headRules: readonly string[] | null
}

/** 규칙 승격의 문제(순수): 기준에서 승격된 규칙의 늘어난 허용 목록(allow), head의 승격되지 않은 규칙(spoken). 경로 차례 */
export function promoteIssues(o: PromoteInput): KnowledgeIssue[] {
  const promoted = (check: string | null): check is string =>
    check !== null && (o.rules?.includes(check) ?? false)
  const head = new Map(o.head.map((e) => [e.path, e]))
  const allow: KnowledgeIssue[] = []
  for (const before of o.base) {
    const check = checkOf(before.text)
    if (!promoted(check)) continue
    // 지운 항목은 diff가 보인다(사람이 PR에서 본다). 옮긴 항목은 새 자리와 견준다
    const path = o.renamed.get(before.path) ?? before.path
    const after = head.get(path)
    if (after === undefined) continue
    const was = new Set(notYetPaths(before.text))
    const added = notYetPaths(after.text).filter((p) => !was.has(p))
    if (added.length > 0)
      allow.push({
        path,
        kind: 'allow',
        detail: `검사 ${code(check)}의 허용 목록(${code(`## ${NOT_YET}`)})에 ${added.map(code).join(', ')}가 더해짐: 줄어들기만 한다`,
      })
  }
  const spoken: KnowledgeIssue[] = []
  for (const e of o.head) {
    if (!isRule(e.text)) continue
    const check = checkOf(e.text)
    if (promoted(check)) continue
    spoken.push({ path: e.path, kind: 'spoken', detail: spokenDetail(check, o) })
  }
  const byPath = (a: KnowledgeIssue, b: KnowledgeIssue) => a.path.localeCompare(b.path)
  return [...allow.sort(byPath), ...spoken.sort(byPath)]
}

function spokenDetail(check: string | null, o: PromoteInput): string {
  if (check === null) return '검사(`check:`)가 없음'
  if (o.rules === null) return `검사 ${code(check)}: 품질 기준이 없어 승격을 확인하지 못함`
  if (o.headRules?.includes(check) === true)
    return `검사 ${code(check)}가 기준의 quality.json rules에 없음(이 diff가 더함: 머지 뒤 승격)`
  return `검사 ${code(check)}가 quality.json rules에 없음`
}

/** 이 diff의 규칙 승격 확인. 묶음의 knowledge.issues에 더한다. git만 읽는다 */
export async function checkPromote(
  root: string,
  diff: DiffFacts,
  q: QualityConfig | null,
): Promise<KnowledgeIssue[]> {
  const [base, head, text] = await Promise.all([
    readEntries(root, diff.base),
    readEntries(root, diff.head),
    showFile(root, diff.head, QUALITY_PATH),
  ])
  const renamed = new Map<string, string>()
  for (const f of diff.files) if (f.status === 'R' && f.old_path) renamed.set(f.old_path, f.path)
  const parsed = text === null ? null : parseQuality(text)
  return promoteIssues({
    base,
    head,
    renamed,
    rules: q?.rules ?? null,
    headRules: parsed?.ok === true ? parsed.value.rules : null,
  })
}

// ── rule_violation의 갚음 (M3c를 잇는다) ─────────────────────────────────────

/** rule_violation 한 항목의 head 사실 */
export interface RuleFacts {
  /** anchor.metric의 검사를 `check:`에 적은 head의 규칙 항목 */
  entries: string[]
  /** 그 가운데 허용 목록에 anchor 경로가 아직 있는 항목 */
  allowed: string[]
  /** 이 묶음의 빠른 명령 */
  commands: FastOutcome
}

export type FastOutcome = 'pass' | 'fail' | 'unknown'

/** head 규칙 항목에서 한 항목의 사실(순수) */
export function ruleFacts(
  item: DebtItem,
  head: readonly KnowledgeEntry[],
  commands: FastOutcome,
): RuleFacts {
  const mine = head.filter(
    (e) => item.anchor.metric !== undefined && checkOf(e.text) === item.anchor.metric,
  )
  return {
    entries: mine.map((e) => e.path),
    allowed: mine.filter((e) => notYetPaths(e.text).includes(item.anchor.path)).map((e) => e.path),
    commands,
  }
}

/**
 * 빠른 명령(quality.json commands.fast)이 모두 통과했나. 실패와 원래 실패는 fail, 불안정·돌리지 못함·빠른 명령이 없음은 unknown.
 * 검사는 레포의 lint 설정이나 스크립트에 있고 빠른 명령이 그것을 돌린다(검사와 명령의 짝은 rules를 고친 사람이 본다)
 */
export function fastOutcome(
  q: QualityConfig | null,
  commands: readonly CommandEvidence[],
): FastOutcome {
  const ids = new Set((q?.commands.fast ?? []).map((s) => s.id))
  const fast = commands.filter((c) => ids.has(c.id))
  if (fast.length === 0) return 'unknown'
  if (fast.some((c) => c.outcome === 'fail' || c.outcome === 'pre_existing')) return 'fail'
  return fast.every((c) => c.outcome === 'pass') ? 'pass' : 'unknown'
}

/** rule_violation의 갚음(순수). r이 없으면 규칙 승격이 꺼짐. file은 항목 파일을 지웠는지의 글 */
export function rulePayoff(
  item: DebtItem,
  q: QualityConfig | null,
  r: RuleFacts | undefined,
  file: string,
): Pick<DebtPayoff, 'status' | 'detail'> {
  const unknown = (why: string) => ({ status: 'unknown' as const, detail: `${why} (${file})` })
  if (r === undefined) return unknown('규칙 승격(M3d)이 꺼져 있어 가르지 못함')
  const check = item.anchor.metric
  if (check === undefined) return unknown('검사 이름(anchor.metric)이 없어 가르지 못함')
  if (q?.rules.includes(check) !== true)
    return unknown(`검사 ${code(check)}가 quality.json rules에 없어(말로만) 가르지 못함`)
  if (r.entries.length === 0)
    return unknown(`검사 ${code(check)}를 \`check:\`에 적은 규칙 항목이 head에 없음`)
  const path = code(item.anchor.path)
  if (r.allowed.length > 0)
    return {
      status: 'open',
      detail: `${path}가 아직 허용 목록에 있음: ${r.allowed.join(', ')} (${file})`,
    }
  if (r.commands === 'pass')
    return { status: 'paid', detail: `${path}가 허용 목록에서 빠지고 빠른 명령이 통과 (${file})` }
  if (r.commands === 'fail')
    return { status: 'open', detail: `${path}가 허용 목록에서 빠졌지만 빠른 명령이 실패 (${file})` }
  return unknown(`${path}가 허용 목록에서 빠졌지만 빠른 명령의 결과를 모름`)
}

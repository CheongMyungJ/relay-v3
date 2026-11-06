// 지식 잇기의 git 쪽 (M3a, docs/m3-design.md 2절, V38). 형식과 고르기는 knowledge-format.ts(순수)다.
// - 읽기: 새 Work의 request.md 끝에 붙일 관련 항목 목록(기준 ref의 docs/knowledge/).
// - 근거 확인: 계약 줄의 근거 knowledge(항목 경로)가 head에 있는지.
// - 확인(증거): 이 diff가 바꾼 지식 파일의 형식, anchor가 head의 코드에 있는지, 바꾼 코드가 어느 항목의
//   `## 아직 규칙을 따르지 않는 곳`에 적혀 있는데 그 항목을 고치지 않았는지(v2 D296).

import type { DiffFacts, KnowledgeIssue } from '../core/types.ts'
import { hasWord, lsTree, showFile } from '../adapters/git.ts'
import {
  KNOWLEDGE_DIR,
  NOT_YET,
  anchorOf,
  checkEntryFormat,
  entryPathOf,
  isKnowledgePath,
  notYetPaths,
  relatedListText,
  type KnowledgeEntry,
} from './knowledge-format.ts'

/** 코드의 낱말(식별자 꼴) */
const WORD = /[A-Za-z_$][\w$]*/g

/** sha의 지식 항목 전부 */
export async function readEntries(root: string, sha: string): Promise<KnowledgeEntry[]> {
  const paths = (await lsTree(root, sha)).filter(isKnowledgePath)
  const texts = await Promise.all(paths.map((p) => showFile(root, sha, p)))
  return paths.flatMap((path, i) => {
    const text = texts[i]
    return text === null || text === undefined ? [] : [{ path, text }]
  })
}

/** 새 Work의 request.md 끝에 붙일 글(앞에 빈 줄). 항목이 없으면 빈 글 */
export async function relatedKnowledge(
  root: string,
  ref: string,
  request: string,
): Promise<string> {
  const list = relatedListText(await readEntries(root, ref), request)
  return list === '' ? '' : `\n${list}`
}

/** 근거 `{type: knowledge, id}`: 그 항목이 head에 있는지. fileAt은 head의 파일(없으면 null) */
export async function checkKnowledgeGround(
  id: string,
  fileAt: (path: string) => Promise<string | null>,
): Promise<{ ok: boolean; detail: string }> {
  const path = entryPathOf(id)
  if (path === null)
    return { ok: false, detail: `지식 항목 경로가 아님: ${KNOWLEDGE_DIR}/[<영역>/]<이름>.md` }
  return (await fileAt(path)) === null
    ? { ok: false, detail: `지식 항목이 head에 없음 (${path})` }
    : { ok: true, detail: `지식 항목이 있음 (${path})` }
}

const inDir = (p: string | undefined) => p !== undefined && p.startsWith(`${KNOWLEDGE_DIR}/`)
// 지식 폴더의 .md(README는 사람의 안내라 뺀다). 지식 경로가 아닌 것(영역이 두 단계, 영역 이름에 대문자 등)은 형식 오류다
const entryLike = (p: string | undefined) =>
  inDir(p) && p?.endsWith('.md') === true && !/\/readme\.md$/i.test(p)
const touchedOf = (diff: DiffFacts) =>
  diff.files.filter((f) => entryLike(f.path) || entryLike(f.old_path))

/** 이 diff가 바꾼 지식 파일(옮겼으면 새 자리, 지웠으면 옛 자리). 묶음의 knowledge.changed다 */
export function knowledgeChanged(diff: DiffFacts): string[] {
  const touched = touchedOf(diff)
  return [...new Set(touched.map((f) => (entryLike(f.path) ? f.path : (f.old_path ?? ''))))]
}

/** 이 diff의 지식 확인. 증거 묶음의 knowledge 칸이다 */
export async function checkKnowledge(
  root: string,
  diff: DiffFacts,
): Promise<{ changed: string[]; issues: KnowledgeIssue[] }> {
  const touched = touchedOf(diff)
  const changed = knowledgeChanged(diff)
  const issues: KnowledgeIssue[] = []
  for (const f of touched)
    if (f.status !== 'D' && entryLike(f.path) && !isKnowledgePath(f.path))
      issues.push({
        path: f.path,
        kind: 'format',
        detail: `지식 파일 경로가 아님: ${KNOWLEDGE_DIR}/<이름>.md나 ${KNOWLEDGE_DIR}/<영역>/<이름>.md(영역은 영어 소문자, 숫자, -)`,
      })
  const edited = new Set(touched.flatMap((f) => [f.path, f.old_path ?? f.path]))
  const code = diff.files.filter((f) => !inDir(f.path))
  const codePaths = new Set(code.flatMap((f) => [f.path, f.old_path ?? f.path]))
  const removed = new Set(code.flatMap((f) => f.removed_lines.join('\n').match(WORD) ?? []))
  const present = (name: string) => hasWord(root, diff.head, name, KNOWLEDGE_DIR)
  for (const e of await readEntries(root, diff.head)) {
    const anchor = anchorOf(e.text)
    const last = anchor?.split('.').pop() ?? ''
    if (edited.has(e.path)) {
      for (const detail of checkEntryFormat(e.text))
        issues.push({ path: e.path, kind: 'format', detail })
      if (last && !(await present(last)))
        issues.push({
          path: e.path,
          kind: 'anchor',
          detail: `anchor \`${anchor}\`가 head의 코드에 없음`,
        })
      continue
    }
    const hit = notYetPaths(e.text).filter((p) => codePaths.has(p))
    if (hit.length > 0)
      issues.push({
        path: e.path,
        kind: 'not_yet',
        detail: `이 diff가 ${hit.map((p) => `\`${p}\``).join(', ')}를 바꿨는데 항목의 \`## ${NOT_YET}\`에 그대로 있고 항목은 고치지 않음`,
      })
    if (last && removed.has(last) && !(await present(last)))
      issues.push({
        path: e.path,
        kind: 'anchor',
        detail: `이 diff가 anchor \`${anchor}\`를 코드에서 지웠는데 항목은 그대로`,
      })
  }
  return { changed, issues }
}

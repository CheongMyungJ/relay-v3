// 지식 항목의 형식과 고르기 (M3a, docs/m3-design.md 2절, V38). v2의 지식 형식(v2 D293, D296, D299)과 v2 core/knowledge.ts의
// isKnowledgePath·checkEntryFormat·notYetPaths·rankEntries(v2 D295의 점수)를 옮겼다. 순수 함수지만 src/core 상한(5,000줄) 때문에
// engine에 둔다(Node 내장과 adapters를 가져오지 않는다). 머리글은 YAML이 아니라 `key: value` 줄로 읽는다(v3에 YAML 의존성이 없다).

/** 레포 안의 지식 폴더 */
export const KNOWLEDGE_DIR = 'docs/knowledge'

/** request.md 끝에 붙이는 관련 항목의 수 상한(v2 PICK_LIMIT) */
export const PICK_LIMIT = 15

/** request.md 끝에 붙이는 목록의 제목 */
export const LIST_HEADING = '## 관련 지식 (relay가 고름)'

export interface KnowledgeEntry {
  /** 레포 안의 경로 (`docs/knowledge/[<영역>/]<이름>.md`) */
  path: string
  text: string
}

const KINDS = ['rule', 'fact', 'history', 'pitfall']
const SOURCES = ['human', 'investigation']
const RULE = '규칙'
const BODY = '내용'
/** 규칙을 아직 따르지 않는 코드(고칠 곳, v2 D296). 규칙 항목에만 둔다 */
export const NOT_YET = '아직 규칙을 따르지 않는 곳'
/** 사람이 아직 정하지 않은 것(v2 D299). 규칙 항목에만 둔다 */
const UNDECIDED = '아직 정하지 않은 것'
const HISTORY = '바뀐 이력'
const KNOWN = [RULE, BODY, NOT_YET, UNDECIDED, HISTORY]
/** 규칙이 붙은 코드 이름: 식별자나 점으로 이은 식별자 */
const ANCHOR = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/

/**
 * 지식 파일인가: `docs/knowledge/<이름>.md` 또는 영역 폴더 한 단계 아래 `docs/knowledge/<영역>/<이름>.md`(README.md는 뺀다).
 * 영역 이름은 영어 소문자, 숫자, `-`다
 */
export function isKnowledgePath(p: string): boolean {
  const norm = p.replace(/\\/g, '/')
  if (!norm.startsWith(`${KNOWLEDGE_DIR}/`)) return false
  const m = /^(?:([a-z0-9][a-z0-9-]*)\/)?([^/]+\.md)$/.exec(norm.slice(KNOWLEDGE_DIR.length + 1))
  return m !== null && (m[2] ?? '').toLowerCase() !== 'readme.md'
}

/** 계약 근거 `{type: knowledge, id}`의 id를 항목 경로로: 앞의 `docs/knowledge/`와 끝의 `.md`는 없어도 된다. 아니면 null */
export function entryPathOf(id: string): string | null {
  let p = id.trim().replace(/\\/g, '/').replace(/^\.\//, '')
  if (!p.startsWith(`${KNOWLEDGE_DIR}/`)) p = `${KNOWLEDGE_DIR}/${p}`
  if (!p.toLowerCase().endsWith('.md')) p = `${p}.md`
  return isKnowledgePath(p) ? p : null
}

// ── 머리글과 절 ─────────────────────────────────────────────────────────────

type Front = { ok: true; data: Map<string, string>; body: string } | { ok: false; error: string }

const normalize = (text: string) => text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')

/** 첫 줄 `---`부터 다음 `---` 줄까지의 `key: value` 줄. 값의 앞뒤 따옴표는 벗기고, 빈 값은 칸이 없는 것으로 본다 */
function frontMatter(text: string): Front {
  const lines = normalize(text).split('\n')
  if (lines[0]?.trimEnd() !== '---')
    return { ok: false, error: '머리글 없음: 첫 줄이 `---`여야 함' }
  const end = lines.findIndex((l, i) => i > 0 && l.trimEnd() === '---')
  if (end < 0) return { ok: false, error: '머리글이 닫히지 않음: 머리글 끝에 `---` 줄이 필요함' }
  const data = new Map<string, string>()
  for (let i = 1; i < end; i++) {
    const line = lines[i] ?? ''
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    const m = /^([A-Za-z_][\w.-]*)[ \t]*:(.*)$/.exec(line)
    if (!m) return { ok: false, error: `머리글 ${i}번 줄이 \`key: value\` 모양이 아님` }
    const key = m[1] ?? ''
    if (data.has(key)) return { ok: false, error: `머리글의 \`${key}\`가 두 번 적힘` }
    const value = (m[2] ?? '').trim().replace(/^(["'])(.*)\1$/, '$2')
    if (value !== '') data.set(key, value)
  }
  return { ok: true, data, body: lines.slice(end + 1).join('\n') }
}

const bodyOf = (text: string) => {
  const fm = frontMatter(text)
  return fm.ok ? fm.body : normalize(text)
}

/** 줄마다 코드 펜스 안인가 */
function markFences(lines: readonly string[]): { line: string; fenced: boolean }[] {
  let fence: string | null = null
  return lines.map((line) => {
    const mark = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (mark !== undefined) {
      if (fence === null) fence = mark
      else if (mark[0] === fence[0] && mark.length >= fence.length) fence = null
      return { line, fenced: true }
    }
    return { line, fenced: fence !== null }
  })
}

function headingText(line: string, level: number): string | null {
  return new RegExp(`^#{${level}}[ \\t]+(.*?)[ \\t]*$`).exec(line)?.[1] ?? null
}

/** 본문의 level 단계 제목(코드 펜스 안은 빼고) */
function headings(body: string, level: number): string[] {
  return markFences(body.split('\n'))
    .filter((l) => !l.fenced)
    .map((l) => headingText(l.line, level))
    .filter((h): h is string => h !== null)
}

/** `## name` 절의 본문(다음 `#`·`##` 제목 앞까지, 앞뒤 빈 줄은 뺌). 절이 없으면 null */
function sectionText(body: string, name: string): string | null {
  const lines = markFences(body.split('\n'))
  const start = lines.findIndex((l) => !l.fenced && headingText(l.line, 2) === name)
  if (start < 0) return null
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => !l.fenced && /^#{1,2}[ \t]/.test(l.line))
  return (end < 0 ? rest : rest.slice(0, end))
    .map((l) => l.line)
    .join('\n')
    .trim()
}

/** 항목의 제목: 본문의 코드 펜스 밖 첫 `# ` 줄. 없으면 파일 이름 */
export function entryTitle(e: KnowledgeEntry): string {
  const title = headings(bodyOf(e.text), 1).find((h) => h.trim())
  return (title ?? e.path.split('/').pop() ?? e.path).trim()
}

/** 항목의 `anchor`. 형식에 맞지 않거나 없으면 null */
export function anchorOf(text: string): string | null {
  const fm = frontMatter(text)
  const a = fm.ok ? fm.data.get('anchor') : undefined
  return a !== undefined && ANCHOR.test(a) ? a : null
}

/** 규칙 항목(머리글이 읽히고 `kind: rule`)인가 */
export function isRule(text: string): boolean {
  const fm = frontMatter(text)
  return fm.ok && fm.data.get('kind') === 'rule'
}

/** 규칙 항목의 선택 머리글 `check:`(검사의 명령이나 lint 규칙 이름, M3d V42). 규칙이 아니거나 없으면 null */
export function checkOf(text: string): string | null {
  const fm = frontMatter(text)
  return fm.ok && fm.data.get('kind') === 'rule' ? (fm.data.get('check') ?? null) : null
}

/** 글에 나온 파일 경로(`a/b.c` 꼴) */
export function pathsIn(text: string): string[] {
  return [...new Set(text.match(/[\w.-]+(?:\/[\w.-]+)+\.[A-Za-z0-9]+/g) ?? [])]
}

/** 글에 나온 코드 이름: 영문자로 시작하는 4자 이상 식별자 */
export function identifiersIn(text: string): Set<string> {
  return new Set(text.match(/\b[A-Za-z_$][\w$]{3,}\b/g) ?? [])
}

/** 항목의 `## 아직 규칙을 따르지 않는 곳`에 적힌 파일 경로. 목록 줄 맨 앞의 레포 맨 위 파일(`pricing.py`)도 읽는다 */
export function notYetPaths(text: string): string[] {
  const section = sectionText(bodyOf(text), NOT_YET)
  if (!section) return []
  const top = [...section.matchAll(/^\s*[-*]\s*`?([\w.-]+\.[A-Za-z0-9]+)`?/gm)].map(
    (m) => m[1] ?? '',
  )
  return [...new Set([...pathsIn(section), ...top].map((p) => p.replace(/^\.\//, '')))]
}

/**
 * 지식 파일의 형식(v2 checkEntryFormat): 머리글의 `kind`·`source`(허용 값)·`anchor`(선택), 첫 `# ` 제목, 본문 절(rule은
 * `## 규칙`, 나머지는 `## 내용`), 알려진 절만, `## 아직 규칙을 따르지 않는 곳`·`## 아직 정하지 않은 것`은 rule에만. 문제마다 한 줄
 */
export function checkEntryFormat(text: string): string[] {
  const fm = frontMatter(text)
  if (!fm.ok) return [`${fm.error}. 지식 파일은 \`kind\`, \`source\` 머리글로 시작한다`]
  const out: string[] = []
  const kind = fm.data.get('kind')
  if (kind === undefined || !KINDS.includes(kind))
    out.push(`\`kind\`는 ${KINDS.join(' | ')} 가운데 하나`)
  const source = fm.data.get('source')
  if (source === undefined || !SOURCES.includes(source))
    out.push(`\`source\`는 ${SOURCES.join(' | ')} 가운데 하나`)
  const anchor = fm.data.get('anchor')
  if (anchor !== undefined && !ANCHOR.test(anchor))
    out.push('`anchor`는 코드 이름(식별자) 하나. 없으면 필드를 뺀다')
  const body = fm.body
  if (!headings(body, 1).some((h) => h.trim())) out.push('첫 `# ` 제목 줄 없음')
  const main = kind === 'rule' ? RULE : BODY
  if (!sectionText(body, main))
    out.push(`\`## ${main}\` 절이 없거나 비었음 (kind: ${kind ?? '없음'})`)
  for (const h of headings(body, 2)) {
    if (!KNOWN.includes(h))
      out.push(`모르는 절 \`## ${h}\`: ${KNOWN.map((k) => `\`## ${k}\``).join(', ')}만 쓴다`)
    else if (h !== main && (h === RULE || h === BODY))
      out.push(`kind: ${kind ?? '없음'}의 본문 절은 \`## ${main}\`이다`)
  }
  for (const only of [NOT_YET, UNDECIDED])
    if (kind !== 'rule' && sectionText(body, only) !== null)
      out.push(`\`## ${only}\`은 kind: rule에만 둔다`)
  return out
}

// ── 고르기 (v2 D295) ────────────────────────────────────────────────────────

/** 고르는 단서: 낱말을 견줄 글, 글에 나온 경로와 코드 이름 */
export interface KnowledgeQuery {
  text: string
  paths: readonly string[]
  identifiers: ReadonlySet<string>
}

const HANGUL = /[가-힣]/

/** 낱말: 한글은 붙은 글자 둘씩(조사가 붙어도 겹치게), 나머지는 소문자 낱말(3자 이상) */
export function termsOf(text: string): Set<string> {
  const out = new Set<string>()
  for (const w of text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []) {
    if (HANGUL.test(w)) {
      const chars = [...w].filter((c) => HANGUL.test(c))
      for (let k = 0; k + 1 < chars.length; k++) out.add(`${chars[k]}${chars[k + 1]}`)
    } else if (w.length >= 3) out.add(w)
  }
  return out
}

/** 규칙이나 내용 절, 없으면 본문 전체(옛 형식)와 제목 */
function coreText(e: KnowledgeEntry): string {
  const body = bodyOf(e.text)
  return [entryTitle(e), sectionText(body, RULE) ?? sectionText(body, BODY) ?? body].join('\n')
}

/**
 * 관련 점수(v2 rankEntries): 같은 anchor 5, 경로 겹침 4(같은 파일)·2(같은 폴더), 영역 2, 낱말 3(질의와 겹친 낱말의 무게 / 항목
 * 낱말의 무게, 드문 낱말일수록 무겁다). 높은 차례, 같으면 경로 차례. v2의 머지 전 항목 0.5는 v3에 머지 전 지식이 없어 뺐다
 */
export function rankEntries(
  entries: readonly KnowledgeEntry[],
  q: KnowledgeQuery,
): { entry: KnowledgeEntry; score: number }[] {
  const qTerms = termsOf(q.text)
  const docTerms = entries.map((e) => termsOf(coreText(e)))
  const df = new Map<string, number>()
  for (const ts of docTerms) for (const t of ts) df.set(t, (df.get(t) ?? 0) + 1)
  const idf = (t: string) => Math.log(1 + entries.length / (df.get(t) ?? 1))
  const qPaths = q.paths.map((p) => p.replace(/^\.\//, ''))
  const dirOf = (p: string) => p.split('/').slice(0, -1).join('/')
  const qDirs = new Set(qPaths.map(dirOf).filter(Boolean))
  const qSegments = new Set(qPaths.flatMap((p) => p.toLowerCase().split('/')))
  return entries
    .map((entry, k) => {
      let score = 0
      const anchor = anchorOf(entry.text)
      const last = anchor?.split('.').pop()
      if (anchor && (q.identifiers.has(anchor) || (last && q.identifiers.has(last)))) score += 5
      const ePaths = pathsIn(entry.text).map((p) => p.replace(/^\.\//, ''))
      if (ePaths.some((p) => qPaths.includes(p))) score += 4
      else if (ePaths.some((p) => qDirs.has(dirOf(p)))) score += 2
      const area = /^docs\/knowledge\/([^/]+)\/[^/]+$/.exec(entry.path)?.[1]
      if (area && (qSegments.has(area) || qTerms.has(area))) score += 2
      let all = 0
      let hit = 0
      for (const t of docTerms[k] ?? []) {
        all += idf(t)
        if (qTerms.has(t)) hit += idf(t)
      }
      if (all > 0) score += (3 * hit) / all
      return { entry, score }
    })
    .sort((a, b) => b.score - a.score || a.entry.path.localeCompare(b.entry.path))
}

/**
 * request.md 끝에 붙이는 관련 항목 목록(제목과 경로, PICK_LIMIT개까지): 요청 글의 낱말·경로·코드 이름과 겹치는(점수가 있는)
 * 항목만. 본문은 넣지 않는다(모델이 읽는다). 항목이 없으면 빈 글, 있는데 겹치는 것이 없으면 그렇다고 한 줄
 */
export function relatedListText(entries: readonly KnowledgeEntry[], request: string): string {
  if (entries.length === 0) return ''
  const q = { text: request, paths: pathsIn(request), identifiers: identifiersIn(request) }
  const picked = rankEntries(entries, q)
    .filter((r) => r.score > 0)
    .slice(0, PICK_LIMIT)
  const head = `\`${KNOWLEDGE_DIR}/\`의 항목 ${entries.length}개`
  if (picked.length === 0)
    return `${LIST_HEADING}\n\n${head} 가운데 이 요청과 겹치는 것을 찾지 못했습니다.\n`
  const items = picked.map(
    (r) => `- ${entryTitle(r.entry).replace(/\s+/g, ' ')} — \`${r.entry.path}\``,
  )
  return `${LIST_HEADING}\n\n${head} 가운데 이 요청과 겹치는 ${picked.length}개입니다(제목과 경로). 본문은 파일을 읽으세요. 목록에 없는 항목도 관련 있을 수 있습니다.\n\n${items.join('\n')}\n`
}

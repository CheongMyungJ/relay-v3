// 빚 장부 (.relay/debt/<id>.md, docs/m1-modules.md debt.ts).
// 한 항목 = anchor · 종류 · 출처 · 까닭 · 날짜. 머리글은 `---` 사이의 `key: value` 줄, 본문은 까닭.
// 한 줄에 그대로 못 쓰는 값(앞뒤·연속 공백, 제어 글자, 역슬래시, '"'로 시작)은 JSON 문자열로 감싼다.

import { err, ok, type Result } from './result.ts'
import type { DebtItem, DebtKind, RatchetResult } from './types.ts'

const KINDS: DebtKind[] = ['tidy', 'accepted_regression', 'rule_violation', 'test_gap']

const KEYS = ['anchor.path', 'anchor.name', 'anchor.metric', 'kind', 'source', 'created'] as const
type Key = (typeof KEYS)[number]
const REQUIRED: Key[] = ['anchor.path', 'kind', 'source', 'created']

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** 파일이 없는 래칫의 빚을 다는 곳 */
const QUALITY_FILE = '.relay/quality.json'

// ── 읽기 ────────────────────────────────────────────────────────────────────

export function parseDebt(text: string, id: string): Result<DebtItem> {
  const errors: string[] = []
  if (!ID.test(id)) errors.push(`id가 올바르지 않음: '${id}'`)
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/)
  if (lines[0]?.trim() !== '---') return err(...errors, '머리글(---)로 시작해야 함')
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---')
  if (end < 0) return err(...errors, '머리글이 닫히지 않음(---)')

  const fields = new Map<Key, string>()
  const quoted = new Set<Key>()
  for (let i = 1; i < end; i++) {
    const raw = lines[i] ?? ''
    if (raw.trim() === '') continue
    const colon = raw.indexOf(':')
    const key = colon < 0 ? '' : raw.slice(0, colon).trim()
    const text = raw.slice(colon + 1).trim()
    const value = text.startsWith('"') ? unquote(text) : text
    if (colon < 0) errors.push(`머리글 ${i}번 줄: 'key: value' 모양이 아님`)
    else if (!isKey(key)) errors.push(`머리글 ${i}번 줄: 알 수 없는 키 (${key})`)
    else if (fields.has(key)) errors.push(`${key}: 두 번 적힘`)
    else if (value === null) errors.push(`${key}: 따옴표 값을 읽지 못함`)
    else if (value.trim() === '') errors.push(`${key}: 값이 비어 있음`)
    else {
      fields.set(key, value)
      if (text.startsWith('"')) quoted.add(key)
    }
  }
  for (const key of REQUIRED) if (!fields.has(key)) errors.push(`${key}: 필요함`)

  const path = fields.get('anchor.path')
  // 역슬래시는 따옴표로 감싼 값(formatDebt가 실제 파일 이름을 쓴 것)에서만 받는다
  if (path !== undefined && !isRepoPath(path, quoted.has('anchor.path')))
    errors.push(`anchor.path: 레포 안의 상대 경로여야 함 (${path})`)
  const kind = fields.get('kind')
  if (kind !== undefined && !isKind(kind))
    errors.push(`kind: ${KINDS.join(', ')} 가운데 하나여야 함 (${kind})`)
  const created = fields.get('created')
  if (created !== undefined && !isDate(created))
    errors.push(`created: YYYY-MM-DD 날짜여야 함 (${created})`)
  const reason = lines
    .slice(end + 1)
    .join('\n')
    .trim()
  if (reason === '') errors.push('까닭(본문)이 비어 있음')
  if (errors.length > 0) return err(...errors)

  const anchor: DebtItem['anchor'] = { path: path ?? '' }
  const name = fields.get('anchor.name')
  const metric = fields.get('anchor.metric')
  if (name !== undefined) anchor.name = name
  if (metric !== undefined) anchor.metric = metric
  return ok({
    id,
    anchor,
    kind: kind as DebtKind,
    source: fields.get('source') ?? '',
    reason,
    created: created ?? '',
  })
}

function isKey(key: string): key is Key {
  return (KEYS as readonly string[]).includes(key)
}

function isKind(kind: string): kind is DebtKind {
  return (KINDS as string[]).includes(kind)
}

function isRepoPath(path: string, literal: boolean): boolean {
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) return false
  if (!literal && path.includes('\\')) return false
  return !path.split('/').some((s) => s === '..')
}

function unquote(text: string): string | null {
  try {
    const v: unknown = JSON.parse(text)
    return typeof v === 'string' ? v : null
  } catch {
    return null
  }
}

function isDate(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (m === null) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (mo < 1 || mo > 12 || d < 1) return false
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1] ?? 0
  return d <= days
}

// ── 쓰기 ────────────────────────────────────────────────────────────────────

/** parseDebt로 되읽으면 같은 항목이 된다(까닭의 앞뒤 공백은 빼고) */
export function formatDebt(item: DebtItem): string {
  const header: [Key, string | undefined][] = [
    ['anchor.path', item.anchor.path],
    ['anchor.name', item.anchor.name],
    ['anchor.metric', item.anchor.metric],
    ['kind', item.kind],
    ['source', item.source],
    ['created', item.created],
  ]
  const rows = header
    .filter((row): row is [Key, string] => row[1] !== undefined && row[1] !== '')
    .map(([k, v]) => `${k}: ${headerValue(v)}`)
  return ['---', ...rows, '---', '', item.reason.trim(), ''].join('\n')
}

/** 그대로 쓰면 되읽을 때 달라지는 값은 JSON 문자열로 감싼다 */
function headerValue(value: string): string {
  const control = [...value].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)
  const plain =
    value === value.trim() && !control && !/\s{2}|[^\S ]|\\/.test(value) && !value.startsWith('"')
  return plain ? value : JSON.stringify(value)
}

// ── 래칫에서 ────────────────────────────────────────────────────────────────

/** 사람이 나빠진 채로 머지한 래칫의 offender마다 받아들인 나빠짐 항목 */
export function debtFromRatchet(r: RatchetResult, source: string, date: string): DebtItem[] {
  if (r.status !== 'worse') return []
  // 시각(ISO)을 받아도 날짜만 남긴다
  const created = /^\d{4}-\d{2}-\d{2}/.exec(date)?.[0] ?? date
  const offenders = r.offenders ?? []
  if (offenders.length === 0) {
    // 시험 수·명령 지표처럼 파일이 없는 래칫은 그 래칫을 정한 품질 기준에 단다
    const change = r.base === undefined || r.head === undefined ? r.detail : `${r.base} → ${r.head}`
    return [
      {
        id: `r-${slug(r.id)}`,
        anchor: { path: QUALITY_FILE, metric: r.id },
        kind: 'accepted_regression',
        source,
        reason: `래칫 ${r.id}: 나빠진 채로 머지됨 (${change})`,
        created,
      },
    ]
  }
  const used = new Set<string>()
  const items: DebtItem[] = []
  for (const o of offenders) {
    const stem = `r-${slug(r.id)}-${slug(o.path)}`
    let id = stem
    for (let n = 2; used.has(id); n++) id = `${stem}-${n}`
    used.add(id)
    const change = o.base === undefined ? `${o.head}` : `${o.base} → ${o.head}`
    items.push({
      id,
      anchor: { path: o.path, metric: r.id },
      kind: 'accepted_regression',
      source,
      reason: `래칫 ${r.id}: 나빠진 채로 머지됨 (${o.path} ${change})`,
      created,
    })
  }
  return items
}

/** 파일 이름에 쓸 수 있는 조각. 소문자·숫자·'-'만 */
function slug(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '')
  return s === '' ? 'x' : s
}

// ── 찾기 ────────────────────────────────────────────────────────────────────

/** anchor가 바뀐 경로와 같거나, 한쪽이 다른 쪽 아래에 있는 항목 */
export function touching(items: DebtItem[], paths: string[]): DebtItem[] {
  const changed = paths.map(normalize).filter((p) => p !== '')
  return items.filter((item) => {
    const anchor = normalize(item.anchor.path)
    if (anchor === '') return false
    return changed.some((p) => isUnder(p, anchor) || isUnder(anchor, p))
  })
}

/** anchor.path가 더는 없는 항목 */
export function vanished(items: DebtItem[], exists: (path: string) => boolean): DebtItem[] {
  return items.filter((item) => !exists(item.anchor.path))
}

/** 앞의 './'와 뒤의 '/'를 뺀다. 레포 루트('.')는 빈 글이 된다 */
function normalize(path: string): string {
  const p = path
    .trim()
    .replace(/^(\.\/)+/, '')
    .replace(/\/+$/, '')
  return p === '.' ? '' : p
}

function isUnder(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`)
}

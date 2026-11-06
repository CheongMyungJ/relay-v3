// [단위] 지식 항목의 형식과 고르기(M3a, V38, engine/knowledge-format.ts): v2 isKnowledgePath·checkEntryFormat·notYetPaths·
// rankEntries를 옮긴 것과 request.md에 붙이는 목록, 근거 id의 경로
import { describe, expect, test } from 'vitest'
import {
  anchorOf,
  checkEntryFormat,
  entryPathOf,
  entryTitle,
  identifiersIn,
  isKnowledgePath,
  LIST_HEADING,
  notYetPaths,
  pathsIn,
  PICK_LIMIT,
  rankEntries,
  relatedListText,
  termsOf,
  type KnowledgeEntry,
} from '../../src/engine/knowledge-format.ts'

const rule = (title: string, body: string, anchor?: string, more = '') =>
  [
    '---',
    'kind: rule',
    'source: human',
    ...(anchor ? [`anchor: ${anchor}`] : []),
    '---',
    `# ${title}`,
    '',
    '## 규칙',
    body,
    more,
  ].join('\n')

const RULE = rule(
  '무료배송 기준',
  '- 쿠폰을 뺀 금액이 40,000원 이상이면 무료다.',
  'FREE_SHIPPING_THRESHOLD',
  '\n## 아직 규칙을 따르지 않는 곳\n\n- `src/returns/return-fee.js`: 쿠폰 전 금액을 쓴다\n- pricing.py: 옛 기준\n\n## 바뀐 이력\n\n- 2026-11-06 처음 남김',
)
const FACT = '---\nkind: fact\nsource: investigation\n---\n# 사실\n\n## 내용\n\n캐시는 1분이다.\n'

const q = (text: string, paths: string[] = [], ids: string[] = []) => ({
  text,
  paths,
  identifiers: new Set(ids),
})

describe('경로', () => {
  test('지식 파일은 docs/knowledge/<이름>.md나 영역 한 단계 아래다(README는 뺀다)', () => {
    expect(isKnowledgePath('docs/knowledge/vat.md')).toBe(true)
    expect(isKnowledgePath('docs/knowledge/shipping/free-threshold.md')).toBe(true)
    for (const p of [
      'docs/knowledge/README.md',
      'docs/knowledge/shipping/readme.md',
      'docs/knowledge/a/b/x.md',
      'docs/knowledge/Shipping_Area/x.md',
      'docs/knowledge/x.txt',
      'docs/other/x.md',
    ])
      expect(isKnowledgePath(p), p).toBe(false)
  })

  test('근거 id는 항목 경로다: 앞의 docs/knowledge/와 끝의 .md는 없어도 된다', () => {
    expect(entryPathOf('docs/knowledge/billing/round.md')).toBe('docs/knowledge/billing/round.md')
    expect(entryPathOf('./docs/knowledge/a.md')).toBe('docs/knowledge/a.md')
    expect(entryPathOf('billing/round')).toBe('docs/knowledge/billing/round.md')
    expect(entryPathOf('k-7')).toBe('docs/knowledge/k-7.md')
    expect(entryPathOf('a/b/c')).toBeNull()
    expect(entryPathOf('README')).toBeNull()
  })
})

describe('형식 (v2 checkEntryFormat)', () => {
  test('맞는 rule과 fact는 문제가 없다', () => {
    expect(checkEntryFormat(RULE)).toEqual([])
    expect(checkEntryFormat(FACT)).toEqual([])
    expect(checkEntryFormat(FACT.replace('kind: fact', 'kind: "fact"  # 주석 아님'))).toHaveLength(
      1,
    )
    expect(checkEntryFormat(FACT.replace('kind: fact', "kind: 'fact'\n# 머리글 주석"))).toEqual([])
  })

  test.each([
    ['머리글 없음', '# 제목\n본문', '머리글 없음'],
    ['닫히지 않은 머리글', '---\nkind: rule\n# 제목', '닫히지 않음'],
    ['key: value가 아닌 줄', FACT.replace('source: investigation', '- x'), '`key: value`'],
    ['두 번 적힌 칸', FACT.replace('source: investigation', 'kind: fact'), '두 번'],
    ['모르는 kind', RULE.replace('kind: rule', 'kind: law'), '`kind`'],
    ['없는 source', FACT.replace('source: investigation\n', ''), '`source`'],
    ['식별자가 아닌 anchor', RULE.replace('FREE_SHIPPING_THRESHOLD', '무료 배송'), '`anchor`'],
    ['제목 없음', FACT.replace('# 사실\n', ''), '첫 `# ` 제목'],
    ['rule의 본문 절이 내용', RULE.replace('## 규칙', '## 내용'), '`## 규칙` 절이 없거나'],
    ['모르는 절', RULE.replace('## 바뀐 이력', '## 메모'), '모르는 절'],
    ['fact의 아직 따르지 않는 곳', `${FACT}\n## 아직 규칙을 따르지 않는 곳\n- x\n`, 'rule에만'],
  ])('%s', (_name, text, want) => {
    expect(checkEntryFormat(text).join('\n')).toContain(want)
  })

  test('빈 anchor는 칸이 없는 것이고, 펜스 안의 제목과 절은 보지 않는다', () => {
    expect(checkEntryFormat(FACT.replace('kind: fact', 'kind: fact\nanchor:'))).toEqual([])
    const fenced = FACT.replace('캐시는 1분이다.', '```\n## 메모\n# 아님\n```')
    expect(checkEntryFormat(fenced)).toEqual([])
    expect(checkEntryFormat(fenced.replace('# 사실\n', ''))).toEqual(['첫 `# ` 제목 줄 없음'])
  })

  test('anchor, 제목, 아직 따르지 않는 곳의 경로(맨 위 파일도)', () => {
    expect(anchorOf(RULE)).toBe('FREE_SHIPPING_THRESHOLD')
    expect(anchorOf(FACT)).toBeNull()
    expect(entryTitle({ path: 'docs/knowledge/r.md', text: RULE })).toBe('무료배송 기준')
    expect(entryTitle({ path: 'docs/knowledge/r.md', text: 'no title' })).toBe('r.md')
    expect(notYetPaths(RULE)).toEqual(['src/returns/return-fee.js', 'pricing.py'])
    expect(notYetPaths(FACT)).toEqual([])
  })
})

describe('고르기 (v2 rankEntries)', () => {
  test('낱말, 경로, 코드 이름을 뽑는다', () => {
    expect([...termsOf('무료배송은 기준')]).toEqual(['무료', '료배', '배송', '송은', '기준'])
    expect([...termsOf('Free shipping is ok')]).toEqual(['free', 'shipping'])
    expect(pathsIn('`src/fee/ship.js`와 docs/a.md, 그리고 v1.2')).toEqual([
      'src/fee/ship.js',
      'docs/a.md',
    ])
    expect([...identifiersIn('const FREE_SHIPPING = calcFee(x)')]).toEqual([
      'const',
      'FREE_SHIPPING',
      'calcFee',
    ])
  })

  test('같은 anchor, 같은 파일·폴더, 영역, 낱말이 점수를 올린다', () => {
    const entries: KnowledgeEntry[] = [
      { path: 'docs/knowledge/a.md', text: rule('무관한 규칙', '- 로그는 남긴다.') },
      { path: 'docs/knowledge/b.md', text: rule('상수', '- 바꾼다.', 'cfg.FREE_SHIPPING') },
      { path: 'docs/knowledge/c.md', text: rule('반품', '- `src/returns/fee.js`에서 계산.') },
      { path: 'docs/knowledge/shipping/d.md', text: rule('묶음', '- 묶는다.') },
      { path: 'docs/knowledge/e.md', text: rule('무료배송 기준 금액', '- 쿠폰 뺀 금액.') },
    ]
    const top = (query: ReturnType<typeof q>) => rankEntries(entries, query)[0]?.entry.path
    expect(top(q('', [], ['FREE_SHIPPING']))).toBe('docs/knowledge/b.md')
    expect(top(q('', ['src/returns/fee.js']))).toBe('docs/knowledge/c.md')
    expect(top(q('', ['src/returns/other.js']))).toBe('docs/knowledge/c.md')
    expect(top(q('', ['src/shipping/pack.js']))).toBe('docs/knowledge/shipping/d.md')
    expect(top(q('무료배송 기준이 40,000원으로 바뀜'))).toBe('docs/knowledge/e.md')
    // 점수가 같으면 경로 차례
    expect(rankEntries(entries, q('')).map((r) => r.entry.path)).toEqual(
      entries.map((e) => e.path).sort(),
    )
  })
})

describe('request.md 끝의 목록', () => {
  test('항목이 없으면 빈 글, 겹치는 것이 없으면 한 줄', () => {
    expect(relatedListText([], '무엇이든')).toBe('')
    const t = relatedListText([{ path: 'docs/knowledge/a.md', text: FACT }], 'zzz')
    expect(t).toContain(LIST_HEADING)
    expect(t).toContain('항목 1개 가운데 이 요청과 겹치는 것을 찾지 못했습니다')
  })

  test('겹치는 항목을 점수 차례로 제목과 경로만, 15개까지', () => {
    const many: KnowledgeEntry[] = Array.from({ length: 20 }, (_, k) => ({
      path: `docs/knowledge/item-${String(k).padStart(2, '0')}.md`,
      text: rule(`배송 규칙 ${k}`, `- 배송 설명 ${k}`),
    }))
    many.push({ path: 'docs/knowledge/zz.md', text: rule('객실 취소', '- 버린다.') })
    many.push({ path: 'docs/knowledge/top.md', text: rule('배송비', '- 비밀 본문', 'shipFee') })
    const t = relatedListText(many, '배송비 계산(shipFee)이 틀림')
    const items = t.split('\n').filter((l) => l.startsWith('- '))
    expect(items).toHaveLength(PICK_LIMIT)
    expect(items[0]).toBe('- 배송비 — `docs/knowledge/top.md`')
    expect(t).toContain('항목 22개 가운데 이 요청과 겹치는 15개')
    expect(t).not.toContain('zz.md')
    expect(t).not.toContain('비밀 본문')
  })
})

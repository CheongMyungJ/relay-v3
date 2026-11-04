import { describe, expect, test } from 'vitest'
import { debtFromRatchet, formatDebt, parseDebt, touching, vanished } from '../../src/core/debt.ts'
import type { DebtItem, RatchetResult } from '../../src/core/types.ts'

function item(over: Partial<DebtItem> = {}): DebtItem {
  return {
    id: 'd1',
    anchor: { path: 'src/core/gate.ts' },
    kind: 'tidy',
    source: 'https://github.com/o/r/pull/12',
    reason: '조건 판정을 한곳으로 모은다.',
    created: '2026-11-04',
    ...over,
  }
}

const TEXT = `---
anchor.path: src/core/gate.ts
anchor.name: gate
anchor.metric: file_lines
kind: accepted_regression
source: https://github.com/o/r/pull/12
created: 2026-11-04
---

파일이 600줄을 넘었다.
다음 Work에서 나눈다.
`

function errors(text: string, id = 'd1'): string[] {
  const r = parseDebt(text, id)
  return r.ok ? [] : r.errors
}

describe('빚 항목 읽기', () => {
  test('머리글과 본문을 읽는다', () => {
    expect(parseDebt(TEXT, 'r-file-size-src-core-gate-ts')).toEqual({
      ok: true,
      value: {
        id: 'r-file-size-src-core-gate-ts',
        anchor: { path: 'src/core/gate.ts', name: 'gate', metric: 'file_lines' },
        kind: 'accepted_regression',
        source: 'https://github.com/o/r/pull/12',
        reason: '파일이 600줄을 넘었다.\n다음 Work에서 나눈다.',
        created: '2026-11-04',
      },
    })
  })

  test('선택 칸(anchor.name, anchor.metric)이 없으면 넣지 않는다', () => {
    const text = '---\nanchor.path: a.ts\nkind: tidy\nsource: w1\ncreated: 2026-01-31\n---\n까닭\n'
    const r = parseDebt(text, 'x')
    expect(r.ok && r.value.anchor).toEqual({ path: 'a.ts' })
  })

  test('CRLF, BOM, 머리글의 빈 줄과 키 둘레 공백을 받는다', () => {
    const text =
      '\uFEFF---\r\n anchor.path :  a.ts \r\n\r\nkind: test_gap\r\nsource: w1\r\ncreated: 2024-02-29\r\n---\r\n  까닭  \r\n'
    const r = parseDebt(text, 'x')
    expect(r.ok && r.value).toMatchObject({
      anchor: { path: 'a.ts' },
      kind: 'test_gap',
      reason: '까닭',
    })
  })

  test('값 안의 콜론은 값에 남는다', () => {
    const text =
      '---\nanchor.path: a.ts\nkind: tidy\nsource: https://x/y:1\ncreated: 2026-11-04\n---\nr'
    const r = parseDebt(text, 'x')
    expect(r.ok && r.value.source).toBe('https://x/y:1')
  })

  test('본문에 --- 줄이 있어도 첫 닫힘까지만 머리글이다', () => {
    const text =
      '---\nanchor.path: a.ts\nkind: tidy\nsource: w\ncreated: 2026-11-04\n---\n위\n---\n아래'
    const r = parseDebt(text, 'x')
    expect(r.ok && r.value.reason).toBe('위\n---\n아래')
  })

  test.each([
    ['빈 글', '', ['머리글(---)로 시작해야 함']],
    ['머리글 없이 본문만', '까닭만 있음', ['머리글(---)로 시작해야 함']],
    ['닫히지 않은 머리글', '---\nkind: tidy\n', ['머리글이 닫히지 않음(---)']],
    [
      '필수 칸이 빠짐',
      '---\nanchor.name: x\n---\n까닭',
      ['anchor.path: 필요함', 'kind: 필요함', 'source: 필요함', 'created: 필요함'],
    ],
    [
      '알 수 없는 키와 모양이 틀린 줄',
      '---\nanchor.path: a\nkind: tidy\nsource: w\ncreated: 2026-11-04\nowner: me\n그냥 글\n---\nr',
      ['머리글 5번 줄: 알 수 없는 키 (owner)', "머리글 6번 줄: 'key: value' 모양이 아님"],
    ],
    [
      '같은 키가 두 번',
      '---\nanchor.path: a\nanchor.path: b\nkind: tidy\nsource: w\ncreated: 2026-11-04\n---\nr',
      ['anchor.path: 두 번 적힘'],
    ],
    [
      '빈 값',
      '---\nanchor.path: a\nanchor.name:\nkind: tidy\nsource: w\ncreated: 2026-11-04\n---\nr',
      ['anchor.name: 값이 비어 있음'],
    ],
    [
      '모르는 종류',
      '---\nanchor.path: a\nkind: bug\nsource: w\ncreated: 2026-11-04\n---\nr',
      ['kind: tidy, accepted_regression, rule_violation, test_gap 가운데 하나여야 함 (bug)'],
    ],
    [
      '빈 본문',
      '---\nanchor.path: a\nkind: tidy\nsource: w\ncreated: 2026-11-04\n---\n  \n',
      ['까닭(본문)이 비어 있음'],
    ],
  ])('%s는 오류다', (_name, text, expected) => {
    expect(errors(text)).toEqual(expected)
  })

  test.each([['/etc/passwd'], ['../x.ts'], ['src/../../x'], ['C:/x'], ['src\\a.ts']])(
    '레포 밖이나 절대 경로 anchor(%s)는 오류다',
    (path) => {
      const text = `---\nanchor.path: ${path}\nkind: tidy\nsource: w\ncreated: 2026-11-04\n---\nr`
      expect(errors(text)).toEqual([`anchor.path: 레포 안의 상대 경로여야 함 (${path})`])
    },
  )

  test.each([
    ['2026-13-01'],
    ['2026-02-29'],
    ['2026-04-31'],
    ['2026-1-1'],
    ['어제'],
    ['2026-00-10'],
  ])('날짜가 아닌 created(%s)는 오류다', (created) => {
    const text = `---\nanchor.path: a\nkind: tidy\nsource: w\ncreated: ${created}\n---\nr`
    expect(errors(text)).toEqual([`created: YYYY-MM-DD 날짜여야 함 (${created})`])
  })

  test.each([['2024-02-29'], ['2000-02-29'], ['2026-12-31']])(
    '윤년과 달 끝 날짜(%s)는 받는다',
    (created) => {
      const text = `---\nanchor.path: a\nkind: tidy\nsource: w\ncreated: ${created}\n---\nr`
      expect(errors(text)).toEqual([])
    },
  )

  test('1900-02-29는 윤년이 아니다', () => {
    const text = '---\nanchor.path: a\nkind: tidy\nsource: w\ncreated: 1900-02-29\n---\nr'
    expect(errors(text)).toHaveLength(1)
  })

  test.each([[''], ['a/b'], ['-x'], ['a b']])('파일 이름으로 쓸 수 없는 id(%j)는 오류다', (id) => {
    expect(errors(TEXT, id)).toEqual([`id가 올바르지 않음: '${id}'`])
  })
})

describe('빚 항목 쓰기', () => {
  test('머리글은 정해진 순서로, 없는 칸은 빼고 쓴다', () => {
    expect(formatDebt(item({ anchor: { path: 'a.ts', metric: 'tests' } }))).toBe(
      '---\nanchor.path: a.ts\nanchor.metric: tests\nkind: tidy\nsource: https://github.com/o/r/pull/12\ncreated: 2026-11-04\n---\n\n조건 판정을 한곳으로 모은다.\n',
    )
  })

  test('읽은 글을 다시 쓰면 같은 글이다', () => {
    const r = parseDebt(TEXT, 'x')
    expect(r.ok && formatDebt(r.value)).toBe(TEXT)
  })

  test.each([
    ['기본', item()],
    ['anchor 모두', item({ anchor: { path: 'src', name: 'run', metric: 'lines' } })],
    ['여러 줄 까닭', item({ reason: '첫 줄\n\n셋째 줄: 값\n---\n끝' })],
    ['종류마다', item({ kind: 'rule_violation' })],
  ])('쓴 것을 읽으면 같은 항목이다 (%s)', (_name, it) => {
    expect(parseDebt(formatDebt(it), it.id)).toEqual({ ok: true, value: it })
  })

  test('한 줄에 그대로 못 쓰는 머리글 값은 JSON 문자열로 감싸고 되읽으면 같다', () => {
    const text = formatDebt(item({ source: 'PR\n12' }))
    expect(text).toContain('source: "PR\\n12"\n')
    const r = parseDebt(text, 'd1')
    expect(r.ok && r.value.source).toBe('PR\n12')
  })

  test.each([
    'docs/meeting  notes.md',
    'src/a\tb.ts',
    ' 앞 공백.md',
    '뒤 공백.md ',
    'src/win\\path.ts',
    '"따옴표로 시작.md',
    'src/a b.ts',
  ])('anchor.path는 공백·탭·역슬래시가 있어도 되돌아온다 (%j)', (path) => {
    const original = item({ anchor: { path, name: ' 이름  ', metric: 'file-size' } })
    const back = parseDebt(formatDebt(original), original.id)
    expect(back).toEqual({ ok: true, value: original })
  })

  test('그대로 쓸 수 있는 값은 감싸지 않는다', () => {
    expect(formatDebt(item({ anchor: { path: 'src/a b.ts' } }))).toContain(
      'anchor.path: src/a b.ts\n',
    )
  })

  test('빈 선택 칸은 쓰지 않는다', () => {
    expect(formatDebt(item({ anchor: { path: 'a', name: '' } }))).not.toContain('anchor.name')
  })
})

describe('래칫에서 빚 만들기', () => {
  const worse: RatchetResult = {
    id: 'file-size',
    status: 'worse',
    detail: '600줄을 넘음',
    offenders: [
      { path: 'src/core/Gate.ts', base: 590, head: 640 },
      { path: 'src/new.ts', head: 700 },
    ],
  }

  test('나빠진 래칫의 offender마다 받아들인 나빠짐 항목을 만든다', () => {
    expect(debtFromRatchet(worse, 'https://x/pull/3', '2026-11-04')).toEqual([
      {
        id: 'r-file-size-src-core-gate-ts',
        anchor: { path: 'src/core/Gate.ts', metric: 'file-size' },
        kind: 'accepted_regression',
        source: 'https://x/pull/3',
        reason: '래칫 file-size: 나빠진 채로 머지됨 (src/core/Gate.ts 590 → 640)',
        created: '2026-11-04',
      },
      {
        id: 'r-file-size-src-new-ts',
        anchor: { path: 'src/new.ts', metric: 'file-size' },
        kind: 'accepted_regression',
        source: 'https://x/pull/3',
        reason: '래칫 file-size: 나빠진 채로 머지됨 (src/new.ts 700)',
        created: '2026-11-04',
      },
    ])
  })

  test.each(['better', 'same', 'unknown'] as const)('%s 래칫은 빚을 만들지 않는다', (status) => {
    expect(debtFromRatchet({ ...worse, status }, 's', '2026-11-04')).toEqual([])
  })

  test('offender가 없는 나빠짐(시험 수 등)은 품질 기준에 단 빚 하나가 된다', () => {
    const r: RatchetResult = { id: 'tests', status: 'worse', base: 10, head: 8, detail: '' }
    expect(debtFromRatchet(r, 'PR 3', '2026-11-04')).toEqual([
      {
        id: 'r-tests',
        anchor: { path: '.relay/quality.json', metric: 'tests' },
        kind: 'accepted_regression',
        source: 'PR 3',
        reason: '래칫 tests: 나빠진 채로 머지됨 (10 → 8)',
        created: '2026-11-04',
      },
    ])
  })

  test('값이 없는 나빠짐은 detail을 까닭에 쓴다', () => {
    const r: RatchetResult = { id: 'lint', status: 'worse', detail: '기준에서 돌던 시험이 사라짐' }
    expect(debtFromRatchet(r, 's', '2026-11-04')[0]?.reason).toBe(
      '래칫 lint: 나빠진 채로 머지됨 (기준에서 돌던 시험이 사라짐)',
    )
  })

  test('시각(ISO)을 받으면 날짜만 남겨 parseDebt로 되읽힌다', () => {
    const r: RatchetResult = { id: 'tests', status: 'worse', base: 2, head: 1, detail: '' }
    const [d] = debtFromRatchet(r, 's', '2026-11-04T04:00:00Z')
    expect(d?.created).toBe('2026-11-04')
    if (d === undefined) throw new Error('빚이 없음')
    expect(parseDebt(formatDebt(d), d.id)).toEqual({ ok: true, value: d })
  })

  test('슬러그가 겹치면 뒤에 번호를 붙인다', () => {
    const r: RatchetResult = {
      ...worse,
      offenders: [
        { path: 'src/a-b.ts', head: 700 },
        { path: 'src/a/b.ts', head: 700 },
        { path: 'src/a_b.ts', head: 700 },
      ],
    }
    expect(debtFromRatchet(r, 's', '2026-11-04').map((d) => d.id)).toEqual([
      'r-file-size-src-a-b-ts',
      'r-file-size-src-a-b-ts-2',
      'r-file-size-src-a-b-ts-3',
    ])
  })

  test('글자가 하나도 남지 않는 경로도 id를 만들고 긴 경로는 줄인다', () => {
    const r: RatchetResult = {
      ...worse,
      offenders: [
        { path: '한글.ts', head: 700 },
        { path: `${'a/'.repeat(100)}x.ts`, head: 700 },
      ],
    }
    const ids = debtFromRatchet(r, 's', '2026-11-04').map((d) => d.id)
    expect(ids[0]).toBe('r-file-size-ts')
    expect(ids[1]?.length).toBeLessThanOrEqual('r-file-size-'.length + 80)
    expect(ids[1]).not.toMatch(/-$/)
  })

  test('만든 항목은 그대로 쓰고 읽을 수 있다', () => {
    for (const d of debtFromRatchet(worse, 'https://x/pull/3', '2026-11-04')) {
      expect(parseDebt(formatDebt(d), d.id)).toEqual({ ok: true, value: d })
    }
  })
})

describe('바뀐 경로에 닿는 빚', () => {
  const items = [
    item({ id: 'file', anchor: { path: 'src/core/gate.ts' } }),
    item({ id: 'dir', anchor: { path: 'src/legacy/' } }),
    item({ id: 'other', anchor: { path: 'docs/a.md' } }),
    item({ id: 'prefix', anchor: { path: 'src/core/gate.tsx' } }),
  ]
  const ids = (paths: string[]) => touching(items, paths).map((d) => d.id)

  test('anchor와 같은 경로를 바꾸면 닿는다', () => {
    expect(ids(['src/core/gate.ts'])).toEqual(['file'])
  })

  test('anchor 디렉터리 아래 파일을 바꾸면 닿는다', () => {
    expect(ids(['src/legacy/old/x.ts'])).toEqual(['dir'])
  })

  test('바뀐 경로가 디렉터리면 그 아래 anchor에 닿는다', () => {
    expect(ids(['src/core'])).toEqual(['file', 'prefix'])
  })

  test('이름 앞부분만 같은 경로는 닿지 않는다', () => {
    expect(ids(['src/core/gate.t', 'src/legacyx/a.ts', 'doc'])).toEqual([])
  })

  test("앞의 './'와 뒤의 '/'는 무시한다", () => {
    expect(ids(['./src/core/gate.ts', 'src/legacy'])).toEqual(['file', 'dir'])
  })

  test('바뀐 경로가 없거나 비면 아무것에도 닿지 않는다', () => {
    expect(ids([])).toEqual([])
    expect(ids(['', '.', './'])).toEqual([])
  })

  test('레포 루트 anchor는 경로로 닿지 않는다', () => {
    expect(touching([item({ anchor: { path: '.' } })], ['src/a.ts'])).toEqual([])
  })
})

describe('사라진 anchor', () => {
  test('anchor.path가 없는 항목만 돌려준다', () => {
    const items = [
      item({ id: 'a', anchor: { path: 'a.ts' } }),
      item({ id: 'b', anchor: { path: 'b.ts' } }),
    ]
    const seen: string[] = []
    const gone = vanished(items, (p) => {
      seen.push(p)
      return p === 'a.ts'
    })
    expect(gone.map((d) => d.id)).toEqual(['b'])
    expect(seen).toEqual(['a.ts', 'b.ts'])
  })

  test('빈 장부는 빈 목록이다', () => {
    expect(vanished([], () => false)).toEqual([])
  })
})

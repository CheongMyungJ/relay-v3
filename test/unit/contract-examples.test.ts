// 계약의 예시: 시험 이름의 태그, 예시 자료 파일(V27: 정규 꼴과 승인본 견줌), 계약 내용 해시.
import { describe, expect, test } from 'vitest'
import {
  checkExamplesFile,
  contractHash,
  exampleTag,
  exampleValueText,
  examplesFile,
  examplesFileText,
  findExampleTags,
  parseContract,
} from '../../src/core/contract.ts'
import type { Contract } from '../../src/core/types.ts'

function valueOf(text: string): Contract {
  const r = parseContract(text)
  if (!r.ok) throw new Error(`통과를 기대함: ${r.errors.join(' / ')}`)
  return r.value
}

const full: Contract = {
  version: 1,
  id: 'w-20261104-1',
  goal: '빈 줄을 건너뛰고 합계를 낸다',
  lines: [
    {
      id: 'C1',
      kind: 'change',
      text: '빈 줄은 0으로 세지 않고 건너뛴다',
      grounds: [
        { type: 'code', path: 'src/sum.ts', line: 12, name: 'sumLines' },
        { type: 'request', quote: '빈 줄은 건너뛰어 줘' },
      ],
      examples: ['C1.1', 'C1.2'],
      check: 'test',
    },
    {
      id: 'C2',
      kind: 'keep',
      text: '숫자가 아닌 줄은 오류',
      grounds: [{ type: 'knowledge', id: 'k-7' }],
      examples: ['C2.1'],
      check: 'test',
    },
    {
      id: 'C3',
      kind: 'remove',
      text: '옛 sumAll을 없앤다',
      grounds: [{ type: 'guess' }],
      examples: [],
      check: 'test',
    },
    {
      id: 'C4',
      kind: 'observe',
      text: 'README에 적는다',
      grounds: [],
      examples: [],
      check: 'observe',
    },
    { id: 'C5', kind: 'human', text: '이름이 알맞은지', grounds: [], examples: [], check: 'human' },
  ],
  non_goals: ['소수 처리'],
  human_rules: ['공개 API 이름은 사람이 정한다'],
  examples: [
    { id: 'C1.1', input: '1\n\n2', output: 3 },
    { id: 'C1.2', input: '', output: 0, note: '빈 입력' },
    { id: 'C2.1', input: 'a', error: { message: '숫자가 아님' } },
  ],
  hint: '버그 수정',
  tidy: ['debt-1'],
  approved_by: 'human',
  approved_at: '2026-11-04T03:00:00Z',
}

describe('예시 태그', () => {
  test('exampleTag는 계약 id와 예시 id를 대괄호로 감싼다', () => {
    expect(exampleTag('fix-clamp', 'C1.1')).toBe('[fix-clamp:C1.1]')
  })

  test('findExampleTags는 이 계약의 태그가 가리키는 예시 id를 모두 돌려준다', () => {
    expect(findExampleTags('sum [w1:C1.1] 빈 줄 [w1:C12.3]', 'w1')).toEqual(['C1.1', 'C12.3'])
    expect(findExampleTags('[w1:C2.1][w1:C1.1]', 'w1')).toEqual(['C2.1', 'C1.1'])
  })

  test('다른 계약의 태그는 찾지 않는다(앞 Work가 남긴 시험이 증거로 잡히지 않게)', () => {
    expect(findExampleTags('위로 넘는 값 [fix-clamp:C1.1]', 'second-work')).toEqual([])
    expect(findExampleTags('[a:C1.1] [b:C1.2]', 'b')).toEqual(['C1.2'])
  })

  test('계약 id가 없는 옛 태그는 찾지 않는다', () => {
    expect(findExampleTags('[C1.1] 비밀번호가 틀리면 401', 'w1')).toEqual([])
  })

  test('점·밑줄·붙임표가 든 계약 id도 읽는다', () => {
    expect(findExampleTags('x [v1.2_a-b:C3.4]', 'v1.2_a-b')).toEqual(['C3.4'])
  })

  test('같은 태그는 한 번만', () => {
    expect(findExampleTags('[w1:C1.1] a [w1:C1.1]', 'w1')).toEqual(['C1.1'])
  })

  test('태그가 없으면 빈 배열', () => {
    expect(findExampleTags('그냥 시험', 'w1')).toEqual([])
    expect(findExampleTags('', 'w1')).toEqual([])
  })

  test.each([
    '[w1:C1]',
    '[w1:c1.1]',
    '(w1:C1.1)',
    '[w1:C1.1a]',
    '[ w1:C1.1]',
    'w1:C1.1',
    '[w1:C1.1.2]',
    '[w1 :C1.1]',
    '[:C1.1]',
  ])('태그 모양이 아니면 찾지 않는다 (%s)', (name) => {
    expect(findExampleTags(name, 'w1')).toEqual([])
  })

  test('C1.10의 태그는 C1.1로 읽지 않는다', () => {
    expect(findExampleTags('x [w1:C1.10]', 'w1')).toEqual(['C1.10'])
  })

  test('exampleTag로 만든 태그를 findExampleTags가 되읽는다', () => {
    expect(findExampleTags(`합계 ${exampleTag('w1', 'C3.2')} 경계`, 'w1')).toEqual(['C3.2'])
  })
})

describe('contractHash', () => {
  const base = valueOf(JSON.stringify(full))

  test('같은 계약이면 키 순서와 상관없이 같다', () => {
    const shuffled = valueOf(JSON.stringify(Object.fromEntries(Object.entries(full).reverse())))
    expect(contractHash(shuffled)).toBe(contractHash(base))
  })

  test('예시·줄 글·승인이 바뀌면 달라진다', () => {
    const h = contractHash(base)
    expect(contractHash({ ...base, goal: `${base.goal}!` })).not.toBe(h)
    expect(contractHash({ ...base, approved_at: '2026-11-05' })).not.toBe(h)
    const examples = base.examples.map((x) => ({ ...x, output: 'other' }))
    expect(contractHash({ ...base, examples })).not.toBe(h)
  })
})

describe('examplesFileText (V27)', () => {
  test('예시 id에서 {input, output?, error?, note?}로 가는 객체, 두 칸 들여쓰기와 끝 줄바꿈', () => {
    expect(examplesFileText(full)).toBe(`{
  "C1.1": {
    "input": "1\\n\\n2",
    "output": 3
  },
  "C1.2": {
    "input": "",
    "output": 0,
    "note": "빈 입력"
  },
  "C2.1": {
    "input": "a",
    "error": {
      "message": "숫자가 아님"
    }
  }
}
`)
  })

  test('예시 id는 번호 차례, 예시 안은 input·output·error·note. 값 속 객체의 열쇠는 계약의 차례 그대로다(승인된 자료)', () => {
    const examples = [
      { id: 'C1.10', input: 10, note: 'n', output: { b: 1, a: [{ d: 1, c: 2 }] } },
      { id: 'C2.1', input: 21 },
      { id: 'C1.2', input: 2 },
    ]
    const text = examplesFileText({ ...full, examples })
    expect(Object.keys(JSON.parse(text) as object)).toEqual(['C1.2', 'C1.10', 'C2.1'])
    expect(text).toContain(
      '"input": 10,\n    "output": {\n      "b": 1,\n      "a": [\n        {\n          "d": 1,',
    )
    expect(text.indexOf('"output"')).toBeLessThan(text.indexOf('"note"'))
  })

  test('열쇠 차례가 뜻인 입력은 계약 그대로 얹는다: 글자 차례로 바꾸면 정렬하지 않는 구현이 통과한다', () => {
    // C1: 머리줄은 열 이름의 글자 차례. 정렬한 입력이면 Object.keys(rows[0])만 쓰는 구현도 'age,name'을 낸다
    const input = { rows: [{ name: 'a', age: 1 }] }
    const text = examplesFileText({
      ...full,
      examples: [{ id: 'C1.1', input, output: 'age,name\n1,a' }],
    })
    const row = (JSON.parse(text) as Record<string, { input: typeof input }>)['C1.1']?.input.rows[0]
    expect(Object.keys(row ?? {})).toEqual(['name', 'age'])
  })

  test('같은 계약은 예시와 예시 안 칸의 순서와 상관없이 같은 글이다', () => {
    const shuffled = [...full.examples].reverse().map((x) => {
      const { note, error, output, input, id } = x
      return { note, error, output, input, id }
    })
    expect(examplesFileText({ ...full, examples: shuffled })).toBe(examplesFileText(full))
  })

  test('`__proto__` 열쇠도 값으로 남는다', () => {
    const input = JSON.parse('{"__proto__": {"x": 1}}') as unknown
    const text = examplesFileText({ ...full, examples: [{ id: 'C1.1', input }] })
    expect(text).toContain('"__proto__"')
    expect(checkExamplesFile({ ...full, examples: [{ id: 'C1.1', input }] }, text).status).toBe(
      'same',
    )
  })
})

describe('checkExamplesFile (V27: 승인본과 값으로)', () => {
  const c = full
  const canonical = JSON.parse(examplesFileText(c)) as Record<string, Record<string, unknown>>
  const edited = (edit: (f: typeof canonical) => void): string => {
    const f = structuredClone(canonical)
    edit(f)
    return JSON.stringify(f)
  }

  test('승인본 그대로면 same', () => {
    expect(checkExamplesFile(c, examplesFileText(c))).toEqual({ status: 'same', diffs: [] })
  })

  test('들여쓰기와 예시·칸의 차례는 보지 않는다(시험은 예시 id와 칸 이름으로 찾는다)', () => {
    const text = JSON.stringify({
      'C2.1': { error: { message: '숫자가 아님' }, input: 'a' },
      'C1.2': { note: '빈 입력', output: 0, input: '' },
      'C1.1': { output: 3, input: '1\n\n2' },
    })
    expect(checkExamplesFile(c, text).status).toBe('same')
  })

  test('BOM으로 시작하면 읽지 못함: JSON.parse가 읽지 못해 머지 뒤의 회귀 시험이 얹은 파일과 다르게 돈다', () => {
    expect(checkExamplesFile(c, `\uFEFF${examplesFileText(c)}`)).toEqual({
      status: 'unreadable',
      diffs: [],
      error: 'BOM(U+FEFF)으로 시작함: 앱이 쓴 파일에는 없고 JSON.parse가 읽지 못함',
    })
  })

  test('값 속 열쇠의 차례가 다르면 다름: 얹은 파일과 커밋된 파일이 열쇠 차례에 기대는 코드에 다른 입력이 된다', () => {
    const input = { rows: [{ name: 'a', age: 1 }] }
    const csv = { ...c, examples: [{ id: 'C1.1', input, output: 'age,name\n1,a' }] }
    const swapped = {
      'C1.1': { input: { rows: [{ age: 1, name: 'a' }] }, output: 'age,name\n1,a' },
    }
    expect(checkExamplesFile(csv, JSON.stringify(swapped))).toEqual({
      status: 'differs',
      diffs: [{ id: 'C1.1', field: 'input', expected: input, found: swapped['C1.1'].input }],
    })
  })

  test('-0과 0, 1e999(Infinity)와 null은 다르다: 얹은 파일(JSON.stringify)과 커밋된 파일을 JSON.parse한 값으로 견준다', () => {
    const zero = { ...c, examples: [{ id: 'C1.1', input: 1, output: 0 }] }
    const r = checkExamplesFile(zero, '{"C1.1": {"input": 1, "output": -0}}')
    expect(r.status).toBe('differs')
    expect(r.diffs).toHaveLength(1)
    expect(Object.is(r.diffs[0]?.found, -0)).toBe(true)
    // 계약의 Infinity(1e999)는 JSON.stringify가 null로 쓴다: 얹은 파일은 null이다
    const inf = { ...c, examples: [{ id: 'C1.1', input: Number.POSITIVE_INFINITY }] }
    expect(examplesFileText(inf)).toContain('"input": null')
    expect(checkExamplesFile(inf, '{"C1.1": {"input": 1e999}}').diffs).toEqual([
      { id: 'C1.1', field: 'input', expected: null, found: Number.POSITIVE_INFINITY },
    ])
    expect(checkExamplesFile(inf, examplesFileText(inf)).status).toBe('same')
  })

  test('파일이 없으면 absent', () => {
    expect(checkExamplesFile(c, null)).toEqual({ status: 'absent', diffs: [] })
  })

  test('칸이 다르면 differs: 예시 id, 칸, 기대, 실제', () => {
    const text = edited((f) => {
      ;(f['C1.1'] as Record<string, unknown>).output = 4
    })
    expect(checkExamplesFile(c, text)).toEqual({
      status: 'differs',
      diffs: [{ id: 'C1.1', field: 'output', expected: 3, found: 4 }],
    })
  })

  test('빠진 칸, 더 붙은 칸, 바뀐 note도 다름이다', () => {
    const text = edited((f) => {
      delete (f['C1.2'] as Record<string, unknown>).note
      ;(f['C2.1'] as Record<string, unknown>).output = null
    })
    expect(checkExamplesFile(c, text).diffs).toEqual([
      { id: 'C1.2', field: 'note', expected: '빈 입력' },
      { id: 'C2.1', field: 'output', found: null },
    ])
  })

  test('빠진 예시, 승인본에 없는 예시, 객체가 아닌 예시', () => {
    const text = edited((f) => {
      delete f['C1.1']
      f['C1.2'] = 0 as never
      f['C9.9'] = { input: 1 }
    })
    expect(checkExamplesFile(c, text).diffs).toEqual([
      { id: 'C1.1', expected: { input: '1\n\n2', output: 3 } },
      { id: 'C1.2', expected: { input: '', output: 0, note: '빈 입력' }, found: 0 },
      { id: 'C9.9', found: { input: 1 } },
    ])
  })

  test('계약의 examples 같은 배열은 예시 id를 열쇠로 하는 객체가 아니라 읽지 못함', () => {
    expect(checkExamplesFile(c, JSON.stringify(c.examples))).toEqual({
      status: 'unreadable',
      diffs: [],
      error: '예시 id를 열쇠로 하는 객체가 아님',
    })
  })

  test.each([
    ['{ 깨짐', /^JSON을 읽지 못함: /],
    ['3', /^예시 id를 열쇠로 하는 객체가 아님$/],
    ['"x"', /^예시 id를 열쇠로 하는 객체가 아님$/],
  ])('읽지 못하면 unreadable과 까닭 (%s)', (text, error) => {
    const r = checkExamplesFile(c, text)
    expect(r.status).toBe('unreadable')
    expect(r.diffs).toEqual([])
    expect(r.error).toMatch(error)
  })

  test('JSON에 없는 값(NaN)은 계약에 문자열로 쓰면 파일과 늘 같다', () => {
    const nan = { ...c, examples: [{ id: 'C1.1', input: 'NaN', output: 0, note: 'input은 NaN' }] }
    expect(checkExamplesFile(nan, examplesFileText(nan)).status).toBe('same')
  })
})

describe('exampleValueText', () => {
  test('한 줄 JSON, 길면 앞쪽만', () => {
    expect(exampleValueText({ a: [1, 2] })).toBe('{"a":[1,2]}')
    expect(exampleValueText('x'.repeat(50), 10)).toBe('"xxxxxxxx…')
  })

  test('JSON이 0과 null로 쓰는 -0과 Infinity는 그대로 보인다(다름을 설명하게)', () => {
    expect(exampleValueText(-0)).toBe('-0')
    expect(exampleValueText([1, -0, Number.POSITIVE_INFINITY])).toBe('[1,-0,Infinity]')
    expect(exampleValueText({ a: Number.NEGATIVE_INFINITY })).toBe('{"a":-Infinity}')
    expect(exampleValueText(0)).toBe('0')
  })
})

describe('examplesFile', () => {
  test('<폴더>/<계약 id>.json', () => {
    expect(examplesFile('.relay/examples', 'w1')).toBe('.relay/examples/w1.json')
  })

  test('폴더 끝의 /는 한 번만 쓴다', () => {
    expect(examplesFile('.relay/examples/', 'w1')).toBe('.relay/examples/w1.json')
  })

  test('폴더가 비면 파일 이름만', () => {
    expect(examplesFile('', 'w1')).toBe('w1.json')
  })
})

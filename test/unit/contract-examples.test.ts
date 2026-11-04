// 계약의 예시: 시험 이름의 태그, 예시 자료 파일, 계약 내용 해시.
import { describe, expect, test } from 'vitest'
import {
  checkExamplesFile,
  contractHash,
  exampleTag,
  examplesFile,
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

describe('checkExamplesFile', () => {
  const c = full
  const ex = c.examples[0]
  if (ex === undefined) throw new Error('예시가 있는 계약이어야 함')

  test('파일이 없으면 견줄 것이 없다', () => {
    expect(checkExamplesFile(c, null)).toEqual({ differs: [] })
  })

  test('예시 id로 찾은 객체가 승인된 예시와 같으면 다른 것이 없다', () => {
    const text = JSON.stringify({ [ex.id]: { input: ex.input, output: ex.output, note: '메모' } })
    expect(checkExamplesFile(c, text)).toEqual({ differs: [] })
  })

  test('계약의 examples 같은 배열도 읽는다', () => {
    expect(checkExamplesFile(c, JSON.stringify(c.examples))).toEqual({ differs: [] })
  })

  test('기대 출력을 바꾸면 그 예시가 다르다', () => {
    const text = JSON.stringify({ [ex.id]: { input: ex.input, output: 'changed' } })
    expect(checkExamplesFile(c, text)).toEqual({ differs: [ex.id] })
  })

  test('입력이나 오류를 바꾸거나 빼도 다르다', () => {
    expect(checkExamplesFile(c, JSON.stringify([{ ...ex, input: 'x' }])).differs).toEqual([ex.id])
    expect(checkExamplesFile(c, JSON.stringify([{ ...ex, error: 'E' }])).differs).toEqual([ex.id])
  })

  test('객체 키 순서는 보지 않는다', () => {
    const input = { b: 1, a: 2 }
    const cc = { ...c, examples: [{ ...ex, input }] }
    const text = JSON.stringify({ [ex.id]: { output: ex.output, input: { a: 2, b: 1 } } })
    expect(checkExamplesFile(cc, text)).toEqual({ differs: [] })
  })

  test('파일에 없는 예시와 계약에 없는 id는 견주지 않는다', () => {
    expect(checkExamplesFile(c, JSON.stringify({ 'C9.9': { input: 1 } }))).toEqual({ differs: [] })
  })

  test.each([
    ['{ 깨짐', /^JSON을 읽지 못함: /],
    ['3', /^객체나 배열이어야 함$/],
    ['"x"', /^객체나 배열이어야 함$/],
  ])('읽지 못하면 오류를 돌려준다 (%s)', (text, error) => {
    const r = checkExamplesFile(c, text)
    expect(r.differs).toEqual([])
    expect(r.error).toMatch(error)
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

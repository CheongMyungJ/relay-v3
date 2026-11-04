import { describe, expect, test } from 'vitest'
import { checkCodeGround, checkRequestQuote, parseContract } from '../../src/core/contract.ts'
import type { Contract } from '../../src/core/types.ts'

function valueOf(text: string): Contract {
  const r = parseContract(text)
  if (!r.ok) throw new Error(`통과를 기대함: ${r.errors.join(' / ')}`)
  return r.value
}

function errorsOf(text: string): string[] {
  const r = parseContract(text)
  if (r.ok) throw new Error('오류를 기대했지만 통과함')
  return r.errors
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

const line = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'C1',
  kind: 'observe',
  text: '문서',
  check: 'observe',
  ...extra,
})

const doc = (extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ version: 1, id: 'w1', goal: '목표', lines: [line()], ...extra })

describe('parseContract: 정상', () => {
  test('모든 칸이 있는 계약을 그대로 읽는다', () => {
    expect(valueOf(JSON.stringify(full))).toEqual(full)
  })

  test('빠진 목록 칸은 빈 배열로 채운다', () => {
    expect(valueOf(doc())).toEqual({
      version: 1,
      id: 'w1',
      goal: '목표',
      lines: [
        { id: 'C1', kind: 'observe', text: '문서', grounds: [], examples: [], check: 'observe' },
      ],
      non_goals: [],
      human_rules: [],
      examples: [],
      tidy: [],
    })
  })

  test('없는 선택 칸은 키로도 남기지 않는다', () => {
    const c = valueOf(doc())
    for (const k of ['hint', 'approved_by', 'approved_at', 'change_requested']) {
      expect(Object.keys(c)).not.toContain(k)
    }
  })

  test('change_requested를 읽는다', () => {
    expect(valueOf(doc({ change_requested: '예시 C1.1이 틀림' })).change_requested).toBe(
      '예시 C1.1이 틀림',
    )
  })

  test('예시의 input은 null이어도 되고 output·error 값은 그대로 둔다', () => {
    const c = valueOf(
      doc({
        lines: [line({ id: 'C1', kind: 'new', check: 'test', examples: ['C1.1', 'C1.2'] })],
        examples: [
          { id: 'C1.1', input: null, output: null },
          { id: 'C1.2', input: [1, { a: 2 }], output: false, error: 'E' },
        ],
      }),
    )
    expect(c.examples).toEqual([
      { id: 'C1.1', input: null, output: null },
      { id: 'C1.2', input: [1, { a: 2 }], output: false, error: 'E' },
    ])
  })

  test('check가 test인 remove 줄은 예시 없이도 된다', () => {
    expect(valueOf(doc({ lines: [line({ kind: 'remove', check: 'test' })] })).lines).toHaveLength(1)
  })

  test('check가 test가 아니면 change 줄도 예시 없이 된다', () => {
    expect(valueOf(doc({ lines: [line({ kind: 'change', check: 'human' })] })).lines).toHaveLength(
      1,
    )
  })

  test('어느 줄도 쓰지 않는 예시도 받는다', () => {
    const c = valueOf(doc({ examples: [{ id: 'C1.1', input: 1 }] }))
    expect(c.examples).toHaveLength(1)
  })

  test('파일 앞의 BOM을 무시한다', () => {
    expect(valueOf('﻿' + doc()).id).toBe('w1')
  })
})

describe('parseContract: 잘못된 입력', () => {
  test('JSON이 아니면 오류', () => {
    expect(errorsOf('{')[0]).toMatch(/^JSON을 읽지 못함: /)
  })

  test.each(['[]', 'null', '1'])('최상위가 객체가 아니면 오류 (%s)', (text) => {
    expect(errorsOf(text)).toEqual(['최상위: 객체여야 함'])
  })

  test('알 수 없는 키는 키 경로와 함께 오류', () => {
    const errors = errorsOf(
      doc({
        type: 'bugfix',
        lines: [
          line({
            owner: 'x',
            grounds: [
              { type: 'guess', why: 'x' },
              { type: 'code', path: 'a', line: 1, col: 2 },
            ],
          }),
        ],
        examples: [{ id: 'C1.1', input: 1, expected: 2 }],
      }),
    )
    expect(errors).toEqual([
      'type: 알 수 없는 키',
      'lines[0].owner: 알 수 없는 키',
      'lines[0].grounds[0].why: 알 수 없는 키',
      'lines[0].grounds[1].col: 알 수 없는 키',
      'examples[0].expected: 알 수 없는 키',
    ])
  })

  test('version이 없거나 1이 아니면 오류', () => {
    const noVersion = { id: 'w1', goal: '목표', lines: [line()] }
    expect(errorsOf(JSON.stringify(noVersion))).toEqual(['version: 필요함'])
    expect(errorsOf(doc({ version: 2 }))).toEqual(['version: 1이어야 함'])
  })

  test('id·goal·lines는 꼭 있어야 한다', () => {
    expect(errorsOf(JSON.stringify({ version: 1 }))).toEqual([
      'id: 필요함',
      'goal: 필요함',
      'lines: 필요함',
    ])
  })

  test.each(['a/b', '../x', '.hidden', 'a b', ''])(
    '계약 id가 파일 이름으로 못 쓰면 오류 (%s)',
    (id) => {
      expect(errorsOf(doc({ id }))[0]).toMatch(/^id: /)
    },
  )

  test('줄이 하나도 없으면 오류', () => {
    expect(errorsOf(doc({ lines: [] }))).toEqual(['lines: 줄이 하나 이상 있어야 함'])
  })

  test.each(['L1', 'c1', 'C', 'C1.1', 'C-1'])('줄 id가 C<숫자>가 아니면 오류 (%s)', (id) => {
    expect(errorsOf(doc({ lines: [line({ id })] }))).toEqual(['lines[0].id: C<숫자> 모양이어야 함'])
  })

  test('줄 id가 겹치면 오류', () => {
    expect(errorsOf(doc({ lines: [line(), line()] }))).toEqual(['lines[1].id: id가 겹침 (C1)'])
  })

  test('줄의 종류와 check는 정한 값만', () => {
    expect(errorsOf(doc({ lines: [line({ kind: 'refactor' })] }))).toEqual([
      "lines[0].kind: 'change', 'new', 'keep', 'remove', 'observe', 'human' 중 하나여야 함",
    ])
    expect(errorsOf(doc({ lines: [line({ check: 'ci' })] }))).toEqual([
      "lines[0].check: 'test', 'observe', 'human' 중 하나여야 함",
    ])
  })

  test('줄의 text가 비면 오류', () => {
    expect(errorsOf(doc({ lines: [line({ text: ' ' })] }))).toEqual([
      'lines[0].text: 비어 있으면 안 됨',
    ])
  })

  test.each(['change', 'new', 'keep'])(
    'check가 test인 %s 줄은 예시가 하나 이상 있어야 한다',
    (kind) => {
      expect(errorsOf(doc({ lines: [line({ kind, check: 'test' })] }))).toEqual([
        `lines[0].examples: 시험으로 확인하는 ${kind} 줄은 예시가 하나 이상 있어야 함`,
      ])
    },
  )

  test('human 줄의 check는 human이어야 한다', () => {
    expect(errorsOf(doc({ lines: [line({ kind: 'human', check: 'observe' })] }))).toEqual([
      "lines[0].check: human 줄은 'human'이어야 함",
    ])
  })

  test.each(['C1-1', 'C1.', '1.1', 'C1.x', 'C1.1.1'])('예시 id 모양이 틀리면 오류 (%s)', (id) => {
    expect(errorsOf(doc({ examples: [{ id, input: 1 }] }))).toEqual([
      'examples[0].id: <줄 id>.<숫자> 모양이어야 함',
    ])
  })

  test('예시 id가 겹치거나 주인 줄이 없으면 오류', () => {
    const errors = errorsOf(
      doc({
        examples: [
          { id: 'C1.1', input: 1 },
          { id: 'C1.1', input: 2 },
          { id: 'C9.1', input: 3 },
        ],
      }),
    )
    expect(errors).toEqual(['examples[1].id: id가 겹침 (C1.1)', 'examples[2].id: 없는 줄 (C9)'])
  })

  test('줄이 가리키는 예시는 계약에 있고 그 줄의 것이어야 한다', () => {
    const errors = errorsOf(
      doc({
        lines: [
          line({
            id: 'C1',
            kind: 'new',
            check: 'test',
            examples: ['C1.1', 'C1.1', 'C1.2', 'C2.1'],
          }),
          line({ id: 'C2', kind: 'keep', check: 'test', examples: ['C2.1'] }),
        ],
        examples: [
          { id: 'C1.1', input: 1 },
          { id: 'C2.1', input: 2 },
        ],
      }),
    )
    expect(errors).toEqual([
      'lines[0].examples[1]: 예시가 겹침 (C1.1)',
      'lines[0].examples[2]: examples에 없는 예시 (C1.2)',
      'lines[0].examples[3]: C1의 예시가 아님 (C2.1)',
    ])
  })

  test('예시에 input이 없으면 오류', () => {
    expect(errorsOf(doc({ examples: [{ id: 'C1.1', output: 1 }] }))).toEqual([
      'examples[0].input: 필요함',
    ])
  })

  test('근거의 종류별 칸을 검사한다', () => {
    const errors = errorsOf(
      doc({
        lines: [
          line({
            grounds: [
              { type: 'code', path: 'a.ts', line: 0 },
              { type: 'code', path: 'a.ts', line: 1.5 },
              { type: 'code', path: '/etc/passwd', line: 1 },
              { type: 'code', line: 3 },
              { type: 'request', quote: '' },
              { type: 'knowledge' },
              { type: 'vibe' },
              { path: 'a.ts' },
              'guess',
            ],
          }),
        ],
      }),
    )
    expect(errors).toEqual([
      'lines[0].grounds[0].line: 1 이상의 정수여야 함',
      'lines[0].grounds[1].line: 1 이상의 정수여야 함',
      'lines[0].grounds[2].path: 레포 안의 상대 경로여야 함',
      'lines[0].grounds[3].path: 필요함',
      'lines[0].grounds[4].quote: 비어 있으면 안 됨',
      'lines[0].grounds[5].id: 필요함',
      "lines[0].grounds[6].type: 'code', 'request', 'knowledge', 'guess' 중 하나여야 함",
      'lines[0].grounds[7].type: 필요함',
      'lines[0].grounds[8]: 객체여야 함',
    ])
  })

  test('approved_by는 human이나 caller만', () => {
    expect(errorsOf(doc({ approved_by: 'agent' }))).toEqual([
      "approved_by: 'human', 'caller' 중 하나여야 함",
    ])
  })

  test('목록 칸의 타입을 검사한다', () => {
    expect(errorsOf(doc({ non_goals: 'x', tidy: [1], human_rules: [''] }))).toEqual([
      'non_goals: 배열이어야 함',
      'human_rules[0]: 비어 있으면 안 됨',
      'tidy[0]: 문자열이어야 함',
    ])
  })
})

describe('checkRequestQuote', () => {
  const request = '버튼을 누르면\n  저장되게 해 줘.\t빈 줄은 건너뛰어 줘.'

  test('요청에 그대로 있으면 참', () => {
    expect(checkRequestQuote(request, '빈 줄은 건너뛰어 줘')).toBe(true)
  })

  test('공백의 종류와 개수가 달라도 참', () => {
    expect(checkRequestQuote(request, '누르면 저장되게')).toBe(true)
    expect(checkRequestQuote(request, '  저장되게   해 줘. 빈 줄은 ')).toBe(true)
    expect(checkRequestQuote('a b', 'a b')).toBe(true)
  })

  test('없는 구절이면 거짓', () => {
    expect(checkRequestQuote(request, '삭제되게 해 줘')).toBe(false)
  })

  test('대소문자를 가린다', () => {
    expect(checkRequestQuote('Save the file', 'save the file')).toBe(false)
  })

  test('공백을 지우지는 않는다', () => {
    expect(checkRequestQuote(request, '누르면저장되게')).toBe(false)
  })

  test('비었거나 공백뿐인 인용은 거짓', () => {
    expect(checkRequestQuote(request, '')).toBe(false)
    expect(checkRequestQuote(request, ' \n\t')).toBe(false)
  })

  test('한글의 조합형(NFD)과 완성형(NFC)을 같게 본다', () => {
    expect(checkRequestQuote('저장해 줘'.normalize('NFD'), '저장해')).toBe(true)
    expect(checkRequestQuote('저장해 줘', '저장해'.normalize('NFD'))).toBe(true)
  })
})

describe('checkCodeGround', () => {
  const file = ['import x', '', 'export function sumLines(text) {', '  return 0', '}', ''].join(
    '\n',
  )

  test('파일이 없으면 실패', () => {
    expect(checkCodeGround(null, { line: 1 })).toEqual({ ok: false, detail: '파일이 없음' })
  })

  test('범위 안의 줄 번호는 성공', () => {
    expect(checkCodeGround(file, { line: 1 }).ok).toBe(true)
    expect(checkCodeGround(file, { line: 5 })).toEqual({ ok: true, detail: '5번 줄이 있음' })
  })

  test.each([0, -1, 6, 1.5, Number.NaN])('범위 밖의 줄 번호는 실패 (%s)', (n) => {
    const r = checkCodeGround(file, { line: n })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('(파일은 5줄)')
  })

  test('끝의 줄바꿈은 줄로 세지 않고 빈 파일은 0줄', () => {
    expect(checkCodeGround('a\nb\n', { line: 2 }).ok).toBe(true)
    expect(checkCodeGround('a\nb\n', { line: 3 }).ok).toBe(false)
    expect(checkCodeGround('a\nb', { line: 2 }).ok).toBe(true)
    expect(checkCodeGround('', { line: 1 })).toEqual({
      ok: false,
      detail: '1번 줄이 없음 (파일은 0줄)',
    })
    expect(checkCodeGround('\n', { line: 1 }).ok).toBe(true)
  })

  test('CRLF와 CR 줄바꿈도 줄로 가른다', () => {
    expect(checkCodeGround('a\r\nb\r\nc\r\n', { line: 3 }).ok).toBe(true)
    expect(checkCodeGround('a\r\nb\r\nc\r\n', { line: 4 }).ok).toBe(false)
    expect(checkCodeGround('a\rb', { line: 2, name: 'b' }).ok).toBe(true)
  })

  test('이름이 그 줄에 있으면 성공', () => {
    expect(checkCodeGround(file, { line: 3, name: 'sumLines' })).toEqual({
      ok: true,
      detail: '3번 줄에 sumLines 있음',
    })
  })

  test('이름이 ±2줄 안에 있으면 성공하고 찾은 줄을 알린다', () => {
    expect(checkCodeGround(file, { line: 1, name: 'sumLines' })).toEqual({
      ok: true,
      detail: '3번 줄에 sumLines 있음',
    })
    expect(checkCodeGround(file, { line: 5, name: 'sumLines' }).ok).toBe(true)
  })

  test('이름이 ±2줄 밖에만 있으면 실패', () => {
    const far = ['function target() {}', 'a', 'b', 'c', 'd'].join('\n')
    expect(checkCodeGround(far, { line: 4, name: 'target' })).toEqual({
      ok: false,
      detail: '2~5번 줄에 target 없음',
    })
  })

  test('식별자의 일부로만 있으면 이름으로 보지 않는다', () => {
    const text = 'const width = 1\nconst idx = 2\nconst sumLinesAll = 3'
    expect(checkCodeGround(text, { line: 1, name: 'id' }).ok).toBe(false)
    expect(checkCodeGround(text, { line: 3, name: 'sumLines' }).ok).toBe(false)
    expect(checkCodeGround('f(id)', { line: 1, name: 'id' }).ok).toBe(true)
    expect(checkCodeGround('const $id_2 = 1', { line: 1, name: '$id_2' }).ok).toBe(true)
  })

  test('기호가 섞인 이름도 찾는다', () => {
    expect(checkCodeGround('a = foo.bar()', { line: 1, name: 'foo.bar' }).ok).toBe(true)
    expect(checkCodeGround('def handle(x):', { line: 1, name: 'def handle' }).ok).toBe(true)
    expect(checkCodeGround('x.on("save", go)', { line: 1, name: '"save"' }).ok).toBe(true)
  })

  test('한 줄에 같은 글자가 여러 번 나오면 맞는 자리를 끝까지 찾는다', () => {
    expect(checkCodeGround('widthid + id', { line: 1, name: 'id' }).ok).toBe(true)
  })

  test('빈 이름은 이름을 주지 않은 것과 같다', () => {
    expect(checkCodeGround(file, { line: 2, name: '' })).toEqual({
      ok: true,
      detail: '2번 줄이 있음',
    })
  })
})

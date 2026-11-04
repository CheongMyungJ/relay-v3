// [단위] Work의 짧은 이름(작업 브랜치 relay/<짧은 이름>-<4자>, 계약 id): src/main/works-worktree.ts shortName
import { expect, test } from 'vitest'
import { romanize, shortName } from '../../src/main/works-worktree.ts'

test('영문 낱말이 있으면 그것으로, 24자까지', () => {
  expect(shortName('clamp fix: 값이 위로 넘으면 hi로 잘라야 하는데 lo가 나와요.')).toBe(
    'clamp-fix-hi-lo',
  )
  expect(shortName('Add a very long feature name that keeps going')).toBe('add-a-very-long-feature')
})

test('한국어로만 쓴 요청은 한글을 로마자로 옮겨 서로 구분된다', () => {
  expect(romanize('로그인 화면')).toBe('rogeuin hwamyeon')
  expect(romanize('값 읽기')).toBe('gap ikgi')
  const a = shortName('로그인 화면에서 비밀번호 오류 문구를 고쳐 주세요')
  const b = shortName('결제 금액 반올림 규칙 바꾸기')
  expect(a).toBe('rogeuin-hwamyeoneseo')
  expect(b).toBe('gyeolje-geumaek-banolrim')
  expect(a).toMatch(/^[a-z0-9-]{1,24}$/)
  expect(shortName('!!! ???')).toBe('work')
})

test('한글에 숫자만 섞인 요청은 숫자가 아니라 로마자 이름이다(relay/3-xxxx가 되지 않게)', () => {
  expect(shortName('청구서 합계가 3원 크다')).toBe('cheongguseo-hapgyega')
  expect(shortName('3원 더 나와요')).toBe('3won-deo-nawayo')
  expect(shortName('2024년 보고서')).toBe('2024nyeon-bogoseo')
  // 영문 낱말이 하나라도 있으면 그대로(숫자는 이름에 남는다)
  expect(shortName('v2 화면 고치기')).toBe('v2')
  expect(shortName('fix 3 bugs')).toBe('fix-3-bugs')
  // 글자가 하나도 없으면 숫자만으로 짓지 않는다
  expect(shortName('123 456')).toBe('work-123-456')
  expect(shortName('1234567890 1234567890 1234')).toBe('work-1234567890')
  for (const r of ['청구서 합계가 3원 크다', '42', '7 8 9', '3원']) {
    expect(shortName(r)).toMatch(/[a-z]/)
    expect(shortName(r)).toMatch(/^[a-z0-9-]{1,24}$/)
    expect(shortName(r)).not.toMatch(/-$/)
  }
})

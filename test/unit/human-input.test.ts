// [단위] 되먹임(V24)의 '사람이 터미널에 입력함'(src/main/works-feedback.ts isHumanInput): 화면의 xterm이 claude의 물음에
// 저절로 낸 답(포커스, 장치 속성, 커서 위치, 모드·색 보고)은 사람의 입력이 아니다. 앱의 tell은 이 길을 지나지 않는다.
// '입력 칸에 쓰다 둔 글'(leavesDraft): 마지막 입력이 Enter나 Ctrl+C로 끝나지 않았다
import { describe, expect, test } from 'vitest'
import {
  FEEDBACK_ROUNDS,
  isHumanInput,
  leavesDraft,
  PREPARED_MAX,
} from '../../src/main/works-feedback.ts'

const ESC = '\u001b'

describe('isHumanInput', () => {
  test.each([
    ['포커스 들어옴', `${ESC}[I`],
    ['포커스 나감', `${ESC}[O`],
    ['장치 속성(DA1)', `${ESC}[?1;2c`],
    ['장치 속성(DA2)', `${ESC}[>0;276;0c`],
    ['커서 위치', `${ESC}[12;40R`],
    ['상태 보고', `${ESC}[0n`],
    ['창 크기', `${ESC}[8;32;120t`],
    ['키보드 모드(kitty)', `${ESC}[?0u`],
    ['모드 보고(DECRPM)', `${ESC}[?2026;2$y`],
    ['배경색(OSC 11, BEL)', `${ESC}]11;rgb:1e1e/1e1e/1e1e\u0007`],
    ['배경색(OSC 11, ST)', `${ESC}]11;rgb:ffff/ffff/ffff${ESC}\\`],
    ['터미널 이름(DCS)', `${ESC}P>|xterm.js(5.5.0)${ESC}\\`],
    ['답 여럿', `${ESC}[I${ESC}[?1;2c${ESC}[O`],
  ])('%s는 사람의 입력이 아니다', (_, data) => {
    expect(isHumanInput(data)).toBe(false)
  })

  test.each([
    ['글자', 'a'],
    ['Enter', '\r'],
    ['붙여 넣은 글', '고쳐 주세요\r'],
    ['화살표', `${ESC}[A`],
    ['Esc', ESC],
    ['Ctrl+C', '\u0003'],
    ['답 뒤의 글자', `${ESC}[Ix`],
  ])('%s는 사람의 입력이다', (_, data) => {
    expect(isHumanInput(data)).toBe(true)
  })
})

describe('leavesDraft: 입력 칸에 보내지 않은 글이 남을 수 있나(되먹임의 한 줄이 그 글에 붙지 않게)', () => {
  test.each([
    ['글자', 'a'],
    ['보낸 뒤 다시 친 글', '고쳐 주세요\r다음'],
    ['붙여 넣은 글(bracketed paste, 안의 Enter는 보내지 않는다)', `${ESC}[200~a\rb${ESC}[201~`],
    ['화살표(지난 글 불러오기)', `${ESC}[A`],
    ['지우기', '\u007f'],
    ['Esc', ESC],
    ['글 뒤의 포커스 보고', `a${ESC}[O`],
  ])('%s는 남긴다', (_, data) => {
    expect(leavesDraft(data)).toBe(true)
  })

  test.each([
    ['Enter', '\r'],
    ['글과 Enter', '고쳐 주세요\r'],
    ['Ctrl+C(입력 칸을 비운다)', '\u0003'],
    ['Enter 뒤의 포커스 보고', `\r${ESC}[I`],
    ['터미널이 저절로 낸 답', `${ESC}[I${ESC}[?1;2c`],
  ])('%s는 남기지 않는다', (_, data) => {
    expect(leavesDraft(data)).toBe(false)
  })
})

test('미리 리뷰의 상한은 처음 1번과 되먹임 라운드 상한이다(V23, V24)', () => {
  expect(FEEDBACK_ROUNDS).toBe(3)
  expect(PREPARED_MAX).toBe(1 + FEEDBACK_ROUNDS)
})

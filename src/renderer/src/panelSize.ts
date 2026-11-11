// 오른쪽 패널의 너비 (V78). 터미널은 70열쯤(TERMINAL_MIN) 남아야 하므로 패널이 넓어질 수 있는 끝은 창에 달려 있다. CSS(work.css의
// .terminal-pane min-width, panels.css의 .panel min-width)와 같은 수다. DOM을 쓰지 않는 순수 함수만 둔다.

export const PANEL_DEFAULT = 480
export const PANEL_MIN = 340
export const PANEL_MAX = 900
export const TERMINAL_MIN = 560

/**
 * 지금 창에서 패널이 가질 수 있는 가장 큰 너비. room은 터미널과 패널이 나눠 쓰는 너비(경계 손잡이를 뺀 것)이고 재기 전에는 null이다.
 * 이 끝을 넘겨 끌 수 있으면 화면은 그대로인데 기억하는 너비만 커져, 다시 줄일 때 그만큼 헛돈다
 */
export function panelMax(room: number | null): number {
  if (room === null) return PANEL_MAX
  return Math.min(PANEL_MAX, Math.max(PANEL_MIN, Math.floor(room - TERMINAL_MIN)))
}

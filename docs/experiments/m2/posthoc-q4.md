# M2 Q4 사후 계산 (래칫 태그 거짓 양성을 고친 관문)

| 쪽 | 판정한 실행 | 내보내기 실행 | 자동 조건(규약) | 자동 조건(사후) | G1 사후 | G2 사후 | 다시 못 잰 Work |
|---|---|---|---|---|---|---|---|
| relay3 | 44 | 44 | 5 | 5 | 40% (2/5) | 5% (2/39) | 0 |
| relay3-handsoff | 25 | 25 | 0 | 0 | - | 0% (0/13) | 0 |
| relay3-noreview | 45 | 45 | 0 | 0 | - | 0% (0/39) | 0 |

## 탐색(규약 밖): 래칫을 고치고 리뷰 올림을 severity medium 이상만 셀 때

| 쪽 | 내보내기 실행 | 자동 조건 | G1 | G2 |
|---|---|---|---|---|
| relay3 | 44 | 16 | 81% (13/16) | 33% (13/39) |
| relay3-handsoff | 25 | 1 | 100% (1/1) | 8% (1/13) |
| relay3-noreview | 45 | 0 | - | 0% (0/39) |

relay3에서 그래도 사람 머지로 간 까닭: 래칫 나빠짐 2, 리뷰 올림 25, 줄 29, 채운 자동 조건 없음 8, 조건 small 8

## 사후에도 사람 머지로 간 까닭 (내보내기 Work, 까닭마다 센 수)

- relay3: 리뷰 올림 57, 줄 29, 래칫 나빠짐 2, 채운 자동 조건 없음 2, 조건 small 2
- relay3-handsoff: 리뷰 올림 28, 줄 22
- relay3-noreview: 리뷰를 건너뜀 64, 줄 26, 명령 3, 지킴 파일을 건드림 (.relay/q 2, 래칫 나빠짐 1

래칫을 고친 Work 26개: 07-two-bugs/relay3-3/3f3e2aa9, 07-two-bugs/relay3-3/630d1a52, 07-two-bugs/relay3-5/d93aa5ae, 07-two-bugs/relay3-noreview-1/6a85fd9a, 07-two-bugs/relay3-noreview-2/bf931a61, 07-two-bugs/relay3-noreview-3/eacde3d2, 08-timezone/relay3-noreview-3/9bc329cc, 40-three-libraries/relay3-noreview-3/6cb894c9, 43-split-engines/relay3-noreview-1/7eac7d60, 43-split-engines/relay3-noreview-3/3879124b, 43-split-engines/relay3-noreview-4/bb37dcd3, 44-rough-engines/relay3-1/b0c974c2, 44-rough-engines/relay3-noreview-1/bffbf253, 44-rough-engines/relay3-noreview-3/b5c1be8c, 45-rough-libraries/relay3-noreview-2/33ff8708, 43-split-engines/relay3-2/317082ed, 43-split-engines/relay3-3/39f307c8, 43-split-engines/relay3-4/4c3e2e26, 43-split-engines/relay3-5/5983b072, 44-rough-engines/relay3-1/08f5deb5, 44-rough-engines/relay3-2/01e4072b, 44-rough-engines/relay3-3/1d457a57, 45-rough-libraries/relay3-1/4d4e05ef, 45-rough-libraries/relay3-2/c46348e3, 45-rough-libraries/relay3-3/56c94282, 45-rough-libraries/relay3-5/f994eb1d

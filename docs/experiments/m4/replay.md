# M4 재생 (가)

규약 8.4의 2. `npm run test:track`(규약 SHA `d287c4a`, 2026-11-06 UTC) 출력 그대로.

```
재생 실적 (M4g): Work 288개(m2 158, m2.1 40, m3 90). 사람은 AI 사람 역할, 레포는 시나리오 레포다(제품 실적과 섞지 않음)

표 1. 조건별 그림자 정밀도·재현율(평가 빌드가 장부에 적은 결론, 단위 Work, 숨긴 시험이 이름표)
| 규약 | 쪽 | 조건 | Work | 숨긴 시험 통과 | 조건 채움 | 거짓 자동 | G1 | G2 |
|---|---|---|---|---|---|---|---|---|
| m2 | relay3 | small | 65 | 60 | 5 | 3 | 40% | 3% |
| m2 | relay3-handsoff | small | 29 | 17 | 0 | 0 | - | 0% |
| m2 | relay3-noreview | small | 64 | 58 | 0 | 0 | - | 0% |
| m2.1 | relay3-m21 | small | 40 | 38 | 8 | 0 | 100% | 21% |
| m3 | relay3 | small | 45 | 39 | 1 | 0 | 100% | 3% |
| m3 | relay3-m2 | small | 45 | 36 | 1 | 0 | 100% | 3% |
지금 관문(V31 재생 묶음, 초안 정책): m2.1 거짓 자동 0, 실행 G1 100% (3/3), G2 9% (3/33); m2 거짓 자동 3, 실행 G1 77% (10/13), G2 11% (10/91)

표 2a. AI 사람 역할과의 일치(shadowStats, 실행을 넘어 합침, 모든 판, 장부 그대로)
| 규약 | 조건 | 일치 k/n | Wilson 하한 | 불일치 | 분모 밖 | 비교군 그대로 | lift |
|---|---|---|---|---|---|---|---|
| m2 | small | 0/0 | - | - | open 5 | 0/0 | - |
| m2.1 | small | 0/0 | - | - | open 8 | 0/0 | - |
| m3 | small | 1/2 | 0.09 | more_unknown 1 | - | 62/88 | -0.20 |

표 2b. AI 사람 역할과의 일치(shadowStats, 실행을 넘어 합침, 모든 판, PR 없이 [끝내기]를 머지로 봄, 같은 변경을 모름은 불일치)
| 규약 | 조건 | 일치 k/n | Wilson 하한 | 불일치 | 분모 밖 | 비교군 그대로 | lift |
|---|---|---|---|---|---|---|---|
| m2 | small | 5/5 | 0.57 | - | - | 121/153 | 0.21 |
| m2.1 | small | 8/8 | 0.68 | - | - | 14/32 | 0.56 |
| m3 | small | 1/2 | 0.09 | more_unknown 1 | - | 62/88 | -0.20 |

표 2c. AI 사람 역할과의 일치(shadowStats, 실행을 넘어 합침, 모든 판, PR 없이 [끝내기]를 머지로 봄, 같은 변경을 모름은 열림(분모 밖))
| 규약 | 조건 | 일치 k/n | Wilson 하한 | 불일치 | 분모 밖 | 비교군 그대로 | lift |
|---|---|---|---|---|---|---|---|
| m2 | small | 5/5 | 0.57 | - | - | 121/153 | 0.21 |
| m2.1 | small | 8/8 | 0.68 | - | - | 14/27 | 0.48 |
| m3 | small | 1/2 | 0.09 | more_unknown 1 | - | 62/88 | -0.20 |

같은 변경을 가르지 못한 [끝내기] Work(same_as_export null, 까닭은 자료를 만들 때 scripts/track-replay.ts가 찍는다): m2 0, m2.1 5, m3 0

표 3. 머지 뒤 대리 지표(M3 순차: 누적 숨긴 시험, main의 레포 시험)
Work 90: 앞 Work의 숨긴 시험을 새로 깨뜨림 0, 그때 통과했는데 뒤에서 깨짐 0
귀속 대리(main 레포 시험 실패, 앞 main 통과) 0, 그 가운데 깨뜨림 0: 정밀도 -, 재현율 - (분모 0이면 '-': 잴 수 없음)
그림자 표본(조건 small을 채운 Work) 2: 깨뜨림 0, 뒤에서 깨짐 0

표 4. 생성 안정성(8절 C, 재생 묶음, 지금 관문): 무리마다 조건 채움 k/n, 사람 줄 k/n, 결론 갈래 수, 줄 종류 다중집합 수
- m2.1/07-two-bugs/relay3-m21: 조건 채움 3/5, 사람 줄 0/5, 결론 1갈래, 줄 종류 5가지
- m2/07-two-bugs/relay3: 조건 채움 4/5, 사람 줄 0/5, 결론 1갈래, 줄 종류 2가지
- m2/08-timezone/relay3: 조건 채움 2/5, 사람 줄 0/5, 결론 1갈래, 줄 종류 3가지
- m2/10-invoice-rounding/relay3: 조건 채움 1/5, 사람 줄 0/5, 결론 1갈래, 줄 종류 3가지
- m2/14-double-notify/relay3: 조건 채움 4/5, 사람 줄 0/5, 결론 1갈래, 줄 종류 3가지
- m2/40-three-libraries/relay3-noreview: 조건 채움 0/5, 사람 줄 1/5, 결론 1갈래, 줄 종류 4가지
- m2/44-rough-engines/relay3-noreview: 조건 채움 0/5, 사람 줄 1/5, 결론 1갈래, 줄 종류 4가지
- m2/45-rough-libraries/relay3: 조건 채움 1/5, 사람 줄 2/5, 결론 1갈래, 줄 종류 4가지
- m2/45-rough-libraries/relay3-handsoff: 조건 채움 1/5, 사람 줄 3/5, 결론 1갈래, 줄 종류 3가지
- m2/45-rough-libraries/relay3-noreview: 조건 채움 0/5, 사람 줄 2/5, 결론 1갈래, 줄 종류 4가지
무리 30개 가운데 조건 채움이 갈림 7, 사람 줄이 갈림 5, 결론이 갈림 0

표 5. 실행 단위 조건 채움(재생 묶음과 Work 자료, 규약의 RUN_MET. 내보내기 묶음이 없는 실행은 채우지 않음으로 n에 든다)
| 무리 | 실행 | 채움 (b) 지금 관문 | 채움 (a) 앱 장부 | 내보내기 없음 | 숨긴 시험 통과 | 거짓 자동 | (a)≠(b) | 갈림 |
|---|---|---|---|---|---|---|---|---|
| m2.1/07-two-bugs/relay3-m21 | 5 | 3/5 | - | 0 | 5 | 0 | 0 | 갈림 |
| m2.1/09-stock-negative/relay3-m21 | 5 | 0/5 | - | 0 | 5 | 0 | 0 | 같음 |
| m2.1/14-double-notify/relay3-m21 | 5 | 0/5 | - | 0 | 3 | 0 | 0 | 같음 |
| m2.1/19-split-report/relay3-m21 | 5 | 0/5 | - | 0 | 5 | 0 | 0 | 같음 |
| m2.1/39-three-modules/relay3-m21 | 5 | 0/5 | - | 0 | 5 | 0 | 0 | 같음 |
| m2.1/40-three-libraries/relay3-m21 | 5 | 0/5 | - | 0 | 5 | 0 | 0 | 같음 |
| m2.1/47-double-notify-digest-w2/relay3-m21 | 5 | 0/5 | - | 0 | 5 | 0 | 0 | 같음 |
| m2/07-two-bugs/relay3 | 5 | 4/5 | - | 0 | 5 | 0 | 0 | 갈림 |
| m2/07-two-bugs/relay3-noreview | 5 | 0/5 | - | 0 | 5 | 0 | 0 | 같음 |
| m2/08-timezone/relay3 | 5 | 2/5 | - | 0 | 5 | 0 | 0 | 갈림 |
| m2/08-timezone/relay3-noreview | 5 | 0/5 | - | 0 | 5 | 0 | 0 | 같음 |
| m2/10-invoice-rounding/relay3 | 5 | 1/5 | - | 0 | 5 | 0 | 0 | 갈림 |
| m2/10-invoice-rounding/relay3-handsoff | 5 | 0/5 | - | 0 | 5 | 0 | 0 | 같음 |
| m2/10-invoice-rounding/relay3-noreview | 5 | 0/5 | - | 0 | 5 | 0 | 0 | 같음 |
| m2/14-double-notify/relay3 | 5 | 4/5 | - | 0 | 1 | 3 | 0 | 갈림 |
| m2/14-double-notify/relay3-handsoff | 5 | 0/5 | - | 0 | 2 | 0 | 0 | 같음 |
| m2/14-double-notify/relay3-noreview | 5 | 0/5 | - | 0 | 1 | 0 | 0 | 같음 |
| m2/19-split-report/relay3 | 5 | 0/5 | - | 0 | 5 | 0 | 0 | 같음 |
| m2/19-split-report/relay3-noreview | 5 | 0/5 | - | 0 | 5 | 0 | 0 | 같음 |
| m2/40-three-libraries/relay3 | 5 | 0/5 | - | 0 | 5 | 0 | 0 | 같음 |
| m2/40-three-libraries/relay3-noreview | 5 | 0/5 | - | 0 | 5 | 0 | 0 | 같음 |
| m2/43-split-engines/relay3 | 5 | 0/5 | - | 0 | 5 | 0 | 0 | 같음 |
| m2/43-split-engines/relay3-handsoff | 5 | 0/5 | - | 0 | 1 | 0 | 0 | 같음 |
| m2/43-split-engines/relay3-noreview | 5 | 0/5 | - | 0 | 5 | 0 | 0 | 같음 |
| m2/44-rough-engines/relay3 | 4 | 0/4 | - | 0 | 3 | 0 | 0 | 같음 |
| m2/44-rough-engines/relay3-handsoff | 5 | 0/5 | - | 0 | 0 | 0 | 0 | 같음 |
| m2/44-rough-engines/relay3-noreview | 5 | 0/5 | - | 0 | 3 | 0 | 0 | 같음 |
| m2/45-rough-libraries/relay3 | 5 | 1/5 | - | 0 | 5 | 0 | 0 | 갈림 |
| m2/45-rough-libraries/relay3-handsoff | 5 | 1/5 | - | 0 | 5 | 0 | 0 | 갈림 |
| m2/45-rough-libraries/relay3-noreview | 5 | 0/5 | - | 0 | 5 | 0 | 0 | 같음 |
m2: 실행 114(내보내기 없음 0), 채움 13, 거짓 자동 3, 실행 G1 77% (10/13), G2 11% (10/91), 갈린 무리 6/23(실행 4 아래인 무리 0은 판정하지 않음), (a)≠(b) 실행 0
m2.1: 실행 35(내보내기 없음 0), 채움 3, 거짓 자동 0, 실행 G1 100% (3/3), G2 9% (3/33), 갈린 무리 1/7(실행 4 아래인 무리 0은 판정하지 않음), (a)≠(b) 실행 0
묶음 단위로 앱 장부의 met과 지금 관문을 견줌(met 칸이 있는 묶음 0): 다름 0


```

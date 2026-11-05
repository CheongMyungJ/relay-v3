# M2.1 평가 결과

## 0단계 O1: 관문 재생 (2026-11-05, relay-v3 `f378f31`, `npm run test:replay`)

통과: V26 규칙에서 거짓 자동 3개(래칫 3). 찍은 표:

| 규칙 | 단위 | 나눔 | 수 | 숨긴 시험 통과 | 자동 조건 | 거짓 자동 | G1 | G2 |
|---|---|---|---|---|---|---|---|---|
| V4 | 묶음 | 모두 | 158 | 135 | 5 | 3 | 40% (2/5) | 1% (2/135) |
| V4 | 묶음 | 조건 small | 158 | 135 | 5 | 3 | 40% (2/5) | 1% (2/135) |
| V4 | 묶음 | 바뀜 줄 있음 | 66 | 55 | 5 | 3 | 40% (2/5) | 4% (2/55) |
| V4 | 묶음 | 바뀜 줄 없음 | 92 | 80 | 0 | 0 | - | 0% (0/80) |
| V4 | 묶음 | relay3 | 65 | 60 | 5 | 3 | 40% (2/5) | 3% (2/60) |
| V4 | 묶음 | relay3-handsoff | 29 | 17 | 0 | 0 | - | 0% (0/17) |
| V4 | 묶음 | relay3-noreview | 64 | 58 | 0 | 0 | - | 0% (0/58) |
| V4 | 실행 | relay3 | 44 | 39 | 5 | 3 | 40% (2/5) | 5% (2/39) |
| V4 | 실행 | relay3-handsoff | 25 | 13 | 0 | 0 | - | 0% (0/13) |
| V4 | 실행 | relay3-noreview | 45 | 39 | 0 | 0 | - | 0% (0/39) |
| V26 | 묶음 | 모두 | 158 | 135 | 14 | 3 | 79% (11/14) | 8% (11/135) |
| V26 | 묶음 | 조건 small | 158 | 135 | 14 | 3 | 79% (11/14) | 8% (11/135) |
| V26 | 묶음 | 바뀜 줄 있음 | 66 | 55 | 12 | 3 | 75% (9/12) | 16% (9/55) |
| V26 | 묶음 | 바뀜 줄 없음 | 92 | 80 | 2 | 0 | 100% (2/2) | 3% (2/80) |
| V26 | 묶음 | relay3 | 65 | 60 | 13 | 3 | 77% (10/13) | 17% (10/60) |
| V26 | 묶음 | relay3-handsoff | 29 | 17 | 1 | 0 | 100% (1/1) | 6% (1/17) |
| V26 | 묶음 | relay3-noreview | 64 | 58 | 0 | 0 | - | 0% (0/58) |
| V26 | 실행 | relay3 | 44 | 39 | 12 | 3 | 75% (9/12) | 23% (9/39) |
| V26 | 실행 | relay3-handsoff | 25 | 13 | 1 | 0 | 100% (1/1) | 8% (1/13) |
| V26 | 실행 | relay3-noreview | 45 | 39 | 0 | 0 | - | 0% (0/39) |

- 거짓 자동(V26) 3개, 래칫 3: 14-double-notify/relay3-1/dc01c449, 14-double-notify/relay3-2/a20b4044, 14-double-notify/relay3-5/5129f362
- 구조/low 지적만 막을 수 있었던 거짓 자동(V26의 끄는 조건) 0개: -

## 0단계 O2: 리뷰 재생 (2026-11-05, 54번, `review-replay.jsonl`)

```
대상 A (14 실패 묶음 × 3번): request_gap을 3번 중 2번 이상 올린 묶음 1/8 → 넘지 못함 (기준: 4개 이상)
  14-double-notify/relay3-1/dc01c449  ●○○  올림 수 2·1·1
  14-double-notify/relay3-noreview-1/26e99966  ○●●  올림 수 2·2·3
  14-double-notify/relay3-2/a20b4044  ●○○  올림 수 5·2·2
  14-double-notify/relay3-noreview-2/f2b704d7  ○○○  올림 수 5·4·4
  14-double-notify/relay3-4/c4f1e71a  ○○○  올림 수 4·2·2
  14-double-notify/relay3-noreview-4/11e9410b  ○○○  올림 수 3·3·3
  14-double-notify/relay3-5/5129f362  ○○○  올림 수 2·1·1
  14-double-notify/relay3-noreview-5/a840189c  ○○○  올림 수 3·2·1
대상 B (통과 묶음 × 1번): request_gap을 올린 묶음 1/30 → 통과 (기준: 4개 이하)
  10-invoice-rounding/relay3-noreview-1/60ef8ca5
B에서 뺀 묶음(숨긴 시험은 통과했지만 요청이 Work의 몫보다 넓음): 9 (40-three-libraries/relay3-1/08932ea2 (full_report), 40-three-libraries/relay3-noreview-1/481b6ce2 (full_report), 40-three-libraries/relay3-2/fc0413ab (full_report), 40-three-libraries/relay3-noreview-2/156da484 (full_report), 40-three-libraries/relay3-3/0ab005e6 (full_report), 40-three-libraries/relay3-4/dce33653 (full_report), 40-three-libraries/relay3-noreview-4/50162f14 (full_report), 40-three-libraries/relay3-5/b5ad82df (full_report), 40-three-libraries/relay3-noreview-5/47b8f5b8 (full_report))
판정: 기준을 넘지 못함. V30은 메모로 내린 채 배치를 돈다(14절)
보고만: 구조 지적 가운데 medium 이상 A 7/32, B 13/52, 모두 20/84 (24%)
보고만: 반복 사이 뒤집힘(반복이 둘 이상인 8묶음): request_gap 3, 올림 있음 0, 구조 medium 이상 6
올림(갈래/심각도): A example_test_mismatch/high 7, example_test_mismatch/low 11, example_test_mismatch/medium 31, request_gap/low 4, structure/medium 7; B example_test_mismatch/low 6, example_test_mismatch/medium 39, out_of_contract/low 4, request_gap/low 1, security/medium 2, structure/medium 13
레포: diff가 증거와 다른 묶음 0, 품질 기준이 평가와 다른 묶음 0, 계약 hash가 증거와 다른 묶음 0
토큰: 입력(캐시 포함) 1070326, 출력 57315
```

- **판정: 넘지 못함**(대상 A 1/8, 기준 4 이상). 대상 B는 1/30으로 기준(4 이하) 안. 규약 6절대로 V30을 메모로 내린 빌드로 배치를 돈다.
- O1에 대어 본 값(보고만): O1의 V26 거짓 자동 셋(14의 relay3-1, 2, 5) 가운데 O2에서 3번 중 2번 이상 request_gap을 올린 묶음은 0이다(relay3-1과 relay3-2는 3번 중 1번, relay3-5는 0번).
- 보고만: 지금 프롬프트(판 3)의 리뷰어는 14의 실패 묶음 여덟 모두에서 매번 다른 갈래(주로 example_test_mismatch medium/high)를 올렸다. 대상 B에서도 example_test_mismatch medium 39개, structure medium 13개를 올렸다. M2 묶음의 시험은 V27 전이라 예시 값을 박아 썼기 때문으로 읽는다(새 프롬프트는 '시험이 앱이 쓴 예시 파일을 읽어야 한다'고 말한다). 그래서 이 재생으로는 지금 리뷰의 G2를 가늠하지 않는다.

## 배치 1·2 (2026-11-05, 65회)

- 집계 표: [primary.md](primary.md)(규약 9절 9의 명령, `RELAY3_RAISE_RULE=memo`). 실행 65회, 도구 문제 0.
- 판정 규칙(14절, 봉인 셋): 1 P1 낮지 않음(m21 − m2p +0.20 [0.07, 0.33]) → 되돌리지 않음. 2 P3 마찰 줄었음(−4.13 [−6.13, −2.13]). P3 막대(m21 − relay@auto) −1.07 [−2.87, 0.60] 모름(δ 2) → M3는 사용자와 정함. 3 거짓 자동 0. 4 P5 −40%, 상한 그대로. G1 모름(자동 조건 3회, 10회 아래).
- 사람·AI 판정(5.4), 관문 재생 자료(m2.1.jsonl), V30 온라인 잡음은 아래에 잇는다.

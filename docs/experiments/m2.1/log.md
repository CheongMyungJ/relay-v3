# M2.1 평가 기록

## 2026-11-05 H2를 만듦

- H2는 `47-double-notify-digest-w2`다(relay-v2 `app/eval/scenarios/`). 23(`23-double-notify-digest`)의 Work 2를 한 Work로 두고, 23의 레포에 Work 1 참조 패치를 얹어 만들었다. `46-rough-modules`는 다른 시나리오다.
- 만든 이: 이 준비 세션에서 설계자가 읽지 않은 에이전트가 만들었다. `eval/check-scenario.mjs`로 확인했다.
- 만든 때: 2026-11-05 12:01 UTC(시나리오 폴더의 시각). 그때의 relay-v3: `fb5776a`(M2.1 빌드의 마지막 고침 커밋). relay-v2에는 `4f144c1`로 들어갔다.
- 숨긴 시험, 참조 패치, 함정은 트리에 평문으로 있다. 설계자는 배치 1·2가 끝날 때까지 열지 않는다. `scenario.json`은 id와 제한을 볼 때만 연다(규약 8절). sha256은 고정 때 적는다.

## 2026-11-05 H2를 만든 뒤 빌드를 고친 것

H2를 보고 고친 것이 아니다. 까닭은 규약 초안의 리뷰 지적이다.

- V24 쓰다 둔 글: 질문 메뉴(AskUserQuestion)에 숫자 키 하나로 답하면 `leavesDraft`가 참인데 메뉴의 답은 UserPromptSubmit을 내지 않아, 입력 칸이 비었는데도 되먹임이 `feedback_held {reason: draft}`로 묶였다. 메뉴의 PostToolUse·PostToolUseFailure에서 지운다([흐름] `works-feedback.test.ts`). 시범에서 본다(규약 9절 1).
- 리뷰 재생(O2, 앱 빌드 밖): 대상 B에서 요청이 Work의 몫보다 넓은 묶음을 뺀다. 리뷰어는 호출마다 새 설정 폴더와 운영자의 세션 변수를 뺀 환경으로 돈다(규약 6절).
- V30을 메모로 내리는 변경을 패치로 미리 만들었다(`v30-memo.patch`). O2가 기준을 넘지 못할 때만 얹는다(규약 6절).

## 2026-11-05 시범 (고정 전, 판정에 넣지 않음)

- 14:15~14:28 UTC, 5회: 40(relay3-m21, relay3-m2p), 08(relay3-m21, relay3-m2p), 10(relay3-m21). 결과 폴더 `m21-pilot-*`. 도구 문제 0, 숨긴 시험 5/5.
- 규약 9절 1의 점검:
  - 운전자가 M2.1 화면을 다뤘다: 걸린 끝(40, 08, 10), 상자와 [그래도 끝내기](40, 08), [취소](40), [세션에 넘기기] 3번(40), 늘 보이는 '고칠 점' 칸(40, 계약 고쳐 달라기 1번), 기준 확인 배지(08, 10). relay3-m2p는 [고쳐 달라고 하기]와 [끝 확정]으로 끝났다.
  - 40의 relay3-m21은 Work 하나에 단위 셋(csv, money, workdays)을 `branch_per_unit`으로 냈다. 내보내기 셋마다 결론이 있고, 통합 증거를 4번 쟀고, Work 브랜치에 없는 단위 브랜치는 0이다. relay3-m2p는 Work 하나에서 세션이 만든 브랜치 셋을 재지 않았다(재지 않은 브랜치 3, V21이 막는 구멍).
  - `feedback_held {reason: 'draft'}`는 없었다(되먹임이 미뤄진 기록 자체가 없다).
  - `config.json`의 빌드 기록: relay3 `df8f71c`, relay3-m2p `8526e0c`, 평가 도구 `7866fa8`, `+dirty` 없음. Claude Code 2.1.318.
  - `m21-primary.mjs`가 표를 채웠고, 시범 폴더가 들어갔다고 머리에 경고했다.
- **볼 것(설계를 바꾸지 않음):** AI 사람 역할은 세션이 멈추고 약 10초 안에 [끝내기]를 눌렀다(40: 9초, 08: 11초). 앱은 Stop 뒤 20초 몰아 두고 나서야 미리 재기·미리 리뷰(V23)와 되먹임(V24)을 시작한다. 그래서 시범 다섯 번 모두 미리 리뷰 0, 자동 되먹임 0이었고, 재기와 리뷰는 [끝내기]의 걸린 끝에서 돌았다(기다림은 같다). 이 평가에서 V23·V24의 효과는 '사람이 결과를 보는 동안 미리 돈다'는 가정이 이 사람 역할에서 거의 서지 않는 조건에서 잰 것이다. 보고에 그렇게 적는다. 몰아 두기 시간을 줄이는 것은 이 평가 뒤에 볼 후보로 남긴다(바꾸면 빌드가 달라진다).
- 시범 사람 차례(참고, n=1): 40 m21 22·m2p 21, 08 m21 10·m2p 9, 10 m21 10. M2의 relay3 평균은 40.8, 13.4, 17.0이었다. relay3-m2p도 이번에는 Work 하나로 했다.

## 2026-11-05 고정

- 규약을 고정했다. relay3-m21 = relay-v3 `df8f71c`(빌드), relay3-m2p = `8526e0c`, 평가 도구 = relay-v2 `7866fa8`.
- 봉인 셋의 sha256(열지 않고 잼. `hidden/`은 파일마다의 sha256을 이름 차례로 모아 다시 잰 값):

| 시나리오 | hidden/ | reference.patch |
|---|---|---|
| 39-three-modules | `96a8a49ae54534a608f7fbec0095912988a995e48c1063a1e2ad5c7ee04aa71c` | `97c6be60dca209e61de3024dd97ca053eb3c8811c94814e0e6db5075a72dcdf3` |
| 47-double-notify-digest-w2 | `410c1279735fe2a57aa28daecd1f39e7447bd4a8258678630db726f7765d064b` | `38861ae97c84ed7e39190d7f3a67f385343db024745374b24663a3ae0de372a3` |
| 09-stock-negative | `17f3fb3753b2a26d1ebe4434afbb7e3528d8ce5e00a7c3024c7f5bc5a7f220ee` | `4b3fa3c87e8c890fec7aade75e1ebb667c0402131fed17086d53c1e0728931fb` |

  잰 명령: `cd <시나리오> && find hidden -type f | LC_ALL=C sort | xargs sha256sum | sha256sum`, `sha256sum reference.patch`.

## 2026-11-05 5.4의 판정 지침 (배치 전에 고정)

결과를 본 뒤 바꾸지 않는다. 판정은 AI 에이전트가 하고, 큰 주장은 다른 에이전트가 원자료로 다시 센다(M2 p3-decomposition과 같은 방법).

1. **P3 갈래:** 사람 차례(`turns.jsonl`의 줄) 하나에 갈래 하나. 갈래와 뜻은 M2 [p3-decomposition.md](../m2/p3-decomposition.md)의 워크플로 지침 그대로다(start, answer_question, contract_revise, contract_approve, change_request_answer, wait, inspect, evidence_confusion, review_relay, steer, end, other). 더하는 것: [세션에 넘기기]는 review_relay, 걸린 끝을 [취소]하는 것은 end, 상자의 [그래도 끝내기]·[더 고치기]는 end. **'[끝내기] 뒤 순수 기다림'**은 [끝내기]를 누른 차례 다음부터 Work가 끝나거나 상자가 뜨기 전까지의 wait 차례 수다(V23의 끄는 조건에 쓴다).
2. **V24 '까닭을 대고 넘김':** 되먹임 파일(`feedback/<n>.md`)을 받은 세션이, 다음 커밋 전에 터미널에 그 사실·지적을 고치지 않는 까닭을 적었으면 넘김이다(`turns.jsonl`의 화면 글과 `events.jsonl`의 다음 head로 본다). 고치지도 까닭을 대지도 않았으면 '남음'.
3. **V24 끼어듦(표본):** 되먹임이 들어간 때 세션이 사람에게 물은 질문(터미널 글이나 AskUserQuestion)에 답을 기다리던 중이었으면 끼어듦이다. 되먹임 기록 가운데 많아야 20개를 차례로 골라 본다.
4. **V25 끝낸 뒤 바로잡음:** 같은 실행에서 Work가 끝난 뒤 사람 역할이 같은 요청으로 새 Work를 만들거나 끝난 Work의 결과를 고쳐 달라고 했으면 바로잡음이다.
5. **V28 승인 뒤 기준 까닭의 바꾸기:** `change_requested`의 까닭이 예시가 기준에서 통과·실패하는 것(바뀜 줄의 예시가 기준에서도 통과, 지킴 줄의 예시가 기준에서 실패, 지킴 시험을 기준에서 불러오지 못함)이면 센다.
6. **V29 모든 원인을 담은 계약:** 14와 H2의 relay3-m21 실행마다, 실행이 끝날 때 승인돼 있던 계약(`contract.json`)의 줄이 참조 패치가 고치는 원인마다 그 원인을 다루는 줄(바뀜이나 새로)을 가졌으면 '모두 담음'. 참조 패치는 H2의 봉인을 푼 뒤에 연다. 판정자는 원인 목록을 참조 패치와 숨긴 시험의 이름에서 뽑고, 줄의 글과 예시만으로 가른다(구현은 보지 않는다).

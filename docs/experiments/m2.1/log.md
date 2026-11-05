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

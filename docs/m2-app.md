# M2 설계: 앱에서 한 Work의 생애

- 상태: M2a~M2c 구현함(2026-11-04). M2d(평가)는 진행 중
- 결정: V13(Electron 데스크톱), V1~V12. 철학은 [philosophy.md](philosophy.md) 3장의 생애다.
- 목표: 계약 → 자율 구현 → 증거 → 관문(그림자) → 머지를 앱에서 끝까지. 그리고 v2 자율·맨 CLI와 n≥5로 견준다(V14).

## 1. 한 Work의 생애 (앱 쪽)

| 차례 | 무엇이 일어나나 | 앱이 하는 일 | 사람이 하는 일 |
|---|---|---|---|
| 1 새 Work | 프로젝트와 요청 글. 일의 성격 제안(선택, V1)과 기준 브랜치 | Work 폴더와 worktree, 작업 브랜치(`relay/<짧은 이름>`)를 만든다. 프로젝트의 기본 브랜치에 품질 기준이 없으면 알리고 [초안 만들기]로 작업 트리에 초안을 쓴다(V20) | 요청을 쓴다. 초안을 검토해 기본 브랜치에 커밋한다 |
| 2 계약 초안 | 세션이 코드와 지식, 근처 빚, 품질 기준을 읽고 묻는다 | 세션 하나를 PTY에 띄운다(3절). 질문은 Claude Code의 AskUserQuestion으로 터미널에서 | 답한다 |
| 3 계약 제출 | 세션이 `submit_contract` 도구를 부른다 | `parseContract`와 근거 확인. 틀리면 도구가 바로 오류를 돌려준다(되돌림 없음, V5·philosophy 원칙 2). 맞으면 예시 자료 초안을 worktree에 쓰고(V27) 패널에 계약을 보이고 도구는 사람의 답을 기다린다. 승인하면 승인본을 쓴다 | [승인] 또는 [고쳐 달라고 하기] |
| 4 자율 구현 | 세션이 마음대로 한다. 앱이 쓴 예시 자료를 바꾸지 않고 수용 시험과 함께 커밋한다(V27). 작업 브랜치 push, PR 열기도 세션이 한다 | 훅으로 지켜본다. 되돌리기 어려운 git·gh만 막는다(바닥) | 지켜보거나 터미널에서 말한다 |
| 5 증거 | 계기: 세션이 쉬는데 head가 바뀜(20초 몰아서), PR 열기·갱신, [끝내기]. 같은 head의 계기가 겹치면 합친다 | 엔진 `check`를 앱 밖 자식 프로세스로 돌린다. 패널에 '결론을 정한 사실 한 줄'과 펼침 | 본다 |
| 6 리뷰 (V4) | 내보내기 후보(PR 열기·갱신, [끝내기]) | 새 맥락의 읽기 전용 `claude -p`로 리뷰. 지적은 증거 묶음에. 세션에는 넣지 않는다 | 본다 |
| 7 관문 | 증거와 리뷰가 다 모임 | `gate()`. 결론과 그림자를 실적 장부에 남긴다 | — |
| 8 머지 | 사람 머지가 기본. 자동은 V3 조건을 모두 채울 때만 | [머지]는 머지 게이트(CI, 충돌, head 일치)를 따르고 `gh pr merge --match-head-commit`. PR이 없으면 [끝내기](V18): 내보내기 증거(리뷰)를 재고 [증거]의 확인 상자로 보인다. Work는 구현 중 그대로다. 고칠 것은 터미널에서 세션에게 말하고, [끝 확정]이 끝낸다(작업 브랜치는 남고 합치기는 사람이 한다. 로컬 합치기는 M3 후보) | [머지], 또는 [끝내기] → 지적을 보고 [끝 확정] |
| 9 끝 | PR이 모두 머지되거나 닫힘, 또는 [끝 확정] | 받아들인 나빠짐을 빚으로 적는 PR을 제안(M3), 기록 | — |

계약 바꾸기: 세션이 `request_contract_change`를 까닭과 바꾼 계약 전체로 부르면(제출과 같은 검사. 새 계약이 없거나 승인된 계약과 같으면 바로 invalid) 패널에 뜨고, 사람이 답할 때까지 그 도구가 기다린다. 결론은 그동안 `recontract`. 받아들이면 새 계약이 승인된 계약을 대신한다.

## 2. 프로세스와 모듈

```
Electron main
  ├─ store        $RELAY_HOME/projects.json, works/<id>/{work.json, request.md, contract.json, events.jsonl}
  ├─ sessions     PTY(node-pty)에서 claude 실행. 화면은 렌더러 xterm으로 흘려보냄
  ├─ hooks        127.0.0.1 HTTP. UserPromptSubmit·Stop·PreToolUse·PostToolUse·SessionEnd
  ├─ control      relay MCP 브리지가 부르는 곳: submit_contract, request_contract_change, relay_check
  ├─ evidence     계기를 받아 엔진 check를 자식 프로세스(node src/cli/main.ts check --json)로 돌림. 한 Work에 하나씩
  ├─ review       claude -p, 읽기 도구만, --json-schema(지적 목록)
  ├─ gate·ledger  core.gate, 실적 장부 $RELAY_HOME/ledger.jsonl
  └─ gh           PR 찾기·읽기·머지 (gh CLI)
Renderer (React)
  사이드바(프로젝트 → Work) │ 터미널(xterm) │ 패널: [계약] [증거] [변경] [빚]
relay MCP 브리지 (Electron을 Node로: ELECTRON_RUN_AS_NODE)  stdio MCP ↔ control HTTP
```

- 층: `src/main`(조립, Electron), `src/renderer`, `src/preload`. main은 engine·adapters·core를 쓴다. core·adapters·engine은 Electron을 모른다(M1 층 규칙 그대로).
- 상한: 파일 600줄. v2의 WorkRunner처럼 한 클래스에 모으지 않는다. Work의 상태 기계는 순수 함수로 `src/core/work.ts`(M2에서 추가).

## 3. 세션 실행

```
claude --session-id <uuid>
       --settings <works/<id>/settings.json>      훅(HTTP), 자동 메모리 끔
       --append-system-prompt-file <works/<id>/instructions.md>
       --mcp-config <works/<id>/mcp.json>
       --dangerously-skip-permissions            (v2 D17과 같음: 권한 확인 대신 바닥의 막기)
       "<첫 프롬프트: request.md 경로와 할 일>"
```

- `instructions.md`(v3 지침, 사실만): 계약을 먼저 쓰고 `submit_contract`로 제출, 사람만 아는 사실은 묻기(질문 방식은 결정마다 확인이 첫 기본값, philosophy 원칙 1), 승인 뒤에는 방식이 자유, 예시 자료 위치와 시험 이름의 `[<계약 id>:C1.1]` 태그(V11), `relay_check`로 증거를 당겨 볼 수 있음, 막히는 동작 목록, 쓴 것을 끝에 터미널에 말하기. 리뷰·시험 '하라'는 지시는 넣지 않는다(증거 의무는 앱이 잰다).
- 재개: 앱이 꺼지거나 세션이 끝나면 `--resume <session-id>`로 같은 대화를 연다. 기다리던 `submit_contract`는 다시 부르게 안내한다.
- 바닥의 막기(PreToolUse): v2 `core/git-guard.ts`를 옮긴다(지킬 브랜치·기준 브랜치 push, 강제 push, 원격 삭제, `gh pr merge`, `gh api` 머지). 모든 세션에 같은 두께.
- PR 코멘트·이슈 같은 바깥 글은 v2 D566처럼 인용 파일로만 두고, 쉬는 세션에 한 줄. M2에서는 넣지 않고 M3에서 장치로 등록한다(증거 되먹임과 같은 장치군).

## 4. v2에서 옮길 것

| v2 | v3 | 손볼 것 |
|---|---|---|
| `adapters/pty.ts`, `adapters/exec.ts`의 spawnSpec | `src/adapters/pty.ts` | Windows ConPTY 처리, 트리 종료 그대로 |
| `adapters/hooks.ts` | `src/main/hooks.ts` | task 대신 Work, 질문·자식 경로 뺌 |
| `core/git-guard.ts` | `src/core/git-guard.ts` | 그대로 + 시험 |
| `main/mcp.ts`의 브리지 | `src/main/mcp-bridge.mjs` | 도구 셋만 |
| `adapters/claude.ts`의 findClaude, claudeJson | `src/adapters/claude.ts` | 리뷰 호출만 |
| `test/support/fake-claude` | `test/support/fake-claude` | 훅·MCP 도구 호출 시나리오, 커밋 |
| `renderer`의 TerminalView, termSize, links | `src/renderer` | 그대로에 가깝게 |

## 5. 시험

- [단위]: Work 상태 기계, git-guard, 계약 패널 데이터, 증거 계기 몰아서 하기(시간을 인자로).
- [어댑터]: PTY, 훅 서버, MCP 브리지, gh(가짜 gh).
- [흐름]: 가짜 claude가 계약 제출 → 승인 → 커밋 → Stop → 증거 → 관문(그림자)까지. 리뷰는 가짜 `claude -p`.
- [스모크]: Playwright `_electron`. 새 Work → 계약 승인 → 증거 패널 → [머지](가짜 gh).
- [실제]: 실제 claude로 작은 레포 하나를 끝까지. 깨졌나만 본다.

## 6. 평가 (M2-eval, V14)

v2 평가 도구(`relay-v2/app/eval`)에 v3 쪽(`relay3`)을 더한다. 화면이 다르므로 사람 역할의 조작은 새 driver다. 시나리오·숨긴 시험·판정·보고서는 그대로 쓴다.

- 견줄 쪽: `relay3`(기본), `relay3-noreview`(V4 뺌), `relay3-draft`(질문 초안 우선), `relay@auto`(v2 자율), `cli`.
- 시나리오: 07, 08, 10, 14, 19, 40, 43, 44, 45. n=5.
- 사람 역할의 변형: `hands-off`(계약만 승인하고 diff를 보지 않음, E-auto). 사람의 사후 교정 몫을 처음으로 잰다.
- 규약(판정 규칙, δ)은 `docs/experiments/m2/protocol.md`에 결과 전에 고정한다.
- 배치마다 실행 수를 먼저 알린다.

## 7. 순서

1. M2a main 뼈대: store, sessions(PTY), hooks, git-guard, MCP 브리지와 control, 가짜 claude [흐름]
2. M2b 증거·리뷰·관문·장부 잇기 + gh 머지
3. M2c 렌더러: 사이드바, 터미널, 패널 넷, 프로젝트 설정(자동 머지 스위치, `min_shadow`, 리뷰 범위)
4. M2d [스모크], [실제], 평가 쪽 `relay3`와 규약, 평가

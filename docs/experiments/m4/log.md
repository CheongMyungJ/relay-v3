# M4 평가 기록

규약: [protocol.md](protocol.md).

## 고정 (2026-11-06 22:55 UTC)

- 빌드·도구 SHA: relay-v3 `e8a0df5`. worktree `/home/user/relay-v3-m4`를 이 커밋으로 옮겨 `npm ci`, `node node_modules/electron/install.js`, `npm run build`를 했고 작업 트리가 깨끗하다. 평가 도구: relay-v2 `cba165a`(push함).
- `GATE_VERSION` = 1, `REVIEW_PROMPT_VERSION` = 4. `npm run test:replay` 4 통과, `gate-version.test.ts` 4 통과.
- 사용자 결정(✅): Q13 단위는 실행(실행 30, Work 약 35). 물을 때 적은 시나리오 보기(07, 08, 10, 14, 45, 19)와 규약 3.4의 무리(07, 08, 10, 14, 09, 47)가 다르다. 규약의 까닭대로 3.4를 쓴다(머리).
- 시범에서 고친 도구: `27b348c`(M2 대상의 예시 자료, (B) 토큰, 재생의 빠진 파일 셈), 규약 검토에서 고친 도구: `e8a0df5`(relay-v3), `cba165a`(relay-v2 `--clean-work`).
- 대상: `node scripts/gate-repeat.ts targets --into /home/user/m4-targets --bundle …`(3.2의 T1~T10) → 10개. `targets-relay.json`은 손으로(R1 `be2ed90`, R2 `dc72189`, R3 `14f3303`). 사본은 `targets/`.
- sha256:
  - `targets/targets.json` `68d23f3f084115027d499ad515afeb9f5a0b228d1a85b6bea4ac1ee6a7305ef6`
  - `targets/targets-relay.json` `395a5e1e90f3d584216fb8392070801de71be241b1706ecaa5b5b3bb838d7af4`
  - 시나리오마다 `hidden/`·`scenario.json`·`reference*.patch`를 이름 순으로 `sha256sum`한 출력의 sha256: 07-two-bugs `ee3e75ec…087e1`(파일 3), 08-timezone `75917aa8…c8f09`(2), 10-invoice-rounding `f0416891…2ad2`(6), 14-double-notify `5202470c…ffe73`(5), 09-stock-negative `85768641…10ab8e4`(5), 47-double-notify-digest-w2 `5702d696…13fed8`(5). 전체 값은 아래:
    - 07 `ee3e75ece8a6b9d7d38112d32acd24ac16045eb96af841d9fb843230727087e1`
    - 08 `75917aa8ce944d4c4f1ac3495962c99244eaca1dccc14ab3f75f00bc997c8f09`
    - 10 `f0416891e2ba16f7bba66087483bf68e8882487939093bc39f08f9ae93b52ad2`
    - 14 `5202470c6ad503144a35fcf6563f4ef44c235972db0532ae300cfb60479ffe73`
    - 09 `857686411cc46b2a62e8fc036c95e7a1f2c4b45808df608c3fee9f86d10ab8e4`
    - 47 `5702d69623a8fc427410e3dd875227387fe4e298562a8c93d2f502ac0f13fed8`
  - 재생 고정 자료 `test/fixtures/track-replay`, `gate-replay`의 파일을 이름 순으로 `sha256sum`한 출력의 sha256: `af58e6d2a250e20ed98f949a416600407c6a90775834b41b9c39a9626a894e7e`
- 배치 기준 SHA: relay-v3 `d287c4a`(규약 고정 커밋). 배치 시작 22:52 UTC.
- (A) 끝: T1~T10 5회 갈림 0/10, R1~R3 5회 갈림 0/3, 덜 함 없음, 다시 한 반복 없음. (B) 끝: 50회, 올림 유무·갈래 갈림 0/10, 결론을 가르는 갈림 0. 출력은 [repeat.md](repeat.md), 재생은 [replay.md](replay.md).
- **(C) 전의 정리(7절, 2026-11-06 23:57 UTC):** `/tmp/relay-eval/` 아래 35개 폴더(지난 배치와 시범의 작업 폴더, 이름 목록은 `/home/user/m4-archive/relay-eval-old.list`)를 `/home/user/m4-archive/relay-eval-old/`로, `/home/user/m4-targets/`를 `/home/user/m4-archive/m4-targets/`로, 세션 임시 폴더의 `targets`, `targets21`, `m4p/`, `c-pilot/`, `gr-check.jsonl`, `gr-check21.jsonl`, `gr-review.jsonl`을 `/home/user/m4-archive/scratch/`로 옮겼다. **규약과 다른 것:** 규약은 'tar로 묶어 옮기고 지운다'였으나, `/tmp/relay-eval`이 매우 커서(du가 2분 안에 끝나지 않음) tar 대신 같은 디스크 안에서 옮기기(mv)만 했다. 원래 자리가 비는 것은 같다. 옮긴 자리는 `/home/user` 아래라 절대 경로로는 닿는다(M3의 `m3-archive`와 같은 노출, 11절).
  - `ls -la /tmp/relay-eval`: 빔(`.`과 `..`뿐). `/tmp`의 `relay-judge-*`, `relay-final-*`, `relay-gate-repeat-*`: 없음. `find /tmp -maxdepth 4 \( -name targets.json -o -name '*.diff' -o -name 'gr-*.jsonl' \)`: 출력 없음. `ls /home/user`: m3-archive, m3-runs, m4-archive, relay-v2, relay-v3, relay-v3-m2p, relay-v3-m3, relay-v3-m4.
- **(C) 시작:** 2026-11-06 23:58 UTC(`run-batch.sh`, `d7e2b29`).
- **컨테이너가 다시 켜짐(2026-11-07 00:17 UTC 무렵):** `07-two-bugs`의 회차 1~4가 끝났고(모두 도구 문제 없음) 회차 5 도중이었다. 다시 켜짐은 도구 문제도 결과도 아니다. `run.mjs`는 같은 결과 폴더에 한 회차만 더하지 못하므로, M2.1 배치 1의 47과 같이 그 시나리오를 처음부터 다시 돈다. 끊긴 결과 폴더는 `run-batch.sh`가 `eval/results/m4-aborted/`로 옮기고 집계에 넣지 않는다. 끊긴 회차들의 결과는 보지 않았다(끝난 회차의 숨긴 시험 통과 수만 진행 줄로 봄).
- **(C) 끝:** 2026-11-07 02:11 UTC. 결과 폴더 여섯(relay-v2 `app/eval/results/m4-gen-<시나리오>`, 07은 다시 켜짐 뒤 처음부터 돈 것) 모두 exit 0, 실행 5씩(`runs/batch.log`). 결과 폴더의 `config.json`은 모두 commit `cba165a`, `cleanWork` true, 쪽 `relay3`, 덧씌우기 켬. 끊긴 07(`m4-aborted/`)은 쓰지 않았다.

## (C) 자료 (2026-11-07 02:14 UTC, 8.4의 7)

설계자 체크아웃 `e0a6c3d`(규약 SHA `d287c4a` 뒤의 배치 기록 커밋만 더함). `git diff e8a0df5..HEAD -- scripts src test`: 빔(도구 코드는 빌드·도구 SHA와 같다). 결과 폴더는 3.4의 차례(07, 08, 10, 14, 09, 47)로 주었다.

`node scripts/gate-replay-fixture.ts docs/experiments/m4/replay/gate/m4.jsonl <결과 폴더 여섯>` 표준 오류 그대로(종료 0, 표준 출력 없음):

```
묶음: relay3: 35
docs/experiments/m4/replay/gate/m4.jsonl: 35개
```

- '건너뜀: 증거가 내보내기 때의 것이 아님' 줄 없음(도구는 0이 아닐 때만 찍는다): 묶음 일부가 빠진 실행 0.

`node scripts/track-replay.ts docs/experiments/m4/replay/track/m4.jsonl <결과 폴더 여섯>` 표준 오류 그대로(종료 0, 표준 출력 없음):

```
Work: relay3 (끝 ended true): 35
실행 셈: 07-two-bugs/relay3: 5
실행 셈: 08-timezone/relay3: 5
실행 셈: 09-stock-negative/relay3: 5
실행 셈: 10-invoice-rounding/relay3: 5
실행 셈: 14-double-notify/relay3: 5
실행 셈: 47-double-notify-digest-w2/relay3: 5
docs/experiments/m4/replay/track/m4.jsonl: 35개
```

- '실행 뺌(…)' 줄 없음, '같은 변경을 가르지 못함: …' 줄 없음(도구는 0이 아닐 때만 찍는다).
- 9절 무리마다 실행 셈·뺌과 표 5의 실행 수:

  | 무리 | 실행 셈 | 실행 뺌 | 표 5 실행 | 같은가 |
  |---|---|---|---|---|
  | m4/07-two-bugs/relay3 | 5 | 0 | 5 | 같음 |
  | m4/08-timezone/relay3 | 5 | 0 | 5 | 같음 |
  | m4/10-invoice-rounding/relay3 | 5 | 0 | 5 | 같음 |
  | m4/14-double-notify/relay3 | 5 | 0 | 5 | 같음 |
  | m4/09-stock-negative/relay3 | 5 | 0 | 5 | 같음 |
  | m4/47-double-notify-digest-w2/relay3 | 5 | 0 | 5 | 같음 |

  `app-record.ts`도 '실행 30(뺌: 없음), Work 35'. 도구 문제로 빠진 실행 0(9절의 10% 한계 밑). 도구 문제 보고 없음.
- 자료 sha256: `replay/gate/m4.jsonl` `f726b0d2e6d4843c37bdde86d5b10031443f2767ca5b008b623739375381660e`, `replay/track/m4.jsonl` `207ddbc7d50f9debdec745b0d2956908f64dfc4553d7a9f42453db1515c0d0c4`. `test/fixtures/` 아래에 두지 않았다(3.4).
- **7절 다시 잼(배치 뒤):** relay-v2 `app/eval/scenarios/`에서 `find <id>/hidden <id>/scenario.json <id>/reference*.patch -type f | sort | xargs sha256sum | sha256sum`(고정 때와 같은 꼴: 경로가 `<id>/…`): 07 `ee3e75ec…087e1`(3), 08 `75917aa8…c8f09`(2), 10 `f0416891…2ad2`(6), 14 `5202470c…ffe73`(5), 09 `85768641…10ab8e4`(5), 47 `5702d696…13fed8`(5). 전체 값이 고정 때와 모두 같다. 재생 고정 자료(`find test/fixtures/track-replay test/fixtures/gate-replay -type f | sort | xargs sha256sum | sha256sum`) `af58e6d2…894e7e`, `targets/targets.json` `68d23f3f…05ef6`, `targets/targets-relay.json` `395a5e1e…d7af4`: 모두 같다.
- 표: [primary.md](primary.md).
- **도구 문제(10절과 어긋남, 고치지 않고 적음):** `gate-replay-fixture.ts`가 결과 폴더의 `evidence.json`을 그대로 옮기므로, 고정 빌드가 증거에 적은 리뷰어 모델(`evidence.review.model`)이 `replay/gate/m4.jsonl`의 35줄 모두에 모델 이름으로 들어갔다(지난 고정 자료 m2·m2.1은 증거에 이 칸이 없어 0줄). 10절은 '결과 파일과 이 폴더의 문서에 모델 이름을 쓰지 않는다'다. 도구가 만든 자료를 손으로 고치지 않았고 커밋하지 않았다. 이 칸은 관문 재생의 셈에 쓰이지 않는다(셈은 위 표와 같음). 자료를 이 폴더 밖에 둘지, 칸을 지운 사본을 둘지는 사람에게 묻는다.

## 배치 뒤 (2026-11-07, 8.4의 8)

- **다시 확인(읽기만).** 체크아웃 `e0a6c3d`. `git diff e8a0df5..HEAD -- scripts src test`가 비었고, 그 경로의 작업 트리 diff도 비었다. 8.4의 7의 네 명령을 세션 임시 폴더로 다시 돌렸다. `gate/m4.jsonl` `f726b0d2…`와 `track/m4.jsonl` `207ddbc7…`가 바이트 그대로 다시 만들어졌다. `--report`, `generation`, `app-record --build e8a0df5`의 출력은 primary.md C.1~C.3과 같았다. 모두 종료 0, 표준 오류에는 셈 줄만 있었다. 07 결과 폴더는 다시 켜진 뒤의 것이다(`config.json` 00:18:53, 회차 1~5 00:23~00:38). `m4-aborted/`는 읽지 않았다.
- **판정**은 [result.md](result.md)에 있다. 규칙 0: 그림자 (가)의 분모는 13 < 30, 세션 커밋 (다)의 분모는 62 ≥ 50(규약의 어림은 약 35). 규칙 1은 0/10(K_met 9), R은 0/3. 규칙 2는 모름(최소 n 미달). 규칙 3은 모름(분모 0). 규칙 4는 사고 0. 규칙 5는 걸리지 않음(62/62). 규칙 7은 빈 줄 0/42. 규칙 8에서 따로 올릴 것은 없다. 규칙 9: 등록부의 상태를 바꾸는 결과는 없다.
- **규칙 6의 기록.** devices.md의 '그림자 실적', '머지 뒤 30일 추적', '세션 커밋 가르기', '판 다시 재기' 줄 상태 칸 끝에 'M4 평가(2026-11-07, 장기 평가 아님, 상태 그대로)'와 재지 않은 조건의 '언제 재나'를 덧붙였다. 상태 값은 바꾸지 않았다.
- **10절 어긋남은 위에 적은 것보다 넓다**(result.md 실패 분석 6).
  - 커밋하지 않은 `replay/gate/m4.jsonl`의 `evidence.review.model`(35줄)에 더해, 이미 커밋한 파일에도 모델 이름이 있다.
  - `targets/targets.json`(고정 입력, `agentModel` 10줄)이 그렇다.
  - `runs/*.report.md`·`runs/*.log`(파일마다 한 줄)와 `runs/*.tar.gz` 여섯도 그렇다.
  - M2·M2.1의 `runs/`에도 같은 꼴이 있다.
  - 어느 셈도 이 칸을 쓰지 않는다. 고치지 않았고, 어떻게 할지는 사람에게 묻는다(result.md P1).
- **실패 분석에서 나온 제안**(result.md P2): `14-double-notify` 회차 3·5는 계약의 non_goals로 중복 제거 원인을 뺐다. 모든 줄을 채웠고 올림도 없었는데, 바뀐 줄(256, 212 > 100) 하나로만 자동 후보에서 빠졌다. 그 줄 가운데 앱이 쓴 예시 자료가 206줄, 168줄이다. 조건을 바꾸는 일이라 이 평가에서 정하지 않는다(규칙 8).
- **report.md**(쉬운 말 보고)는 이 단계에서 파일로 쓰지 못해 글로 넘겼다.
- 커밋하지 않았다.

## 비판 검토 뒤 (2026-11-07)

- **고정 시각.** 고정 커밋 `d287c4a`는 2026-11-06 22:52:40 UTC에 만들어졌다(재생과 (A) 커밋 `89b4753`은 22:53:47 UTC). 머리의 22:55는 적어 둔 고정 시각이고, 배치는 그 커밋에서 돌았다. 고정한 머리는 고치지 않는다.
- **규약과 다르게 한 둘, 사람에게 묻지 않음(사후 승인 대상, result.md P4, report.md 7절의 4).** 규약 머리는 '바꿀 일이 생기면 사람에게 묻고 까닭을 적는다'인데, 아래 둘은 까닭만 적고 묻지 않았다.
  - 07을 처음부터 다시 돌림(위 '컨테이너가 다시 켜짐'). 9절은 '(C)는 다시 하지 않는다… 빠진 회차만큼 n이 준다'라 그대로면 회차 1~4가 n 4로 남았다. 정하기 전에 끊긴 회차 1~4의 진행 줄(숨긴 시험 통과 수)을 보았다(고르기의 위험). 다시 돈 07은 `m4-aborted/`가 절대 경로로 읽히는 채 돌았다. `m4-aborted/`는 지금도 열지 않았다.
  - (C) 전의 정리를 tar 대신 mv로 함(위 '(C) 전의 정리'). 옮긴 폴더(`/home/user/m4-archive/relay-eval-old/` 등)는 묶은 파일이 아니라 보통 파일이라 레포와 diff가 그대로 읽힌다.
- **(B)의 T7~T9.** 저장된 M2.1 증거(옛 리뷰 프롬프트)에서 '예시와 시험 불일치' 올림 하나만 `small`을 막던 세 대상이, 지금 프롬프트(판 4)로는 리뷰 15번 모두 올림이 없었다(repeat.md). 보고만 한다.
- **손으로 읽은 값.** result.md 실패 분석과 report.md 2절·7절의 줄 수(206·168, 46·41, 523·588 등)와 지난 평가와의 견줌은 묶은 기록을 손으로 읽은 것이다. 고정 도구의 셈이 아니고 어느 규칙도 쓰지 않는다. report.md 6절의 합계·시간·배수와 7절의 '실행 약 40번'은 쓴 사람의 어림이다.
- **커밋하지 말 것: `docs/experiments/m4/replay/gate/m4.jsonl`.** 35줄 모두에 모델 이름이 있다(10절). P1을 사람이 정할 때까지 이 경로를 커밋하지 않는다(`git add docs/` 하지 말 것). 어디에 둘지는 사람이 정한다.
- **report.md**는 이 단계에서도 하네스가 파일 만들기를 막아 글로 넘겼다. 아직 디스크에 없다.
- 이 단계의 커밋에는 `primary.md`, `result.md`, `log.md`, `replay/track/m4.jsonl`, `devices.md`의 메모를 넣었다. `replay/gate/m4.jsonl`과 `report.md`는 넣지 않았다. push하지 않았다.

## 모델 이름 지우기 (설계자 결정, 2026-11-07, result.md P1의 (가))

- `replay/gate/m4.jsonl`: 도구가 `evidence.review.model`을 그대로 옮겨 모델 이름이 35줄에 들었다. 원본(sha256 `f726b0d2e6d4843c37bdde86d5b10031443f2767ca5b008b623739375381660e`)은 `/home/user/m4-archive/replay-gate-original/`에 두고, 이 폴더에는 그 칸만 뺀 사본(sha256 `fde21ce0593d4eccb8617e0b620531456cf7ba0ec60288be4bd5fd6c5c4be958`)을 둔다. `track-replay.ts --report`의 출력은 원본과 사본에서 같다(셈에 쓰지 않는 칸).
- `runs/*.report.md`, `runs/*.log`: 모델 이름을 `<모델>`로 바꾸는 커밋을 더했다(이력에는 남는다).
- 남긴 것: `targets/targets.json`(고정 입력, sha256을 고정 때 적음)과 `runs/*.tar.gz`(도구 기록)의 설정 칸. M2.1·M3 `runs/`와 같은 예외다. 도구 고침(`gate-replay-fixture.ts`가 그 칸을 빼고, relay-v2 보고서·로그가 모델 이름을 쓰지 않게)은 다음 일이다.

## 사용자 결정 (2026-11-07, ✅)

- P4: 07을 처음부터 다시 돈 것과 정리를 mv로 한 것을 **둘 다 승인**한다. 지금의 07(다시 돈 5회)을 그대로 쓴다. 다음 규약에는 '배치 도중 컨테이너가 다시 켜짐'의 규칙을 미리 적는다.
- 다음: **여기서 멈춘다.** M4는 '도구는 됨, 실제 실적은 자기 실행 뒤'로 닫는다. 자기 실행(Q10)은 사람이 머지할 수 있을 때 따로 시작한다. 그 전에 작은 도구 고침(기록에 모델 이름이 남는 것)만 한다.
- 덧붙임(2026-11-07): 도구를 고친 뒤(`fd811b6`, `gate-replay-fixture.ts`가 `review.model`을 뺌) 여섯 결과 폴더에서 다시 만든 `m4.jsonl`의 sha256은 `81c8715d9e9eeb97f341b340939a174acaa29bfbd2b1bc9fb379860f557a919f`다. 커밋한 사본(`fde21ce0…`)과 줄마다 JSON으로는 같고, 사본을 손으로 만들 때 쓴 띄어쓰기만 다르다. 다시 확인할 때는 줄마다 JSON을 견준다.

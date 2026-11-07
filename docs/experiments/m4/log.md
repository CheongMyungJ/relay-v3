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

# relay-v3 개발 안내

## 레포 구성

| 폴더 | 내용 |
|---|---|
| `src/core` | 순수 로직: 품질 기준·계약·JUnit·diff 파싱, 신호, 래칫, 줄 판정, 관문 |
| `src/adapters` | git, 프로세스 실행, check worktree, 저장소 |
| `src/engine` | 조립: `check` 흐름 |
| `src/cli` | 명령줄 `relay` |
| `docs/` | 철학(`philosophy.md`), 설계(`design.md`), 장치 등록부(`devices.md`), 모듈 약속(`m1-modules.md`), v2 사실 지도(`v2-evidence.md`) |

## 개발 환경

Node.js 22.18 이상과 git이 필요합니다. 빌드는 없습니다. Node의 타입 지우기로 `.ts`를 바로 돌립니다.

```bash
npm ci
npm run relay -- check     # 지금 레포에서 relay check
```

## 확인

```bash
npm run check              # 아래를 모두
npm run typecheck
npm run lint
npm run format:check
npm run limits             # 파일 600줄, src/core 5,000줄
npm test                   # [단위], [어댑터], [흐름]
npm run test:replay        # 관문 재생(V31)만 돌리고 G1·G2 표를 찍는다
npm run test:track         # 재생 실적(M4g, V53)의 네 표를 찍는다
```

관문 재생의 자료(`test/fixtures/gate-replay/<규약>.jsonl`)는 저장된 평가 결과에서 만듭니다. 새 규약의 묶음을 더하거나 래칫 코드를 바꿨으면 다시 만들고, 시험의 규약마다의 표(`RECORDED_RULE`, `FALSE_AUTO_MAX`, `RUN_MET`)를 봅니다.

```bash
node scripts/gate-replay-fixture.ts test/fixtures/gate-replay/m2.jsonl ../relay-v2/app/eval/results/m2-*
node scripts/gate-replay-fixture.ts test/fixtures/gate-replay/m2.1.jsonl ../relay-v2/app/eval/results/m21-sealed-* ../relay-v2/app/eval/results/m21-design-*
```

리뷰 재생(M2.1 0단계 O2, `docs/m2.1-design.md` 14절)은 저장된 M2 내보내기 묶음에 지금의 리뷰어(`claude -p`)를 다시 돌리고 통과 기준을 찍습니다. 결과 폴더는 옆의 `../relay-v2/app/eval/results`를 읽습니다. 실제 호출은 54번이라 `--dry`(가짜 리뷰어)로 먼저 보고, `--limit 1`로 실제 호출 하나를 시험합니다. claude는 호출마다 새 임시 설정 폴더(`CLAUDE_CONFIG_DIR`)로 돌고 이 셸의 `CLAUDECODE`, `CLAUDE_*`, `ANTHROPIC_*` 변수를 받지 않습니다(평가의 앱 리뷰어처럼). 인증에 그런 변수가 필요하면 `--pass-env <이름,…>`으로 넘깁니다.

```bash
npm run replay:review -- --dry --prompts /tmp/prompts   # claude를 부르지 않음. 프롬프트를 남긴다
npm run replay:review -- --limit 1 --out /tmp/o2-pilot.jsonl   # 실제 호출 하나(판정에 쓰지 않음)
npm run replay:review                                   # docs/experiments/m2.1/review-replay.jsonl에 쓴다
npm run replay:review -- --resume                       # 끊긴 뒤 끝난 호출을 건너뛰고 잇는다
npm run replay:review -- --summary                      # 부르지 않고 요약만
```

재생 실적(M4g, `docs/m4-design.md` 9절)의 자료(`test/fixtures/track-replay/<규약>.jsonl`)는 저장된 평가의 relay3 쪽 Work 장부에서 만듭니다(모델 호출 없음). 새 평가 배치를 더했으면 다시 만들고 `npm run test:track`의 표를 봅니다.

```bash
R=../relay-v2/app/eval/results
node scripts/track-replay.ts test/fixtures/track-replay/m2.jsonl $R/m2-*
node scripts/track-replay.ts test/fixtures/track-replay/m2.1.jsonl $R/m21-sealed-* $R/m21-design-*
node scripts/track-replay.ts test/fixtures/track-replay/m3.jsonl $R/m3-seq
```

관문 5회 반복 안정성(M4f, `docs/m4-design.md` 8절)은 평가 도구입니다(앱에 없음). (A)는 대상마다 check를 5번(반복마다 새 임시 `RELAY_HOME`, 고정 리뷰, 초안 정책), (B)는 리뷰만 5번(`claude -p`, 비용이 듭니다. `--dry`로 먼저 봅니다), (C)는 재생 자료만 읽습니다. 대상의 레포는 임시 `git clone --shared`에서 돌아 원래 레포의 ref와 worktree 등록을 바꾸지 않습니다. 결과는 `docs/experiments/m4/gate-repeat-<check|review>.jsonl`에 쓰고, 이미 있으면 `--resume`으로 잇습니다.

```bash
node scripts/gate-repeat.ts targets --bundle 14-double-notify/relay3-2/a20b4044 --into /tmp/m4f   # 평가 묶음에서 대상과 targets.json
node scripts/gate-repeat.ts check --targets /tmp/m4f/targets.json            # (A) 5회
node scripts/gate-repeat.ts review --targets /tmp/m4f/targets.json --dry     # (B) 가짜 리뷰어
node scripts/gate-repeat.ts review --from docs/experiments/m2.1/review-replay.jsonl   # (B) 이미 있는 반복 자료
node scripts/gate-repeat.ts generation                                       # (C) test/fixtures/gate-replay/
```

targets.json은 `[{ "name", "repo", "base", "head", "contract"?, "request"?, "options"?: { "effort"? } }]`이고 경로는 그 파일 기준입니다. relay-v3 Work의 head는 손으로 적습니다.

## 문서

- 설계를 바꾸는 결정은 `docs/design.md` 1절에 V 번호로 적습니다. 근거가 측정인지 가정인지 적습니다.
- 장치를 넣거나 상태를 바꾸면 `docs/devices.md`를 고칩니다.

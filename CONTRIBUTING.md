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
```

## 문서

- 설계를 바꾸는 결정은 `docs/design.md` 1절에 V 번호로 적습니다. 근거가 측정인지 가정인지 적습니다.
- 장치를 넣거나 상태를 바꾸면 `docs/devices.md`를 고칩니다.

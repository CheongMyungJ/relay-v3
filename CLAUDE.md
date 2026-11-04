# relay-v3

철학은 `docs/philosophy.md`, 정한 것은 `docs/design.md`(V 번호), 장치는 `docs/devices.md`, M1 모듈의 약속은 `docs/m1-modules.md`. 명령은 `CONTRIBUTING.md`. `README.md`는 사용자용이라 개발 내용을 넣지 않는다.

## 지킬 것

- 층: `src/core`(순수) ← `src/adapters`(git·파일·프로세스) ← `src/engine`(조립) ← `src/cli`. ESLint가 막는다.
- 상한: 파일 600줄, `src/core` 합계 5,000줄(`npm run limits`).
- 타입의 정본은 `src/core/types.ts`. 모듈 사이 함수 모양을 바꾸면 `docs/m1-modules.md`를 먼저 고친다.
- 장치(관문, 질문, 리뷰, 래칫, 장부 등)를 더하면 `docs/devices.md`에 가정과 끄는 조건을 함께 올린다. 끄는 조건이 없으면 넣지 않는다.
- 사용자 결정(✅)은 사용자와 다시 정한다.
- 빌드 없이 Node 22.18+의 타입 지우기로 돈다. 상대 import에 `.ts`를 붙이고, enum·매개변수 속성·namespace를 쓰지 않는다.

## 시험을 둘 층 (맞는 첫 층)

1. 외부 없이 되면 [단위] `test/unit/`
2. 실제 git·파일·프로세스를 보면 [어댑터] `test/adapters/`
3. 여러 모듈의 시나리오면 [흐름] `test/flow/`

한 동작은 가장 낮은 층에서 한 번만 자세히 보고 위 층은 이어지는 것만 본다. 공용 도구는 `test/support/`.

push 전: `npm run check`

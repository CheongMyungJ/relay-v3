# M3 배치의 실행 기록

규약 `../protocol.md` 8.6대로 묶은 M3 장기 평가 배치(`48-long-shop`, 쪽 `relay3`·`relay3-m2`·`cli` × 회차 3, 2026-11-06 07:24~10:32 UTC)의 실행 기록이다. 집계 표는 `../primary.md`, 진행 기록은 `../log.md`.

## 든 것

- `48-long-shop-<쪽>-<회차>.tar.gz` (줄마다 하나, 9개): relay-v2 `app/eval/results/m3-seq` 기준 경로(`./48-long-shop/<쪽>-<회차>/...`)로 다음이 든다.
  - `run.json`(줄의 요약), `state.json`(걸음, 시도 `attempts`, 까닭 `failures`), `structure.json`(구조 지표)
  - `sealed-s1.json` ~ `sealed-s3.json`(봉인 과제: 끝, 시간, 토큰, 과제 시험 번호와 통과, 누적 시험 id와 통과)
  - `work-01/sequence.json` ~ `work-15/sequence.json`(Work마다: 끝, 넣기, 누적 시험 id와 통과, 지식, 사람 역할 수, 토큰, 시간)
- `config.json`: 배치의 고정 값과 빌드(평가 도구 `25e78fa`, 앱 `a0b39e9`, Claude Code 2.1.318). 도구가 쓴 기록을 그대로 둔 사본이라 모델 칸(`agentModel`, `humanModel`, `judgeModel`, `baseline.model`)에 모델 이름이 들어 있다. 문서에는 모델 이름을 쓰지 않는다는 규칙(규약 11절)의 예외로, 이 폴더의 기록 파일(`config.json`과 묶음 안의 JSON)에만 남긴다. 도구가 쓴 기록을 고치지 않으려고 지우지 않는다(M2.1의 `runs/`와 같다). 이 폴더의 글(README)과 위 문서들에는 쓰지 않는다.
- `batch.log`: 러너 로그(`/home/user/m3-runs/batch.log`의 사본).

푼 뒤 집계를 다시 낼 수 있다(2026-11-06에 해 보았고, 결과 폴더 경로 한 줄 말고는 `../primary.md`와 같았다):

```
mkdir -p /tmp/m3-seq && for f in docs/experiments/m3/runs/*.tar.gz; do tar xzf "$f" -C /tmp/m3-seq; done
cp docs/experiments/m3/runs/config.json /tmp/m3-seq/
cd /home/user/relay-v2/app && node eval/m3-primary.mjs /tmp/m3-seq --out /tmp/m3-primary.md
```

## 넣지 않은 것

- 체크포인트 tarball(`/home/user/m3-runs/48-long-shop/*.tar.gz`): 8.6대로 거기에 남긴다.
- 화면 사진(`work-NN/shots/`, 줄의 크기 대부분), 사람 역할 차례(`turns.jsonl`), 앱 저장소의 Work 기록(`work-NN/works/`: 요청 글, 계약, 증거, 장부, 사건), Work마다의 `run.json`. 집계에 쓰이지 않고, 사람 역할 차례에는 규칙 글이 든다(8.3의 2). relay-v2 결과 폴더와 체크포인트에 남아 있다.

## 봉인 확인

봉인을 푼 뒤(7절, sha256 같음) 묶음의 모든 파일과 `config.json`, `batch.log`에서 다음을 찾았고 하나도 없었다: 숨긴 시험(`hidden/`, `sealed/hidden/`)과 정답 패치(`reference-*.patch`, `sealed/reference-s*.patch`)에서 더한 줄 가운데 30자 이상인 줄 882개, 숨긴 시험 파일 이름, 봉인 과제 글, `diff --git`·`@@ -`·`node:test`·`AssertionError`. 시험은 id(`w01-1` 꼴, 봉인 과제는 번호 `k`)와 통과만 있다. 기록에 보이는 `test/*.test.js`는 레포 안 시험(에이전트가 보는 것)의 이름이다.

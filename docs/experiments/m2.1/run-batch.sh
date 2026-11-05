#!/usr/bin/env bash
# M2.1 평가 배치 실행 (protocol.md 9절 4·5·6·8). 시나리오마다 결과 폴더 하나(relay-v2 app/eval/results/m21-<모드>-<시나리오>)를
# 만들고, 끝나면 보고서와 실행 기록을 docs/experiments/m2.1/runs/에 묶어 relay-v3 브랜치에 커밋·push한다(컨테이너가 다시
# 시작돼도 남게). 이미 묶음이 있는 시나리오는 건너뛴다(다시 돌려도 이어서 한다).
#
# 배치가 도는 동안 relay-v3 작업 트리를 더럽히지 않는다(run.json의 appCommits에 +dirty가 남지 않게): 실행 중의 기록
# (batch.log, 시나리오마다의 로그)은 결과 폴더 옆(eval/results/m21-batch/)에 쓰고, 시나리오가 끝난 뒤 runs/로 옮겨 함께
# 커밋한다. 시작할 때 relay-v3 작업 트리가 깨끗하지 않으면 멈춘다(O2 결과, result.md, 앞 배치의 묶음을 먼저 커밋한다).
# 보관 커밋은 docs/experiments/m2.1/runs만 바꾼다: 앱 빌드(out/)는 고정한 SHA에서 만든 그대로다.
#
# 커밋 메시지 끝에 붙일 줄(세션의 attribution 등)은 RELAY_BATCH_TRAILER로 준다. 이 폴더의 파일에는 모델 이름을 쓰지 않는다.
#
# 쓰는 법(relay-v3에서, 고정 뒤):
#   bash docs/experiments/m2.1/run-batch.sh sealed 39-three-modules 47-double-notify-digest-w2 09-stock-negative
#   bash docs/experiments/m2.1/run-batch.sh design 07-two-bugs 14-double-notify 19-split-report 40-three-libraries
set -u
MODE="${1:-}"
[ $# -gt 0 ] && shift
V3="$(cd "$(dirname "$0")/../../.." && pwd)"
V2APP="${RELAY_V2_APP:-$V3/../relay-v2/app}"
OUT="$V3/docs/experiments/m2.1/runs"
WORK="$V2APP/eval/results/m21-batch"
LOG="$WORK/batch.log"

# 규약 9절의 명령: 봉인 셋은 세 쪽을 한 명령으로(짝은 기본: relay3-m21:relay3-m2p, relay3-m21:relay@auto), 설계 셋은
# relay3-m21만
case "$MODE" in
  sealed) ARMS="relay3-m21,relay3-m2p,relay@auto" ;;
  design) ARMS="relay3-m21" ;;
  *)
    echo "모드는 sealed 또는 design: bash $0 <sealed|design> <시나리오 id>..." >&2
    exit 1
    ;;
esac
if [ $# -eq 0 ]; then
  echo "시나리오 id를 하나 이상 준다" >&2
  exit 1
fi
if [ -n "$(cd "$V3" && git status --porcelain)" ]; then
  echo "relay-v3 작업 트리가 깨끗하지 않다(appCommits에 +dirty가 남는다). 먼저 커밋한다:" >&2
  (cd "$V3" && git status --short) >&2
  exit 1
fi
# 평가 도구(relay-v2)도 커밋된 그대로여야 config.json의 commit이 돈 코드를 가리킨다. 결과 폴더(eval/results/)는 git 밖이다
if [ -n "$(cd "$V2APP/.." && git status --porcelain)" ]; then
  echo "relay-v2 작업 트리가 깨끗하지 않다(평가 도구의 commit이 돈 코드와 다르다). 먼저 커밋한다:" >&2
  (cd "$V2APP/.." && git status --short) >&2
  exit 1
fi
mkdir -p "$OUT" "$WORK"

# 묶음을 커밋하고 push한다. 커밋하지 못하면 배치를 멈춘다(다음 시나리오가 +dirty로 기록되지 않게). push는 다시 해 보고,
# 끝내 못 하면 기록만 남긴다(커밋은 남아 다음 push에 함께 간다)
commit_runs() {
  local msg="$1"
  [ -n "${RELAY_BATCH_TRAILER:-}" ] && msg="$msg

$RELAY_BATCH_TRAILER"
  # 로그(*.log)는 .gitignore에 걸리므로 -f로 더한다. 더할 것이 없으면(배치 끝에 바뀐 것 없음) 커밋하지 않는다
  (cd "$V3" && git add -f docs/experiments/m2.1/runs) || { echo "$(date -Is) git add 실패, 배치를 멈춤: $msg" >>"$LOG"; exit 1; }
  if (cd "$V3" && git diff --cached --quiet); then return 0; fi
  if ! (cd "$V3" && git commit -q -m "$msg"); then
    echo "$(date -Is) 커밋 실패, 배치를 멈춤: $msg" >>"$LOG"
    exit 1
  fi
  for i in 1 2 3 4 5; do
    if (cd "$V3" && git push -q origin HEAD 2>/dev/null); then return 0; fi
    sleep $((i * 4))
  done
  echo "$(date -Is) push 실패(커밋은 남음): $msg" >>"$LOG"
}

for S in "$@"; do
  NAME="$MODE-$S"
  if [ -f "$OUT/$NAME.tar.gz" ]; then
    echo "$(date -Is) 건너뜀(이미 있음): $NAME" >>"$LOG"
    continue
  fi
  RES="$V2APP/eval/results/m21-$NAME"
  # 묶음이 없는데 결과 폴더가 있으면 끊긴 시나리오다(규약 10절): 집계에 들지 않게 옮기고 처음부터 다시 돈다
  if [ -e "$RES" ]; then
    mkdir -p "$V2APP/eval/results/m21-aborted"
    GONE="$V2APP/eval/results/m21-aborted/m21-$NAME-$(date +%Y%m%dT%H%M%S)"
    mv "$RES" "$GONE"
    echo "$(date -Is) 끊긴 결과 폴더를 옮김: $RES → $GONE" >>"$LOG"
  fi
  echo "$(date -Is) 시작: $NAME" >>"$LOG"
  (cd "$V2APP" && node eval/run.mjs --scenarios "$S" --runs 5 --arms "$ARMS" --parallel 2 \
    --quality-overlay --no-judge-purpose --out "$RES") >"$WORK/$NAME.log" 2>&1
  CODE=$?
  echo "$(date -Is) 끝: $NAME (exit $CODE)" >>"$LOG"
  # 평가 도구가 실패로 끝났으면 묶지 않는다(묶으면 다시 돌릴 때 끝난 것으로 건너뛴다). 결과 폴더를 옮기고 배치를 멈춘다
  if [ "$CODE" -ne 0 ]; then
    mkdir -p "$V2APP/eval/results/m21-aborted"
    GONE="$V2APP/eval/results/m21-aborted/m21-$NAME-exit$CODE-$(date +%Y%m%dT%H%M%S)"
    [ -e "$RES" ] && mv "$RES" "$GONE"
    echo "$(date -Is) 도구 실패로 배치를 멈춤: $NAME (결과 폴더 → $GONE, 로그 $WORK/$NAME.log)" >>"$LOG"
    exit 1
  fi
  # 보고서와 실행 기록, 관문을 다시 계산할 증거·계약·diff(M2와 같은 것)에 더해 요청(request.md), 단위 브랜치와 통합 증거의
  # 묶음(works/<id>/evidence/*.json), 되먹임 파일(works/<id>/feedback/*.md)을 묶는다. 스크린샷·결과 트리는 뺀다
  (cd "$RES" && find . \( -name 'run.json' -o -name 'turns.jsonl' -o -name 'config.json' -o -name 'report.json' \
      -o -name 'report.md' -o -name 'events.jsonl' -o -name 'ledger.jsonl' -o -name 'evidence.json' \
      -o -name 'contract.json' -o -name 'work.json' -o -name 'request.md' -o -path '*/final/*.diff' \
      -o -path '*/works/*/evidence/*.json' -o -path '*/works/*/feedback/*.md' \) -print0 \
    | tar --null -czf "$OUT/$NAME.tar.gz" -T -)
  cp "$RES/report.md" "$OUT/$NAME.report.md" 2>/dev/null
  cp "$WORK/$NAME.log" "$OUT/$NAME.log"
  cp "$LOG" "$OUT/batch.log"
  commit_runs "M2.1 평가 결과: $NAME"
done
echo "$(date -Is) 배치 끝: $MODE $*" >>"$LOG"
cp "$LOG" "$OUT/batch.log"
commit_runs "M2.1 평가 배치 끝: $MODE"

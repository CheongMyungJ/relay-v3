#!/usr/bin/env bash
# M4 (C) 배치(규약 8.4의 6): 시나리오마다 relay3 5회, --parallel 1 --clean-work. 시나리오가 끝날 때마다 실행 기록을
# docs/experiments/m4/runs/에 묶어 커밋·push한다(M2.1 run-batch.sh와 같은 방식).
#   bash docs/experiments/m4/run-batch.sh 07-two-bugs 08-timezone ...
set -u
V3=/home/user/relay-v3
V2APP=/home/user/relay-v2/app
OUT="$V3/docs/experiments/m4/runs"
LOG="$OUT/batch.log"
mkdir -p "$OUT"
commit_runs() {
  local msg="$1"
  [ -n "${RELAY_BATCH_TRAILER:-}" ] && msg="$msg

$RELAY_BATCH_TRAILER"
  (cd "$V3" && git add -f docs/experiments/m4/runs) || { echo "$(date -Is) git add 실패, 배치를 멈춤: $msg" >>"$LOG"; exit 1; }
  if (cd "$V3" && git diff --cached --quiet); then return 0; fi
  (cd "$V3" && git commit -q -m "$msg") || { echo "$(date -Is) 커밋 실패, 배치를 멈춤: $msg" >>"$LOG"; exit 1; }
  for i in 1 2 3 4 5; do
    (cd "$V3" && git push -q origin HEAD 2>/dev/null) && return 0
    sleep $((i * 4))
  done
  echo "$(date -Is) push 실패(커밋은 남음): $msg" >>"$LOG"
}
for S in "$@"; do
  NAME="m4-gen-$S"
  [ -f "$OUT/$NAME.tar.gz" ] && { echo "$(date -Is) 건너뜀(이미 있음): $NAME" >>"$LOG"; continue; }
  RES="$V2APP/eval/results/$NAME"
  if [ -e "$RES" ]; then
    mkdir -p "$V2APP/eval/results/m4-aborted"
    GONE="$V2APP/eval/results/m4-aborted/$NAME-$(date +%Y%m%dT%H%M%S)"
    mv "$RES" "$GONE"; echo "$(date -Is) 끊긴 결과 폴더를 옮김: $RES → $GONE" >>"$LOG"
  fi
  echo "$(date -Is) 시작: $NAME" >>"$LOG"
  (cd "$V2APP" && RELAY3_APP=/home/user/relay-v3-m4 node eval/run.mjs --scenarios "$S" --runs 5 --arms relay3 \
    --parallel 1 --clean-work --quality-overlay --no-judge --no-judge-purpose --out "eval/results/$NAME") >"$OUT/$NAME.log" 2>&1
  CODE=$?
  echo "$(date -Is) 끝: $NAME (exit $CODE)" >>"$LOG"
  if [ "$CODE" -ne 0 ]; then
    mkdir -p "$V2APP/eval/results/m4-aborted"
    GONE="$V2APP/eval/results/m4-aborted/$NAME-exit$CODE-$(date +%Y%m%dT%H%M%S)"
    [ -e "$RES" ] && mv "$RES" "$GONE"
    echo "$(date -Is) 도구 실패로 배치를 멈춤: $NAME (결과 폴더 → $GONE)" >>"$LOG"
    commit_runs "M4 (C) 도구 실패: $NAME"; exit 1
  fi
  (cd "$RES" && find . \( -name 'run.json' -o -name 'turns.jsonl' -o -name 'config.json' -o -name 'report.json' \
      -o -name 'report.md' -o -name 'events.jsonl' -o -name 'ledger.jsonl' -o -name 'evidence.json' \
      -o -name 'contract.json' -o -name 'work.json' -o -name 'request.md' -o -name 'session-commits.jsonl' \
      -o -name 'hooks.log' -o -path '*/final/*.diff' -o -path '*/works/*/evidence/*.json' \) -print0 \
    | tar --null -czf "$OUT/$NAME.tar.gz" -T -)
  cp "$RES/report.md" "$OUT/$NAME.report.md" 2>/dev/null
  cp "$LOG" "$OUT/batch.log"
  commit_runs "M4 (C) 결과: $NAME"
done
echo "$(date -Is) 배치 끝: $*" >>"$LOG"
cp "$LOG" "$OUT/batch.log"
commit_runs "M4 (C) 배치 끝"

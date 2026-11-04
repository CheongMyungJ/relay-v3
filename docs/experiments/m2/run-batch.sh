#!/usr/bin/env bash
# M2 평가 배치 실행 (protocol.md 3절). 시나리오마다 결과 폴더 하나를 만들고, 끝나면 보고서와 실행 기록을
# docs/experiments/m2/runs/ 에 묶어 relay-v3 브랜치에 커밋·push한다(컨테이너가 다시 시작돼도 남게).
# 이미 묶음이 있는 시나리오는 건너뛴다(다시 돌려도 이어서 한다).
#
# 쓰는 법:
#   bash docs/experiments/m2/run-batch.sh main 07-two-bugs 08-timezone 10-invoice-rounding
#   bash docs/experiments/m2/run-batch.sh handsoff 10-invoice-rounding 14-double-notify
set -u
MODE="$1"; shift
V3="$(cd "$(dirname "$0")/../../.." && pwd)"
V2APP="${RELAY_V2_APP:-$V3/../relay-v2/app}"
OUT="$V3/docs/experiments/m2/runs"
LOG="$V3/docs/experiments/m2/runs/batch.log"
mkdir -p "$OUT"

case "$MODE" in
  main)
    ARMS="relay3,relay3-noreview,relay@auto,cli"
    PAIRS="relay3:cli,relay3-noreview:cli,relay@auto:cli,relay3:relay3-noreview,relay3:relay@auto"
    EXTRA=""
    ;;
  handsoff)
    ARMS="relay3,cli"
    PAIRS="relay3:cli"
    EXTRA="--human-mode hands-off"
    ;;
  *) echo "모드는 main 또는 handsoff"; exit 1 ;;
esac

commit_runs() {
  local msg="$1"
  for i in 1 2 3 4 5; do
    if (cd "$V3" && git add docs/experiments/m2/runs && git commit -q -m "$msg

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EaNCruGwgxaN7uUjbtmh27" && git push -q origin HEAD 2>/dev/null); then return 0; fi
    sleep $((i * 4))
  done
  echo "커밋·push 실패: $msg" >>"$LOG"
}

for S in "$@"; do
  NAME="$MODE-$S"
  if [ -f "$OUT/$NAME.tar.gz" ]; then echo "건너뜀(이미 있음): $NAME" >>"$LOG"; continue; fi
  RES="$V2APP/eval/results/m2-$NAME"
  echo "$(date -Is) 시작: $NAME" >>"$LOG"
  (cd "$V2APP" && node eval/run.mjs --scenarios "$S" --runs 5 --arms "$ARMS" --pairs "$PAIRS" \
    --parallel 2 --quality-overlay --no-judge-purpose $EXTRA --out "$RES") >"$OUT/$NAME.log" 2>&1
  echo "$(date -Is) 끝: $NAME (exit $?)" >>"$LOG"
  # 보고서와 실행 기록, 관문을 다시 계산할 증거·계약·diff만 묶는다(스크린샷·결과 트리는 빼고. posthoc-q4.mjs)
  (cd "$RES" && find . \( -name 'run.json' -o -name 'turns.jsonl' -o -name 'config.json' -o -name 'report.json' -o -name 'report.md' -o -name 'events.jsonl' -o -name 'ledger.jsonl' \
      -o -name 'evidence.json' -o -name 'contract.json' -o -name 'work.json' -o -path '*/final/*.diff' \) -print0 \
    | tar --null -czf "$OUT/$NAME.tar.gz" -T -)
  cp "$RES/report.md" "$OUT/$NAME.report.md" 2>/dev/null
  commit_runs "M2 평가 결과: $NAME"
done
echo "$(date -Is) 배치 끝: $MODE $*" >>"$LOG"
touch "$OUT/.done-$MODE-$(echo "$*" | tr ' ' '_')"

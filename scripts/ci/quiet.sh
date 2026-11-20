#!/usr/bin/env bash
# Token-cheap lint / type-check / test runner for AI sessions.
#
#   scripts/ci/quiet.sh lint [ws...] [--fix]
#   scripts/ci/quiet.sh ts   [ws...]
#   scripts/ci/quiet.sh test [ws...] [-- <vitest pattern>]
#
# Without an explicit workspace, runs on the workspaces touched by the working tree
# and by the branch since main (ts also pulls in dependents of module/utils).
# Output: one "OK <step> <ws> (Ns)" line per workspace on success, filtered error
# lines on failure. Full logs land in node_modules/.cache/ci/<step>-<ws>.log.
set -u
cd "$(dirname "$0")/../.." || exit 1

ALL_WS="back front module utils integration-tests eslint-rules"
CACHE="node_modules/.cache"
MAX_LINES=40

step="${1:-}"; shift || true
case "$step" in lint|ts|test) ;; *) echo "usage: quiet.sh lint|ts|test [ws...] [--fix] [-- pattern]"; exit 2 ;; esac

ws_list=""; fix=""; pattern=""
while [ $# -gt 0 ]; do
  case "$1" in
    --fix) fix=1 ;;
    --) shift; pattern="${*:-}"; break ;;
    *) ws_list="$ws_list $1" ;;
  esac
  shift
done

changed_workspaces() {
  { git status --porcelain | awk '{print $NF}'; git diff --name-only main...HEAD 2>/dev/null; } \
    | awk -F/ 'NF>1{print $1}' | sort -u | while read -r d; do
      case " $ALL_WS " in *" $d "*) echo "$d" ;; esac
    done
}

if [ -z "$ws_list" ]; then
  ws_list=$(changed_workspaces | tr '\n' ' ')
  if [ "$step" = ts ]; then
    case " $ws_list " in *" utils "*) ws_list="$ALL_WS" ;; esac
    case " $ws_list " in *" module "*) ws_list="$ws_list back front integration-tests" ;; esac
  fi
  if [ "$step" = test ]; then
    ws_list=$(echo "$ws_list" | tr ' ' '\n' | grep -v -e '^integration-tests$' -e '^utils$' | tr '\n' ' ')
  fi
  ws_list=$(echo "$ws_list" | tr ' ' '\n' | grep -v '^$' | sort -u | tr '\n' ' ')
  [ -z "$ws_list" ] && { echo "OK $step: no changed workspace"; exit 0; }
fi

mkdir -p "$CACHE/ci" "$CACHE/eslint" "$CACHE/tsc"

run_one() {
  local ws="$1" log="$CACHE/ci/$step-$ws.log" start rc
  start=$(date +%s)
  case "$step" in
    lint) (cd "$ws" && node ../node_modules/eslint/bin/eslint.js --max-warnings 0 --cache --cache-location "../$CACHE/eslint/$ws/" -f json ${fix:+--fix} .) >"$log" 2>&1 ;;
    ts)   (cd "$ws" && node ../node_modules/typescript/bin/tsc --noEmit --incremental --tsBuildInfoFile "../$CACHE/tsc/$ws.tsbuildinfo" --pretty false) >"$log" 2>&1 ;;
    test) (cd "$ws" && yarn vitest run --reporter=dot --bail=1 $pattern) >"$log" 2>&1 ;;
  esac
  rc=$?
  echo "$rc $(( $(date +%s) - start ))" >"$log.rc"
}

for ws in $ws_list; do run_one "$ws" & done
wait

failed=0
for ws in $ws_list; do
  log="$CACHE/ci/$step-$ws.log"
  read -r rc secs <"$log.rc"
  if [ "$rc" -eq 0 ]; then
    echo "OK $step $ws (${secs}s)"
    continue
  fi
  failed=1
  echo "FAIL $step $ws (${secs}s), full log: $log"
  case "$step" in
    lint) jq -r --arg w "$(cygpath -w "$PWD" 2>/dev/null)\\" --arg u "$PWD/"             '.[] | (.filePath | ltrimstr($w) | ltrimstr($u)) as $f | .messages[] | "\($f):\(.line):\(.column): \(.message) [\(.ruleId)]"'             "$log" 2>/dev/null | head -n $MAX_LINES || head -n $MAX_LINES "$log" ;;
    ts)   grep -E 'error TS[0-9]+' "$log" | head -n $MAX_LINES ;;
    test) grep -vE '^\s*$|^\s*·+\s*$|^ *Test Files|^ *Tests |Start at|Duration' "$log" \
            | grep -E 'FAIL|Error|expected|received|✓|×|❯|→|^\s+at ' | head -n $MAX_LINES ;;
  esac
done
exit $failed

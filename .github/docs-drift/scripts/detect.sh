#!/usr/bin/env bash
# Runs the drift detection of every pair in <pairs.json>, from the current
# directory's code, and writes report.json, failed.json and partial.json to
# <out-dir>. Writes the step outputs (failed, partial, malformed, and blocked
# when no call reached the agent) to $GITHUB_OUTPUT, stdout outside a workflow.
# With DETECT_BUDGET_SECONDS, no page starts once that time has passed: the
# rest are reported as failed rather than the job being killed with them.
#
#   detect.sh <pairs.json> <out-dir>
set -euo pipefail

pairs_file="$1"
out="$2"
ask_agent="$(cd "$(dirname "$0")" && pwd)/ask-agent.js"
outputs="${GITHUB_OUTPUT:-/dev/stdout}"
budget="${DETECT_BUDGET_SECONDS:-0}"

# One call per document, several for one whose files do not fit a single
# context, and a file larger than a call goes in parts.
echo '{"findings":[]}' > "$out/report.json"
failed='[]'
partial='[]'
mapfile -t pairs < <(jq -c '.[]' "$pairs_file")
for p in "${pairs[@]}"; do
  doc=$(jq -r '.doc' <<<"$p")
  if [ "$budget" -gt 0 ] && [ "$SECONDS" -ge "$budget" ]; then
    failed=$(jq -c --arg doc "$doc" --arg why "not audited, the run's time budget of ${budget} s ran out" \
      '. + [{doc: $doc, why: $why}]' <<<"$failed")
    continue
  fi
  printf '%s' "$p" > "$out/pair.json"
  if node "$ask_agent" detect "$out/pair.json" > "$out/one.json" 2> "$out/call.err"; then
    jq -s '{findings: (.[0].findings + .[1].findings)}' "$out/report.json" "$out/one.json" > "$out/merged.json"
    mv "$out/merged.json" "$out/report.json"
    partial=$(jq -c --arg doc "$doc" --slurpfile one "$out/one.json" \
      'if (($one[0].unaudited // []) + ($one[0].failedCalls // [])) == [] then .
       else . + [{doc: $doc, files: ($one[0].unaudited // []), calls: ($one[0].failedCalls // [])}] end' <<<"$partial")
  else
    failed=$(jq -c --arg doc "$doc" --arg why "$(tail -n 1 "$out/call.err" | cut -c1-200)" \
      '. + [{doc: $doc, why: $why}]' <<<"$failed")
  fi
  cat "$out/call.err" >&2
done
printf '%s' "$failed" > "$out/failed.json"
printf '%s' "$partial" > "$out/partial.json"
{
  echo "failed=$(jq length <<<"$failed")"
  echo "partial=$(jq length <<<"$partial")"
} >> "$outputs"
# A run that reached no agent must not report a clean bill of health.
if [ "$(jq length <<<"$failed")" -eq "${#pairs[@]}" ]; then
  echo "blocked=Every agent call failed, the first with: $(jq -r '.[0].why' <<<"$failed")" >> "$outputs"
  echo "::error::Every agent call failed: $(jq -r '.[0].why' <<<"$failed")"
  exit 1
fi
# A finding short of a field would fingerprint wrong or break the report
# mid-loop, once earlier ones were already published.
raw=$(jq '.findings // [] | length' "$out/report.json")
jq '{findings: [(.findings // [])[] | select(
      (.doc | type) == "string" and (.doc_excerpt | type) == "string"
      and (.evidence | type) == "array" and (.explanation | type) == "string")]}' \
  "$out/report.json" > "$out/checked.json"
mv "$out/checked.json" "$out/report.json"
echo "malformed=$((raw - $(jq '.findings | length' "$out/report.json")))" >> "$outputs"

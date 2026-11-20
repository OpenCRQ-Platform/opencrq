#!/usr/bin/env bash
# The repository lint: one ESLint process per workspace, run one after the other, then one for the
# files that belong to no workspace. Keeps going past a failure so one run reports every failing
# part. Extra arguments go to every ESLint call (`--fix`).
#
# A single `eslint .` holds the TypeScript program of every workspace at once for the type-aware
# rules, and those programs overlap (front and integration-tests load back and module), so its heap
# is their sum. Each process here exits before the next builds its program: the peak is the largest
# workspace's.
#
# No --cache: it keys a file on its own content, so a type change in module would leave an
# unchanged front file on its cached pass for type-aware rules such as no-deprecated.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)" || exit 1
cd "$ROOT" || exit 1

ESLINT="$ROOT/node_modules/eslint/bin/eslint.js"
WORKSPACES=$(node -p "require('./package.json').workspaces.join(' ')")

failed=""

lint() {
  local name="$1" dir="$2" start rc
  shift 2
  echo "lint $name"
  start=$SECONDS
  (cd "$dir" && node "$ESLINT" --max-warnings 0 "$@" .)
  rc=$?
  echo "lint $name: exit $rc ($(( SECONDS - start ))s)"
  [ "$rc" -eq 0 ] || failed="$failed $name"
}

for ws in $WORKSPACES; do
  lint "$ws" "$ws" "$@"
done

ignores=()
for ws in $WORKSPACES; do
  ignores+=(--ignore-pattern "$ws/")
done
lint root . "${ignores[@]}" "$@"

if [ -n "$failed" ]; then
  echo "lint failed in:$failed"
  exit 1
fi

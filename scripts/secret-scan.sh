#!/usr/bin/env bash
# Scans a directory for secrets with the rules of .betterleaks.toml, in the pinned betterleaks
# image: the Secret scan workflow runs it on the checkout and on each commit of a pull request,
# .githooks/pre-commit on the staged files.
#
#   scripts/secret-scan.sh <directory>
#
# Exits 3 on a finding, which it prints redacted, so that a caller tells it from a scan that failed:
# 125 or 127 when Docker or Podman is not running or not installed or the image cannot be pulled,
# 2 for a missing directory, and anything else the runtime or the scanner returns.
#
# The files and the config go in through stdin and the environment, not a bind mount: a runtime
# that does not share the path with this shell (a remote engine, a VM that mounts only the home
# directory) would mount an empty directory, and the scan would pass on nothing.
#
# Runs on Docker or Podman, the first one found. The image is pinned to the digest of its
# multi-platform index, as third-party actions are to a commit. Betterleaks v2 drops the
# allowlists this config uses, so a bump past v1 rewrites .betterleaks.toml.
set -euo pipefail

image=ghcr.io/betterleaks/betterleaks:v1.9.0@sha256:e3b95b0db6c2735db17165c009b0ad6d9cef34fb4578659232b98f69d7346cac
: "${1:?usage: scripts/secret-scan.sh <directory>}"
dir=$(cd "$1" 2>/dev/null && pwd -P) ||
  { echo "secret-scan: $1 is not a directory" >&2; exit 2; }
runtime=$(command -v docker || command -v podman) || { echo "secret-scan: neither Docker nor Podman found" >&2; exit 127; }
BETTERLEAKS_CONFIG_TOML=$(cat "$(dirname "$0")/../.betterleaks.toml")
export BETTERLEAKS_CONFIG_TOML

# The root of a checkout gives its tracked and unignored files, the ones a commit can carry: not
# node_modules, nested worktrees or local config. Any other directory is taken whole.
files() {
  if [ "$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)" = "$dir" ]; then
    git -C "$dir" ls-files -z --cached --others --exclude-standard |
      while IFS= read -r -d '' file; do
        if [ -e "$dir/$file" ]; then printf '%s\0' "$file"; fi
      done
  else
    (cd "$dir" && find . -path ./.git -prune -o \( -type f -o -type l \) -print0)
  fi
}

# Inline gitleaks:allow and betterleaks:allow comments are ignored: an exception goes in
# .betterleaks.toml, where review sees it.
files | tar -C "$dir" --null -T - -cf - |
  "$runtime" run --rm -i -e BETTERLEAKS_CONFIG_TOML --entrypoint sh "$image" -c \
    'mkdir /scan && tar -xf - -C /scan && exec betterleaks dir /scan --redact --no-banner --verbose --ignore-gitleaks-allow --exit-code 3'

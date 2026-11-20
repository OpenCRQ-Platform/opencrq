#!/usr/bin/env bash
# Scans an image for the high and critical vulnerabilities that have a fix, writes the report to
# trivy-results.json and trivy-results.txt, and lists them in the run summary. A vulnerability with
# no upstream fix is left out: nothing here can act on it, and it comes back once a fix ships.
#
#   scripts/ci/scan-image.sh <image> [advisory|enforce]
#
# advisory (the default) always exits 0 and raises a warning, enforce exits 1 on a finding or on a
# scan that could not run. Expects trivy on the PATH.
set -uo pipefail

image="$1"
mode="${2:-advisory}"

trivy image --scanners vuln --pkg-types os,library --ignore-unfixed --severity HIGH,CRITICAL \
  --exit-code 1 --format json --output trivy-results.json "$image"
status=$?

if [ -f trivy-results.json ]; then
  trivy convert --format table --output trivy-results.txt trivy-results.json
  cat trivy-results.txt
  {
    echo "## Vulnerabilities of \`$image\` (high and critical, with a fix)"
    echo '```'
    cat trivy-results.txt
    echo '```'
  } >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
fi

if [ "$status" -eq 0 ]; then
  exit 0
fi
message="The image has high or critical vulnerabilities with a fix, or could not be scanned: see the run summary"
if [ "$mode" = enforce ]; then
  echo "::error::$message"
  exit 1
fi
echo "::warning::$message"

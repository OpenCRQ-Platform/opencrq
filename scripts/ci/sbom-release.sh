#!/usr/bin/env bash
# Writes <dir>/sbom-opencrq-<version>.cdx.json, the SBOM a release carries: the published image as
# Syft reads it (OS packages, the Node.js runtime, the packages installed in it) merged with the
# application's SBOM of scripts/ci/sbom-generate.sh, which alone knows the packages the backend's
# build inlines. Filigran SAS is its supplier and manufacturer; it is validated.
#
#   scripts/ci/sbom-release.sh <app-sbom> <image>@<digest> <version> <dir>
#
# Expects syft, cyclonedx-cli and jq on the PATH. Pulls the image anonymously.
set -euo pipefail

app="$1"
image="$2"
version="$3"
dir="$4"
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$dir/sbom-opencrq-$version.cdx.json"
mkdir -p "$dir"

syft "registry:$image" \
  --config "$root/.github/.syft.yaml" \
  --platform linux/amd64 \
  --select-catalogers -file \
  --source-name opencrq-image \
  --source-version "$version" \
  --output "cyclonedx-json@1.6=$dir/image.cdx.json"

# Both inputs are named opencrq at the top: the merge nests each under its own name.
jq '.metadata.component.name = "opencrq-app"' "$app" > "$dir/app.cdx.json"

cyclonedx-cli merge \
  --input-files "$dir/app.cdx.json" "$dir/image.cdx.json" \
  --input-format json \
  --output-file "$dir/merged.cdx.json" \
  --output-format json \
  --output-version v1_6 \
  --hierarchical \
  --name opencrq \
  --version "$version"

jq --slurpfile org "$root/.github/sbom-manufacturer.json" '
  .metadata.supplier = $org[0]
  | .metadata.manufacturer = $org[0]
  | .metadata.component.supplier = $org[0]
  | .metadata.component.manufacturer = $org[0]
' "$dir/merged.cdx.json" > "$out"
rm "$dir/app.cdx.json" "$dir/image.cdx.json" "$dir/merged.cdx.json"

cyclonedx-cli validate --input-file "$out" --input-format json --input-version v1_6 --fail-on-errors

jq -r '"\(.metadata.component.name) \(.metadata.component.version): " + ([.components[] | "\(.name) \([.. | objects | select(has("purl"))] | length) packages"] | join(", "))' "$out"

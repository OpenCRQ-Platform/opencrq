#!/usr/bin/env bash
# Writes <dir>/sbom-opencrq-app-<version>.cdx.json from the trees scripts/ci/sbom-collect.sh copied
# into <dir>: one CycloneDX 1.6 SBOM per part, the backend's two trees as one, merged under the
# application with Filigran SAS as its supplier and manufacturer, then validated.
#
#   scripts/ci/sbom-generate.sh <dir> <version>
#
# Expects syft, cyclonedx-cli and jq on the PATH.
set -euo pipefail

dir="$1"
version="$2"
root="$(cd "$(dirname "$0")/../.." && pwd)"
merged="$dir/sbom-opencrq-app-$version.cdx.json"

# scan <tree> <part> <output>
scan() {
  # A directory scan otherwise runs only the lockfile catalogers, which find nothing in node_modules.
  syft "dir:$1" \
    --config "$root/.github/.syft.yaml" \
    --override-default-catalogers javascript-package-cataloger \
    --select-catalogers -file \
    --source-name "opencrq-$2" \
    --source-version "$version" \
    --output "cyclonedx-json@1.6=$3.syft"
  # Syft reads every package.json as a package, also those below a package's root: the stubs that
  # give an entry point its module type, a test fixture.
  jq --arg root '/node_modules/(@[^/]+/)?[^/]+/package\.json$' '
    .components |= map(select(any(.properties[]?; .name == "syft:location:0:path" and (.value | test($root)))))
  ' "$3.syft" > "$3"
  rm "$3.syft"
}

# part <output> <scan>...: each package once, whether installed at several paths or both bundled and
# external.
part() {
  local output="$1"
  shift
  jq -s '.[0] + {components: ([.[].components[]] | if any(.purl == null) then error("a component has no purl") else unique_by(.purl) end)}' \
    "$@" > "$output"
  rm "$@"
}

scan "$dir/back/externals" back "$dir/back-externals.cdx.json"
scan "$dir/back/bundled" back "$dir/back-bundled.cdx.json"
part "$dir/opencrq-back.cdx.json" "$dir/back-externals.cdx.json" "$dir/back-bundled.cdx.json"

scan "$dir/front" front "$dir/front.cdx.json"
part "$dir/opencrq-front.cdx.json" "$dir/front.cdx.json"

cyclonedx-cli merge \
  --input-files "$dir/opencrq-back.cdx.json" "$dir/opencrq-front.cdx.json" \
  --input-format json \
  --output-file "$dir/merged.cdx.json" \
  --output-format json \
  --output-version v1_6 \
  --hierarchical \
  --name opencrq \
  --version "$version"

# The merge writes its own metadata, without the supplier and manufacturer of the parts.
jq --slurpfile org "$root/.github/sbom-manufacturer.json" '
  .metadata.supplier = $org[0]
  | .metadata.manufacturer = $org[0]
  | .metadata.component.supplier = $org[0]
  | .metadata.component.manufacturer = $org[0]
' "$dir/merged.cdx.json" > "$merged"
rm "$dir/merged.cdx.json"

cyclonedx-cli validate --input-file "$merged" --input-format json --input-version v1_6 --fail-on-errors

jq -r '"\(.metadata.component.name) \(.metadata.component.version): " + ([.components[] | "\(.name) \(.components | length) packages"] | join(", "))' "$merged"

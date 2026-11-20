#!/usr/bin/env bash
# Copies out of the image's install stages the package manifests Syft reads, one tree per part:
#   <out>/back/externals  the deps stage's node_modules, installed from back/dist/package.json and
#                         copied whole into the image;
#   <out>/back/bundled    the package.json of every package whose modules esbuild inlines into
#                         back/dist, read from the metafile of the backend's build options;
#   <out>/front           the builder's node_modules, narrowed to the production dependencies of the
#                         front end: its fonts and stylesheets ship as assets no module list names.
#                         The run fails if its Vite build inlines a package outside this closure,
#                         a stylesheet's @import included.
# Only node_modules are copied: Syft reads a lockfile or a workspace package.json lying next to them
# as packages too, development ones included.
#
#   scripts/ci/sbom-collect.sh <deps stage image> <builder stage image> <out dir>
#
# DOCKER names another container CLI, such as podman.
set -euo pipefail

deps_image="$1"
builder_image="$2"
out="$3"
docker="${DOCKER:-docker}"

modules_js="$(cat "$(dirname "$0")/sbom-modules.mjs")"

mkdir -p "$out/back/externals" "$out/back/bundled" "$out/front"

"$docker" run --rm "$deps_image" tar -cf - node_modules | tar -xf - -C "$out/back/externals"

# shellcheck disable=SC2016 # Expanded by the container's shell.
"$docker" run --rm -e MODULES_JS="$modules_js" "$builder_image" sh -euc '
  set -o pipefail
  printf "%s" "$MODULES_JS" > .sbom-modules.mjs
  node_modules/.bin/tsx .sbom-modules.mjs back /tmp/inlined >&2
  sed "s|\$|/package.json|" /tmp/inlined | tar -cf - -T -
' | tar -xf - -C "$out/back/bundled"

# shellcheck disable=SC2016 # Expanded by the container's shell.
"$docker" run --rm -e MODULES_JS="$modules_js" "$builder_image" sh -euc '
  set -o pipefail
  printf "%s" "$MODULES_JS" > .sbom-modules.mjs
  node .sbom-modules.mjs front /tmp/inlined >&2
  node .sbom-modules.mjs ids < /tmp/inlined | sort -u > /tmp/inlined.ids
  yarn workspaces focus --production @app/front >&2
  find . -name .git -prune -o -name node_modules -type d -prune -print > /tmp/trees
  find $(cat /tmp/trees) -path "*/node_modules/*" -name package.json \
    | grep -E "/node_modules/(@[^/]+/)?[^/]+/package\.json\$" | sed "s|/package\.json\$||" \
    | node .sbom-modules.mjs ids | sort -u > /tmp/closure.ids
  missing=$(comm -23 /tmp/inlined.ids /tmp/closure.ids)
  if [ -n "$missing" ]; then
    echo "The front-end build inlines packages its production dependencies do not reach:" $missing >&2
    exit 1
  fi
  tar -cf - -T /tmp/trees
' | tar -xf - -C "$out/front"

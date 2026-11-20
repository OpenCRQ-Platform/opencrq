#!/usr/bin/env bash
# Boots the production image with the platform seed against an empty database, waits until the
# process manager reports every child healthy, then drives it like a client: the tRPC health query,
# then, as the service account the seed creates with a documented token, a tenant-scoped query and
# a job the worker runs to completion. A person signs in only through XTM One, which this job does
# not run: the service account token is the one credential the image accepts on its own. The
# image installs only back/dist/package.json, so a module the bundle leaves to the loader fails here
# and nowhere else, whether it loads at boot, on a first request or in a job handler: every other
# test runs against the monorepo's node_modules. It also checks that /app holds LICENSE, NOTICE and
# THIRD_PARTY_NOTICES.
#
#   scripts/ci/boot-image.sh <image> [timeout seconds]
#
# Expects a PostgreSQL reachable on 127.0.0.1:5432 (user app, password admin, database app), and
# curl, jq and openssl on the runner.
set -euo pipefail

image="$1"
timeout="${2:-180}"
name=opencrq-boot-check
api=http://127.0.0.1:3002/trpc
admin_email=boot-check@example.com
# The XTM One password the seed would give its users; no XTM One answers here, so it is never used.
# Not all digits: nconf would read the value as a number, which the config refuses.
admin_password="boot-check-$(openssl rand -hex 12)"
# The Acme tenant's service account token, fixed by the seed (`service-accounts-seeder.ts`).
token=flgrn_ocrq_tkn_CVESyncBotAcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
last_response=

trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT

docker run -d --name "$name" --network host \
  -e HEALTHCHECK_HTTP_SERVER__PORT=8444 \
  -e HTTP_SERVER__HOST=127.0.0.1 \
  -e HTTP_SERVER__PORT=3002 \
  -e POSTGRES__HOST=127.0.0.1 \
  -e POSTGRES__PORT=5432 \
  -e POSTGRES__DATABASE=app \
  -e POSTGRES__USER=app \
  -e POSTGRES__PASSWORD=admin \
  -e XTM_ONE__URL=http://127.0.0.1:9 \
  -e XTM_ONE__TOKEN=boot-check \
  -e XTM_ONE__PLATFORM_URL=http://127.0.0.1:3002 \
  -e PLATFORM_SEED__ENABLED=true \
  -e PLATFORM_SEED__ADMIN__EMAIL="$admin_email" \
  -e PLATFORM_SEED__ADMIN__PASSWORD="$admin_password" \
  "$image" >/dev/null

start=$SECONDS

fail() {
  echo "::error::$1"
  if [ -n "$last_response" ]; then
    echo "Last response: $last_response"
  fi
  curl -sS --max-time 5 http://127.0.0.1:8444/ || true
  echo
  docker logs "$name" 2>&1 | tail -n 300
  exit 1
}

wait_for() {
  local step="$1"
  shift
  until "$@"; do
    if [ "$(docker inspect -f '{{.State.Running}}' "$name")" != true ]; then
      fail "The production image exited after $((SECONDS - start))s, before: $step"
    fi
    if [ $((SECONDS - start)) -ge "$timeout" ]; then
      fail "Not reached within ${timeout}s: $step"
    fi
    sleep 2
  done
  echo "$step after $((SECONDS - start))s"
}

healthy() {
  curl -fsS --max-time 5 -o /dev/null http://127.0.0.1:8444/ && curl -fsS --max-time 5 -o /dev/null http://127.0.0.1:3002/
}

trpc_health() {
  last_response=$(curl -sS --max-time 10 "$api/health" || true)
  [ "$(jq -r '.result.data.status // empty' <<<"$last_response" 2>/dev/null)" = ok ]
}

seeded_organizations() {
  last_response=$(curl -sS --max-time 10 -H "authorization: Bearer $token" "$api/organizations.getOrganizations" || true)
  [ "$(jq -r '.result.data | length' <<<"$last_response" 2>/dev/null || echo 0)" -gt 0 ]
}

job_input=$(jq -rn '{kind: "financial-estimates-recompute"} | tojson | @uri')
job_succeeded() {
  last_response=$(curl -sS --max-time 10 -H "authorization: Bearer $token" "$api/jobs.getLastJob?input=$job_input" || true)
  [ "$(jq -r '.result.data.status // empty' <<<"$last_response" 2>/dev/null)" = succeeded ]
}

licence_files_present() {
  local file
  for file in LICENSE NOTICE THIRD_PARTY_NOTICES; do
    docker exec "$name" test -s "/app/$file" || fail "The production image ships no /app/$file"
  done
}

wait_for "Healthy" healthy
licence_files_present
echo "Licence files present"
wait_for "tRPC health ok" trpc_health
wait_for "Seeded tenant read with its service account" seeded_organizations
wait_for "A job succeeded in the seeded tenant" job_succeeded

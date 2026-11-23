# 🛠️ Developer Guide

If you want to contribute to OpenCRQ or modify the code, here is how to set up the local development environment.

- [Prerequisites](#prerequisites)
- [Project structure](#project-structure)
- [Running the app locally](#running-the-app-locally)
  - [Quick start](#quick-start)
  - [Starting it from an AI assistant](#starting-it-from-an-ai-assistant)
  - [Commands](#commands)
  - [Blank platform or demo data](#blank-platform-or-demo-data)
  - [Enterprise Edition locally](#enterprise-edition-locally)
  - [Observability](#observability)
  - [Ports](#ports)
  - [What it writes](#what-it-writes)
  - [Container runtime](#container-runtime)
  - [Snapshots](#snapshots)
  - [The large estate](#the-large-estate)
  - [Troubleshooting](#troubleshooting)
- [Database](#database)
- [Agent files](#agent-files)
- [Code quality](#code-quality)
- [Secret scan](#secret-scan)

## Prerequisites

-   [Node.js](https://nodejs.org/) 26, the major version pinned in `.nvmrc` (`nvm use` picks it up)
-   [Podman](https://podman.io/) or [Docker](https://docs.docker.com/get-docker/), for the database and object storage containers
-   **Yarn via Corepack**: This project uses Yarn 4. You don't need to install it globally. Node.js no longer bundles Corepack since v25, so install it once, then enable it:
    ```bash
    npm install -g corepack
    corepack enable
    ```

## Project structure

The project is a monorepo managed with Yarn workspaces:

-   `back`: Backend service (Fastify, tRPC, Drizzle ORM).
-   `front`: Frontend application (React, Vite, TanStack Router).
-   `module`: Shared business logic, database schema, and migrations.
-   `utils`: Shared utility functions and helpers.
-   `eslint-rules`: Shared ESLint configuration and custom rules.
-   `integration-tests`: Tests of the domain modules against a real PostgreSQL database.
-   `infra`: Local infrastructure configuration (PostgreSQL and observability stack for dev).
-   `docker`: Production Docker configuration.

## Running the app locally

`yarn env:up` starts a complete development stack for the worktree you are in: database, object storage, XTM One and a mail catcher in containers, backend, frontend. Each worktree gets its own ports, so several stacks run side by side without colliding.

### Quick start

From any worktree of the repository:

```bash
yarn install
yarn env:up
```

It asks whether to install dependencies and whether to reset the database, and asks about seeding demo data only when you choose to reset, then prints the URLs:

```
  slot 2 (1374-connector-runs)
  frontend     http://localhost:3200
  backend      http://localhost:3202
  healthcheck  http://localhost:8644
  xtm one      http://localhost:4205  (administrator xtm-admin@example.com / Xtm1-…)
  mailpit      http://localhost:8225
  logs         node scripts/devenv.mjs logs back --follow
```

The first `up` of a worktree takes longer: it pulls the stack's images, and waits for XTM One to
create its database. That usually takes a minute or two, but XTM One's health
check allows up to ten minutes before `up` gives up on it, and an Apple silicon machine, which runs
it emulated, can take most of that: a first `up` quiet for several minutes is still working.

Backend and frontend run in the background, so the terminal stays free. To see what they print:

```bash
yarn env:logs back --follow
yarn env:logs front
```

Or start with `yarn env:up --console`, which opens one terminal window per server following its log.
Those windows only read the log file, so closing one leaves the server running.

To stop everything for this worktree:

```bash
yarn env:down
```

### Starting it from an AI assistant

Ask your coding assistant, in a session opened on the worktree, to start the app:

> Start the app and give me the URL to open.

In Claude Code, `/devenv` does the same. The request loads the `devenv` skill
([`.claude/skills/devenv/SKILL.md`](../../.claude/skills/devenv/SKILL.md)). The assistant then runs:

```bash
node scripts/devenv.mjs up --json
```

and answers with the `frontend` URL from its output. It never starts `yarn dev` by hand and never
assumes port 3000, since every worktree has its own ports. `/devenv status`, `/devenv logs` and
`/devenv down` map to the commands of the same name.

`--json` implies no install, reset or seed, and never asks a question. What is destructive,
interactive or a configuration choice stays with you, in your own terminal:

- **Dependencies**, on a fresh worktree or after a branch that changes them: `yarn env:up --install`.
- **Demo data**: `yarn env:up --seed`, which asks for the admin credentials. The seeded users sign
  in through the stack's XTM One (see [Signing in](#signing-in)).
- **A clean database**: `yarn env:up --reset`, or `yarn env:restore <name>` for a [snapshot](#snapshots).
- **Enterprise Edition**, for anything involving several tenants: install a Filigran license in the
  stack's XTM One (see [Enterprise Edition locally](#enterprise-edition-locally)).

The assistant asks you to do whichever of these the task needs.

Whenever the app does not answer, have it read `yarn env:logs back`.

**The JSON output.** `env:up`, `env:status` and `env:ports` accept `--json`. `env:up` and `env:ports` then print a single object with the ports and the URLs; `env:status --json` prints an array of status objects for allocated worktrees (add `--all` to include every allocated worktree; otherwise it contains the current worktree when allocated, or is empty):

```json
{
  "worktree": "/path/to/worktree",
  "branch": "1374-connector-runs",
  "slot": 2,
  "ports": { "frontend": 3200, "backend": 3202, "postgres": 5632, "xtmOne": 4205, "mailpit": 8225 },
  "frontend": "http://localhost:3200",
  "backend": "http://localhost:3202",
  "healthcheck": "http://localhost:8644",
  "xtmOne": "http://localhost:4205",
  "mailpit": "http://localhost:8225",
  "xtmOneAdmin": { "email": "xtm-admin@example.com", "password": "Xtm1-…" },
  "evidence": "/path/to/.git/devenv/2/evidence"
}
```

### Commands

| Command | What it does |
| --- | --- |
| `yarn env:up` | Allocate ports if needed, write the config files, start the containers, start backend and frontend. |
| `yarn env:status` | Ports and running state of this worktree. Add `--all` for every worktree. |
| `yarn env:down` | Stop backend, frontend and the containers, the monitoring and XTM One ones included whatever `up` started. Add `--volumes` to destroy the data too. |
| `yarn env:logs [back\|front]` | Show a log. Add `--follow` to keep watching, `--lines <n>` to change how much history. |
| `yarn env:ports` | Just the ports, without starting anything. |
| `yarn env:snapshot [name] --dir <path>` | Dump this worktree's database into that directory. |
| `yarn env:restore [name] --dir <path>` | Replace this worktree's database with a snapshot from it. |
| `yarn env:snapshots --dir <path>` | What that directory holds. |

`env:up` takes `--install`, `--reset`, `--seed`, `--monitoring` and `--console`. Each of the first three answers its own question and leaves the others to be asked, so only a run passing all three is silent. A run with no terminal attached (a script, an agent) is never asked either: it takes the safe answer, which is no for all three.

- `--install` runs `yarn install` first. Needed after a branch that changes dependencies.
- `--reset` destroys the containers **and their volumes**, then recreates them. Everything in the database and every uploaded file is lost. For the lighter version that keeps uploaded files, see [Database](#database).
- `--seed` runs the interactive `seed:setup-dev`, which creates demo tenants, users and organizations, the users in the stack's XTM One as well. It asks questions, so it needs a terminal.
- `--monitoring` also starts Grafana, Prometheus, Loki, Pyroscope and the OpenTelemetry collector. Off by default.
- `--console` opens a terminal window per server, following its log. Windows only, since no other platform has a terminal a script can count on. Closing a window stops the tail, not the server.

### XTM One in the stack

Every worktree runs its own XTM One (`xtm-one` and `xtm-one-worker`), with what it needs: an
`xtm_one` database in the stack's PostgreSQL, a Redis, an `xtm-one`
bucket in the stack's RustFS, and Mailpit to catch its emails. Nothing of it is shared with another
worktree, and `yarn env:down --volumes` takes its data with the rest.

The stack runs one PostgreSQL server, as the XTM bundle does: PostgreSQL 17 with pgvector
(`pgvector/pgvector`), the bundle's image. It holds OpenCRQ's database and XTM One's, each under its
own role: `xtm-one-db-init` creates XTM One's role, database and pgvector extension at every `up`,
and leaves them alone once they exist.

**Another PostgreSQL major version.** A data directory opens only on the major version that created
it, so each major keeps the stack's databases in a volume of its own, `postgres<major>_data`
(`postgres_data` for PostgreSQL 16). The first `yarn env:up` after the major changes moves the
databases into the new volume, from the newest earlier one: it stops the backend and frontend, dumps
the roles and every database from a server of the earlier major started on its volume alone,
skipping the integration tests' `app_test_*`, and restores them into the new server, which also
rebuilds their text indexes under its collation. Owners and privileges come along, so XTM One's
database moves with OpenCRQ's. The earlier volumes are left as they were, and `up` prints the
command that removes them. A move that fails keeps its dumps under
`.git/devenv/<slot>/postgres-upgrade`, and the next `up` restores them again; `yarn env:up --reset`
gives the move up for an empty database. `--reset` and `env:down --volumes` destroy the earlier
volumes too.

From PostgreSQL 16, XTM One's database is not moved: it had a server of its own, whose volume
`xtm_one_db_data` is left as it was. XTM One starts empty and its administrator is created again from
`infra/local/.env`. At boot, the backend ties the seeded users to it again, when
`back/config/development.local.json` has a `platform_seed` block with `xtm_one_admin`. Users created by
hand in the earlier XTM One, its conversations and its settings stay behind in that volume.

The major version follows the XTM bundle's: Renovate reads it from the bundle's Compose file and
proposes the new tag. A new major also renames the volume in `infra/local/compose.yml`, and from 18
on mounts it at `/var/lib/postgresql`. `yarn test:scripts` fails
until the volume, its mount and every image pin agree.

- **Its URL** is `xtmOne` in `yarn env:status --json`, on the port family 4005 + 100 × slot.
- **Its administrator** is generated with the worktree: `xtm-admin@example.com`, and a password
  `yarn env:status` prints. It signs in to XTM One itself, not to OpenCRQ.
- **OpenCRQ registers with it** at boot: `yarn env:up` writes the `xtm_one` block of
  `back/config/development.local.json` and waits for XTM One to answer before it starts the backend.
- **Its emails** never leave the machine: XTM One sends them to the worktree's Mailpit, whose web
  UI is `mailpit` in `yarn env:status --json`, on the port family 8025 + 100 × slot.

**Without its own XTM One.** The three XTM One services, `xtm-one-db-init`, `xtm-one` and
`xtm-one-worker`, are in the `xtm-one` Compose profile, which
`yarn env:up` enables by default. A worktree whose XTM One port something else serves sets
`XTM_ONE_LOCAL=false` in its `infra/local/.env`, by hand or through the stand-in's own attach
command, which may write the line and remove it again on detach: the next `up` then stops the stack's own XTM One if
it runs, starts the rest without it, and `yarn env:status` says so (`xtmOneLocal: false` in
`--json`). Nothing else changes: the backend still registers with, and signs users in through, the
XTM One on that port, so nobody signs in without one answering there. That XTM One has to accept
this stack's `XTM_ONE_REGISTRATION_TOKEN` and, when the platform seed runs, its administrator: a
stand-in that accepts anything does, another stack's XTM One refuses the registration and fails the
seed. Removing the line, or setting it to `true`, starts the stack's own XTM One again at the next
`up`, with its `xtm_one` database, which the stack's PostgreSQL kept. A `compose.override.yml` that gives the services another
profile does not keep them off: Compose adds an override's profiles to the file's, so
`--profile xtm-one` still starts them.

The image is `xtmone/platform:rolling`, which follows XTM One's main branch: no release yet signs a
product's users in without a consent page. It is published for amd64 only, so an Apple silicon
machine runs it emulated, which Docker Desktop and the Podman machine (Rosetta) both do unasked.

### Signing in

Sign in through XTM One, as production does, there being no other way in: open the `frontend` URL,
which sends you straight to the stack's XTM One sign-in page, type an email and its password there,
and you land back in OpenCRQ.

- **The super administrator** is XTM One's own administrator, `xtm-admin@example.com` with the
  password `yarn env:status` prints (`XTM_ONE_ADMIN_PASSWORD` in the worktree's `infra/local/.env`):
  every right in every tenant and on the platform, with no membership, signalled by the
  `xtm_super_admin` claim the stack's XTM One sends.
- **The seeded users** exist in the stack's XTM One with the seeded password: the admin you typed in
  `seed:setup-dev` (`admin@example.com` by default), a platform administrator in OpenCRQ through
  its platform group, and `alice`, `bob`, `charlie` and `eve` `@example.com`, all with the same
  password.
- **Anyone else** XTM One knows gets an account at their first sign-in, with access to nothing yet.

XTM One keeps its own session: after signing out of OpenCRQ, "Sign in with XTM One" brings you
back as the same user without a password. To switch users, sign out of XTM One too, at its own URL.

### Blank platform or demo data

By default you start on a blank platform: the `Default` tenant, no users, no data. XTM One's
administrator signs in first, as super administrator, and lands in that tenant (see
[Initial tenant](../deployment/configuration.md#initial-tenant)). To start with demo data instead
(tenants, users, organizations and assets for manual e2e testing), run `yarn env:up --seed`, which
runs the interactive `seed:setup-dev` and writes a `platform_seed` block into
`back/config/development.local.json` (gitignored). On an empty database the platform then holds the
demo tenants only; a stack that has already started keeps its `Default` tenant beside them, and
`yarn env:up --reset --seed` starts it over, destroying everything in its database. The seed creates each of its users in the
stack's XTM One first, signed in as XTM One's administrator, which `yarn env:up` adds to that block
as `xtm_one_admin` (`seed:setup-dev` reads it from `infra/local/.env` when the block does not exist
yet), and ties each OpenCRQ account to its XTM One id. A user XTM One already holds, from an earlier
seed, is reused and given the seeded password. The seed runs on an empty database only, so at every
boot a development backend also ties to the stack's XTM One the seeded users it is not tied to yet:
those of a database seeded before the stack ran an XTM One, or restored from another worktree's
[snapshot](#snapshots), are found or created there by their email, with the seeded password. To
change the credentials on a seeded platform, run `cd back && yarn seed:rollback-dev`, answer yes to
dropping the database, then `yarn env:up --seed` again: the users XTM One keeps take the new
password. `cd back && yarn seed:rollback-dev` alone goes back to a
blank platform. Env-var equivalents for CI and staging are in the
[Configuration Guide](../deployment/configuration.md#platform-seed-non-production).
A blank platform also has the default platform groups, with no member. On an empty database `--seed`
gives it only the seed's `Admin` group; a stack that has already started keeps the two defaults
beside it.

### Enterprise Edition locally

A development stack gets its edition the way a deployment does: from a Filigran license, which the
stack's XTM One returns when OpenCRQ registers with it (`xtm_license_pem`) and OpenCRQ verifies
against the XTM CA in its build (see
[Enterprise Edition](../deployment/configuration.md#enterprise-edition)). The stack's own XTM One
starts with no license, so a stack is Community Edition: **every user reaches a single tenant and
creating a second is refused**. The seeded admin lands on Acme Bank, which holds the seeded estate:
Enterprise Edition is needed only to reach Tarnwick Industries and Fresh Start.

To test an Enterprise Edition feature, install a Filigran license in the stack's XTM One, signed in
as its administrator, on its Settings › License page. To give every stack the same license instead,
export its PEM as `XTM_ONE_ENTERPRISE_LICENSE` in your shell before `yarn env:up`, which hands it to
the stack's XTM One as its `ENTERPRISE_LICENSE`; set, it takes precedence over the Settings page, and
a stack already running picks it up at its next `yarn env:up`. OpenCRQ receives it at its next registration, within the 5-minute heartbeat, or at once
with **Check now** on the XTM One card of Settings › Parameters (behind the
`enterprise-edition-status` feature flag), and checks it exactly as a deployment does. A `ci`
license entitles only for the first 45 minutes after the OpenCRQ instance was created, so it does
not carry a stack that lives for days. Filigran issues these licenses; without one, a stack stays on
Community Edition, which is enough for any work on a single tenant.

The Ask Ariane button shows in the header of every stack, since `yarn env:up` always configures its
XTM One. On Community Edition it carries an Enterprise Edition chip and only explains the license;
on Enterprise Edition it opens the chat. The chat answers only once an LLM is configured in the
stack's XTM One, signed in as its administrator, and once XTM One can fetch the backend's signing keys
at `/xtm/auth/jwks`, which it needs to verify the per-user tokens the chat sends (on a plain Docker
engine on Linux, see [Container runtime](#container-runtime)).

### Observability

`yarn env:up --monitoring` also starts Grafana, Prometheus, Loki, Pyroscope and the OpenTelemetry
collector. Every push transport is off in the dev config, so a backend started without that stack
dials nothing; once it is up, turn the exporters on in `back/config/development.local.json`. The
endpoints are already set, on every slot: `yarn env:up` points them at the worktree's own collector
and Pyroscope (see [What it writes](#what-it-writes)), so `enabled` is all there is to write:

```json
{
  "telemetry": {
    "observability": {
      "otlp": {
        "metrics": { "enabled": true },
        "logs": { "enabled": true }
      },
      "pyroscope": { "enabled": true }
    }
  }
}
```

The Prometheus scrape endpoint stays on by default: it is served by the platform itself on the
worktree's metrics port, 14269 on slot 0 (see [Ports](#ports)), and needs no container.

### Ports

Each worktree gets a **slot**. Slot 0 is the set of ports the rest of the documentation names, and belongs to the main checkout. Every other worktree gets the next free slot, and each slot shifts every port by 100.

| | slot 0 | slot 1 | slot 2 |
| --- | --- | --- | --- |
| frontend | 3000 | 3100 | 3200 |
| backend | 3002 | 3102 | 3202 |
| postgres | 5432 | 5532 | 5632 |
| healthcheck | 8444 | 8544 | 8644 |
| object storage | 9000 | 9100 | 9200 |
| XTM One | 4005 | 4105 | 4205 |
| Mailpit | 8025 | 8125 | 8225 |
| backend metrics (`/metrics`) | 14269 | 14369 | 14469 |

The allocation is made once and recorded in `.git/devenv.json`. That file sits in the repository's shared git directory, so every worktree sees the same allocation, it is never committed, and it never shows up in `git status`. `yarn env:up` reads it, starts containers and servers, then records their pids: it re-reads the file right before that write and changes only its own worktree's entry, so a worktree allocated meanwhile keeps its own. The file is replaced whole, and a file that cannot be parsed stops the command rather than being written over. Removing a worktree frees its slot. Once git no longer knows it, after `git worktree remove`, or `git worktree prune` once its directory is gone, the next `yarn env:up` or `yarn env:ports`, in any worktree, stops the servers and containers it left running and hands its slot and suffix out again. A worktree git still knows is never touched, even when its path is out of sight, as every other worktree is from a dev container. Its volumes are left, and printed with the command that removes them: no new worktree takes a suffix whose volumes still exist, so none opens another's database. While that stack cannot be stopped, because no container runtime answers, `compose down` fails or a server outlives its stop, the worktree keeps its slot, each run says why, and the next one tries again. To release it by hand, stop what it left running, then delete its entry under `instances` in `.git/devenv.json` and `.git/devenv/<slot>`.

A worktree that already has a `back/config/development.local.json` keeps every port it names, backend, frontend, healthcheck, Postgres and object storage alike: those values are adopted as they stand rather than recomputed from a slot, so adopting this tool never moves a stack that is already running. The exception is a config whose backend port another worktree already holds, which is stale by definition and gets a fresh slot.

### What it writes

Two gitignored files, both **merged into** rather than overwritten, so anything you added by hand survives:

- `infra/local/.env` — `INSTANCE_SUFFIX`, the container ports and `BACKEND_PORT`, where XTM One fetches the backend's signing keys. The Compose file itself is versioned and already reads these variables, so nothing is generated. It also holds the worktree's XTM One secrets, generated at its first `up` and never replaced, since XTM One's database keeps what they were when it first booted: `XTM_ONE_SECRET_KEY`, `XTM_ONE_REGISTRATION_TOKEN` (never XTM One's published default, with which it withholds the license and the sign-in client) and `XTM_ONE_ADMIN_EMAIL` / `XTM_ONE_ADMIN_PASSWORD`. `XTM_ONE_LOCAL`, which you set yourself or a stand-in you attach writes (see [XTM One in the stack](#xtm-one-in-the-stack)), is kept like any line `env:up` does not manage.
- `back/config/development.local.json` — `http_server.port`, `dev_server.port`, `healthcheck_http_server.port`, `postgres.port`, `file_storage.endpoint`, the telemetry destinations of the worktree's own stack (`telemetry.observability.otlp.{traces,metrics,logs}.exporter` and `telemetry.observability.pyroscope.server_address`, and `telemetry.observability.prometheus.port`, the backend's own scrape port), the `xtm_one` block (`url`, `token` and `platform_url`, the frontend's URL, since the sign-in callback sets its cookie there), `http_server.host` on a plain Docker engine on Linux only (see [Container runtime](#container-runtime)), and, in a `platform_seed` block that exists, `xtm_one_admin`. It also drops from `feature_flags` the `xtm-sign-in` flag earlier stacks wrote, which the backend no longer knows and would refuse at boot. An `xtm_one` block or a telemetry destination written by hand is replaced like the ports, while every other telemetry key, the `enabled` switches included, is left as it is. A `telemetry` block still in a shape the backend no longer knows is not rewritten: the backend names the unknown key at boot, and it is fixed by hand. Both `yarn dev` commands read it.

Setting a worktree up by hand comes down to writing those two files, then starting the containers, the backend and the frontend in three terminals.

Started by hand, the containers need `--profile xtm-one` for the stack's XTM One (`docker compose --profile xtm-one up -d` in `infra/local`), and `docker compose --profile xtm-one --profile monitoring down` stops everything. Without `yarn env:up`, nothing generates the XTM One secrets: Compose then hands XTM One empty ones, so set `XTM_ONE_SECRET_KEY`, `XTM_ONE_REGISTRATION_TOKEN`, `XTM_ONE_ADMIN_EMAIL` and `XTM_ONE_ADMIN_PASSWORD` in `infra/local/.env` before the first `up` of the containers, and keep them afterwards. The `xtm_one` block's `token` is that registration token. On a plain Docker engine on Linux, the backend also has to listen beyond loopback for XTM One to fetch its signing keys. Without an `xtm_one` block the backend does not boot, XTM One being required.

Logs go to `.git/devenv/<slot>/{back,front}.log`.

`INSTANCE_SUFFIX` names the Compose project, its containers and its volumes, so every worktree gets its own: the branch name, or `-wt<slot>` for a detached HEAD and for a branch whose name reduces to a suffix another worktree already holds. It is chosen once and never renamed, since renaming it under a running stack would orphan its containers. A worktree allocated again after losing its entry takes back the suffix its own `infra/local/.env` records, and with it its database, unless another worktree now holds it.

A worktree with a detached HEAD registered by an earlier version of this tool carries the suffix `-head`, which every such worktree shared, so their stacks recreate each other's containers. `yarn env:up` warns when it finds its suffix held by another worktree. Fix it by hand: `yarn env:down` in one of them, which stops the shared project and with it every `-head` stack, delete their entries under `instances` in `.git/devenv.json`, then `yarn env:up` in each again to get `-wt<slot>`. A worktree whose `back/config/development.local.json` names its ports keeps them.

### Container runtime

Docker and Podman both work. The first of `docker compose`, `podman compose` and `podman-compose` that answers is used, so nothing has to be configured.

XTM One fetches the backend's signing keys at `host.docker.internal`. Docker Desktop and Podman route that name to the host's loopback, where the backend listens. A plain Docker engine on Linux resolves it to the bridge address instead, so there, and only there, `yarn env:up` writes `http_server.host: 0.0.0.0` into `back/config/development.local.json`; it tells that engine from Docker Desktop and Podman by `docker version`. The trade-off: the development backend is then reachable from the local network on its port, unless a firewall stops it. Without it, signing in still works, but Ask Ariane cannot answer.

### Snapshots

Some data is expensive to obtain. A full OpenCTI backfill takes over an hour of stream replay, and a
Microsoft Graph sync walks a real Defender tenant. A snapshot is a `pg_dump` archive of a worktree's
database, so that work is paid once and restored in seconds, anywhere:

```bash
yarn env:snapshot connectors --dir D:/snapshots   # once the ingestions have finished
yarn env:restore connectors --dir D:/snapshots    # from any worktree, on any branch
yarn env:snapshots --dir D:/snapshots             # sizes and dates
```

The directory is never guessed. An archive of a full ingestion is large and holds real third-party
data, so where it lands is yours to decide rather than a place inside the repository that this tool
picks for you. To stop repeating it, name it once for the shell:

```powershell
$env:DEVENV_SNAPSHOTS = 'D:/snapshots'
yarn env:snapshot connectors
```

Wherever you put it, the store is nothing but files: a snapshot taken from one worktree restores
into any other, and copying the directory to another machine carries it there.

A restore replaces the whole database, so it carries the tenants, the users and every connector at
once, not just the one you had in mind. It asks before doing it, unless given `--force`. The backend
and frontend are stopped first, since a running backend both holds the connections the drop has to
break and would write into a database being replaced underneath it. The dump holds OpenCRQ's
database only, so its seeded users are tied to the destination stack's XTM One at the next boot (see
[Blank platform or demo data](#blank-platform-or-demo-data)); any other restored user is refused at
sign-in, its email being held by an account tied to the source stack's XTM One.

Two things are worth knowing about what a restored platform then does.

**Migrations.** A dump is bound to the schema it was taken at. The backend runs the missing
migrations at boot, so restoring under a branch whose migrations are **ahead** of the dump works.
Under a branch **behind** it, nothing walks the schema backwards, and the restore is unusable.

**Connector positions.** The dump also restores where each connector had got to, and a position only
means something against the instance that issued it. Microsoft Graph re-reads from its watermark, so
it merely catches up. OpenCTI is the one to watch: when the restored cursor has fallen out of the
stream's retention window, it reopens at the live edge without saying so, and the ingestion carries a
silent gap. Pass `--reset-cursors` when you want the restored data as a baseline and a clean
re-ingestion on top of it:

```bash
yarn env:restore connectors --dir D:/snapshots --reset-cursors
```

Jobs need no such care: a run captured mid-flight restores as `running` with an expired lease, and
the orphan reaper picks it up on the next pass.

### The large estate

Everything that reads a risk scope's estate (the drawer's assets picker, Assets and Findings inside a
scope, the estate map, the engine's runs) is measured on a park of a hundred thousand assets
before it ships. The platform seed builds that park under a profile that is off by default, and one
script times each of those surfaces against the budgets the product owner confirmed on 2026-09-13.

Add the profile to the `platform_seed` block of `back/config/development.local.json`, next to the
admin the seed already creates, then start on an empty database so the seed runs:

```jsonc
"platform_seed": {
  "enabled": true,
  "admin": { "email": "admin@example.com", "password": "Admin1234!" },
  "large_estate": { "enabled": true, "assets": 100000, "findings": 300000, "mapped_assets": 30000 }
}
```

```bash
yarn env:down                # the reset below wipes the database under a backend that would not re-migrate
yarn env:up --reset          # the profile writes about 1.3M rows into a 415 MB database, in about three minutes
yarn env:snapshot large-estate --dir D:/snapshots
```

The seed stops as soon as its admin user exists, so turning the profile on and restarting an
already-seeded stack does nothing: the empty database is the point of `--reset`.

The ids of the park's assets, findings and observations are scrambled, so their order is unrelated to
the order they were written in. A snapshot older than the scrambling still holds sequential ids: regenerate
it with `--reset`.

Take the snapshot once and every other worktree loads the park in seconds instead of reseeding:

```bash
yarn env:restore large-estate --dir D:/snapshots --force   # without --force it asks a question a script cannot answer, and restores nothing
yarn env:up                                                # restore stops the servers, so the bench would find nothing on the port
yarn perf:estate
```

`yarn perf:estate` logs in with the seeded admin, finds the tenant's closed scope, and writes
`perf-report.md` and `perf-report.json` under `.dev/perf` (`--out <dir>` puts them elsewhere). It
exits 1 when a measure missed its budget and 2 when none did but one was skipped, so a skip never
reads as a pass. `--repeats <n>` changes how many calls each paginated measure samples,
`--skip-runs` leaves the engine alone, and `--skip-map` skips the browser pass, which needs a
Chromium (`CHROME_PATH` names one the script would not find on its own).

The sizes are yours to change: the profile is a set of numbers, not a flag, and any ratio between
them holds its shape, so `{"assets": 10000, "findings": 30000, "mapped_assets": 3000}` gives a
tenth of the park in seconds when the shape is what you need rather than the volume.

### Troubleshooting

**"No container runtime found."** Docker Desktop or the Podman machine is not running. Start it and try again.

**A port is already in use.** `yarn env:status --all` shows which worktree holds which ports and what is currently running. A port taken by something outside the repository needs that program stopped, or the slot changed by editing `.git/devenv.json` and running `yarn env:up` again.

**`up` waits a long time, then fails on `xtm-one`.** XTM One is unhealthy: `docker logs app-dev-xtm-one<suffix>` (or `podman logs`) says why. On an arm64 machine, check that the container runtime can run amd64 images.

**The backend or frontend does not come up.** They run in the background, so the error is in the log: `yarn env:logs back`. A backend that cannot reach the database usually means the containers are not up yet, which `yarn env:status` confirms.

**A worktree on an old branch.** Branches from before the `back` and `front` directories were renamed have a different layout, and this tool targets the current one. Update the branch from `main` first.

## Database

-   **Schema:** Located in `module/src/modules/*/schema.ts`.
-   **Migrations:** Run `yarn db:generate` in `module` after modifying the schema.

To start over without touching the containers:

```bash
cd back
yarn env:reset            # drop and recreate the dev database, keep uploaded files
yarn env:reset --infra    # destroy the Compose volumes too (database + uploaded files)
```

The script finds the container serving `postgres.port`, prints the target and asks for confirmation, then offers to set up the platform seed. Restart the backend (`yarn env:down`, then `yarn env:up`): migrations and the seed run on boot.

## Agent files

**Skills** live in `.claude/skills/`, the one directory Claude Code reads them from.

**Path-scoped instructions** are written once in [`.agents/instructions/`](../../.agents/README.md) and rendered:

```bash
yarn agent:build      # render the instructions into .github/instructions and .claude/rules
yarn agent:check      # what CI runs: stale, missing or orphaned render, dead glob, broken link
```

Never edit a rendered file: it carries a banner saying so, and CI will reject the change. Edit the source and re-render.

## Notice file

`NOTICE` carries what the third-party data in the repository and the image requires, credits the third-party data the connectors fetch at runtime (`RUNTIME_SOURCES` in the registry), and is generated: the `notice` CI job fails when it is stale. The notices of the third-party software are in `THIRD_PARTY_NOTICES`, which the Filigran Flow checker writes when the image is built.

```bash
yarn notice:build     # regenerate NOTICE after a data file changed
yarn notice:check     # what CI runs
```

A data file must be named, by its own path, in `scripts/notice/registry.mjs`. A data file is anything under a `data/`, `fixtures/`, `__fixtures__/` or `test-data/` directory, the served maps (`back/static/`), the front-end assets (`front/public/`), the outcome counter model, any `.generated.ts`, and from 10 KB any file that is not code (`.yaml`, `.txt`, `.jsonl`, `.json`…) or a `.ts` file made mostly of string literals. Tests, Markdown and the paths `IGNORED` lists are not. It is named as a third-party work with its notice, as a reviewed work that needs none, or as first-party data. The registry records the release each MITRE notice was read from, and the check fails when the version in the code moves, so read the notice again then.

## Software bill of materials

The machine-readable inventory of the application's JavaScript packages is a CycloneDX 1.6 SBOM, with Filigran SAS as supplier and manufacturer. The `SBOM` job of CI (`.github/workflows/sbom.yml`, which `ci.yml` calls) builds it on every push to `main`, every release tag and every pull request, and on demand, and uploads it as the `opencrq-app-sbom` artifact of its run, kept 90 days for a release and 30 otherwise. The hand-over to the release repository waits for it, so a commit whose SBOM fails is not released. It lists, each package once:

- the backend's externals, which the image's `deps` stage installs from `back/dist/package.json`;
- the packages the backend's build inlines into `back/dist`, read from the esbuild metafile of its build options (`back/esbuild-config.ts`);
- the front end's production dependencies. The run fails if the front end's Vite build inlines a package outside them, a stylesheet's `@import` included, which happens when a package `front/src` imports is declared as a development dependency.

Development dependencies are left out. So are the image's OS packages, the Node runtime and Corepack, which only the published image shows: a release carries `sbom-opencrq-<version>.cdx.json`, this SBOM merged with the one Syft reads from the image Docker Hub serves (`scripts/ci/sbom-release.sh`, run by CI's release job, see [Releases](#releases)). With Syft, cyclonedx-cli and jq on the `PATH`, the commands the workflow runs reproduce the application's:

```bash
docker build --file docker/prod.dockerfile --target deps --tag opencrq-sbom-deps .
docker build --file docker/prod.dockerfile --target builder --tag opencrq-sbom-builder .
scripts/ci/sbom-collect.sh opencrq-sbom-deps opencrq-sbom-builder /tmp/sbom   # DOCKER=podman with Podman
scripts/ci/sbom-generate.sh /tmp/sbom 0.0.0-dev
```

## Versions

The platform has one version, which an image carries as `APP_VERSION` and `scripts/release.mjs build-version` computes for the image build:

- **A release** is `0.YYMMDD.z`, as OpenCTI and OpenAEV number theirs (with their own major): `YYMMDD` is the day it was cut, in UTC, `z` tells apart the releases of one day from `0`, and the major stays `0` during the beta. A release is nothing but that tag on a commit of `main`, and its image carries the tag's name. A tag of three numbers that is not one fails the image build, and so does a release dated on a day that does not exist, before its commit's or after the day it is built.
- **Any other image**, from `main`, a pull request or a manual run, is `0.YYMMDD.0-dev.<sha>`: its commit's day in UTC and the first seven characters of that commit, so that a rebuild of a commit keeps its version.
- **A process run from source** has no `APP_VERSION` and reports `0.0.0-dev`.

`yarn release:version` prints the next release number from the tags on origin. A release is cut with the `/release` skill, as [Releases](#releases) describes, never by pushing a tag by hand: a tag without its draft release fails CI and gets no GitHub Release.

The version is what the platform reports: the boot log, the `health` answer, the OpenCRQ platform card of Settings → Parameters, the XTM One registration and `X-Platform-Version` header, `service.version` in traces and usage telemetry. Since it differs on every commit, it also decides whether a boot seeds again or resets the database (`PLATFORM__RESET_ON_VERSION_CHANGE`), and stamps the simulation runs and the default threats load; a process run from source does none of these. Code reads it as `platformVersion()` and `imageVersion()` (`back/src/utils/platform-version.ts`), never `APP_VERSION` directly: a lint rule (`appVersionRules`) flags any other reader of the variable.

## Code quality

```bash
yarn ci          # each workspace's own ci script (integration-tests excluded), then knip
yarn check-ts    # type-check every workspace, integration-tests included: run it before pushing
yarn lint
yarn test
```

From an AI assistant, the `lint`, `check-ts` and `test` skills (`/lint`, `/check-ts`, `/test` in Claude Code) run the same checks on the changed workspaces only, and print one line per workspace.

Integration tests run on their own, against the stack's Postgres but in their own `app_test_*`
databases, so the dev data is untouched:

```bash
cd integration-tests && yarn test src/tests/...
```

## Secret scan

The `Secret scan` CI workflow looks for secrets (tokens, keys, passwords) with [betterleaks](https://github.com/betterleaks/betterleaks) in a container, and fails on a finding: in the tree of `main` and of every pull request, and in each commit of the pull request, since a secret one commit adds and the next removes is still readable in the first.

A secret CI finds has already been pushed. Removing it in a new commit, or even rewriting the branch, does not take it back: GitHub keeps the commit readable by its hash. Revoke it, then remove it.

The same scan can run on each commit, before the secret leaves your machine: enable the pre-commit hook once per clone, worktrees included.

```bash
git config core.hooksPath .githooks
```

`core.hooksPath` replaces `.git/hooks` rather than adding to it: a hook of your own there stops running, so move it to `.githooks` locally or call it from there.

The hook scans the staged files, needs Docker or Podman running, and is skipped without them or offline before the image is pulled; any other failure of the scan refuses the commit. `git commit --no-verify` skips it once. To scan by hand, `scripts/secret-scan.sh <directory>`: on the root of a checkout it reads the tracked and unignored files, leaving out `node_modules` and the nested worktrees, and on any other directory every file.

Every built-in rule is on. `.betterleaks.toml` silences only the two generic rules, which flag any value set next to a `password` or `key` name, in tests, on the local stack's default passwords and on the UUIDs of the id registries: a fake credential that trips the scan belongs in a test file or in that allowlist, never a real one. An inline `gitleaks:allow` or `betterleaks:allow` comment is ignored.

## Image and release

CI builds the production image and boots it against an empty database on every pull request and every push, a fork's pull request included, with no secret. It never publishes an image. Each `main` commit and each release tag that passes CI is handed over to Filigran's private release repository, which publishes the image (`filigran/opencrq` on Docker Hub: `rolling` for `main`; for a release, its version, and `latest` when it is the highest release) and deploys the latest commit of `main` to the testing instance. The only deployment credential this repository holds is the one that hands a commit over, and its environment accepts only `main` and release tags.

### Releases

Every release is a GitHub Release on its tag, published once Docker Hub serves its image, with a CycloneDX 1.6 SBOM of that image attached. A release manager cuts it from Claude Code with `/release <commit>` (`.claude/skills/release/`), naming the last commit of `main` to include:

1. `node scripts/release.mjs prepare` refuses, before anything is pushed, a commit that is not on `main`, that a release already holds (its own tag or a later one, as `main` has no maintenance branch), or whose CI run on `main`, `Hand over to the release repository` included, is not green, and a next number a draft already holds, left by a run that never pushed its tag. It then computes the version and the range, from the highest release tag the commit descends from.
2. It writes the notes: the highlights, drafted by the skill and corrected by the release manager in review, then the changelog. The changelog lists the issues closed by the pull requests merged in the range, under their title without the Conventional Commits prefix: **Breaking changes** (a `!` in the title, or the `breaking-change` label), **Security** (`security` label), **Enhancements**, **Bug fixes**, and a collapsed **Maintenance**, by the issue's Type, else its `feature` or `bug` label, else its title's type. An `enterprise edition` issue is marked. An issue closed by hand, or last closed by a pull request outside the range, is left out. It ends with the compare link from the previous release.
3. Once the release manager approves the notes, the skill creates the draft release on the commit, then pushes the signed tag, in that order: the skill never leaves a tag without its draft. A draft creates no tag, and publishing it keeps the signed tag pushed after it; GitHub would only make an unsigned tag of its own for a draft published with no tag, which CI never does, as it publishes from the tag's run. The skill deletes the draft when its tag cannot be pushed.
4. The tag's CI run ends with the `Publish the GitHub Release` job, after the hand-over and the SBOM, with `contents: write` for itself and the next job alone and no other credential. It runs on the `release-approval` environment, whose required reviewers are the release managers: it starts only once one of them, the author of the tag included, approves it from the run's page. It then waits up to 45 minutes for Docker Hub to serve `filigran/opencrq:<tag>` built from the tag's commit (its `org.opencontainers.image.revision` label), read anonymously; then it requires the draft, appends the `docker pull` line and the image's digest, attaches `sbom-opencrq-<tag>.cdx.json` (the application's SBOM of the same run merged with Syft's reading of the image) and publishes it, never as Latest. `Mark the latest GitHub Release` then marks Latest the highest published release, one run at a time across tags, so that two tags published together cannot leave the lower one Latest. When a third tag queues behind a pending one, GitHub cancels the pending run of that job, so a tag's CI run can show cancelled although its release is published: nothing to re-run, the later tag's job marks the same release.

A tag whose image never comes, or a tag pushed by hand with no draft, fails the job and leaves nothing published: the failed job is re-run once the image is served, or once a draft is created on the tag with notes written by hand (`gh release create <tag> --draft --verify-tag --notes-file <notes>`): `/release` writes notes only for a commit no tag holds yet. A re-run completes a draft and leaves a published release as it is: releases are immutable, so no asset can be added once published, while the title and the notes stay editable. With no earlier release tag, the first release has no changelog: its notes present the product.

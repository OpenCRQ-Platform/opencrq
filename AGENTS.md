# AGENTS.md

Project instructions for every AI agent working in this repository, and the single place they are
written. Claude Code, the development assistant, loads it through the `@AGENTS.md` import in
`CLAUDE.md`. Copilot only reviews pull requests and reads this file on its own.

> **Deep-dive references** — read the relevant doc before touching the related code:
> - [Frontend Architecture](.github/instructions/frontend.instructions.md) — before working on `front` (testability, hooks, shared components, test utils)
> - [Backend Architecture](.github/instructions/backend.instructions.md) — before working on `back` (Fastify, tRPC routers, feature modules, engines)
> - [Typography](.github/instructions/typography.instructions.md) — before writing or reviewing text/font styling on legacy `@filigran/ui` surfaces (`txt-*` classes)
> - [Design System](.github/instructions/design-system.instructions.md) — before styling any `.tsx` and before any design/UX research or mockup: where to read FDS tokens and component contracts, never from memory
> - [FDS cohabitation bridge](.github/instructions/fds-migration.instructions.md) — before touching the generated `fds.css`, the styles or the theme provider
> - [Domain Modules & Security](.github/instructions/domain-modules.instructions.md) — before working on `module`
> - [CRQ attack run engine](.github/instructions/crq-attack-run.instructions.md) — before changing the engine, its initial access door, its constants or its calibration
> - [Get started onboarding wizard](.github/instructions/feature-onboarding.instructions.md) — before changing the onboarding wizard, its tenant provisioning, its status rules or its landing redirect
> - [Drizzle Schema Conventions](.github/instructions/drizzle-schema.instructions.md) — before adding/modifying schema files (forbidden column types, FK rules, migrations)
> - [Internationalisation (i18n)](.github/instructions/i18n.instructions.md) — before working with translations / Lingui
> - [ESLint Configuration](.github/instructions/eslint.instructions.md) — before adding/modifying lint rules
> - [Integration Tests](.github/instructions/integration-tests.instructions.md) — what kind of change needs one
> - [Writing Integration Tests](.github/instructions/writing-integration-tests.instructions.md) — setup, structure and patterns, when working in `integration-tests`
> - [Writing Frontend Tests](.github/instructions/writing-frontend-tests.instructions.md) — the setups a `front` test needs, when writing one
> - [Toast Notifications](.github/instructions/toaster.instructions.md) — before adding/modifying toast behavior on mutations
> - [Hooks](.github/instructions/hooks.instructions.md) — before adding/modifying agent hooks
> - [Code comments](.github/instructions/code-comments.instructions.md) — what a comment may say, before writing one
> - [The AI hub](.github/instructions/agent-hub.instructions.md) — before touching `.agents/`, a rule, a rendered instruction or the renderer
> - [XTM One sign-in](.github/instructions/feature-xtm-one-sign-in.instructions.md) — before touching the sign-in, sessions, accounts, adding members or the security predicates: accounts by XTM One id, members added by email through XTM One and the super administrator bypass
>
> These are rendered from `.agents/instructions/`, which is where they are edited.
>
> **Skills** (`.claude/skills/`, the one directory Claude Code reads for them, since it ignores
> `.agents/skills/`) — procedural playbooks loaded on demand, each announcing when it applies.

## Project context

OpenCRQ is an open-source cyber risk quantification platform. Yarn 4 monorepo: `back`
(Fastify + tRPC), `front` (React 19 + Vite + TanStack Router), `module` (schemas, repositories,
services, security policies, migrations), `utils`, `eslint-rules`, `integration-tests`.

It is **multi-tenant**. The tenant id is held client-side (`getCommittedTenantId()`, in
`front/src/lib/tenant-accessor.ts`), sent as the
`x-tenant-id` header on every tRPC call, and scopes every read and write server-side through the
security policies (`SecuredSchema` views, `ProtectedDB`).

## Commands worth knowing

```bash
yarn env:up            # this worktree's stack: ports, containers, backend, frontend
yarn env:status        # its ports and what is running
yarn env:logs back     # the servers run in the background, their output is here

yarn ci                # per-workspace check-ts + lint + test, then knip; EXCLUDES integration-tests, which CI runs
yarn check-ts          # root, and this one does include integration-tests: run it before pushing
cd module && yarn db:generate                        # after ANY schema change
cd integration-tests && yarn test src/tests/...      # uses postgres.port from back/config/development.local.json; PGPORT overrides it

cd front && yarn i18n:extract    # after adding or changing t / Trans / msg
cd front && yarn i18n:check      # what CI runs; extract:clean first if a string was deleted

yarn agent:build       # re-render .agents/instructions after editing one
yarn notice:build      # regenerate NOTICE after a data file or the notice registry changed
```

Running the app (by hand or from an AI prompt), ports and parallel worktrees:
[docs/development/development.md](docs/development/development.md#running-the-app-locally).
Prefer the `/lint`, `/check-ts` and `/test` skills over the root scripts: they only touch the
workspaces that changed.

## Domain modules & security

A domain entity is `schema.ts` then `repository.ts` then `service.ts` then `index.ts`, under
`module/src/modules/<domain>/`, and its `db` is a **ProtectedDB**: policy-enforced writes, reads
through `views.*`, `rawDb()` only for a justified bypass. Only `auth` is a global repository.
[Deep-dive](.github/instructions/domain-modules.instructions.md).

## Documentation Workflow

**Feature docs** — starting a large feature, create `.agents/instructions/feature-<name>.md` with
its scope, architecture decisions, patterns and key files, give it an `applyTo` targeting the
feature's paths, run `yarn agent:build`, and list it in the deep-dive section above. **When the
feature merges**, prune the build notes and status logs, then either delete the doc or keep it as a
durable reference if what remains is schema, policies, key files or formulas future work still needs.

**A pattern worth writing down** goes here when it is short and frequent, in a
`.agents/instructions/` file when it is detailed or domain-specific. Ask before adding a **new**
document.

**Before calling a task done**, check whether the change dated a deep-dive doc, and update it in the
same task.


## Platform Seed

The platform seed creates realistic test data for manual e2e testing. Triggered by a `platform_seed` config block. Config reference: [docs/deployment/configuration.md](docs/deployment/configuration.md#platform-seed-non-production). Dev setup: [docs/development/development.md](docs/development/development.md). Seeder-authoring rules: [deep-dive](.github/instructions/platform-seed.instructions.md).

## Feature flags

An unfinished feature merges behind an off switch declared in `utils/src/feature-flags.ts`, the
closed registry `back` and `front` both type-check against; an unknown name fails the boot parse,
and `'*'` turns everything on. A flag is **off by default** and **temporary** — delete its entry
when the feature ships globally, and every gate still naming it stops compiling. Gate an endpoint
with `procedure.use(featureFlagged(flag))`, a whole backend feature with `featureFlag` on its
`registerFeature()` entry, and UI with `useFeatureFlag(flag)` or `<FeatureFlagged flag="...">`. No
per-user or per-tenant targeting, no runtime toggling.
[Configuration](docs/deployment/configuration.md#feature-flags-development).

## Enterprise Edition license headers

`LICENSE` puts the Community Edition (CE) under Apache 2.0 and the Enterprise Edition (EE) under the
OpenCRQ Enterprise Edition License. A file without the header below is CE.

EE today is the multi-tenant code (reaching more than one tenant), the Ask Ariane chat, and the
edition machinery: the license verification, the edition gate and status, the edition cards and the
CE tenant limit, as in OpenCTI and OpenAEV. A file holding code of any of them, even mixed with CE,
starts with this header followed by a blank line and is listed in `EE_FILES` of
`scripts/ee-header.test.mjs`, which `yarn test:scripts` checks. When in doubt, mark it EE: a header
can be removed, a file published under Apache cannot be taken back.

Tests and their helpers never carry the header.

```ts
/*
Copyright (c) 2026 Filigran SAS

This file is part of the OpenCRQ Enterprise Edition ("EE") and is
licensed under the OpenCRQ Enterprise Edition License (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://github.com/OpenCRQ-Platform/opencrq/blob/main/LICENSE

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/
```

## Git Workflow & PR Conventions

- **Base branch**: branch from `main` (there is no long-lived `release/*` branch).
- **Branch naming**: `<issue#>-<short-description>` in kebab-case (e.g. `638-refactor-jobs-push-events`); add a `-chunkN` suffix for large multi-part features. Non-issue chores may use a `type/slug` prefix (e.g. `chore/conventions-alignment`).
- **Commit & PR titles**: see the **Commit, PR & issue conventions** section below.
- **Merge strategy**: squash & merge only.
- **Approvals**: 1 required, **2 required** for security-sensitive changes (auth, permissions, secrets, crypto).
- **PR description**: must include context, scope, and how to test.
- **Draft early**: CI runs on pull requests and on `main`, never on a branch push, so open as draft as soon as you want CI to run.
- **Post-merge**: close the issue and add `solved` or `wontfix` label.

## Database schema

Regenerate migrations with `cd module && yarn db:generate` after any schema change, and keep **at
most one** new migration file versus `origin/main`, reconciling rather than stacking. Every new
table needs a hand-appended `notify_data_changed` trigger. Forbidden column types, FK cascade rules
and the reconciliation procedure: [deep-dive](.github/instructions/drizzle-schema.instructions.md).

## Code Conventions

- **Exact dependency versions** — `.yarnrc.yml` sets `defaultSemverRangePrefix: ""`. All `package.json` dependencies must use exact versions (e.g., `"1.2.3"`), never semver ranges (`"^1.2.3"`, `"~1.2.3"`). This applies to `dependencies`, `devDependencies`, and `peerDependencies`. During code review, flag any version range as a bug.
- **Deduplicated lockfile** — run `yarn dedupe` after adding or bumping a dependency; CI fails while `yarn dedupe --check` finds a range one version could satisfy, since a second copy of a package the backend bundle keeps external is one it can never load.
- **No `.d.ts` files** — ESLint rule forbids them; use `.ts` files instead.
- **No default exports** in `.ts`/`.tsx` files (except `.config.ts` files) — enforced by `import/no-default-export`.
- **Named exports only** from `index.ts` barrel files.
- **Zod 4** for runtime validation (in tRPC inputs and schemas).
- **UUIDv7** for all entity IDs but users related ones (`uuidv7` package).
- **Strict TypeScript**: `strict: true`, no unused locals/params, `verbatimModuleSyntax`.
- **React Compiler-first frontend**: In `front`, avoid adding `useMemo`, `useCallback`, and `React.memo` by default. Keep manual memoization only with explicit local justification when identity stability is required.
- Frontend route files (`src/routes/`) are exempt from filename/folder naming convention linting.
- `$` prefixed folders/files in routes are TanStack Router dynamic params (e.g., `$tenantId`).
- **Success toast messages** use sentence case with a period at the end (e.g., `'Tenant created successfully.'`).
- **Batch mutations** use `skipSuccessToast` on individual calls and show a single manual toast after `Promise.all` completes.
- **Auth flows and UI state change mutations** use `skipSuccessToast` to silence automatic success notifications.
- **Repository security**: In repos (`defineRepository`), `db` is a **ProtectedDB** — reads via `select()`, writes via policy-enforced `insert()/update()/delete()`. Use `rawDb()` for justified bypasses only. Only `auth` uses `defineGlobalRepository()` with full `db` access (requires raw DB for sessions/transactions). ESLint `no-restricted-syntax` rule flags `db.transaction/execute` and `rawDb()` in secured repos.
- **Comments** state only what the code cannot show, and are cut to one why. Full policy in the
  code-comments deep-dive, which loads on any source file.

## Frontend

Pure logic goes in `*-utils.ts` files with no React and no i18n, data pages use `DataPageLayout` or
`DataPageWithCards` and detail pages `DetailPageLayout` with `SectionCard`, never a raw `DataTable`
or `Card`. Everything else, including the testing patterns and the shared hooks:
[deep-dive](.github/instructions/frontend.instructions.md).

## ESLint Configuration

ESLint 9+ flat config. → See [deep-dive](.github/instructions/eslint.instructions.md) for architecture, rule files, and how to add rules.

<!-- filigran-conventions:start -->
## Commit, PR & issue conventions

All commits, pull requests and issues in this repository follow the
[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)
specification with a GitHub issue reference:

```
type(scope?)!?: description (#issue)
```

- Types: `feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `perf`, `test`,
  `build`, `ci`, `revert`.
- The description starts with a lowercase letter and has no trailing period;
  preserve acronyms and proper nouns.
- The old `[backend]` / `[frontend]` bracket prefixes are discontinued — use a
  Conventional Commits scope instead.
- Pull request titles **must** end with the related issue reference, e.g.
  `(#1234)`, and every pull request must be linked to an issue.
- Sign your commits.

When generating commit messages, PR titles or issue titles, always follow this
convention. See [`.github/LABELS.md`](.github/LABELS.md) for the full title and
label taxonomy.
<!-- filigran-conventions:end -->

### Links in public metadata

Issues, pull requests, comments and commit messages are read by people who cannot open a private
repository, so none of them links one (an issue, pull request, commit, file or advisory hosted
there): the link is a 404 for them and leaks the repository's name. This repository is exempt,
whatever `gh repo view` reports while it is still private: it is the one that goes public. To tell
which any other repository is, run `gh repo view <owner/repo> --json visibility`. To connect the
two, link the public item from the private one.

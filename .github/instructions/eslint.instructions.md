---
applyTo: "eslint-rules/**,eslint.config.ts,**/local.eslint.config.ts"
description: 'ESLint 9+ flat config architecture, rule files, and how to add or modify lint rules'
---

<!-- Generated from .agents/instructions/eslint.md by scripts/render-agent-files.mjs. Edit the source, not this file. -->

# ESLint Configuration

## Overview

The project uses **ESLint flat config** (ESLint 9+) with a two-tier architecture:
1. **Root config** (`eslint.config.ts`) — applies rules to all workspaces
2. **Workspace local configs** (`<workspace>/local.eslint.config.ts`) — workspace-specific overrides, auto-discovered and merged

Currently only `front` has a local config.

## Rule Definitions — `eslint-rules` workspace

Rules are **not** defined inline in config files. They live in the `eslint-rules/src/rules/` workspace as named `Linter.RulesRecord` exports, grouped by concern:

| File | Export | Scope | Key rules |
|---|---|---|---|
| `javascript.ts` | `javascriptRules` | All JS/TS | `no-var`, `prefer-const`, `no-console`, error prevention |
| `javascript-only.ts` | `javascriptOnlyRules` | `.js/.mjs/.cjs` only | Rules that conflict with TS equivalents (`no-shadow`, `no-loss-of-precision`) |
| `typescript.ts` | `typescriptRules` | `.ts/.tsx` | `Array<T>` style, `import type`, `switch-exhaustiveness-check`, naming conventions |
| `stylistic.ts` | `stylisticRules` | All | 2-space indent, single quotes, trailing commas, 1tbs brace style, `curly: all` |
| `import.ts` | `importRules` | All | Import ordering, no CommonJS, no duplicates, alphabetical sort |
| `file-format.ts` | `fileFormat` | All `src/` | KEBAB_CASE for files and folders |
| `node.ts` | `nodeRules` | All | `node:` prefix for builtins |
| `app-version.ts` | `appVersionRules` | `.ts/.tsx`, tests and `back/src/utils/platform-version.ts` excepted | `no-restricted-properties` on `APP_VERSION`: the version is read through `imageVersion()` or `platformVersion()` |
| `lingui.ts` | `linguiRules` | Frontend only | i18n string detection (see [i18n doc](.github/instructions/i18n.instructions.md)) |

`index.ts` re-exports everything as a barrel.

### Pattern for adding a rule

1. Find the right file by concern (or create a new one if it's a new category)
2. Add the rule with a `/** JSDoc comment */` explaining its purpose
3. Export is already picked up via the barrel `index.ts`
4. If the rule is workspace-specific (e.g. React/JSX), add it in the workspace's `local.eslint.config.ts` instead

## Custom AST Rules — `eslint-rules/src/plugins/`

Rules that need AST traversal (not just toggling built-in/plugin rules) live in `eslint-rules/src/plugins/` and are exposed through the local `app` plugin. Each is a plain `{ meta, create }` object using the minimal `RuleContext` / `TSESTree` types (see `no-unused-endpoint.ts` for the canonical pattern), unit-tested with ESLint's `RuleTester` (`*.test.ts`).

| Rule | Applied to | Purpose |
|---|---|---|
| `no-raw-table-in-reads` | `module/**/repository.ts` | Force `views.<table>` over raw tables in reads (row-level security) |
| `no-unused-repo-method` / `no-unused-service-method` / `no-unused-router-endpoint` | repository/service/router files | Flag dead repository/service methods and unused tRPC endpoints |
| `no-optional-query-output` | `back/src/features/**/*-router.ts` | Disallow `.optional()` in a `.query()` `.output()` schema — a query resolving to `undefined` crashes TanStack Query; use `.nullable()` + `?? null` instead |
| `no-unbounded-list-query` | `back/src/features/**/*-router.ts` | Flag a `.query()` whose resolver returns an array without a `pagedInput(...)`, read from its return type so a query declaring no `.output()` is caught too, and an `any` or `unknown` return with it: paginate, declare the bound with a `// bounded-by:` comment directly above the procedure, or disable it with a reason naming what it grows with. Only a top-level array counts, not one inside a returned object. Reads type information, through the TS layer's `project: true`, as `no-full-row-list-output` and `no-unguarded-rewrite` do (`type-information.ts`) |
| `no-distinct-on-subquery` | `module/src/**/*.ts`, tests excluded | Flag a `selectDistinctOn(...).as(...)` subquery and a ranking window `over (partition by …)` in a subquery, a CTE (`db.$with(...).as(query)`) counting as one, which Postgres reads in full on every call, and a top-level `selectDistinctOn` over a table its `historyTables` option lists (`eslint-rules/src/plugins/history-tables.ts`, which every `*History` table must join), a table, a window column or a `sql` fragment of the window held in a `const` included, and a table through `alias(...)`: read the latest row per key with a per-row lateral, or declare the bound with a `// bounded-by:` comment |
| `no-full-row-list-output` | `back/src/features/**/*-router.ts` | Flag a `.query()` whose output holds, anywhere (an array, a `pagedOutput`, a list in an object, a union or a list row, as a hand-paginated `{ items, total }` or a detail does), a list of `createSelectSchema(...)` rows with no `.pick(...)`, or of rows nesting one, followed through the `const` declarations in scope, aliases included: every column ships, one added later included. The walk fails closed: every schema method but `.pick` keeps the columns of its receiver and of any schema or `.shape` it is given, so an `.omit`, a `.safeExtend` or a `.refine` keeps a full row full, and a `.transform` that drops columns needs the marker. Pick the columns its readers use, the front and XTM One's OpenCRQ tools, or say why it ships them all with a `// full-row:` comment directly above the procedure. With type information, a query returning an array of objects that declares no `.output()` is flagged too |
| `no-implicit-index-nulls-order` | `module/src/**/schema.ts` | Require `.nullsFirst()` or `.nullsLast()` after `.desc()` in an index, a column held in a `const` included: `.desc()` alone emits `NULLS LAST`, which serves no `orderBy(desc(...))` |
| `no-unguarded-rewrite` | `module/src/modules/**/repository.ts` | Flag a write that rings the doorbell for rows that did not change: a batch upsert moving `updatedAt` with neither `setWhere` nor `updatedAtOnDataChange`, and a `delete` and an `insert` of one table on `db`, `tx` or `rawDb()` in one method that does not call `diffRows`, a callback (a `map`, a transaction) writing for the method passing it. A row passed as a variable is told from a batch by its type, and a config, a `set`, a table or a database handle held in a `const` is read through it |

To add an AST rule:
1. Create `eslint-rules/src/plugins/<rule>.ts` exporting a `{ meta, create }` object.
2. Register it in `eslint-rules/src/plugins/index.ts` under `appPlugin.rules`.
3. Wire it in `eslint.config.ts` under the relevant `files:` block (the block already sets `plugins: { app: appPlugin }`).
4. Add a `RuleTester`-based test `eslint-rules/src/plugins/<rule>.test.ts`.

## Root Config (`eslint.config.ts`)

The root config is an async IIFE that:
1. Discovers workspaces from `package.json`
2. Dynamically imports each workspace's `local.eslint.config.ts` if it exists
3. Returns `defineConfig([...])` with these layers (order matters):

| Layer | Files | What it does |
|---|---|---|
| Ignores | `dist/`, `build/`, `node_modules` | Global ignores |
| `.d.ts` blocker | `**/*.d.ts` | Forbids `.d.ts` files entirely |
| Main JS/TS | `**/*.{js,mjs,cjs,ts,tsx}` | Registers plugins (`@stylistic`, `@typescript-eslint`, `sort`, `import`, `node`, `check-file`), applies `javascriptRules + importRules + nodeRules + stylisticRules + fileFormat` |
| JS-only | `**/*.{js,mjs,cjs}` | Applies `javascriptOnlyRules` (rules that conflict with TS equivalents) |
| TS-only | `**/*.{ts,tsx}` | Enables `project: true` for type-aware linting, applies `typescriptRules` |
| No default exports | `**/*.{ts,tsx}` (except `*.config.ts`) | `import/no-default-export: error` |
| esbuild exception | `**/esbuild-plugins/**` | Allows `console` |
| Duplicate JSON keys | `renovate.json5` (`json/json5`), `**/tsconfig*.json` (`json/jsonc`, trailing commas allowed), `**/package.json`, `back/config/*.json`, `knip.json`, `.claude/settings.json`, `.github/sbom-manufacturer.json` (`json/json`) | `json/no-duplicate-keys` from `@eslint/json`. These are the configuration files written by hand: their readers (Renovate, tsc, Yarn, nconf, jq in the SBOM workflow) keep the last of two equal keys without a word, and none of them reports it. Generated and data JSON (the tRPC manifest, Drizzle snapshots, catalogs, model weights) stays out: a tool writes it, and parsing it costs time for nothing. Another hand-written JSON file joins the list by name, never by a broad glob. A workspace's local config that adds a preset with no `files` scopes it to JS/TS, or its rules run on these files too |
| Workspace locals | varies | Spreads `localEslintConfig` entries |

Both JavaScript layers name every extension they cover. An extension absent from them is still
visited by ESLint and enforces nothing, which passes silently rather than failing. Adding a file
type to the codebase therefore means adding it to both layers, or it is linted in name only.

## Frontend Local Config (`front/local.eslint.config.ts`)

Adds React, JSX, and Lingui rules on top of the root config:

- **Plugins**: `react`, `react-hooks`, `lingui`
- **Rules**: `linguiRules` (spread), JSX indent/quotes, hooks exhaustive-deps, `jsx-curly-brace-presence`, multi-line JSX props (`jsx-first-prop-new-line`, `jsx-max-props-per-line`), no `React.ReactNode` (use direct import), `no-restricted-syntax` selectors flagging a date, time or number formatted with no locale or with a bare `i18n.locale`, and every `toFixed` (`localeFormattingSelectors`, also run on `utils/src` from the root config), and a `no-restricted-imports` entry for the `DatePicker` of `@filigran/ui`, which formats with no locale
- **Overrides**:
  - `tailwind.config.ts` — allows CommonJS
  - `src/routes/**` — disables filename/folder naming conventions (TanStack Router uses `$param` and `_layout` patterns)
  - Test files — disables `lingui/no-unlocalized-strings`

## How to Add a New Rule

**Global rule** (applies to all workspaces):
1. Edit the appropriate file in `eslint-rules/src/rules/`
2. The barrel re-export and root config spread handle the rest
3. Run `yarn lint` to check for new violations, `yarn lint:fix` to autofix

**Frontend-only rule** (React/JSX/Lingui):
1. Add it directly in `front/local.eslint.config.ts` rules block
2. If it's a substantial set of rules, create a new file in `eslint-rules/src/rules/`, export it from `index.ts`, and import it in the local config

**New workspace local config**:
1. Create `<workspace>/local.eslint.config.ts` with `export default defineConfig([...])`
2. The root config auto-discovers it — no other changes needed

## Commands

```bash
yarn lint          # Check entire monorepo
yarn lint:fix      # Check + autofix entire monorepo
```

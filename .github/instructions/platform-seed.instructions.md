---
applyTo: "module/src/platform-seed/**"
description: 'Platform seed maintenance guidelines, testing workflow, and conventions for test data'
---

<!-- Generated from .agents/instructions/platform-seed.md by scripts/render-agent-files.mjs. Edit the source, not this file. -->

# Platform Seed

The platform seed (`module/src/platform-seed/`) creates realistic test data (users, tenants, organizations, roles, groups, assets, notifications) for manual e2e testing. It is **separate** from reference seeds (capabilities, countries, sectors) and is **optional** — triggered by a `platform_seed` config block.

**Configuration (env vars, JSON examples, secret-store integration) is documented in [`docs/deployment/configuration.md`](docs/deployment/configuration.md#platform-seed-non-production). Dev setup (`yarn seed:setup-dev`, `yarn seed:rollback-dev`) is in [`docs/development/development.md`](docs/development/development.md). This file covers only the seeder-authoring workflow.**

## Maintaining the seed

**When adding a new domain/feature**, you **must** add corresponding seed data:
1. Create `module/src/platform-seed/seeders/<feature>-seeder.ts`
2. Add stable UUIDs in `data/ids.ts`. A `seededRowId` generator owns its **group** — the fourth
   field of the identifier — and two generators sharing one write over each other's rows. Take a
   group no generator already uses; `ids.test.ts` names any pair that collides. A generator whose
   table grows with the profile's volume goes through `scrambledRowId`, never `seededRowId`: a
   sequential id gives every index and sort on it a locality no real tenant has, and benchmarks run
   on the seeded park read it as speed.
3. Call `registerPlatformSeed('<feature>', async (ctx) => { ... })`
4. Import it in `seeders/index.ts` at the correct position (order = execution order)
5. Extend `PlatformSeedState` in `platform-seed-registry.ts` if other seeders depend on the new data

**Date everything from `ctx.now`, never from `new Date()`.** It is the seed transaction's own clock,
read once: two seeders deriving a day from it agree, and the seed is the same for a given date, so a
CI failure replays locally. The one exception is a row that must come after what a service dated
from its own clock during the seed, as a CRQ run comes after its inputs. Every date the seed derives
must hold on any day of the year: a share of the calendar year squeezes to a few days in early
January.

**When modifying an existing schema** (adding/removing/renaming columns), update the corresponding seeder and data files to match the new schema. The seed must stay in sync with the current schema at all times.

**When removing a feature**, remove its seeder, clean up `data/ids.ts`, and remove the import from `seeders/index.ts`. Delete the corresponding constants/entries entirely — do **not** leave a comment block explaining what was removed or why; git history already records that.

**Adding or removing a data file**: every file under `data/` is named in `scripts/notice/registry.mjs`, as first-party data or under the third-party entry whose content it copies (ATT&CK names, CVE texts…). `yarn notice:check` fails on a data file added or removed without its entry; `yarn notice:build` then regenerates `NOTICE`.

## Testing the seed

An integration test verifies the seed works end-to-end: `integration-tests/src/tests/service/platform-seed.test.ts`. After any change to the seed, **always run this test**.

```bash
cd integration-tests && yarn test src/tests/service/platform-seed.test.ts
```

Run the **profile** tests too, not only the default one: a seeder the default profile never exercises
can be broken while every local check stays green, and CI is then the first thing to say so.

```bash
cd integration-tests && yarn test src/tests/service/platform-seed-large-estate.test.ts
```

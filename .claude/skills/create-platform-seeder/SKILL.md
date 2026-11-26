---
name: create-platform-seeder
description: >-
  Creates platform seed data for manual e2e testing. Adds a new seeder with
  stable UUIDs, registers it in the correct execution order, and validates
  with the platform seed integration test. Use when asked to add test/seed data.
---

# Create Platform Seeder

## Prerequisites

Gather:
- **Domain name** — which entity to seed
- **Data volume** — how many records per tenant (Acme + Tarnwick)
- **Relations** — which existing seeded entities to link to
- **Dependencies** — which seeders must run first (determines import order)

## Procedure

### Step 1 — Add stable UUIDs in `module/src/platform-seed/data/ids.ts`

```ts
// === <Domain> ===
export const MyEntity_One = '01234567-89ab-7cde-f012-34567890abcd';
export const MyEntity_Two = '01234567-89ab-7cde-f012-34567890abce';
// Use uuidv7() to generate these once, then hardcode them
```

**Naming convention:** `<Entity>_<Name>` (`Tenant_Acme`, `SupportingAsset_CoreBanking`), grouped by entity type with a comment header.

### Step 2 — Create the seeder file

Create `module/src/platform-seed/seeders/<domain>-seeder.ts`:

```ts
import { registerPlatformSeed } from '../platform-seed-registry';
import {
  Tenant_Acme, Tenant_Tarnwick,
  MyEntity_One, MyEntity_Two,
} from '../data/ids';

registerPlatformSeed('<domain>', async ({ db, services, state }) => {
  const acmeOrigin = { type: 'system' as const, userId: state.adminUserId, tenantId: Tenant_Acme };
  const tarnwickOrigin = { type: 'system' as const, userId: state.adminUserId, tenantId: Tenant_Tarnwick };

  // Seed Acme data
  await services.withOrigin(acmeOrigin).<domain>.create<Entity>({
    id: MyEntity_One,
    name: 'Acme Entity 1',
  });

  // Seed Tarnwick data
  await services.withOrigin(tarnwickOrigin).<domain>.create<Entity>({
    id: MyEntity_Two,
    name: 'Tarnwick Entity 1',
  });
});
```

**Key patterns:**
- Use `registerPlatformSeed(name, fn)` — self-registering
- Use `services.withOrigin(origin)` for all writes (respects security policies)
- Reference IDs from `data/ids.ts` (stable, deterministic)
- Seed data for both tenants (Acme + Tarnwick)

### Step 3 — Register in `module/src/platform-seed/seeders/index.ts`

Add the import at the correct position. **Import order = execution order.**

```ts
import './users-seeder';
import './tenants-seeder';
import './roles-seeder';
import './groups-seeder';
import './organizations-seeder';
import './service-accounts-seeder';
import './integration-settings-seeder';
import './framework-assessments-seeder';
import './primary-assets-seeder';
import './supporting-assets-seeder';
import './<domain>-seeder';        // <-- Add here (after its dependencies)
import './risk-scenarios-seeder';
import './scenario-loss-estimates-seeder';
import './notifications-seeder';
```

> The list above is an excerpt — read the real file for the current, full order.
> Closed reference catalogs (attack outcomes, loss categories, loss drivers, business-value
> categories, countries) are **not** platform seeders: they are provisioned per tenant by the
> tenant seed registry (`module/src/modules/loss-drivers/seeder.ts` and friends) and
> cannot be extended from `platform-seed/`.

### Step 4 — Extend `PlatformSeedState` (if other seeders depend on this data)

In `module/src/platform-seed/platform-seed-registry.ts`, add fields to `PlatformSeedState` if downstream seeders need references:

```ts
export interface PlatformSeedState {
  adminEmail: string;
  adminPassword: string;
  adminUserId: string;
  // Add new fields if needed. Name them after what they hold, and key any
  // per-tenant map by the tenant id constant from `data/ids.ts`:
  myEntityIds: Record<string, string[]>;
}
```

### Step 5 — Run the platform seed test

```bash
cd integration-tests && yarn test src/tests/service/platform-seed.test.ts
```

This test runs the full seed pipeline end-to-end and verifies all seeders execute without errors.

### Step 6 — Verify manually (optional)

Bootstrap the seed in your local dev environment, then run the backend:

```bash
cd back && yarn seed:setup-dev   # interactive: prompts email + password
cd back && yarn dev
```

Check the seeded data in the UI or via the PostgreSQL MCP server. Full configuration options (the seeded users' XTM One password, the XTM One administrator the seed creates them with, env-var equivalents for online test platforms) are documented in [`docs/development/development.md`](../../../docs/development/development.md#platform-seed).

## Rules

- **Always use stable UUIDs** from `data/ids.ts` — never generate random IDs at seed time
- **Seed both tenants** (Acme + Tarnwick) unless the entity is tenant-independent
- **Import order in `seeders/index.ts` matters** — it determines execution order
- **Use `services.withOrigin()`** — don't insert directly into DB tables (security policies won't be tested)
- **Keep seed data realistic** — use meaningful names, descriptions, and relationships
- **Run the platform seed test** after every change — it's the single source of truth for seed correctness
- **Register a new or removed data file** in `scripts/notice/registry.mjs`: every file under `data/` is named in `scripts/notice/registry.mjs`, as first-party data or under the third-party entry whose content it copies (ATT&CK names, CVE texts…). `yarn notice:check` fails on a data file added or removed without its entry; `yarn notice:build` then regenerates `NOTICE`.

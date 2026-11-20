import type { EventOrigin } from '@app/module';
import { buildCountryRows, countries as countriesTable, seedCountries } from '@app/module';
import { eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('Countries Service', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;
  let adminUserId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
    adminUserId = setup.userId;
  });

  it('should provision the full OpenCTI country set, scoped to the tenant', async () => {
    const countries = await services.withOrigin(adminOrigin).countries.getCountries();
    expect(countries.length).toBe(buildCountryRows(tenantId).length);
    for (const country of countries) {
      expect(country.tenantId).toBe(tenantId);
    }
  });

  it('should return a country by id', async () => {
    const countries = await services.withOrigin(adminOrigin).countries.getCountries();
    const first = countries[0];

    const country = countries.find((c) => c.id === first.id);
    expect(country).toBeTruthy();
    expect(country!.id).toBe(first.id);
    expect(country!.name).toBe(first.name);
  });

  it('should return undefined for non-existent country', async () => {
    const countries = await services.withOrigin(adminOrigin).countries.getCountries();
    const country = countries.find((c) => c.id === '00000000-0000-0000-0000-000000000000');
    expect(country).toBeUndefined();
  });

  it('should expose iso codes for a known country', async () => {
    // France is a well-known seeded country.
    const countries = await services.withOrigin(adminOrigin).countries.getCountries();
    const france = countries.find((c) => c.isoAlpha2 === 'FR');
    expect(france).toBeTruthy();
    expect(france!.isoAlpha3).toBe('FRA');
    expect(france!.name).toBe('France');
  });

  it('should re-seed only diverged rows — restore stale data, leave unchanged rows untouched', async () => {
    const list = await services.withOrigin(adminOrigin).countries.getCountries();
    const france = list.find((c) => c.isoAlpha3 === 'FRA');
    expect(france).toBeTruthy();

    // xmin (the row version) changes only when Postgres actually rewrites the row.
    const rowVersion = async (): Promise<string> => {
      const r = await db.execute(sql`SELECT xmin::text AS v FROM countries WHERE id = ${france!.id}`);
      return String(r.rows[0].v);
    };

    // Nothing diverged, so the boot seed must not rewrite the row.
    const versionUnchanged = await rowVersion();
    await seedCountries(db);
    expect(await rowVersion()).toBe(versionUnchanged);

    // Stale row → the boot seed rewrites just this row and restores the vendored value.
    await db.update(countriesTable).set({ name: 'Stale Name' }).where(eq(countriesTable.id, france!.id));
    const before = await services.withOrigin(adminOrigin).countries.getCountries();
    expect(before.find((c) => c.isoAlpha3 === 'FRA')!.name).toBe('Stale Name');
    const versionStale = await rowVersion();
    await seedCountries(db);
    expect(await rowVersion()).not.toBe(versionStale);

    const after = await services.withOrigin(adminOrigin).countries.getCountries();
    expect(after.find((c) => c.isoAlpha3 === 'FRA')!.name).toBe('France');
  });

  it('should realign a country row minted under a past derivation, without dropping the organizations that point at it', async () => {
    const organizationId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: organizationId, name: 'Test Organization' }]);

    const list = await services.withOrigin(adminOrigin).countries.getCountries();
    const france = list.find((c) => c.isoAlpha3 === 'FRA')!;
    await services.withOrigin(adminOrigin).organizations.updateOrganization(organizationId, { countryId: france.id });

    // Stand in for a row provisioned before the catalog carried its own UUID: same natural key,
    // an id no derivation would produce today.
    const legacyId = uuidv7();
    await db.update(countriesTable).set({ id: legacyId }).where(eq(countriesTable.id, france.id));

    await seedCountries(db);

    const after = await services.withOrigin(adminOrigin).countries.getCountries();
    expect(after.length).toBe(list.length);
    expect(after.find((c) => c.isoAlpha3 === 'FRA')!.id).toBe(france.id);

    const organizations = await services.withOrigin(adminOrigin).organizations.getOrganizations();
    expect(organizations.find((o) => o.id === organizationId)!.countryId).toBe(france.id);
  });

  describe('tenant isolation', () => {
    let tenantBOrigin: EventOrigin;
    let tenantBId: string;

    beforeEach(async () => {
      tenantBId = await createTenant(services, adminUserId);
      tenantBOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };
    });

    it('should scope countries per tenant with non-overlapping ids', async () => {
      const tenantACountries = await services.withOrigin(adminOrigin).countries.getCountries();
      const tenantBCountries = await services.withOrigin(tenantBOrigin).countries.getCountries();
      expect(tenantACountries.length).toBe(tenantBCountries.length);

      // Per-tenant deterministic ids: a tenant never sees another tenant's rows
      const tenantAIds = new Set(tenantACountries.map((c) => c.id));
      expect(tenantBCountries.some((c) => tenantAIds.has(c.id))).toBe(false);
      for (const country of tenantBCountries) {
        expect(country.tenantId).toBe(tenantBId);
      }
    });
  });
});

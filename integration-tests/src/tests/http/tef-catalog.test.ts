import { currentTefCatalogueRef } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createUser } from '../../helpers/factories';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { setTestEdition } from '../../setup/create-test-app';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAs, signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

describe('Open-data TEF catalogue (HTTP/tRPC)', () => {
  let client: ReturnType<typeof createTrpcTestClient>;
  const services = createTestServices(db);
  let adminId: string;
  let tenantId: string;

  const logInAsMemberOfAnotherTenant = async () => {
    const outsider = await createUser(db);
    const otherTenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: otherTenantId, name: 'Other tenant' }, adminId);
    await services.withOrigin({ type: 'client', userId: adminId, tenantId: otherTenantId })
      .tenants.addTenantUser(otherTenantId, outsider.userId);
    client.clearCookies();
    await signInAs(client, outsider.userId);
  };

  beforeEach(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    setTestEdition('ee');
    client = createTrpcTestClient(server);

    adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });
    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: tenantId, name: 'Tenant' }, adminId);
  });

  it('should serve a member the catalogue with its publisher and its source', async () => {
    const res = await client.query('crqIndicators.getTefCatalog', undefined, { tenantId });

    expect(res.status).toBe(200);
    const catalog: { id: string, version: string, builtOn: string, publisher: string, outcomes: Array<unknown>, sources: Array<{ title: string }> } = res.json.result.data;
    expect({ id: catalog.id, version: catalog.version }).toEqual(currentTefCatalogueRef());
    expect(catalog.builtOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(catalog.outcomes).toHaveLength(7);
    expect({ publisher: catalog.publisher, sources: catalog.sources.map((source) => source.title) }).toEqual({ publisher: 'Filigran', sources: ['Filigran Intelligence'] });
  });

  it('should serve a member the read of every outcome for a profile', async () => {
    const res = await client.query('crqIndicators.getTefCatalogReading', { countryId: null, sectorId: null, employeeCount: 120, revenueBand: null }, { tenantId });

    expect(res.status).toBe(200);
    const reading: { outcomes: Array<{ read: { sizeSource: string, sizeClasses: Array<{ sizeClass: string }> } }> } = res.json.result.data;
    expect(reading.outcomes).toHaveLength(7);
    expect(reading.outcomes.every(({ read }) => read.sizeSource === 'employee_count' && read.sizeClasses[0]?.sizeClass === '50-249')).toBe(true);
  });

  it('should refuse a profile with a negative employee count', async () => {
    const res = await client.query('crqIndicators.getTefCatalogReading', { countryId: null, sectorId: null, employeeCount: -1, revenueBand: null }, { tenantId });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should serve every risk scope its own reading, the one its profile reads on its own', async () => {
    const adminOrigin = { type: 'client', userId: adminId, tenantId } as const;
    const countries = await services.withOrigin(adminOrigin).countries.getCountries();
    const franceId = countries.find((country) => country.isoAlpha3 === 'FRA')!.id;
    const [withHeadcount, unset] = [uuidv7(), uuidv7()];
    await services.withOrigin(adminOrigin).organizations.createOrganizations([
      { id: withHeadcount, name: 'With headcount', countryId: franceId, employeeCount: 120 },
      { id: unset, name: 'Unset' },
    ]);

    const res = await client.query('crqIndicators.getTefCatalogScopeReadings', undefined, { tenantId });
    const alone = await client.query('crqIndicators.getTefCatalogReading', { countryId: franceId, sectorId: null, employeeCount: 120, revenueBand: null }, { tenantId });

    expect(res.status).toBe(200);
    const readings: Array<{ organizationId: string, total: unknown, outcomes: Array<{ read: { sizeSource: string } }> }> = res.json.result.data;
    const byScope = new Map(readings.map((reading) => [reading.organizationId, reading]));
    expect(byScope.get(withHeadcount)).toEqual({ organizationId: withHeadcount, ...alone.json.result.data });
    expect(byScope.get(unset)?.outcomes.every(({ read }) => read.sizeSource === 'none')).toBe(true);
  });

  it.each([
    ['country', { countryId: uuidv7(), sectorId: null }],
    ['sector', { countryId: null, sectorId: uuidv7() }],
  ])('should answer a profile naming an unknown %s as not found rather than read it for every one', async (field, ids) => {
    const res = await client.query('crqIndicators.getTefCatalogReading', { ...ids, employeeCount: 120, revenueBand: null }, { tenantId });

    expect(res.json.error.data.code).toBe('NOT_FOUND');
    expect(res.json.error.message).toBe(`The TEF catalogue profile names an unknown ${field}`);
  });

  it('should serve a member of another tenant none of this tenant\'s rows', async () => {
    await services.withOrigin({ type: 'client', userId: adminId, tenantId }).organizations.createOrganizations([{ id: uuidv7(), name: 'Scope' }]);
    await logInAsMemberOfAnotherTenant();

    const catalog = await client.query('crqIndicators.getTefCatalog', undefined, { tenantId });
    const reading = await client.query('crqIndicators.getTefCatalogReading', { countryId: null, sectorId: null, employeeCount: null, revenueBand: null }, { tenantId });

    const scopes = await client.query('crqIndicators.getTefCatalogScopeReadings', undefined, { tenantId });

    expect(catalog.json.result.data).toMatchObject({ outcomes: [], sectors: [], countries: [] });
    expect(reading.json.result.data).toEqual({ outcomes: [], total: { low: 0, likely: 0, high: 0 } });
    expect(scopes.json.result.data).toEqual([]);
  });

  it('should refuse a call that names no tenant', async () => {
    const res = await client.query('crqIndicators.getTefCatalog');

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });
});

import type { EventOrigin } from '@app/module';
import { organizations } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantUser, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('Organizations Service', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    tenantId = setup.tenantId;
  });

  it('should create organizations in a tenant', async () => {
    const orgId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([
      { id: orgId, name: 'Acme Corp' },
    ]);

    const orgs = await services.withOrigin(adminOrigin).organizations.getOrganizations();
    expect(orgs).toHaveLength(1);
    expect(orgs[0].name).toBe('Acme Corp');
    expect(orgs[0].tenantId).toBe(tenantId);
  });

  it('should create multiple organizations at once', async () => {
    await services.withOrigin(adminOrigin).organizations.createOrganizations([
      { id: uuidv7(), name: 'Org 1' },
      { id: uuidv7(), name: 'Org 2' },
      { id: uuidv7(), name: 'Org 3' },
    ]);

    const orgs = await services.withOrigin(adminOrigin).organizations.getOrganizations();
    expect(orgs).toHaveLength(3);
  });

  it('should create an organization with its whole field set in one write', async () => {
    const orgId = uuidv7();
    const sectors = await services.withOrigin(adminOrigin).sectors.getSectors();
    const countries = await services.withOrigin(adminOrigin).countries.getCountries();
    const sector = sectors[0];
    const country = countries.find((c) => c.isoAlpha2 === 'FR')!;

    await services.withOrigin(adminOrigin).organizations.createOrganizations([{
      id: orgId,
      name: 'Acme Retail',
      description: 'Retail arm',
      legalEntityName: 'Acme Retail SAS',
      sectorId: sector.id,
      countryId: country.id,
      revenueBand: '100m_1b',
      employeeCount: 500,
      domain: 'acme-retail.example',
      reactionTimeMin: 0.5,
      reactionTimeLikely: 8,
      reactionTimeMax: 96,
    }]);

    const org = await services.withOrigin(adminOrigin).organizations.getOrganization(orgId);
    expect(org!.name).toBe('Acme Retail');
    expect(org!.description).toBe('Retail arm');
    expect(org!.legalEntityName).toBe('Acme Retail SAS');
    expect(org!.sectorId).toBe(sector.id);
    expect(org!.countryId).toBe(country.id);
    expect(org!.revenueBand).toBe('100m_1b');
    expect(org!.employeeCount).toBe(500);
    expect(org!.domain).toBe('acme-retail.example');
    expect(org!.reactionTimeMin).toBe(0.5);
    expect(org!.reactionTimeLikely).toBe(8);
    expect(org!.reactionTimeMax).toBe(96);
  });

  it('should get a single organization by id', async () => {
    const orgId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([
      { id: orgId, name: 'Specific Org' },
    ]);

    const org = await services.withOrigin(adminOrigin).organizations.getOrganization(orgId);
    expect(org).toBeTruthy();
    expect(org!.id).toBe(orgId);
    expect(org!.name).toBe('Specific Org');
  });

  it('should return undefined for non-existent organization', async () => {
    const org = await services.withOrigin(adminOrigin).organizations.getOrganization(uuidv7());
    expect(org).toBeUndefined();
  });

  it('should delete organizations', async () => {
    const orgId1 = uuidv7();
    const orgId2 = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([
      { id: orgId1, name: 'To Delete 1' },
      { id: orgId2, name: 'To Keep' },
    ]);

    await services.withOrigin(adminOrigin).organizations.deleteOrganizations([orgId1]);

    const orgs = await services.withOrigin(adminOrigin).organizations.getOrganizations();
    expect(orgs).toHaveLength(1);
    expect(orgs[0].id).toBe(orgId2);
  });

  it('should reject creating organizations without tenant context', async () => {
    const authOrigin: EventOrigin = { type: 'auth' };
    await expect(
      services.withOrigin(authOrigin).organizations.createOrganizations([
        { id: uuidv7(), name: 'No Tenant' },
      ]),
    ).rejects.toThrow('Tenant context required');
  });

  it('should allow tenant users to see organizations', async () => {
    const orgId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([
      { id: orgId, name: 'Shared Org' },
    ]);

    // Create a regular user in the same tenant
    const tenantUser = await createTenantUser(services, db, adminOrigin);

    const orgs = await services.withOrigin(tenantUser.origin).organizations.getOrganizations();
    expect(orgs).toHaveLength(1);
    expect(orgs[0].id).toBe(orgId);
  });

  it('should update an organization', async () => {
    const orgId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([
      { id: orgId, name: 'Before Update' },
    ]);

    await services.withOrigin(adminOrigin).organizations.updateOrganization(orgId, {
      name: 'After Update',
      description: 'Updated description',
      legalEntityName: 'Legal Entity LLC',
      domain: 'example.com',
      employeeCount: 500,
      revenueBand: '100m_1b',
    });

    const org = await services.withOrigin(adminOrigin).organizations.getOrganization(orgId);
    expect(org!.name).toBe('After Update');
    expect(org!.description).toBe('Updated description');
    expect(org!.legalEntityName).toBe('Legal Entity LLC');
    expect(org!.domain).toBe('example.com');
    expect(org!.employeeCount).toBe(500);
    expect(org!.revenueBand).toBe('100m_1b');
  });

  it('should round-trip a reaction time triplet', async () => {
    const orgId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([
      { id: orgId, name: 'With reaction time' },
    ]);

    await services.withOrigin(adminOrigin).organizations.updateOrganization(orgId, {
      reactionTimeMin: 0.5,
      reactionTimeLikely: 8,
      reactionTimeMax: 96,
    });

    const org = await services.withOrigin(adminOrigin).organizations.getOrganization(orgId);
    expect(org!.reactionTimeMin).toBe(0.5);
    expect(org!.reactionTimeLikely).toBe(8);
    expect(org!.reactionTimeMax).toBe(96);
  });

  it('should return a null reaction time triplet when not set', async () => {
    const orgId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([
      { id: orgId, name: 'No reaction time' },
    ]);

    const org = await services.withOrigin(adminOrigin).organizations.getOrganization(orgId);
    expect(org!.revenueBand).toBeNull();
    expect(org!.reactionTimeMin).toBeNull();
    expect(org!.reactionTimeLikely).toBeNull();
    expect(org!.reactionTimeMax).toBeNull();
  });

  it('should update organization with sector and country', async () => {
    const orgId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([
      { id: orgId, name: 'Org with refs' },
    ]);

    // Get a known sector and country from seeded data
    const sectors = await services.withOrigin(adminOrigin).sectors.getSectors();
    const countries = await services.withOrigin(adminOrigin).countries.getCountries();
    const sector = sectors[0];
    const country = countries.find((c) => c.isoAlpha2 === 'FR')!;

    await services.withOrigin(adminOrigin).organizations.updateOrganization(orgId, {
      sectorId: sector.id,
      countryId: country.id,
    });

    const org = await services.withOrigin(adminOrigin).organizations.getOrganization(orgId);
    expect(org!.sectorId).toBe(sector.id);
    expect(org!.countryId).toBe(country.id);
    expect(org!.sector).toBeTruthy();
    expect(org!.sector!.name).toBe(sector.name);
    expect(org!.country).toBeTruthy();
    expect(org!.country!.name).toBe('France');
  });

  it('should return null sector and country when not set', async () => {
    const orgId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([
      { id: orgId, name: 'No refs' },
    ]);

    const org = await services.withOrigin(adminOrigin).organizations.getOrganization(orgId);
    expect(org!.sectorId).toBeNull();
    expect(org!.countryId).toBeNull();
    expect(org!.sector).toBeNull();
    expect(org!.country).toBeNull();
  });

  describe('another tenant\'s sector or country', () => {
    const FOREIGN_KEY_VIOLATION = '23503';
    let foreignSectorId: string;
    let foreignCountryId: string;

    beforeEach(async () => {
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: await createTenant(services, adminUserId) };
      foreignSectorId = (await services.withOrigin(otherOrigin).sectors.getSectors())[0].id;
      foreignCountryId = (await services.withOrigin(otherOrigin).countries.getCountries())[0].id;
    });

    it('should refuse to create a scope in another tenant\'s sector or country, as in an unknown one', async () => {
      const create = (values: { sectorId?: string, countryId?: string }) =>
        services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: uuidv7(), name: 'Scope', ...values }]);

      await expect(create({ sectorId: foreignSectorId })).rejects.toThrow('Sector not found');
      await expect(create({ countryId: foreignCountryId })).rejects.toThrow('Country not found');
      await expect(create({ countryId: uuidv7() })).rejects.toThrow('Country not found');
      expect(await services.withOrigin(adminOrigin).organizations.getOrganizations()).toHaveLength(0);
    });

    it('should refuse a batch where one scope names its own sector and another a foreign one', async () => {
      const ownSectorId = (await services.withOrigin(adminOrigin).sectors.getSectors())[0].id;

      await expect(services.withOrigin(adminOrigin).organizations.createOrganizations([
        { id: uuidv7(), name: 'Own', sectorId: ownSectorId },
        { id: uuidv7(), name: 'Foreign', sectorId: foreignSectorId },
      ])).rejects.toThrow('Sector not found');
      expect(await services.withOrigin(adminOrigin).organizations.getOrganizations()).toHaveLength(0);
    });

    it('should refuse to move a scope to another tenant\'s sector or country', async () => {
      const orgId = uuidv7();
      await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: orgId, name: 'Scope' }]);

      await expect(services.withOrigin(adminOrigin).organizations.updateOrganization(orgId, { sectorId: foreignSectorId }))
        .rejects.toThrow('Sector not found');
      await expect(services.withOrigin(adminOrigin).organizations.updateOrganization(orgId, { countryId: foreignCountryId }))
        .rejects.toThrow('Country not found');
      const org = await services.withOrigin(adminOrigin).organizations.getOrganization(orgId);
      expect(org!.sectorId).toBeNull();
      expect(org!.countryId).toBeNull();
    });

    it('should refuse in the database a scope naming another tenant\'s sector or country', async () => {
      await expect(db.insert(organizations).values({ id: uuidv7(), tenantId, name: 'Scope', sectorId: foreignSectorId }))
        .rejects.toMatchObject({ cause: { code: FOREIGN_KEY_VIOLATION, constraint: 'organizations_sector_tenant_fk' } });
      await expect(db.insert(organizations).values({ id: uuidv7(), tenantId, name: 'Scope', countryId: foreignCountryId }))
        .rejects.toMatchObject({ cause: { code: FOREIGN_KEY_VIOLATION, constraint: 'organizations_country_tenant_fk' } });
    });
  });
});

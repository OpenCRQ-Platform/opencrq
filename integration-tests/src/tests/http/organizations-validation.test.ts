import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

describe('Organizations Validation (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let adminId: string;
  let tenantId: string;
  let organizationId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);

    adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: tenantId, name: 'Tenant' }, adminId);

    organizationId = uuidv7();
    await services.withOrigin({ type: 'client', userId: adminId, tenantId })
      .organizations.createOrganizations([{ id: organizationId, name: 'Org' }]);
  });

  const update = (values: Record<string, unknown>) => client.mutation(
    'organizations.updateOrganization',
    { id: organizationId, ...values },
    { tenantId },
  );

  const create = (values: Record<string, unknown>) => client.mutation(
    'organizations.createOrganizationsTransaction',
    [{ id: uuidv7(), name: 'Created Org', ...values }],
    { tenantId },
  );

  it('should reject an empty name on create', async () => {
    const res = await client.mutation(
      'organizations.createOrganizationsTransaction',
      [{ id: uuidv7(), name: '' }],
      { tenantId },
    );

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should reject a whitespace-only name on create', async () => {
    const res = await client.mutation(
      'organizations.createOrganizationsTransaction',
      [{ id: uuidv7(), name: '   ' }],
      { tenantId },
    );

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should trim the name it stores', async () => {
    const id = uuidv7();
    const res = await client.mutation(
      'organizations.createOrganizationsTransaction',
      [{ id, name: '  Padded Org  ' }],
      { tenantId },
    );
    expect(res.status).toBe(200);

    const read = await client.query('organizations.getOrganization', { id }, { tenantId });
    expect(read.json.result.data.name).toBe('Padded Org');
  });

  it('should reject a partially filled reaction time triplet on create', async () => {
    const res = await create({ reactionTimeMin: 1, reactionTimeLikely: 5 });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should reject a mis-ordered reaction time triplet on create', async () => {
    const res = await create({ reactionTimeMin: 10, reactionTimeLikely: 5, reactionTimeMax: 20 });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should accept a full valid reaction time triplet on create', async () => {
    const id = uuidv7();
    const res = await client.mutation(
      'organizations.createOrganizationsTransaction',
      [{ id, name: 'Guided Org', reactionTimeMin: 1, reactionTimeLikely: 8, reactionTimeMax: 96 }],
      { tenantId },
    );
    expect(res.status).toBe(200);

    const read = await client.query('organizations.getOrganization', { id }, { tenantId });
    expect(read.json.result.data.reactionTimeMin).toBe(1);
    expect(read.json.result.data.reactionTimeMax).toBe(96);
  });

  it('should reject an unknown revenue band on create', async () => {
    const res = await create({ revenueBand: 'gigantic' });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should reject a negative employee count', async () => {
    const res = await update({ employeeCount: -1 });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
    expect(res.json.error.data.zodError).not.toBeNull();
  });

  it('should reject a non-integer employee count', async () => {
    const res = await update({ employeeCount: 12.5 });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should reject an unknown revenue band', async () => {
    const res = await update({ revenueBand: 'gigantic' });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should reject a zero most-likely reaction time', async () => {
    const res = await update({ reactionTimeMin: 0, reactionTimeLikely: 0, reactionTimeMax: 0 });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should reject a most-likely reaction time below the min', async () => {
    const res = await update({ reactionTimeMin: 10, reactionTimeLikely: 5, reactionTimeMax: 20 });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should reject a max reaction time below the most-likely', async () => {
    const res = await update({ reactionTimeMin: 1, reactionTimeLikely: 10, reactionTimeMax: 5 });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should reject a partially filled reaction time triplet', async () => {
    const res = await update({ reactionTimeMin: 1, reactionTimeLikely: 5, reactionTimeMax: null });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should accept a zero minimum reaction time', async () => {
    const res = await update({ reactionTimeMin: 0, reactionTimeLikely: 8, reactionTimeMax: 96 });
    expect(res.status).toBe(200);

    const read = await client.query('organizations.getOrganization', { id: organizationId }, { tenantId });
    expect(read.json.result.data.reactionTimeMin).toBe(0);
    expect(read.json.result.data.reactionTimeLikely).toBe(8);
    expect(read.json.result.data.reactionTimeMax).toBe(96);
  });

  it('should accept a fully null reaction time triplet and a valid revenue band', async () => {
    const res = await update({
      revenueBand: '1b_10b',
      reactionTimeMin: null,
      reactionTimeLikely: null,
      reactionTimeMax: null,
    });
    expect(res.status).toBe(200);

    const read = await client.query('organizations.getOrganization', { id: organizationId }, { tenantId });
    expect(read.json.result.data.revenueBand).toBe('1b_10b');
    expect(read.json.result.data.reactionTimeMin).toBeNull();
  });

  describe('another tenant\'s sector or an unknown country', () => {
    let foreignSectorId: string;

    beforeEach(async () => {
      const otherTenantId = uuidv7();
      await services.withOrigin({ type: 'platform', userId: adminId })
        .tenants.createTenant({ id: otherTenantId, name: 'Other Tenant' }, adminId);
      foreignSectorId = (await services.withOrigin({ type: 'client', userId: adminId, tenantId: otherTenantId })
        .sectors.getSectors())[0].id;
    });

    it('should answer not found on create, not a server error', async () => {
      const sector = await create({ sectorId: foreignSectorId });
      const country = await create({ countryId: uuidv7() });

      expect(sector.json.error).toMatchObject({ message: 'Sector not found', data: { code: 'NOT_FOUND' } });
      expect(country.json.error).toMatchObject({ message: 'Country not found', data: { code: 'NOT_FOUND' } });
    });

    it('should answer not found on update, not a server error', async () => {
      const sector = await update({ sectorId: foreignSectorId });
      const country = await update({ countryId: uuidv7() });

      expect(sector.json.error).toMatchObject({ message: 'Sector not found', data: { code: 'NOT_FOUND' } });
      expect(country.json.error).toMatchObject({ message: 'Country not found', data: { code: 'NOT_FOUND' } });
    });
  });
});

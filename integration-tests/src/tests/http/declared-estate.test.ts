import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { signInAsFirstAdmin } from '../../helpers/sign-in';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';

describe('Declared estate (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let tenantId: string;
  let organizationId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    client = createTrpcTestClient(await getTestServer());
    const adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: 'admin@test.com' });
    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId }).tenants.createTenant({ id: tenantId, name: 'Tenant' }, adminId);
    organizationId = uuidv7();
    await services.withOrigin({ type: 'client', userId: adminId, tenantId }).organizations.createOrganizations([{ id: organizationId, name: 'Scope' }]);
  });

  const save = async (answers: Array<unknown>) =>
    await client.mutation('declaredEstate.save', { organizationId, answers }, { tenantId });

  it('should save one kind and read every kind back, an unanswered one as null rather than undefined', async () => {
    expect((await save([{ kind: 'servers', bounds: { low: 180, high: 180 }, internetFacing: true }])).status).toBe(200);

    const read = await client.query('declaredEstate.get', { organizationId }, { tenantId });
    expect(read.json.result.data).toHaveLength(12);
    expect(read.json.result.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'servers', bounds: { low: 180, high: 180 }, internetFacing: true }),
      expect.objectContaining({ kind: 'people', bounds: null, internetFacing: null }),
    ]));
  });

  it.each([
    ['a low bound above the high one', { kind: 'servers', bounds: { low: 50, high: 10 }, internetFacing: null }],
    ['a negative count', { kind: 'servers', bounds: { low: -1, high: 10 }, internetFacing: null }],
    ['an exposure on a kind never asked about it', { kind: 'people', bounds: { low: 1, high: 10 }, internetFacing: true }],
    ['an exposure on no asset', { kind: 'servers', bounds: { low: 0, high: 0 }, internetFacing: true }],
    ['an unknown kind', { kind: 'printers', bounds: { low: 1, high: 1 }, internetFacing: null }],
  ])('should refuse %s with BAD_REQUEST', async (_label, entry) => {
    const res = await save([entry]);

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should refuse a kind answered twice in one save', async () => {
    const entry = { kind: 'servers', bounds: { low: 1, high: 10 }, internetFacing: null };

    expect((await save([entry, entry])).json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should answer NOT_FOUND for a scope that does not exist', async () => {
    const res = await client.mutation('declaredEstate.save', {
      organizationId: uuidv7(),
      answers: [{ kind: 'servers', bounds: { low: 1, high: 10 }, internetFacing: null }],
    }, { tenantId });

    expect(res.json.error.data.code).toBe('NOT_FOUND');
  });

  it('should compare every kind, with no date and a null bound rather than undefined before any save', async () => {
    const res = await client.query('declaredEstate.comparison', { organizationId }, { tenantId });

    expect(res.json.result.data).toMatchObject({ declaredAt: null });
    expect(res.json.result.data.kinds).toHaveLength(12);
    expect(res.json.result.data.kinds[0]).toEqual({ kind: 'workstations', bounds: null, measured: 0, state: 'not_declared' });
  });

  it('should answer NOT_FOUND when comparing a scope that does not exist', async () => {
    const res = await client.query('declaredEstate.comparison', { organizationId: uuidv7() }, { tenantId });

    expect(res.json.error.data.code).toBe('NOT_FOUND');
  });

  it('should refuse a call without a tenant', async () => {
    const res = await client.query('declaredEstate.get', { organizationId });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });
});

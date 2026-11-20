import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

describe('CRQ indicator settings (HTTP/tRPC)', () => {
  let client: ReturnType<typeof createTrpcTestClient>;
  const services = createTestServices(db);

  let tenantId: string;
  let adminId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);

    adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: tenantId, name: 'CRQ Settings Tenant' }, adminId);
  });

  it('should count an unknown criticality as low on a tenant that never set it', async () => {
    const res = await client.query('crqIndicatorSettings.getCrqIndicatorSettings', undefined, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data.unknownCriticalityCountsAs).toBe('low');
  });

  it('should refuse unknown as the band an unknown criticality counts as', async () => {
    const res = await client.mutation('crqIndicatorSettings.updateCrqIndicatorSettings', { unknownCriticalityCountsAs: 'unknown' }, { tenantId });

    expect(res.status).toBe(400);
  });

  it('should keep the band the tenant chose', async () => {
    const update = await client.mutation('crqIndicatorSettings.updateCrqIndicatorSettings', { unknownCriticalityCountsAs: 'high' }, { tenantId });
    expect(update.status).toBe(200);

    const res = await client.query('crqIndicatorSettings.getCrqIndicatorSettings', undefined, { tenantId });
    expect(res.json.result.data.unknownCriticalityCountsAs).toBe('high');
  });

  it('should count an unknown exposure as internal on a tenant that never set it', async () => {
    const res = await client.query('crqIndicatorSettings.getCrqIndicatorSettings', undefined, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data.unknownExposureCountsAs).toBe('internal');
  });

  it('should refuse unknown as the exposure an unknown exposure counts as', async () => {
    const res = await client.mutation('crqIndicatorSettings.updateCrqIndicatorSettings', { unknownExposureCountsAs: 'unknown' }, { tenantId });

    expect(res.status).toBe(400);
  });

  it('should keep the exposure the tenant chose', async () => {
    const update = await client.mutation('crqIndicatorSettings.updateCrqIndicatorSettings', { unknownExposureCountsAs: 'internet_facing' }, { tenantId });
    expect(update.status).toBe(200);

    const res = await client.query('crqIndicatorSettings.getCrqIndicatorSettings', undefined, { tenantId });
    expect(res.json.result.data.unknownExposureCountsAs).toBe('internet_facing');
  });

  describe('phishing simulation declaration', () => {
    const DECLARED = { phishingFailureRate: 0.12, phishingFailureMeasuredOn: '2026-09-01' };

    const read = async (inTenant: string = tenantId) =>
      (await client.query('crqIndicatorSettings.getCrqIndicatorSettings', undefined, { tenantId: inTenant })).json.result.data;

    it('should carry no declaration on a tenant that never made one', async () => {
      const res = await client.query('crqIndicatorSettings.getCrqIndicatorSettings', undefined, { tenantId });

      expect(res.status).toBe(200);
      expect(res.json.result.data).toMatchObject({ phishingFailureRate: null, phishingFailureMeasuredOn: null });
    });

    it('should keep the rate and the day the tenant declared', async () => {
      const update = await client.mutation('crqIndicatorSettings.updateCrqIndicatorSettings', DECLARED, { tenantId });
      expect(update.status).toBe(200);

      expect(await read()).toMatchObject(DECLARED);
    });

    it('should keep a rate of zero, which is a declaration and not an absence of one', async () => {
      await client.mutation('crqIndicatorSettings.updateCrqIndicatorSettings', { phishingFailureRate: 0, phishingFailureMeasuredOn: '2026-09-01' }, { tenantId });

      expect(await read()).toMatchObject({ phishingFailureRate: 0, phishingFailureMeasuredOn: '2026-09-01' });
    });

    it('should keep the declaration when another setting is saved without it', async () => {
      await client.mutation('crqIndicatorSettings.updateCrqIndicatorSettings', DECLARED, { tenantId });

      const update = await client.mutation('crqIndicatorSettings.updateCrqIndicatorSettings', { iterations: 500 }, { tenantId });
      expect(update.status).toBe(200);

      expect(await read()).toMatchObject({ iterations: 500, ...DECLARED });
    });

    it('should keep the other settings when the declaration is saved alone', async () => {
      await client.mutation('crqIndicatorSettings.updateCrqIndicatorSettings', { unknownExposureCountsAs: 'internet_facing' }, { tenantId });

      await client.mutation('crqIndicatorSettings.updateCrqIndicatorSettings', DECLARED, { tenantId });

      expect(await read()).toMatchObject({ unknownExposureCountsAs: 'internet_facing', ...DECLARED });
    });

    it('should replace the declaration with a new one', async () => {
      await client.mutation('crqIndicatorSettings.updateCrqIndicatorSettings', DECLARED, { tenantId });

      await client.mutation('crqIndicatorSettings.updateCrqIndicatorSettings', { phishingFailureRate: 0.2, phishingFailureMeasuredOn: '2026-10-01' }, { tenantId });

      expect(await read()).toMatchObject({ phishingFailureRate: 0.2, phishingFailureMeasuredOn: '2026-10-01' });
    });

    it('should clear both together, and leave the other settings alone', async () => {
      await client.mutation('crqIndicatorSettings.updateCrqIndicatorSettings', { ...DECLARED, iterations: 500 }, { tenantId });

      const cleared = await client.mutation('crqIndicatorSettings.updateCrqIndicatorSettings', { phishingFailureRate: null, phishingFailureMeasuredOn: null }, { tenantId });
      expect(cleared.status).toBe(200);

      expect(await read()).toMatchObject({ iterations: 500, phishingFailureRate: null, phishingFailureMeasuredOn: null });
    });

    it.each([
      ['a rate above one', { phishingFailureRate: 1.2, phishingFailureMeasuredOn: '2026-09-01' }],
      ['a negative rate', { phishingFailureRate: -0.1, phishingFailureMeasuredOn: '2026-09-01' }],
      ['a rate with no day', { phishingFailureRate: 0.12 }],
      ['a day with no rate', { phishingFailureMeasuredOn: '2026-09-01' }],
      ['a rate with a cleared day', { phishingFailureRate: 0.12, phishingFailureMeasuredOn: null }],
      ['a day with a cleared rate', { phishingFailureRate: null, phishingFailureMeasuredOn: '2026-09-01' }],
      ['a day in the future', { phishingFailureRate: 0.12, phishingFailureMeasuredOn: '2999-01-01' }],
      ['a day that is no date', { phishingFailureRate: 0.12, phishingFailureMeasuredOn: 'last spring' }],
    ])('should refuse %s and keep what the tenant declared', async (_, input) => {
      await client.mutation('crqIndicatorSettings.updateCrqIndicatorSettings', DECLARED, { tenantId });

      const res = await client.mutation('crqIndicatorSettings.updateCrqIndicatorSettings', input, { tenantId });

      expect(res.status).toBe(400);
      expect(await read()).toMatchObject(DECLARED);
    });

    it('should not show one tenant the declaration of another', async () => {
      const otherTenantId = uuidv7();
      await services.withOrigin({ type: 'platform', userId: adminId })
        .tenants.createTenant({ id: otherTenantId, name: 'Other CRQ Settings Tenant' }, adminId);
      await client.mutation('crqIndicatorSettings.updateCrqIndicatorSettings', DECLARED, { tenantId });

      expect(await read(otherTenantId)).toMatchObject({ phishingFailureRate: null, phishingFailureMeasuredOn: null });

      await client.mutation('crqIndicatorSettings.updateCrqIndicatorSettings', { phishingFailureRate: 0.3, phishingFailureMeasuredOn: '2026-10-02' }, { tenantId: otherTenantId });

      expect(await read()).toMatchObject(DECLARED);
      expect(await read(otherTenantId)).toMatchObject({ phishingFailureRate: 0.3, phishingFailureMeasuredOn: '2026-10-02' });
    });
  });
});

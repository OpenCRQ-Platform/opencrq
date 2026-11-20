import {
  MAX_ACT_HALF_LIFE_DAYS,
  MAX_UNKNOWN_ACTIVITY_AGE_DAYS,
  MIN_UNKNOWN_ACTIVITY_AGE_DAYS,
  THREAT_RELEVANCE_DEFAULTS,
} from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

const validValues = {
  actHalfLifeObservedDays: 90,
  actHalfLifeAuthoredDays: 540,
  // Deliberately not the shipped default, so reading it back proves the tenant's own gate is
  // persisted rather than the default being echoed.
  confidenceGate: 20,
};

describe('Threat Relevance Settings (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);

    const adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: tenantId, name: 'Tenant' }, adminId);
  });

  it('should reject an out-of-bounds half-life with BAD_REQUEST', async () => {
    const res = await client.mutation(
      'threatRelevanceSettings.updateThreatRelevanceSettings',
      { ...validValues, actHalfLifeObservedDays: MAX_ACT_HALF_LIFE_DAYS + 1 },
      { tenantId },
    );

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
    expect(res.json.error.data.zodError).not.toBeNull();

    const read = await client.query('threatRelevanceSettings.getThreatRelevanceSettings', undefined, { tenantId });
    expect(read.json.result.data).toEqual({ ...THREAT_RELEVANCE_DEFAULTS });
  });

  it('should reject an observed half-life slower than the authored one with BAD_REQUEST', async () => {
    const res = await client.mutation(
      'threatRelevanceSettings.updateThreatRelevanceSettings',
      { ...validValues, actHalfLifeObservedDays: 400, actHalfLifeAuthoredDays: 365 },
      { tenantId },
    );

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should reject a confidence gate off the stated ladder with BAD_REQUEST', async () => {
    const res = await client.mutation(
      'threatRelevanceSettings.updateThreatRelevanceSettings',
      { ...validValues, confidenceGate: 50 },
      { tenantId },
    );

    expect(res.json.error.data.code).toBe('BAD_REQUEST');

    const read = await client.query('threatRelevanceSettings.getThreatRelevanceSettings', undefined, { tenantId });
    expect(read.json.result.data).toEqual({ ...THREAT_RELEVANCE_DEFAULTS });
  });

  it.each([
    ['below the minimum', MIN_UNKNOWN_ACTIVITY_AGE_DAYS - 1],
    ['above the maximum', MAX_UNKNOWN_ACTIVITY_AGE_DAYS + 1],
  ])('should reject an unknown activity age %s with BAD_REQUEST', async (_label, unknownActivityAgeDays) => {
    const res = await client.mutation(
      'threatRelevanceSettings.updateThreatRelevanceSettings',
      { ...validValues, unknownActivityAgeDays },
      { tenantId },
    );

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
    expect(res.json.error.data.zodError).not.toBeNull();

    const read = await client.query('threatRelevanceSettings.getThreatRelevanceSettings', undefined, { tenantId });
    expect(read.json.result.data).toEqual({ ...THREAT_RELEVANCE_DEFAULTS });
  });

  it('should keep the unknown activity age when an update sends only the three historical fields', async () => {
    const first = await client.mutation(
      'threatRelevanceSettings.updateThreatRelevanceSettings',
      { ...validValues, unknownActivityAgeDays: 200 },
      { tenantId },
    );
    expect(first.status).toBe(200);

    const threeFields = { actHalfLifeObservedDays: 120, actHalfLifeAuthoredDays: 600, confidenceGate: 20 };
    const res = await client.mutation(
      'threatRelevanceSettings.updateThreatRelevanceSettings',
      threeFields,
      { tenantId },
    );
    expect(res.status).toBe(200);

    const read = await client.query('threatRelevanceSettings.getThreatRelevanceSettings', undefined, { tenantId });
    expect(read.json.result.data).toEqual({ ...threeFields, unknownActivityAgeDays: 200 });
  });

  it('should accept in-bounds settings and read them back', async () => {
    const res = await client.mutation(
      'threatRelevanceSettings.updateThreatRelevanceSettings',
      validValues,
      { tenantId },
    );
    expect(res.status).toBe(200);

    const read = await client.query('threatRelevanceSettings.getThreatRelevanceSettings', undefined, { tenantId });
    expect(read.status).toBe(200);
    expect(read.json.result.data).toEqual({
      ...validValues,
      unknownActivityAgeDays: THREAT_RELEVANCE_DEFAULTS.unknownActivityAgeDays,
    });
  });
});

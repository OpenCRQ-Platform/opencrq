import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

describe('Asset protecting controls (HTTP/tRPC)', () => {
  let client: ReturnType<typeof createTrpcTestClient>;
  let tenantId: string;
  let supportingAssetId: string;
  const services = createTestServices(db);

  beforeEach(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);

    const adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });
    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: tenantId, name: 'Tenant' }, adminId);
    supportingAssetId = uuidv7();
    await services.withOrigin({ type: 'client', userId: adminId, tenantId }).supportingAssets.createSupportingAsset({
      id: supportingAssetId,
      name: 'Card Authorization Engine',
      description: null,
      ownerId: null,
      exposure: 'internet_facing',
      categoryId: 'web_application',
      criticality: 'unknown',
    });
  });

  it('should serve the controls protecting a tenant asset', async () => {
    const res = await client.query('supportingAssets.getProtectingControls', { supportingAssetId }, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data.inScope).toBe(true);
    expect(res.json.result.data.controls.map((control: { externalId: string }) => control.externalId)).toContain('IDP');
  });

  it('should surface NOT_FOUND for an asset the tenant does not hold', async () => {
    const res = await client.query('supportingAssets.getProtectingControls', { supportingAssetId: uuidv7() }, { tenantId });

    expect(res.json.error.data.code).toBe('NOT_FOUND');
  });

  it('should surface NOT_FOUND for a risk scope the tenant does not hold', async () => {
    const res = await client.query(
      'supportingAssets.getProtectingControls',
      { supportingAssetId, organizationId: uuidv7() },
      { tenantId },
    );

    expect(res.json.error.data.code).toBe('NOT_FOUND');
  });

  it('should reject a malformed asset id', async () => {
    const res = await client.query('supportingAssets.getProtectingControls', { supportingAssetId: 'not-a-uuid' }, { tenantId });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should reject a malformed scope id', async () => {
    const res = await client.query(
      'supportingAssets.getProtectingControls',
      { supportingAssetId, organizationId: 'not-a-uuid' },
      { tenantId },
    );

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('should reject an unauthenticated read', async () => {
    client.clearCookies();

    const res = await client.query('supportingAssets.getProtectingControls', { supportingAssetId }, { tenantId });

    expect(res.json.error.data.code).toBe('UNAUTHORIZED');
  });

  it('should reject an authenticated read without tenant context', async () => {
    const res = await client.query('supportingAssets.getProtectingControls', { supportingAssetId });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });
});

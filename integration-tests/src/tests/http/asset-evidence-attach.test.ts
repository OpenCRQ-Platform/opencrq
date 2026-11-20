import { cve } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

describe('Attaching a CVE to an asset (HTTP/tRPC)', () => {
  let client: ReturnType<typeof createTrpcTestClient>;
  const services = createTestServices(db);

  let tenantId: string;
  let supportingAssetId: string;
  let foreignCveId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    client = createTrpcTestClient(await getTestServer());

    const adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });
    tenantId = uuidv7();
    const otherTenantId = uuidv7();
    const platform = services.withOrigin({ type: 'platform', userId: adminId });
    await platform.tenants.createTenant({ id: tenantId, name: 'Evidence Tenant' }, adminId);
    await platform.tenants.createTenant({ id: otherTenantId, name: 'Other Tenant' }, adminId);

    supportingAssetId = uuidv7();
    await services.withOrigin({ type: 'client', userId: adminId, tenantId }).supportingAssets.createSupportingAsset({
      id: supportingAssetId, name: 'Log Server', description: null, ownerId: null, exposure: 'internal', categoryId: 'host',
    });
    foreignCveId = uuidv7();
    await db.insert(cve).values([{ id: foreignCveId, tenantId: otherTenantId, cveId: 'CVE-2021-44228', cveTitle: 'Log4Shell' }]);
  });

  const attach = (values: { supportingAssetId: string, cveId: string }) =>
    client.mutation('supportingAssets.createAssetEvidence', values, { tenantId });

  it('should answer another tenant\'s CVE as an unknown one, not a server error', async () => {
    const foreign = await attach({ supportingAssetId, cveId: foreignCveId });
    const unknown = await attach({ supportingAssetId, cveId: uuidv7() });

    expect(foreign.json.error).toMatchObject({ message: 'CVE not found', data: { code: 'NOT_FOUND' } });
    expect(unknown.json.error).toMatchObject({ message: 'CVE not found', data: { code: 'NOT_FOUND' } });
  });

  it('should answer not found for an unknown asset, not a server error', async () => {
    const res = await attach({ supportingAssetId: uuidv7(), cveId: foreignCveId });

    expect(res.json.error).toMatchObject({ message: 'Supporting asset not found', data: { code: 'NOT_FOUND' } });
  });
});

import { assetEvidence, cve } from '@app/module';
import { eq } from 'drizzle-orm';
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
  let adminId: string;
  let supportingAssetId: string;
  let foreignCveId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    client = createTrpcTestClient(await getTestServer());

    adminId = uuidv7();
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

  describe('by its published id', () => {
    const heldCveIds = async () =>
      (await db.select({ cveId: cve.cveId }).from(cve).where(eq(cve.tenantId, tenantId))).map((row) => row.cveId);

    it('should create a CVE the tenant does not hold, the id typed in any case, even one another tenant holds', async () => {
      const res = await attach({ supportingAssetId, cveId: ' cve-2021-44228 ' });

      expect(res.status).toBe(200);
      expect(await heldCveIds()).toEqual(['CVE-2021-44228']);
      const findings = await db.select({ cveId: cve.cveId }).from(assetEvidence)
        .innerJoin(cve, eq(cve.id, assetEvidence.cveId))
        .where(eq(assetEvidence.supportingAssetId, supportingAssetId));
      expect(findings).toEqual([{ cveId: 'CVE-2021-44228' }]);
    });

    it('should refuse an id that is not a CVE id', async () => {
      const res = await attach({ supportingAssetId, cveId: 'CVE-21-44228' });

      expect(res.json.error).toMatchObject({ data: { code: 'BAD_REQUEST' } });
      expect(await heldCveIds()).toEqual([]);
    });

    it('should answer a CVE the asset already carries with a reason the drawer tells apart', async () => {
      await attach({ supportingAssetId, cveId: 'CVE-2021-44228' });

      const res = await attach({ supportingAssetId, cveId: 'cve-2021-44228' });

      expect(res.json.error).toMatchObject({ data: { code: 'CONFLICT', reason: 'EVIDENCE_ALREADY_EXISTS' } });
    });
  });
});

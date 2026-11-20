import type { EventOrigin } from '@app/module';
import { assetEvidence, cve, TECHNIQUE_T1003 } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeAll, describe, expect, it } from 'vitest';
import { insertSyncedVerdict } from '../../helpers/evidence-rows';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

const ESTATE_ENDPOINTS = [
  'findingScore.getOpenFindingFigures',
  'findingScore.getTechniqueTestPosture',
  'supportingAssets.getAssetCountBySubcategory',
];

describe('Dashboard estate figure endpoints (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let anonymous: ReturnType<typeof createTrpcTestClient>;

  let tenantId: string;
  let openScopeId: string;
  let closedScopeId: string;
  let otherTenantScopeId: string;

  beforeAll(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);
    anonymous = createTrpcTestClient(server);

    const adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

    tenantId = uuidv7();
    const otherTenantId = uuidv7();
    const platform = services.withOrigin({ type: 'platform', userId: adminId });
    await platform.tenants.createTenant({ id: tenantId, name: 'Estate Tenant' }, adminId);
    await platform.tenants.createTenant({ id: otherTenantId, name: 'Other Tenant' }, adminId);
    const origin: EventOrigin = { type: 'client', userId: adminId, tenantId };

    const exposedId = uuidv7();
    const internalId = uuidv7();
    await services.withOrigin(origin).supportingAssets.createSupportingAsset({
      id: exposedId, name: 'Exposed host', description: null, ownerId: null, exposure: 'internet_facing', categoryId: 'host', subcategoryId: 'server', criticality: 'high',
    });
    await services.withOrigin(origin).supportingAssets.createSupportingAsset({
      id: internalId, name: 'Internal host', description: null, ownerId: null, exposure: 'internal', categoryId: 'host', subcategoryId: null, criticality: 'high',
    });

    const exploitedCveId = uuidv7();
    const plainCveId = uuidv7();
    await db.insert(cve).values([
      { id: exploitedCveId, tenantId, cveId: 'CVE-2026-0501', cvss: 9.1, kev: true, kevUpdatedAt: new Date() },
      { id: plainCveId, tenantId, cveId: 'CVE-2026-0502', cvss: 5.0 },
    ]);
    await db.insert(assetEvidence).values([
      { id: uuidv7(), supportingAssetId: exposedId, tenantId, cveId: exploitedCveId, userId: adminId },
      { id: uuidv7(), supportingAssetId: internalId, tenantId, cveId: plainCveId, userId: adminId },
    ]);
    await services.withOrigin(origin).findingScore.recomputeFindingScores();

    const techniqueEvidenceId = uuidv7();
    await db.insert(assetEvidence).values([{
      id: techniqueEvidenceId, supportingAssetId: exposedId, tenantId, mitreTechniqueId: TECHNIQUE_T1003, expectationType: 'prevention', evaluatedAt: new Date(),
    }]);
    await insertSyncedVerdict(techniqueEvidenceId, 'dismissed', new Date());

    openScopeId = uuidv7();
    closedScopeId = uuidv7();
    await services.withOrigin(origin).organizations.createOrganizations([
      { id: openScopeId, name: 'Open scope' },
      { id: closedScopeId, name: 'Closed scope', estateMode: 'closed', mappedAssetIds: [internalId] },
    ]);
    otherTenantScopeId = uuidv7();
    await services.withOrigin({ type: 'client', userId: adminId, tenantId: otherTenantId })
      .organizations.createOrganizations([{ id: otherTenantScopeId, name: 'Foreign scope' }]);
  }, 600_000);

  describe('findingScore.getOpenFindingFigures', () => {
    it('should count the whole tenant estate without a scope or with an open one', async () => {
      const tenantWide = await client.query('findingScore.getOpenFindingFigures', { organizationId: null }, { tenantId });
      const openScope = await client.query('findingScore.getOpenFindingFigures', { organizationId: openScopeId }, { tenantId });

      expect(tenantWide.status).toBe(200);
      expect(tenantWide.json.result.data).toMatchObject({ open: 2, internetExposed: 1, knownExploited: 1 });
      expect(openScope.json.result.data).toEqual(tenantWide.json.result.data);
    });

    it('should count only the estate of a closed scope', async () => {
      const res = await client.query('findingScore.getOpenFindingFigures', { organizationId: closedScopeId }, { tenantId });

      expect(res.json.result.data).toMatchObject({ open: 1, internetExposed: 0, knownExploited: 0 });
    });
  });

  describe('findingScore.getTechniqueTestPosture', () => {
    it('should tally the verdicts of the tenant estate', async () => {
      const res = await client.query('findingScore.getTechniqueTestPosture', { organizationId: openScopeId }, { tenantId });

      expect(res.status).toBe(200);
      expect(res.json.result.data).toEqual({
        testedAssetCount: 1,
        expectations: {
          prevention: { current: { held: 1, total: 1 }, previous: null },
          detection: { current: null, previous: null },
        },
      });
    });

    it('should carry null tallies for a scope that was never tested', async () => {
      const res = await client.query('findingScore.getTechniqueTestPosture', { organizationId: closedScopeId }, { tenantId });

      expect(res.json.result.data).toEqual({
        testedAssetCount: 0,
        expectations: {
          prevention: { current: null, previous: null },
          detection: { current: null, previous: null },
        },
      });
    });
  });

  describe('supportingAssets.getAssetCountBySubcategory', () => {
    it('should count the tenant estate per category and subcategory', async () => {
      const res = await client.query('supportingAssets.getAssetCountBySubcategory', { organizationId: openScopeId }, { tenantId });

      expect(res.status).toBe(200);
      expect(res.json.result.data).toEqual([
        { categoryId: 'host', subcategoryId: 'server', assetCount: 1 },
        { categoryId: 'host', subcategoryId: null, assetCount: 1 },
      ]);
    });

    it('should count only the estate of a closed scope', async () => {
      const res = await client.query('supportingAssets.getAssetCountBySubcategory', { organizationId: closedScopeId }, { tenantId });

      expect(res.json.result.data).toEqual([{ categoryId: 'host', subcategoryId: null, assetCount: 1 }]);
    });
  });

  describe.each(ESTATE_ENDPOINTS)('%s', (path) => {
    it('should default to the tenant estate when no scope is given', async () => {
      const implicit = await client.query(path, {}, { tenantId });
      const explicit = await client.query(path, { organizationId: null }, { tenantId });

      expect(implicit.json.result.data).toEqual(explicit.json.result.data);
    });

    it('should refuse a malformed scope id', async () => {
      const res = await client.query(path, { organizationId: 'not-a-uuid' }, { tenantId });

      expect(res.json.error.data.code).toBe('BAD_REQUEST');
    });

    it('should surface NOT_FOUND for a scope another tenant holds', async () => {
      const res = await client.query(path, { organizationId: otherTenantScopeId }, { tenantId });

      expect(res.json.error.data.code).toBe('NOT_FOUND');
    });

    it('should refuse an unauthenticated caller', async () => {
      const res = await anonymous.query(path, { organizationId: null }, { tenantId });

      expect(res.json.error.data.code).toBe('UNAUTHORIZED');
    });

    it('should refuse a call that names no tenant', async () => {
      const res = await client.query(path, { organizationId: null });

      expect(res.json.error.data.code).toBe('BAD_REQUEST');
    });
  });
});

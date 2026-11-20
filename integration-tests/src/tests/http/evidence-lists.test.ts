import { assetEvidence, assetEvidenceHistory, cve, EVIDENCE_ACTIVITY_DAYS, TECHNIQUE_T1003 } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

describe('Evidence lists (HTTP/tRPC)', () => {
  let client: ReturnType<typeof createTrpcTestClient>;
  const services = createTestServices(db);

  let tenantId: string;
  let adminId: string;
  let supportingAssetId: string;
  let cveEvidenceId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    client = createTrpcTestClient(await getTestServer());

    adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });
    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId }).tenants.createTenant({ id: tenantId, name: 'Evidence Tenant' }, adminId);
    const scoped = services.withOrigin({ type: 'client', userId: adminId, tenantId });

    supportingAssetId = uuidv7();
    await scoped.supportingAssets.createSupportingAsset({
      id: supportingAssetId, name: 'Log Server', description: null, ownerId: null, exposure: 'internal', categoryId: 'host',
    });
    const cveUuid = uuidv7();
    await db.insert(cve).values([{ id: cveUuid, tenantId, cveId: 'CVE-2021-44228', cveTitle: 'Log4Shell' }]);
    cveEvidenceId = uuidv7();
    await scoped.supportingAssets.createEvidence({ id: cveEvidenceId, supportingAssetId, cveId: cveUuid, userId: adminId });
    await db.insert(assetEvidence).values([{
      id: uuidv7(), supportingAssetId, tenantId, mitreTechniqueId: TECHNIQUE_T1003, expectationType: 'detection', securityPlatformType: 'SIEM',
    }]);
  });

  it('should page the assets a CVE is found on', async () => {
    const res = await client.query('supportingAssets.getEvidencesForCve', { cveId: 'CVE-2021-44228', limit: 10, sortBy: 'currentState' }, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data).toMatchObject({ total: 1, page: 1, limit: 10, items: [{ supportingAssetId, assetName: 'Log Server', currentState: 'applicable' }] });
  });

  it('should page the assets a technique is found on', async () => {
    const res = await client.query('supportingAssets.getEvidencesForTechnique', { mitreTechniqueId: TECHNIQUE_T1003, sortBy: 'securityPlatformType' }, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data).toMatchObject({ total: 1, items: [{ supportingAssetId, expectationType: 'detection', securityPlatformType: 'SIEM', currentState: 'applicable' }] });
  });

  it('should page one asset\'s findings, searched', async () => {
    const res = await client.query('findingScore.listAssetFindings', { supportingAssetId, search: 'log4shell' }, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data).toMatchObject({ total: 1, items: [{ cveId: 'CVE-2021-44228', cveTitle: 'Log4Shell', score: null, sourceCount: 0 }] });
  });

  it('should name what dismissed a finding, on its asset\'s findings and on its CVE\'s assets', async () => {
    const now = new Date();
    await db.insert(assetEvidenceHistory).values([{
      id: uuidv7(), tenantId, assetEvidenceId: cveEvidenceId, state: 'dismissed', stateChangedAt: now, observedAt: now, origin: 'no_longer_reported',
    }]);

    const findings = await client.query('findingScore.listAssetFindings', { supportingAssetId, state: 'dismissed' }, { tenantId });
    const affected = await client.query('supportingAssets.getEvidencesForCve', { cveId: 'CVE-2021-44228', limit: 10, sortBy: 'currentState' }, { tenantId });

    expect(findings.json.result.data.items).toMatchObject([{ cveId: 'CVE-2021-44228', currentState: 'dismissed', stateOrigin: 'no_longer_reported', dismissalType: null }]);
    expect(affected.json.result.data.items).toMatchObject([{ currentState: 'dismissed', stateOrigin: 'no_longer_reported', dismissalType: null }]);
  });

  it('should list the techniques an asset has an applicable result on', async () => {
    const res = await client.query('supportingAssets.getApplicableTechniquesForAsset', { assetId: supportingAssetId }, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data).toEqual([expect.objectContaining({ id: TECHNIQUE_T1003, externalId: 'T1003' })]);
  });

  it('should chart a CVE one point per day, today counting the finding raised today', async () => {
    const res = await client.query('supportingAssets.getEvidenceActivityForCve', { cveId: 'CVE-2021-44228', timeZone: 'Europe/Paris' }, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data).toHaveLength(EVIDENCE_ACTIVITY_DAYS);
    expect(res.json.result.data[EVIDENCE_ACTIVITY_DAYS - 1]).toMatchObject({ count: 1 });
  });

  it('should describe a technique unique finding of the tenant, and null for a technique it does not know', async () => {
    const res = await client.query('findingScore.getUniqueTechniqueFinding', { organizationId: null, externalId: 'T1003', expectationType: 'detection' }, { tenantId });
    const unknown = await client.query('findingScore.getUniqueTechniqueFinding', { organizationId: null, externalId: 'T9999', expectationType: 'detection' }, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data).toMatchObject({ externalId: 'T1003', expectationType: 'detection', affectedAssetCount: 1 });
    expect(unknown.status).toBe(200);
    expect(unknown.json.result.data).toBeNull();
  });

  it('should count a technique unique finding within the organization asked', async () => {
    const scopeId = uuidv7();
    await services.withOrigin({ type: 'client', userId: adminId, tenantId }).organizations.createOrganizations([
      { id: scopeId, name: 'Closed scope', estateMode: 'closed', mappedAssetIds: [] },
    ]);

    const res = await client.query('findingScore.getUniqueTechniqueFinding', { organizationId: scopeId, externalId: 'T1003', expectationType: 'detection' }, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data).toMatchObject({ affectedAssetCount: 0 });
  });

  it.each([
    { externalId: 't1003', expectationType: 'detection' },
    { externalId: 'T1003', expectationType: 'mitigation' },
  ])('should refuse $externalId in $expectationType as a technique unique finding', async (input) => {
    const res = await client.query('findingScore.getUniqueTechniqueFinding', { organizationId: null, ...input }, { tenantId });

    expect(res.status).toBe(400);
  });

  it.each(['Mars/Olympus', '+01:00', '−01:00'])('should refuse %s as a time zone', async (timeZone) => {
    const res = await client.query('supportingAssets.getEvidenceActivityForAsset', { assetId: supportingAssetId, timeZone }, { tenantId });

    expect(res.status).toBe(400);
  });

  it('should refuse a page larger than the ceiling', async () => {
    const res = await client.query('supportingAssets.getEvidencesForCve', { cveId: 'CVE-2021-44228', limit: 501 }, { tenantId });

    expect(res.status).toBe(400);
  });
});

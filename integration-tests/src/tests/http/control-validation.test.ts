import { assetEvidence, TECHNIQUE_T1027 } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { insertSyncedVerdict } from '../../helpers/evidence-rows';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

describe('Control validation (HTTP/tRPC)', () => {
  let client: ReturnType<typeof createTrpcTestClient>;
  let tenantId: string;
  let adminId: string;
  let capabilityId: string;
  const services = createTestServices(db);

  beforeEach(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);

    adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });
    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: tenantId, name: 'Tenant' }, adminId);
    const capabilities = await services.withOrigin({ type: 'client', userId: adminId, tenantId })
      .controlCapabilities.getControlCapabilities();
    capabilityId = capabilities[0].id;
  });

  it('serves a tenant-scoped validation detail', async () => {
    const res = await client.query('controlValidation.getControlValidation', { capabilityId }, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data).toEqual({
      summary: {
        validatedTechniques: 0,
        contradictedTechniques: 0,
        testedTechniques: 0,
        latestProofAt: null,
      },
      cells: [],
    });
  });

  it('serves the evidence lines of a control', async () => {
    const res = await client.query('controlValidation.getControlValidationEvidence', { capabilityId }, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data).toEqual([]);
  });

  it('serves XTM One how many assets of each line held, past the names it carries', async () => {
    const origin = { type: 'client' as const, userId: adminId, tenantId };
    const edrCapabilityId = (await services.withOrigin(origin).controlCapabilities.getControlCapabilities())
      .find((capability) => capability.externalId === 'EDR')!.id;
    const evaluatedAt = new Date();
    for (const name of ['A', 'B', 'C', 'D', 'E', 'F']) {
      const supportingAssetId = uuidv7();
      await services.withOrigin(origin).supportingAssets.createSupportingAsset({
        id: supportingAssetId, name, description: null, ownerId: null, exposure: 'unknown', categoryId: 'host', criticality: 'unknown',
      });
      const evidenceId = uuidv7();
      await db.insert(assetEvidence).values([{
        id: evidenceId,
        supportingAssetId,
        tenantId,
        mitreTechniqueId: TECHNIQUE_T1027,
        expectationType: 'prevention',
        securityPlatformType: 'EDR',
        sourceScenarioId: 'scenario-1',
        sourceScenarioName: 'Ransomware drill',
        sourceSimulationId: 'simulation-1',
        evaluatedAt,
      }]);
      await insertSyncedVerdict(evidenceId, 'dismissed', evaluatedAt);
    }

    const res = await client.query('controlValidation.getControlValidationEvidence', { capabilityId: edrCapabilityId }, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data).toEqual([expect.objectContaining({
      assetCounts: { validated: 6, contradicted: 0 },
      assets: expect.arrayContaining([expect.objectContaining({ name: 'A' })]),
    })]);
    expect(res.json.result.data[0].assets).toHaveLength(5);
  });

  it('serves a page of the evidence lines of a control', async () => {
    const res = await client.query('controlValidation.listControlValidationEvidence', { capabilityId }, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data).toEqual({ items: [], total: 0, unfilteredTotal: 0, page: 1, limit: 50 });
  });

  it('serves a page of the evidence lines of a control on its filters', async () => {
    const res = await client.query('controlValidation.listControlValidationEvidence', {
      capabilityId, technique: 'T1055', function: 'detect', result: 'contradicted', securityPlatformType: 'EDR',
    }, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data).toEqual({ items: [], total: 0, unfilteredTotal: 0, page: 1, limit: 50 });
  });

  it('rejects a technique filter that is not an ATT&CK id', async () => {
    const res = await client.query('controlValidation.listControlValidationEvidence', { capabilityId, technique: uuidv7() }, { tenantId });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('serves the techniques of the evidence lines of a control', async () => {
    const res = await client.query('controlValidation.listControlValidationEvidenceTechniques', { capabilityId }, { tenantId });

    expect(res.status).toBe(200);
    expect(res.json.result.data).toEqual([]);
  });

  it('should surface NOT_FOUND for a risk scope the tenant does not hold', async () => {
    const res = await client.query('controlValidation.getControlValidation', { capabilityId, organizationId: uuidv7() }, { tenantId });

    expect(res.json.error.data.code).toBe('NOT_FOUND');
  });

  it('rejects a malformed capability id', async () => {
    const res = await client.query('controlValidation.getControlValidation', { capabilityId: 'not-a-uuid' }, { tenantId });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  it('rejects an unauthenticated read', async () => {
    client.clearCookies();

    const res = await client.query('controlValidation.getControlValidation', { capabilityId }, { tenantId });

    expect(res.json.error.data.code).toBe('UNAUTHORIZED');
  });

  it('rejects an authenticated read without tenant context', async () => {
    const res = await client.query('controlValidation.getControlValidationEvidence', { capabilityId });

    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });
});

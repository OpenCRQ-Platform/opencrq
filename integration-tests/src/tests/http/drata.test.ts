import type { DrataMirrorInput, EventOrigin } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

const mirrorInput = (): DrataMirrorInput => ({
  syncedAt: new Date('2026-08-25T10:00:00Z'),
  controls: [
    { drataId: 100, code: 'DCF-1001', name: 'MFA enforced', description: 'Multi-factor authentication is required for every account.', isReady: true, isMonitored: true, hasEvidence: true, hasPolicy: false, archivedAt: null },
  ],
  frameworks: [
    {
      drataId: 4,
      slug: 'iso2022',
      tag: 'ISO270012022',
      name: 'ISO 27001:2022',
      description: null,
      isReady: false,
      numInScopeRequirements: 1,
      numReadyInScopeRequirements: 1,
      numInScopeControls: 1,
      requirements: [
        { drataId: 10, code: 'A.5.1', name: 'Requirement one', description: 'Requirement description.', category: 'Organizational', isInScope: true, isReady: true, controlDrataIds: [100] },
      ],
    },
  ],
});

describe('Drata (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let tenantId: string;
  let adminId: string;
  let serviceAccountId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);

    adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: tenantId, name: 'Tenant' }, adminId);

    const adminOrigin: EventOrigin = { type: 'client', userId: adminId, tenantId };
    serviceAccountId = uuidv7();
    await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({
      id: serviceAccountId,
      name: 'Drata Bot',
    });
    await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('drata', serviceAccountId);

    const connectorOrigin: EventOrigin = { type: 'connector', serviceAccountId, tenantId };
    await services.withOrigin(connectorOrigin).drata.replaceMirror(mirrorInput());
  });

  it('should list the mirrored frameworks for the tenant', async () => {
    const res = await client.query('drata.getFrameworks', undefined, { tenantId });
    expect(res.status).toBe(200);
    expect(res.json.result.data).toHaveLength(1);
    expect(res.json.result.data[0]).toMatchObject({
      drataId: 4,
      tag: 'ISO270012022',
      name: 'ISO 27001:2022',
      numInScopeRequirements: 1,
      numReadyInScopeRequirements: 1,
      derivedTotalRequirements: 1,
      derivedInScopeRequirements: 1,
      derivedReadyInScopeRequirements: 1,
    });
  });

  it('should drill from framework to requirements to controls', async () => {
    const frameworks = await client.query('drata.getFrameworks', undefined, { tenantId });
    const frameworkId = frameworks.json.result.data[0].id;

    const requirements = await client.query('drata.getRequirements', { frameworkId }, { tenantId });
    expect(requirements.status).toBe(200);
    expect(requirements.json.result.data).toHaveLength(1);
    expect(requirements.json.result.data[0]).toMatchObject({ code: 'A.5.1', isInScope: true, isReady: true, controlCount: 1 });
    expect(Object.keys(requirements.json.result.data[0]).sort()).toEqual(
      ['category', 'code', 'controlCount', 'id', 'isInScope', 'isReady', 'name'],
    );

    const requirement = await client.query('drata.getRequirement', { id: requirements.json.result.data[0].id }, { tenantId });
    expect(requirement.json.result.data).toMatchObject({
      id: requirements.json.result.data[0].id,
      code: 'A.5.1',
      description: 'Requirement description.',
    });

    const controls = await client.query('drata.getControlsForRequirement', { requirementId: requirements.json.result.data[0].id }, { tenantId });
    expect(controls.status).toBe(200);
    expect(controls.json.result.data).toHaveLength(1);
    expect(controls.json.result.data[0]).toMatchObject({ code: 'DCF-1001', isReady: true, isMonitored: true });
    expect(Object.keys(controls.json.result.data[0]).sort()).toEqual(
      ['archivedAt', 'code', 'hasEvidence', 'hasPolicy', 'id', 'isMonitored', 'isReady', 'name'],
    );
  });

  it('should list the controls reachable from a framework with requirement counts', async () => {
    const frameworks = await client.query('drata.getFrameworks', undefined, { tenantId });
    const frameworkId = frameworks.json.result.data[0].id;

    const res = await client.query('drata.getControlsForFramework', { frameworkId }, { tenantId });
    expect(res.status).toBe(200);
    expect(res.json.result.data).toHaveLength(1);
    expect(res.json.result.data[0]).toMatchObject({ code: 'DCF-1001', requirementCount: 1 });
    expect(Object.keys(res.json.result.data[0]).sort()).toEqual(
      ['archivedAt', 'code', 'hasEvidence', 'hasPolicy', 'id', 'isMonitored', 'isReady', 'name', 'requirementCount'],
    );
  });

  it('should not serve a requirement to another tenant', async () => {
    const frameworks = await client.query('drata.getFrameworks', undefined, { tenantId });
    const requirements = await client.query('drata.getRequirements', { frameworkId: frameworks.json.result.data[0].id }, { tenantId });
    const otherTenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: otherTenantId, name: 'Other Tenant' }, adminId);

    const res = await client.query('drata.getRequirement', { id: requirements.json.result.data[0].id }, { tenantId: otherTenantId });
    expect(res.json.result.data).toBeNull();
  });

  it('should not expose the mirror to another tenant', async () => {
    const otherTenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: otherTenantId, name: 'Other Tenant' }, adminId);

    const res = await client.query('drata.getFrameworks', undefined, { tenantId: otherTenantId });
    expect(res.status).toBe(200);
    expect(res.json.result.data).toHaveLength(0);
  });

  it('should reject syncNow when the platform-level Drata config is missing', async () => {
    const res = await client.mutation('connectors.syncNow', { source: 'drata' }, { tenantId });
    expect(res.json.error.data.code).toBe('BAD_REQUEST');
  });

  describe('capability derivation', () => {
    // WAF's whole evidence in the vendored mapping: the single pair DCF-88, attesting L1 across the whole unit.
    const mirrorWafEvidence = async (isReady: boolean) => {
      const connectorOrigin: EventOrigin = { type: 'connector', serviceAccountId, tenantId };
      await services.withOrigin(connectorOrigin).drata.replaceMirror({
        syncedAt: new Date(),
        frameworks: [],
        controls: [{
          drataId: 88, code: 'DCF-88', name: 'WAF deployed', description: null,
          isReady, isMonitored: isReady, hasEvidence: isReady, hasPolicy: false, archivedAt: null,
        }],
      });
    };

    const getCapabilityId = async (externalId: string) => {
      const res = await client.query('controlCapabilities.getControlCapabilities', undefined, { tenantId });
      return res.json.result.data.find((capability: { externalId: string }) => capability.externalId === externalId).id;
    };

    it('should return the derived values with their evidence trail', async () => {
      await mirrorWafEvidence(true);
      const capabilityId = await getCapabilityId('WAF');

      const res = await client.query('drata.getCapabilityDerivation', { capabilityId }, { tenantId });

      expect(res.status).toBe(200);
      expect(res.json.result.data.derived).toEqual({
        strengthRung: 'L1',
        coverageBucket: 'L2',
      });
      expect(res.json.result.data.supports).toEqual([
        { code: 'DCF-88', name: 'WAF deployed', isReady: true, levels: ['L1'], reach: 'org_wide' },
      ]);
    });

    it('should show mirrored evidence that yields no reading, none of its pairs attesting L1', async () => {
      await services.withOrigin({ type: 'connector', serviceAccountId, tenantId }).drata.replaceMirror({
        syncedAt: new Date(),
        frameworks: [],
        controls: [{
          drataId: 55, code: 'DCF-55', name: 'Data in transit encrypted', description: null,
          isReady: true, isMonitored: true, hasEvidence: true, hasPolicy: false, archivedAt: null,
        }],
      });
      const capabilityId = await getCapabilityId('TLS');

      const res = await client.query('drata.getCapabilityDerivation', { capabilityId }, { tenantId });

      expect(res.status).toBe(200);
      expect(res.json.result.data).toEqual({
        hasMirror: true,
        derived: null,
        supports: [{ code: 'DCF-55', name: 'Data in transit encrypted', isReady: true, levels: ['L2'], reach: 'org_wide' }],
      });
    });

    it('should derive nothing for a tenant whose mirror holds no evidence', async () => {
      await mirrorWafEvidence(true);
      const capabilityId = await getCapabilityId('WAF');
      const otherTenantId = uuidv7();
      await services.withOrigin({ type: 'platform', userId: adminId })
        .tenants.createTenant({ id: otherTenantId, name: 'Other Tenant' }, adminId);

      const res = await client.query('drata.getCapabilityDerivation', { capabilityId }, { tenantId: otherTenantId });

      expect(res.status).toBe(200);
      expect(res.json.result.data).toEqual({ hasMirror: false, derived: null, supports: [] });
    });

    it('should tell a mirror holding no evidence of the control from a tenant without a mirror', async () => {
      const capabilityId = await getCapabilityId('WAF');

      const res = await client.query('drata.getCapabilityDerivation', { capabilityId }, { tenantId });

      expect(res.status).toBe(200);
      expect(res.json.result.data).toEqual({ hasMirror: true, derived: null, supports: [] });
    });

    it('should re-attach on the values recomputed server-side', async () => {
      await mirrorWafEvidence(true);
      const capabilityId = await getCapabilityId('WAF');

      const reattach = await client.mutation(
        'controlCapabilities.upsertAssessment',
        { capabilityId, reattach: ['strength', 'coverage'], strengthRung: null, coverageBucket: null, comment: 'Reason' },
        { tenantId },
      );

      expect(reattach.status).toBe(200);
      const capabilities = await client.query('controlCapabilities.getControlCapabilities', undefined, { tenantId });
      const waf = capabilities.json.result.data.find((capability: { id: string }) => capability.id === capabilityId);
      expect(waf.assessment).toMatchObject({
        strengthRung: 'L1',
        coverageBucket: 'L2',
        strengthMode: 'auto',
        coverageMode: 'auto',
      });
      expect(waf.lastAssessedConnector).toBe('derivation');
    });

    const assessmentOf = async (capabilityId: string) => {
      const res = await client.query('controlCapabilities.getControlCapability', { id: capabilityId }, { tenantId });
      return res.json.result.data.assessment;
    };

    it('should declare one axis alone and leave the other derived', async () => {
      await mirrorWafEvidence(true);
      const capabilityId = await getCapabilityId('WAF');
      await client.mutation(
        'controlCapabilities.upsertAssessment',
        { capabilityId, reattach: ['strength', 'coverage'], strengthRung: null, coverageBucket: null, comment: 'Reason' },
        { tenantId },
      );

      const res = await client.mutation(
        'controlCapabilities.upsertAssessment',
        { capabilityId, reattach: [], strengthRung: null, coverageBucket: 'L3', comment: 'Reason' },
        { tenantId },
      );

      expect(res.status).toBe(200);
      expect(await assessmentOf(capabilityId)).toMatchObject({ strengthRung: 'L1', strengthMode: 'auto', coverageBucket: 'L3', coverageMode: 'manual' });
    });

    it('should re-attach one axis and declare the other in a single save on a control never assessed', async () => {
      await mirrorWafEvidence(true);
      const capabilityId = await getCapabilityId('WAF');

      const res = await client.mutation(
        'controlCapabilities.upsertAssessment',
        { capabilityId, reattach: ['strength'], strengthRung: null, coverageBucket: 'L3', comment: 'Rolled out everywhere' },
        { tenantId },
      );

      expect(res.status).toBe(200);
      expect(await assessmentOf(capabilityId)).toMatchObject({ strengthRung: 'L1', strengthMode: 'auto', coverageBucket: 'L3', coverageMode: 'manual' });
    });

    it('should reject a save naming no axis, or one axis both declared and re-attached', async () => {
      await mirrorWafEvidence(true);
      const capabilityId = await getCapabilityId('WAF');

      const empty = await client.mutation(
        'controlCapabilities.upsertAssessment',
        { capabilityId, reattach: [], strengthRung: null, coverageBucket: null, comment: null },
        { tenantId },
      );
      const both = await client.mutation(
        'controlCapabilities.upsertAssessment',
        { capabilityId, reattach: ['coverage'], strengthRung: 'L2', coverageBucket: 'L3', comment: null },
        { tenantId },
      );

      expect(empty.json.error.data.code).toBe('BAD_REQUEST');
      expect(both.json.error.data.code).toBe('BAD_REQUEST');
      expect(await assessmentOf(capabilityId)).toBeNull();
    });

    it('should write nothing when the re-attach half of a save finds no source', async () => {
      await mirrorWafEvidence(true);
      const capabilityId = await getCapabilityId('IDP');

      const res = await client.mutation(
        'controlCapabilities.upsertAssessment',
        { capabilityId, reattach: ['strength'], strengthRung: null, coverageBucket: 'L3', comment: null },
        { tenantId },
      );

      expect(res.json.error.data.code).toBe('BAD_REQUEST');
      expect(await assessmentOf(capabilityId)).toBeNull();
    });

    it('should reject a first declaration naming one axis only as a bad request', async () => {
      const capabilityId = await getCapabilityId('IDP');

      const res = await client.mutation(
        'controlCapabilities.upsertAssessment',
        { capabilityId, reattach: [], strengthRung: null, coverageBucket: 'L3', comment: null },
        { tenantId },
      );

      expect(res.json.error.data.code).toBe('BAD_REQUEST');
      expect(await assessmentOf(capabilityId)).toBeNull();
    });

    it('should reject a re-attach when no source feeds the capability', async () => {
      await mirrorWafEvidence(true);
      const capabilityId = await getCapabilityId('IDP');

      const res = await client.mutation(
        'controlCapabilities.upsertAssessment',
        { capabilityId, reattach: ['strength'], strengthRung: null, coverageBucket: null, comment: 'Reason' },
        { tenantId },
      );

      expect(res.json.error.data.code).toBe('BAD_REQUEST');
    });

    it('should accept a mode switch without a comment', async () => {
      await mirrorWafEvidence(true);
      const capabilityId = await getCapabilityId('WAF');

      const res = await client.mutation(
        'controlCapabilities.upsertAssessment',
        { capabilityId, reattach: ['strength', 'coverage'], strengthRung: null, coverageBucket: null, comment: null },
        { tenantId },
      );

      expect(res.status).toBe(200);
      expect(await assessmentOf(capabilityId)).toMatchObject({ strengthMode: 'auto', coverageMode: 'auto' });
    });
  });
});

import type { EventOrigin } from '@app/module';
import { attackOutcomeMitreTechniques, attackOutcomes, controlCapabilityScopeOverrides, TECHNIQUE_T1003 } from '@app/module';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { recomputeAttackOutcomeMixtures } from '../../helpers/attack-outcome-mixtures';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

describe('Scope control posture seam (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let tenantId: string;
  let otherTenantId: string;
  let adminOrigin: EventOrigin;
  let organizationId: string;
  let mfaId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);

    const adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

    tenantId = uuidv7();
    adminOrigin = { type: 'client', userId: adminId, tenantId };
    const platformOrigin: EventOrigin = { type: 'platform', userId: adminId };
    await services.withOrigin(platformOrigin).tenants.createTenant({ id: tenantId, name: 'Tenant A' }, adminId);
    otherTenantId = uuidv7();
    await services.withOrigin(platformOrigin).tenants.createTenant({ id: otherTenantId, name: 'Tenant B' }, adminId);

    organizationId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: organizationId, name: 'Payments platform' }]);

    const capabilities = await services.withOrigin(adminOrigin).controlCapabilities.getControlCapabilities();
    mfaId = capabilities.find((capability) => capability.externalId === 'IDP')!.id;
  });

  describe('tenant isolation', () => {
    beforeEach(async () => {
      await client.mutation('controlCapabilities.declareScopeControlPosture', {
        organizationId, capabilityId: mfaId, strengthRung: 'L0', coverageBucket: 'L0', comment: 'tenant A only',
      }, { tenantId });
    });

    it('should refuse to resolve tenant A’s scope for tenant B', async () => {
      const res = await client.query('controlCapabilities.getResolvedControlPosture', { organizationId }, { tenantId: otherTenantId });
      expect(res.status).not.toBe(200);
    });

    it('should refuse a declaration by tenant B on tenant A’s scope', async () => {
      const res = await client.mutation('controlCapabilities.declareScopeControlPosture', {
        organizationId, capabilityId: mfaId, strengthRung: 'L3', coverageBucket: 'L3', comment: null,
      }, { tenantId: otherTenantId });
      expect(res.status).not.toBe(200);

      const rows = await db.select().from(controlCapabilityScopeOverrides)
        .where(eq(controlCapabilityScopeOverrides.organizationId, organizationId));
      expect(rows[0]).toMatchObject({ strengthRung: 'L0', coverageBucket: 'L0' });
    });

    it('should refuse a clear by tenant B on tenant A’s scope', async () => {
      const res = await client.mutation('controlCapabilities.clearScopeControlPosture', {
        organizationId, capabilityId: mfaId, dimension: 'coverage',
      }, { tenantId: otherTenantId });
      expect(res.status).not.toBe(200);

      const rows = await db.select().from(controlCapabilityScopeOverrides)
        .where(eq(controlCapabilityScopeOverrides.organizationId, organizationId));
      expect(rows[0]).toMatchObject({ coverageBucket: 'L0' });
    });

    it('should keep tenant A’s scope line out of tenant B’s chronology', async () => {
      const res = await client.query('controlCapabilities.getCapabilityEvents', {
        capabilityId: mfaId, organizationId,
      }, { tenantId: otherTenantId });
      expect(res.json.result.data).toEqual([]);
    });

    it('should book no job for tenant B out of a refused write', async () => {
      const jobs = await services.withOrigin({ type: 'system' })
        .jobs.listJobs({ tenantId: otherTenantId, kind: 'crq-simulation' });
      expect(jobs).toHaveLength(0);
    });
  });

  describe('outside any scope', () => {
    it('should read the tenant declaration whatever the overrides underneath say', async () => {
      await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(mfaId, 'L2', 'L2', null);
      await client.mutation('controlCapabilities.declareScopeControlPosture', {
        organizationId, capabilityId: mfaId, strengthRung: 'L0', coverageBucket: 'L0', comment: null,
      }, { tenantId });

      const res = await client.query('controlCapabilities.getResolvedControlPosture', { organizationId: null }, { tenantId });
      expect(res.status).toBe(200);
      const resolved: Array<{ capabilityId: string }> = res.json.result.data;
      const posture = resolved.find((entry) => entry.capabilityId === mfaId);
      expect(posture).toMatchObject({
        strengthRung: 'L2',
        coverageBucket: 'L2',
        strengthSource: 'tenant',
        coverageSource: 'tenant',
      });
    });

    it('should still write the tenant declaration from outside a scope', async () => {
      await client.mutation('controlCapabilities.declareScopeControlPosture', {
        organizationId, capabilityId: mfaId, strengthRung: 'L0', coverageBucket: 'L0', comment: null,
      }, { tenantId });

      const res = await client.mutation('controlCapabilities.upsertAssessment', {
        capabilityId: mfaId, strengthRung: 'L3', coverageBucket: 'L3', comment: null,
      }, { tenantId });
      expect(res.status).toBe(200);

      const capabilities = await services.withOrigin(adminOrigin).controlCapabilities.getControlCapabilities();
      expect(capabilities.find((capability) => capability.id === mfaId)!.assessment)
        .toMatchObject({ strengthRung: 'L3', coverageBucket: 'L3' });
    });
  });

  describe('what the screens read', () => {
    const resolvedMfa = async (scopeId: string | null) => {
      const res = await client.query('controlCapabilities.getResolvedControlPosture', { organizationId: scopeId }, { tenantId });
      expect(res.status).toBe(200);
      const resolved: Array<{ capabilityId: string }> = res.json.result.data;
      return resolved.find((entry) => entry.capabilityId === mfaId);
    };

    it('should name the tenant pair as null and no declaration date on a control nobody declared', async () => {
      expect(await resolvedMfa(organizationId)).toMatchObject({
        tenantStrengthRung: null,
        tenantCoverageBucket: null,
        scopeDeclaredAt: null,
      });
    });

    it('should name the tenant pair under a declared axis, and date the scope declaration', async () => {
      await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(mfaId, 'L2', 'L2', null);
      await client.mutation('controlCapabilities.declareScopeControlPosture', {
        organizationId, capabilityId: mfaId, strengthRung: null, coverageBucket: 'L0', comment: null,
      }, { tenantId });
      const [row] = await db.select().from(controlCapabilityScopeOverrides)
        .where(eq(controlCapabilityScopeOverrides.organizationId, organizationId));

      expect(await resolvedMfa(organizationId)).toMatchObject({
        strengthRung: 'L2',
        coverageBucket: 'L0',
        strengthSource: 'tenant',
        coverageSource: 'scope',
        tenantStrengthRung: 'L2',
        tenantCoverageBucket: 'L2',
        scopeDeclaredAt: row.updatedAt.toISOString(),
      });
    });

    it('should carry no declaration date outside any scope, whatever a scope declared', async () => {
      await client.mutation('controlCapabilities.declareScopeControlPosture', {
        organizationId, capabilityId: mfaId, strengthRung: 'L0', coverageBucket: null, comment: null,
      }, { tenantId });

      expect(await resolvedMfa(null)).toMatchObject({ strengthSource: 'tenant', scopeDeclaredAt: null });
    });
  });

  describe('a scenario’s controls', () => {
    let scenarioId: string;
    let otherOrganizationId: string;
    let linkedCapabilityId: string;

    const scenarioControl = async () => {
      const res = await client.query('riskScenarios.getControlCapabilitiesForRiskScenario', { riskScenarioId: scenarioId }, { tenantId });
      expect(res.status).toBe(200);
      const controls: Array<{ id: string }> = res.json.result.data;
      return controls.find((control) => control.id === linkedCapabilityId);
    };

    beforeEach(async () => {
      otherOrganizationId = uuidv7();
      await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id: otherOrganizationId, name: 'Retail banking' }]);

      const outcomeId = uuidv7();
      await db.insert(attackOutcomes).values([{
        id: outcomeId, tenantId, name: 'Outcome with T1003', description: null, referenceDwellDays: 7,
      }]);
      await db.insert(attackOutcomeMitreTechniques).values([{
        attackOutcomeId: outcomeId, mitreTechniqueId: TECHNIQUE_T1003, category: 'signature' as const,
      }]);
      scenarioId = uuidv7();
      await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
        id: scenarioId, organizationId, name: 'Credential theft', description: null, attackOutcomeId: outcomeId, primaryAssetIds: [],
      });
      await recomputeAttackOutcomeMixtures(services, tenantId);
      const controls = await services.withOrigin(adminOrigin).riskScenarios.getControlCapabilitiesForRiskScenario(scenarioId);
      linkedCapabilityId = controls[0].id;
      await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(linkedCapabilityId, 'L2', 'L2', null);
    });

    it('should read the posture of the scenario’s own scope, marking the declared axis', async () => {
      await client.mutation('controlCapabilities.declareScopeControlPosture', {
        organizationId, capabilityId: linkedCapabilityId, strengthRung: null, coverageBucket: 'L0', comment: null,
      }, { tenantId });

      expect(await scenarioControl()).toMatchObject({
        strengthRung: 'L2',
        coverageBucket: 'L0',
        strengthSource: 'tenant',
        coverageSource: 'scope',
        isAssessed: true,
      });
    });

    it('should ignore a declaration made on another scope of the same tenant', async () => {
      await client.mutation('controlCapabilities.declareScopeControlPosture', {
        organizationId: otherOrganizationId, capabilityId: linkedCapabilityId, strengthRung: 'L0', coverageBucket: 'L0', comment: null,
      }, { tenantId });

      expect(await scenarioControl()).toMatchObject({
        strengthRung: 'L2',
        coverageBucket: 'L2',
        strengthSource: 'tenant',
        coverageSource: 'tenant',
      });
    });
  });

  describe('the assessment save', () => {
    it('should refuse a save that names no axis', async () => {
      const res = await client.mutation('controlCapabilities.upsertAssessment', {
        capabilityId: mfaId, strengthRung: null, coverageBucket: null, comment: null,
      }, { tenantId });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.json)).toContain('A save names at least one axis');
    });
  });
});

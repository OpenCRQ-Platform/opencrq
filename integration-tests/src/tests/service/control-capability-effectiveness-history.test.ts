import type { EventOrigin } from '@app/module';
import { controlCapabilityAssessmentEvents, DERIVATION_WRITER } from '@app/module';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('Control capability effectiveness history', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let tenantId: string;
  let organizationId: string;
  let idpId: string;

  const scoped = () => services.withOrigin(adminOrigin);
  const historyOf = (scopeId: string | null, origin: EventOrigin = adminOrigin) =>
    services.withOrigin(origin).controlCapabilities.getEffectivenessHistory(idpId, scopeId);
  const pairs = (lines: Awaited<ReturnType<typeof historyOf>>) =>
    lines.map(({ posture }) => (posture === null ? null : `${posture.strengthRung}/${posture.coverageBucket}`));

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    tenantId = setup.tenantId;

    organizationId = uuidv7();
    await scoped().organizations.createOrganizations([{ id: organizationId, name: 'Payments platform' }]);

    const capabilities = await scoped().controlCapabilities.getControlCapabilities();
    idpId = capabilities.find((capability) => capability.externalId === 'IDP')!.id;
  });

  it('should replay the tenant journal, a derived line then a declared one', async () => {
    const serviceAccountId = uuidv7();
    await scoped().serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'Drata Bot' });
    await scoped().integrationSettings.configureIntegration('drata', serviceAccountId);
    await services.withOrigin({ type: 'connector', serviceAccountId, tenantId }).drata.replaceMirror({
      syncedAt: new Date(),
      frameworks: [],
      controls: ['DCF-58', 'DCF-67'].map((code) => ({
        drataId: Number(code.slice(4)), code, name: code, description: null,
        isReady: true, isMonitored: true, hasEvidence: true, hasPolicy: true, archivedAt: null,
      })),
    });
    await services.withOrigin({ type: 'job', tenantId, jobKind: 'capability-derivation', interactive: false })
      .controlCapabilities.rederiveAssessments();
    await scoped().controlCapabilities.upsertAssessment(idpId, 'L3', 'L3', 'Reason');

    const lines = await historyOf(null);

    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines[0].event?.connector).toBe(DERIVATION_WRITER);
    expect(lines[0].event?.sources).toContainEqual(expect.objectContaining({ source: 'drata' }));
    expect(lines.at(-1)).toMatchObject({
      posture: { strengthRung: 'L3', coverageBucket: 'L3' },
      event: { connector: null, userId: adminUserId, sources: [] },
    });
  });

  it('should merge a scope declaration with the tenant changes it inherits', async () => {
    await scoped().controlCapabilities.upsertAssessment(idpId, 'L1', 'L1', null);
    await scoped().controlCapabilities.declareScopePosture(organizationId, idpId, {
      strengthRung: 'L3', coverageBucket: null, comment: null,
    });
    await scoped().controlCapabilities.upsertAssessment(idpId, 'L2', 'L3', null);

    const lines = await historyOf(organizationId);

    expect(pairs(lines)).toEqual(['L1/L1', 'L3/L1', 'L3/L3']);
    expect(lines.map(({ event }) => event?.organizationId ?? null)).toEqual([null, organizationId, null]);
    expect(lines[2].posture).toMatchObject({ strengthSource: 'scope', coverageSource: 'tenant' });
  });

  it('should replay neither another scope’s lines nor another tenant’s', async () => {
    const otherScopeId = uuidv7();
    await scoped().organizations.createOrganizations([{ id: otherScopeId, name: 'Retail' }]);
    await scoped().controlCapabilities.upsertAssessment(idpId, 'L1', 'L1', null);
    await scoped().controlCapabilities.declareScopePosture(otherScopeId, idpId, {
      strengthRung: 'L3', coverageBucket: 'L3', comment: null,
    });
    const otherTenantId = await createTenant(services, adminUserId);
    await services.withOrigin({ type: 'client', userId: adminUserId, tenantId: otherTenantId })
      .controlCapabilities.upsertAssessment(idpId, 'L2', 'L2', null);

    const lines = await historyOf(organizationId);

    expect(pairs(lines)).toEqual(['L1/L1']);
    expect(lines.every(({ event }) => event?.tenantId === tenantId && event.organizationId === null)).toBe(true);
  });

  it('should refuse a scope of another tenant', async () => {
    const otherTenantId = await createTenant(services, adminUserId);
    const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };

    await expect(historyOf(organizationId, otherOrigin)).rejects.toThrow('Not Found');
  });

  it('should anchor on the live value a row holds with no journal line', async () => {
    await scoped().controlCapabilities.upsertAssessment(idpId, 'L2', 'L2', null);
    await db.delete(controlCapabilityAssessmentEvents).where(eq(controlCapabilityAssessmentEvents.capabilityId, idpId));

    const lines = await historyOf(null);

    expect(lines).toEqual([expect.objectContaining({ posture: expect.objectContaining({ strengthRung: 'L2', coverageBucket: 'L2' }), event: null })]);
  });
});

import type { EventOrigin } from '@app/module';
import { controlCapabilityAssessmentEvents, controlCapabilityScopeOverrides } from '@app/module';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('Control capability scope posture', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let tenantId: string;
  let organizationId: string;
  let idpId: string;
  let edrId: string;

  const scoped = () => services.withOrigin(adminOrigin);

  const postureOf = async (capabilityId: string, scopeId: string | null, origin: EventOrigin = adminOrigin) =>
    (await services.withOrigin(origin).controlCapabilities.getResolvedPosture(scopeId))
      .find((entry) => entry.capabilityId === capabilityId);

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
    edrId = capabilities.find((capability) => capability.externalId === 'EDR')!.id;
  });

  describe('resolution', () => {
    it('should follow the tenant declaration on a scope that declares nothing', async () => {
      await scoped().controlCapabilities.upsertAssessment(idpId, 'L2', 'L2', null);

      expect(await postureOf(idpId, organizationId)).toMatchObject({
        strengthRung: 'L2',
        coverageBucket: 'L2',
        strengthSource: 'tenant',
        coverageSource: 'tenant',
      });
    });

    it('should keep following the tenant on the axis the scope left inherited', async () => {
      await scoped().controlCapabilities.upsertAssessment(idpId, 'L2', 'L2', null);
      await scoped().controlCapabilities.declareScopePosture(organizationId, idpId, {
        strengthRung: null, coverageBucket: 'L0', comment: 'no MFA on this application',
      });

      await scoped().controlCapabilities.upsertAssessment(idpId, 'L3', 'L3', null);

      expect(await postureOf(idpId, organizationId)).toMatchObject({
        strengthRung: 'L3',
        strengthSource: 'tenant',
        coverageBucket: 'L0',
        coverageSource: 'scope',
      });
    });

    it('should read a value forced onto the tenant’s own as declared, and hold it when the tenant moves', async () => {
      await scoped().controlCapabilities.upsertAssessment(idpId, 'L2', 'L2', null);
      await scoped().controlCapabilities.declareScopePosture(organizationId, idpId, {
        strengthRung: 'L2', coverageBucket: null, comment: null,
      });

      expect(await postureOf(idpId, organizationId)).toMatchObject({ strengthRung: 'L2', strengthSource: 'scope' });

      await scoped().controlCapabilities.upsertAssessment(idpId, 'L3', 'L3', null);
      expect(await postureOf(idpId, organizationId)).toMatchObject({ strengthRung: 'L2', strengthSource: 'scope' });
    });

    it('should leave an overridden axis untouched when a derived tenant row moves', async () => {
      const serviceAccountId = uuidv7();
      await scoped().serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'Drata Bot' });
      await scoped().integrationSettings.configureIntegration('drata', serviceAccountId);
      const connectorOrigin: EventOrigin = { type: 'connector', serviceAccountId, tenantId };
      const jobOrigin: EventOrigin = { type: 'job', tenantId, jobKind: 'capability-derivation', interactive: false };
      // IGA's org-wide L1 pair DCF-70 alone reads L1 x L2; with every pair of IGA's evidence, L2 x L3,
      // so the tenant row moves on both axes.
      const igaId = (await scoped().controlCapabilities.getControlCapabilities())
        .find((capability) => capability.externalId === 'IGA')!.id;
      const deriveFromMirror = async (codes: Array<string>) => {
        await services.withOrigin(connectorOrigin).drata.replaceMirror({
          syncedAt: new Date(),
          frameworks: [],
          controls: codes.map((code) => ({
            drataId: Number(code.slice(4)), code, name: code, description: null,
            isReady: true, isMonitored: true, hasEvidence: true, hasPolicy: true, archivedAt: null,
          })),
        });
        await services.withOrigin(jobOrigin).controlCapabilities.rederiveAssessments();
      };
      await deriveFromMirror(['DCF-70']);
      await scoped().controlCapabilities.declareScopePosture(organizationId, igaId, {
        strengthRung: 'L0', coverageBucket: null, comment: null,
      });

      await deriveFromMirror(['DCF-43', 'DCF-70', 'DCF-335', 'DCF-11', 'DCF-524', 'DCF-894']);

      expect((await scoped().controlCapabilities.getControlCapability(igaId))!.assessment)
        .toMatchObject({ strengthRung: 'L2', coverageBucket: 'L3' });
      expect(await postureOf(igaId, organizationId)).toMatchObject({
        strengthRung: 'L0',
        strengthSource: 'scope',
        coverageBucket: 'L3',
        coverageSource: 'tenant',
      });
    });

    it('should follow the tenant again once the axis is cleared, with no further save', async () => {
      await scoped().controlCapabilities.upsertAssessment(idpId, 'L2', 'L2', null);
      await scoped().controlCapabilities.declareScopePosture(organizationId, idpId, {
        strengthRung: 'L0', coverageBucket: 'L0', comment: null,
      });

      await scoped().controlCapabilities.clearScopePostureDimension(organizationId, idpId, 'coverage');

      expect(await postureOf(idpId, organizationId)).toMatchObject({
        strengthRung: 'L0',
        strengthSource: 'scope',
        coverageBucket: 'L2',
        coverageSource: 'tenant',
      });
    });

    it('should delete the row once the last declared axis is cleared', async () => {
      await scoped().controlCapabilities.declareScopePosture(organizationId, idpId, {
        strengthRung: 'L1', coverageBucket: null, comment: null,
      });
      await scoped().controlCapabilities.clearScopePostureDimension(organizationId, idpId, 'strength');

      const rows = await db.select().from(controlCapabilityScopeOverrides)
        .where(eq(controlCapabilityScopeOverrides.organizationId, organizationId));
      expect(rows).toHaveLength(0);
    });

    it('should read the tenant declaration outside any scope, whatever the overrides underneath say', async () => {
      await scoped().controlCapabilities.upsertAssessment(idpId, 'L2', 'L2', null);
      await scoped().controlCapabilities.declareScopePosture(organizationId, idpId, {
        strengthRung: 'L0', coverageBucket: 'L0', comment: null,
      });

      expect(await postureOf(idpId, null)).toMatchObject({
        strengthRung: 'L2',
        coverageBucket: 'L2',
        strengthSource: 'tenant',
        coverageSource: 'tenant',
      });
    });

    it('should leave a scope that declared nothing on one control alone when another is declared', async () => {
      await scoped().controlCapabilities.upsertAssessment(edrId, 'L2', 'L2', null);
      await scoped().controlCapabilities.declareScopePosture(organizationId, idpId, {
        strengthRung: 'L0', coverageBucket: 'L0', comment: null,
      });

      expect(await postureOf(edrId, organizationId)).toMatchObject({
        strengthRung: 'L2',
        coverageBucket: 'L2',
        strengthSource: 'tenant',
      });
    });

    it('should never hand a scope the tenant’s justification for the value the scope contradicts', async () => {
      await scoped().controlCapabilities.upsertAssessment(idpId, 'L2', 'L2', 'validated by the compliance audit');
      await scoped().controlCapabilities.declareScopePosture(organizationId, idpId, {
        strengthRung: null, coverageBucket: 'L0', comment: null,
      });

      expect(await postureOf(idpId, organizationId)).toMatchObject({
        coverageBucket: 'L0',
        coverageSource: 'scope',
        comment: null,
      });
      expect(await postureOf(idpId, null)).toMatchObject({
        coverageBucket: 'L2',
        comment: 'validated by the compliance audit',
      });
    });
  });

  describe('what a scope write must not touch', () => {
    it('should leave the tenant provenance on the tenant declaration when a scope declares after it', async () => {
      await scoped().controlCapabilities.upsertAssessment(idpId, 'L2', 'L2', null);
      await scoped().controlCapabilities.declareScopePosture(organizationId, idpId, {
        strengthRung: null, coverageBucket: 'L0', comment: null,
      });

      const listed = (await scoped().controlCapabilities.getControlCapabilities())
        .find((capability) => capability.id === idpId);
      const detail = await scoped().controlCapabilities.getControlCapability(idpId);
      const tenantLine = (await scoped().controlCapabilities.getCapabilityEvents(idpId)).at(0);

      expect(listed?.lastAssessedAt).toEqual(tenantLine?.createdAt);
      expect(detail?.lastAssessedAt).toEqual(tenantLine?.createdAt);
    });

    it('should write nothing when a clear leaves an already inherited axis inherited', async () => {
      await scoped().controlCapabilities.declareScopePosture(organizationId, idpId, {
        strengthRung: null, coverageBucket: 'L0', comment: null,
      });
      const before = await db.select().from(controlCapabilityScopeOverrides)
        .where(eq(controlCapabilityScopeOverrides.organizationId, organizationId));

      await scoped().controlCapabilities.clearScopePostureDimension(organizationId, idpId, 'strength');

      const after = await db.select().from(controlCapabilityScopeOverrides)
        .where(eq(controlCapabilityScopeOverrides.organizationId, organizationId));
      expect(after[0]?.updatedAt).toEqual(before[0]?.updatedAt);
      const events = await db.select().from(controlCapabilityAssessmentEvents)
        .where(eq(controlCapabilityAssessmentEvents.capabilityId, idpId));
      expect(events).toHaveLength(1);
    });

    it('should refuse a clear naming a capability that does not exist', async () => {
      await expect(scoped().controlCapabilities.clearScopePostureDimension(organizationId, uuidv7(), 'strength'))
        .rejects.toThrow();
    });
  });

  describe('the journal', () => {
    it('should write the scope’s own line, carrying that scope and no other', async () => {
      await scoped().controlCapabilities.declareScopePosture(organizationId, idpId, {
        strengthRung: 'L0', coverageBucket: 'L0', comment: 'no WAF here',
      });

      const events = await db.select().from(controlCapabilityAssessmentEvents)
        .where(eq(controlCapabilityAssessmentEvents.capabilityId, idpId));
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        organizationId,
        tenantId,
        userId: adminUserId,
        connector: null,
        type: 'assessment_set',
        oldStrength: null,
        newStrength: 'L0',
        oldCoverage: null,
        newCoverage: 'L0',
        comment: 'no WAF here',
      });
    });

    it('should journal a clear with no justification of its own', async () => {
      await scoped().controlCapabilities.declareScopePosture(organizationId, idpId, {
        strengthRung: null, coverageBucket: 'L0', comment: 'no WAF on this application',
      });
      await scoped().controlCapabilities.clearScopePostureDimension(organizationId, idpId, 'coverage');

      const events = await db.select().from(controlCapabilityAssessmentEvents)
        .where(eq(controlCapabilityAssessmentEvents.capabilityId, idpId));
      expect(events).toHaveLength(2);
      expect(events.at(-1)).toMatchObject({ type: 'coverage_change', oldCoverage: 'L0', newCoverage: null, comment: null });
    });

    it('should leave the tenant declaration’s own lines with no scope', async () => {
      await scoped().controlCapabilities.upsertAssessment(idpId, 'L2', 'L2', null);

      const events = await db.select().from(controlCapabilityAssessmentEvents)
        .where(eq(controlCapabilityAssessmentEvents.capabilityId, idpId));
      expect(events).toHaveLength(1);
      expect(events[0].organizationId).toBeNull();
    });

    it('should record a forced value equal to the tenant’s, which moved the declaration', async () => {
      await scoped().controlCapabilities.upsertAssessment(idpId, 'L2', 'L2', null);
      await scoped().controlCapabilities.declareScopePosture(organizationId, idpId, {
        strengthRung: 'L2', coverageBucket: null, comment: null,
      });

      const scopeEvents = await db.select().from(controlCapabilityAssessmentEvents)
        .where(eq(controlCapabilityAssessmentEvents.organizationId, organizationId));
      expect(scopeEvents).toHaveLength(1);
      expect(scopeEvents[0]).toMatchObject({ type: 'assessment_set', newStrength: 'L2', newCoverage: null });
    });

    it('should read one chronology inside a scope and the tenant’s alone outside it', async () => {
      await scoped().controlCapabilities.upsertAssessment(idpId, 'L2', 'L2', null);
      await scoped().controlCapabilities.declareScopePosture(organizationId, idpId, {
        strengthRung: 'L0', coverageBucket: null, comment: null,
      });

      const inScope = await scoped().controlCapabilities.getCapabilityEvents(idpId, organizationId);
      expect(inScope.map((event) => event.organizationId).sort()).toEqual([organizationId, null]);

      const outside = await scoped().controlCapabilities.getCapabilityEvents(idpId);
      expect(outside).toHaveLength(1);
      expect(outside[0].organizationId).toBeNull();
    });
  });

  // Tenant B is the same human behind a different `x-tenant-id`, the shape a crafted call takes.
  describe('security policy', () => {
    let otherOrigin: EventOrigin;

    beforeEach(async () => {
      const otherTenantId = await createTenant(services, adminUserId);
      otherOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };
      await scoped().controlCapabilities.declareScopePosture(organizationId, idpId, {
        strengthRung: 'L0', coverageBucket: 'L0', comment: 'tenant A only',
      });
    });

    it('should hide tenant A’s scope from tenant B’s resolution', async () => {
      await expect(
        services.withOrigin(otherOrigin).controlCapabilities.getResolvedPosture(organizationId),
      ).rejects.toThrow('Not Found');
    });

    it('should refuse a declaration by tenant B on tenant A’s scope', async () => {
      await expect(
        services.withOrigin(otherOrigin).controlCapabilities.declareScopePosture(organizationId, idpId, {
          strengthRung: 'L3', coverageBucket: 'L3', comment: null,
        }),
      ).rejects.toThrow('Not Found');

      const rows = await db.select().from(controlCapabilityScopeOverrides)
        .where(eq(controlCapabilityScopeOverrides.organizationId, organizationId));
      expect(rows[0]).toMatchObject({ strengthRung: 'L0', coverageBucket: 'L0' });
    });

    it('should refuse a clear by tenant B on tenant A’s scope', async () => {
      await expect(
        services.withOrigin(otherOrigin).controlCapabilities.clearScopePostureDimension(organizationId, idpId, 'coverage'),
      ).rejects.toThrow('Not Found');

      const rows = await db.select().from(controlCapabilityScopeOverrides)
        .where(eq(controlCapabilityScopeOverrides.organizationId, organizationId));
      expect(rows[0]).toMatchObject({ coverageBucket: 'L0' });
    });

    it('should keep tenant A’s scope line out of tenant B’s chronology', async () => {
      const events = await services.withOrigin(otherOrigin).controlCapabilities.getCapabilityEvents(idpId);
      expect(events).toHaveLength(0);
    });

    it('should leave tenant B its own resolution, on the tenant declaration alone', async () => {
      const posture = await services.withOrigin(otherOrigin).controlCapabilities.getResolvedPosture(null);
      expect(posture.find((entry) => entry.capabilityId === idpId)).toMatchObject({
        strengthRung: 'L0',
        coverageBucket: 'L0',
        strengthSource: 'tenant',
        coverageSource: 'tenant',
      });
    });
  });

  describe('cascade', () => {
    it('should take a scope’s overrides with the scope', async () => {
      await scoped().controlCapabilities.declareScopePosture(organizationId, idpId, {
        strengthRung: 'L0', coverageBucket: 'L0', comment: null,
      });

      await scoped().organizations.deleteOrganizations([organizationId]);

      const rows = await db.select().from(controlCapabilityScopeOverrides)
        .where(eq(controlCapabilityScopeOverrides.organizationId, organizationId));
      expect(rows).toHaveLength(0);
    });
  });
});

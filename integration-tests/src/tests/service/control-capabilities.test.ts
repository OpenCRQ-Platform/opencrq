import type { EventOrigin } from '@app/module';
import { attackOutcomeMitreTechniques, attackOutcomes, TECHNIQUE_T1003 } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { recomputeAttackOutcomeMixtures } from '../../helpers/attack-outcome-mixtures';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('Control Capability Service', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let tenantId: string;

  const getIdp = async (origin: EventOrigin) => {
    const capabilities = await services.withOrigin(origin).controlCapabilities.getControlCapabilities();
    return capabilities.find((c) => c.externalId === 'IDP')!;
  };

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    tenantId = setup.tenantId;
  });

  describe('getControlCapabilities', () => {
    it('lists the seeded IDP capability as never declared, with no provenance', async () => {
      const idp = await getIdp(adminOrigin);
      expect(idp).toBeTruthy();
      expect(idp.name).toBe('Identity Platform (IdP, SSO, MFA, Conditional Access)');
      expect(idp.assessment).toBeNull();
      expect(idp.lastAssessedAt).toBeNull();
      expect(idp.lastAssessedBy).toBeNull();
    });

    it('lists the controls in the catalogue\'s order, each with its domain', async () => {
      const listed = await services.withOrigin(adminOrigin).controlCapabilities.getControlCapabilities();

      expect(listed.map((control) => control.position)).toEqual(listed.map((_, index) => index + 1));
      expect(listed.slice(0, 3).map((control) => [control.externalId, control.domain])).toEqual([
        ['EDR', 'endpoints_and_servers'], ['OSH', 'endpoints_and_servers'], ['FIM', 'endpoints_and_servers'],
      ]);
    });

    it('reads a declaration at the floor rung as a real assessment carrying provenance', async () => {
      const idp = await getIdp(adminOrigin);
      await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(idp.id, 'L0', 'L0', null);

      const declared = await getIdp(adminOrigin);
      expect(declared.assessment).toEqual({ strengthRung: 'L0', coverageBucket: 'L0', strengthMode: 'manual', coverageMode: 'manual', coverageBasis: 'declared', comment: null });
      expect(declared.lastAssessedAt).toBeInstanceOf(Date);
      expect(declared.lastAssessedBy).toEqual({ userId: adminUserId, name: null });
    });

    it('mirrors the detail read: the same control reads the same way in both', async () => {
      const idp = await getIdp(adminOrigin);
      await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(idp.id, 'L2', 'L2', null);

      const listed = await getIdp(adminOrigin);
      const detail = await services.withOrigin(adminOrigin).controlCapabilities.getControlCapability(idp.id);
      expect(detail!.assessment).toEqual(listed.assessment);
      expect(detail!.lastAssessedAt?.getTime()).toBe(listed.lastAssessedAt?.getTime());
      expect(detail!.lastAssessedBy).toEqual(listed.lastAssessedBy);
    });

    it('keeps the later of two declarations as the provenance', async () => {
      const idp = await getIdp(adminOrigin);
      await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(idp.id, 'L1', 'L1', null);
      const first = (await getIdp(adminOrigin)).lastAssessedAt!;
      await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(idp.id, 'L3', 'L3', null);

      const events = await services.withOrigin(adminOrigin).controlCapabilities.getCapabilityEvents(idp.id);
      expect(events).toHaveLength(2);
      const latest = (await getIdp(adminOrigin)).lastAssessedAt!;
      expect(latest.getTime()).toBeGreaterThanOrEqual(first.getTime());
      expect(latest.getTime()).toBe(events[0].createdAt.getTime());
    });

    it('returns one row per control however many events a control carries', async () => {
      const before = await services.withOrigin(adminOrigin).controlCapabilities.getControlCapabilities();
      const idp = before.find((c) => c.externalId === 'IDP')!;
      await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(idp.id, 'L1', 'L1', null);
      await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(idp.id, 'L2', 'L2', null);
      await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(idp.id, 'L3', 'L3', null);

      const after = await services.withOrigin(adminOrigin).controlCapabilities.getControlCapabilities();
      expect(after).toHaveLength(before.length);
      expect(after.filter((c) => c.externalId === 'IDP')).toHaveLength(1);
    });

    it('gives each control its own latest declaration, and none to a control never declared', async () => {
      const [first, second, undeclared] = await services.withOrigin(adminOrigin).controlCapabilities.getControlCapabilities();
      await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(first.id, 'L1', 'L1', null);
      await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(second.id, 'L2', 'L2', null);
      const [firstEvent] = await services.withOrigin(adminOrigin).controlCapabilities.getCapabilityEvents(first.id);
      const [secondEvent] = await services.withOrigin(adminOrigin).controlCapabilities.getCapabilityEvents(second.id);

      const listed = new Map((await services.withOrigin(adminOrigin).controlCapabilities.getControlCapabilities()).map((c) => [c.id, c]));
      expect(listed.get(first.id)!.lastAssessedAt?.getTime()).toBe(firstEvent.createdAt.getTime());
      expect(listed.get(second.id)!.lastAssessedAt?.getTime()).toBe(secondEvent.createdAt.getTime());
      expect(listed.get(undeclared.id)!.lastAssessedAt).toBeNull();
      expect(listed.get(undeclared.id)!.lastAssessedBy).toBeNull();
    });

    it('is global reference data visible to every tenant', async () => {
      const tenantBId = await createTenant(services, adminUserId);
      const originB: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };
      const fromA = await services.withOrigin(adminOrigin).controlCapabilities.getControlCapabilities();
      const fromB = await services.withOrigin(originB).controlCapabilities.getControlCapabilities();
      expect(fromA.length).toBe(fromB.length);
    });
  });

  describe('queryCapabilityResistanceInputs', () => {
    it('still feeds the engine the L0 / L0 baseline for an undeclared control', async () => {
      const inputs = await services.withOrigin(adminOrigin)
        .controlCapabilities.queryCapabilityResistanceInputs([TECHNIQUE_T1003], tenantId);

      expect(inputs.states.length).toBeGreaterThan(0);
      expect(inputs.states.every((s) => s.strengthRung === 'L0' && s.coverageBucket === 'L0')).toBe(true);
    });
  });

  describe('getControlCapability', () => {
    it('returns the rich detail (edges, rungs, crosswalk)', async () => {
      const idp = await getIdp(adminOrigin);
      const detail = await services.withOrigin(adminOrigin).controlCapabilities.getControlCapability(idp.id);
      expect(detail).toBeTruthy();
      expect(detail!.edges).toHaveLength(217);
      expect(detail!.rungs.map((r) => r.rung).sort()).toEqual(['L0', 'L1', 'L2', 'L3']);
      expect(detail!.crosswalk).toHaveLength(50);
      // Edges carry the rich link data the techniques tab renders.
      const t1078 = detail!.edges.filter((e) => e.techniqueExternalId === 'T1078');
      expect(t1078.map((e) => e.function).sort()).toEqual(['detect', 'prevent']);
      expect(t1078.every((e) => e.source === 'catalogue' && e.state === 'recommended')).toBe(true);
    });

    it('returns undefined for an unknown id', async () => {
      const detail = await services.withOrigin(adminOrigin).controlCapabilities.getControlCapability(uuidv7());
      expect(detail).toBeUndefined();
    });
  });

  describe('upsertAssessment', () => {
    it('creates an assessment and an assessment_set event', async () => {
      const idp = await getIdp(adminOrigin);
      await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(idp.id, 'L2', 'L2', 'Rolled out');

      const detail = await services.withOrigin(adminOrigin).controlCapabilities.getControlCapability(idp.id);
      expect(detail!.assessment).toEqual({ strengthRung: 'L2', coverageBucket: 'L2', strengthMode: 'manual', coverageMode: 'manual', coverageBasis: 'declared', comment: 'Rolled out' });

      const events = await services.withOrigin(adminOrigin).controlCapabilities.getCapabilityEvents(idp.id);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('assessment_set');
      expect(events[0].newStrength).toBe('L2');
      expect(events[0].newCoverage).toBe('L2');
    });

    it('records a strength_change event when only the rung changes', async () => {
      const idp = await getIdp(adminOrigin);
      await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(idp.id, 'L1', 'L2', null);
      await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(idp.id, 'L3', 'L2', null);

      const events = await services.withOrigin(adminOrigin).controlCapabilities.getCapabilityEvents(idp.id);
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('strength_change');
      expect(events[0].oldStrength).toBe('L1');
      expect(events[0].newStrength).toBe('L3');
    });

    it('records a coverage_change event when only coverage changes', async () => {
      const idp = await getIdp(adminOrigin);
      await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(idp.id, 'L2', 'L1', null);
      await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(idp.id, 'L2', 'L3', null);

      const events = await services.withOrigin(adminOrigin).controlCapabilities.getCapabilityEvents(idp.id);
      expect(events[0].type).toBe('coverage_change');
      expect(events[0].oldCoverage).toBe('L1');
      expect(events[0].newCoverage).toBe('L3');
    });

    it('records an assessment_change event carrying both deltas when both axes move in one save', async () => {
      const idp = await getIdp(adminOrigin);
      await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(idp.id, 'L1', 'L1', null);
      await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(idp.id, 'L3', 'L3', null);

      const events = await services.withOrigin(adminOrigin).controlCapabilities.getCapabilityEvents(idp.id);
      expect(events).toHaveLength(2);
      // A single save moving both axes must not be typed strength-only: both deltas stay auditable.
      expect(events[0].type).toBe('assessment_change');
      expect(events[0].oldStrength).toBe('L1');
      expect(events[0].newStrength).toBe('L3');
      expect(events[0].oldCoverage).toBe('L1');
      expect(events[0].newCoverage).toBe('L3');
    });

    it('is idempotent: re-saving identical values writes no new event', async () => {
      const idp = await getIdp(adminOrigin);
      await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(idp.id, 'L2', 'L3', null);
      await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(idp.id, 'L2', 'L3', null);
      const events = await services.withOrigin(adminOrigin).controlCapabilities.getCapabilityEvents(idp.id);
      expect(events).toHaveLength(1);
    });
  });

  describe('tenant isolation', () => {
    it('does not leak one tenant assessment to another', async () => {
      const idp = await getIdp(adminOrigin);
      await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(idp.id, 'L3', 'L3', 'Secret');

      const tenantBId = await createTenant(services, adminUserId);
      const originB: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };

      const detailB = await services.withOrigin(originB).controlCapabilities.getControlCapability(idp.id);
      expect(detailB!.assessment).toBeNull();
      expect(detailB!.lastAssessedAt).toBeNull();
      expect(detailB!.lastAssessedBy).toBeNull();

      const eventsB = await services.withOrigin(originB).controlCapabilities.getCapabilityEvents(idp.id);
      expect(eventsB).toHaveLength(0);
    });
  });

  // Controls (capabilities) and risk scenarios are linked indirectly via shared MITRE techniques.
  // A capability covers T1003 (OS Credential Dumping) via the catalogue edges, and T1003 carries
  // threat-signal weight (active), so a scenario whose outcome has T1003 links to at least one
  // capability.
  describe('control ↔ risk scenario link tenant isolation', () => {
    let scenarioId: string;
    let linkedCapabilityId: string;
    let organizationId: string;
    let outcomeId: string;

    beforeEach(async () => {
      organizationId = uuidv7();
      await services.withOrigin(adminOrigin).organizations.createOrganizations([
        { id: organizationId, name: 'Test Organization' },
      ]);

      outcomeId = uuidv7();
      // A synthetic outcome rather than one of the seven the tenant already carries, so the fixture
      // owns the technique link. Reference dwell is NOT NULL, so it must be supplied.
      await db.insert(attackOutcomes).values([{
        id: outcomeId,
        tenantId,
        name: 'Outcome with T1003',
        description: null,
        referenceDwellDays: 7,
      }]);
      await db.insert(attackOutcomeMitreTechniques).values([{
        attackOutcomeId: outcomeId,
        mitreTechniqueId: TECHNIQUE_T1003,
        category: 'signature' as const,
      }]);

      scenarioId = uuidv7();
      await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
        id: scenarioId,
        organizationId,
        name: 'Tenant A scenario',
        description: null,
        attackOutcomeId: outcomeId,
        primaryAssetIds: [],
      });
      await recomputeAttackOutcomeMixtures(services, tenantId);

      const capsA = await services.withOrigin(adminOrigin).riskScenarios.getControlCapabilitiesForRiskScenario(scenarioId);
      linkedCapabilityId = capsA[0].id;
    });

    it('getControlCapabilitiesForRiskScenario: tenant B cannot resolve tenant A scenario', async () => {
      const capsA = await services.withOrigin(adminOrigin).riskScenarios.getControlCapabilitiesForRiskScenario(scenarioId);
      // Sanity: tenant A's own scenario resolves to at least one capability (T1003 coverage),
      // so the empty result below is real isolation, not a vacuously-empty query.
      expect(capsA.length).toBeGreaterThan(0);

      const tenantBId = await createTenant(services, adminUserId);
      const originB: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };
      const capsB = await services.withOrigin(originB).riskScenarios.getControlCapabilitiesForRiskScenario(scenarioId);
      // Tenant B's view hides tenant A's scenario, so no capabilities leak across the boundary.
      expect(capsB).toHaveLength(0);
    });

    it('getControlCapabilitiesForRiskScenario: an undeclared control keeps the baseline and is flagged unassessed', async () => {
      const caps = await services.withOrigin(adminOrigin).riskScenarios.getControlCapabilitiesForRiskScenario(scenarioId);
      const undeclared = caps.find((c) => c.id === linkedCapabilityId)!;
      expect(undeclared.isAssessed).toBe(false);
      expect(undeclared.strengthRung).toBe('L0');
      expect(undeclared.coverageBucket).toBe('L0');

      await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(linkedCapabilityId, 'L0', 'L0', null);

      const afterDeclaring = await services.withOrigin(adminOrigin).riskScenarios.getControlCapabilitiesForRiskScenario(scenarioId);
      const declared = afterDeclaring.find((c) => c.id === linkedCapabilityId)!;
      expect(declared.isAssessed).toBe(true);
      expect(declared.strengthRung).toBe('L0');
      expect(declared.coverageBucket).toBe('L0');
    });

    it('should list a scenario linked to the control to its own tenant only', async () => {
      const scenariosA = await services.withOrigin(adminOrigin)
        .controlCapabilities.getControlCapabilityRiskScenarios(linkedCapabilityId);
      expect(scenariosA.some((s) => s.id === scenarioId)).toBe(true);

      const tenantBId = await createTenant(services, adminUserId);
      const originB: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };
      const scenariosB = await services.withOrigin(originB)
        .controlCapabilities.getControlCapabilityRiskScenarios(linkedCapabilityId);
      expect(scenariosB.some((s) => s.id === scenarioId)).toBe(false);
    });

    it('should narrow the linked scenarios to the organization asked for', async () => {
      const otherOrganizationId = uuidv7();
      await services.withOrigin(adminOrigin).organizations.createOrganizations([
        { id: otherOrganizationId, name: 'Other Organization' },
      ]);
      const otherScenarioId = uuidv7();
      await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
        id: otherScenarioId,
        organizationId: otherOrganizationId,
        name: 'Other organization scenario',
        description: null,
        attackOutcomeId: outcomeId,
        primaryAssetIds: [],
      });
      await recomputeAttackOutcomeMixtures(services, tenantId);

      const narrowed = await services.withOrigin(adminOrigin)
        .controlCapabilities.getControlCapabilityRiskScenarios(linkedCapabilityId, organizationId);
      expect(narrowed.map((s) => s.id)).toEqual([scenarioId]);

      const unscoped = await services.withOrigin(adminOrigin)
        .controlCapabilities.getControlCapabilityRiskScenarios(linkedCapabilityId);
      expect(unscoped.map((s) => s.id)).toEqual(expect.arrayContaining([scenarioId, otherScenarioId]));
    });

    it('should list a scenario the job has not computed yet as pending, beside a computed one', async () => {
      const pendingOrganizationId = uuidv7();
      await services.withOrigin(adminOrigin).organizations.createOrganizations([
        { id: pendingOrganizationId, name: 'Organization not computed yet' },
      ]);
      const pendingScenarioId = uuidv7();
      await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
        id: pendingScenarioId,
        organizationId: pendingOrganizationId,
        name: 'Scenario not computed yet',
        description: null,
        attackOutcomeId: outcomeId,
        primaryAssetIds: [],
      });

      const scenarios = await services.withOrigin(adminOrigin)
        .controlCapabilities.getControlCapabilityRiskScenarios(linkedCapabilityId);

      expect(scenarios.find((s) => s.id === pendingScenarioId)).toMatchObject({ mixturePending: true, sharedTtpCount: 0 });
      expect(scenarios.find((s) => s.id === scenarioId)?.mixturePending).toBe(false);
    });

    it('should stop linking a scenario through a technique the tenant removed from the control', async () => {
      const scoped = services.withOrigin(adminOrigin).controlCapabilities;
      const capability = await scoped.getControlCapability(linkedCapabilityId);
      const sharedEdges = capability!.edges.filter((e) => e.techniqueId === TECHNIQUE_T1003 && e.state !== 'removed');
      expect(sharedEdges.length).toBeGreaterThan(0);

      for (const edge of sharedEdges) {
        await scoped.removeTechnique(linkedCapabilityId, edge.techniqueId, edge.function);
      }

      const scenarios = await scoped.getControlCapabilityRiskScenarios(linkedCapabilityId, organizationId);
      expect(scenarios.some((s) => s.id === scenarioId)).toBe(false);
    });

    it('should link the scenario again once the removed technique is restored', async () => {
      const scoped = services.withOrigin(adminOrigin).controlCapabilities;
      const capability = await scoped.getControlCapability(linkedCapabilityId);
      const sharedEdges = capability!.edges.filter((e) => e.techniqueId === TECHNIQUE_T1003 && e.state === 'recommended');
      for (const edge of sharedEdges) {
        await scoped.removeTechnique(linkedCapabilityId, edge.techniqueId, edge.function);
      }

      await scoped.restoreTechnique(linkedCapabilityId, TECHNIQUE_T1003, sharedEdges[0].function);

      const scenarios = await scoped.getControlCapabilityRiskScenarios(linkedCapabilityId, organizationId);
      expect(scenarios.find((s) => s.id === scenarioId)?.sharedTtpCount).toBeGreaterThan(0);
    });

    it('should keep linking a scenario through a technique removed on one function only', async () => {
      const scoped = services.withOrigin(adminOrigin).controlCapabilities;
      const before = await scoped.getControlCapability(linkedCapabilityId);
      const carried = new Set(before!.edges.filter((e) => e.techniqueId === TECHNIQUE_T1003).map((e) => e.function));
      // T1003 must sit on both functions before one of them is removed: add it where the catalogue does not.
      for (const fn of (['prevent', 'detect'] as const).filter((f) => !carried.has(f))) {
        await scoped.addTechnique(linkedCapabilityId, TECHNIQUE_T1003, fn);
      }

      await scoped.removeTechnique(linkedCapabilityId, TECHNIQUE_T1003, 'prevent');

      const after = await scoped.getControlCapability(linkedCapabilityId);
      const t1003 = after!.edges.filter((e) => e.techniqueId === TECHNIQUE_T1003);
      expect(t1003.some((e) => e.function === 'prevent' && e.state !== 'removed')).toBe(false);
      expect(t1003.some((e) => e.function === 'detect' && e.state !== 'removed')).toBe(true);

      const scenarios = await scoped.getControlCapabilityRiskScenarios(linkedCapabilityId, organizationId);
      expect(scenarios.find((s) => s.id === scenarioId)?.sharedTtpCount).toBeGreaterThan(0);
    });

    it('should link no scenario to an unknown control', async () => {
      const scenarios = await services.withOrigin(adminOrigin)
        .controlCapabilities.getControlCapabilityRiskScenarios(uuidv7());
      expect(scenarios).toEqual([]);
    });
  });
});

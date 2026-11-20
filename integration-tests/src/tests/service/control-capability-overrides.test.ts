import type { CapabilityFunction, EventOrigin } from '@app/module';
import {
  computeTechniqueResistance,
  securityPlatformFamilies,
  securityPlatformFamilyControls,
  seed,
  STRENGTH_BY_RUNG,
  TECHNIQUE_T1005,
  TECHNIQUE_T1078,
  TECHNIQUE_T1111,
  TECHNIQUE_T1530,
} from '@app/module';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

// IDP prevents T1078 (Valid Accounts) in the catalogue and does not cover T1005 (Data from
// Local System), so the two techniques exercise a removal and an addition respectively.
describe('Control capability technique overrides', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let idpId: string;
  // CLDH recommends T1530 on both functions, so it exercises an edit that must stay inside one.
  let cldhId: string;

  const detail = (origin: EventOrigin) =>
    services.withOrigin(origin).controlCapabilities.getControlCapability(idpId);

  const edgeFor = async (origin: EventOrigin, techniqueExternalId: string, fn: CapabilityFunction) =>
    (await detail(origin))!.edges.find((e) => e.techniqueExternalId === techniqueExternalId && e.function === fn);

  const cldhEdgeFor = async (techniqueExternalId: string, fn: CapabilityFunction) =>
    (await services.withOrigin(adminOrigin).controlCapabilities.getControlCapability(cldhId))!
      .edges.find((e) => e.techniqueExternalId === techniqueExternalId && e.function === fn);

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    const capabilities = await services.withOrigin(adminOrigin).controlCapabilities.getControlCapabilities();
    idpId = capabilities.find((c) => c.externalId === 'IDP')!.id;
    cldhId = capabilities.find((c) => c.externalId === 'CLDH')!.id;
  });

  describe('lifecycle', () => {
    it('adds a technique the catalogue does not recommend, flagged as a tenant addition', async () => {
      await services.withOrigin(adminOrigin).controlCapabilities.addTechnique(idpId, TECHNIQUE_T1005, 'detect');

      const added = await edgeFor(adminOrigin, 'T1005', 'detect');
      expect(added).toMatchObject({ function: 'detect', source: 'tenant', state: 'added' });
    });

    it('refuses to add a technique the catalogue already recommends', async () => {
      await expect(
        services.withOrigin(adminOrigin).controlCapabilities.addTechnique(idpId, TECHNIQUE_T1078, 'prevent'),
      ).rejects.toThrow();
    });

    it('keeps a removed recommendation visible, flagged removed', async () => {
      await services.withOrigin(adminOrigin).controlCapabilities.removeTechnique(idpId, TECHNIQUE_T1078, 'prevent');

      const removed = await edgeFor(adminOrigin, 'T1078', 'prevent');
      expect(removed).toMatchObject({ function: 'prevent', source: 'catalogue', state: 'removed' });
    });

    it('restores a removed recommendation', async () => {
      await services.withOrigin(adminOrigin).controlCapabilities.removeTechnique(idpId, TECHNIQUE_T1078, 'prevent');
      await services.withOrigin(adminOrigin).controlCapabilities.restoreTechnique(idpId, TECHNIQUE_T1078, 'prevent');

      expect(await edgeFor(adminOrigin, 'T1078', 'prevent')).toMatchObject({ source: 'catalogue', state: 'recommended' });
    });

    it('removing an addition erases it, leaving no trace to restore', async () => {
      await services.withOrigin(adminOrigin).controlCapabilities.addTechnique(idpId, TECHNIQUE_T1005, 'detect');
      await services.withOrigin(adminOrigin).controlCapabilities.removeTechnique(idpId, TECHNIQUE_T1005, 'detect');

      expect(await edgeFor(adminOrigin, 'T1005', 'detect')).toBeUndefined();
      await expect(
        services.withOrigin(adminOrigin).controlCapabilities.restoreTechnique(idpId, TECHNIQUE_T1005, 'detect'),
      ).rejects.toThrow();
    });

    it('resets the control to pure catalogue recommendations', async () => {
      await services.withOrigin(adminOrigin).controlCapabilities.removeTechnique(idpId, TECHNIQUE_T1078, 'prevent');
      await services.withOrigin(adminOrigin).controlCapabilities.addTechnique(idpId, TECHNIQUE_T1005, 'detect');

      await services.withOrigin(adminOrigin).controlCapabilities.resetTechniqueOverrides(idpId);

      const edges = (await detail(adminOrigin))!.edges;
      expect(edges).toHaveLength(217);
      expect(edges.every((e) => e.source === 'catalogue' && e.state === 'recommended')).toBe(true);
    });
  });

  describe('per-function grain', () => {
    it('removing a technique from prevention leaves its detection recommendation alone', async () => {
      await services.withOrigin(adminOrigin).controlCapabilities.removeTechnique(cldhId, TECHNIQUE_T1530, 'prevent');

      expect(await cldhEdgeFor('T1530', 'prevent')).toMatchObject({ state: 'removed' });
      expect(await cldhEdgeFor('T1530', 'detect')).toMatchObject({ state: 'recommended' });
    });

    it('restoring one function does not disturb the other function still removed', async () => {
      await services.withOrigin(adminOrigin).controlCapabilities.removeTechnique(cldhId, TECHNIQUE_T1530, 'prevent');
      await services.withOrigin(adminOrigin).controlCapabilities.removeTechnique(cldhId, TECHNIQUE_T1530, 'detect');

      await services.withOrigin(adminOrigin).controlCapabilities.restoreTechnique(cldhId, TECHNIQUE_T1530, 'prevent');

      expect(await cldhEdgeFor('T1530', 'prevent')).toMatchObject({ state: 'recommended' });
      expect(await cldhEdgeFor('T1530', 'detect')).toMatchObject({ state: 'removed' });
    });

    it('adds a technique on the function the catalogue leaves out and keeps the recommended one', async () => {
      await services.withOrigin(adminOrigin).controlCapabilities.addTechnique(idpId, TECHNIQUE_T1111, 'detect');

      const edges = (await detail(adminOrigin))!.edges.filter((e) => e.techniqueExternalId === 'T1111');
      expect(edges.map((e) => [e.function, e.source, e.state]).sort()).toEqual([
        ['detect', 'tenant', 'added'],
        ['prevent', 'catalogue', 'recommended'],
      ]);
    });

    it('refuses a second addition on the same function', async () => {
      await services.withOrigin(adminOrigin).controlCapabilities.addTechnique(idpId, TECHNIQUE_T1005, 'detect');

      await expect(
        services.withOrigin(adminOrigin).controlCapabilities.addTechnique(idpId, TECHNIQUE_T1005, 'detect'),
      ).rejects.toThrow();
    });

    it('a scoped reset discards that function only, additions and removals alike', async () => {
      await services.withOrigin(adminOrigin).controlCapabilities.removeTechnique(cldhId, TECHNIQUE_T1530, 'prevent');
      await services.withOrigin(adminOrigin).controlCapabilities.removeTechnique(cldhId, TECHNIQUE_T1530, 'detect');
      await services.withOrigin(adminOrigin).controlCapabilities.addTechnique(cldhId, TECHNIQUE_T1005, 'prevent');

      await services.withOrigin(adminOrigin).controlCapabilities.resetTechniqueOverrides(cldhId, 'prevent');

      expect(await cldhEdgeFor('T1530', 'prevent')).toMatchObject({ state: 'recommended' });
      expect(await cldhEdgeFor('T1530', 'detect')).toMatchObject({ state: 'removed' });
      expect(await cldhEdgeFor('T1005', 'prevent')).toBeUndefined();
    });

    it('carries each covered technique its ATT&CK tactics', async () => {
      const edge = await cldhEdgeFor('T1530', 'prevent');
      expect(edge!.tactics.length).toBeGreaterThan(0);
      expect(edge!.tactics.every((tactic) => tactic.name.length > 0 && tactic.externalId.startsWith('TA'))).toBe(true);
    });
  });

  describe('tenant isolation', () => {
    it('another tenant reads the pure catalogue', async () => {
      await services.withOrigin(adminOrigin).controlCapabilities.removeTechnique(idpId, TECHNIQUE_T1078, 'prevent');
      await services.withOrigin(adminOrigin).controlCapabilities.addTechnique(idpId, TECHNIQUE_T1005, 'detect');

      const tenantBId = await createTenant(services, adminUserId);
      const originB: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };

      const edgesB = (await detail(originB))!.edges;
      expect(edgesB).toHaveLength(217);
      expect(edgesB.every((e) => e.state === 'recommended')).toBe(true);
    });
  });

  describe('resolution feeds the engine', () => {
    const resistanceFor = async (origin: EventOrigin, techniqueId: string): Promise<number> => {
      const tenantId = origin.type === 'client' ? origin.tenantId : '';
      const inputs = await services.withOrigin(origin)
        .controlCapabilities.queryCapabilityResistanceInputs([techniqueId], tenantId);
      return computeTechniqueResistance(inputs.nodes, inputs.edges, inputs.states).get(techniqueId) ?? 0;
    };

    beforeEach(async () => {
      await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(idpId, 'L2', 'L3', null);
    });

    it('an exclusion drops the technique out of scoring', async () => {
      expect(await resistanceFor(adminOrigin, TECHNIQUE_T1078)).toBeCloseTo(STRENGTH_BY_RUNG.L2);

      await services.withOrigin(adminOrigin).controlCapabilities.removeTechnique(idpId, TECHNIQUE_T1078, 'prevent');

      expect(await resistanceFor(adminOrigin, TECHNIQUE_T1078)).toBe(0);
    });

    it('an addition brings a technique into scoring', async () => {
      expect(await resistanceFor(adminOrigin, TECHNIQUE_T1005)).toBe(0);

      await services.withOrigin(adminOrigin).controlCapabilities.addTechnique(idpId, TECHNIQUE_T1005, 'prevent');

      expect(await resistanceFor(adminOrigin, TECHNIQUE_T1005)).toBeCloseTo(STRENGTH_BY_RUNG.L2);
    });

    it('a detect addition stays out of scoring (prevent is the only scored function)', async () => {
      await services.withOrigin(adminOrigin).controlCapabilities.addTechnique(idpId, TECHNIQUE_T1005, 'detect');

      expect(await resistanceFor(adminOrigin, TECHNIQUE_T1005)).toBe(0);
    });
  });

  describe('survival across a catalogue reseed', () => {
    it('a reseed resurrects neither the removal nor loses the addition', async () => {
      await services.withOrigin(adminOrigin).controlCapabilities.removeTechnique(idpId, TECHNIQUE_T1078, 'prevent');
      await services.withOrigin(adminOrigin).controlCapabilities.addTechnique(idpId, TECHNIQUE_T1005, 'detect');

      await seed(db);

      expect(await edgeFor(adminOrigin, 'T1078', 'prevent')).toMatchObject({ state: 'removed' });
      expect(await edgeFor(adminOrigin, 'T1005', 'detect')).toMatchObject({ source: 'tenant', state: 'added' });
    });
  });

  describe('security platform families', () => {
    it('seeds the nine OpenAEV families with their platform-type keys', async () => {
      const families = await db.select().from(securityPlatformFamilies);
      expect(families).toHaveLength(9);
      expect(families.map((f) => f.platformTypeKey).sort()).toEqual([
        'AI_GATEWAY', 'EDR', 'ISPM', 'LLM_FIREWALL', 'NDR', 'SIEM', 'SOAR', 'VULNERABILITY_SCANNER', 'XDR',
      ]);
    });

    it('associates controls with the families that implement them', async () => {
      const [edr] = await db
        .select()
        .from(securityPlatformFamilies)
        .where(eq(securityPlatformFamilies.platformTypeKey, 'EDR'));
      const links = await db
        .select()
        .from(securityPlatformFamilyControls)
        .where(eq(securityPlatformFamilyControls.familyId, edr.id));
      expect(links.length).toBeGreaterThan(0);
    });

    it('drops a link the authored mapping no longer carries', async () => {
      const [edr] = await db
        .select()
        .from(securityPlatformFamilies)
        .where(eq(securityPlatformFamilies.platformTypeKey, 'EDR'));
      const capabilities = await services.withOrigin(adminOrigin).controlCapabilities.getControlCapabilities();
      const before = await db
        .select()
        .from(securityPlatformFamilyControls)
        .where(eq(securityPlatformFamilyControls.familyId, edr.id));

      // SAT is deliberately outside the mapping, so this row can only be a stale one.
      const staleCapabilityId = capabilities.find((c) => c.externalId === 'SAT')!.id;
      await db.insert(securityPlatformFamilyControls).values({ familyId: edr.id, capabilityId: staleCapabilityId });

      await seed(db);

      const after = await db
        .select()
        .from(securityPlatformFamilyControls)
        .where(eq(securityPlatformFamilyControls.familyId, edr.id));
      expect(after.map((l) => l.capabilityId).sort()).toEqual(before.map((l) => l.capabilityId).sort());
    });

    it('surfaces a control its families, read-only (no mutation exists to test)', async () => {
      const capabilities = await services.withOrigin(adminOrigin).controlCapabilities.getControlCapabilities();
      const edrControlId = capabilities.find((c) => c.externalId === 'EDR')!.id;
      const edrDetail = await services.withOrigin(adminOrigin).controlCapabilities.getControlCapability(edrControlId);
      expect(edrDetail!.securityPlatformFamilies.map((f) => f.platformTypeKey).sort()).toEqual(['EDR', 'XDR']);

      // A control the mapping leaves out carries no family and is perfectly valid.
      const satControlId = capabilities.find((c) => c.externalId === 'SAT')!.id;
      const satDetail = await services.withOrigin(adminOrigin).controlCapabilities.getControlCapability(satControlId);
      expect(satDetail!.securityPlatformFamilies).toEqual([]);
    });
  });
});

import {
  controlCapabilities,
  controlCapabilityAssessments,
  controlCapabilityCrosswalk,
  controlCapabilityEdges,
  controlCapabilityStrengthRungLabels,
  controlCapabilityTechniqueOverrides,
  mitreTechniques,
  seedControlCapabilities,
} from '@app/module';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { describe, expect, it } from 'vitest';
import { createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

// The defensive-capability catalogue is platform reference data seeded once at
// global setup. These assertions pin the identity platform seed (external id IDP).
describe('Control capability catalogue seed', () => {
  const getCapability = async () => {
    const [cap] = await db
      .select()
      .from(controlCapabilities)
      .where(eq(controlCapabilities.externalId, 'IDP'));
    return cap;
  };

  it('seeds IDP with the expected metadata', async () => {
    const cap = await getCapability();
    expect(cap).toBeTruthy();
    expect(cap.name).toBe('Identity Platform (IdP, SSO, MFA, Conditional Access)');
    expect(cap.domain).toBe('identities');
  });

  it('seeds the L0-L3 strength rungs', async () => {
    const cap = await getCapability();
    const rungs = await db.select().from(controlCapabilityStrengthRungLabels).where(eq(controlCapabilityStrengthRungLabels.capabilityId, cap.id));
    expect(rungs.map((r) => r.rung).sort()).toEqual(['L0', 'L1', 'L2', 'L3']);
    expect(rungs.every((r) => r.label.length > 0)).toBe(true);
  });

  it('seeds 217 resolved susceptibility edges', async () => {
    const cap = await getCapability();
    const edges = await db.select().from(controlCapabilityEdges).where(eq(controlCapabilityEdges.capabilityId, cap.id));
    expect(edges).toHaveLength(217);
    expect(edges.filter((e) => e.function === 'prevent')).toHaveLength(30);
    expect(edges.every((e) => e.mitreTechniqueId !== null)).toBe(true);
  });

  // The defense catalogue links a device to a technique by block, detect, evict or repair; only
  // block (prevent) and detect have a counterpart here.
  it('seeds the two-function catalogue with no duplicate edge', async () => {
    const edges = await db.select().from(controlCapabilityEdges);
    expect(edges).toHaveLength(9587);

    const byFunction = edges.reduce<Record<string, number>>(
      (acc, edge) => ({ ...acc, [edge.function]: (acc[edge.function] ?? 0) + 1 }),
      {},
    );
    expect(byFunction).toEqual({ prevent: 1316, detect: 8271 });

    const keys = edges.map((e) => `${e.capabilityId}|${e.mitreTechniqueId}|${e.function}`);
    expect(new Set(keys).size).toBe(edges.length);
  });

  // Pinned as a list, not a count: which mobile pairs leave the catalogue gap hangs on these edges.
  it('seeds the UEM edges the mobile reach rests on', async () => {
    const [uem] = await db.select().from(controlCapabilities).where(eq(controlCapabilities.externalId, 'UEM'));
    const edges = await db.select().from(controlCapabilityEdges).where(eq(controlCapabilityEdges.capabilityId, uem.id));
    expect(edges.map((edge) => `${edge.techniqueExternalId}:${edge.function}`).sort()).toEqual([
      'T1005:prevent', 'T1011.001:detect', 'T1011:detect', 'T1056.001:detect', 'T1056:detect', 'T1090.003:detect',
      'T1090:detect', 'T1176.001:prevent', 'T1176:prevent', 'T1195.003:detect', 'T1195:detect', 'T1204.002:prevent',
      'T1204:prevent', 'T1495:detect', 'T1496.001:detect', 'T1496.002:detect', 'T1496.003:detect', 'T1496.004:detect',
      'T1496:detect', 'T1498.001:detect', 'T1498.002:detect', 'T1498:detect', 'T1499.001:detect', 'T1499.002:detect',
      'T1499.003:detect', 'T1499.004:detect', 'T1499:detect', 'T1529:detect', 'T1539:prevent', 'T1542.001:detect',
      'T1542.002:detect', 'T1542.003:detect', 'T1542.004:detect', 'T1542.005:detect', 'T1542:detect', 'T1548.006:detect',
      'T1548:detect', 'T1552.001:prevent', 'T1552:prevent', 'T1564.005:detect', 'T1564:detect', 'T1685.001:detect',
      'T1685.002:detect', 'T1685.003:detect', 'T1685.004:detect', 'T1685.005:detect', 'T1685.006:detect', 'T1685.007:detect', 'T1685:detect',
    ]);
  });

  it('seeds the compliance crosswalk (ids only)', async () => {
    const cap = await getCapability();
    const crosswalk = await db.select().from(controlCapabilityCrosswalk).where(eq(controlCapabilityCrosswalk.capabilityId, cap.id));
    expect(crosswalk).toHaveLength(50);
    const attackMitigations = crosswalk.filter((c) => c.framework === 'attack_mitigations');
    expect(attackMitigations.map((c) => c.externalId).sort()).toEqual(['M1017', 'M1018', 'M1032', 'M1036', 'M1047', 'M1054']);
    expect(new Set(crosswalk.map((c) => c.framework))).toEqual(new Set(['attack_mitigations', 'csf_2_0', 'd3fend', 'nist_800_53']));
  });

  // On a tenant of its own: a file run earlier on the same worker may have declared IDP on its tenant.
  it('does not pre-seed any tenant assessment, so every control starts never declared', async () => {
    await truncateAllTables(db);
    const { tenantId } = await createTenantWithAdmin(createTestServices(db));
    const cap = await getCapability();
    const assessments = await db
      .select()
      .from(controlCapabilityAssessments)
      .where(and(
        eq(controlCapabilityAssessments.capabilityId, cap.id),
        eq(controlCapabilityAssessments.tenantId, tenantId),
      ));
    expect(assessments).toHaveLength(0);
  });
});

// What an older catalogue left behind: the re-seed removes it, and restores what it rewrote.
describe('Control capability catalogue re-seed', () => {
  const idOf = async (externalId: string) => (await db.select({ id: controlCapabilities.id })
    .from(controlCapabilities)
    .where(eq(controlCapabilities.externalId, externalId)))[0].id;
  const techniqueIdOf = async (externalId: string) => (await db.select({ id: mitreTechniques.id })
    .from(mitreTechniques)
    .where(eq(mitreTechniques.externalId, externalId)))[0].id;

  it('should prune the edges, crosswalk rows and rung labels the catalogue no longer carries', async () => {
    const ngfwId = await idOf('NGFW');
    const [fim] = await db.select().from(controlCapabilities).where(eq(controlCapabilities.externalId, 'FIM'));
    const formerId = uuidv7();
    const edgeId = uuidv7();
    const crosswalkId = uuidv7();
    await db.insert(controlCapabilityEdges).values({
      id: edgeId, capabilityId: ngfwId, mitreTechniqueId: await techniqueIdOf('T1003'), techniqueExternalId: 'T1003', function: 'prevent',
    });
    await db.insert(controlCapabilityCrosswalk).values({ id: crosswalkId, capabilityId: ngfwId, framework: 'iso_27001', externalId: 'A.5.15' });
    // Every catalogue control describes all four rungs, so a stale label sits on a control the catalogue lacks.
    await db.insert(controlCapabilities).values({ ...fim, id: formerId, externalId: 'FORMER', position: 99 });
    // The catalogue tables survive truncateAllTables: the next file in this worker would list this control.
    try {
      await db.insert(controlCapabilityStrengthRungLabels).values({ capabilityId: formerId, rung: 'L1', label: 'An older catalogue rung' });

      await seedControlCapabilities(db);

      expect(await db.select().from(controlCapabilityEdges).where(eq(controlCapabilityEdges.id, edgeId))).toEqual([]);
      expect(await db.select().from(controlCapabilityCrosswalk).where(eq(controlCapabilityCrosswalk.id, crosswalkId))).toEqual([]);
      expect(await db.select().from(controlCapabilityStrengthRungLabels).where(eq(controlCapabilityStrengthRungLabels.capabilityId, formerId))).toEqual([]);
      expect(await db.select({ id: controlCapabilityEdges.id }).from(controlCapabilityEdges)).toHaveLength(9587);
    } finally {
      await db.delete(controlCapabilities).where(eq(controlCapabilities.id, formerId));
    }
  });

  it('should restore a rung label rewritten under it', async () => {
    const fimId = await idOf('FIM');
    const labelOf = async () => (await db.select({ label: controlCapabilityStrengthRungLabels.label })
      .from(controlCapabilityStrengthRungLabels)
      .where(and(eq(controlCapabilityStrengthRungLabels.capabilityId, fimId), eq(controlCapabilityStrengthRungLabels.rung, 'L1'))))[0].label;
    const catalogueLabel = await labelOf();
    await db.update(controlCapabilityStrengthRungLabels).set({ label: 'An older catalogue rung' })
      .where(and(eq(controlCapabilityStrengthRungLabels.capabilityId, fimId), eq(controlCapabilityStrengthRungLabels.rung, 'L1')));

    await seedControlCapabilities(db);

    expect(await labelOf()).toBe(catalogueLabel);
  });

  it('should give a crosswalk row the catalogue keeps under another id the catalogue\'s id', async () => {
    const [kept] = await db.select().from(controlCapabilityCrosswalk)
      .where(eq(controlCapabilityCrosswalk.capabilityId, await idOf('NGFW'))).limit(1);
    const predecessorId = uuidv7();
    await db.update(controlCapabilityCrosswalk).set({ id: predecessorId }).where(eq(controlCapabilityCrosswalk.id, kept.id));

    await seedControlCapabilities(db);

    const rows = await db.select({ id: controlCapabilityCrosswalk.id }).from(controlCapabilityCrosswalk).where(and(
      eq(controlCapabilityCrosswalk.capabilityId, kept.capabilityId),
      eq(controlCapabilityCrosswalk.framework, kept.framework),
      eq(controlCapabilityCrosswalk.externalId, kept.externalId),
    ));
    expect(rows).toEqual([{ id: kept.id }]);
  });

  it('should drop a removal of a technique the control no longer links under that function, and keep the other overrides', async () => {
    await truncateAllTables(db);
    const { tenantId } = await createTenantWithAdmin(createTestServices(db));
    const ngfwId = await idOf('NGFW');
    const unlinked = await techniqueIdOf('T1003');
    const linked = await techniqueIdOf('T1018');
    const override = (mitreTechniqueId: string, kind: 'added' | 'removed', fn: 'prevent' | 'detect') => ({
      id: uuidv7(), tenantId, capabilityId: ngfwId, mitreTechniqueId, kind, function: fn,
    });
    const detectedOnly = await techniqueIdOf('T1001');
    const stale = [override(unlinked, 'removed', 'prevent'), override(detectedOnly, 'removed', 'prevent')];
    const kept = [override(unlinked, 'added', 'detect'), override(linked, 'removed', 'prevent')];
    await db.insert(controlCapabilityTechniqueOverrides).values([...stale, ...kept]);

    await seedControlCapabilities(db);

    const remaining = await db.select({ id: controlCapabilityTechniqueOverrides.id })
      .from(controlCapabilityTechniqueOverrides)
      .where(eq(controlCapabilityTechniqueOverrides.tenantId, tenantId));
    expect(remaining.map((row) => row.id).sort()).toEqual(kept.map((row) => row.id).sort());
  });
});

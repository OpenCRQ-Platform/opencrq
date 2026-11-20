import type { EventOrigin } from '@app/module';
import { MITIGATION_M1013, mitreTechniques, TACTIC_TA0001, TECHNIQUE_T1002, TECHNIQUE_T1053, TECHNIQUE_T1053_001, TECHNIQUE_T1053_002, TECHNIQUE_T1560 } from '@app/module';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('MITRE ATT&CK Service', () => {
  let adminOrigin: EventOrigin;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
  });

  describe('getTechniques — revoked filtering', () => {
    it('should return every non-revoked technique and no revoked one', async () => {
      const [techniques, revoked, kept] = await Promise.all([
        services.withOrigin(adminOrigin).mitreAttack.getTechniques(),
        db.select({ id: mitreTechniques.id }).from(mitreTechniques).where(eq(mitreTechniques.revoked, true)),
        db.select({ id: mitreTechniques.id }).from(mitreTechniques).where(eq(mitreTechniques.revoked, false)),
      ]);

      expect(revoked.length).toBeGreaterThan(0);
      expect(techniques.map((t) => t.id).sort()).toEqual(kept.map((t) => t.id).sort());
    });
  });

  describe('getTechniques — projection', () => {
    it('should return only the fields the list and the pickers render', async () => {
      const techniques = await services.withOrigin(adminOrigin).mitreAttack.getTechniques();

      expect(techniques.length).toBeGreaterThan(0);
      expect(Object.keys(techniques[0]).sort()).toEqual(['externalId', 'id', 'isSubtechnique', 'name']);
    });
  });

  describe('getTechniqueByExternalId — revoked technique', () => {
    it('should return a revoked technique with revoked=true', async () => {
      const technique = await services.withOrigin(adminOrigin).mitreAttack.getTechniqueByExternalId('T1002');

      expect(technique).toBeTruthy();
      expect(technique!.revoked).toBe(true);
    });

    it('should include replacedByTechniqueId when a replacement exists', async () => {
      const technique = await services.withOrigin(adminOrigin).mitreAttack.getTechniqueByExternalId('T1002');

      // T1002 (Data Compressed) was replaced by T1560 (Archive Collected Data)
      expect(technique!.replacedByTechniqueId).not.toBeNull();
    });

    it('should expose the external id of the replacement technique', async () => {
      const technique = await services.withOrigin(adminOrigin).mitreAttack.getTechniqueByExternalId('T1002');

      expect(technique!.replacedByTechniqueId).toBe(TECHNIQUE_T1560);
      expect(technique!.replacedByTechniqueExternalId).toBe('T1560');
    });

    it('should expose no replacement for a technique that was never revoked', async () => {
      const technique = await services.withOrigin(adminOrigin).mitreAttack.getTechniqueByExternalId('T1560');

      expect(technique!.revoked).toBe(false);
      expect(technique!.replacedByTechniqueExternalId).toBeNull();
    });
  });

  describe('lookup by external id', () => {
    it('should return a technique by its external id', async () => {
      const technique = await services.withOrigin(adminOrigin).mitreAttack.getTechniqueByExternalId('T1053');

      expect(technique!.id).toBe(TECHNIQUE_T1053);
      expect(technique!.subTechniques.map((s) => s.id)).toContain(TECHNIQUE_T1053_002);
    });

    it('should return a sub-technique by its dotted external id', async () => {
      const technique = await services.withOrigin(adminOrigin).mitreAttack.getTechniqueByExternalId('T1053.002');

      expect(technique!.id).toBe(TECHNIQUE_T1053_002);
    });

    it('should return a tactic and its techniques by its external id', async () => {
      const tactic = await services.withOrigin(adminOrigin).mitreAttack.getTacticByExternalId('TA0001');

      expect(tactic!.id).toBe(TACTIC_TA0001);
      expect(tactic!.techniques.length).toBeGreaterThan(0);
    });

    it('should return a mitigation and its techniques by its external id', async () => {
      const mitigation = await services.withOrigin(adminOrigin).mitreAttack.getMitigationByExternalId('M1013');

      expect(mitigation!.id).toBe(MITIGATION_M1013);
      expect(mitigation!.techniques.length).toBeGreaterThan(0);
    });

    it('should return undefined for an unknown external id', async () => {
      const scoped = services.withOrigin(adminOrigin).mitreAttack;

      expect(await scoped.getTechniqueByExternalId('T9999')).toBeUndefined();
      expect(await scoped.getTacticByExternalId('TA9999')).toBeUndefined();
      expect(await scoped.getMitigationByExternalId('M9999')).toBeUndefined();
    });
  });

  describe('getTechniqueByExternalId — sub-techniques revoked field', () => {
    it('should return sub-techniques including revoked ones for a parent technique', async () => {
      // T1053 (Scheduled Task/Job) has revoked sub-techniques (T1053.001, T1053.004)
      const technique = await services.withOrigin(adminOrigin).mitreAttack.getTechniqueByExternalId('T1053');

      expect(technique).toBeTruthy();
      expect(technique!.subTechniques.length).toBeGreaterThan(0);

      // Every sub-technique must expose the revoked field
      for (const sub of technique!.subTechniques) {
        expect(typeof sub.revoked).toBe('boolean');
      }

      // T1053.001 (At (Linux)) is revoked
      const revokedSub = technique!.subTechniques.find((s) => s.id === TECHNIQUE_T1053_001);
      expect(revokedSub).toBeTruthy();
      expect(revokedSub!.revoked).toBe(true);
    });
  });

  describe('getMitigationByExternalId — techniques revoked field', () => {
    it('should include the revoked field on related techniques', async () => {
      const mitigations = await services.withOrigin(adminOrigin).mitreAttack.getMitigations();
      expect(mitigations.length).toBeGreaterThan(0);

      const mitigation = await services.withOrigin(adminOrigin).mitreAttack.getMitigationByExternalId(mitigations[0].externalId);
      expect(mitigation).toBeTruthy();

      // Every related technique must expose the revoked field
      for (const tech of mitigation!.techniques) {
        expect(typeof tech.revoked).toBe('boolean');
      }
    });
  });

  describe('getMatrix', () => {
    it('should return all tactics, techniques (parents + sub-techniques without duplicates) and their junctions', async () => {
      const matrix = await services.withOrigin(adminOrigin).mitreAttack.getMatrix();
      const tactics = await services.withOrigin(adminOrigin).mitreAttack.getTactics();

      expect(matrix.tactics.length).toBe(tactics.length);
      expect(matrix.junctions.length).toBeGreaterThan(0);

      const techniqueIds = matrix.techniques.map((t) => t.id);
      expect(new Set(techniqueIds).size).toBe(techniqueIds.length);

      // T1053 (parent) and its non-revoked sub-technique must both appear
      expect(techniqueIds).toContain(TECHNIQUE_T1053);
      expect(techniqueIds).toContain(TECHNIQUE_T1053_002);
    });

    it('should exclude revoked techniques', async () => {
      const matrix = await services.withOrigin(adminOrigin).mitreAttack.getMatrix();

      expect(matrix.techniques.some((t) => t.id === TECHNIQUE_T1002)).toBe(false);
      // T1053.001 (At (Linux)) is a revoked sub-technique of T1053
      expect(matrix.techniques.some((t) => t.id === TECHNIQUE_T1053_001)).toBe(false);
    });
  });
});

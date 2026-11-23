import type { EventOrigin } from '@app/module';
import {
  Capability_ManageSecurity,
  createSecuredSchema,
  cve,
  cveTechniqueMapping,
  CWE_WEAKNESSES,
  cweTechniqueLinks,
  cweTechniqueOverrides,
  cweWeaknesses,
  cweWeaknessId,
  shippedLinkRows,
  TECHNIQUE_T1059,
  TECHNIQUE_T1090,
  TECHNIQUE_T1110,
  TECHNIQUE_T1557,
} from '@app/module';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantUser, createTenantWithAdmin, grantCapability } from '../../helpers/factories';
import { MAXIMAL_CVSS_VECTOR } from '../../helpers/finding-score-fixtures';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

type TenantOrigin = Extract<EventOrigin, { type: 'client' }>;

/** Not in the curated corpus, so every technique its finding carries comes from its weakness. */
const CVE_ON_CWE_287 = 'CVE-2024-99287';

describe('CWE technique link', () => {
  let adminOrigin: TenantOrigin;
  let adminUserId: string;
  let tenantId: string;

  const createFinding = async (origin: TenantOrigin, cweIds: Array<string>, cvssVector: string | null = null) => {
    const assetId = uuidv7();
    await services.withOrigin(origin).supportingAssets.createSupportingAsset({
      id: assetId,
      name: `Asset ${assetId.substring(0, 8)}`,
      description: null,
      ownerId: null,
      exposure: 'internet_facing',
      categoryId: 'host',
    });
    const cveRowId = uuidv7();
    await db.insert(cve).values([{ id: cveRowId, tenantId: origin.tenantId, cveId: CVE_ON_CWE_287, cwe: cweIds, cvssVector }]);
    const evidenceId = uuidv7();
    await services.withOrigin(origin).supportingAssets.createEvidence({ id: evidenceId, supportingAssetId: assetId, cve: { rowId: cveRowId }, userId: adminUserId });
    return { cveRowId, evidenceId };
  };

  const claimedTechniqueIds = async (origin: EventOrigin, cveRowId: string): Promise<Array<string>> => {
    const claims = await services.withOrigin(origin).techniqueMapping.getTechniqueClaims([cveRowId]);
    return claims.mappings.map((mapping) => mapping.mitreTechniqueId);
  };

  const otherTenant = async (): Promise<TenantOrigin> => ({
    type: 'client',
    userId: adminUserId,
    tenantId: await createTenant(services, adminUserId),
  });

  /** A later shipped version, simulated on the seeded table and undone whatever the test does. */
  const withShippedRow = async (cweExternalId: string, techniqueId: string, run: () => Promise<void>) => {
    const id = uuidv7();
    await db.insert(cweTechniqueLinks).values([{
      id,
      cweId: cweWeaknessId(cweExternalId),
      mitreTechniqueId: techniqueId,
      techniqueExternalId: 'T0000',
      justificationKind: 'attack_pattern',
      justificationRef: 'CAPEC-0',
      justificationName: 'A later version',
    }]);
    try {
      await run();
    } finally {
      await db.delete(cweTechniqueLinks).where(eq(cweTechniqueLinks.id, id));
    }
  };

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    tenantId = setup.tenantId;
  });

  describe('the shipped link', () => {
    it('should hold exactly the shipped link after the boot seed', async () => {
      const stored = await db.select().from(cweTechniqueLinks);

      expect(stored.map((row) => row.id).sort()).toEqual(shippedLinkRows().map((row) => row.id).sort());
      expect(await db.$count(cweWeaknesses)).toBe(CWE_WEAKNESSES.length);
    });
  });

  describe('read through', () => {
    it('should give a finding the techniques its weakness makes possible, with no row stored per CVE', async () => {
      const { cveRowId } = await createFinding(adminOrigin, ['CWE-287']);

      const claims = await services.withOrigin(adminOrigin).techniqueMapping.getTechniqueClaims([cveRowId]);

      expect(claims.states).toEqual([{ cveId: cveRowId, state: 'resolved' }]);
      expect(claims.mappings.filter((row) => row.mitreTechniqueId === TECHNIQUE_T1557))
        .toMatchObject([{ lane: 'structural', role: 'exploitation_technique', techniqueExternalId: 'T1557', weaknesses: ['CWE-287'] }]);
      expect(await db.select().from(cveTechniqueMapping).where(eq(cveTechniqueMapping.lane, 'structural'))).toEqual([]);
    });

    it('should hide a technique the tenant removed from its CWE-287 findings', async () => {
      const { cveRowId } = await createFinding(adminOrigin, ['CWE-287']);

      await services.withOrigin(adminOrigin).cwe.removeTechnique('CWE-287', TECHNIQUE_T1557);

      expect(await claimedTechniqueIds(adminOrigin, cveRowId)).not.toContain(TECHNIQUE_T1557);
    });

    it('should leave that technique on another tenant\'s CWE-287 findings', async () => {
      await services.withOrigin(adminOrigin).cwe.removeTechnique('CWE-287', TECHNIQUE_T1557);
      const other = await otherTenant();
      const { cveRowId } = await createFinding(other, ['CWE-287']);

      expect(await claimedTechniqueIds(other, cveRowId)).toContain(TECHNIQUE_T1557);
    });

    it('should keep a technique the tenant added through a new shipped version', async () => {
      const { cveRowId } = await createFinding(adminOrigin, ['CWE-287']);
      await services.withOrigin(adminOrigin).cwe.addTechnique('CWE-287', TECHNIQUE_T1110);

      await withShippedRow('CWE-287', TECHNIQUE_T1090, async () => {
        expect(await claimedTechniqueIds(adminOrigin, cveRowId)).toContain(TECHNIQUE_T1110);
      });
    });

    it('should show a new shipped version on a weakness the tenant never edited', async () => {
      const { cveRowId } = await createFinding(adminOrigin, ['CWE-79']);

      await withShippedRow('CWE-79', TECHNIQUE_T1090, async () => {
        expect(await claimedTechniqueIds(adminOrigin, cveRowId)).toContain(TECHNIQUE_T1090);
      });
    });

    it('should bring a reset weakness back to the shipped link', async () => {
      const { cveRowId } = await createFinding(adminOrigin, ['CWE-287']);
      const shipped = (await claimedTechniqueIds(adminOrigin, cveRowId)).sort();
      await services.withOrigin(adminOrigin).cwe.removeTechnique('CWE-287', TECHNIQUE_T1557);
      await services.withOrigin(adminOrigin).cwe.addTechnique('CWE-287', TECHNIQUE_T1110);

      await services.withOrigin(adminOrigin).cwe.resetCwe('CWE-287');

      expect((await claimedTechniqueIds(adminOrigin, cveRowId)).sort()).toEqual(shipped);
    });

    it('should put the effective link in the finding score\'s impact techniques, never on the way in', async () => {
      const { evidenceId } = await createFinding(adminOrigin, ['CWE-287'], MAXIMAL_CVSS_VECTOR);
      const read = async () => {
        await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();
        const breakdown = await services.withOrigin(adminOrigin).findingScore.getFindingScoreBreakdown(evidenceId);
        const factors = breakdown === null || breakdown.score === null ? null : breakdown.factors;
        return {
          impact: factors?.impactControls.paths.map((path) => path.techniqueId) ?? [],
          exploitation: factors?.exploitationControls.paths.map((path) => path.techniqueId) ?? [],
        };
      };
      const before = await read();
      expect(before.impact).toContain(TECHNIQUE_T1059);
      expect(before.exploitation).not.toContain(TECHNIQUE_T1059);

      await services.withOrigin(adminOrigin).cwe.removeTechnique('CWE-287', TECHNIQUE_T1059);

      expect((await read()).impact).not.toContain(TECHNIQUE_T1059);
    });
  });

  describe('the page', () => {
    it('should list the CWEs present in the tenant\'s findings with their technique count', async () => {
      await createFinding(adminOrigin, ['CWE-287']);

      const present = (await services.withOrigin(adminOrigin).cwe.listCatalogue()).filter((entry) => entry.presentInFindings);

      expect(present).toMatchObject([{ externalId: 'CWE-287', techniqueCount: 11, modified: false }]);
    });

    it('should flag a CWE the tenant edited as modified', async () => {
      await services.withOrigin(adminOrigin).cwe.addTechnique('CWE-287', TECHNIQUE_T1110);

      const entry = (await services.withOrigin(adminOrigin).cwe.listCatalogue()).find((row) => row.externalId === 'CWE-287');

      expect(entry).toMatchObject({ modified: true, techniqueCount: 12 });
    });

    it('should show a removed technique flagged and an added one with its origin', async () => {
      await services.withOrigin(adminOrigin).cwe.removeTechnique('CWE-287', TECHNIQUE_T1557);
      await services.withOrigin(adminOrigin).cwe.addTechnique('CWE-287', TECHNIQUE_T1110);

      const page = await services.withOrigin(adminOrigin).cwe.getCwe('CWE-287');

      expect(page.description).not.toBe('');
      expect(page.techniques.find((row) => row.techniqueId === TECHNIQUE_T1557)).toMatchObject({
        state: 'removed',
        justifications: [{ kind: 'attack_pattern', ref: 'CAPEC-94', name: 'Adversary in the Middle (AiTM)' }],
      });
      expect(page.techniques.find((row) => row.techniqueId === TECHNIQUE_T1110)).toMatchObject({ state: 'added', justifications: [] });
    });
  });

  describe('edits', () => {
    it('should count an addition the shipped link now carries as an edit Reset still discards', async () => {
      await services.withOrigin(adminOrigin).cwe.addTechnique('CWE-287', TECHNIQUE_T1110);

      await withShippedRow('CWE-287', TECHNIQUE_T1110, async () => {
        const page = await services.withOrigin(adminOrigin).cwe.getCwe('CWE-287');
        expect(page.techniques.find((row) => row.techniqueId === TECHNIQUE_T1110)?.state).toBe('shipped');
        expect(page.overrideCount).toBe(1);
      });
    });

    it('should refuse to add a technique the shipped link already carries', async () => {
      await expect(services.withOrigin(adminOrigin).cwe.addTechnique('CWE-287', TECHNIQUE_T1557)).rejects.toThrow('Technique already linked');
    });

    it('should erase an addition rather than record its removal', async () => {
      await services.withOrigin(adminOrigin).cwe.addTechnique('CWE-287', TECHNIQUE_T1110);

      await services.withOrigin(adminOrigin).cwe.removeTechnique('CWE-287', TECHNIQUE_T1110);

      expect(await db.select().from(cweTechniqueOverrides)).toEqual([]);
    });

    it('should restore a removed technique', async () => {
      await services.withOrigin(adminOrigin).cwe.removeTechnique('CWE-287', TECHNIQUE_T1557);

      await services.withOrigin(adminOrigin).cwe.restoreTechnique('CWE-287', TECHNIQUE_T1557);

      expect(await db.select().from(cweTechniqueOverrides)).toEqual([]);
    });

    it('should refuse to restore a technique that was not removed', async () => {
      await expect(services.withOrigin(adminOrigin).cwe.restoreTechnique('CWE-287', TECHNIQUE_T1557)).rejects.toThrow('Not Found');
    });
  });

  describe('security policy', () => {
    it('should show a member the weakness page as the tenant edited it, and flag it modified', async () => {
      await services.withOrigin(adminOrigin).cwe.removeTechnique('CWE-287', TECHNIQUE_T1557);
      const member = await createTenantUser(services, db, adminOrigin);

      const page = await services.withOrigin(member.origin).cwe.getCwe('CWE-287');
      const entry = (await services.withOrigin(member.origin).cwe.listCatalogue()).find((row) => row.externalId === 'CWE-287');

      expect(page.overrideCount).toBe(1);
      expect(page.techniques.find((row) => row.techniqueId === TECHNIQUE_T1557)?.state).toBe('removed');
      expect(entry?.modified).toBe(true);
    });

    it('should give a member\'s finding the techniques as the tenant edited the mapping', async () => {
      const member = await createTenantUser(services, db, adminOrigin);
      const { cveRowId } = await createFinding(adminOrigin, ['CWE-287']);
      expect(await claimedTechniqueIds(member.origin, cveRowId)).toContain(TECHNIQUE_T1557);

      await services.withOrigin(adminOrigin).cwe.removeTechnique('CWE-287', TECHNIQUE_T1557);

      expect(await claimedTechniqueIds(member.origin, cveRowId)).not.toContain(TECHNIQUE_T1557);
    });

    it('should refuse a member without the security capability to add a technique', async () => {
      const member = await createTenantUser(services, db, adminOrigin);

      await expect(services.withOrigin(member.origin).cwe.addTechnique('CWE-287', TECHNIQUE_T1110)).rejects.toThrow('Access Denied');

      expect(await db.select().from(cweTechniqueOverrides)).toEqual([]);
    });

    it('should refuse a member without the security capability to remove a shipped technique', async () => {
      const member = await createTenantUser(services, db, adminOrigin);

      await expect(services.withOrigin(member.origin).cwe.removeTechnique('CWE-287', TECHNIQUE_T1557)).rejects.toThrow('Access Denied');

      expect(await db.select().from(cweTechniqueOverrides)).toEqual([]);
    });

    it('should leave an addition of the admin in place when a member without the security capability removes it', async () => {
      await services.withOrigin(adminOrigin).cwe.addTechnique('CWE-287', TECHNIQUE_T1110);
      const member = await createTenantUser(services, db, adminOrigin);

      await services.withOrigin(member.origin).cwe.removeTechnique('CWE-287', TECHNIQUE_T1110);

      expect(await db.select().from(cweTechniqueOverrides)).toMatchObject([{ mitreTechniqueId: TECHNIQUE_T1110, kind: 'added' }]);
    });

    it('should leave a removal of the admin in place when a member without the security capability restores it', async () => {
      await services.withOrigin(adminOrigin).cwe.removeTechnique('CWE-287', TECHNIQUE_T1557);
      const member = await createTenantUser(services, db, adminOrigin);

      await services.withOrigin(member.origin).cwe.restoreTechnique('CWE-287', TECHNIQUE_T1557);

      expect(await db.select().from(cweTechniqueOverrides)).toMatchObject([{ mitreTechniqueId: TECHNIQUE_T1557, kind: 'removed' }]);
    });

    it('should leave the overrides of the admin in place when a member without the security capability resets the weakness', async () => {
      await services.withOrigin(adminOrigin).cwe.removeTechnique('CWE-287', TECHNIQUE_T1557);
      await services.withOrigin(adminOrigin).cwe.addTechnique('CWE-287', TECHNIQUE_T1110);
      const member = await createTenantUser(services, db, adminOrigin);

      await services.withOrigin(member.origin).cwe.resetCwe('CWE-287');

      expect(await db.select().from(cweTechniqueOverrides)).toHaveLength(2);
    });

    it('should let a member holding the security capability add a technique', async () => {
      const member = await createTenantUser(services, db, adminOrigin);
      await grantCapability(services, adminOrigin, member.userId, Capability_ManageSecurity);

      await services.withOrigin(member.origin).cwe.addTechnique('CWE-287', TECHNIQUE_T1110);

      expect(await db.select().from(cweTechniqueOverrides)).toMatchObject([{ mitreTechniqueId: TECHNIQUE_T1110, kind: 'added' }]);
    });
  });

  describe('tenant isolation', () => {
    it('should hide one tenant\'s edits from another tenant', async () => {
      await services.withOrigin(adminOrigin).cwe.removeTechnique('CWE-287', TECHNIQUE_T1557);
      const other = await otherTenant();

      expect(await db.select().from(createSecuredSchema(db, other).cweTechniqueOverrides)).toEqual([]);
      expect(await db.select().from(createSecuredSchema(db, adminOrigin).cweTechniqueOverrides)).toHaveLength(1);
    });

    it('should leave one tenant\'s edits in place when another resets the same weakness', async () => {
      await services.withOrigin(adminOrigin).cwe.removeTechnique('CWE-287', TECHNIQUE_T1557);
      const other = await otherTenant();

      await services.withOrigin(other).cwe.resetCwe('CWE-287');

      expect(await db.select().from(cweTechniqueOverrides).where(eq(cweTechniqueOverrides.tenantId, tenantId))).toHaveLength(1);
    });
  });
});

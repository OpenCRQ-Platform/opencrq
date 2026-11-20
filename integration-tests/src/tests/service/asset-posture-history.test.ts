import type { EventOrigin } from '@app/module';
import { assetEvidence, assetEvidenceHistory, assetPostureHistory, assetPostures, cve } from '@app/module';
import { asc, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { MAXIMAL_CVSS_VECTOR } from '../../helpers/finding-score-fixtures';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): Date => new Date(Date.now() - days * DAY_MS);

describe('Asset posture history', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let tenantId: string;
  let created = 0;

  beforeEach(async () => {
    await truncateAllTables(db);
    created = 0;
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    tenantId = setup.tenantId;
  });

  const secondTenant = async (): Promise<{ tenantId: string, origin: EventOrigin }> => {
    const otherTenantId = await createTenant(services, adminUserId);
    return { tenantId: otherTenantId, origin: { type: 'client', userId: adminUserId, tenantId: otherTenantId } };
  };

  const createAsset = async (name: string, origin: EventOrigin = adminOrigin): Promise<string> => {
    const assetId = uuidv7();
    await services.withOrigin(origin).supportingAssets.createSupportingAsset({
      id: assetId,
      name,
      description: null,
      ownerId: null,
      exposure: 'internet_facing',
      categoryId: 'host',
      criticality: 'high',
    });
    return assetId;
  };

  const addFinding = async (assetId: string, ownerTenantId: string = tenantId, epss = 0.4): Promise<string> => {
    const cveRowId = uuidv7();
    created += 1;
    await db.insert(cve).values([{
      id: cveRowId,
      tenantId: ownerTenantId,
      cveId: `CVE-2026-${String(created).padStart(4, '0')}`,
      cvssVector: MAXIMAL_CVSS_VECTOR,
      epss,
      kev: null,
    }]);
    const evidenceId = uuidv7();
    await db.insert(assetEvidence).values([{
      id: evidenceId, supportingAssetId: assetId, tenantId: ownerTenantId, cveId: cveRowId,
      // Off the clock `dismiss` dates with, never the database's: a finding with no history stands in
      // its state since its creation, and a state change dated before it is ignored.
      createdAt: new Date(),
    }]);
    return evidenceId;
  };

  const dismiss = (evidenceId: string) => {
    const at = new Date();
    return db
      .insert(assetEvidenceHistory)
      .values({ id: uuidv7(), tenantId, assetEvidenceId: evidenceId, stateChangedAt: at, observedAt: at, state: 'dismissed', origin: 'not_exposed' });
  };

  const recompute = (origin: EventOrigin = adminOrigin) => services.withOrigin(origin).findingScore.recomputeFindingScores();

  const journalOf = (assetId: string) => db
    .select()
    .from(assetPostureHistory)
    .where(eq(assetPostureHistory.supportingAssetId, assetId))
    .orderBy(asc(assetPostureHistory.changedAt));

  const insertLine = (assetId: string, days: number, score: number | null, owner = tenantId) => db
    .insert(assetPostureHistory)
    .values({ id: uuidv7(), supportingAssetId: assetId, tenantId: owner, score, changedAt: daysAgo(days) });

  describe('the journal', () => {
    it('should record one line per asset with a posture on the first run, and none for an asset without one', async () => {
      const scored = await createAsset('Edge gateway');
      await addFinding(scored);
      const bare = await createAsset('Spare laptop');

      await recompute();

      const [posture] = await db.select().from(assetPostures).where(eq(assetPostures.supportingAssetId, scored));
      const lines = await journalOf(scored);
      expect(lines).toHaveLength(1);
      expect(lines[0].score).toBe(posture.score);
      expect(lines[0].tenantId).toBe(tenantId);
      expect(await journalOf(bare)).toHaveLength(0);
    });

    it('should record nothing when no posture moved', async () => {
      const assetId = await createAsset('Steady host');
      await addFinding(assetId);
      await recompute();

      await recompute();

      expect(await journalOf(assetId)).toHaveLength(1);
    });

    it('should record the new score of the one asset whose posture moved', async () => {
      const moved = await createAsset('Patched host');
      await addFinding(moved);
      const steady = await createAsset('Untouched host');
      await addFinding(steady);
      await recompute();
      const [computed] = await db.select().from(assetPostures).where(eq(assetPostures.supportingAssetId, moved));
      await db.update(assetPostures).set({ score: computed.score - 9 }).where(eq(assetPostures.supportingAssetId, moved));

      await recompute();

      const lines = await journalOf(moved);
      expect(lines).toHaveLength(2);
      expect(lines[1].score).toBe(computed.score);
      expect(await journalOf(steady)).toHaveLength(1);
    });

    it('should record a null line when the asset loses its last applicable finding', async () => {
      const assetId = await createAsset('Decommissioned service');
      const evidenceId = await addFinding(assetId);
      await recompute();
      await db.delete(assetEvidence).where(eq(assetEvidence.id, evidenceId));

      await recompute();
      await recompute();

      const lines = await journalOf(assetId);
      expect(lines.map((line) => line.score === null)).toEqual([false, true]);
      expect(lines[1]).toMatchObject({
        worstAssetEvidenceId: null, worstExploitability: null, criticalCount: null, highCount: null, mediumCount: null, lowCount: null,
      });
    });

    it('should record with each score the worst finding, its exploitability and the band counts the posture read', async () => {
      const assetId = await createAsset('Explained host');
      await addFinding(assetId, tenantId, 0.05);
      await addFinding(assetId, tenantId, 0.9);
      await recompute();

      const posture = await services.withOrigin(adminOrigin).findingScore.getAssetPosture(assetId);
      const [line] = await journalOf(assetId);
      expect(posture).not.toBeNull();
      expect(line).toMatchObject({
        score: posture!.score,
        worstAssetEvidenceId: posture!.worstFinding.evidenceId,
        worstExploitability: posture!.worstFinding.exploitability,
        criticalCount: posture!.countsByBand.critical,
        highCount: posture!.countsByBand.high,
        mediumCount: posture!.countsByBand.medium,
        lowCount: posture!.countsByBand.low,
      });
    });
  });

  describe('the retention trim', () => {
    it('should drop the lines past a year except the one in force at the cut-off', async () => {
      const assetId = await createAsset('Long lived host');
      await insertLine(assetId, 420, 30);
      await insertLine(assetId, 380, 40);
      await insertLine(assetId, 100, 50);

      await recompute();

      expect((await journalOf(assetId)).map((line) => line.score)).toEqual([40, 50]);
    });

    it('should not reach another tenant lines', async () => {
      const other = await secondTenant();
      const theirs = await createAsset('Neighbour host', other.origin);
      await insertLine(theirs, 420, 7, other.tenantId);
      await insertLine(theirs, 400, 8, other.tenantId);

      await recompute();

      expect((await journalOf(theirs)).map((line) => line.score)).toEqual([7, 8]);
    });
  });

  describe('cascades', () => {
    it('should drop an asset lines with the asset', async () => {
      const assetId = await createAsset('Retired host');
      await insertLine(assetId, 10, 60);

      await services.withOrigin(adminOrigin).supportingAssets.deleteSupportingAssets([assetId]);

      expect(await journalOf(assetId)).toHaveLength(0);
    });

    it('should keep a line whose worst finding is deleted, without the finding', async () => {
      const assetId = await createAsset('Rescanned host');
      const evidenceId = await addFinding(assetId);
      await recompute();

      await db.delete(assetEvidence).where(eq(assetEvidence.id, evidenceId));

      const [line] = await journalOf(assetId);
      expect(line.score).not.toBeNull();
      expect(line.worstAssetEvidenceId).toBeNull();
      expect(line.worstExploitability).not.toBeNull();
    });

    it('should drop a tenant lines with the tenant', async () => {
      const other = await secondTenant();
      const theirs = await createAsset('Neighbour host', other.origin);
      await insertLine(theirs, 10, 60, other.tenantId);

      await services.withOrigin({ type: 'platform', userId: adminUserId }).tenants.deleteTenants([other.tenantId]);

      expect(await db.select().from(assetPostureHistory).where(eq(assetPostureHistory.tenantId, other.tenantId))).toHaveLength(0);
    });
  });

  describe('getAssetPostureHistory', () => {
    it('should return the last twelve months led by the line in force when they open', async () => {
      const assetId = await createAsset('Charted host');
      await insertLine(assetId, 450, 20);
      await insertLine(assetId, 400, 30);
      await insertLine(assetId, 200, null);
      await insertLine(assetId, 10, 60);

      const history = await services.withOrigin(adminOrigin).findingScore.getAssetPostureHistory(assetId);

      expect(history.map((line) => line.score)).toEqual([30, null, 60]);
      expect(history[0].at).toBeInstanceOf(Date);
    });

    it('should name the worst finding of each line and read a resolution against the previous one', async () => {
      const assetId = await createAsset('Remediated host');
      const minor = await addFinding(assetId, tenantId, 0.05);
      const worst = await addFinding(assetId, tenantId, 0.9);
      await recompute();
      await dismiss(worst);
      await recompute();

      const history = await services.withOrigin(adminOrigin).findingScore.getAssetPostureHistory(assetId);

      expect(history).toHaveLength(2);
      expect(history[0].cause?.worstFinding?.evidenceId).toBe(worst);
      expect(history[0].cause?.change).toEqual({ kind: 'first' });
      expect(history[1].cause?.worstFinding).toEqual({ evidenceId: minor, name: 'CVE-2026-0001' });
      expect(history[1].cause?.change).toEqual({ kind: 'resolved', resolvedName: 'CVE-2026-0002' });
    });

    it('should read the later of two state changes sharing an instant by their id', async () => {
      const assetId = await createAsset('Twice triaged host');
      await addFinding(assetId, tenantId, 0.05);
      const worst = await addFinding(assetId, tenantId, 0.9);
      await recompute();
      const at = new Date();
      const applicableId = uuidv7();
      const dismissedId = uuidv7();
      await db.insert(assetEvidenceHistory).values({ id: dismissedId, tenantId, assetEvidenceId: worst, stateChangedAt: at, observedAt: at, state: 'dismissed', origin: 'not_exposed' });
      await db.insert(assetEvidenceHistory).values({ id: applicableId, tenantId, assetEvidenceId: worst, stateChangedAt: at, observedAt: at, state: 'applicable', origin: 'exposed' });
      await recompute();

      const history = await services.withOrigin(adminOrigin).findingScore.getAssetPostureHistory(assetId);

      expect(history[1].cause?.change).toEqual({ kind: 'resolved', resolvedName: 'CVE-2026-0002' });
    });

    it('should return a line older than causes without one', async () => {
      const assetId = await createAsset('Long charted host');
      await insertLine(assetId, 10, 60);

      const [line] = await services.withOrigin(adminOrigin).findingScore.getAssetPostureHistory(assetId);

      expect(line).toMatchObject({ score: 60, cause: null });
    });

    it('should return nothing for an asset with no history', async () => {
      const assetId = await createAsset('New host');

      expect(await services.withOrigin(adminOrigin).findingScore.getAssetPostureHistory(assetId)).toEqual([]);
    });

    it('should never return another tenant history', async () => {
      const assetId = await createAsset('Private host');
      await insertLine(assetId, 10, 60);
      const other = await secondTenant();

      expect(await services.withOrigin(other.origin).findingScore.getAssetPostureHistory(assetId)).toEqual([]);
    });
  });
});

import type { EventOrigin } from '@app/module';
import { assetEvidence, assetEvidenceHistory, assetPostures, findingScoreHistory, findingScores, TECHNIQUE_T1190, THREAT_FLOORS } from '@app/module';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { findingScoreFixtures } from '../../helpers/finding-score-fixtures';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): Date => new Date(Date.now() - days * DAY_MS);

describe('Finding Score Service', () => {
  let adminOrigin: EventOrigin;
  let adminTenantId: string;
  let adminUserId: string;

  const { attachCve, attachTechnique, breakdownOf, createAsset, insertCve, insertSyncedVerdict, listAsset, listEstate, scoredForAsset } = findingScoreFixtures(services, db, () => ({ origin: adminOrigin, tenantId: adminTenantId, userId: adminUserId }));

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminTenantId = setup.tenantId;
    adminUserId = setup.userId;
  });

  describe('the single-finding breakdown', () => {
    it('should return the factors of one finding and null for an unknown one', async () => {
      const assetId = await createAsset('Edge gateway', { exposure: 'internet_facing', criticality: 'high' });
      const cveUuid = await insertCve('CVE-2026-0005', { kev: true });
      const evidenceId = await attachCve(assetId, cveUuid);

      const breakdown = await breakdownOf(evidenceId);
      expect(breakdown?.evidenceId).toBe(evidenceId);
      expect(breakdown?.factors.threat.value).toBe(THREAT_FLOORS.knownExploited);

      expect(await services.withOrigin(adminOrigin).findingScore.getFindingScoreBreakdown(uuidv7())).toBeNull();
    });

    it('should keep printing the stored score after an input moved, until the recompute runs', async () => {
      const assetId = await createAsset('Edge gateway', { exposure: 'internet_facing', criticality: 'high' });
      const evidenceId = await attachCve(assetId, await insertCve('CVE-2026-0012', { kev: true }));
      const before = await breakdownOf(evidenceId);

      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(assetId, { exposure: 'internal' });

      const read = services.withOrigin(adminOrigin).findingScore;
      const onDetail = await read.getFindingScoreBreakdown(evidenceId);
      const { items: [onAsset] } = await listAsset(assetId);
      const [onList] = await read.getScoredFindingsByEvidenceIds([evidenceId]);
      expect(onDetail).toMatchObject({ score: before.score, factors: { reachability: { value: before.factors.reachability.value } } });
      expect(onAsset?.score).toBe(before.score);
      expect(onList?.score).toBe(before.score);

      const after = await breakdownOf(evidenceId);
      expect(after.score).toBeLessThan(before.score);
      expect((await read.getScoredFindingsByEvidenceIds([evidenceId]))[0]?.score).toBe(after.score);
    });

    it('should read the scores of more findings than Postgres binds parameters', async () => {
      const assetId = await createAsset('Edge gateway', { exposure: 'internet_facing', criticality: 'high' });
      const evidenceId = await attachCve(assetId, await insertCve('CVE-2026-0014', { kev: true }));
      const { score } = await breakdownOf(evidenceId);
      const unknownIds = Array.from({ length: 200_000 }, () => uuidv7());

      const scored = await services.withOrigin(adminOrigin).findingScore.getScoredFindingsByEvidenceIds([...unknownIds, evidenceId]);

      expect(scored.map((row) => [row.evidenceId, row.score])).toEqual([[evidenceId, score]]);
    });

    it('should read a finding the recompute has not reached as unscored, its evidence still drawn', async () => {
      const assetId = await createAsset('Fresh host', { exposure: 'internet_facing', criticality: 'high' });
      const evidenceId = await attachCve(assetId, await insertCve('CVE-2026-0013', { kev: true }));

      const read = services.withOrigin(adminOrigin).findingScore;
      const breakdown = await read.getFindingScoreBreakdown(evidenceId);
      expect(breakdown).toMatchObject({ evidenceId, score: null, band: null });
      expect(breakdown?.columns.reachability.exposure).toBe('internet_facing');
      expect((await listAsset(assetId)).items).toMatchObject([{ evidenceId, score: null, band: null }]);
    });

    it('should leave the two middle columns empty on a flaw pending its vector, which reaches no technique', async () => {
      const assetId = await createAsset('Edge gateway', { exposure: 'internet_facing', criticality: 'high' });
      const evidenceId = await attachCve(assetId, await insertCve('CVE-2026-0008', { kev: true }, undefined, null));
      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();

      const breakdown = await services.withOrigin(adminOrigin).findingScore.getFindingScoreBreakdown(evidenceId);

      expect(breakdown).toMatchObject({ score: null, pendingVector: true });
      expect(breakdown?.columns.validation).toBeNull();
      expect(breakdown?.columns.mitigations).toBeNull();
      expect(breakdown?.columns.threat.knownExploited).toBe(true);
      expect(breakdown?.columns.potentialImpact.criticality).toBe('high');
    });

    /**
     * A CVE finding whose vector the topology rule reads as T1190 on an exposed web application, so
     * the runs of T1190 on that asset are what its validation column reports.
     */
    const cveReachingT1190 = async (assetId: string): Promise<string> => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createEvidence({
        id,
        supportingAssetId: assetId,
        cveId: await insertCve('CVE-2099-0190', {}, undefined, 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'),
        userId: adminUserId,
      });
      return id;
    };

    const exposedWebApplication = (name: string) =>
      createAsset(name, { exposure: 'internet_facing', criticality: 'high', category: 'web_application' });

    it('should report a run on a technique in reach that held nothing', async () => {
      const assetId = await exposedWebApplication('Tested web application');
      const evidenceId = await cveReachingT1190(assetId);
      const run = await attachTechnique(assetId, daysAgo(1), undefined, { mitreTechniqueId: TECHNIQUE_T1190, securityPlatformType: 'EDR' });
      await insertSyncedVerdict(run, 'applicable', daysAgo(1));

      const breakdown = await breakdownOf(evidenceId);

      expect(breakdown.columns.validation?.techniquesTested).toBe(1);
      expect(breakdown.columns.validation?.prevention).toEqual({ held: 0, total: 1 });
      expect(breakdown.columns.mitigations).not.toBeNull();
    });

    it('should leave a control standing when the platform that got through does not implement it', async () => {
      const assetId = await exposedWebApplication('Gateway-tested web application');
      const evidenceId = await cveReachingT1190(assetId);
      // This family implements no control in the catalogue, so its verdict can speak for none.
      const run = await attachTechnique(assetId, daysAgo(1), undefined, { mitreTechniqueId: TECHNIQUE_T1190, securityPlatformType: 'LLM_FIREWALL' });
      await insertSyncedVerdict(run, 'applicable', daysAgo(1));

      const breakdown = await breakdownOf(evidenceId);

      expect(breakdown.columns.validation?.prevention).toEqual({ held: 0, total: 1 });
      // Reading the technique's runs without their platform would strike every declaration standing
      // on it, on evidence that never exercised any of them.
      expect(breakdown.columns.mitigations?.every((control) => !control.knockedDownHere)).toBe(true);
    });

    it('should strike a control when a platform implementing it lets the technique through', async () => {
      const assetId = await exposedWebApplication('Struck web application');
      const evidenceId = await cveReachingT1190(assetId);
      const run = await attachTechnique(assetId, daysAgo(2), undefined, { mitreTechniqueId: TECHNIQUE_T1190, securityPlatformType: 'EDR' });
      await insertSyncedVerdict(run, 'applicable', daysAgo(2));

      expect((await breakdownOf(evidenceId)).columns.mitigations?.some((control) => control.knockedDownHere)).toBe(true);
    });

    it('should strike no control on a person decision written after the platform held', async () => {
      const assetId = await exposedWebApplication('Held web application');
      const evidenceId = await cveReachingT1190(assetId);
      const run = await attachTechnique(assetId, daysAgo(2), undefined, { mitreTechniqueId: TECHNIQUE_T1190, securityPlatformType: 'EDR' });
      await insertSyncedVerdict(run, 'dismissed', daysAgo(2));
      await db.insert(assetEvidenceHistory).values([{
        id: uuidv7(), assetEvidenceId: run, tenantId: adminTenantId, state: 'applicable', stateChangedAt: daysAgo(1), changedByUserId: adminUserId, origin: 'user',
      }]);

      expect((await breakdownOf(evidenceId)).columns.mitigations?.every((control) => !control.knockedDownHere)).toBe(true);
    });

    it('should date the last run from the latest verdict, whichever way that run went', async () => {
      const assetId = await exposedWebApplication('Retested web application');
      const evidenceId = await cveReachingT1190(assetId);
      const lastRunAt = daysAgo(2);
      const run = await attachTechnique(assetId, daysAgo(6), undefined, { mitreTechniqueId: TECHNIQUE_T1190 });
      await insertSyncedVerdict(run, 'applicable', daysAgo(6));
      await insertSyncedVerdict(run, 'dismissed', lastRunAt);

      const breakdown = await breakdownOf(evidenceId);

      // One expectation that flipped, not two: the tally reads where it stands, and the date is
      // the later of what the platform stated and when it last spoke.
      expect(breakdown.columns.validation?.prevention).toEqual({ held: 1, total: 1 });
      expect(breakdown.columns.validation?.lastRunAt).toBeInstanceOf(Date);
      expect(breakdown.columns.validation?.lastRunAt?.getTime()).toBe(lastRunAt.getTime());
    });

    it('should tally the expectations tried, not the times their verdict changed', async () => {
      const assetId = await exposedWebApplication('Twice tested web application');
      const evidenceId = await cveReachingT1190(assetId);
      const flipping = await attachTechnique(assetId, daysAgo(9), undefined, { mitreTechniqueId: TECHNIQUE_T1190 });
      await insertSyncedVerdict(flipping, 'applicable', daysAgo(9));
      await insertSyncedVerdict(flipping, 'dismissed', daysAgo(5));
      await insertSyncedVerdict(flipping, 'applicable', daysAgo(3));
      const steady = await attachTechnique(assetId, daysAgo(3), undefined, { mitreTechniqueId: TECHNIQUE_T1190, securityPlatformType: 'EDR' });
      await insertSyncedVerdict(steady, 'dismissed', daysAgo(3));

      const breakdown = await breakdownOf(evidenceId);

      // Two platforms tried the same technique, one holding and one not. A connector writes a row
      // only when its verdict changes, so counting history would report the flipping one three
      // times over and a platform failing every night just once.
      expect(breakdown.columns.validation?.prevention).toEqual({ held: 1, total: 2 });
    });

    it('should advance the run date on a sync that changed no verdict', async () => {
      const assetId = await exposedWebApplication('Quiet web application');
      const evidenceId = await cveReachingT1190(assetId);
      const lastRunAt = daysAgo(1);
      const run = await attachTechnique(assetId, daysAgo(9), undefined, { mitreTechniqueId: TECHNIQUE_T1190 });
      await insertSyncedVerdict(run, 'dismissed', daysAgo(9));
      await db.update(assetEvidence).set({ evaluatedAt: lastRunAt }).where(eq(assetEvidence.id, run));

      const breakdown = await breakdownOf(evidenceId);

      // The platform ran again last night and found the same thing, which writes no history row.
      expect(breakdown.columns.validation?.lastRunAt?.getTime()).toBe(lastRunAt.getTime());
    });
  });

  describe('technique findings', () => {
    const failedPrevention = async (assetId: string): Promise<string> => {
      const evidenceId = await attachTechnique(assetId, daysAgo(1));
      await insertSyncedVerdict(evidenceId, 'applicable', daysAgo(1));
      return evidenceId;
    };

    it('should give a technique finding no score', async () => {
      const assetId = await createAsset('Tested host', { exposure: 'internet_facing', criticality: 'high' });
      const evidenceId = await failedPrevention(assetId);

      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();

      expect(await db.select().from(findingScores).where(eq(findingScores.assetEvidenceId, evidenceId))).toEqual([]);
      expect(await db.select().from(findingScoreHistory).where(eq(findingScoreHistory.assetEvidenceId, evidenceId))).toEqual([]);
      expect((await listAsset(assetId)).items).toMatchObject([{ evidenceId, score: null, band: null }]);
      expect(await services.withOrigin(adminOrigin).findingScore.getFindingScoreBreakdown(evidenceId)).toBeNull();
    });

    it('should leave the score of a CVE finding standing beside it untouched', async () => {
      const assetId = await createAsset('Mixed host', { exposure: 'internet_facing', criticality: 'high' });
      const cveFinding = await attachCve(assetId, await insertCve('CVE-2026-0300', { epss: 0.4 }));
      const [alone] = await scoredForAsset(assetId);

      await failedPrevention(assetId);
      const findings = await scoredForAsset(assetId);

      expect(findings.map((finding) => finding.evidenceId)).toEqual([cveFinding]);
      expect(findings[0].score).toBe(alone.score);
    });

    it('should list a technique finding after every scored finding, with no score, and never as unscored', async () => {
      const assetId = await createAsset('Listed host', { exposure: 'internal', criticality: 'low' });
      const cveFinding = await attachCve(assetId, await insertCve('CVE-2026-0301'));
      const techniqueFinding = await failedPrevention(assetId);
      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();

      for (const sortDesc of [true, false]) {
        const page = await services.withOrigin(adminOrigin).findingScore.listScoredFindings({
          page: 1, limit: 50, state: 'applicable', source: null, mappedToOrganizationId: null, sortBy: 'score', sortDesc,
        });
        expect(page.items.map((row) => row.evidenceId)).toEqual([cveFinding, techniqueFinding]);
        expect(page.items[1]).toMatchObject({ score: null, band: null, currentState: 'applicable', mitreTechniqueExternalId: 'T1003' });
        expect(page.total).toBe(2);
        expect(page.unscored).toBe(0);
      }
    });

    it('should list a technique finding under the state its history stands in', async () => {
      const techniqueFinding = await failedPrevention(await createAsset('Held host'));
      await insertSyncedVerdict(techniqueFinding, 'dismissed', new Date());
      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();

      const read = services.withOrigin(adminOrigin).findingScore;
      const listIn = (state: 'applicable' | 'dismissed') => read.listScoredFindings({
        page: 1, limit: 50, state, source: null, mappedToOrganizationId: null, sortBy: 'currentState', sortDesc: false,
      });
      expect((await listIn('applicable')).total).toBe(0);
      expect((await listIn('dismissed')).items.map((row) => row.evidenceId)).toEqual([techniqueFinding]);
    });

    it('should keep a technique finding out of the panel counts', async () => {
      const assetId = await createAsset('Counted host', { exposure: 'internet_facing', criticality: 'high' });
      await attachCve(assetId, await insertCve('CVE-2026-0302', { kev: true }));
      await failedPrevention(assetId);
      await failedPrevention(await createAsset('Technique-only host'));
      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();

      const counts = await services.withOrigin(adminOrigin).findingScore.getFindingsPanelCounts();

      expect(counts.findings).toBe(1);
      expect(counts.impactedAssets).toBe(1);
      expect(counts.bands.reduce((sum, band) => sum + band.total, 0)).toBe(1);
    });

    it('should read the posture from the worst CVE finding when a failed prevention result stood above it', async () => {
      const assetId = await createAsset('Breached host', { exposure: 'internet_facing', criticality: 'high' });
      const cveFinding = await attachCve(assetId, await insertCve('CVE-2026-0303'));
      await failedPrevention(assetId);
      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();

      const posture = await services.withOrigin(adminOrigin).findingScore.getAssetPosture(assetId);

      expect(posture?.worstFinding).toMatchObject({ evidenceId: cveFinding, name: 'CVE-2026-0303' });
      expect(Object.values(posture?.countsByBand ?? {}).reduce((total, count) => total + count, 0)).toBe(1);
    });

    it('should read no posture on an asset whose only findings are technique findings', async () => {
      const assetId = await createAsset('Tested-only host', { exposure: 'internet_facing', criticality: 'high' });
      await failedPrevention(assetId);
      await db.insert(assetPostures).values([{ supportingAssetId: assetId, tenantId: adminTenantId, score: 2 }]);

      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();

      expect(await services.withOrigin(adminOrigin).findingScore.getAssetPosture(assetId)).toBeNull();
      expect(await db.select().from(assetPostures).where(eq(assetPostures.supportingAssetId, assetId))).toEqual([]);
    });

    it('should list each tenant only its own technique findings', async () => {
      const tenantBId = await createTenant(services, adminUserId);
      const originB: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };
      const assetA = await createAsset('Tenant A tested host');
      const techniqueA = await failedPrevention(assetA);
      const assetB = uuidv7();
      await services.withOrigin(originB).supportingAssets.createSupportingAsset({
        id: assetB, name: 'Tenant B tested host', description: null, ownerId: null,
        exposure: 'internet_facing', categoryId: 'host', criticality: 'high',
      });
      const techniqueB = await attachTechnique(assetB, daysAgo(1), undefined, { tenantId: tenantBId });

      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();

      expect((await listEstate(adminOrigin)).items.map((row) => row.evidenceId)).toEqual([techniqueA]);
      expect((await listEstate(originB)).items.map((row) => row.evidenceId)).toEqual([techniqueB]);
    });
  });

  describe('panel baselines', () => {
    const attachCveAt = async (
      supportingAssetId: string,
      cveTextId: string,
      createdAt: Date,
    ): Promise<string> => {
      const id = uuidv7();
      await db.insert(assetEvidence).values([{
        id,
        supportingAssetId,
        tenantId: adminTenantId,
        cveId: await insertCve(cveTextId),
        userId: adminUserId,
        createdAt,
      }]);
      return id;
    };

    const insertUserDecision = async (
      evidenceId: string,
      state: 'applicable' | 'dismissed',
      stateChangedAt: Date,
    ): Promise<void> => {
      await db.insert(assetEvidenceHistory).values([{
        id: uuidv7(),
        tenantId: adminTenantId,
        assetEvidenceId: evidenceId,
        state,
        stateChangedAt,
        changedByUserId: adminUserId,
        origin: 'user',
      }]);
    };

    it('should answer with zeros on a tenant that has never carried a finding', async () => {
      const baselines = await services.withOrigin(adminOrigin).findingScore.getFindingBaselines();

      expect(baselines).toMatchObject({
        findingsStockBefore: 0,
        impactedAssetsStockBefore: 0,
        newInPreviousWindow: 0,
      });
      expect(baselines.windowStart).toBeInstanceOf(Date);
    });

    it('should count a finding that already existed a week ago and was never dismissed', async () => {
      const assetId = await createAsset('Old host');
      await attachCveAt(assetId, 'CVE-2026-1001', daysAgo(10));

      const baselines = await services.withOrigin(adminOrigin).findingScore.getFindingBaselines();

      expect(baselines.findingsStockBefore).toBe(1);
      expect(baselines.impactedAssetsStockBefore).toBe(1);
    });

    it('should leave a finding born inside the window out of the stock it is compared against', async () => {
      const assetId = await createAsset('Fresh host');
      await attachCveAt(assetId, 'CVE-2026-1002', daysAgo(3));

      const baselines = await services.withOrigin(adminOrigin).findingScore.getFindingBaselines();

      expect(baselines.findingsStockBefore).toBe(0);
      expect(baselines.newInPreviousWindow).toBe(0);
    });

    it('should leave out a finding already dismissed a week ago', async () => {
      const assetId = await createAsset('Cleared host');
      const evidenceId = await attachCveAt(assetId, 'CVE-2026-1003', daysAgo(20));
      await insertSyncedVerdict(evidenceId, 'dismissed', daysAgo(15));

      const baselines = await services.withOrigin(adminOrigin).findingScore.getFindingBaselines();

      expect(baselines.findingsStockBefore).toBe(0);
      expect(baselines.impactedAssetsStockBefore).toBe(0);
    });

    it('should count a finding only dismissed since, because it was standing a week ago', async () => {
      const assetId = await createAsset('Recently cleared host');
      const evidenceId = await attachCveAt(assetId, 'CVE-2026-1004', daysAgo(20));
      await insertSyncedVerdict(evidenceId, 'dismissed', daysAgo(2));

      const baselines = await services.withOrigin(adminOrigin).findingScore.getFindingBaselines();

      expect(baselines.findingsStockBefore).toBe(1);
    });

    it('should replay the last state before the window and not the first', async () => {
      const assetId = await createAsset('Reopened host');
      const evidenceId = await attachCveAt(assetId, 'CVE-2026-1005', daysAgo(30));
      await insertSyncedVerdict(evidenceId, 'dismissed', daysAgo(25));
      await insertSyncedVerdict(evidenceId, 'applicable', daysAgo(9));

      const baselines = await services.withOrigin(adminOrigin).findingScore.getFindingBaselines();

      expect(baselines.findingsStockBefore).toBe(1);
    });

    it('should move the stock on a state a person set, exactly as on a verdict a connector wrote', async () => {
      const assetId = await createAsset('Hand-cleared host');
      const evidenceId = await attachCveAt(assetId, 'CVE-2026-1006', daysAgo(20));
      await insertUserDecision(evidenceId, 'dismissed', daysAgo(15));

      const baselines = await services.withOrigin(adminOrigin).findingScore.getFindingBaselines();

      expect(baselines.findingsStockBefore).toBe(0);
    });

    it('should count an asset once however many findings it carried', async () => {
      const assetId = await createAsset('Crowded host');
      await attachCveAt(assetId, 'CVE-2026-1007', daysAgo(10));
      await attachCveAt(assetId, 'CVE-2026-1008', daysAgo(10));

      const baselines = await services.withOrigin(adminOrigin).findingScore.getFindingBaselines();

      expect(baselines.findingsStockBefore).toBe(2);
      expect(baselines.impactedAssetsStockBefore).toBe(1);
    });

    it('should report the previous window as the findings born in it that were still standing at its end', async () => {
      const assetId = await createAsset('Busy host');
      await attachCveAt(assetId, 'CVE-2026-1009', daysAgo(10));
      const clearedId = await attachCveAt(assetId, 'CVE-2026-1010', daysAgo(11));
      await insertSyncedVerdict(clearedId, 'dismissed', daysAgo(8));
      await attachCveAt(assetId, 'CVE-2026-1011', daysAgo(20));

      const baselines = await services.withOrigin(adminOrigin).findingScore.getFindingBaselines();

      expect(baselines.newInPreviousWindow).toBe(1);
      expect(baselines.findingsStockBefore).toBe(2);
    });
  });

  describe('tenant isolation', () => {
    it('should show each tenant only its own findings on every procedure', async () => {
      const tenantBId = await createTenant(services, adminUserId);
      const originB: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };

      const assetA = await createAsset('Tenant A host', { exposure: 'internet_facing', criticality: 'high' });
      const cveA = await insertCve('CVE-2026-0006', { kev: true });
      const evidenceA = await attachCve(assetA, cveA);

      const assetB = uuidv7();
      await services.withOrigin(originB).supportingAssets.createSupportingAsset({
        id: assetB, name: 'Tenant B host', description: null, ownerId: null,
        exposure: 'internet_facing', categoryId: 'host', criticality: 'high',
      });
      const cveB = await insertCve('CVE-2026-0007', { kev: true }, tenantBId);
      await db.insert(assetEvidence).values([{
        id: uuidv7(), supportingAssetId: assetB, tenantId: tenantBId, cveId: cveB, userId: adminUserId,
        createdAt: daysAgo(10),
      }]);

      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();
      await services.withOrigin(originB).findingScore.recomputeFindingScores();
      const estateA = await listEstate(adminOrigin);
      const estateB = await listEstate(originB);
      expect(estateA.items.map((finding) => finding.cveId)).toEqual(['CVE-2026-0006']);
      expect(estateB.items.map((finding) => finding.cveId)).toEqual(['CVE-2026-0007']);

      expect(await listAsset(assetA, {}, originB)).toMatchObject({ items: [], total: 0 });
      expect(await services.withOrigin(originB).findingScore.getFindingScoreBreakdown(evidenceA)).toBeNull();
      expect(await services.withOrigin(originB).findingScore.getAssetPosture(assetA)).toBeNull();
      expect((await services.withOrigin(originB).findingScore.getAssetPosture(assetB))?.worstFinding.name).toBe('CVE-2026-0007');
      // Only tenant B carries a finding old enough to be in the replayed stock, so a leak would
      // show up as a non-zero on A rather than as a shared figure.
      expect(await services.withOrigin(adminOrigin).findingScore.getFindingBaselines()).toMatchObject({
        findingsStockBefore: 0,
        impactedAssetsStockBefore: 0,
        newInPreviousWindow: 0,
      });
      expect(await services.withOrigin(originB).findingScore.getFindingBaselines()).toMatchObject({
        findingsStockBefore: 1,
        impactedAssetsStockBefore: 1,
        newInPreviousWindow: 1,
      });
    });

    it('should leave another tenant scoring an unclassified asset at its own band', async () => {
      const tenantBId = await createTenant(services, adminUserId);
      const originB: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };
      const assetB = uuidv7();
      await services.withOrigin(originB).supportingAssets.createSupportingAsset({
        id: assetB, name: 'Tenant B host', description: null, ownerId: null,
        exposure: 'internet_facing', categoryId: 'host', criticality: 'unknown',
      });
      await attachCve(assetB, await insertCve('CVE-2026-0031', { kev: true }, tenantBId), tenantBId);

      await services.withOrigin(adminOrigin).crqIndicatorSettings.updateCrqIndicatorSettings({ unknownCriticalityCountsAs: 'very_high' });

      expect((await services.withOrigin(originB).crqIndicatorSettings.getCrqIndicatorSettings()).unknownCriticalityCountsAs).toBe('low');
      const [findingB] = await scoredForAsset(assetB, originB);
      expect(findingB.factors.potentialImpact.value).toBe(0.4);
    });

    it('should write each tenant its own projection under the job origin the worker uses', async () => {
      const tenantBId = await createTenant(services, adminUserId);
      const jobA: EventOrigin = { type: 'job', tenantId: adminTenantId, jobKind: 'finding-score-recompute', interactive: false };
      const jobB: EventOrigin = { type: 'job', tenantId: tenantBId, jobKind: 'finding-score-recompute', interactive: false };

      const assetA = await createAsset('Tenant A host', { exposure: 'internet_facing', criticality: 'high' });
      await attachCve(assetA, await insertCve('CVE-2026-0008', { kev: true }));

      const assetB = uuidv7();
      await services.withOrigin({ type: 'client', userId: adminUserId, tenantId: tenantBId })
        .supportingAssets.createSupportingAsset({
          id: assetB, name: 'Tenant B host', description: null, ownerId: null,
          exposure: 'internet_facing', categoryId: 'host', criticality: 'high',
        });
      const cveB = await insertCve('CVE-2026-0009', { kev: true }, tenantBId);
      await db.insert(assetEvidence).values([{
        id: uuidv7(), supportingAssetId: assetB, tenantId: tenantBId, cveId: cveB, userId: adminUserId,
      }]);

      expect(await services.withOrigin(jobA).findingScore.recomputeFindingScores()).toEqual({ scored: 1 });
      expect(await services.withOrigin(jobB).findingScore.recomputeFindingScores()).toEqual({ scored: 1 });

      expect((await listEstate(jobA)).items.map((finding) => finding.cveId)).toEqual(['CVE-2026-0008']);
      expect((await listEstate(jobB)).items.map((finding) => finding.cveId)).toEqual(['CVE-2026-0009']);
    });
  });

  describe('the other impacted assets of a flaw', () => {
    const writeCveFinding = async (supportingAssetId: string, cveUuid: string): Promise<string> => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createEvidence({
        id, supportingAssetId, cveId: cveUuid, userId: adminUserId,
      });
      return id;
    };

    it('should count an accepted risk and drop a denied or no-longer-seen flaw', async () => {
      const here = await createAsset('Here', { exposure: 'internet_facing' });
      const accepted = await createAsset('Accepted elsewhere', { exposure: 'internet_facing' });
      const acceptedToo = await createAsset('Also accepted elsewhere', { exposure: 'internet_facing' });
      const denied = await createAsset('Denied elsewhere', { exposure: 'internet_facing' });
      const gone = await createAsset('Patched elsewhere', { exposure: 'internet_facing' });
      const stillOpen = await createAsset('Open elsewhere', { exposure: 'internet_facing' });
      const log4shell = await insertCve('CVE-2021-44228', { kev: true });

      const evidenceId = await writeCveFinding(here, log4shell);
      await writeCveFinding(stillOpen, log4shell);
      for (const asset of [accepted, acceptedToo]) {
        await services.withOrigin(adminOrigin).supportingAssets.dismissEvidence({
          evidenceId: await writeCveFinding(asset, log4shell),
          dismissalType: 'risk_accepted',
          reasonCode: 'patch_unavailable',
          reason: 'No vendor fix yet',
          changedByUserId: adminUserId,
        });
      }
      await services.withOrigin(adminOrigin).supportingAssets.dismissEvidence({
        evidenceId: await writeCveFinding(denied, log4shell),
        dismissalType: 'false_positive',
        reasonCode: 'not_applicable',
        reason: 'The library is not shipped here',
        changedByUserId: adminUserId,
      });
      // Dated after the row creation writes, which is what makes it the verdict that stands.
      await insertSyncedVerdict(await writeCveFinding(gone, log4shell), 'dismissed', new Date());
      // A finding no history row records stands in the state it was created in, so it still counts.
      await attachCve(await createAsset('Imported elsewhere', { exposure: 'internet_facing' }), log4shell);

      const breakdown = await breakdownOf(evidenceId);

      // The asset the finding sits on never counts, and of the six others only the four still
      // carrying the flaw do: a false positive says it was never there, a connector's dismissal
      // says it is no longer seen. Two accepted risks against one false positive, so that counting
      // the wrong kind of dismissal gives another total.
      expect(breakdown?.otherImpactedAssetCount).toBe(4);
    });
  });
});

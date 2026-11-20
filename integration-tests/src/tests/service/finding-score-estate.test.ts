import type { AssetCriticality, EventOrigin } from '@app/module';
import { assetEvidence, assetEvidenceSources, assetPostures, cve, findingScores, integrationSettings, supportingAssets, TECHNIQUE_T1003, TECHNIQUE_T1190 } from '@app/module';
import { eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  const { attachCve, attachTechnique, breakdownOf, createAsset, createConnector, insertCve, insertSyncedVerdict, listAsset, listEstate, scoredForAsset } = findingScoreFixtures(services, db, () => ({ origin: adminOrigin, tenantId: adminTenantId, userId: adminUserId }));

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminTenantId = setup.tenantId;
    adminUserId = setup.userId;
  });

  describe('the estate list', () => {
    it('should return one row per asset the flaw sits on, hottest first', async () => {
      const hot = await createAsset('Edge gateway', { exposure: 'internet_facing', criticality: 'high' });
      const cold = await createAsset('Internal box', { exposure: 'internal', criticality: 'unknown' });
      const spreadCve = await insertCve('CVE-2026-0003', { epss: 0.5, kev: true });
      const quietCve = await insertCve('CVE-2026-0004');
      await attachCve(hot, spreadCve);
      await attachCve(cold, spreadCve);
      await attachCve(cold, quietCve);

      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();
      const page = await listEstate(adminOrigin);

      expect(page.total).toBe(3);
      expect(page.unscored).toBe(0);
      expect(page.items.map((finding) => [finding.cveId, finding.assetName])).toEqual([
        ['CVE-2026-0003', 'Edge gateway'],
        ['CVE-2026-0003', 'Internal box'],
        ['CVE-2026-0004', 'Internal box'],
      ]);
      expect(page.items[0].score).toBe(93);
      expect(page.items[0].score).toBeGreaterThan(page.items[1].score ?? 0);
    });

    it('should slice the same ordering across pages without repeating or dropping a row', async () => {
      const flaw = await insertCve('CVE-2026-0010', { epss: 0.5 });
      for (let i = 0; i < 5; i += 1) {
        await attachCve(await createAsset(`Host ${i}`, { criticality: 'high' }), flaw);
      }
      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();

      const paged = services.withOrigin(adminOrigin).findingScore.listScoredFindings;
      const first = await paged({ page: 1, limit: 2, state: 'applicable', source: null, mappedToOrganizationId: null, sortBy: 'score', sortDesc: true });
      const second = await paged({ page: 2, limit: 2, state: 'applicable', source: null, mappedToOrganizationId: null, sortBy: 'score', sortDesc: true });
      const third = await paged({ page: 3, limit: 2, state: 'applicable', source: null, mappedToOrganizationId: null, sortBy: 'score', sortDesc: true });

      expect(first.total).toBe(5);
      const seen = [...first.items, ...second.items, ...third.items].map((row) => row.evidenceId);
      expect(seen).toHaveLength(5);
      expect(new Set(seen).size).toBe(5);
    });

    it('should name a finding\'s reporting sources, leaving out one whose connector was since deleted', async () => {
      const serviceAccountId = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({
        id: serviceAccountId, name: 'Test Connector Bot',
      });
      await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('openaev', serviceAccountId);
      const connectorId = (await services.withOrigin(adminOrigin).integrationSettings.getConnectorId('openaev'))!;
      const flaw = await insertCve('CVE-2026-0099');
      const assetId = await createAsset('Orphaned source host');
      const evidenceId = uuidv7();
      await db.insert(assetEvidence).values([{ id: evidenceId, supportingAssetId: assetId, tenantId: adminTenantId, cveId: flaw }]);
      await db.insert(assetEvidenceSources).values([{
        id: uuidv7(), tenantId: adminTenantId, assetEvidenceId: evidenceId, connectorId, sourceFindingId: `${assetId}:CVE-2026-0099`, evaluatedAt: new Date(),
      }]);
      // ON DELETE SET NULL: the source observation survives, its connector does not.
      await db.delete(integrationSettings).where(eq(integrationSettings.id, connectorId));
      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();

      const page = await listEstate(adminOrigin);
      expect(page.items.map((row) => row.evidenceId)).toEqual([evidenceId]);
      expect(page.items[0].sources).toEqual([]);
      const breakdown = await breakdownOf(evidenceId);
      expect(breakdown.sources).toEqual([]);
    });

    it('should filter the list to the findings one source reports, counting a consolidated one under each of its own', async () => {
      const openaevConnectorId = await createConnector();
      const graphServiceAccountId = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({
        id: graphServiceAccountId, name: 'Graph Bot',
      });
      await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('microsoft_graph', graphServiceAccountId);
      const graphConnectorId = (await services.withOrigin(adminOrigin).integrationSettings.getConnectorId('microsoft_graph'))!;
      const assetId = await createAsset('Reported host');

      const reportedBy = async (cveTextId: string, connectorIds: Array<string>): Promise<string> => {
        const evidenceId = uuidv7();
        const flaw = await insertCve(cveTextId);
        await db.insert(assetEvidence).values([{
          id: evidenceId, supportingAssetId: assetId, tenantId: adminTenantId, cveId: flaw,
        }]);
        await db.insert(assetEvidenceSources).values(connectorIds.map((connectorId) => ({
          id: uuidv7(),
          tenantId: adminTenantId,
          assetEvidenceId: evidenceId,
          connectorId,
          sourceFindingId: `${evidenceId}:${connectorId}`,
          evaluatedAt: new Date(),
        })));
        return evidenceId;
      };
      const openaevOnly = await reportedBy('CVE-2026-0201', [openaevConnectorId]);
      const graphOnly = await reportedBy('CVE-2026-0202', [graphConnectorId]);
      const consolidated = await reportedBy('CVE-2026-0203', [openaevConnectorId, graphConnectorId]);
      const handAttached = await attachCve(assetId, await insertCve('CVE-2026-0204'));

      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();
      const filteredBy = async (source: string | null): Promise<Array<string>> => {
        const page = await services.withOrigin(adminOrigin).findingScore.listScoredFindings({
          page: 1, limit: 50, state: 'applicable', source, mappedToOrganizationId: null, sortBy: 'score', sortDesc: true,
        });
        return page.items.map((row) => row.evidenceId).sort();
      };

      expect(await filteredBy('openaev')).toEqual([openaevOnly, consolidated].sort());
      expect(await filteredBy('microsoft_graph')).toEqual([graphOnly, consolidated].sort());
      // `user` names no connector: the findings with no source row at all.
      expect(await filteredBy('user')).toEqual([handAttached]);
      expect(await filteredBy(null)).toHaveLength(4);

      const counts = await services.withOrigin(adminOrigin).findingScore.getFindingCountsBySource();
      expect([...counts].sort((a, b) => (a.source ?? '').localeCompare(b.source ?? ''))).toEqual([
        { source: 'microsoft_graph', findingCount: 2 },
        { source: 'openaev', findingCount: 2 },
        { source: 'user', findingCount: 1 },
      ]);
    });

    it('should group the top vulnerabilities over their assets, each weighing its worst finding', async () => {
      const connectorId = await createConnector();
      const OPEN_VECTOR = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H';
      const spread = await insertCve('CVE-2026-0301', {}, undefined, OPEN_VECTOR);
      const lone = await insertCve('CVE-2026-0302');
      const critical = await createAsset('Crown host', { criticality: 'very_high', exposure: 'internet_facing' });
      const minor = await createAsset('Lab host', { criticality: 'low' });
      const reported = await attachCve(critical, spread);
      await db.insert(assetEvidenceSources).values([{
        id: uuidv7(), tenantId: adminTenantId, assetEvidenceId: reported, connectorId, sourceFindingId: reported, evaluatedAt: new Date(),
      }]);
      await attachCve(minor, spread);
      await attachCve(minor, lone);
      const setAside = await attachCve(critical, lone);
      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();
      await services.withOrigin(adminOrigin).supportingAssets.dismissEvidence({
        evidenceId: setAside, dismissalType: 'false_positive', reasonCode: 'detection_error', reason: 'Set aside', changedByUserId: adminUserId,
      });

      const listed = await listEstate(adminOrigin);
      const scoreOf = new Map(listed.items.map((row) => [row.evidenceId, row.score]));
      const top = await services.withOrigin(adminOrigin).findingScore.getTopVulnerabilities(null, 5);

      expect(top.map((row) => row.cveId)).toEqual(['CVE-2026-0301', 'CVE-2026-0302']);
      const spreadScores = listed.items.filter((row) => row.cveId === 'CVE-2026-0301').map((row) => row.score!);
      expect(top[0]).toMatchObject({ impactedAssetCount: 2, score: Math.max(...spreadScores), sources: ['openaev'] });
      expect(scoreOf.get(top[0].worstEvidenceId)).toBe(Math.max(...spreadScores));
      expect(top[1]).toMatchObject({ impactedAssetCount: 1, sources: [] });
    });

    it('should keep a technique in prevention apart from the same technique in detection', async () => {
      const connectorId = await createConnector();
      const gateway = await createAsset('Gateway host', { criticality: 'very_high', exposure: 'internet_facing' });
      const backOffice = await createAsset('Back office host', { criticality: 'low' });
      const preventions = [
        await attachTechnique(gateway, daysAgo(1), connectorId),
        await attachTechnique(backOffice, daysAgo(1)),
      ];
      const detection = await attachTechnique(backOffice, daysAgo(1), undefined, { expectationType: 'detection' });
      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();

      const listed = await listEstate(adminOrigin);
      const scoreOf = new Map(listed.items.map((row) => [row.evidenceId, row.score]));
      const top = await services.withOrigin(adminOrigin).findingScore.getTopVulnerabilities(null, 5);

      expect(top).toHaveLength(2);
      const prevention = top.find((row) => row.expectationType === 'prevention')!;
      expect(prevention).toMatchObject({ cveId: null, mitreTechniqueExternalId: 'T1003', impactedAssetCount: 2, sources: ['openaev'] });
      expect(preventions).toContain(prevention.worstEvidenceId);
      expect(scoreOf.get(prevention.worstEvidenceId) ?? null).toBe(prevention.score);
      expect(top.find((row) => row.expectationType === 'detection')).toMatchObject({
        mitreTechniqueExternalId: 'T1003', impactedAssetCount: 1, sources: [], worstEvidenceId: detection,
      });
    });

    it('should count a finding the recompute has not reached rather than hiding it', async () => {
      const flaw = await insertCve('CVE-2026-0011');
      await attachCve(await createAsset('Scored host'), flaw);
      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();
      await attachCve(await createAsset('Fresh host'), flaw);

      const page = await listEstate(adminOrigin);

      expect(page.total).toBe(1);
      expect(page.unscored).toBe(1);
    });

    it('should count only the findings not yet scored that the search matches', async () => {
      await attachCve(await createAsset('Fresh host'), await insertCve('CVE-2026-0011'));
      const unscoredMatching = async (search: string) => (await services.withOrigin(adminOrigin).findingScore.listScoredFindings({
        page: 1, limit: 50, state: 'applicable', source: null, mappedToOrganizationId: null, sortBy: 'score', sortDesc: true, search,
      })).unscored;

      expect(await unscoredMatching('0011')).toBe(1);
      expect(await unscoredMatching('fresh')).toBe(1);
      expect(await unscoredMatching('zzzz')).toBe(0);
    });

    describe('a finding on an asset with no name, known by its derived name', () => {
      let addressAssetId: string;

      beforeEach(async () => {
        addressAssetId = uuidv7();
        await db.insert(supportingAssets).values({
          id: addressAssetId, tenantId: adminTenantId, name: null, derivedName: '10.0.0.1', exposure: 'internal', categoryId: 'host', criticality: 'low',
        });
        const flaw = await insertCve('CVE-2026-0020');
        for (const assetId of [addressAssetId, await createAsset('Alpha host'), await createAsset('05 early host')]) {
          await attachCve(assetId, flaw);
        }
        await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();
      });

      it('should carry the derived name on the list, and sort by the name the asset displays', async () => {
        const page = await services.withOrigin(adminOrigin).findingScore.listScoredFindings({
          page: 1, limit: 50, state: 'applicable', source: null, mappedToOrganizationId: null, sortBy: 'assetName', sortDesc: false,
        });

        expect(page.items.map((row) => [row.assetName, row.assetDerivedName])).toEqual([
          ['05 early host', null],
          [null, '10.0.0.1'],
          ['Alpha host', null],
        ]);
      });

      it('should carry the derived name on the asset\'s findings and on the single-finding breakdown', async () => {
        const [onAsset] = await scoredForAsset(addressAssetId);
        expect([onAsset.assetName, onAsset.assetDerivedName]).toEqual([null, '10.0.0.1']);

        const breakdown = await services.withOrigin(adminOrigin).findingScore.getFindingScoreBreakdown(onAsset.evidenceId);
        expect([breakdown!.assetName, breakdown!.assetDerivedName]).toEqual([null, '10.0.0.1']);
      });
    });

    it('should sort by asset name with case and accents folded together, in both directions', async () => {
      const flaw = await insertCve('CVE-2026-0021');
      for (const name of ['Zèbre', 'école', 'eden', 'Ecole', 'abc']) {
        await attachCve(await createAsset(name), flaw);
      }
      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();
      const assetNames = async (sortDesc: boolean) => (await services.withOrigin(adminOrigin).findingScore.listScoredFindings({
        page: 1, limit: 50, state: 'applicable', source: null, mappedToOrganizationId: null, sortBy: 'assetName', sortDesc,
      })).items.map((row) => row.assetName);

      expect(await assetNames(false)).toEqual(['abc', 'Ecole', 'école', 'eden', 'Zèbre']);
      expect(await assetNames(true)).toEqual(['Zèbre', 'eden', 'école', 'Ecole', 'abc']);
    });

    it('should narrow on the flaw\'s id or name and on the asset\'s name, counted alike', async () => {
      const gateway = await createAsset('Edge gateway');
      const laptop = await createAsset('Poste élève');
      const gatewayFlawId = await attachCve(gateway, await insertCve('CVE-2026-0801'));
      const laptopFlawId = await attachCve(laptop, await insertCve('CVE-2026-0802'));
      const techniqueId = await attachTechnique(laptop, daysAgo(2), await createConnector(), { mitreTechniqueId: TECHNIQUE_T1003, expectationType: 'prevention' });
      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();
      const ids = async (search: string) => {
        const page = await services.withOrigin(adminOrigin).findingScore.listScoredFindings({
          page: 1, limit: 50, state: 'applicable', source: null, search, mappedToOrganizationId: null, sortBy: 'score', sortDesc: true,
        });
        expect(page.total).toBe(page.items.length);
        return page.items.map((row) => row.evidenceId).toSorted();
      };

      expect(await ids('0801')).toEqual([gatewayFlawId]);
      expect(await ids('credential dumping')).toEqual([techniqueId]);
      expect(await ids('ELEVE')).toEqual([laptopFlawId, techniqueId].toSorted());
      expect(await ids('100%')).toEqual([]);
    });

    it('should drop a dismissed finding from the list as soon as the state is written', async () => {
      const flaw = await insertCve('CVE-2026-0012');
      const evidenceId = await attachCve(await createAsset('Set-aside host'), flaw);
      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();
      expect((await listEstate(adminOrigin)).total).toBe(1);

      // No recompute in between: the state is stored with the history row.
      await services.withOrigin(adminOrigin).supportingAssets.dismissEvidence({
        evidenceId: evidenceId, dismissalType: 'false_positive', reasonCode: 'detection_error', reason: 'Set aside', changedByUserId: adminUserId,
      });

      expect((await listEstate(adminOrigin)).total).toBe(0);
      const dismissed = await services.withOrigin(adminOrigin).findingScore.listScoredFindings({
        page: 1, limit: 50, state: 'dismissed', source: null, mappedToOrganizationId: null, sortBy: 'score', sortDesc: true,
      });
      expect(dismissed.items.map((row) => row.evidenceId)).toEqual([evidenceId]);
    });
  });

  describe('one asset\'s findings list', () => {
    let assetId: string;
    let scoredId: string;
    let unscoredId: string;
    let preventionId: string;
    let detectionId: string;

    beforeEach(async () => {
      assetId = await createAsset('Edge gateway', { exposure: 'internet_facing', criticality: 'high' });
      const neighbour = await createAsset('Neighbour');
      scoredId = await attachCve(assetId, await insertCve('CVE-2026-0701', { kev: true }));
      await attachCve(neighbour, await insertCve('CVE-2026-0702'));
      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();
      unscoredId = await attachCve(assetId, await insertCve('CVE-2026-0703'));
      const connectorId = await createConnector();
      preventionId = await attachTechnique(assetId, daysAgo(2), connectorId, { mitreTechniqueId: TECHNIQUE_T1190, expectationType: 'prevention' });
      detectionId = await attachTechnique(assetId, daysAgo(2), undefined, { mitreTechniqueId: TECHNIQUE_T1003, expectationType: 'detection' });
      await insertSyncedVerdict(detectionId, 'dismissed', daysAgo(1));
    });

    it('should list every finding of the asset, a CVE not scored yet with no score', async () => {
      const page = await listAsset(assetId);

      expect(page.total).toBe(4);
      expect(page.items.map((finding) => [finding.evidenceId, finding.score === null, finding.currentState])).toEqual([
        [scoredId, false, 'applicable'],
        [unscoredId, true, 'applicable'],
        [detectionId, true, 'dismissed'],
        [preventionId, true, 'applicable'],
      ]);
      expect(page.items.map((finding) => finding.sourceCount)).toEqual([0, 0, 0, 1]);
    });

    it('should narrow on the state, the technique and its expectation, and the search', async () => {
      const ids = async (overrides: Parameters<typeof listAsset>[1]) => {
        const page = await listAsset(assetId, overrides);
        expect(page.total).toBe(page.items.length);
        return page.items.map((finding) => finding.evidenceId);
      };

      expect(await ids({ state: 'applicable' })).toEqual([scoredId, unscoredId, preventionId]);
      expect(await ids({ state: 'dismissed' })).toEqual([detectionId]);
      expect(await ids({ mitreTechniqueExternalId: 'T1190' })).toEqual([preventionId]);
      expect(await ids({ mitreTechniqueExternalId: 'T1003', expectationType: 'prevention' })).toEqual([]);
      expect(await ids({ search: '0703' })).toEqual([unscoredId]);
      expect(await ids({ search: 'credential dumping' })).toEqual([detectionId]);
      expect(await ids({ search: '100%' })).toEqual([]);
      expect(await ids({ search: 'edge gateway' })).toEqual([]);
    });

    it('should search the finding names across accents and ligatures in both directions', async () => {
      const accentedFlawId = await insertCve('CVE-2026-0704');
      await db.update(cve).set({ cveTitle: 'École Straße' }).where(eq(cve.id, accentedFlawId));
      const accentedId = await attachCve(assetId, accentedFlawId);
      const ids = async (search: string) => (await listAsset(assetId, { search })).items.map((finding) => finding.evidenceId);

      expect(await ids('ecole')).toEqual([accentedId]);
      expect(await ids('strasse')).toEqual([accentedId]);
      expect(await ids('crédéntial dumping')).toEqual([detectionId]);
    });

    it('should read a connector\'s state change with no recompute in between', async () => {
      await insertSyncedVerdict(scoredId, 'dismissed', new Date());
      const [stored] = await db.select().from(findingScores).where(eq(findingScores.assetEvidenceId, scoredId));

      const dismissed = await listAsset(assetId, { state: 'dismissed', sortBy: 'currentState' });

      expect(dismissed.total).toBe(2);
      expect(dismissed.items.find((finding) => finding.evidenceId === scoredId)).toMatchObject({ currentState: 'dismissed', score: stored.score });
    });

    it('should slice the pages in the asked order', async () => {
      const first = await listAsset(assetId, { limit: 3, sortBy: 'score', sortDesc: true });
      const second = await listAsset(assetId, { page: 2, limit: 3, sortBy: 'score', sortDesc: true });

      expect([first.total, second.total]).toEqual([4, 4]);
      expect(first.items[0]?.evidenceId).toBe(scoredId);
      const seen = [...first.items, ...second.items].map((finding) => finding.evidenceId);
      expect(new Set(seen)).toEqual(new Set([scoredId, unscoredId, preventionId, detectionId]));
    });

    it('should not list another tenant\'s asset', async () => {
      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };

      expect(await listAsset(assetId, {}, otherOrigin)).toMatchObject({ total: 0, items: [] });
    });
  });

  describe('the asset posture', () => {
    const OPEN_VECTOR = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H';

    it('should fill the exploitability on a row whose score did not move', async () => {
      const flaw = await insertCve('CVE-2026-0100', { epss: 0.4 }, undefined, OPEN_VECTOR);
      const evidenceId = await attachCve(await createAsset('Backfilled host'), flaw);
      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();
      await db.update(findingScores).set({ exploitability: null, impact: null }).where(eq(findingScores.assetEvidenceId, evidenceId));

      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();

      const [row] = await db.select().from(findingScores).where(eq(findingScores.assetEvidenceId, evidenceId));
      expect(row.exploitability).not.toBeNull();
      expect(row.impact).not.toBeNull();
    });

    it('should read no posture on an asset with no applicable finding', async () => {
      const assetId = await createAsset('Clean host');
      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();

      expect(await services.withOrigin(adminOrigin).findingScore.getAssetPosture(assetId)).toBeNull();
    });

    it('should leave a dismissed finding out of the posture', async () => {
      const assetId = await createAsset('Triaged host', { exposure: 'internet_facing' });
      const worst = await attachCve(assetId, await insertCve('CVE-2026-0101', { kev: true }, undefined, OPEN_VECTOR));
      const kept = await attachCve(assetId, await insertCve('CVE-2026-0102'));
      await insertSyncedVerdict(worst, 'dismissed', new Date());
      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();

      const posture = await services.withOrigin(adminOrigin).findingScore.getAssetPosture(assetId);

      expect(posture?.worstFinding.evidenceId).toBe(kept);
      const counted = Object.values(posture?.countsByBand ?? {}).reduce((total, count) => total + count, 0);
      expect(counted).toBe(1);
    });

    it('should not move with the asset criticality', async () => {
      const createExposedAsset = async (criticality: AssetCriticality, cveTextId: string) => {
        const assetId = await createAsset(`Host ${criticality}`, { criticality, exposure: 'internet_facing' });
        await attachCve(assetId, await insertCve(cveTextId, { epss: 0.3 }, undefined, OPEN_VECTOR));
        return assetId;
      };
      const top = await createExposedAsset('very_high', 'CVE-2026-0103');
      const low = await createExposedAsset('low', 'CVE-2026-0104');
      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();

      const read = services.withOrigin(adminOrigin).findingScore;
      expect((await read.getAssetPosture(top))?.score).toBe((await read.getAssetPosture(low))?.score);
    });

    it('should not move with the CVSS impact', async () => {
      const full = await createAsset('Fully hit host', { exposure: 'internet_facing' });
      const narrow = await createAsset('Barely hit host', { exposure: 'internet_facing' });
      await attachCve(full, await insertCve('CVE-2026-0105', { epss: 0.3 }, undefined, OPEN_VECTOR));
      await attachCve(narrow, await insertCve('CVE-2026-0106', { epss: 0.3 }, undefined, 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L'));
      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();

      const read = services.withOrigin(adminOrigin).findingScore;
      const onFull = await read.getAssetPosture(full);
      const onNarrow = await read.getAssetPosture(narrow);
      expect(onFull?.score).toBe(onNarrow?.score);
      expect(onNarrow?.worstFinding.impact).toBeLessThan(onFull?.worstFinding.impact ?? 0);
    });

    it('should take the worst finding\'s exploitability off, and carry its impact and score beside it', async () => {
      const assetId = await createAsset('Low value host', { criticality: 'low', exposure: 'internet_facing' });
      const evidenceId = await attachCve(assetId, await insertCve('CVE-2026-0107', { epss: 0.3 }, undefined, OPEN_VECTOR));
      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();

      const posture = await services.withOrigin(adminOrigin).findingScore.getAssetPosture(assetId);
      const [finding] = await services.withOrigin(adminOrigin).findingScore.getScoredFindingsByEvidenceIds([evidenceId]);
      const breakdown = await breakdownOf(evidenceId);

      expect(posture?.worstFinding.exploitability).toBe(Math.trunc(100 * (breakdown?.exploitability ?? 0)));
      expect(posture?.worstFinding.impact).toBe(Math.trunc(100 * (breakdown?.impact ?? 0)));
      expect(posture?.worstFinding.score).toBe(finding?.score);
      expect(posture?.composition.removedPoints).toBeCloseTo((posture?.worstFinding.exploitability ?? 0) + (posture?.composition.tailPoints ?? 0));
    });
  });

  describe('the stored asset posture', () => {
    const OPEN_VECTOR = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H';

    const storedPosture = async (supportingAssetId: string) => {
      const [row] = await db.select().from(assetPostures).where(eq(assetPostures.supportingAssetId, supportingAssetId));
      return row;
    };

    const rowVersion = async (supportingAssetId: string): Promise<string> => {
      const result = await db.execute<{ version: string }>(sql`select xmin::text as version from asset_postures where supporting_asset_id = ${supportingAssetId}`);
      return result.rows[0].version;
    };

    it('should store the posture the asset header reads, asset by asset', async () => {
      const exposed = await createAsset('Exposed host', { exposure: 'internet_facing' });
      await attachCve(exposed, await insertCve('CVE-2026-0200', { kev: true }, undefined, OPEN_VECTOR));
      await attachCve(exposed, await insertCve('CVE-2026-0201'));
      const quiet = await createAsset('Quiet host');
      await attachCve(quiet, await insertCve('CVE-2026-0202'));
      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();

      const read = services.withOrigin(adminOrigin).findingScore;
      expect((await storedPosture(exposed))?.score).toBe((await read.getAssetPosture(exposed))?.score);
      expect((await storedPosture(quiet))?.score).toBe((await read.getAssetPosture(quiet))?.score);
      expect((await storedPosture(exposed))?.score).not.toBe((await storedPosture(quiet))?.score);
    });

    it('should drop the posture of an asset whose last applicable finding was dismissed', async () => {
      const assetId = await createAsset('Triaged host');
      const evidenceId = await attachCve(assetId, await insertCve('CVE-2026-0203'));
      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();
      expect(await storedPosture(assetId)).toBeDefined();

      await insertSyncedVerdict(evidenceId, 'dismissed', new Date());
      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();

      expect(await storedPosture(assetId)).toBeUndefined();
    });

    it('should not rewrite a posture when no finding score moved', async () => {
      const assetId = await createAsset('Steady host');
      await attachCve(assetId, await insertCve('CVE-2026-0204', { epss: 0.4 }));
      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();
      const before = await rowVersion(assetId);

      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();

      expect(await rowVersion(assetId)).toBe(before);
    });

    it('should go with the asset when the asset is deleted', async () => {
      const assetId = await createAsset('Retired host');
      await attachCve(assetId, await insertCve('CVE-2026-0205'));
      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();

      await services.withOrigin(adminOrigin).supportingAssets.deleteSupportingAssets([assetId]);

      expect(await storedPosture(assetId)).toBeUndefined();
    });

    it('should leave another tenant\'s postures alone when one tenant recomputes', async () => {
      const tenantBId = await createTenant(services, adminUserId);
      const originB: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };
      const assetB = uuidv7();
      await services.withOrigin(originB).supportingAssets.createSupportingAsset({
        id: assetB, name: 'Tenant B host', description: null, ownerId: null,
        exposure: 'internet_facing', categoryId: 'host', criticality: 'high',
      });
      await attachCve(assetB, await insertCve('CVE-2026-0206', { kev: true }, tenantBId), tenantBId);
      await services.withOrigin(originB).findingScore.recomputeFindingScores();
      const storedB = await storedPosture(assetB);

      await attachCve(await createAsset('Tenant A host'), await insertCve('CVE-2026-0207'));
      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();

      expect(await storedPosture(assetB)).toEqual(storedB);
    });
  });

  describe('the posture in the asset list', () => {
    const listAssets = async (sortDesc: boolean) =>
      services.withOrigin(adminOrigin).supportingAssets.listSupportingAssets({
        page: 1,
        limit: 50,
        search: null,
        source: null,
        mappedToOrganizationId: null,
        membershipOrganizationId: null,
        sortBy: 'posture',
        sortDesc,
      });

    it('should show each asset the posture its header reads, and none on an asset with nothing to measure', async () => {
      const exposed = await createAsset('Exposed host', { exposure: 'internet_facing' });
      await attachCve(exposed, await insertCve('CVE-2026-0210', { kev: true }));
      const clean = await createAsset('Clean host');
      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();

      const { items } = await listAssets(false);

      const header = await services.withOrigin(adminOrigin).findingScore.getAssetPosture(exposed);
      expect(items.find((asset) => asset.id === exposed)?.posture).toBe(header?.score);
      expect(items.find((asset) => asset.id === clean)?.posture).toBeNull();
    });

    it('should sort the weakest posture first, and an asset with nothing to measure last either way', async () => {
      const weak = await createAsset('Weak host', { exposure: 'internet_facing' });
      await attachCve(weak, await insertCve('CVE-2026-0211', { kev: true }));
      const strong = await createAsset('Strong host');
      await attachCve(strong, await insertCve('CVE-2026-0212'));
      const clean = await createAsset('Clean host');
      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();

      const ascending = (await listAssets(false)).items;
      const descending = (await listAssets(true)).items;

      expect(ascending[0].posture).toBeLessThan(ascending[1].posture ?? 0);
      expect(ascending.map((asset) => asset.id)).toEqual([weak, strong, clean]);
      expect(descending.map((asset) => asset.id)).toEqual([strong, weak, clean]);
    });
  });

  describe('the recompute', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    const projectionOf = async (evidenceId: string) => {
      const [row] = await db.select().from(findingScores).where(eq(findingScores.assetEvidenceId, evidenceId));
      return row;
    };

    it('should leave a row alone when nothing about it moved', async () => {
      const flaw = await insertCve('CVE-2026-0020', { epss: 0.4 });
      const evidenceId = await attachCve(await createAsset('Steady host'), flaw);
      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();
      const first = await projectionOf(evidenceId);

      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();
      const second = await projectionOf(evidenceId);

      // The timestamp is the tell: a rewritten row would carry the second run's instant.
      expect(second.scoreChangedAt).toEqual(first.scoreChangedAt);
      expect(second.score).toBe(first.score);
    });

    it('should re-score a finding on an unclassified asset when the tenant changes the band it counts as', async () => {
      const evidenceId = await attachCve(await createAsset('Unclassified host'), await insertCve('CVE-2026-0022', { kev: true }));
      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();
      const low = await projectionOf(evidenceId);

      await services.withOrigin(adminOrigin).crqIndicatorSettings.updateCrqIndicatorSettings({ unknownCriticalityCountsAs: 'very_high' });
      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();
      const top = await projectionOf(evidenceId);

      expect(low.potentialImpact).toBe(0.4);
      expect(top.potentialImpact).toBe(1);
      expect(top.score).toBeGreaterThan(low.score!);
    });

    it('should re-score a finding on an asset of unknown exposure when the tenant changes what it counts as', async () => {
      const evidenceId = await attachCve(await createAsset('Unknown exposure host'), await insertCve('CVE-2026-0023', { kev: true }));
      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();
      const internal = await projectionOf(evidenceId);

      await services.withOrigin(adminOrigin).crqIndicatorSettings.updateCrqIndicatorSettings({ unknownExposureCountsAs: 'internet_facing' });
      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();
      const exposed = await projectionOf(evidenceId);

      expect(internal.reachability).toBe(0.4);
      expect(exposed.reachability).toBe(1);
      expect(exposed.score).toBeGreaterThan(internal.score!);
    });
  });

  describe('the panel counts', () => {
    it('should fold the whole estate by band, not the page the list is showing', async () => {
      const hot = await insertCve('CVE-2026-0013', { epss: 0.9, kev: true });
      const quiet = await insertCve('CVE-2026-0014');
      const sharedAsset = await createAsset('Edge gateway', { exposure: 'internet_facing', criticality: 'high' });
      await attachCve(sharedAsset, hot);
      await attachCve(sharedAsset, quiet);
      await attachCve(await createAsset('Internal box', { exposure: 'internal', criticality: 'unknown' }), quiet);
      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();

      const counts = await services.withOrigin(adminOrigin).findingScore.getFindingsPanelCounts();

      expect(counts.findings).toBe(3);
      // Two findings on one asset are one impacted asset.
      expect(counts.impactedAssets).toBe(2);
      expect(counts.bands.reduce((sum, band) => sum + band.total, 0)).toBe(3);
    });
  });
});

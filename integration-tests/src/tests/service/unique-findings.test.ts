import type { EventOrigin, IntegrationSource, UniqueFindingSortKey, VulnerabilityFilter } from '@app/module';
import {
  assetEvidence,
  assetEvidenceHistory,
  assetEvidenceSources,
  computeUniqueScore,
  cve,
  findingScores,
  resolveSeverityBand,
  supportingAssetMachineProperties,
  supportingAssetSources,
  TECHNIQUE_T1003,
  TECHNIQUE_T1027,
  uniqueFindingScoreHistory,
  uniqueFindingScores,
} from '@app/module';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { MAXIMAL_CVSS_VECTOR } from '../../helpers/finding-score-fixtures';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): Date => new Date(Date.now() - days * DAY_MS);

describe('Unique findings', () => {
  let adminOrigin: EventOrigin;
  let adminTenantId: string;
  let adminUserId: string;
  let assetIds: Array<string>;
  let defenderConnectorId: string;
  let openaevConnectorId: string;
  let cves: { wide: string, single: string, dismissedOnly: string, lifted: string };

  const createAsset = async (origin: EventOrigin, name: string): Promise<string> => {
    const id = uuidv7();
    await services.withOrigin(origin).supportingAssets.createSupportingAsset({
      id, name, description: null, ownerId: null, exposure: 'unknown', categoryId: 'host',
    });
    return id;
  };

  const createConnector = async (source: IntegrationSource): Promise<string> => {
    const serviceAccountId = uuidv7();
    await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: `${source} bot` });
    await services.withOrigin(adminOrigin).integrationSettings.configureIntegration(source, serviceAccountId);
    return (await services.withOrigin(adminOrigin).integrationSettings.getConnectorId(source))!;
  };

  /** `listed` dates a CISA listing; `kev` alone is what a connector sets for an exploit it saw. */
  const insertCve = async (cveId: string, signals: { kev?: boolean, listed?: boolean, epss?: number } = {}, tenantId = adminTenantId): Promise<string> => {
    const id = uuidv7();
    await db.insert(cve).values([{
      id, tenantId, cveId, cveTitle: `${cveId} title`, cvssVector: MAXIMAL_CVSS_VECTOR, kev: signals.kev ?? null, kevUpdatedAt: signals.listed === true ? daysAgo(30) : null, epss: signals.epss ?? null,
    }]);
    return id;
  };

  const reportedBy = async (evidenceId: string, connectorId: string): Promise<void> => {
    await db.insert(assetEvidenceSources).values([{
      id: uuidv7(), tenantId: adminTenantId, assetEvidenceId: evidenceId, connectorId, sourceFindingId: `finding-${evidenceId}`, evaluatedAt: new Date(),
    }]);
  };

  /** A finding carrying the score line a recompute would leave, at a chosen score; a dismissal is in its history too. */
  const scoredCveFinding = async (
    supportingAssetId: string,
    cveRef: string,
    score: number,
    options: { state?: 'applicable' | 'dismissed', connectorId?: string, firstSeenAt?: Date, tenantId?: string } = {},
  ): Promise<string> => {
    const id = uuidv7();
    const tenantId = options.tenantId ?? adminTenantId;
    await db.insert(assetEvidence).values([{
      id, supportingAssetId, tenantId, cveId: cveRef, userId: adminUserId, createdAt: options.firstSeenAt ?? new Date(),
    }]);
    await db.insert(findingScores).values([{
      assetEvidenceId: id, tenantId, score, band: resolveSeverityBand(score),
    }]);
    if (options.state === 'dismissed') {
      const dismissedAt = new Date();
      await db.insert(assetEvidenceHistory).values([{
        id: uuidv7(), tenantId, assetEvidenceId: id, stateChangedAt: dismissedAt, observedAt: dismissedAt, state: 'dismissed', origin: 'not_exposed',
      }]);
    }
    if (options.connectorId !== undefined) {
      await reportedBy(id, options.connectorId);
    }
    return id;
  };

  const techniqueFinding = async (
    supportingAssetId: string,
    connectorId: string,
    group: { mitreTechniqueId?: string, expectationType?: 'prevention' | 'detection' } = {},
  ): Promise<string> => {
    const id = uuidv7();
    await db.insert(assetEvidence).values([{
      id, supportingAssetId, tenantId: adminTenantId, mitreTechniqueId: group.mitreTechniqueId ?? TECHNIQUE_T1003, expectationType: group.expectationType ?? 'prevention', evaluatedAt: new Date(),
    }]);
    await reportedBy(id, connectorId);
    return id;
  };

  const listUnique = (
    params: { source?: IntegrationSource | 'user' | null, mappedToOrganizationId?: string | null, search?: string | null, sortBy?: UniqueFindingSortKey, sortDesc?: boolean, page?: number, limit?: number } = {},
    origin: EventOrigin = adminOrigin,
  ) => services.withOrigin(origin).findingScore.listUniqueFindings({
    page: params.page ?? 1,
    limit: params.limit ?? 50,
    source: params.source ?? null,
    mappedToOrganizationId: params.mappedToOrganizationId ?? null,
    search: params.search ?? null,
    sortBy: params.sortBy ?? 'score',
    sortDesc: params.sortDesc ?? true,
  });

  const names = (page: Awaited<ReturnType<typeof listUnique>>) =>
    page.items.map((row) => row.cveId ?? `${row.mitreTechniqueExternalId}/${row.expectationType}`);

  const createScope = async (mappedAssetIds: Array<string>): Promise<string> => {
    const scopeId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([
      { id: scopeId, name: 'Closed scope', estateMode: 'closed', mappedAssetIds },
    ]);
    return scopeId;
  };

  /**
   * CVE-2026-1000 on three assets at 85, 85 and 84, plus a dismissed 90 on a fourth; CVE-2026-2000
   * alone at 88; CVE-2026-4000 at 69 on three assets; CVE-2026-3000 dismissed everywhere; T1003 in
   * prevention on two assets. Defender reports the CVE findings but the 84, which OpenAEV reports
   * with the technique findings.
   */
  const seedEstate = async () => {
    const wide = await insertCve('CVE-2026-1000', { kev: true, listed: true, epss: 0.94 });
    await scoredCveFinding(assetIds[0], wide, 85, { connectorId: defenderConnectorId, firstSeenAt: daysAgo(3) });
    await scoredCveFinding(assetIds[1], wide, 85, { connectorId: defenderConnectorId, firstSeenAt: daysAgo(40) });
    await scoredCveFinding(assetIds[2], wide, 84, { connectorId: openaevConnectorId, firstSeenAt: daysAgo(10) });
    await scoredCveFinding(assetIds[3], wide, 90, { state: 'dismissed', connectorId: defenderConnectorId, firstSeenAt: daysAgo(400) });

    const single = await insertCve('CVE-2026-2000', { epss: 0.05 });
    await scoredCveFinding(assetIds[0], single, 88, { connectorId: defenderConnectorId });

    const dismissedOnly = await insertCve('CVE-2026-3000', { kev: true, listed: true });
    await scoredCveFinding(assetIds[1], dismissedOnly, 95, { state: 'dismissed', connectorId: defenderConnectorId });

    const lifted = await insertCve('CVE-2026-4000');
    for (const assetId of assetIds.slice(0, 3)) {
      await scoredCveFinding(assetId, lifted, 69, { connectorId: defenderConnectorId });
    }

    await techniqueFinding(assetIds[0], openaevConnectorId);
    await techniqueFinding(assetIds[1], openaevConnectorId);
    return { wide, single, dismissedOnly, lifted };
  };

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminTenantId = setup.tenantId;
    adminUserId = setup.userId;
    assetIds = [];
    for (const name of ['asset-a', 'asset-b', 'asset-c', 'asset-d']) {
      assetIds.push(await createAsset(adminOrigin, name));
    }
    defenderConnectorId = await createConnector('microsoft_graph');
    openaevConnectorId = await createConnector('openaev');
    cves = await seedEstate();
  });

  describe('the list, read from the stored projection', () => {
    /** The row a recompute would leave for a group of the seeded estate. */
    const storeUnique = (
      group: { cveRef: string } | { technique: true, mitreTechniqueId?: string, expectationType?: 'prevention' | 'detection' },
      figures: { scores: Array<number>, affectedAssetCount: number, firstSeenAt?: Date },
      scope: { organizationId?: string, tenantId?: string } = {},
    ) => {
      const score = computeUniqueScore(figures.scores);
      return db.insert(uniqueFindingScores).values([{
        id: uuidv7(),
        tenantId: scope.tenantId ?? adminTenantId,
        organizationId: scope.organizationId ?? null,
        cveId: 'cveRef' in group ? group.cveRef : null,
        mitreTechniqueId: 'technique' in group ? group.mitreTechniqueId ?? TECHNIQUE_T1003 : null,
        expectationType: 'technique' in group ? group.expectationType ?? 'prevention' : null,
        score,
        band: score === null ? null : resolveSeverityBand(Math.trunc(score)),
        worstScore: figures.scores.length === 0 ? null : Math.max(...figures.scores),
        affectedAssetCount: figures.affectedAssetCount,
        firstSeenAt: figures.firstSeenAt ?? new Date(),
      }]);
    };

    beforeEach(async () => {
      await storeUnique({ cveRef: cves.wide }, { scores: [85, 85, 84], affectedAssetCount: 3, firstSeenAt: daysAgo(40) });
      await storeUnique({ cveRef: cves.single }, { scores: [88], affectedAssetCount: 1 });
      await storeUnique({ cveRef: cves.lifted }, { scores: [69, 69, 69], affectedAssetCount: 3 });
      await storeUnique({ technique: true }, { scores: [], affectedAssetCount: 2 });
    });

    describe('the rows', () => {
      it('should list a CVE with its figures and the sources of its applicable findings', async () => {
        const page = await listUnique();
        const wide = page.items.find((row) => row.cveId === 'CVE-2026-1000');

        expect(wide).toMatchObject({ affectedAssetCount: 3, worstScore: 85, worstBand: 'high', knownExploited: true, epss: 0.94, cveTitle: 'CVE-2026-1000 title' });
        expect(wide?.sources.toSorted()).toEqual(['microsoft_graph', 'openaev']);
        expect(page.total).toBe(4);
      });

      it('should list no source for a group no connector reports, beside groups that have theirs', async () => {
        const handAttached = await insertCve('CVE-2026-6000');
        await scoredCveFinding(assetIds[0], handAttached, 50);
        await storeUnique({ cveRef: handAttached }, { scores: [50], affectedAssetCount: 1 });

        const page = await listUnique();

        expect(page.items.find((row) => row.cveId === 'CVE-2026-6000')?.sources).toEqual([]);
        expect(page.items.find((row) => row.cveId === 'CVE-2026-1000')?.sources.toSorted()).toEqual(['microsoft_graph', 'openaev']);
        expect(page.items.find((row) => row.mitreTechniqueExternalId === 'T1003')?.sources).toEqual(['openaev']);
      });

      it('should list each technique and expectation with its own sources', async () => {
        await techniqueFinding(assetIds[1], defenderConnectorId, { expectationType: 'detection' });
        await storeUnique({ technique: true, expectationType: 'detection' }, { scores: [], affectedAssetCount: 1 });
        await techniqueFinding(assetIds[1], defenderConnectorId, { mitreTechniqueId: TECHNIQUE_T1027 });
        await storeUnique({ technique: true, mitreTechniqueId: TECHNIQUE_T1027 }, { scores: [], affectedAssetCount: 1 });

        const techniqueRows = (await listUnique()).items.filter((row) => row.cveId === null);

        expect(Object.fromEntries(techniqueRows.map((row) => [`${row.mitreTechniqueExternalId}/${row.expectationType}`, row.sources]))).toEqual({
          'T1003/prevention': ['openaev'],
          'T1003/detection': ['microsoft_graph'],
          'T1027/prevention': ['microsoft_graph'],
        });
      });

      it('should not read a connector\'s exploit-available flag as a CISA listing', async () => {
        const flagged = await insertCve('CVE-2026-5000', { kev: true });
        await storeUnique({ cveRef: flagged }, { scores: [50], affectedAssetCount: 1 });

        expect((await listUnique()).items.find((row) => row.cveId === 'CVE-2026-5000')?.knownExploited).toBe(false);
      });

      it('should truncate the stored score as a finding score is, and band it above its worst finding when breadth lifts it', async () => {
        const page = await listUnique();

        expect(page.items.find((row) => row.cveId === 'CVE-2026-1000')?.score).toBe(Math.trunc(computeUniqueScore([85, 85, 84])!));
        expect(page.items.find((row) => row.cveId === 'CVE-2026-4000')).toMatchObject({ score: 70, band: 'high', worstScore: 69, worstBand: 'medium' });
      });

      it('should give a technique group no score and its own expectation', async () => {
        const technique = (await listUnique()).items.find((row) => row.mitreTechniqueExternalId === 'T1003');

        expect(technique).toMatchObject({
          cveId: null, expectationType: 'prevention', score: null, band: null, worstScore: null, knownExploited: null,
          affectedAssetCount: 2, sources: ['openaev'],
        });
      });
    });

    describe('the order and the pages', () => {
      it('should rank by score and put the technique group last whichever direction is asked', async () => {
        expect(names(await listUnique({ sortDesc: true }))).toEqual(['CVE-2026-2000', 'CVE-2026-1000', 'CVE-2026-4000', 'T1003/prevention']);
        expect(names(await listUnique({ sortDesc: false }))).toEqual(['CVE-2026-4000', 'CVE-2026-1000', 'CVE-2026-2000', 'T1003/prevention']);
      });

      it('should rank by affected assets, breaking a tie on the score', async () => {
        expect(names(await listUnique({ sortBy: 'affectedAssets' }))).toEqual(['CVE-2026-1000', 'CVE-2026-4000', 'T1003/prevention', 'CVE-2026-2000']);
      });

      it('should rank by the vulnerability name', async () => {
        expect(names(await listUnique({ sortBy: 'name', sortDesc: false }))).toEqual(['CVE-2026-1000', 'CVE-2026-2000', 'CVE-2026-4000', 'T1003/prevention']);
        expect(names(await listUnique({ sortBy: 'name', sortDesc: true }))).toEqual(['T1003/prevention', 'CVE-2026-4000', 'CVE-2026-2000', 'CVE-2026-1000']);
      });

      it('should rank the oldest group first on a descending age', async () => {
        expect(names(await listUnique({ sortBy: 'age' }))[0]).toBe('CVE-2026-1000');
      });

      it('should page on the server, every group served once', async () => {
        const first = await listUnique({ limit: 2, page: 1 });
        const second = await listUnique({ limit: 2, page: 2 });

        expect(names(first)).toEqual(['CVE-2026-2000', 'CVE-2026-1000']);
        expect(names(second)).toEqual(['CVE-2026-4000', 'T1003/prevention']);
        expect(first.total).toBe(4);
        expect(second.total).toBe(4);
      });
    });

    describe('the filters', () => {
      it('should list the groups a source reports an applicable finding of, with their figures whole', async () => {
        const defender = await listUnique({ source: 'microsoft_graph' });
        const openaev = await listUnique({ source: 'openaev' });

        expect(names(defender)).toEqual(['CVE-2026-2000', 'CVE-2026-1000', 'CVE-2026-4000']);
        expect(defender.total).toBe(3);
        expect(defender.items.find((row) => row.cveId === 'CVE-2026-1000')).toMatchObject({
          affectedAssetCount: 3, score: Math.trunc(computeUniqueScore([85, 85, 84])!),
        });
        expect(names(openaev)).toEqual(['CVE-2026-1000', 'T1003/prevention']);
      });

      it('should not list a group for a source that reports only its dismissed findings', async () => {
        const drataConnectorId = await createConnector('drata');
        await scoredCveFinding(assetIds[3], cves.single, 70, { state: 'dismissed', connectorId: drataConnectorId });

        expect(names(await listUnique({ source: 'drata' }))).toEqual([]);
      });

      it('should list for the user source the groups holding a finding no connector reports', async () => {
        await scoredCveFinding(assetIds[3], cves.lifted, 60);

        const page = await listUnique({ source: 'user' });

        expect(names(page)).toEqual(['CVE-2026-4000']);
        expect(page.items[0]).toMatchObject({ affectedAssetCount: 3, worstScore: 69 });
      });

      it('should pick the groups by the findings the source reports inside the organization asked', async () => {
        const scopeId = await createScope([assetIds[2]]);
        await storeUnique({ cveRef: cves.wide }, { scores: [84], affectedAssetCount: 1 }, { organizationId: scopeId });
        await storeUnique({ cveRef: cves.lifted }, { scores: [69], affectedAssetCount: 1 }, { organizationId: scopeId });

        expect(names(await listUnique({ source: 'microsoft_graph', mappedToOrganizationId: scopeId }))).toEqual(['CVE-2026-4000']);
        expect(names(await listUnique({ source: 'openaev', mappedToOrganizationId: scopeId }))).toEqual(['CVE-2026-1000']);
      });

      it('should read the rows of the organization asked, never the tenant\'s', async () => {
        const scopeId = await createScope([assetIds[2]]);
        await storeUnique({ cveRef: cves.wide }, { scores: [84], affectedAssetCount: 1 }, { organizationId: scopeId });

        const scoped = await listUnique({ mappedToOrganizationId: scopeId });

        expect(scoped.items.map((row) => [row.cveId, row.score, row.affectedAssetCount])).toEqual([['CVE-2026-1000', 84, 1]]);
        expect(scoped.items[0].sources).toEqual(['openaev']);
        expect(scoped.total).toBe(1);
      });

      it('should list the groups whose CVE id or title, or technique id or name, holds the search, counted alike', async () => {
        await db.update(cve).set({ cveTitle: 'Élévation de privilèges' }).where(eq(cve.id, cves.lifted));
        const searched = async (params: Parameters<typeof listUnique>[0]) => {
          const page = await listUnique(params);
          expect(page.total).toBe(page.items.length);
          return names(page);
        };

        expect(await searched({ search: '2026-2000' })).toEqual(['CVE-2026-2000']);
        expect(await searched({ search: 'elevation' })).toEqual(['CVE-2026-4000']);
        expect(await searched({ search: 't1003' })).toEqual(['T1003/prevention']);
        expect(await searched({ search: 'crédential dumping' })).toEqual(['T1003/prevention']);
        expect(await searched({ search: 'CVE', source: 'openaev' })).toEqual(['CVE-2026-1000']);
        expect(await searched({ search: '100%' })).toEqual([]);
      });

      it('should never show another tenant its unique findings', async () => {
        const otherTenantId = await createTenant(services, adminUserId);
        const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };
        const otherCve = await insertCve('CVE-2026-9000', {}, otherTenantId);
        await storeUnique({ cveRef: otherCve }, { scores: [50], affectedAssetCount: 1 }, { tenantId: otherTenantId });

        const mine = await listUnique();
        const theirs = await listUnique({}, otherOrigin);

        expect(names(mine)).toEqual(['CVE-2026-2000', 'CVE-2026-1000', 'CVE-2026-4000', 'T1003/prevention']);
        expect(theirs.items.map((row) => [row.cveId, row.score, row.affectedAssetCount])).toEqual([['CVE-2026-9000', 50, 1]]);
      });
    });

    describe('the findings panel, recounted per unique finding', () => {
      const panel = (mappedToOrganizationId: string | null = null, origin: EventOrigin = adminOrigin) =>
        services.withOrigin(origin).findingScore.getUniqueFindingsPanelCounts(mappedToOrganizationId);

      const journalLine = (cveRef: string, days: number, score: number | null, scope: { organizationId?: string, tenantId?: string } = {}) => ({
        id: uuidv7(),
        tenantId: scope.tenantId ?? adminTenantId,
        organizationId: scope.organizationId ?? null,
        cveId: cveRef,
        score,
        band: score === null ? null : resolveSeverityBand(Math.trunc(score)),
        worstScore: score,
        affectedAssetCount: score === null ? null : 1,
        changedAt: daysAgo(days),
      });

      /**
       * Seven days ago CVE-2026-1000, -2000 (born ten days ago), -4000 and -7000 were present.
       * CVE-2026-4000 was lost and regained since, CVE-2026-5000 appeared, CVE-2026-6000 came back
       * after a loss that held the window's start, CVE-2026-7000 left.
       */
      beforeEach(async () => {
        const fresh = await insertCve('CVE-2026-5000');
        const returned = await insertCve('CVE-2026-6000');
        const gone = await insertCve('CVE-2026-7000');
        await storeUnique({ cveRef: fresh }, { scores: [50], affectedAssetCount: 1 });
        await storeUnique({ cveRef: returned }, { scores: [30], affectedAssetCount: 1 });
        await db.insert(uniqueFindingScoreHistory).values([
          journalLine(cves.wide, 20, 85.86),
          journalLine(cves.single, 10, 60),
          journalLine(cves.lifted, 20, 70.1),
          journalLine(cves.lifted, 3, null),
          journalLine(cves.lifted, 1, 70.1),
          journalLine(fresh, 2, 50),
          journalLine(returned, 20, 30),
          journalLine(returned, 9, null),
          journalLine(returned, 2, 30),
          journalLine(gone, 20, 95),
          journalLine(gone, 2, null),
        ]);
      });

      it('should count every unique finding as the tab lists it, technique groups included and in no band', async () => {
        const counts = await panel();

        expect(counts.uniqueFindings).toBe((await listUnique()).total);
        expect(counts.techniqueGroups).toBe(1);
        expect(counts.bands).toEqual([
          { band: 'critical', total: 0, newInWindow: 0 },
          { band: 'high', total: 3, newInWindow: 0 },
          { band: 'medium', total: 1, newInWindow: 1 },
          { band: 'low', total: 1, newInWindow: 1 },
        ]);
      });

      it('should count as new a CVE group absent when the window opened, never one lost and regained since', async () => {
        expect((await panel()).newInWindow).toBe(2);
      });

      it('should read the CVE groups and their bands at the window start from the journal', async () => {
        expect((await panel()).baselines).toEqual({
          cveGroupsBefore: 4,
          bandsBefore: [
            { band: 'critical', total: 1 },
            { band: 'high', total: 2 },
            { band: 'medium', total: 1 },
            { band: 'low', total: 0 },
          ],
          newInPreviousWindow: 1,
        });
      });

      it('should draw no baseline while the estate journal starts inside the window', async () => {
        await db.delete(uniqueFindingScoreHistory).where(eq(uniqueFindingScoreHistory.tenantId, adminTenantId));
        await db.insert(uniqueFindingScoreHistory).values([journalLine(cves.wide, 3, 85.86)]);

        const counts = await panel();

        expect(counts.baselines).toBeNull();
        expect(counts.uniqueFindings).toBe(6);
      });

      it('should count a closed organization over its own rows and keep its trends from its own journal', async () => {
        const scopeId = await createScope([assetIds[2]]);
        await storeUnique({ cveRef: cves.wide }, { scores: [84], affectedAssetCount: 1 }, { organizationId: scopeId });
        await db.insert(uniqueFindingScoreHistory).values([journalLine(cves.wide, 30, 75, { organizationId: scopeId })]);

        const counts = await panel(scopeId);

        expect(counts).toMatchObject({ uniqueFindings: 1, techniqueGroups: 0, newInWindow: 0 });
        expect(counts.bands.find((row) => row.band === 'high')?.total).toBe(1);
        expect(counts.baselines).toMatchObject({ cveGroupsBefore: 1, newInPreviousWindow: 0 });
      });

      it('should never count another tenant\'s unique findings or journal', async () => {
        const otherTenantId = await createTenant(services, adminUserId);
        const otherCveRef = await insertCve('CVE-2026-1000', {}, otherTenantId);
        await storeUnique({ cveRef: otherCveRef }, { scores: [95], affectedAssetCount: 1 }, { tenantId: otherTenantId });
        await db.insert(uniqueFindingScoreHistory).values([journalLine(otherCveRef, 30, 95, { tenantId: otherTenantId })]);

        expect((await panel()).uniqueFindings).toBe(6);
        expect(await panel(null, { type: 'client', userId: adminUserId, tenantId: otherTenantId })).toMatchObject({
          uniqueFindings: 1,
          baselines: { cveGroupsBefore: 1 },
        });
      });
    });
  });

  describe('the projection the recompute stores', () => {
    const recompute = () => services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();

    const storedRows = (organizationId: string | null = null) => db
      .select()
      .from(uniqueFindingScores)
      .where(and(
        eq(uniqueFindingScores.tenantId, adminTenantId),
        organizationId === null ? isNull(uniqueFindingScores.organizationId) : eq(uniqueFindingScores.organizationId, organizationId),
      ))
      .orderBy(asc(uniqueFindingScores.id));

    const applicableScores = async (cveRef: string, onAssets: Array<string> = assetIds): Promise<Array<number>> => (await db
      .select({ score: findingScores.score })
      .from(findingScores)
      .innerJoin(assetEvidence, eq(assetEvidence.id, findingScores.assetEvidenceId))
      .where(and(
        eq(assetEvidence.cveId, cveRef),
        eq(assetEvidence.currentState, 'applicable'),
        inArray(assetEvidence.supportingAssetId, onAssets),
      ))).flatMap((row) => (row.score === null ? [] : [row.score]));

    const journalOf = (cveRef: string) => db
      .select()
      .from(uniqueFindingScoreHistory)
      .where(eq(uniqueFindingScoreHistory.cveId, cveRef))
      .orderBy(asc(uniqueFindingScoreHistory.changedAt), asc(uniqueFindingScoreHistory.id));

    it('should store each CVE the soft maximum of its applicable findings, their worst score and their assets', async () => {
      await recompute();

      const rows = await storedRows();
      const wide = rows.find((row) => row.cveId === cves.wide)!;
      const scores = await applicableScores(cves.wide);
      expect(scores).toHaveLength(3);
      expect(wide.score).toBeCloseTo(computeUniqueScore(scores)!, 10);
      expect(wide).toMatchObject({
        worstScore: Math.max(...scores),
        band: resolveSeverityBand(Math.trunc(wide.score!)),
        affectedAssetCount: 3,
      });
      expect(rows.find((row) => row.cveId === cves.dismissedOnly)).toBeUndefined();
      expect(rows).toHaveLength(4);
    });

    it('should store a technique group with its assets and no score', async () => {
      await recompute();

      expect((await storedRows()).find((row) => row.mitreTechniqueId === TECHNIQUE_T1003)).toMatchObject({
        expectationType: 'prevention', score: null, band: null, worstScore: null, affectedAssetCount: 2,
      });
    });

    it('should store each organization its own unique findings, over the assets mapped to it', async () => {
      const scopeId = await createScope([assetIds[2]]);

      await recompute();

      const rows = await storedRows(scopeId);
      expect(rows.map((row) => row.cveId).toSorted()).toEqual([cves.wide, cves.lifted].toSorted());
      for (const row of rows) {
        const [onlyScore] = await applicableScores(row.cveId!, [assetIds[2]]);
        expect(row).toMatchObject({ score: onlyScore, worstScore: onlyScore, affectedAssetCount: 1 });
      }
      expect((await listUnique({ mappedToOrganizationId: scopeId })).total).toBe(2);
    });

    it('should journal each CVE group once per estate on the first run, and nothing for a technique group or an unchanged run', async () => {
      await createScope([assetIds[2]]);
      await recompute();
      await recompute();

      const lines = await db.select().from(uniqueFindingScoreHistory).where(eq(uniqueFindingScoreHistory.tenantId, adminTenantId));
      expect(lines.filter((line) => line.organizationId === null).map((line) => line.cveId).toSorted())
        .toEqual([cves.wide, cves.single, cves.lifted].toSorted());
      expect(lines.filter((line) => line.organizationId !== null)).toHaveLength(2);
      const stored = (await storedRows()).find((row) => row.cveId === cves.wide)!;
      expect((await journalOf(cves.wide)).find((line) => line.organizationId === null)).toMatchObject({
        score: stored.score, band: stored.band, worstScore: stored.worstScore, affectedAssetCount: 3,
      });
    });

    it('should journal a group whose displayed score moved', async () => {
      await recompute();
      const [computed] = (await storedRows()).filter((row) => row.cveId === cves.single);
      await db.update(uniqueFindingScores).set({ score: computed.score! - 9 }).where(eq(uniqueFindingScores.id, computed.id));

      await recompute();

      const lines = await journalOf(cves.single);
      expect(lines.map((line) => line.score)).toEqual([computed.score, computed.score]);
      expect(lines).toHaveLength(2);
    });

    it('should journal a group whose affected asset count moved while its displayed score held', async () => {
      await recompute();
      const [computed] = (await storedRows()).filter((row) => row.cveId === cves.wide);
      await db.update(uniqueFindingScores).set({ affectedAssetCount: 1 }).where(eq(uniqueFindingScores.id, computed.id));

      await recompute();

      const lines = (await journalOf(cves.wide)).filter((line) => line.organizationId === null);
      expect(lines.map((line) => [line.score, line.affectedAssetCount])).toEqual([[computed.score, 3], [computed.score, 3]]);
    });

    it('should drop the rows of an organization left with no mapped asset and journal them with a null score', async () => {
      const scopeId = await createScope([assetIds[2]]);
      await recompute();
      await services.withOrigin(adminOrigin).organizations.updateOrganization(scopeId, { mapping: { added: [], removed: [assetIds[2]] } });

      await recompute();

      expect(await storedRows(scopeId)).toEqual([]);
      const scopeLines = (await journalOf(cves.wide)).filter((line) => line.organizationId === scopeId);
      expect(scopeLines.map((line) => line.score === null)).toEqual([false, true]);
    });

    it('should drop the rows of an organization that opened, whose list reads the tenant\'s, though it keeps its mapping', async () => {
      const scopeId = await createScope([assetIds[2]]);
      await recompute();
      await services.withOrigin(adminOrigin).organizations.updateOrganization(scopeId, { estateMode: 'open' });

      await recompute();

      expect(await storedRows(scopeId)).toEqual([]);
    });

    it('should drop a technique group that left the estate without journaling it', async () => {
      await recompute();
      const linesBefore = await db.select().from(uniqueFindingScoreHistory).where(eq(uniqueFindingScoreHistory.tenantId, adminTenantId));
      await db.delete(assetEvidence).where(eq(assetEvidence.mitreTechniqueId, TECHNIQUE_T1003));

      await recompute();

      expect((await storedRows()).find((row) => row.mitreTechniqueId === TECHNIQUE_T1003)).toBeUndefined();
      expect(await db.select().from(uniqueFindingScoreHistory).where(eq(uniqueFindingScoreHistory.tenantId, adminTenantId)))
        .toHaveLength(linesBefore.length);
    });

    it('should trim the lines past a year but the one in force when the year opens', async () => {
      const line = (days: number) => ({
        id: uuidv7(), tenantId: adminTenantId, organizationId: null, cveId: cves.single, score: 50, band: 'medium' as const, changedAt: daysAgo(days),
      });
      await db.insert(uniqueFindingScoreHistory).values([line(400), line(380), line(10)]);

      await recompute();

      const kept = (await journalOf(cves.single)).map((entry) => Math.round((Date.now() - entry.changedAt.getTime()) / DAY_MS));
      expect(kept).not.toContain(400);
      expect(kept.slice(0, 2)).toEqual([380, 10]);
    });

    it('should leave another tenant\'s unique findings and journal untouched', async () => {
      await recompute();
      const before = { rows: await storedRows(), lines: await journalOf(cves.wide) };
      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };
      const otherAsset = await createAsset(otherOrigin, 'other-asset');
      await scoredCveFinding(otherAsset, await insertCve('CVE-2026-1000', {}, otherTenantId), 99, { tenantId: otherTenantId });

      await services.withOrigin(otherOrigin).findingScore.recomputeFindingScores();

      expect(await storedRows()).toEqual(before.rows);
      expect(await journalOf(cves.wide)).toEqual(before.lines);
      expect(await db.select().from(uniqueFindingScores).where(eq(uniqueFindingScores.tenantId, otherTenantId))).toHaveLength(1);
    });

    it('should drop a group that left the estate and journal it with a null score', async () => {
      await recompute();
      await db.delete(assetEvidence).where(eq(assetEvidence.cveId, cves.single));

      await recompute();
      await recompute();

      expect((await storedRows()).find((row) => row.cveId === cves.single)).toBeUndefined();
      expect((await journalOf(cves.single)).map((line) => line.score === null)).toEqual([false, true]);
    });
  });

  describe('the findings list narrowed on one unique finding', () => {
    const listFindings = (vulnerability: VulnerabilityFilter, state: 'applicable' | 'dismissed' | null = 'applicable') =>
      services.withOrigin(adminOrigin).findingScore.listScoredFindings({
        page: 1, limit: 50, state, source: null, vulnerability, mappedToOrganizationId: null, sortBy: 'score', sortDesc: true,
      });

    it('should list the findings of one CVE, in the state asked', async () => {
      const applicable = await listFindings({ kind: 'cve', cveId: 'CVE-2026-1000' });
      const everyState = await listFindings({ kind: 'cve', cveId: 'CVE-2026-1000' }, null);

      expect(applicable.items.map((row) => row.score)).toEqual([85, 85, 84]);
      expect(applicable.total).toBe(3);
      expect(everyState.total).toBe(4);
    });

    it('should list the findings of one technique in one expectation', async () => {
      const prevention = await listFindings({ kind: 'technique', externalId: 'T1003', expectationType: 'prevention' });
      const detection = await listFindings({ kind: 'technique', externalId: 'T1003', expectationType: 'detection' });

      expect(prevention.total).toBe(2);
      expect(prevention.items.every((row) => row.mitreTechniqueExternalId === 'T1003')).toBe(true);
      expect(detection.total).toBe(0);
    });

    it('should list nothing for a CVE the tenant has no finding of', async () => {
      const page = await listFindings({ kind: 'cve', cveId: 'CVE-2099-0001' });

      expect(page.items).toEqual([]);
      expect(page.total).toBe(0);
    });

    it('should count as still being scored only the findings of the vulnerability asked', async () => {
      await db.insert(assetEvidence).values([{
        id: uuidv7(), supportingAssetId: assetIds[0], tenantId: adminTenantId, cveId: await insertCve('CVE-2026-7000'), userId: adminUserId,
      }]);

      expect((await listFindings({ kind: 'cve', cveId: 'CVE-2026-1000' })).unscored).toBe(0);
      expect((await listFindings({ kind: 'cve', cveId: 'CVE-2026-7000' }))).toMatchObject({ unscored: 1, total: 0 });
      expect((await services.withOrigin(adminOrigin).findingScore.listScoredFindings({
        page: 1, limit: 50, state: 'applicable', source: null, mappedToOrganizationId: null, sortBy: 'score', sortDesc: true,
      })).unscored).toBe(1);
    });
  });

  describe('the unique finding page of a technique', () => {
    const getTechnique = (
      params: { externalId?: string, expectationType?: 'detection' | 'prevention', mappedToOrganizationId?: string | null } = {},
      origin: EventOrigin = adminOrigin,
    ) => services.withOrigin(origin).findingScore.getUniqueTechniqueFinding({
      externalId: params.externalId ?? 'T1003',
      expectationType: params.expectationType ?? 'prevention',
      mappedToOrganizationId: params.mappedToOrganizationId ?? null,
    });

    const reportPlatform = async (supportingAssetId: string, platform: string, tenantId = adminTenantId): Promise<void> => {
      const sourceId = uuidv7();
      await db.insert(supportingAssetSources).values([{
        id: sourceId, supportingAssetId, tenantId, sourceAssetId: `source-${sourceId}`, reportedCategoryId: 'host',
      }]);
      await db.insert(supportingAssetMachineProperties).values([{ id: sourceId, supportingAssetSourceId: sourceId, tenantId, platform }]);
    };

    const dismissedTechniqueFinding = async (supportingAssetId: string): Promise<string> => {
      const id = await techniqueFinding(supportingAssetId, openaevConnectorId);
      const dismissedAt = new Date();
      await db.insert(assetEvidenceHistory).values([{
        id: uuidv7(), tenantId: adminTenantId, assetEvidenceId: id, stateChangedAt: dismissedAt, observedAt: dismissedAt, state: 'dismissed', origin: 'not_exposed',
      }]);
      return id;
    };

    beforeEach(async () => {
      await reportPlatform(assetIds[0], 'windows');
      await reportPlatform(assetIds[1], 'linux');
      await reportPlatform(assetIds[1], 'windows');
    });

    it('should describe the technique, its expectation and the platforms and sources of its applicable findings', async () => {
      const technique = await getTechnique();

      expect(technique).toMatchObject({
        externalId: 'T1003', expectationType: 'prevention', affectedAssetCount: 2, platforms: ['linux', 'windows'], sources: ['openaev'],
      });
      expect(technique?.name).toBeTruthy();
      expect(technique?.tactics.map((tactic) => tactic.externalId)).toContain('TA0006');
      expect(technique?.firstSeenAt).toBeInstanceOf(Date);
      expect(technique?.lastSeenAt).toBeInstanceOf(Date);
    });

    it('should count the assets the tab\'s row counts once the run has stored it', async () => {
      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();

      const row = (await listUnique()).items.find((group) => group.mitreTechniqueExternalId === 'T1003');
      expect((await getTechnique())?.affectedAssetCount).toBe(row?.affectedAssetCount);
    });

    it('should count an asset once however many findings of the group it holds, which the findings list lists apart', async () => {
      const id = uuidv7();
      await db.insert(assetEvidence).values([{
        id, supportingAssetId: assetIds[0], tenantId: adminTenantId, mitreTechniqueId: TECHNIQUE_T1003, expectationType: 'prevention', securityPlatformType: 'EDR', evaluatedAt: new Date(),
      }]);
      await reportedBy(id, openaevConnectorId);

      const findings = await services.withOrigin(adminOrigin).findingScore.listScoredFindings({
        page: 1, limit: 50, state: 'applicable', source: null, mappedToOrganizationId: null, sortBy: 'assetName', sortDesc: false,
        vulnerability: { kind: 'technique', externalId: 'T1003', expectationType: 'prevention' },
      });

      expect(await getTechnique()).toMatchObject({ affectedAssetCount: 2 });
      expect(findings.total).toBe(3);
    });

    it('should leave a dismissed finding out of the figures, which the findings list still offers in its state', async () => {
      await dismissedTechniqueFinding(assetIds[2]);
      await reportPlatform(assetIds[2], 'macos');

      const dismissed = await services.withOrigin(adminOrigin).findingScore.listScoredFindings({
        page: 1, limit: 50, state: 'dismissed', source: null, mappedToOrganizationId: null, sortBy: 'assetName', sortDesc: false,
        vulnerability: { kind: 'technique', externalId: 'T1003', expectationType: 'prevention' },
      });

      expect(await getTechnique()).toMatchObject({ affectedAssetCount: 2, platforms: ['linux', 'windows'] });
      expect(dismissed.items.map((finding) => [finding.supportingAssetId, finding.assetPlatforms, finding.assetCriticality]))
        .toEqual([[assetIds[2], ['macos'], 'unknown']]);
    });

    it('should read only the assets mapped to the organization asked', async () => {
      const scopeId = await createScope([assetIds[0]]);

      expect(await getTechnique({ mappedToOrganizationId: scopeId })).toMatchObject({ affectedAssetCount: 1, platforms: ['windows'] });
    });

    it('should come back empty for a technique the estate has no finding of in that expectation, and missing for an unknown one', async () => {
      expect(await getTechnique({ expectationType: 'detection' })).toMatchObject({
        affectedAssetCount: 0, platforms: [], sources: [], firstSeenAt: null, lastSeenAt: null,
      });
      expect(await getTechnique({ externalId: 'T9999' })).toBeUndefined();
    });

    it('should never count another tenant\'s findings', async () => {
      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };
      const otherAsset = await createAsset(otherOrigin, 'other-asset');
      await reportPlatform(otherAsset, 'android', otherTenantId);
      await db.insert(assetEvidence).values([{
        id: uuidv7(), supportingAssetId: otherAsset, tenantId: otherTenantId, mitreTechniqueId: TECHNIQUE_T1003, expectationType: 'prevention', evaluatedAt: new Date(),
      }]);

      expect(await getTechnique()).toMatchObject({ affectedAssetCount: 2, platforms: ['linux', 'windows'] });
      expect(await getTechnique({}, otherOrigin)).toMatchObject({ affectedAssetCount: 1, platforms: ['android'], sources: [] });
    });
  });

  describe('the unique finding page of a CVE', () => {
    const recompute = () => services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();
    const page = (cveId: string, mappedToOrganizationId: string | null = null, origin: EventOrigin = adminOrigin) =>
      services.withOrigin(origin).findingScore.getUniqueCveFinding({ cveId, mappedToOrganizationId });
    /** The row a recompute would leave over the seeded scores, which a real run would rescore. */
    const storeWide = async (scores: Array<number>, affectedAssetCount: number, organizationId: string | null = null) => {
      const score = computeUniqueScore(scores)!;
      await db.insert(uniqueFindingScores).values([{
        id: uuidv7(), tenantId: adminTenantId, organizationId, cveId: cves.wide, score, band: resolveSeverityBand(Math.trunc(score)),
        worstScore: Math.max(...scores), affectedAssetCount, firstSeenAt: daysAgo(40),
      }]);
      return score;
    };

    it('should figure the CVE as the Unique findings tab figures its row', async () => {
      await recompute();

      const row = (await listUnique()).items.find((item) => item.cveId === 'CVE-2026-1000')!;
      const finding = await page('CVE-2026-1000');

      expect(finding).toMatchObject({
        cveId: row.cveId,
        cveTitle: row.cveTitle,
        knownExploited: row.knownExploited,
        epss: row.epss,
        score: row.score,
        band: row.band,
        worstScore: row.worstScore,
        worstBand: row.worstBand,
        affectedAssetCount: row.affectedAssetCount,
      });
      expect(finding?.sources).toEqual(row.sources.toSorted());
    });

    it('should break the score into its levels, summing back to the stored score to the last bit', async () => {
      const stored = await storeWide([85, 85, 84], 3);

      const composition = (await page('CVE-2026-1000'))?.composition;

      expect(composition?.levels.map((level) => [level.score, level.assetCount])).toEqual([[85, 2], [84, 1]]);
      expect(composition?.levels[1]?.equivalent).toBeCloseTo(Math.exp(-1), 10);
      expect(composition?.unrounded).toBe(stored);
      expect(composition!.worst + Math.log(composition!.equivalentSum)).toBe(stored);
    });

    it('should open a CVE whose findings are all dismissed, with no score and no applicable asset', async () => {
      await recompute();

      expect(await page('CVE-2026-3000')).toMatchObject({
        score: null, band: null, worstScore: null, affectedAssetCount: 0, sources: [], composition: null, knownExploited: true,
      });
    });

    it('should answer nothing for a CVE the tenant does not have', async () => {
      expect(await page('CVE-2099-0001')).toBeUndefined();
    });

    it('should figure an organization over the assets mapped to it', async () => {
      const scopeId = await createScope([assetIds[2]]);
      await storeWide([84], 1, scopeId);

      expect(await page('CVE-2026-1000', scopeId)).toMatchObject({
        score: 84, worstScore: 84, affectedAssetCount: 1, sources: ['openaev'],
        composition: { levels: [{ score: 84, assetCount: 1, equivalent: 1 }] },
      });
    });

    it('should not read another tenant\'s findings of the same CVE', async () => {
      await storeWide([85, 85, 84], 3);
      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };
      const otherAsset = await createAsset(otherOrigin, 'other-asset');
      await scoredCveFinding(otherAsset, await insertCve('CVE-2026-1000', {}, otherTenantId), 99, { tenantId: otherTenantId });

      const finding = await page('CVE-2026-1000');

      expect(finding).toMatchObject({ worstScore: 85, affectedAssetCount: 3 });
      expect(finding?.composition?.levels.map((level) => level.score)).toEqual([85, 84]);
    });

    it('should carry each finding\'s asset criticality and exposure on the narrowed list', async () => {
      const findings = await services.withOrigin(adminOrigin).findingScore.listScoredFindings({
        page: 1, limit: 50, state: 'applicable', source: null, vulnerability: { kind: 'cve', cveId: 'CVE-2026-1000' }, mappedToOrganizationId: null, sortBy: 'score', sortDesc: true,
      });

      expect(findings.items.map((row) => [row.assetCriticality, row.assetExposure])).toEqual([['unknown', 'unknown'], ['unknown', 'unknown'], ['unknown', 'unknown']]);
    });

    it('should count the impacted assets of the CVE over the assets an organization maps', async () => {
      const scopeId = await createScope([assetIds[2]]);
      const raised = await db.select({ id: assetEvidence.id }).from(assetEvidence).where(eq(assetEvidence.cveId, cves.wide));
      const raisedAt = daysAgo(2);
      await db.insert(assetEvidenceHistory).values(raised.map((row) => ({
        id: uuidv7(), tenantId: adminTenantId, assetEvidenceId: row.id, stateChangedAt: raisedAt, observedAt: raisedAt, state: 'applicable' as const, origin: 'exposed' as const,
      })));
      const today = async (mappedToOrganizationId: string | null) =>
        (await services.withOrigin(adminOrigin).supportingAssets.getEvidenceActivity({ cveId: 'CVE-2026-1000' }, 'UTC', mappedToOrganizationId)).at(-1)?.count;

      expect(await today(scopeId)).toBe(1);
      expect(await today(null)).toBeGreaterThan(1);
    });

    describe('its events', () => {
      const journalLine = (days: number, score: number | null, worstScore: number | null, affectedAssetCount: number | null, scope: { organizationId?: string, tenantId?: string, cveRef?: string } = {}) => ({
        id: uuidv7(),
        tenantId: scope.tenantId ?? adminTenantId,
        organizationId: scope.organizationId ?? null,
        cveId: scope.cveRef ?? cves.wide,
        score,
        band: score === null ? null : resolveSeverityBand(Math.trunc(score)),
        worstScore,
        affectedAssetCount,
        changedAt: daysAgo(days),
      });
      const events = (params: { mappedToOrganizationId?: string | null, page?: number, limit?: number } = {}, origin: EventOrigin = adminOrigin) =>
        services.withOrigin(origin).findingScore.listUniqueFindingEvents({
          cveId: 'CVE-2026-1000', mappedToOrganizationId: params.mappedToOrganizationId ?? null, page: params.page ?? 1, limit: params.limit ?? 50,
        });

      beforeEach(async () => {
        await db.insert(uniqueFindingScoreHistory).values([
          journalLine(200, 66.2, 65.4, 18),
          journalLine(150, null, null, null),
          journalLine(100, 72.5, 71.1, 40),
          journalLine(50, 69.9, 68.2, 112),
          journalLine(5, 79.4, 78.3, 112),
          journalLine(1, 80.15, 78.3, 120),
        ]);
      });

      it('should list the journal newest first, each line read against the one before it', async () => {
        const journal = await events();

        expect(journal.items.map((event) => event.kind)).toEqual(['rise', 'rise', 'fall', 'regained', 'lost', 'first']);
        expect(journal.items[0]).toMatchObject({ score: 80, worstScore: 78, affectedAssetCount: 120, previous: { score: 79, affectedAssetCount: 112 } });
        expect(journal.total).toBe(6);
      });

      it('should read the oldest event of a page against the line on the next page', async () => {
        const first = await events({ limit: 2 });

        expect(first.items.at(-1)).toMatchObject({ kind: 'rise', score: 79, previous: { score: 69, band: 'medium' } });
        expect(first.total).toBe(6);
      });

      it('should read the line the trim kept before the year as the previous of the oldest event, not as an event', async () => {
        await db.insert(uniqueFindingScoreHistory).values([journalLine(400, 60.4, 60.4, 2)]);

        const journal = await events();

        expect(journal.items.at(-1)).toMatchObject({ kind: 'rise', score: 66, previous: { score: 60 } });
        expect(journal.total).toBe(6);
      });

      it('should read an organization\'s own journal, never the tenant\'s', async () => {
        const scopeId = await createScope([assetIds[2]]);
        await db.insert(uniqueFindingScoreHistory).values([journalLine(3, 84, 84, 1, { organizationId: scopeId })]);

        const journal = await events({ mappedToOrganizationId: scopeId });

        expect(journal.items).toMatchObject([{ kind: 'first', score: 84 }]);
        expect((await events()).total).toBe(6);
      });

      it('should never list another tenant\'s journal of the same CVE', async () => {
        const otherTenantId = await createTenant(services, adminUserId);
        const otherCveRef = await insertCve('CVE-2026-1000', {}, otherTenantId);
        await db.insert(uniqueFindingScoreHistory).values([journalLine(2, 99, 99, 1, { tenantId: otherTenantId, cveRef: otherCveRef })]);

        expect((await events()).items.map((event) => event.score)).not.toContain(99);
        expect((await events({}, { type: 'client', userId: adminUserId, tenantId: otherTenantId })).items).toMatchObject([{ kind: 'first', score: 99 }]);
      });

      describe('its score history', () => {
        const history = (mappedToOrganizationId: string | null = null, origin: EventOrigin = adminOrigin) =>
          services.withOrigin(origin).findingScore.getUniqueFindingScoreHistory({ cveId: 'CVE-2026-1000', mappedToOrganizationId });

        it('should read the year oldest first, each line as its event reads it', async () => {
          const lines = await history();

          expect(lines.map((line) => line.kind)).toEqual(['first', 'lost', 'regained', 'fall', 'rise', 'rise']);
          expect(lines.at(-1)).toMatchObject({ score: 80, worstScore: 78, affectedAssetCount: 120, previous: { score: 79, affectedAssetCount: 112 } });
          expect(lines[1]).toMatchObject({ score: null, band: null, previous: { score: 66 } });
        });

        it('should lead with the line in force when the year opens, and nothing older', async () => {
          await db.insert(uniqueFindingScoreHistory).values([journalLine(420, 55.2, 55.2, 1), journalLine(400, 60.4, 60.4, 2)]);

          const lines = await history();

          expect(lines.map((line) => line.score)).toEqual([60, 66, null, 72, 69, 79, 80]);
          expect(lines[1]).toMatchObject({ kind: 'rise', previous: { score: 60 } });
        });

        it('should lead with the later of two lines journaled at the same instant before the year opens', async () => {
          const at = daysAgo(400);
          await db.insert(uniqueFindingScoreHistory).values([
            { ...journalLine(400, 55.2, 55.2, 1), changedAt: at },
            { ...journalLine(400, 60.4, 60.4, 2), changedAt: at },
          ]);

          expect((await history()).map((line) => line.score)).toEqual([60, 66, null, 72, 69, 79, 80]);
        });

        it('should read an organization\'s own journal, never the tenant\'s', async () => {
          const scopeId = await createScope([assetIds[2]]);
          await db.insert(uniqueFindingScoreHistory).values([journalLine(3, 84, 84, 1, { organizationId: scopeId })]);

          expect(await history(scopeId)).toMatchObject([{ kind: 'first', score: 84 }]);
        });

        it('should never read another tenant\'s journal of the same CVE', async () => {
          const otherTenantId = await createTenant(services, adminUserId);
          const otherCveRef = await insertCve('CVE-2026-1000', {}, otherTenantId);
          await db.insert(uniqueFindingScoreHistory).values([journalLine(2, 99, 99, 1, { tenantId: otherTenantId, cveRef: otherCveRef })]);

          expect((await history()).map((line) => line.score)).not.toContain(99);
          expect(await history(null, { type: 'client', userId: adminUserId, tenantId: otherTenantId })).toMatchObject([{ kind: 'first', score: 99 }]);
        });
      });
    });
  });

  describe('the sources offered', () => {
    it('should leave out, when asked for applicable findings only, a source reporting nothing but dismissed findings', async () => {
      const drataConnectorId = await createConnector('drata');
      await scoredCveFinding(assetIds[2], await insertCve('CVE-2026-8000'), 50, { state: 'dismissed', connectorId: drataConnectorId });
      const sourcesOf = async (applicableOnly: boolean) =>
        (await services.withOrigin(adminOrigin).findingScore.getFindingCountsBySource(null, applicableOnly))
          .map((row) => [row.source, row.findingCount])
          .toSorted(([left], [right]) => String(left).localeCompare(String(right)));

      expect(await sourcesOf(false)).toEqual([['drata', 1], ['microsoft_graph', 8], ['openaev', 3]]);
      expect(await sourcesOf(true)).toEqual([['microsoft_graph', 6], ['openaev', 3]]);
    });
  });
});

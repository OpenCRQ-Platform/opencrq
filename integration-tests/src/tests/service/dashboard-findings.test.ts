import type { AssetCriticality, EventOrigin, SeverityBand } from '@app/module';
import {
  assetEvidence, assetEvidenceHistory, cve, DAYS_PER_MONTH, findingScores, mitreTechniquesData, SEVERITY_BAND_MINIMUMS,
  supportingAssets,
} from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { recomputePrimaryAssetReach } from '../../helpers/primary-asset-reach';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const DAY_MS = 24 * 60 * 60 * 1000;

const daysAgo = (days: number): Date => new Date(Date.now() - days * DAY_MS);

const TECHNIQUE_BY_EXTERNAL_ID = new Map(mitreTechniquesData.map((technique) => [technique.externalId, technique]));

describe('Dashboard Findings Service', () => {
  let adminOrigin: EventOrigin;
  let adminTenantId: string;
  let adminUserId: string;
  let orgAId: string;
  let orgBId: string;

  const insertCve = async (
    cveTextId: string,
    metadata: { cvss?: number, epss?: number, kev?: boolean, kevUpdatedAt?: Date | null } = {},
  ): Promise<string> => {
    const id = uuidv7();
    await db.insert(cve).values([{
      id,
      tenantId: adminTenantId,
      cveId: cveTextId,
      cvss: metadata.cvss ?? null,
      epss: metadata.epss ?? null,
      kev: metadata.kev ?? null,
      kevUpdatedAt: metadata.kevUpdatedAt === undefined ? (metadata.kev ? new Date() : null) : metadata.kevUpdatedAt,
    }]);
    return id;
  };

  const createPrimaryAsset = async (organizationId: string, name: string): Promise<string> => {
    const id = uuidv7();
    await services.withOrigin(adminOrigin).primaryAssets.createPrimaryAsset({
      id, organizationId, name, description: null, ownerId: null, businessValueCategoryIds: [],
    });
    return id;
  };

  const createSupportingAsset = async (
    name: string,
    options: { criticality?: AssetCriticality, exposure?: 'internet_facing' | 'internal' | 'unknown', categoryId?: 'host' | 'container_workload' } = {},
  ): Promise<string> => {
    const id = uuidv7();
    await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
      id,
      name,
      description: null,
      ownerId: null,
      exposure: options.exposure ?? 'unknown',
      categoryId: options.categoryId ?? 'host',
      criticality: options.criticality ?? 'unknown',
    });
    return id;
  };

  /** The service always names an asset, and a connector import does not, which is what ranks last. */
  const createNamelessAsset = async (derivedName: string | null = null): Promise<string> => {
    const id = uuidv7();
    await db.insert(supportingAssets).values([{
      id, tenantId: adminTenantId, name: null, derivedName, exposure: 'unknown', categoryId: 'host', criticality: 'low',
    }]);
    return id;
  };

  const linkToPrimary = async (supportingAssetId: string, primaryAssetId: string): Promise<void> => {
    await services.withOrigin(adminOrigin).assetDependencies.createSupportToPrimaryLinks([{
      id: uuidv7(), supportingAssetId, primaryAssetId,
    }]);
  };

  const linkProvider = async (providerAssetId: string, dependentAssetId: string): Promise<void> => {
    await services.withOrigin(adminOrigin).assetDependencies.createSupportToSupportLinks([{
      id: uuidv7(), providerAssetId, dependentAssetId,
    }]);
  };

  const recomputeReach = () => recomputePrimaryAssetReach(services, adminTenantId);

  const attachEvidence = async (
    supportingAssetId: string,
    cveUuid: string,
    options: {
      createdAt?: Date,
      userId?: string | null,
      sourceScenarioId?: string | null,
    } = {},
  ): Promise<string> => {
    const id = uuidv7();
    await db.insert(assetEvidence).values([{
      id,
      supportingAssetId,
      tenantId: adminTenantId,
      cveId: cveUuid,
      userId: options.userId === undefined ? adminUserId : options.userId,
      sourceScenarioId: options.sourceScenarioId ?? null,
      createdAt: options.createdAt ?? daysAgo(30),
    }]);
    return id;
  };

  let scenario = 0;

  /** One OpenAEV result, each in its own scenario so several can share an asset and a technique. */
  const attachTechniqueFinding = async (supportingAssetId: string, externalId: string): Promise<string> => {
    const id = uuidv7();
    scenario += 1;
    await db.insert(assetEvidence).values([{
      id,
      supportingAssetId,
      tenantId: adminTenantId,
      mitreTechniqueId: TECHNIQUE_BY_EXTERNAL_ID.get(externalId)!.id,
      expectationType: 'detection',
      sourceScenarioId: `scenario-${scenario}`,
    }]);
    return id;
  };

  const countedTechnique = (externalId: string, applicableFindings: number) => {
    const technique = TECHNIQUE_BY_EXTERNAL_ID.get(externalId)!;
    return { mitreTechniqueId: technique.id, externalId, name: technique.name, applicableFindings };
  };

  const insertHistory = async (
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

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminTenantId = setup.tenantId;
    adminUserId = setup.userId;

    orgAId = uuidv7();
    orgBId = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([
      { id: orgAId, name: 'Org A' },
      { id: orgBId, name: 'Org B' },
    ]);
  });

  describe('getFindingsOverview', () => {
    it('should count active findings, bucket severities and rank top findings and CVEs', async () => {
      const asset1 = await createSupportingAsset('Asset 1');
      const asset2 = await createSupportingAsset('Asset 2');

      const critical = await insertCve('CVE-CRIT', { cvss: 9.8, epss: 0.5 });
      const kevMedium = await insertCve('CVE-KEV', { cvss: 5.0, epss: 0.9, kev: true });
      const unscored = await insertCve('CVE-UNSCORED');
      const dismissedCve = await insertCve('CVE-DISMISSED', { cvss: 8.0 });

      await attachEvidence(asset1, critical);
      await attachEvidence(asset1, kevMedium);
      await attachEvidence(asset2, kevMedium);
      await attachEvidence(asset2, unscored);
      const dismissedEvidence = await attachEvidence(asset2, dismissedCve);
      await insertHistory(dismissedEvidence, 'dismissed', daysAgo(5));

      const overview = await services.withOrigin(adminOrigin).dashboard.getFindingsOverview();

      expect(overview.summary).toEqual({
        activeCount: 4,
        criticalCount: 1,
        highCount: 0,
        kevCount: 2,
        impactedAssetCount: 2,
        severityDistribution: { critical: 1, high: 0, medium: 2, low: 0, none: 0, unscored: 1 },
      });
      expect(overview.topFindings.map((finding) => finding.cveId)).toEqual([
        'CVE-KEV', 'CVE-KEV', 'CVE-CRIT', 'CVE-UNSCORED',
      ]);
      expect(overview.topCves).toEqual([
        { cveId: 'CVE-KEV', cvss: 5.0, epss: 0.9, kev: true, impactedAssetCount: 2 },
        { cveId: 'CVE-CRIT', cvss: 9.8, epss: 0.5, kev: false, impactedAssetCount: 1 },
        { cveId: 'CVE-UNSCORED', cvss: null, epss: null, kev: false, impactedAssetCount: 1 },
      ]);
    });

    it('should carry the derived name of an asset with no name on a top finding', async () => {
      const addressAsset = await createNamelessAsset('10.0.0.1');
      await attachEvidence(addressAsset, await insertCve('CVE-ADDR', { cvss: 7.0 }));

      const overview = await services.withOrigin(adminOrigin).dashboard.getFindingsOverview();

      expect(overview.topFindings.map((finding) => [finding.assetName, finding.assetDerivedName])).toEqual([[null, '10.0.0.1']]);
    });

    it('should count as KEV only what CISA dated, not a connector\'s exploit-available flag', async () => {
      const asset = await createSupportingAsset('Asset');
      const flagged = await insertCve('CVE-FLAG-ONLY', { cvss: 5.0, kev: true, kevUpdatedAt: null });
      const listed = await insertCve('CVE-LISTED', { cvss: 5.0, kevUpdatedAt: new Date('2026-01-01T00:00:00Z') });
      await attachEvidence(asset, flagged);
      await attachEvidence(asset, listed);

      const overview = await services.withOrigin(adminOrigin).dashboard.getFindingsOverview();

      expect(overview.summary.kevCount).toBe(1);
      expect(overview.topFindings.map((finding) => [finding.cveId, finding.kev])).toEqual([
        ['CVE-LISTED', true], ['CVE-FLAG-ONLY', false],
      ]);
      expect(overview.topCves.map((entry) => [entry.cveId, entry.kev])).toEqual([
        ['CVE-LISTED', true], ['CVE-FLAG-ONLY', false],
      ]);
    });

    it('should deduplicate the same CVE attached to the same asset by several sources', async () => {
      const asset = await createSupportingAsset('Asset');
      const cveUuid = await insertCve('CVE-DUP', { cvss: 7.5 });
      await attachEvidence(asset, cveUuid, { createdAt: daysAgo(10) });
      const newerEvidence = await attachEvidence(asset, cveUuid, {
        createdAt: daysAgo(2),
        userId: null,
        sourceScenarioId: 'scenario-duplicate-2',
      });
      await insertHistory(newerEvidence, 'dismissed', daysAgo(1));

      const overview = await services.withOrigin(adminOrigin).dashboard.getFindingsOverview();

      expect(overview.summary.activeCount).toBe(0);
    });

    it('should scope to an organization through direct and transitive asset links', async () => {
      const paA = await createPrimaryAsset(orgAId, 'PA A');
      const paB = await createPrimaryAsset(orgBId, 'PA B');
      const directA = await createSupportingAsset('Direct A');
      const providerA = await createSupportingAsset('Provider A');
      const directB = await createSupportingAsset('Direct B');
      const orphan = await createSupportingAsset('Orphan');
      await linkToPrimary(directA, paA);
      await linkProvider(providerA, directA);
      await linkToPrimary(directB, paB);

      const cveA = await insertCve('CVE-A', { cvss: 9.0 });
      const cveProvider = await insertCve('CVE-PROV', { cvss: 7.0 });
      const cveB = await insertCve('CVE-B', { cvss: 6.0 });
      const cveOrphan = await insertCve('CVE-ORPHAN', { cvss: 5.0 });
      await attachEvidence(directA, cveA);
      await attachEvidence(providerA, cveProvider);
      await attachEvidence(directB, cveB);
      await attachEvidence(orphan, cveOrphan);
      await recomputeReach();

      const orgOverview = await services.withOrigin(adminOrigin).dashboard.getFindingsOverview(orgAId);
      expect(orgOverview.summary.activeCount).toBe(2);
      expect(orgOverview.topFindings.map((finding) => finding.cveId).sort()).toEqual(['CVE-A', 'CVE-PROV']);

      const tenantOverview = await services.withOrigin(adminOrigin).dashboard.getFindingsOverview();
      expect(tenantOverview.summary.activeCount).toBe(4);
    });

    it('should return an empty overview for an organization without linked assets', async () => {
      const asset = await createSupportingAsset('Unlinked');
      const cveUuid = await insertCve('CVE-X', { cvss: 9.0 });
      await attachEvidence(asset, cveUuid);
      await recomputeReach();

      const overview = await services.withOrigin(adminOrigin).dashboard.getFindingsOverview(orgAId);

      expect(overview.summary.activeCount).toBe(0);
      expect(overview.topFindings).toEqual([]);
      expect(overview.topCves).toEqual([]);
    });

    it('should keep a cycle between assets in the scope once, whichever way it is entered', async () => {
      const paA = await createPrimaryAsset(orgAId, 'PA A');
      const first = await createSupportingAsset('First');
      const second = await createSupportingAsset('Second');
      const outside = await createSupportingAsset('Outside');
      await linkToPrimary(first, paA);
      await linkProvider(second, first);
      await linkProvider(first, second);
      await attachEvidence(first, await insertCve('CVE-FIRST', { cvss: 9.0 }));
      await attachEvidence(second, await insertCve('CVE-SECOND', { cvss: 8.0 }));
      await attachEvidence(outside, await insertCve('CVE-OUTSIDE', { cvss: 7.0 }));
      await recomputeReach();

      const overview = await services.withOrigin(adminOrigin).dashboard.getFindingsOverview(orgAId);

      expect(overview.summary.activeCount).toBe(2);
      expect(overview.summary.impactedAssetCount).toBe(2);
      expect(overview.topFindings.map((finding) => finding.cveId)).toEqual(['CVE-FIRST', 'CVE-SECOND']);
    });

    it('should stop at the fifth provider level and leave the sixth out of the scope', async () => {
      const paA = await createPrimaryAsset(orgAId, 'PA A');
      const chain: Array<string> = [];
      for (let depth = 0; depth <= 6; depth += 1) {
        chain.push(await createSupportingAsset(`Level ${depth}`));
      }
      await linkToPrimary(chain[0], paA);
      for (let depth = 1; depth < chain.length; depth += 1) {
        await linkProvider(chain[depth], chain[depth - 1]);
      }
      for (const [depth, asset] of chain.entries()) {
        await attachEvidence(asset, await insertCve(`CVE-LEVEL-${depth}`, { cvss: 5.0 }));
      }
      await recomputeReach();

      const overview = await services.withOrigin(adminOrigin).dashboard.getFindingsOverview(orgAId);

      expect(overview.summary.activeCount).toBe(6);
      expect(overview.topCves.map((entry) => entry.cveId)).not.toContain('CVE-LEVEL-6');
      const assets = await services.withOrigin(adminOrigin).dashboard.getAssetsOverview(orgAId);
      expect(assets.byCategory).toEqual([{ categoryId: 'host', assetCount: 6, impactedAssetCount: 6 }]);
    });

    it('should normalize the CVE id when it dedupes and when it groups the top CVEs', async () => {
      const asset1 = await createSupportingAsset('Asset 1');
      const asset2 = await createSupportingAsset('Asset 2');
      const upper = await insertCve('CVE-NORM', { cvss: 7.0 });
      const padded = await insertCve('\tcve-norm \n', { cvss: 9.0 });
      await attachEvidence(asset1, upper, { createdAt: daysAgo(10) });
      await attachEvidence(asset1, padded, { createdAt: daysAgo(2), sourceScenarioId: 'other-source' });
      await attachEvidence(asset2, upper);

      const overview = await services.withOrigin(adminOrigin).dashboard.getFindingsOverview();

      expect(overview.summary.activeCount).toBe(2);
      expect(overview.topCves).toEqual([
        { cveId: 'CVE-NORM', cvss: 9.0, epss: null, kev: false, impactedAssetCount: 2 },
      ]);
    });

    it('should break a recency tie between two sources on the higher evidence id', async () => {
      const asset = await createSupportingAsset('Asset');
      const cveUuid = await insertCve('CVE-TIE', { cvss: 7.5 });
      const sameInstant = daysAgo(10);
      await attachEvidence(asset, cveUuid, { createdAt: sameInstant });
      const higher = await attachEvidence(asset, cveUuid, { createdAt: sameInstant, sourceScenarioId: 'later-source' });
      await insertHistory(higher, 'dismissed', sameInstant);

      const overview = await services.withOrigin(adminOrigin).dashboard.getFindingsOverview();

      expect(overview.summary.activeCount).toBe(0);
    });

    it('should keep, of two sources of one CVE on an asset, the one whose state changed last', async () => {
      const asset = await createSupportingAsset('Asset');
      const cveUuid = await insertCve('CVE-RECENT', { cvss: 7.5 });
      const dismissedLater = await attachEvidence(asset, cveUuid, { createdAt: daysAgo(10) });
      await attachEvidence(asset, cveUuid, { createdAt: daysAgo(5), sourceScenarioId: 'later-source' });
      await insertHistory(dismissedLater, 'dismissed', daysAgo(1));

      const overview = await services.withOrigin(adminOrigin).dashboard.getFindingsOverview();

      expect(overview.summary.activeCount).toBe(0);
    });

    it('should break a full score tie on the CVE id then the evidence id', async () => {
      const asset1 = await createSupportingAsset('Asset 1');
      const asset2 = await createSupportingAsset('Asset 2');
      const cveB = await insertCve('CVE-B', { cvss: 5.0, epss: 0.2 });
      const cveA = await insertCve('CVE-A', { cvss: 5.0, epss: 0.2 });
      const firstOnA = await attachEvidence(asset1, cveA);
      const secondOnA = await attachEvidence(asset2, cveA);
      await attachEvidence(asset1, cveB);

      const overview = await services.withOrigin(adminOrigin).dashboard.getFindingsOverview();

      expect(overview.topFindings.map((finding) => finding.cveId)).toEqual(['CVE-A', 'CVE-A', 'CVE-B']);
      expect(overview.topFindings.slice(0, 2).map((finding) => finding.evidenceId)).toEqual([firstOnA, secondOnA]);
    });

    it('should bucket every CVSS boundary the way the severity scale defines it', async () => {
      const asset = await createSupportingAsset('Boundary asset');
      const scores: Array<number | null> = [0, 0.1, 3.9, 4.0, 6.9, 7.0, 8.9, 9.0, 10.0, 11, null];
      for (const [index, cvss] of scores.entries()) {
        await attachEvidence(asset, await insertCve(`CVE-BOUND-${index}`, cvss === null ? {} : { cvss }));
      }

      const overview = await services.withOrigin(adminOrigin).dashboard.getFindingsOverview();

      expect(overview.summary.activeCount).toBe(scores.length);
      expect(overview.summary.severityDistribution).toEqual({
        critical: 2, high: 2, medium: 2, low: 2, none: 1, unscored: 2,
      });
    });

    it('should read a non-finite score as no rating rather than shipping it', async () => {
      const asset = await createSupportingAsset('Corrupt score asset');
      const rated = await insertCve('CVE-RATED', { cvss: 7.5 });
      await attachEvidence(asset, rated);
      const broken = uuidv7();
      await db.insert(cve).values([{
        id: broken, tenantId: adminTenantId, cveId: 'CVE-NAN', cvss: Number.NaN, epss: Number.POSITIVE_INFINITY,
      }]);
      await attachEvidence(asset, broken);

      const overview = await services.withOrigin(adminOrigin).dashboard.getFindingsOverview();

      expect(overview.summary.severityDistribution).toMatchObject({ high: 1, unscored: 1 });
      const broken0 = overview.topFindings.find((finding) => finding.cveId === 'CVE-NAN');
      expect(broken0).toMatchObject({ cvss: null, epss: null });
      expect(overview.topCves).toContainEqual(
        expect.objectContaining({ cveId: 'CVE-NAN', cvss: null, epss: null }),
      );
    });

    it('should keep a corrupt score from poisoning the CVE it shares, at either infinity', async () => {
      const asset1 = await createSupportingAsset('Asset 1');
      const asset2 = await createSupportingAsset('Asset 2');
      const asset3 = await createSupportingAsset('Asset 3');
      const rated = await insertCve('CVE-MIX', { cvss: 8.0, epss: 0.4 });
      const insertCorruptCve = async (cveTextId: string, score: number): Promise<string> => {
        const id = uuidv7();
        await db.insert(cve).values([{ id, tenantId: adminTenantId, cveId: cveTextId, cvss: score, epss: score }]);
        return id;
      };
      // `NaN` sorts above every number in Postgres, so it wins `max()` unless it is normalized away.
      const poisoning = await insertCorruptCve('cve-mix ', Number.NaN);
      const negative = await insertCorruptCve('CVE-NEG', Number.NEGATIVE_INFINITY);
      await attachEvidence(asset1, rated);
      await attachEvidence(asset2, poisoning);
      await attachEvidence(asset3, negative);

      const overview = await services.withOrigin(adminOrigin).dashboard.getFindingsOverview();

      expect(overview.topCves).toContainEqual(
        { cveId: 'CVE-MIX', cvss: 8.0, epss: 0.4, kev: false, impactedAssetCount: 2 },
      );
      expect(overview.topCves).toContainEqual(
        expect.objectContaining({ cveId: 'CVE-NEG', cvss: null, epss: null }),
      );
      expect(overview.topFindings).toContainEqual(
        expect.objectContaining({ cveId: 'CVE-NEG', cvss: null, epss: null }),
      );
    });

    it('should cap the top lists instead of growing with the finding count', async () => {
      const assets: Array<string> = [];
      for (let index = 0; index < 7; index += 1) {
        assets.push(await createSupportingAsset(`Asset ${index}`, { criticality: 'high' }));
      }
      for (const [index, asset] of assets.entries()) {
        await attachEvidence(asset, await insertCve(`CVE-CAP-${index}`, { cvss: 1 + index }));
      }

      const overview = await services.withOrigin(adminOrigin).dashboard.getFindingsOverview();
      const assetsOverview = await services.withOrigin(adminOrigin).dashboard.getAssetsOverview();

      expect(overview.summary.activeCount).toBe(7);
      expect(overview.topFindings).toHaveLength(5);
      expect(overview.topCves).toHaveLength(5);
      expect(assetsOverview.topAssets).toHaveLength(5);
    });
  });

  describe('getTechniqueFindingCounts', () => {
    it('should keep only the findings on the direct and transitive assets of a scope', async () => {
      const paA = await createPrimaryAsset(orgAId, 'PA A');
      const paB = await createPrimaryAsset(orgBId, 'PA B');
      const directA = await createSupportingAsset('Direct A');
      const providerA = await createSupportingAsset('Provider A');
      const directB = await createSupportingAsset('Direct B');
      await linkToPrimary(directA, paA);
      await linkProvider(providerA, directA);
      await linkToPrimary(directB, paB);
      await attachTechniqueFinding(directA, 'T1190');
      await attachTechniqueFinding(providerA, 'T1110');
      await attachTechniqueFinding(directB, 'T1078');
      await recomputeReach();

      expect(await services.withOrigin(adminOrigin).dashboard.getTechniqueFindingCounts(orgAId)).toEqual([
        countedTechnique('T1110', 1), countedTechnique('T1190', 1),
      ]);
      expect(await services.withOrigin(adminOrigin).dashboard.getTechniqueFindingCounts()).toEqual([
        countedTechnique('T1078', 1), countedTechnique('T1110', 1), countedTechnique('T1190', 1),
      ]);
    });

    it('should count each finding of a scope by its latest state by date, as over the whole tenant', async () => {
      const primary = await createPrimaryAsset(orgAId, 'PA A');
      const neverSetAside = await createSupportingAsset('Never set aside');
      const reopened = await createSupportingAsset('Reopened');
      const backdated = await createSupportingAsset('Backdated');
      for (const asset of [neverSetAside, reopened, backdated]) {
        await linkToPrimary(asset, primary);
      }
      await attachTechniqueFinding(neverSetAside, 'T1190');
      const reopenedFinding = await attachTechniqueFinding(reopened, 'T1190');
      await insertHistory(reopenedFinding, 'applicable', daysAgo(20));
      await insertHistory(reopenedFinding, 'dismissed', daysAgo(10));
      await insertHistory(reopenedFinding, 'applicable', daysAgo(2));
      // Written last but dated first, so the dismissal written before it is the state that stands.
      const backdatedFinding = await attachTechniqueFinding(backdated, 'T1190');
      await insertHistory(backdatedFinding, 'dismissed', daysAgo(2));
      await insertHistory(backdatedFinding, 'applicable', daysAgo(10));
      await attachTechniqueFinding(await createSupportingAsset('Outside'), 'T1190');
      await recomputeReach();

      expect(await services.withOrigin(adminOrigin).dashboard.getTechniqueFindingCounts(orgAId)).toEqual([countedTechnique('T1190', 2)]);
      expect(await services.withOrigin(adminOrigin).dashboard.getTechniqueFindingCounts()).toEqual([countedTechnique('T1190', 3)]);
    });

    it('should leave out a technique whose findings are all dismissed, and every CVE finding', async () => {
      const asset = await createSupportingAsset('Asset');
      await insertHistory(await attachTechniqueFinding(asset, 'T1190'), 'dismissed', daysAgo(1));
      await attachEvidence(asset, await insertCve('CVE-OPEN'));

      expect(await services.withOrigin(adminOrigin).dashboard.getTechniqueFindingCounts()).toEqual([]);
    });

    it('should rank the techniques by their findings, then by ATT&CK id', async () => {
      const first = await createSupportingAsset('First');
      const second = await createSupportingAsset('Second');
      for (const asset of [first, first, second]) {
        await attachTechniqueFinding(asset, 'T1566');
      }
      await attachTechniqueFinding(second, 'T1190');
      await attachTechniqueFinding(first, 'T1078');

      expect(await services.withOrigin(adminOrigin).dashboard.getTechniqueFindingCounts()).toEqual([
        countedTechnique('T1566', 3), countedTechnique('T1078', 1), countedTechnique('T1190', 1),
      ]);
    });

    it('should return nothing for a scope without linked assets', async () => {
      await attachTechniqueFinding(await createSupportingAsset('Unlinked'), 'T1190');
      await recomputeReach();

      expect(await services.withOrigin(adminOrigin).dashboard.getTechniqueFindingCounts(orgAId)).toEqual([]);
    });
  });

  describe('getRemediationPace', () => {
    const scoreFinding = async (evidenceId: string, band: SeverityBand): Promise<void> => {
      await db.insert(findingScores).values([{
        assetEvidenceId: evidenceId,
        tenantId: adminTenantId,
        score: SEVERITY_BAND_MINIMUMS[band],
        band,
      }]);
    };

    const insertConnectorHistory = async (evidenceId: string, state: 'applicable' | 'dismissed', stateChangedAt: Date): Promise<void> => {
      await db.insert(assetEvidenceHistory).values([{
        id: uuidv7(), tenantId: adminTenantId, assetEvidenceId: evidenceId, state, stateChangedAt, observedAt: stateChangedAt, origin: state === 'applicable' ? 'exposed' : 'not_exposed',
      }]);
    };

    it('should close a finding on each dismissal transition, whatever its origin, and count a reopened one as open', async () => {
      const asset = await createSupportingAsset('Pace asset');
      const reopened = await attachEvidence(asset, await insertCve('CVE-P1', { cvss: 7.0 }), { createdAt: daysAgo(40) });
      await scoreFinding(reopened, 'high');
      await insertHistory(reopened, 'dismissed', daysAgo(20));
      await insertHistory(reopened, 'applicable', daysAgo(10));

      const closed = await attachEvidence(asset, await insertCve('CVE-P2', { cvss: 9.8 }), { createdAt: daysAgo(50) });
      await scoreFinding(closed, 'critical');
      await insertConnectorHistory(closed, 'dismissed', daysAgo(5));
      await insertConnectorHistory(closed, 'dismissed', daysAgo(3));

      await attachEvidence(asset, await insertCve('CVE-P3'), { createdAt: daysAgo(100) });

      const pace = await services.withOrigin(adminOrigin).dashboard.getRemediationPace({ windowDays: 90 });
      const band = (name: SeverityBand) => pace.bands.find((row) => row.band === name)!;

      expect(pace.measurable).toBe(true);
      expect(pace.total).toMatchObject({ newInWindow: 2, closedInWindow: 2, openCount: 2 });
      expect(band('high')).toMatchObject({ newInWindow: 1, closedInWindow: 1, openCount: 1 });
      expect(band('critical')).toMatchObject({ newInWindow: 1, closedInWindow: 1, openCount: 0 });
      expect(band('high').medianDaysOpen).toBeCloseTo(20);
      expect(band('critical').medianDaysOpen).toBeCloseTo(45);
      expect(pace.total.medianDaysOpen).toBeCloseTo(32.5);
      expect(band('medium').medianDaysOpen).toBeNull();
    });

    it('should honour the law of Little in a steady state: open = new per month x mean time open', async () => {
      const asset = await createSupportingAsset('Steady asset');
      const daysOpen = 30;
      const findings = Array.from({ length: 134 }, (_, index) => ({ cveId: uuidv7(), evidenceId: uuidv7(), createdAt: daysAgo(index * 3) }));
      await db.insert(cve).values(findings.map((finding, index) => ({ id: finding.cveId, tenantId: adminTenantId, cveId: `CVE-STEADY-${index}` })));
      await db.insert(assetEvidence).values(findings.map((finding) => ({
        id: finding.evidenceId, supportingAssetId: asset, tenantId: adminTenantId, cveId: finding.cveId, createdAt: finding.createdAt,
      })));
      await db.insert(assetEvidenceHistory).values(findings
        .filter((finding) => finding.createdAt.getTime() + daysOpen * DAY_MS <= Date.now())
        .map((finding) => {
          const closedAt = new Date(finding.createdAt.getTime() + daysOpen * DAY_MS);
          return {
            id: uuidv7(),
            tenantId: adminTenantId,
            assetEvidenceId: finding.evidenceId,
            state: 'dismissed' as const,
            stateChangedAt: closedAt,
            observedAt: closedAt,
            origin: 'not_exposed' as const,
          };
        }));

      const { total } = await services.withOrigin(adminOrigin).dashboard.getRemediationPace({ windowDays: 90 });

      expect(total.openCount).toBe(10);
      expect(total.meanDaysOpen).toBeCloseTo(daysOpen);
      expect(total.newPerMonth * (total.meanDaysOpen! / DAYS_PER_MONTH)).toBeCloseTo(total.openCount, 0);
    });

    it('should not be measurable before two months of history', async () => {
      await attachEvidence(await createSupportingAsset('Young asset'), await insertCve('CVE-Y'), { createdAt: daysAgo(10) });

      const pace = await services.withOrigin(adminOrigin).dashboard.getRemediationPace({ windowDays: 30 });

      expect(pace.measurable).toBe(false);
      expect(pace.measurableFrom! > new Date().toISOString().slice(0, 10)).toBe(true);
    });

    it('should scope the pace to an organization', async () => {
      const paA = await createPrimaryAsset(orgAId, 'PA A');
      const linked = await createSupportingAsset('Linked');
      const unlinked = await createSupportingAsset('Unlinked');
      await linkToPrimary(linked, paA);
      const cve1 = await insertCve('CVE-S1', { cvss: 7.0 });
      await attachEvidence(linked, cve1, { createdAt: daysAgo(3) });
      const outside = await attachEvidence(unlinked, cve1, { createdAt: daysAgo(3) });
      await insertHistory(outside, 'dismissed', daysAgo(1));
      await recomputeReach();

      const pace = await services.withOrigin(adminOrigin).dashboard.getRemediationPace({ organizationId: orgAId, windowDays: 30 });

      expect(pace.total).toMatchObject({ newInWindow: 1, closedInWindow: 0, medianDaysOpen: null });
    });
  });

  describe('getAssetsOverview', () => {
    it('should rank at-risk assets and build category and exposure distributions', async () => {
      const coreDb = await createSupportingAsset('Core DB', { criticality: 'high', categoryId: 'container_workload', exposure: 'internal' });
      const edgeApp = await createSupportingAsset('Edge App', { criticality: 'low', categoryId: 'host', exposure: 'internet_facing' });
      const idleHost = await createSupportingAsset('Idle Host', { criticality: 'high', categoryId: 'host', exposure: 'internal' });

      const kevCritical = await insertCve('CVE-K', { cvss: 9.5, kev: true });
      const medium = await insertCve('CVE-M', { cvss: 5.0 });
      const high = await insertCve('CVE-H', { cvss: 7.0 });
      await attachEvidence(coreDb, kevCritical);
      await attachEvidence(coreDb, medium);
      await attachEvidence(edgeApp, high);

      const overview = await services.withOrigin(adminOrigin).dashboard.getAssetsOverview();

      expect(overview.topAssets).toEqual([
        expect.objectContaining({ id: coreDb, score: 66, applicableCount: 2, criticalOrHighCount: 1 }),
        expect.objectContaining({ id: edgeApp, score: 5, applicableCount: 1, criticalOrHighCount: 1 }),
      ]);
      expect(overview.topAssets.map((asset) => asset.id)).not.toContain(idleHost);
      expect(overview.byCategory).toEqual([
        { categoryId: 'host', assetCount: 2, impactedAssetCount: 1 },
        { categoryId: 'container_workload', assetCount: 1, impactedAssetCount: 1 },
      ]);
      expect(overview.byExposure).toEqual([
        { exposure: 'internal', assetCount: 2, impactedAssetCount: 1 },
        { exposure: 'internet_facing', assetCount: 1, impactedAssetCount: 1 },
      ]);
    });

    it('should double the weight of a CISA-dated finding only, not of a flag-only one', async () => {
      const flaggedAsset = await createSupportingAsset('Flagged host', { criticality: 'high' });
      const plainAsset = await createSupportingAsset('Plain host', { criticality: 'high' });
      const listedAsset = await createSupportingAsset('Listed host', { criticality: 'high' });
      await attachEvidence(flaggedAsset, await insertCve('CVE-W-FLAG', { cvss: 5.0, kev: true, kevUpdatedAt: null }));
      await attachEvidence(plainAsset, await insertCve('CVE-W-PLAIN', { cvss: 5.0 }));
      await attachEvidence(listedAsset, await insertCve('CVE-W-LISTED', { cvss: 5.0, kevUpdatedAt: new Date('2026-01-01T00:00:00Z') }));

      const overview = await services.withOrigin(adminOrigin).dashboard.getAssetsOverview();

      const scoreOf = (id: string) => overview.topAssets.find((asset) => asset.id === id)?.score;
      expect(scoreOf(flaggedAsset)).toBe(scoreOf(plainAsset));
      expect(scoreOf(listedAsset)).toBeGreaterThan(scoreOf(plainAsset) ?? 0);
    });

    it('should rank a very_high asset above an otherwise identical high one', async () => {
      const top = await createSupportingAsset('Alpha top band', { criticality: 'very_high' });
      const below = await createSupportingAsset('Alpha high band', { criticality: 'high' });
      const high = await insertCve('CVE-BAND', { cvss: 7.0 });
      await attachEvidence(top, high);
      await attachEvidence(below, high);

      const overview = await services.withOrigin(adminOrigin).dashboard.getAssetsOverview();

      expect(overview.topAssets.map((asset) => asset.id)).toEqual([top, below]);
      expect(overview.topAssets.map((asset) => asset.score)).toEqual([20, 15]);
    });

    it('should break a full score tie by name, nameless assets last, then by id', async () => {
      const zulu = await createSupportingAsset('Zulu', { criticality: 'low' });
      const firstNameless = await createNamelessAsset();
      const secondNameless = await createNamelessAsset();
      const high = await insertCve('CVE-EQ', { cvss: 7.0 });
      await attachEvidence(zulu, high);
      await attachEvidence(firstNameless, high);
      await attachEvidence(secondNameless, high);

      const overview = await services.withOrigin(adminOrigin).dashboard.getAssetsOverview();

      expect(overview.topAssets.map((asset) => asset.score)).toEqual([5, 5, 5]);
      expect(overview.topAssets.map((asset) => asset.id)).toEqual([zulu, firstNameless, secondNameless]);
    });

    it('should carry the derived name of an asset with no name, and break a tie on the name it displays', async () => {
      const zulu = await createSupportingAsset('Zulu', { criticality: 'low' });
      const addressAsset = await createNamelessAsset('10.0.0.1');
      const high = await insertCve('CVE-DISPLAY', { cvss: 7.0 });
      await attachEvidence(zulu, high);
      await attachEvidence(addressAsset, high);

      const overview = await services.withOrigin(adminOrigin).dashboard.getAssetsOverview();

      expect(overview.topAssets.map((asset) => [asset.id, asset.name, asset.derivedName])).toEqual([
        [addressAsset, null, '10.0.0.1'],
        [zulu, 'Zulu', null],
      ]);
    });

    it('should scope assets to the organization graph', async () => {
      const paA = await createPrimaryAsset(orgAId, 'PA A');
      const linked = await createSupportingAsset('Linked', { criticality: 'high' });
      await createSupportingAsset('Unlinked');
      await linkToPrimary(linked, paA);
      const cveUuid = await insertCve('CVE-O', { cvss: 7.0 });
      await attachEvidence(linked, cveUuid);
      await recomputeReach();

      const overview = await services.withOrigin(adminOrigin).dashboard.getAssetsOverview(orgAId);

      expect(overview.byCategory).toEqual([{ categoryId: 'host', assetCount: 1, impactedAssetCount: 1 }]);
      expect(overview.topAssets).toHaveLength(1);
    });
  });

  describe('tenant isolation', () => {
    it('should not expose another tenant findings or assets', async () => {
      const asset = await createSupportingAsset('Tenant 1 asset');
      const cveUuid = await insertCve('CVE-ISO', { cvss: 9.0 });
      await attachEvidence(asset, cveUuid);

      const tenant2Id = await createTenant(services, adminUserId);
      const admin2Origin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenant2Id };

      const overview = await services.withOrigin(admin2Origin).dashboard.getFindingsOverview();
      expect(overview.summary.activeCount).toBe(0);

      const pace = await services.withOrigin(admin2Origin).dashboard.getRemediationPace({ windowDays: 90 });
      expect(pace.total.openCount).toBe(0);

      const assetsOverview = await services.withOrigin(admin2Origin).dashboard.getAssetsOverview();
      expect(assetsOverview.topAssets).toEqual([]);
      expect(assetsOverview.byCategory).toEqual([]);
    });
  });
});

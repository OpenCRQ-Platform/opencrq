import type { EventOrigin } from '@app/module';
import { assetEvidence, assetEvidenceHistory, assetEvidenceVerdicts, cve, TECHNIQUE_T1003 } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { insertSyncedVerdict } from '../../helpers/evidence-rows';
import { createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): Date => new Date(Date.now() - days * DAY_MS);

const OPEN_VECTOR = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H';

describe('Dashboard estate figures', () => {
  let adminOrigin: EventOrigin;
  let adminTenantId: string;
  let adminUserId: string;
  let cveSequence: number;

  const createAsset = async (
    name: string,
    options: { exposure?: 'internet_facing' | 'internal', category?: 'host' | 'web_application', subcategory?: 'server' | 'website' } = {},
  ): Promise<string> => {
    const id = uuidv7();
    await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
      id,
      name,
      description: null,
      ownerId: null,
      exposure: options.exposure ?? 'internal',
      categoryId: options.category ?? 'host',
      subcategoryId: options.subcategory ?? null,
      criticality: 'high',
    });
    return id;
  };

  const createClosedScope = async (mappedAssetIds: Array<string>): Promise<string> => {
    const id = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([
      { id, name: `Scope ${id}`, estateMode: 'closed', mappedAssetIds },
    ]);
    return id;
  };

  const attachCve = async (supportingAssetId: string, options: { kev?: boolean, firstSeenDaysAgo?: number } = {}): Promise<string> => {
    const cveUuid = uuidv7();
    await db.insert(cve).values([{
      id: cveUuid,
      tenantId: adminTenantId,
      cveId: `CVE-2026-${String(cveSequence += 1).padStart(5, '0')}`,
      kev: options.kev ?? null,
      kevUpdatedAt: options.kev ? new Date() : null,
      epss: 0.5,
      cvssVector: OPEN_VECTOR,
    }]);
    const id = uuidv7();
    await db.insert(assetEvidence).values([{
      id,
      supportingAssetId,
      tenantId: adminTenantId,
      cveId: cveUuid,
      userId: adminUserId,
      createdAt: daysAgo(options.firstSeenDaysAgo ?? 1),
    }]);
    return id;
  };

  const attachTechnique = async (
    supportingAssetId: string,
    expectationType: 'prevention' | 'detection',
    securityPlatformType: string | null = null,
  ): Promise<string> => {
    const id = uuidv7();
    await db.insert(assetEvidence).values([{
      id,
      supportingAssetId,
      tenantId: adminTenantId,
      mitreTechniqueId: TECHNIQUE_T1003,
      expectationType,
      securityPlatformType,
      evaluatedAt: new Date(),
    }]);
    return id;
  };

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminTenantId = setup.tenantId;
    adminUserId = setup.userId;
    cveSequence = 0;
  });

  describe('the open finding figures', () => {
    it('should count the open findings that are critical, exposed, exploited or aged, dismissed ones excluded', async () => {
      const exposed = await createAsset('Exposed host', { exposure: 'internet_facing' });
      const internal = await createAsset('Internal host');
      await attachCve(exposed, { kev: true, firstSeenDaysAgo: 91 });
      await attachCve(internal, { firstSeenDaysAgo: 89 });
      const dismissed = await attachCve(exposed, { kev: true, firstSeenDaysAgo: 120 });
      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();
      await services.withOrigin(adminOrigin).supportingAssets.dismissEvidence({
        evidenceId: dismissed, dismissalType: 'false_positive', reasonCode: 'detection_error', reason: 'Set aside', changedByUserId: adminUserId,
      });

      const figures = await services.withOrigin(adminOrigin).findingScore.getOpenFindingFigures(null);
      const panel = await services.withOrigin(adminOrigin).findingScore.getFindingsPanelCounts(null);

      expect(figures).toMatchObject({ open: 2, internetExposed: 1, knownExploited: 1, aged: 1 });
      expect(figures.critical).toBe(panel.bands.find((row) => row.band === 'critical')?.total ?? 0);
      expect(figures.open).toBe(panel.findings);
    });

    it('should read only the estate of a closed scope', async () => {
      const exposed = await createAsset('Exposed host', { exposure: 'internet_facing' });
      const internal = await createAsset('Internal host');
      await attachCve(exposed, { kev: true });
      await attachCve(internal);
      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();
      const scopeId = await createClosedScope([internal]);

      const figures = await services.withOrigin(adminOrigin).findingScore.getOpenFindingFigures(scopeId);

      expect(figures).toMatchObject({ open: 1, internetExposed: 0, knownExploited: 0 });
    });
  });

  describe('the technique test posture', () => {
    it('should tally the latest connector verdicts now and as they stood a month ago', async () => {
      const first = await createAsset('First host');
      const second = await createAsset('Second host');
      const heldAll = await attachTechnique(first, 'prevention');
      const heldLately = await attachTechnique(first, 'prevention', 'EDR');
      const newcomer = await attachTechnique(second, 'prevention');
      const detection = await attachTechnique(first, 'detection');
      await insertSyncedVerdict(heldAll, 'dismissed', daysAgo(40));
      await insertSyncedVerdict(heldLately, 'applicable', daysAgo(40));
      await insertSyncedVerdict(heldLately, 'dismissed', daysAgo(5));
      await insertSyncedVerdict(newcomer, 'applicable', daysAgo(5));
      await insertSyncedVerdict(detection, 'applicable', daysAgo(5));

      const posture = await services.withOrigin(adminOrigin).findingScore.getTechniqueTestPosture(null);

      expect(posture.testedAssetCount).toBe(2);
      expect(posture.expectations.prevention).toEqual({ current: { held: 2, total: 3 }, previous: { held: 1, total: 2 } });
      expect(posture.expectations.detection).toEqual({ current: { held: 0, total: 1 }, previous: null });
    });

    it('should read a month ago only the verdicts delivered by then, whatever the date of their test', async () => {
      const host = await createAsset('Host tested late');
      const heldOnTime = await attachTechnique(host, 'prevention');
      const heldLate = await attachTechnique(host, 'prevention', 'EDR');
      await insertSyncedVerdict(heldOnTime, 'dismissed', daysAgo(40));
      await db.insert(assetEvidenceVerdicts).values([{
        id: uuidv7(), tenantId: adminTenantId, assetEvidenceId: heldLate, isExposed: false, observedAt: daysAgo(40), recordedAt: daysAgo(5),
      }]);

      const posture = await services.withOrigin(adminOrigin).findingScore.getTechniqueTestPosture(null);

      expect(posture.expectations.prevention).toEqual({ current: { held: 2, total: 2 }, previous: { held: 1, total: 1 } });
    });

    it('should tally a closed scope the way it tallies the tenant, now and a month ago, never on a person decision', async () => {
      const first = await createAsset('First host');
      const second = await createAsset('Second host');
      const outside = await createAsset('Outside host');
      const heldAll = await attachTechnique(first, 'prevention');
      const heldLately = await attachTechnique(first, 'prevention', 'EDR');
      const newcomer = await attachTechnique(second, 'prevention');
      await insertSyncedVerdict(heldAll, 'dismissed', daysAgo(40));
      await insertSyncedVerdict(heldLately, 'applicable', daysAgo(40));
      await insertSyncedVerdict(heldLately, 'dismissed', daysAgo(5));
      await insertSyncedVerdict(newcomer, 'applicable', daysAgo(5));
      await db.insert(assetEvidenceHistory).values([{
        id: uuidv7(), assetEvidenceId: newcomer, tenantId: adminTenantId, state: 'dismissed', stateChangedAt: daysAgo(1), changedByUserId: adminUserId, origin: 'user',
      }]);
      await insertSyncedVerdict(await attachTechnique(outside, 'prevention'), 'dismissed', daysAgo(40));
      // A run never gave this one a verdict, so its asset is not tested whatever a person wrote.
      const decidedOnly = await createAsset('Decided-only host');
      await db.insert(assetEvidenceHistory).values([{
        id: uuidv7(), assetEvidenceId: await attachTechnique(decidedOnly, 'prevention'), tenantId: adminTenantId, state: 'dismissed', stateChangedAt: daysAgo(1), changedByUserId: adminUserId, origin: 'user',
      }]);
      const scopeId = await createClosedScope([first, second, decidedOnly]);

      const scoped = await services.withOrigin(adminOrigin).findingScore.getTechniqueTestPosture(scopeId);
      const tenant = await services.withOrigin(adminOrigin).findingScore.getTechniqueTestPosture(null);

      expect(scoped.testedAssetCount).toBe(2);
      expect(scoped.expectations.prevention).toEqual({ current: { held: 2, total: 3 }, previous: { held: 1, total: 2 } });
      expect(tenant.testedAssetCount).toBe(3);
      expect(tenant.expectations.prevention).toEqual({ current: { held: 3, total: 4 }, previous: { held: 2, total: 3 } });
    });

    it('should read a scope without a result as not tested', async () => {
      const tested = await createAsset('Tested host');
      const untested = await createAsset('Untested host');
      await insertSyncedVerdict(await attachTechnique(tested, 'prevention'), 'dismissed', daysAgo(1));
      const scopeId = await createClosedScope([untested]);

      const posture = await services.withOrigin(adminOrigin).findingScore.getTechniqueTestPosture(scopeId);

      expect(posture).toEqual({
        testedAssetCount: 0,
        expectations: {
          prevention: { current: null, previous: null },
          detection: { current: null, previous: null },
        },
      });
    });
  });

  describe('the asset count per subcategory', () => {
    it('should count the estate per category and subcategory, an asset without one under null', async () => {
      await createAsset('Server one', { subcategory: 'server' });
      await createAsset('Server two', { subcategory: 'server' });
      await createAsset('Unspecified host');
      const webApp = await createAsset('Web app', { category: 'web_application', subcategory: 'website' });

      const tenantWide = await services.withOrigin(adminOrigin).supportingAssets.getAssetCountBySubcategory(null);
      const scoped = await services.withOrigin(adminOrigin).supportingAssets.getAssetCountBySubcategory(await createClosedScope([webApp]));

      expect(tenantWide).toEqual([
        { categoryId: 'host', subcategoryId: 'server', assetCount: 2 },
        { categoryId: 'host', subcategoryId: null, assetCount: 1 },
        { categoryId: 'web_application', subcategoryId: 'website', assetCount: 1 },
      ]);
      expect(scoped).toEqual([{ categoryId: 'web_application', subcategoryId: 'website', assetCount: 1 }]);
    });
  });
});

import type { EventOrigin, ExpectationType } from '@app/module';
import { assetEvidence, assetEvidenceHistory, mitreTechniquesData } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { insertSyncedVerdict } from '../../helpers/evidence-rows';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const TECHNIQUE_ID_BY_EXTERNAL_ID = new Map(mitreTechniquesData.map((technique) => [technique.externalId, technique.id]));
const techniqueId = (externalId: string): string => TECHNIQUE_ID_BY_EXTERNAL_ID.get(externalId)!;

const RUN_AT = new Date('2026-09-20T10:00:00Z');
const LATER_RUN_AT = new Date('2026-09-24T10:00:00Z');

describe('OpenAEV results on an asset technique tab', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let tenantId: string;
  let assetId: string;

  const createAsset = async (origin: EventOrigin = adminOrigin): Promise<string> => {
    const id = uuidv7();
    await services.withOrigin(origin).supportingAssets.createSupportingAsset({
      id,
      name: 'Card Authorization Engine',
      description: null,
      ownerId: null,
      exposure: 'internet_facing',
      categoryId: 'web_application',
      criticality: 'unknown',
    });
    return id;
  };

  let scenario = 0;

  /** One result, its verdicts oldest first; the last connector one is the one read. */
  const insertResult = async (
    verdicts: Array<{ state: 'applicable' | 'dismissed', origin?: 'no_longer_reported' | 'user', at?: Date }>,
    options: {
      technique: string,
      expectationType: ExpectationType,
      securityPlatformType: string,
      supportingAssetId?: string,
      tenant?: string,
      evaluatedAt?: Date,
    },
  ): Promise<void> => {
    const evidenceId = uuidv7();
    scenario += 1;
    await db.insert(assetEvidence).values([{
      id: evidenceId,
      supportingAssetId: options.supportingAssetId ?? assetId,
      tenantId: options.tenant ?? tenantId,
      mitreTechniqueId: techniqueId(options.technique),
      expectationType: options.expectationType,
      securityPlatformType: options.securityPlatformType,
      sourceScenarioId: `scenario-${scenario}`,
      evaluatedAt: options.evaluatedAt ?? RUN_AT,
    }]);
    for (const [index, verdict] of verdicts.entries()) {
      const at = verdict.at ?? new Date(RUN_AT.getTime() + index * 1000);
      if (verdict.origin === undefined) {
        await insertSyncedVerdict(evidenceId, verdict.state, at);
        continue;
      }
      await db.insert(assetEvidenceHistory).values([{
        id: uuidv7(),
        tenantId: options.tenant ?? tenantId,
        assetEvidenceId: evidenceId,
        state: verdict.state,
        stateChangedAt: at,
        observedAt: verdict.origin === 'user' ? null : at,
        changedByUserId: verdict.origin === 'user' ? adminUserId : null,
        origin: verdict.origin,
      }]);
    }
  };

  const held = (options: Parameters<typeof insertResult>[1]) => insertResult([{ state: 'dismissed' }], options);
  const letThrough = (options: Parameters<typeof insertResult>[1]) => insertResult([{ state: 'applicable' }], options);

  const readTests = (origin: EventOrigin = adminOrigin, supportingAssetId: string = assetId) =>
    services.withOrigin(origin).findingScore.getAssetTechniqueTests(supportingAssetId);

  const readDetail = (externalId: string, origin: EventOrigin = adminOrigin, supportingAssetId: string = assetId) =>
    services.withOrigin(origin).findingScore.getAssetTechniqueTestDetail(supportingAssetId, techniqueId(externalId));

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    tenantId = setup.tenantId;
    assetId = await createAsset();
  });

  describe('the asset tallies', () => {
    it('should read no result of either type on an asset OpenAEV never tested', async () => {
      expect(await readTests()).toEqual({ prevention: null, detection: null, techniques: [] });
    });

    it('should sum every technique of a type, a dismissed latest verdict holding', async () => {
      await held({ technique: 'T1190', expectationType: 'prevention', securityPlatformType: 'NDR' });
      await letThrough({ technique: 'T1190', expectationType: 'prevention', securityPlatformType: 'EDR' });
      await held({ technique: 'T1110', expectationType: 'prevention', securityPlatformType: 'ISPM' });
      await held({ technique: 'T1110', expectationType: 'detection', securityPlatformType: 'SIEM' });

      const tests = await readTests();

      expect(tests.prevention).toEqual({ held: 2, total: 3 });
      expect(tests.detection).toEqual({ held: 1, total: 1 });
      expect(tests.techniques).toEqual(expect.arrayContaining([
        { mitreTechniqueId: techniqueId('T1190'), prevention: { held: 1, total: 2 }, detection: null },
        { mitreTechniqueId: techniqueId('T1110'), prevention: { held: 1, total: 1 }, detection: { held: 1, total: 1 } },
      ]));
    });

    it('should read the latest connector verdict, never a person decision written after it', async () => {
      await insertResult(
        [{ state: 'applicable' }, { state: 'dismissed' }, { state: 'applicable', origin: 'user' }],
        { technique: 'T1190', expectationType: 'prevention', securityPlatformType: 'NDR' },
      );

      expect((await readTests()).prevention).toEqual({ held: 1, total: 1 });
    });

    it('should read the latest connector verdict, never a retirement derived after it', async () => {
      await insertResult(
        [{ state: 'applicable' }, { state: 'dismissed', origin: 'no_longer_reported' }],
        { technique: 'T1190', expectationType: 'prevention', securityPlatformType: 'NDR' },
      );

      expect((await readTests()).prevention).toEqual({ held: 0, total: 1 });
    });

    it('should read the latest connector verdict by its date, not by the order it was written in', async () => {
      await insertResult(
        [{ state: 'dismissed', at: LATER_RUN_AT }, { state: 'applicable', at: RUN_AT }],
        { technique: 'T1190', expectationType: 'prevention', securityPlatformType: 'NDR' },
      );

      expect((await readTests()).prevention).toEqual({ held: 1, total: 1 });
    });
  });

  describe('the detail of one technique', () => {
    it('should read the latest connector verdict here and per platform, never a person decision or a retirement after it', async () => {
      await insertResult(
        [{ state: 'applicable' }, { state: 'dismissed', origin: 'user' }],
        { technique: 'T1190', expectationType: 'prevention', securityPlatformType: 'NDR' },
      );
      await insertResult(
        [{ state: 'applicable' }, { state: 'dismissed', origin: 'no_longer_reported' }],
        { technique: 'T1190', expectationType: 'prevention', securityPlatformType: 'EDR' },
      );

      const { prevention } = await readDetail('T1190');

      expect(prevention.here).toEqual({ held: 0, total: 2 });
      expect(prevention.fleet).toEqual({ held: 0, total: 2 });
      expect(prevention.platforms).toEqual(expect.arrayContaining([
        expect.objectContaining({ securityPlatformType: 'NDR', held: 0, total: 1 }),
        expect.objectContaining({ securityPlatformType: 'EDR', held: 0, total: 1 }),
      ]));
    });

    it('should split the reading per platform family, the families adding up to the asset tally', async () => {
      await held({ technique: 'T1190', expectationType: 'prevention', securityPlatformType: 'NDR' });
      await held({ technique: 'T1190', expectationType: 'prevention', securityPlatformType: 'NDR', evaluatedAt: LATER_RUN_AT });
      await letThrough({ technique: 'T1190', expectationType: 'prevention', securityPlatformType: 'NDR' });
      await letThrough({ technique: 'T1190', expectationType: 'prevention', securityPlatformType: 'EDR' });

      const { prevention, detection } = await readDetail('T1190');

      expect(prevention.here).toEqual({ held: 2, total: 4 });
      expect(prevention.platforms).toEqual([
        { securityPlatformType: 'NDR', held: 2, total: 3, lastRunAt: LATER_RUN_AT },
        { securityPlatformType: 'EDR', held: 0, total: 1, lastRunAt: RUN_AT },
      ]);
      expect(detection).toEqual({ here: null, fleet: null, platforms: [] });
    });

    it('should read the fleet beside the asset, every asset of the tenant counted', async () => {
      const otherAssetId = await createAsset();
      await held({ technique: 'T1190', expectationType: 'detection', securityPlatformType: 'SIEM' });
      await letThrough({ technique: 'T1190', expectationType: 'detection', securityPlatformType: 'SIEM', supportingAssetId: otherAssetId });
      await held({ technique: 'T1190', expectationType: 'detection', securityPlatformType: 'SIEM', supportingAssetId: otherAssetId });

      const { detection } = await readDetail('T1190');

      expect(detection.here).toEqual({ held: 1, total: 1 });
      expect(detection.fleet).toEqual({ held: 2, total: 3 });
    });

    it('should read the fleet of a technique never tested on this asset', async () => {
      const otherAssetId = await createAsset();
      await held({ technique: 'T1190', expectationType: 'prevention', securityPlatformType: 'NDR', supportingAssetId: otherAssetId });

      expect((await readDetail('T1190')).prevention).toEqual({ here: null, fleet: { held: 1, total: 1 }, platforms: [] });
    });
  });

  it('should never let one tenant read another tenant results', async () => {
    const otherTenantId = await createTenant(services, adminUserId);
    const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };
    const otherAssetId = await createAsset(otherOrigin);
    await held({ technique: 'T1190', expectationType: 'prevention', securityPlatformType: 'NDR' });
    await letThrough({ technique: 'T1190', expectationType: 'prevention', securityPlatformType: 'NDR', supportingAssetId: otherAssetId, tenant: otherTenantId });

    expect((await readTests(otherOrigin, otherAssetId)).prevention).toEqual({ held: 0, total: 1 });
    expect(await readTests(otherOrigin, assetId)).toEqual({ prevention: null, detection: null, techniques: [] });
    expect(await readTests(adminOrigin, otherAssetId)).toEqual({ prevention: null, detection: null, techniques: [] });
    expect((await readDetail('T1190', otherOrigin, assetId)).prevention).toEqual({ here: null, fleet: { held: 0, total: 1 }, platforms: [] });
    expect((await readDetail('T1190')).prevention.fleet).toEqual({ held: 1, total: 1 });
  });
});

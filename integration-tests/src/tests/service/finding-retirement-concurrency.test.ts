import type { EventOrigin } from '@app/module';
import { assetEvidence, assetEvidenceHistory, compareFindingKeys, cve, supportingAssets, supportingAssetsRepository, TECHNIQUE_T1003, TECHNIQUE_T1003_001 } from '@app/module';
import { asc, eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import type { OverlappingTransaction } from '../../helpers/overlapping-writes';
import { backendPid, overlappingWrites, untilBlockedOn } from '../../helpers/overlapping-writes';
import { createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, repositoryContextOf, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const RETIREMENT_REASON = 'No longer reported by Microsoft Defender';
const OPENAEV_SCOPE = 'openaev-asset-1';

const pause = () => new Promise((resolve) => setTimeout(resolve, 20));

// A retirement pass of one connector racing a sync of another over the same finding.
describe('A retirement pass overlapping another connector\'s sync', () => {
  let tenantId: string;
  let adminOrigin: EventOrigin;
  let defenderOrigin: EventOrigin;
  let openaevOrigin: EventOrigin;
  let defenderId: string;
  let openaevId: string;

  const asset = async (): Promise<string> => {
    const id = uuidv7();
    await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
      id, name: `Host ${id.slice(-6)}`, description: null, ownerId: null, exposure: 'internal', categoryId: 'host',
    });
    return id;
  };

  const insertCve = async (): Promise<string> => {
    const id = uuidv7();
    await db.insert(cve).values([{ id, tenantId, cveId: `CVE-2026-${id.slice(-6)}` }]);
    return id;
  };

  const report = (connector: 'defender' | 'openaev', supportingAssetId: string, cveId: string) => ({
    id: uuidv7(),
    evaluatedAt: new Date(),
    supportingAssetId,
    cveId,
    mitreTechniqueId: null,
    expectationType: null,
    isExposed: true,
    connectorId: connector === 'defender' ? defenderId : openaevId,
    sourceFindingId: `${supportingAssetId}:${cveId}`,
    scope: connector === 'defender' ? '' : OPENAEV_SCOPE,
  });

  const openaevSync = (tx: OverlappingTransaction, rows: Array<ReturnType<typeof report>>) =>
    createTestServices(tx).withOrigin(openaevOrigin).supportingAssets.bulkUpsertEvidence(rows);

  /** Defender's run walked the asset without reporting the finding, and retires what it no longer reports. */
  const defenderRetirement = async (tx: OverlappingTransaction, supportingAssetId: string, enumeratedAt: Date) => {
    const svc = createTestServices(tx).withOrigin(defenderOrigin).supportingAssets;
    await svc.markAssetsEnumerated({ connectorId: defenderId, supportingAssetIds: [supportingAssetId], scope: '', enumeratedAt });
    return svc.recomputeEvidenceStateForAssets({ supportingAssetIds: [supportingAssetId], reason: RETIREMENT_REASON });
  };

  const historyOf = (evidenceId: string) => db
    .select({ state: assetEvidenceHistory.state, origin: assetEvidenceHistory.origin })
    .from(assetEvidenceHistory)
    .where(eq(assetEvidenceHistory.assetEvidenceId, evidenceId))
    .orderBy(asc(assetEvidenceHistory.stateChangedAt), asc(assetEvidenceHistory.id));

  const findingOf = async (supportingAssetId: string, cveId: string) => (await db
    .select({ id: assetEvidence.id, state: assetEvidence.currentState })
    .from(assetEvidence)
    .where(sql`${assetEvidence.supportingAssetId} = ${supportingAssetId} and ${assetEvidence.cveId} = ${cveId}`))[0];

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;

    const connectorOf = async (integration: 'microsoft_graph' | 'openaev') => {
      const serviceAccountId = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: `${integration} bot` });
      await services.withOrigin(adminOrigin).integrationSettings.configureIntegration(integration, serviceAccountId);
      const origin: EventOrigin = { type: 'connector', serviceAccountId, tenantId };
      return { origin, id: (await services.withOrigin(origin).integrationSettings.getConnectorId(integration))! };
    };
    ({ origin: defenderOrigin, id: defenderId } = await connectorOf('microsoft_graph'));
    ({ origin: openaevOrigin, id: openaevId } = await connectorOf('openaev'));
  });

  describe('over a finding the sync reports exposed', () => {
    let assetId: string;
    let cveId: string;
    let enumeratedAt: Date;

    beforeEach(async () => {
      assetId = await asset();
      cveId = await insertCve();
      await services.withOrigin(defenderOrigin).supportingAssets.bulkUpsertEvidence([report('defender', assetId, cveId)]);
      await pause();
      enumeratedAt = new Date();
    });

    it('should leave it exposed with no closing row when the sync commits first', async () => {
      await overlappingWrites(
        (tx) => openaevSync(tx, [report('openaev', assetId, cveId)]),
        (tx) => defenderRetirement(tx, assetId, enumeratedAt),
      );

      const finding = await findingOf(assetId, cveId);
      expect(finding.state).toBe('applicable');
      expect(await historyOf(finding.id)).toEqual([{ state: 'applicable', origin: 'exposed' }]);
    });

    it('should reopen it as the sync commits after the retirement, as the two run one after the other', async () => {
      await overlappingWrites(
        (tx) => defenderRetirement(tx, assetId, enumeratedAt),
        (tx) => openaevSync(tx, [report('openaev', assetId, cveId)]),
      );

      const finding = await findingOf(assetId, cveId);
      expect(finding.state).toBe('applicable');
      expect(await historyOf(finding.id)).toEqual([
        { state: 'applicable', origin: 'exposed' },
        { state: 'dismissed', origin: 'no_longer_reported' },
        { state: 'applicable', origin: 'exposed' },
      ]);
    });
  });

  it('should not deadlock with a sync whose batch lists the findings in the opposite order', async () => {
    // Created in this order, so that `low` sorts before `high` and the asset before the other one.
    const assetId = await asset();
    const otherAssetId = await asset();
    const [low, high, other] = [await insertCve(), await insertCve(), await insertCve()];
    await services.withOrigin(defenderOrigin).supportingAssets.bulkUpsertEvidence([
      report('defender', assetId, low), report('defender', assetId, high),
    ]);
    await services.withOrigin(openaevOrigin).supportingAssets.bulkUpsertEvidence([report('openaev', otherAssetId, other)]);
    await pause();
    const enumeratedAt = new Date();

    // A writer holding the other asset's finding, which the sync reaches between `high` and `low`
    // if it locks in the order it lists them, and last if it sorts them.
    let releaseHolder!: () => void;
    const holderReleased = new Promise<void>((resolve) => {
      releaseHolder = resolve;
    });
    let holderPid!: number;
    let holderLocked!: () => void;
    const locked = new Promise<void>((resolve) => {
      holderLocked = resolve;
    });
    const holder = db.transaction(async (tx) => {
      holderPid = await backendPid(tx);
      await supportingAssetsRepository.lockFindingsOnAssets(repositoryContextOf(tx, openaevOrigin), [otherAssetId]);
      holderLocked();
      await holderReleased;
    });
    await locked;

    let syncPid: number | undefined;
    const sync = db.transaction(async (tx) => {
      syncPid = await backendPid(tx);
      await openaevSync(tx, [report('openaev', assetId, high), report('openaev', otherAssetId, other), report('openaev', assetId, low)]);
    });

    // Every transaction this test started settles before it ends, even when a wait times out:
    // one left open would hold its locks against the next test's reset.
    let retirement: Promise<void> | undefined;
    try {
      await untilBlockedOn(() => syncPid, holderPid);
      let retirementPid: number | undefined;
      retirement = db.transaction(async (tx) => {
        retirementPid = await backendPid(tx);
        await defenderRetirement(tx, assetId, enumeratedAt);
      });
      await untilBlockedOn(() => retirementPid, syncPid!);
    } finally {
      releaseHolder();
      await Promise.allSettled([holder, sync, retirement]);
    }

    await expect(Promise.all([holder, sync, retirement])).resolves.toBeDefined();
    expect((await findingOf(assetId, low)).state).toBe('applicable');
    expect((await findingOf(assetId, high)).state).toBe('applicable');
  });

  describe('in one transaction', () => {
    it('should refuse a retirement pass after a sync batch', async () => {
      const assetId = await asset();
      const cveId = await insertCve();

      await expect(db.transaction(async (tx) => {
        await openaevSync(tx, [report('openaev', assetId, cveId)]);
        await defenderRetirement(tx, assetId, new Date());
      })).rejects.toThrow('A transaction locks findings in one step');
    });

    it('should refuse a retirement pass after a person dismissed a finding', async () => {
      const assetId = await asset();
      const cveId = await insertCve();
      await services.withOrigin(defenderOrigin).supportingAssets.bulkUpsertEvidence([report('defender', assetId, cveId)]);
      const { id: evidenceId } = await findingOf(assetId, cveId);

      await expect(db.transaction(async (tx) => {
        await createTestServices(tx).withOrigin(adminOrigin).supportingAssets.dismissEvidence({
          evidenceId, dismissalType: 'false_positive', reasonCode: 'detection_error', reason: 'Set aside',
        });
        await defenderRetirement(tx, assetId, new Date());
      })).rejects.toThrow('A transaction locks findings in one step');
    });

    it('should refuse a sync batch after a retirement pass that only locked its findings', async () => {
      const assetId = await asset();
      const cveId = await insertCve();
      await services.withOrigin(defenderOrigin).supportingAssets.bulkUpsertEvidence([report('defender', assetId, cveId)]);

      await expect(db.transaction(async (tx) => {
        // Enumerated before the report, so the pass finds nothing to retire and writes no row.
        expect(await defenderRetirement(tx, assetId, new Date(0))).toBe(0);
        await openaevSync(tx, [report('openaev', assetId, cveId)]);
      })).rejects.toThrow('A transaction locks findings in one step');
    });

    it('should refuse a second sync batch', async () => {
      const assetId = await asset();
      const [first, second] = [await insertCve(), await insertCve()];

      await expect(db.transaction(async (tx) => {
        await openaevSync(tx, [report('openaev', assetId, first)]);
        await openaevSync(tx, [report('openaev', assetId, second)]);
      })).rejects.toThrow('A transaction locks findings in one step');
    });
  });

  describe('over more assets than one batch', () => {
    // One more than the pass's batch of assets.
    const ASSET_COUNT = 1_001;
    let assetIds: Array<string>;
    let cveId: string;

    beforeEach(async () => {
      assetIds = Array.from({ length: ASSET_COUNT }, () => uuidv7());
      await db.insert(supportingAssets).values(assetIds.map((id, index) => ({ id, tenantId, name: `host-${index}`, categoryId: 'host' as const })));
      cveId = await insertCve();
      // The pass batches the assets, not their findings: one finding per batch is enough.
      const reportedAssetIds = [assetIds[0], assetIds[ASSET_COUNT - 1]];
      await services.withOrigin(defenderOrigin).supportingAssets.bulkUpsertEvidence(reportedAssetIds.map((id) => report('defender', id, cveId)));
      await pause();
    });

    const retireAll = (svc: ReturnType<typeof services.withOrigin>['supportingAssets']) => svc
      .markAssetsEnumerated({ connectorId: defenderId, supportingAssetIds: assetIds, scope: '', enumeratedAt: new Date() })
      .then(() => svc.recomputeEvidenceStateForAssets({ supportingAssetIds: assetIds, reason: RETIREMENT_REASON }));

    it('should retire every finding, one batch after another', async () => {
      expect(await retireAll(services.withOrigin(defenderOrigin).supportingAssets)).toBe(2);

      const states = await db.select({ state: assetEvidence.currentState }).from(assetEvidence).where(eq(assetEvidence.cveId, cveId));
      expect(states).toEqual([{ state: 'dismissed' }, { state: 'dismissed' }]);
    });

    it('should refuse its second batch inside a caller\'s transaction', async () => {
      await expect(db.transaction((tx) => retireAll(createTestServices(tx).withOrigin(defenderOrigin).supportingAssets)))
        .rejects.toThrow('A transaction locks findings in one step');
    });
  });

  it('should lock findings in the order a sync sorts its batch', async () => {
    const assetId = await asset();
    const cveIds = [await insertCve(), await insertCve()];
    const technique = (techniqueId: string, platformType: string | null, scenarioId: string | null) => ({
      ...report('openaev', assetId, cveIds[0]),
      cveId: null,
      mitreTechniqueId: techniqueId,
      expectationType: 'detection' as const,
      securityPlatformType: platformType,
      sourceScenarioId: scenarioId,
      sourceFindingId: `${techniqueId}:${platformType}:${scenarioId}`,
    });
    // Mixed case, punctuation and nulls: where a collation's order and a byte order part. A
    // character past U+FFFF against one below it: where UTF-16 and UTF-8 orders part.
    const rows = [
      technique(TECHNIQUE_T1003, 'EDR-🛡', 'scenario-c'),
      technique(TECHNIQUE_T1003, 'EDR-Ａ', 'scenario-c'),
      technique(TECHNIQUE_T1003, 'edr', 'scenario-b'),
      technique(TECHNIQUE_T1003, 'EDR', 'scenario-b'),
      technique(TECHNIQUE_T1003, 'a_b', 'scenario-a'),
      technique(TECHNIQUE_T1003, 'ab', 'scenario-a'),
      technique(TECHNIQUE_T1003, 'B', null),
      technique(TECHNIQUE_T1003, null, 'scenario-a'),
      technique(TECHNIQUE_T1003_001, 'EDR', 'Scenario-a'),
      report('openaev', assetId, cveIds[1]),
      report('openaev', assetId, cveIds[0]),
    ];
    await services.withOrigin(openaevOrigin).supportingAssets.bulkUpsertEvidence(rows);

    const stored = await db.select().from(assetEvidence).where(eq(assetEvidence.supportingAssetId, assetId));
    const locked = await db.transaction((tx) => supportingAssetsRepository.lockFindingsOnAssets(repositoryContextOf(tx, openaevOrigin), [assetId]));

    expect(locked.map(({ id }) => id)).toEqual(stored.toSorted(compareFindingKeys).map(({ id }) => id));
  });
});

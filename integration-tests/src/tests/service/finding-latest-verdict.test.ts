import type { EventOrigin } from '@app/module';
import { assetEvidence, assetEvidenceVerdicts, cve, TECHNIQUE_T1003 } from '@app/module';
import { desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantWithAdmin } from '../../helpers/factories';
import { rederiveFindingStates } from '../../helpers/finding-state-rederivation';
import { overlappingWrites } from '../../helpers/overlapping-writes';
import { expectReplayedSyncSilent } from '../../helpers/replayed-sync';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const DAY_MS = 86_400_000;
const NOW = Date.now();
const daysAgo = (days: number) => new Date(NOW - days * DAY_MS);

describe('The stored latest verdict of a finding', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let adminTenantId: string;
  let assetId: string;
  let connectorId: string;

  const insertCve = async (): Promise<string> => {
    const id = uuidv7();
    await db.insert(cve).values([{ id, tenantId: adminTenantId, cveId: `CVE-2026-${id.slice(-6)}` }]);
    return id;
  };

  const finding = async (): Promise<string> => {
    const id = uuidv7();
    await db.insert(assetEvidence).values([{
      id, supportingAssetId: assetId, tenantId: adminTenantId, cveId: await insertCve(), userId: adminUserId,
    }]);
    return id;
  };

  const verdict = (
    evidenceId: string,
    isExposed: boolean,
    observedAt: Date,
    options: { recordedAt?: Date, id?: string, sourceFindingId?: string } = {},
  ) => ({
    id: options.id ?? uuidv7(),
    tenantId: adminTenantId,
    assetEvidenceId: evidenceId,
    connectorId,
    sourceFindingId: options.sourceFindingId ?? 'source-1',
    isExposed,
    observedAt,
    recordedAt: options.recordedAt ?? observedAt,
  });

  const log = (...rows: Array<ReturnType<typeof verdict>>) => db.insert(assetEvidenceVerdicts).values(rows);

  const stored = async (evidenceId: string) => {
    const [row] = await db
      .select({ exposed: assetEvidence.latestVerdictExposed, observedAt: assetEvidence.latestVerdictObservedAt })
      .from(assetEvidence)
      .where(eq(assetEvidence.id, evidenceId));
    return row;
  };

  /** The reading the stored columns stand for, read from the log itself. */
  const latestInLog = async (evidenceId: string) => (await db
    .select({ exposed: assetEvidenceVerdicts.isExposed, observedAt: assetEvidenceVerdicts.observedAt })
    .from(assetEvidenceVerdicts)
    .where(eq(assetEvidenceVerdicts.assetEvidenceId, evidenceId))
    .orderBy(desc(assetEvidenceVerdicts.recordedAt), desc(assetEvidenceVerdicts.observedAt), desc(assetEvidenceVerdicts.id))
    .limit(1))[0];

  const expectFollowsLog = async (evidenceId: string) => {
    expect(await stored(evidenceId)).toEqual(await latestInLog(evidenceId));
  };

  /** One source's report of a finding; a source is a connector's own id for it, and a scenario is a finding of its own. */
  const observation = (isExposed: boolean, evaluatedAt: string, options: { scenario?: string, source?: string } = {}) => ({
    id: uuidv7(), supportingAssetId: assetId, cveId: null, mitreTechniqueId: TECHNIQUE_T1003,
    expectationType: 'detection' as const, isExposed, securityPlatformType: 'SIEM',
    evaluatedAt: new Date(evaluatedAt), connectorId, sourceScenarioId: options.scenario ?? 'scenario-1',
    sourceFindingId: options.source ?? 'source-1',
  });
  const sync = (...rows: Array<ReturnType<typeof observation>>) => services.withOrigin(adminOrigin).supportingAssets.bulkUpsertEvidence(rows);

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    adminTenantId = setup.tenantId;
    assetId = uuidv7();
    await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
      id: assetId, name: 'Host', description: null, ownerId: null, exposure: 'internet_facing', categoryId: 'host',
    });
    const serviceAccountId = uuidv7();
    await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'Test Connector Bot' });
    await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('openaev', serviceAccountId);
    connectorId = (await services.withOrigin(adminOrigin).integrationSettings.getConnectorId('openaev'))!;
  });

  describe('on a verdict', () => {
    it('should stay null while no test has spoken about the finding', async () => {
      const id = await finding();

      expect(await stored(id)).toEqual({ exposed: null, observedAt: null });
    });

    it('should store the first verdict a sync logs', async () => {
      await sync(observation(true, '2026-01-10T00:00:00Z'));

      const [row] = await db.select({ id: assetEvidence.id }).from(assetEvidence).where(isNotNull(assetEvidence.mitreTechniqueId));

      expect(await stored(row.id)).toEqual({ exposed: true, observedAt: new Date('2026-01-10T00:00:00Z') });
      await expectFollowsLog(row.id);
    });

    it('should follow a changed verdict', async () => {
      await sync(observation(true, '2026-01-10T00:00:00Z'));
      const [row] = await db.select({ id: assetEvidence.id }).from(assetEvidence).where(isNotNull(assetEvidence.mitreTechniqueId));

      await sync(observation(false, '2026-01-12T00:00:00Z'));

      expect(await stored(row.id)).toEqual({ exposed: false, observedAt: new Date('2026-01-12T00:00:00Z') });
      await expectFollowsLog(row.id);
    });

    it('should keep the current verdict when a late observation arrives', async () => {
      await sync(observation(true, '2026-01-10T00:00:00Z'));
      const [row] = await db.select({ id: assetEvidence.id }).from(assetEvidence).where(isNotNull(assetEvidence.mitreTechniqueId));
      await sync(observation(false, '2026-01-12T00:00:00Z'));

      await sync(observation(true, '2026-01-05T00:00:00Z'));

      expect(await stored(row.id)).toEqual({ exposed: false, observedAt: new Date('2026-01-12T00:00:00Z') });
      await expectFollowsLog(row.id);
    });

    it('should follow the verdict delivered last when several sources report one finding', async () => {
      await sync(observation(true, '2026-01-10T00:00:00Z', { source: 'source-a' }));
      const [row] = await db.select({ id: assetEvidence.id }).from(assetEvidence).where(isNotNull(assetEvidence.mitreTechniqueId));

      await sync(observation(false, '2026-01-20T00:00:00Z', { source: 'source-b' }));
      expect(await stored(row.id)).toEqual({ exposed: false, observedAt: new Date('2026-01-20T00:00:00Z') });

      await sync(observation(true, '2026-01-01T00:00:00Z', { source: 'source-c' }));
      expect(await stored(row.id)).toEqual({ exposed: true, observedAt: new Date('2026-01-01T00:00:00Z') });
      await expectFollowsLog(row.id);
    });

    it('should order by delivery, then by test date, then by id', async () => {
      const id = await finding();
      const delivered = daysAgo(2);

      await log(verdict(id, true, daysAgo(9), { recordedAt: delivered }));
      await log(verdict(id, false, daysAgo(30), { recordedAt: daysAgo(3) }));
      expect(await stored(id)).toEqual({ exposed: true, observedAt: daysAgo(9) });

      await log(verdict(id, false, daysAgo(10), { recordedAt: delivered }));
      expect(await stored(id)).toEqual({ exposed: true, observedAt: daysAgo(9) });

      const tied = { recordedAt: delivered };
      const [low, high] = ['00000000-0000-7000-8000-000000000001', 'ffffffff-ffff-7fff-bfff-ffffffffffff'];
      await log(verdict(id, false, daysAgo(5), { ...tied, id: high }), verdict(id, true, daysAgo(5), { ...tied, id: low }));
      expect(await stored(id)).toEqual({ exposed: false, observedAt: daysAgo(5) });
      await expectFollowsLog(id);
    });

    it('should refresh every finding one statement of verdicts touches', async () => {
      const [first, second, untouched] = [await finding(), await finding(), await finding()];

      await log(
        verdict(first, true, daysAgo(4)),
        verdict(first, false, daysAgo(2)),
        verdict(second, true, daysAgo(3)),
      );

      expect(await stored(first)).toEqual({ exposed: false, observedAt: daysAgo(2) });
      expect(await stored(second)).toEqual({ exposed: true, observedAt: daysAgo(3) });
      expect(await stored(untouched)).toEqual({ exposed: null, observedAt: null });
    });
  });

  describe('on two overlapping writers', () => {
    it('should not let an older verdict overwrite a newer one still uncommitted beside it', async () => {
      const id = await finding();

      await overlappingWrites(
        (tx) => tx.insert(assetEvidenceVerdicts).values([verdict(id, false, daysAgo(1))]),
        (tx) => tx.insert(assetEvidenceVerdicts).values([verdict(id, true, daysAgo(5), { sourceFindingId: 'source-2' })]),
      );

      expect(await stored(id)).toEqual({ exposed: false, observedAt: daysAgo(1) });
      await expectFollowsLog(id);
    });
  });

  describe('on a replayed sync', () => {
    it('should ring nothing and move no row when the verdicts are the same', async () => {
      await sync(observation(true, '2026-01-10T00:00:00Z'), observation(false, '2026-01-10T00:00:00Z', { scenario: 'scenario-2', source: 'source-2' }));

      await expectReplayedSyncSilent(() => sync(
        observation(true, '2026-01-10T00:00:00Z'),
        observation(false, '2026-01-10T00:00:00Z', { scenario: 'scenario-2', source: 'source-2' }),
      ));
    });
  });

  describe('as re-derived from the logs', () => {
    it('should rebuild every stored verdict from the log, and leave a finding with none null', async () => {
      const [spoken, silent, changed] = [await finding(), await finding(), await finding()];
      await log(
        verdict(spoken, true, daysAgo(6)),
        verdict(changed, true, daysAgo(8)),
        verdict(changed, false, daysAgo(2)),
      );
      await db.update(assetEvidence)
        .set({ latestVerdictExposed: true, latestVerdictObservedAt: new Date(0) })
        .where(inArray(assetEvidence.id, [spoken, changed]));

      await db.execute(rederiveFindingStates);

      expect(await stored(spoken)).toEqual({ exposed: true, observedAt: daysAgo(6) });
      expect(await stored(changed)).toEqual({ exposed: false, observedAt: daysAgo(2) });
      expect(await stored(silent)).toEqual({ exposed: null, observedAt: null });
    });
  });
});

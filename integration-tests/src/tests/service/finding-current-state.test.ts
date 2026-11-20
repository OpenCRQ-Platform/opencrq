import type { AffectedAssetSortKey, EventOrigin } from '@app/module';
import { assetEvidence, assetEvidenceHistory, cve, TECHNIQUE_T1003 } from '@app/module';
import { desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { rederiveFindingStates } from '../../helpers/finding-state-rederivation';
import { overlappingWrites } from '../../helpers/overlapping-writes';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const DAY_MS = 86_400_000;
// One instant for the whole file, so two calls for the same day name the same date.
const NOW = Date.now();
const daysAgo = (days: number) => new Date(NOW - days * DAY_MS);

describe('The stored current state of a finding', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let adminTenantId: string;
  let assetId: string;

  const asset = async (origin: EventOrigin = adminOrigin): Promise<string> => {
    const id = uuidv7();
    await services.withOrigin(origin).supportingAssets.createSupportingAsset({
      id, name: `Host ${id.slice(-6)}`, description: null, ownerId: null, exposure: 'internet_facing', categoryId: 'host',
    });
    return id;
  };

  const insertCve = async (tenantId: string = adminTenantId): Promise<string> => {
    const id = uuidv7();
    await db.insert(cve).values([{ id, tenantId, cveId: `CVE-2026-${id.slice(-6)}` }]);
    return id;
  };

  /** A finding no history speaks for: what a hand-built row or a lost history leaves. */
  const bareFinding = async (
    options: { supportingAssetId?: string, tenantId?: string, createdAt?: Date } = {},
  ): Promise<string> => {
    const id = uuidv7();
    const tenantId = options.tenantId ?? adminTenantId;
    await db.insert(assetEvidence).values([{
      id,
      supportingAssetId: options.supportingAssetId ?? assetId,
      tenantId,
      cveId: await insertCve(tenantId),
      userId: adminUserId,
      ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    }]);
    return id;
  };

  const attached = async (): Promise<string> => {
    const id = uuidv7();
    await services.withOrigin(adminOrigin).supportingAssets.createEvidence({
      id, supportingAssetId: assetId, cveId: await insertCve(), userId: adminUserId,
    });
    return id;
  };

  const history = (
    evidenceId: string,
    state: 'applicable' | 'dismissed',
    stateChangedAt: Date,
    options: { observedAt?: Date | null, origin?: 'user' | 'exposed' | 'not_exposed', tenantId?: string } = {},
  ) => ({
    id: uuidv7(),
    tenantId: options.tenantId ?? adminTenantId,
    assetEvidenceId: evidenceId,
    state,
    stateChangedAt,
    observedAt: options.observedAt ?? null,
    origin: options.origin ?? 'user',
  } as const);

  const record = (...rows: Array<ReturnType<typeof history>>) => db.insert(assetEvidenceHistory).values(rows);

  const stored = async (evidenceId: string) => {
    const [row] = await db
      .select({
        state: assetEvidence.currentState,
        changedAt: assetEvidence.currentStateChangedAt,
        since: assetEvidence.currentStateSince,
        createdAt: assetEvidence.createdAt,
      })
      .from(assetEvidence)
      .where(eq(assetEvidence.id, evidenceId));
    return row;
  };

  /** The reading the stored columns stand for: the latest row by date then id, read from the history itself. */
  const latestHistoryRow = async (evidenceId: string) => (await db
    .select({ state: assetEvidenceHistory.state, changedAt: assetEvidenceHistory.stateChangedAt })
    .from(assetEvidenceHistory)
    .where(eq(assetEvidenceHistory.assetEvidenceId, evidenceId))
    .orderBy(desc(assetEvidenceHistory.stateChangedAt), desc(assetEvidenceHistory.id))
    .limit(1))[0];

  /** The date the writer gave its row, which the stored state must carry as is. */
  const writtenAt = async (evidenceId: string) => (await latestHistoryRow(evidenceId)).changedAt;

  const expectFollowsHistory = async (evidenceId: string) => {
    const [row, latest] = [await stored(evidenceId), await latestHistoryRow(evidenceId)];
    expect([row.state, row.changedAt]).toEqual([latest.state, latest.changedAt]);
  };

  const dismiss = (evidenceId: string) => services.withOrigin(adminOrigin).supportingAssets.dismissEvidence({
    evidenceId, dismissalType: 'false_positive', reasonCode: 'detection_error', reason: 'Set aside', changedByUserId: adminUserId,
  });

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    adminTenantId = setup.tenantId;
    assetId = await asset();
  });

  describe('on a decision', () => {
    it('should store applicable, dated by the first history row, on a finding just created', async () => {
      const id = await attached();

      const row = await stored(id);

      expect(row.state).toBe('applicable');
      await expectFollowsHistory(id);
      expect(row.since).toEqual(row.changedAt);
    });

    it('should date a finding no history speaks for by its creation, from the moment it is inserted', async () => {
      const createdAt = daysAgo(20);

      const id = await bareFinding({ createdAt });

      expect(await stored(id)).toMatchObject({ state: 'applicable', changedAt: createdAt, since: createdAt });
    });

    it('should store a dismissal at once, in the transaction of its history row', async () => {
      const id = await attached();

      await dismiss(id);
      const stateChangedAt = await writtenAt(id);

      expect(await stored(id)).toMatchObject({ state: 'dismissed', changedAt: stateChangedAt, since: stateChangedAt });
    });

    it('should start a new stretch when a dismissed finding is reopened', async () => {
      const id = await attached();
      await dismiss(id);
      const dismissedAt = await writtenAt(id);

      await services.withOrigin(adminOrigin).supportingAssets.markEvidenceApplicable({
        evidenceId: id, changedByUserId: adminUserId,
      });
      const reopenedAt = await writtenAt(id);

      expect(reopenedAt.getTime()).toBeGreaterThanOrEqual(dismissedAt.getTime());
      expect(await stored(id)).toMatchObject({ state: 'applicable', changedAt: reopenedAt, since: reopenedAt });
    });

    it('should continue the stretch when only the cause changes', async () => {
      const id = await attached();
      await dismiss(id);
      const firstDismissal = await writtenAt(id);
      const later = new Date(firstDismissal.getTime() + 1000);

      await record(history(id, 'dismissed', later, { origin: 'not_exposed' }));

      expect(await stored(id)).toMatchObject({ state: 'dismissed', changedAt: later, since: firstDismissal });
    });

    it('should date the stretch by the test, never before the row it follows', async () => {
      const id = await bareFinding();
      await record(history(id, 'applicable', new Date('2026-01-02T00:00:00Z'), { observedAt: new Date('2026-01-01T00:00:00Z'), origin: 'exposed' }));

      await record(history(id, 'dismissed', new Date('2026-01-10T00:00:00Z'), { observedAt: new Date('2026-01-05T00:00:00Z'), origin: 'not_exposed' }));
      expect((await stored(id)).since).toEqual(new Date('2026-01-05T00:00:00Z'));

      const early = await bareFinding();
      await record(
        history(early, 'applicable', new Date('2026-01-02T00:00:00Z'), { origin: 'exposed' }),
        history(early, 'dismissed', new Date('2026-01-10T00:00:00Z'), { observedAt: new Date('2026-01-01T00:00:00Z'), origin: 'not_exposed' }),
      );
      expect((await stored(early)).since).toEqual(new Date('2026-01-02T00:00:00Z'));
    });
  });

  describe('on a history row dated before the latest', () => {
    it('should not let a backdated row overwrite a newer state', async () => {
      const id = await attached();
      await dismiss(id);
      const dismissedAt = await writtenAt(id);

      await record(history(id, 'applicable', daysAgo(3), { origin: 'exposed' }));

      expect(await stored(id)).toMatchObject({ state: 'dismissed', changedAt: dismissedAt, since: dismissedAt });
    });

    it('should place a backdated row inside the history when it opens a stretch', async () => {
      const id = await bareFinding();
      await record(
        history(id, 'applicable', daysAgo(10), { origin: 'exposed' }),
        history(id, 'dismissed', daysAgo(2), { origin: 'not_exposed' }),
      );
      const before = await stored(id);

      await record(history(id, 'dismissed', daysAgo(5), { origin: 'not_exposed' }));

      expect(await stored(id)).toMatchObject({ state: 'dismissed', changedAt: before.changedAt, since: daysAgo(5) });
    });

    it('should follow the history through a connector\'s sync, a person\'s reopening and a late test', async () => {
      const serviceAccountId = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'Test Connector Bot' });
      await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('openaev', serviceAccountId);
      const connectorId = (await services.withOrigin(adminOrigin).integrationSettings.getConnectorId('openaev'))!;
      const observation = (isExposed: boolean, evaluatedAt: string) => ({
        id: uuidv7(), supportingAssetId: assetId, cveId: null, mitreTechniqueId: TECHNIQUE_T1003,
        expectationType: 'detection' as const, isExposed, securityPlatformType: 'SIEM',
        evaluatedAt: new Date(evaluatedAt), connectorId, sourceScenarioId: 'scenario-1', sourceFindingId: 'scenario-scenario-1',
      });
      const sync = (...rows: Array<ReturnType<typeof observation>>) => services.withOrigin(adminOrigin).supportingAssets.bulkUpsertEvidence(rows);

      await sync(observation(true, '2026-01-10T00:00:00Z'));
      const [finding] = await db.select({ id: assetEvidence.id }).from(assetEvidence).where(isNotNull(assetEvidence.mitreTechniqueId));
      expect((await stored(finding.id)).state).toBe('applicable');
      await sync(observation(false, '2026-01-12T00:00:00Z'));
      expect((await stored(finding.id)).state).toBe('dismissed');
      await expectFollowsHistory(finding.id);

      await services.withOrigin(adminOrigin).supportingAssets.markEvidenceApplicable({ evidenceId: finding.id, changedByUserId: adminUserId });
      const stateChangedAt = await writtenAt(finding.id);
      await sync(observation(false, '2026-01-05T00:00:00Z'));

      expect(await stored(finding.id)).toMatchObject({ state: 'applicable', changedAt: stateChangedAt });
      await expectFollowsHistory(finding.id);
    });
  });

  describe('on the deletion of a history row', () => {
    it('should fall back to the row before when the latest goes', async () => {
      const id = await bareFinding();
      const dismissal = history(id, 'dismissed', daysAgo(1), { origin: 'not_exposed' });
      await record(history(id, 'applicable', daysAgo(5), { origin: 'exposed' }), dismissal);
      expect((await stored(id)).state).toBe('dismissed');

      await db.delete(assetEvidenceHistory).where(eq(assetEvidenceHistory.id, dismissal.id));

      expect(await stored(id)).toMatchObject({ state: 'applicable', changedAt: daysAgo(5), since: daysAgo(5) });
    });

    it('should leave a row that is not the latest alone when it goes', async () => {
      const id = await bareFinding();
      const opening = history(id, 'applicable', daysAgo(5), { origin: 'exposed' });
      await record(opening, history(id, 'dismissed', daysAgo(1), { origin: 'not_exposed' }));

      await db.delete(assetEvidenceHistory).where(eq(assetEvidenceHistory.id, opening.id));

      expect(await stored(id)).toMatchObject({ state: 'dismissed', changedAt: daysAgo(1), since: daysAgo(1) });
    });

    it('should read the defaults, dated by its creation, once no history is left', async () => {
      const createdAt = daysAgo(20);
      const id = await bareFinding({ createdAt });
      await record(history(id, 'dismissed', daysAgo(2), { origin: 'not_exposed' }));
      expect((await stored(id)).state).toBe('dismissed');

      await db.delete(assetEvidenceHistory).where(eq(assetEvidenceHistory.assetEvidenceId, id));

      expect(await stored(id)).toMatchObject({ state: 'applicable', changedAt: createdAt, since: createdAt });
    });
  });

  describe('on two overlapping writers', () => {
    it('should keep the stretch the first of two overlapping dismissals opened', async () => {
      const id = await bareFinding();
      await record(history(id, 'applicable', daysAgo(10), { origin: 'exposed' }));
      const first = history(id, 'dismissed', daysAgo(3), { origin: 'not_exposed' });
      const second = history(id, 'dismissed', daysAgo(2), { origin: 'not_exposed' });

      await overlappingWrites(
        (tx) => tx.insert(assetEvidenceHistory).values([first]),
        (tx) => tx.insert(assetEvidenceHistory).values([second]),
      );

      expect(await stored(id)).toMatchObject({ state: 'dismissed', changedAt: daysAgo(2), since: daysAgo(3) });
      await expectFollowsHistory(id);
    });

    it('should not let a writer deleting the latest row undo one inserting a later one', async () => {
      const id = await bareFinding();
      const opening = history(id, 'applicable', daysAgo(10), { origin: 'exposed' });
      const dismissal = history(id, 'dismissed', daysAgo(5), { origin: 'not_exposed' });
      await record(opening, dismissal);
      const reopening = history(id, 'applicable', daysAgo(1), { origin: 'user' });

      await overlappingWrites(
        (tx) => tx.insert(assetEvidenceHistory).values([reopening]),
        (tx) => tx.delete(assetEvidenceHistory).where(eq(assetEvidenceHistory.id, dismissal.id)),
      );

      expect(await stored(id)).toMatchObject({ state: 'applicable', changedAt: daysAgo(1), since: daysAgo(10) });
      await expectFollowsHistory(id);
    });
  });

  describe('on one statement', () => {
    it('should refresh every finding a batch of history rows touches', async () => {
      const [dismissed, open, twice] = [await bareFinding(), await bareFinding(), await bareFinding()];

      await record(
        history(dismissed, 'dismissed', daysAgo(1), { origin: 'not_exposed' }),
        history(open, 'applicable', daysAgo(1), { origin: 'exposed' }),
        history(twice, 'dismissed', daysAgo(4), { origin: 'not_exposed' }),
        history(twice, 'applicable', daysAgo(3), { origin: 'exposed' }),
        history(twice, 'dismissed', daysAgo(2), { origin: 'not_exposed' }),
      );

      expect((await stored(dismissed)).state).toBe('dismissed');
      expect((await stored(open)).state).toBe('applicable');
      expect(await stored(twice)).toMatchObject({ state: 'dismissed', changedAt: daysAgo(2), since: daysAgo(2) });
    });

    it('should refresh each tenant\'s findings and no other', async () => {
      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };
      const otherAsset = await asset(otherOrigin);
      const mine = await bareFinding();
      const theirs = await bareFinding({ supportingAssetId: otherAsset, tenantId: otherTenantId });
      const untouched = await bareFinding();

      await record(
        history(mine, 'dismissed', daysAgo(1), { origin: 'not_exposed' }),
        history(theirs, 'dismissed', daysAgo(1), { origin: 'not_exposed', tenantId: otherTenantId }),
      );

      expect((await stored(mine)).state).toBe('dismissed');
      expect((await stored(theirs)).state).toBe('dismissed');
      expect((await stored(untouched)).state).toBe('applicable');
    });
  });

  describe('as re-derived from the logs', () => {
    it('should rebuild every stored state from the history, and a finding with none from its creation', async () => {
      const createdAt = daysAgo(40);
      const ids = {
        none: await bareFinding({ createdAt }),
        dismissed: await bareFinding(),
        reopened: await bareFinding(),
      };
      await record(
        history(ids.dismissed, 'applicable', daysAgo(9), { origin: 'exposed' }),
        history(ids.dismissed, 'dismissed', daysAgo(6), { origin: 'not_exposed' }),
        history(ids.reopened, 'dismissed', daysAgo(8), { origin: 'not_exposed' }),
        history(ids.reopened, 'applicable', daysAgo(4), { origin: 'user' }),
      );

      await db.update(assetEvidence)
        .set({ currentState: 'dismissed', currentStateChangedAt: new Date(0), currentStateSince: new Date(0) })
        .where(inArray(assetEvidence.id, Object.values(ids)));
      await db.execute(rederiveFindingStates);

      expect(await stored(ids.none)).toMatchObject({ state: 'applicable', changedAt: createdAt, since: createdAt });
      expect(await stored(ids.dismissed)).toMatchObject({ state: 'dismissed', changedAt: daysAgo(6), since: daysAgo(6) });
      expect(await stored(ids.reopened)).toMatchObject({ state: 'applicable', changedAt: daysAgo(4), since: daysAgo(4) });
    });
  });

  describe('as the triggers and the re-derivation agree', () => {
    it('should leave unchanged what the triggers stored, whatever the history they were fed', async () => {
      const [mixed, backdated, shortened, none] = [await bareFinding(), await bareFinding(), await bareFinding(), await bareFinding()];
      await record(
        history(mixed, 'applicable', daysAgo(9), { origin: 'exposed' }),
        history(mixed, 'dismissed', daysAgo(6), { observedAt: daysAgo(7), origin: 'not_exposed' }),
        history(mixed, 'applicable', daysAgo(4), { origin: 'user' }),
      );
      await record(history(mixed, 'dismissed', daysAgo(2), { origin: 'not_exposed' }));
      await record(history(mixed, 'dismissed', daysAgo(1), { origin: 'user' }));
      await record(history(backdated, 'dismissed', daysAgo(2), { origin: 'not_exposed' }));
      await record(history(backdated, 'applicable', daysAgo(8), { observedAt: daysAgo(9), origin: 'exposed' }));
      const latest = history(shortened, 'dismissed', daysAgo(1), { origin: 'not_exposed' });
      await record(history(shortened, 'applicable', daysAgo(5), { origin: 'exposed' }), latest);
      await db.delete(assetEvidenceHistory).where(eq(assetEvidenceHistory.id, latest.id));
      const ids = [mixed, backdated, shortened, none];
      const triggered = await Promise.all(ids.map(stored));

      await db.execute(rederiveFindingStates);

      expect(await Promise.all(ids.map(stored))).toEqual(triggered);
    });
  });

  describe('as the affected assets are listed in state order', () => {
    const FLAW_ASSETS = 5;
    let cveRef: string;
    let cveTextId: string;

    beforeEach(async () => {
      cveRef = await insertCve();
      [{ cveId: cveTextId }] = await db.select({ cveId: cve.cveId }).from(cve).where(eq(cve.id, cveRef));
      const evidenceIds: Array<string> = [];
      for (let i = 0; i < FLAW_ASSETS; i += 1) {
        const id = uuidv7();
        await services.withOrigin(adminOrigin).supportingAssets.createEvidence({
          id, supportingAssetId: await asset(), cveId: cveRef, userId: adminUserId,
        });
        evidenceIds.push(id);
      }
      await dismiss(evidenceIds[1]);
      await dismiss(evidenceIds[3]);
    });

    const walk = async (sortBy: AffectedAssetSortKey, sortDesc: boolean): Promise<Array<string>> => {
      const ids: Array<string> = [];
      for (let page = 1; page <= FLAW_ASSETS; page += 1) {
        const { items } = await services.withOrigin(adminOrigin).supportingAssets.listAffectedAssets({
          flaw: { cveId: cveTextId }, page, limit: 2, sortBy, sortDesc,
        });
        ids.push(...items.map((item) => item.evidenceId));
      }
      return ids;
    };

    const storedOrder = async (column: 'state' | 'changedAt', sortDesc: boolean): Promise<Array<string>> => {
      const rows = await db
        .select({ id: assetEvidence.id, state: assetEvidence.currentState, changedAt: assetEvidence.currentStateChangedAt })
        .from(assetEvidence)
        .where(eq(assetEvidence.cveId, cveRef));
      const key = (row: (typeof rows)[number]) => (column === 'state' ? row.state : row.changedAt.toISOString());
      const sorted = rows.toSorted((a, b) => key(a).localeCompare(key(b)) || a.id.localeCompare(b.id));
      return (sortDesc ? sorted.toReversed() : sorted).map((row) => row.id);
    };

    it.each([
      ['currentState', 'state', false],
      ['currentState', 'state', true],
      ['stateChangedAt', 'changedAt', false],
      ['stateChangedAt', 'changedAt', true],
    ] as const)('should page %s (descending: %s) through every finding once, in the stored order', async (sortBy, column, sortDesc) => {
      const walked = await walk(sortBy, sortDesc);

      expect(walked).toHaveLength(FLAW_ASSETS);
      expect(new Set(walked).size).toBe(FLAW_ASSETS);
      expect(walked).toEqual(await storedOrder(column, sortDesc));
    });
  });
});

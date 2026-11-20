import type { EventOrigin } from '@app/module';
import { assetEvidence, cve, findingMetricDaily, findingScoreHistory, findingScores, utcDayOf } from '@app/module';
import { and, asc, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { MAXIMAL_CVSS_VECTOR } from '../../helpers/finding-score-fixtures';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): Date => new Date(Date.now() - days * DAY_MS);

describe('Finding score history and daily metrics', () => {
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

  const createFinding = async (
    name: string,
    signals: { epss?: number, kev?: boolean } = {},
    origin: EventOrigin = adminOrigin,
    ownerTenantId: string = tenantId,
  ): Promise<string> => {
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
    const cveRowId = uuidv7();
    created += 1;
    await db.insert(cve).values([{
      id: cveRowId,
      tenantId: ownerTenantId,
      cveId: `CVE-2026-${String(created).padStart(4, '0')}`,
      cvssVector: MAXIMAL_CVSS_VECTOR,
      epss: signals.epss ?? 0.4,
      kev: signals.kev ?? null,
      kevUpdatedAt: signals.kev ? new Date() : null,
    }]);
    const evidenceId = uuidv7();
    await db.insert(assetEvidence).values([{
      id: evidenceId, supportingAssetId: assetId, tenantId: ownerTenantId, cveId: cveRowId,
    }]);
    return evidenceId;
  };

  const recompute = (origin: EventOrigin = adminOrigin, scoreHistoryRetentionDays?: number) =>
    services.withOrigin(origin).findingScore.recomputeFindingScores(
      scoreHistoryRetentionDays === undefined ? {} : { scoreHistoryRetentionDays },
    );

  const journalOf = (evidenceId: string) => db
    .select()
    .from(findingScoreHistory)
    .where(eq(findingScoreHistory.assetEvidenceId, evidenceId))
    .orderBy(asc(findingScoreHistory.changedAt));

  describe('the journal', () => {
    it('should record the score a finding is first computed at', async () => {
      const evidenceId = await createFinding('Edge gateway');

      await recompute();

      const [projected] = await db.select().from(findingScores).where(eq(findingScores.assetEvidenceId, evidenceId));
      const lines = await journalOf(evidenceId);
      expect(lines).toHaveLength(1);
      expect(lines[0].score).toBe(projected.score);
      expect(lines[0].band).toBe(projected.band);
      expect(lines[0].tenantId).toBe(tenantId);
    });

    it('should record a line when the displayed score moves', async () => {
      const evidenceId = await createFinding('Drifting host', { epss: 0.1 });
      await recompute();
      const [before] = await journalOf(evidenceId);

      await db.update(cve).set({ epss: 0.95, kev: true, kevUpdatedAt: new Date() })
        .where(eq(cve.id, (await db.select().from(assetEvidence).where(eq(assetEvidence.id, evidenceId)))[0].cveId!));
      await recompute();

      const lines = await journalOf(evidenceId);
      expect(lines).toHaveLength(2);
      expect(lines[1].score).toBeGreaterThan(before.score!);
    });

    it('should record nothing when only the fractional part of the score moves', async () => {
      const evidenceId = await createFinding('Steady host');
      await recompute();
      const [computed] = await db.select().from(findingScores).where(eq(findingScores.assetEvidenceId, evidenceId));
      // The engine truncates, so a fraction only ever reaches the projection from outside it.
      await db.update(findingScores).set({ score: computed.score! + 0.4 })
        .where(eq(findingScores.assetEvidenceId, evidenceId));

      await recompute();

      expect(await journalOf(evidenceId)).toHaveLength(1);
    });

    it('should record a line when the band moves under an unchanged displayed score', async () => {
      const evidenceId = await createFinding('Rebanded host');
      await recompute();
      const [computed] = await db.select().from(findingScores).where(eq(findingScores.assetEvidenceId, evidenceId));
      await db.update(findingScores).set({ band: computed.band === 'low' ? 'medium' : 'low' })
        .where(eq(findingScores.assetEvidenceId, evidenceId));

      await recompute();

      const lines = await journalOf(evidenceId);
      expect(lines).toHaveLength(2);
      expect(lines[1].band).toBe(computed.band);
    });
  });

  const insertLine = (evidenceId: string, days: number, score: number, owner = tenantId) => db
    .insert(findingScoreHistory)
    .values({
      id: uuidv7(),
      assetEvidenceId: evidenceId,
      tenantId: owner,
      score,
      band: 'medium',
      changedAt: daysAgo(days),
    });

  describe('the retention trim', () => {
    it('should keep twelve months of lines by default', async () => {
      const evidenceId = await createFinding('Charted host');
      await db.delete(findingScoreHistory);
      await insertLine(evidenceId, 500, 41);
      await insertLine(evidenceId, 400, 42);
      await insertLine(evidenceId, 300, 43);
      await insertLine(evidenceId, 200, 44);

      await recompute();

      const lines = await journalOf(evidenceId);
      expect(lines.map((line) => line.score).slice(0, 3)).toEqual([42, 43, 44]);
    });

    it('should keep, for every finding, the value in force when the window opens', async () => {
      const evidenceId = await createFinding('Long lived host');
      await insertLine(evidenceId, 200, 10);
      await insertLine(evidenceId, 150, 20);
      await insertLine(evidenceId, 100, 30);

      await recompute(adminOrigin, 90);

      const lines = await journalOf(evidenceId);
      // The two lines a more recent out-of-window line supersedes are gone; the anchor and the
      // line this run wrote itself remain.
      expect(lines.map((line) => line.score)).toEqual([30, lines.at(-1)!.score]);
      expect(lines).toHaveLength(2);
    });

    it('should keep the only line of a finding whose score has not moved in months', async () => {
      const evidenceId = await createFinding('Frozen host');
      await db.delete(findingScoreHistory);
      await insertLine(evidenceId, 300, 42);

      await recompute(adminOrigin, 90);

      const lines = await journalOf(evidenceId);
      expect(lines.map((line) => line.score)).toContain(42);
    });

    it('should not reach another tenant lines', async () => {
      const other = await secondTenant();
      const otherEvidenceId = await createFinding('Neighbour host', {}, other.origin, other.tenantId);
      await insertLine(otherEvidenceId, 300, 7, other.tenantId);
      await insertLine(otherEvidenceId, 200, 8, other.tenantId);

      await recompute(adminOrigin, 1);

      const lines = await journalOf(otherEvidenceId);
      expect(lines.map((line) => line.score)).toEqual([7, 8]);
    });
  });

  describe('getFindingScoreHistory', () => {
    it('should return the last twelve months led by the line in force when they open', async () => {
      const evidenceId = await createFinding('Charted host');
      await db.delete(findingScoreHistory);
      await insertLine(evidenceId, 450, 20);
      await insertLine(evidenceId, 400, 30);
      await insertLine(evidenceId, 200, 40);
      await insertLine(evidenceId, 10, 60);

      const history = await services.withOrigin(adminOrigin).findingScore.getFindingScoreHistory(evidenceId);

      expect(history.map((line) => line.score)).toEqual([30, 40, 60]);
      expect(history[0].at).toBeInstanceOf(Date);
      expect(history[0].band).toBe('medium');
    });

    it('should return the score truncated, as it is printed', async () => {
      const evidenceId = await createFinding('Fractional host');
      await db.delete(findingScoreHistory);
      await insertLine(evidenceId, 10, 79.53);

      const [line] = await services.withOrigin(adminOrigin).findingScore.getFindingScoreHistory(evidenceId);

      expect(line.score).toBe(79);
    });

    it('should return nothing for a finding with no history', async () => {
      const evidenceId = await createFinding('New host');
      await db.delete(findingScoreHistory);

      expect(await services.withOrigin(adminOrigin).findingScore.getFindingScoreHistory(evidenceId)).toEqual([]);
    });

    it('should never return another tenant history', async () => {
      const evidenceId = await createFinding('Private host');
      await insertLine(evidenceId, 10, 60);
      const other = await secondTenant();

      expect(await services.withOrigin(other.origin).findingScore.getFindingScoreHistory(evidenceId)).toEqual([]);
    });
  });

  describe('the daily band metrics', () => {
    const metricsOf = (owner: string) => db
      .select()
      .from(findingMetricDaily)
      .where(and(eq(findingMetricDaily.tenantId, owner), eq(findingMetricDaily.day, utcDayOf(new Date()))))
      .orderBy(asc(findingMetricDaily.metric));

    it('should write one row per band, a band nobody is in included', async () => {
      await createFinding('Edge gateway', { epss: 0.95, kev: true });
      await recompute();

      const rows = await metricsOf(tenantId);
      expect(rows.map((row) => row.metric)).toEqual(['band_critical', 'band_high', 'band_low', 'band_medium']);
      expect(rows.reduce((total, row) => total + row.value, 0)).toBe(1);
    });

    it('should rewrite the day rather than add rows to it', async () => {
      await createFinding('First host');
      await recompute();

      await createFinding('Second host');
      await recompute();

      const rows = await metricsOf(tenantId);
      expect(rows).toHaveLength(4);
      expect(rows.reduce((total, row) => total + row.value, 0)).toBe(2);
    });

    it('should equal the figure the panel prints', async () => {
      await createFinding('Edge gateway', { epss: 0.95, kev: true });
      await createFinding('Internal box', { epss: 0.05 });
      await recompute();

      const counts = await services.withOrigin(adminOrigin).findingScore.getFindingsPanelCounts();
      const rows = await metricsOf(tenantId);

      const recorded = new Map(rows.map((row) => [row.metric, row.value]));
      counts.bands.forEach((band) => {
        expect(recorded.get(`band_${band.band}`)).toBe(band.total);
      });
    });

    it('should hold one tenant rows apart from another', async () => {
      const other = await secondTenant();
      await createFinding('Mine');
      await createFinding('Theirs', {}, other.origin, other.tenantId);
      await createFinding('Theirs too', {}, other.origin, other.tenantId);
      await recompute();
      await recompute(other.origin);

      const mine = await metricsOf(tenantId);
      const theirs = await metricsOf(other.tenantId);
      expect(mine.reduce((total, row) => total + row.value, 0)).toBe(1);
      expect(theirs.reduce((total, row) => total + row.value, 0)).toBe(2);
    });
  });
});

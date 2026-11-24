import type { EventOrigin } from '@app/module';
import { assetEvidenceSources, assetPostures, cve, cveSourceObservations, findingScoreHistory, findingScores } from '@app/module';
import { asc, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantWithAdmin } from '../../helpers/factories';
import { findingScoreFixtures } from '../../helpers/finding-score-fixtures';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const PUBLISHED_VECTOR = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H';

describe('A finding pending a vector', () => {
  let admin: { origin: EventOrigin, tenantId: string, userId: string };
  const fixtures = findingScoreFixtures(services, db, () => admin);
  let created = 0;

  beforeEach(async () => {
    await truncateAllTables(db);
    created = 0;
    admin = await createTenantWithAdmin(services);
  });

  const read = () => services.withOrigin(admin.origin).findingScore;

  /** A CVE on a domain controller, with no vector nor CVSS unless given. */
  const findingOn = async (published: { cvssVector?: string, cvss?: number } = {}): Promise<{ evidenceId: string, cveRowId: string, assetId: string }> => {
    created += 1;
    const assetId = await fixtures.createAsset(`dc-${created}`, { exposure: 'internal', criticality: 'very_high' });
    const cveRowId = uuidv7();
    await db.insert(cve).values([{
      id: cveRowId,
      tenantId: admin.tenantId,
      cveId: `CVE-2026-9${String(created).padStart(4, '0')}`,
      cvssVector: published.cvssVector ?? null,
      cvss: published.cvss ?? null,
    }]);
    const evidenceId = await fixtures.attachCve(assetId, cveRowId);
    return { evidenceId, cveRowId, assetId };
  };

  const reportSeverity = async (evidenceId: string, reportedSeverity: string): Promise<void> => {
    await db.insert(assetEvidenceSources).values([{
      id: uuidv7(),
      tenantId: admin.tenantId,
      assetEvidenceId: evidenceId,
      connectorId: await fixtures.createConnector(),
      sourceFindingId: `finding-${evidenceId}`,
      reportedSeverity,
    }]);
  };

  const projectionOf = async (evidenceId: string) =>
    (await db.select().from(findingScores).where(eq(findingScores.assetEvidenceId, evidenceId)))[0];

  const journalOf = (evidenceId: string) => db
    .select()
    .from(findingScoreHistory)
    .where(eq(findingScoreHistory.assetEvidenceId, evidenceId))
    .orderBy(asc(findingScoreHistory.changedAt));

  it('should keep a row with no score for a CVE with no vector', async () => {
    const { evidenceId } = await findingOn();

    await read().recomputeFindingScores();

    const row = await projectionOf(evidenceId);
    expect(row).toMatchObject({ score: null, band: null, exploitability: null, impact: null });
    const { items } = await fixtures.listEstate(admin.origin);
    expect(items.map((item) => [item.evidenceId, item.score, item.pendingVector])).toEqual([[evidenceId, null, true]]);
    expect(await journalOf(evidenceId)).toEqual([]);
  });

  it('should leave pending a CVE a source gives a severity and a base score but no vector', async () => {
    const { evidenceId } = await findingOn({ cvss: 7 });
    await reportSeverity(evidenceId, 'High');

    await read().recomputeFindingScores();

    expect((await projectionOf(evidenceId)).score).toBeNull();
  });

  it('should leave pending a CVE whose vector the score cannot read', async () => {
    const { evidenceId } = await findingOn({ cvssVector: 'CVSS:3.1/AV:N/AC:L', cvss: 5 });

    await read().recomputeFindingScores();

    expect((await projectionOf(evidenceId)).score).toBeNull();
  });

  it('should list a pending finding after every scored one, whichever way the score is sorted', async () => {
    const pending = await findingOn();
    const scored = await findingOn({ cvssVector: PUBLISHED_VECTOR });
    await read().recomputeFindingScores();

    for (const sortDesc of [true, false]) {
      const { items } = await read().listScoredFindings({
        page: 1, limit: 50, state: 'applicable', source: null, mappedToOrganizationId: null, sortBy: 'score', sortDesc,
      });
      expect(items.map((item) => item.evidenceId)).toEqual([scored.evidenceId, pending.evidenceId]);
    }
  });

  it('should leave an asset whose only finding is pending with no posture', async () => {
    const { assetId } = await findingOn();

    await read().recomputeFindingScores();

    expect(await read().getAssetPosture(assetId)).toBeNull();
    expect(await db.select().from(assetPostures).where(eq(assetPostures.supportingAssetId, assetId))).toEqual([]);
  });

  it('should count pending findings apart from the severity bands', async () => {
    await findingOn();
    await findingOn({ cvssVector: PUBLISHED_VECTOR });
    await read().recomputeFindingScores();

    const counts = await read().getFindingsPanelCounts();

    expect(counts.findings).toBe(2);
    expect(counts.pendingVector).toBe(1);
    expect(counts.bands.reduce((total, band) => total + band.total, 0)).toBe(1);
  });

  it('should score the finding and journal it once NVD publishes a vector', async () => {
    const { evidenceId, cveRowId } = await findingOn();
    await read().recomputeFindingScores();

    await db.update(cve).set({ cvssVector: PUBLISHED_VECTOR, cvss: 9.8 }).where(eq(cve.id, cveRowId));
    await read().recomputeFindingScores();

    const row = await projectionOf(evidenceId);
    expect(row.score).not.toBeNull();
    const lines = await journalOf(evidenceId);
    expect(lines.map((line) => [line.score, line.band])).toEqual([[row.score, row.band]]);
  });

  it('should journal a null line when a scored finding loses its vector', async () => {
    const { evidenceId, cveRowId } = await findingOn({ cvssVector: PUBLISHED_VECTOR });
    await read().recomputeFindingScores();
    const scored = await projectionOf(evidenceId);

    await db.update(cve).set({ cvssVector: null }).where(eq(cve.id, cveRowId));
    await read().recomputeFindingScores();

    const lines = await journalOf(evidenceId);
    expect(lines.map((line) => line.score)).toEqual([scored.score, null]);
    expect((await read().getFindingScoreHistory(evidenceId)).at(-1)).toMatchObject({ score: null, band: null });
  });

  it('should say why the finding page carries no score', async () => {
    const { evidenceId } = await findingOn();
    await read().recomputeFindingScores();

    const breakdown = await read().getFindingScoreBreakdown(evidenceId);

    expect(breakdown).toMatchObject({ score: null, band: null, pendingVector: true });
  });

  it('should mark the unique finding pending when none of its findings is scored', async () => {
    const { cveRowId } = await findingOn();
    await read().recomputeFindingScores();
    const [cveRow] = await db.select().from(cve).where(eq(cve.id, cveRowId));

    const { items } = await read().listUniqueFindings({
      page: 1, limit: 50, source: null, mappedToOrganizationId: null, sortBy: 'score', sortDesc: true,
    });
    const unique = await read().getUniqueCveFinding({ cveId: cveRow.cveId, mappedToOrganizationId: null });

    expect(items.map((item) => [item.cveId, item.score, item.pendingVector])).toEqual([[cveRow.cveId, null, true]]);
    expect(unique).toMatchObject({ score: null, pendingVector: true });
  });

  describe('once an NVD pass has read its CVE', () => {
    const readByNvd = async (cveRowId: string, reported: boolean) => {
      await db.update(cve).set({ remediationReadAt: new Date() }).where(eq(cve.id, cveRowId));
      if (reported) {
        await db.insert(cveSourceObservations).values([{ id: uuidv7(), tenantId: admin.tenantId, cveId: cveRowId, source: 'nvd' }]);
      }
    };
    const cveIdOf = async (cveRowId: string) => (await db.select({ cveId: cve.cveId }).from(cve).where(eq(cve.id, cveRowId)))[0].cveId;

    it('should tell the lists and the unique finding apart from a vector still to come when NVD holds no record', async () => {
      const unread = await findingOn();
      const noRecord = await findingOn();
      const reported = await findingOn();
      await readByNvd(noRecord.cveRowId, false);
      await readByNvd(reported.cveRowId, true);
      await read().recomputeFindingScores();

      const { items } = await read().listScoredFindings({
        page: 1, limit: 50, state: 'applicable', source: null, mappedToOrganizationId: null, sortBy: 'name', sortDesc: false,
      });
      const unique = await read().listUniqueFindings({
        page: 1, limit: 50, source: null, mappedToOrganizationId: null, sortBy: 'name', sortDesc: false,
      });
      const uniqueNoRecord = await read().getUniqueCveFinding({ cveId: await cveIdOf(noRecord.cveRowId), mappedToOrganizationId: null });

      const missingByEvidence = new Map(items.map((item) => [item.evidenceId, item.nvdRecordMissing]));
      expect([unread, noRecord, reported].map(({ evidenceId }) => missingByEvidence.get(evidenceId))).toEqual([false, true, false]);
      const missingByCve = new Map(unique.items.map((item) => [item.cveId, item.nvdRecordMissing]));
      expect(await Promise.all([unread, noRecord, reported].map(async ({ cveRowId }) => missingByCve.get(await cveIdOf(cveRowId)))))
        .toEqual([false, true, false]);
      expect(uniqueNoRecord).toMatchObject({ pendingVector: true, nvdRecordMissing: true });
    });
  });
});

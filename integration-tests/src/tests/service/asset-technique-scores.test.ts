import type { EventOrigin } from '@app/module';
import { assetTechniqueScores, cve, mitreTechniques, supportingAssetIdentityProperties, supportingAssetSources } from '@app/module';
import { eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const LOG4SHELL_VECTOR = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H';
/** Remote, unauthenticated, no user: full vector access, and T1190 by the topology rule on an exposed asset. */
const openVector = (levels: { c: string, i: string, a: string }) =>
  `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:${levels.c}/I:${levels.i}/A:${levels.a}`;

type Exposure = 'internet_facing' | 'internal' | 'unknown';

describe('Asset technique scores', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;
  let adminUserId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
    adminUserId = setup.userId;
  });

  const createAsset = async (
    origin: EventOrigin,
    options: { exposure?: Exposure, category?: 'web_application' | 'identity' | 'host', subcategory?: 'user_account' | 'workstation' } = {},
  ): Promise<string> => {
    const id = uuidv7();
    await services.withOrigin(origin).supportingAssets.createSupportingAsset({
      id,
      name: `Asset ${id.slice(-6)}`,
      description: null,
      ownerId: null,
      exposure: options.exposure ?? 'internet_facing',
      categoryId: options.category ?? 'web_application',
      subcategoryId: options.subcategory ?? null,
      criticality: 'unknown',
    });
    return id;
  };

  const insertCve = async (
    cveTextId: string,
    signals: { epss?: number, kev?: boolean, vector?: string | null },
    owner: string = tenantId,
  ): Promise<string> => {
    const id = uuidv7();
    await db.insert(cve).values([{
      id,
      tenantId: owner,
      cveId: cveTextId,
      epss: signals.epss ?? null,
      kev: signals.kev ?? null,
      kevUpdatedAt: signals.kev ? new Date() : null,
      cvssVector: signals.vector ?? null,
    }]);
    return id;
  };

  /** Through the service, which is the path that resolves a finding's techniques. */
  const writeFinding = async (supportingAssetId: string, cveRowId: string, origin: EventOrigin = adminOrigin) => {
    const id = uuidv7();
    await services.withOrigin(origin).supportingAssets.createEvidence({ id, supportingAssetId, cveId: cveRowId, userId: adminUserId });
    return id;
  };

  const log4shell = async (owner: string = tenantId) =>
    insertCve('CVE-2021-44228', { epss: 0.976, kev: true, vector: LOG4SHELL_VECTOR }, owner);

  const recomputeAndRead = async (supportingAssetId: string, origin: EventOrigin = adminOrigin) => {
    await services.withOrigin(origin).findingScore.recomputeFindingScores();
    return services.withOrigin(origin).findingScore.getAssetTechniqueScores(supportingAssetId);
  };

  const cellOf = (scores: Awaited<ReturnType<typeof recomputeAndRead>>, externalId: string) =>
    scores.techniques.find((technique) => technique.externalId === externalId);

  it('should score Log4Shell 98 on T1190 on an internet-facing web application', async () => {
    const assetId = await createAsset(adminOrigin);
    const evidenceId = await writeFinding(assetId, await log4shell());

    expect(cellOf(await recomputeAndRead(assetId), 'T1190')).toMatchObject({ score: 98, evidenceId, lane: 'curated' });
  });

  it('should give T1190 no score on the same asset once it is internal', async () => {
    const assetId = await createAsset(adminOrigin, { exposure: 'internal' });
    await writeFinding(assetId, await log4shell());

    expect(cellOf(await recomputeAndRead(assetId), 'T1190')).toBeUndefined();
  });

  it.each([
    ['internal', 'T1210', 'T1190'],
    ['internet_facing', 'T1190', 'T1210'],
  ] as const)('should give an asset of unknown exposure counted as %s the cells of that exposure alone', async (counted, opened, left) => {
    await services.withOrigin(adminOrigin).crqIndicatorSettings.updateCrqIndicatorSettings({ unknownExposureCountsAs: counted });
    const assetId = await createAsset(adminOrigin, { exposure: 'unknown', category: 'host' });
    await writeFinding(assetId, await insertCve('CVE-2099-0103', { vector: openVector({ c: 'H', i: 'H', a: 'H' }) }));

    const scores = await recomputeAndRead(assetId);

    expect(cellOf(scores, opened)).toBeDefined();
    expect(cellOf(scores, left)).toBeUndefined();
  });

  it('should narrow the score by the impact the finding score reads from the vector', async () => {
    const assetId = await createAsset(adminOrigin);
    await writeFinding(assetId, await insertCve('CVE-2099-0102', { epss: 0.9, vector: openVector({ c: 'N', i: 'L', a: 'N' }) }));

    const scores = await recomputeAndRead(assetId);

    expect(cellOf(scores, 'T1190')?.score).toBe(22);
    expect(scores.findings[0]).toMatchObject({ access: 1, threat: 0.9 });
    expect(scores.findings[0].impact).toBeCloseTo(0.22 / (1 - 0.44 ** 3));
  });

  it('should keep a vector claiming no impact at the floor the finding score gives it', async () => {
    const assetId = await createAsset(adminOrigin);
    await writeFinding(assetId, await insertCve('CVE-2099-0101', { epss: 0.9, vector: openVector({ c: 'N', i: 'N', a: 'N' }) }));

    expect(cellOf(await recomputeAndRead(assetId), 'T1190')?.score).toBe(5);
  });

  it('should give the technique to the finding opening it the most, and list only that finding', async () => {
    const assetId = await createAsset(adminOrigin);
    const reader = await writeFinding(assetId, await insertCve('CVE-2099-0103', { epss: 0.9, vector: openVector({ c: 'H', i: 'N', a: 'N' }) }));
    await writeFinding(assetId, await insertCve('CVE-2099-0104', { epss: 0.5, vector: openVector({ c: 'L', i: 'H', a: 'N' }) }));
    await writeFinding(assetId, await insertCve('CVE-2099-0105', { epss: 0.1, vector: openVector({ c: 'L', i: 'L', a: 'N' }) }));

    const scores = await recomputeAndRead(assetId);

    expect(cellOf(scores, 'T1190')).toMatchObject({ score: 55, evidenceId: reader });
    expect(scores.findings.map((finding) => finding.evidenceId)).toEqual([reader]);
  });

  it('should give no score to a finding whose CVE has no readable CVSS vector', async () => {
    const assetId = await createAsset(adminOrigin);
    await writeFinding(assetId, await insertCve('CVE-2021-44228', { epss: 0.976, kev: true, vector: 'AV:N/AC:L/Au:N/C:C/I:C' }));

    expect((await recomputeAndRead(assetId)).techniques).toEqual([]);
  });

  it('should score a finding whose CVE carries only a CVSS 2.0 vector', async () => {
    const assetId = await createAsset(adminOrigin);
    await writeFinding(assetId, await insertCve('CVE-2099-0106', { epss: 0.9, vector: 'AV:N/AC:L/Au:N/C:P/I:N/A:N' }));

    const scores = await recomputeAndRead(assetId);

    expect(cellOf(scores, 'T1190')?.score).toBe(22);
    expect(scores.findings[0]).toMatchObject({ access: 1, threat: 0.9 });
  });

  it('should drop the score of a finding once it is dismissed', async () => {
    const assetId = await createAsset(adminOrigin);
    const evidenceId = await writeFinding(assetId, await log4shell());
    expect(cellOf(await recomputeAndRead(assetId), 'T1190')).toBeDefined();

    await services.withOrigin(adminOrigin).supportingAssets.dismissEvidence({
      evidenceId,
      dismissalType: 'risk_accepted',
      reasonCode: 'wont_fix',
      reason: 'Accepted',
      changedByUserId: adminUserId,
    });

    expect((await recomputeAndRead(assetId)).techniques).toEqual([]);
  });

  it('should give no score to a technique the asset family does not carry', async () => {
    const assetId = await createAsset(adminOrigin, { category: 'identity' });
    await writeFinding(assetId, await log4shell());

    expect(cellOf(await recomputeAndRead(assetId), 'T1190')).toBeUndefined();
  });

  it('should move a score with the finding scores it is recomputed with', async () => {
    const assetId = await createAsset(adminOrigin);
    const cveRowId = await insertCve('CVE-2099-0106', { epss: 0.9, vector: openVector({ c: 'H', i: 'H', a: 'H' }) });
    await writeFinding(assetId, cveRowId);
    expect(cellOf(await recomputeAndRead(assetId), 'T1190')?.score).toBe(90);

    await db.update(cve).set({ epss: 0.4 }).where(eq(cve.id, cveRowId));

    expect(cellOf(await recomputeAndRead(assetId), 'T1190')?.score).toBe(40);
  });

  it('should leave a cell whose score and finding did not move unwritten', async () => {
    const assetId = await createAsset(adminOrigin);
    await writeFinding(assetId, await log4shell());
    await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();
    const rowVersions = async () => (await db.execute<{ version: string }>(
      sql`select xmin::text as version from asset_technique_scores where supporting_asset_id = ${assetId} order by mitre_technique_id`,
    )).rows.map((row) => row.version);
    const before = await rowVersions();

    await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();

    expect(before.length).toBeGreaterThan(0);
    expect(await rowVersions()).toEqual(before);
  });

  it('should clear stale cells past the first page of stored keys', async () => {
    const assetId = await createAsset(adminOrigin);
    const evidenceId = await writeFinding(assetId, await log4shell());
    const held = (await recomputeAndRead(assetId)).techniques.map((technique) => technique.externalId).sort();
    const staleAssetIds = [await createAsset(adminOrigin), await createAsset(adminOrigin)];
    const techniques = await db.select({ id: mitreTechniques.id }).from(mitreTechniques).limit(400);
    await db.insert(assetTechniqueScores).values([assetId, ...staleAssetIds].flatMap((supportingAssetId) => techniques.map(({ id }) => ({
      tenantId,
      supportingAssetId,
      mitreTechniqueId: id,
      score: 1,
      assetEvidenceId: evidenceId,
    })))).onConflictDoNothing();

    expect(held).toContain('T1190');
    expect(techniques.length * 3).toBeGreaterThan(1000);
    expect((await recomputeAndRead(assetId)).techniques.map((technique) => technique.externalId).sort()).toEqual(held);
    for (const staleAssetId of staleAssetIds) {
      expect((await services.withOrigin(adminOrigin).findingScore.getAssetTechniqueScores(staleAssetId)).techniques).toEqual([]);
    }
  });

  it('should never let one tenant read another tenant scores', async () => {
    const assetId = await createAsset(adminOrigin);
    await writeFinding(assetId, await log4shell());
    const otherTenantId = await createTenant(services, adminUserId);
    const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };
    const otherAssetId = await createAsset(otherOrigin);
    await writeFinding(otherAssetId, await log4shell(otherTenantId), otherOrigin);
    await services.withOrigin(otherOrigin).findingScore.recomputeFindingScores();

    expect(cellOf(await recomputeAndRead(assetId), 'T1190')).toBeDefined();
    expect(cellOf(await services.withOrigin(otherOrigin).findingScore.getAssetTechniqueScores(otherAssetId), 'T1190')).toBeDefined();
    expect((await services.withOrigin(otherOrigin).findingScore.getAssetTechniqueScores(assetId)).techniques).toEqual([]);
    expect((await services.withOrigin(adminOrigin).findingScore.getAssetTechniqueScores(otherAssetId)).techniques).toEqual([]);
  });

  describe('the phishing cell of a person', () => {
    const userAccount = async (observations: ReadonlyArray<boolean>): Promise<string> => {
      const id = await createAsset(adminOrigin, { category: 'identity', subcategory: 'user_account', exposure: 'unknown' });
      for (const [index, isEnabled] of observations.entries()) {
        const sourceId = uuidv7();
        await db.insert(supportingAssetSources).values({
          id: sourceId, supportingAssetId: id, tenantId, sourceAssetId: `${id}-${index}`, reportedCategoryId: 'identity',
        });
        await db.insert(supportingAssetIdentityProperties).values({ id: sourceId, supportingAssetSourceId: sourceId, tenantId, isEnabled });
      }
      return id;
    };

    it('should read the default susceptibility of an enabled user account, then the declared rate', async () => {
      const accountId = await userAccount([true]);

      expect(cellOf(await recomputeAndRead(accountId), 'T1566')).toMatchObject({
        score: 7,
        evidenceId: null,
        source: 'susceptibility',
        susceptibility: { rate: 0.07, declared: false, measuredOn: null },
      });

      await services.withOrigin(adminOrigin).crqIndicatorSettings.updateCrqIndicatorSettings({
        phishingFailureRate: 0.2,
        phishingFailureMeasuredOn: '2026-09-01',
      });

      expect(cellOf(await recomputeAndRead(accountId), 'T1566')).toMatchObject({
        score: 20,
        evidenceId: null,
        source: 'susceptibility',
        susceptibility: { rate: 0.2, declared: true, expired: false, measuredOn: '2026-09-01' },
      });
    });

    it('should read the default once the declared simulation is older than the validity of a test result', async () => {
      const accountId = await userAccount([true]);
      const measuredOn = new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10);
      await services.withOrigin(adminOrigin).crqIndicatorSettings.updateCrqIndicatorSettings({
        phishingFailureRate: 0.2,
        phishingFailureMeasuredOn: measuredOn,
        measuredValidityDays: 30,
      });

      expect(cellOf(await recomputeAndRead(accountId), 'T1566')).toMatchObject({
        score: 7,
        susceptibility: { rate: 0.07, declared: false, expired: true, measuredOn },
      });
    });

    it('should refuse a campaign measured after today, at the service as at the router', async () => {
      const inTwoDays = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

      await expect(services.withOrigin(adminOrigin).crqIndicatorSettings.updateCrqIndicatorSettings({
        phishingFailureRate: 0.2,
        phishingFailureMeasuredOn: inTwoDays,
      })).rejects.toThrow('A campaign cannot be measured in the future');
      expect((await services.withOrigin(adminOrigin).crqIndicatorSettings.getCrqIndicatorSettings()).phishingFailureRate).toBeNull();
    });

    it('should read an account with no observation of its state as enabled', async () => {
      expect(cellOf(await recomputeAndRead(await userAccount([])), 'T1566')?.source).toBe('susceptibility');
    });

    it('should give a disabled user account no cell, and an account one connector still reports enabled its cell', async () => {
      expect(cellOf(await recomputeAndRead(await userAccount([false])), 'T1566')).toBeUndefined();
      expect(cellOf(await recomputeAndRead(await userAccount([false, true])), 'T1566')?.source).toBe('susceptibility');
    });

    it('should leave a workstation the T1566 cell its finding opens', async () => {
      const workstationId = await createAsset(adminOrigin, { exposure: 'internal', category: 'host', subcategory: 'workstation' });
      const evidenceId = await writeFinding(workstationId, await insertCve('CVE-2099-0201', {
        epss: 0.5,
        vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:H/A:H',
      }));

      expect(cellOf(await recomputeAndRead(workstationId), 'T1566')).toMatchObject({ evidenceId, source: 'finding' });
    });
  });
});

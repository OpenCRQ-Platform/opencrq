import type { EventOrigin } from '@app/module';
import { createSecuredSchema, cve, entryOpenings, mitreTechniques } from '@app/module';
import { eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const LOG4SHELL_VECTOR = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H';
/** Network access with a user to act: client-side exploitation, T1189 and T1566 by the topology rule. */
const CLIENT_SIDE_VECTOR = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:H/A:H';
const openVector = (levels: { c: string, i: string, a: string }) =>
  `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:${levels.c}/I:${levels.i}/A:${levels.a}`;

type Exposure = 'internet_facing' | 'internal' | 'unknown';

describe('Entry openings', () => {
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
    options: {
      exposure?: Exposure,
      category?: 'web_application' | 'host',
      subcategory?: 'workstation' | 'server',
      origin?: EventOrigin,
    } = {},
  ): Promise<string> => {
    const id = uuidv7();
    await services.withOrigin(options.origin ?? adminOrigin).supportingAssets.createSupportingAsset({
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

  const writeFinding = async (supportingAssetId: string, cveRowId: string, origin: EventOrigin = adminOrigin) => {
    const id = uuidv7();
    await services.withOrigin(origin).supportingAssets.createEvidence({ id, supportingAssetId, cveId: cveRowId, userId: adminUserId });
    return id;
  };

  const log4shell = async (owner: string = tenantId) =>
    insertCve('CVE-2021-44228', { epss: 0.976, kev: true, vector: LOG4SHELL_VECTOR }, owner);

  const recompute = async (origin: EventOrigin = adminOrigin) => {
    await services.withOrigin(origin).findingScore.recomputeFindingScores();
  };

  const openingRows = async () => (await db
    .select({
      evidenceId: entryOpenings.assetEvidenceId,
      supportingAssetId: entryOpenings.supportingAssetId,
      cveId: entryOpenings.cveId,
      tenantId: entryOpenings.tenantId,
      externalId: mitreTechniques.externalId,
      opening: entryOpenings.opening,
      threat: entryOpenings.threat,
    })
    .from(entryOpenings)
    .innerJoin(mitreTechniques, eq(mitreTechniques.id, entryOpenings.mitreTechniqueId)))
    .sort((left, right) => left.externalId.localeCompare(right.externalId));

  const techniquesOf = async () => (await openingRows()).map((row) => row.externalId);

  const cellsOf = async (supportingAssetId: string, origin: EventOrigin = adminOrigin) =>
    (await services.withOrigin(origin).findingScore.getAssetTechniqueScores(supportingAssetId)).techniques.map((technique) => technique.externalId);

  const setUnknownExposure = async (value: 'internal' | 'internet_facing') => {
    await services.withOrigin(adminOrigin).crqIndicatorSettings.updateCrqIndicatorSettings({ unknownExposureCountsAs: value });
  };

  it('should write the opening and the threat of a finding on T1190 on an exposed asset', async () => {
    const assetId = await createAsset();
    const cveRowId = await log4shell();
    const evidenceId = await writeFinding(assetId, cveRowId);

    await recompute();

    const rows = await openingRows();
    expect(rows.map((row) => row.externalId)).toContain('T1190');
    const row = rows.find((candidate) => candidate.externalId === 'T1190')!;
    expect(row).toMatchObject({ evidenceId, supportingAssetId: assetId, cveId: cveRowId, tenantId });
    expect(row.opening).toBeCloseTo(1);
    expect(row.threat).toBe(0.984);
  });

  it('should read the opening as access times the worse of confidentiality and integrity over the High weight', async () => {
    const assetId = await createAsset();
    await writeFinding(assetId, await insertCve('CVE-2099-0201', { epss: 0.9, vector: openVector({ c: 'L', i: 'N', a: 'H' }) }));

    await recompute();

    const row = (await openingRows()).find((candidate) => candidate.externalId === 'T1190')!;
    expect(row.opening).toBeCloseTo(0.22 / 0.56);
    expect(row.threat).toBe(0.9);
  });

  it('should write nothing for T1190 on an internal asset', async () => {
    const assetId = await createAsset({ exposure: 'internal' });
    await writeFinding(assetId, await log4shell());

    await recompute();

    expect(await techniquesOf()).not.toContain('T1190');
  });

  it('should write the T1190 row of an unknown exposure asset whatever the tenant setting, for the run to apply the setting it holds', async () => {
    const assetId = await createAsset({ exposure: 'unknown' });
    await writeFinding(assetId, await log4shell());

    await recompute();
    expect(await techniquesOf()).toContain('T1190');

    await setUnknownExposure('internet_facing');
    await recompute();
    expect(await techniquesOf()).toContain('T1190');
  });

  it('should write one row per finding when two findings open the same technique on an asset', async () => {
    const assetId = await createAsset();
    const first = await writeFinding(assetId, await insertCve('CVE-2099-0202', { epss: 0.9, vector: openVector({ c: 'H', i: 'N', a: 'N' }) }));
    const second = await writeFinding(assetId, await insertCve('CVE-2099-0203', { epss: 0.5, vector: openVector({ c: 'L', i: 'L', a: 'N' }) }));

    await recompute();

    const rows = (await openingRows()).filter((row) => row.externalId === 'T1190');
    expect(rows.map((row) => row.evidenceId).sort()).toEqual([first, second].sort());
  });

  it('should write nothing for a finding without a readable vector or without a CVE signal', async () => {
    const assetId = await createAsset();
    await writeFinding(assetId, await insertCve('CVE-2099-0204', { epss: 0.9, vector: 'AV:N/AC:L/Au:N/C:C/I:C' }));
    await writeFinding(assetId, await insertCve('CVE-2099-0205', { epss: 0.9, vector: null }));

    await recompute();

    expect(await openingRows()).toEqual([]);
  });

  it('should write T1189 and T1566 for a client-side flaw on an internal workstation, and nothing for an internal server', async () => {
    const workstation = await createAsset({ exposure: 'internal', category: 'host', subcategory: 'workstation' });
    const server = await createAsset({ exposure: 'internal', category: 'host', subcategory: 'server' });
    const cveRowId = await insertCve('CVE-2099-0206', { epss: 0.5, vector: CLIENT_SIDE_VECTOR });
    await writeFinding(workstation, cveRowId);
    await writeFinding(server, cveRowId);

    await recompute();

    const rows = await openingRows();
    expect(rows.filter((row) => row.supportingAssetId === workstation).map((row) => row.externalId)).toEqual(expect.arrayContaining(['T1189', 'T1566']));
    expect(rows.filter((row) => row.supportingAssetId === workstation).map((row) => row.externalId)).not.toContain('T1190');
    expect(rows.filter((row) => row.supportingAssetId === server)).toEqual([]);
  });

  const rowVersions = async () => (await db.execute<{ version: string }>(
    sql`select xmin::text as version from entry_openings order by mitre_technique_id`,
  )).rows.map((row) => row.version);

  it('should leave the rows of a finding untouched once it is dismissed, for the run to read its state', async () => {
    const assetId = await createAsset();
    const evidenceId = await writeFinding(assetId, await log4shell());
    await recompute();
    const before = await rowVersions();

    await services.withOrigin(adminOrigin).supportingAssets.dismissEvidence({
      evidenceId,
      dismissalType: 'risk_accepted',
      reasonCode: 'wont_fix',
      reason: 'Accepted',
      changedByUserId: adminUserId,
    });
    await recompute();

    expect(before.length).toBeGreaterThan(0);
    expect(await rowVersions()).toEqual(before);
  });

  it('should follow the threat and the vector of a finding when it is recomputed', async () => {
    const assetId = await createAsset();
    const cveRowId = await insertCve('CVE-2099-0207', { epss: 0.9, vector: openVector({ c: 'H', i: 'H', a: 'H' }) });
    await writeFinding(assetId, cveRowId);
    await recompute();
    expect((await openingRows()).find((row) => row.externalId === 'T1190')).toMatchObject({ threat: 0.9 });

    await db.update(cve).set({ epss: 0.4 }).where(eq(cve.id, cveRowId));
    await recompute();

    expect((await openingRows()).find((row) => row.externalId === 'T1190')).toMatchObject({ threat: 0.4 });
  });

  it('should leave a row whose figures did not move unwritten', async () => {
    const assetId = await createAsset();
    await writeFinding(assetId, await log4shell());
    await recompute();
    const before = await rowVersions();

    await recompute();

    expect(before.length).toBeGreaterThan(0);
    expect(await rowVersions()).toEqual(before);
  });

  it('should clear stale rows past the first page of stored keys', async () => {
    const assetId = await createAsset();
    const cveRowId = await log4shell();
    const evidenceId = await writeFinding(assetId, cveRowId);
    const quietEvidenceId = await writeFinding(assetId, await insertCve('CVE-2099-0209', { epss: 0.5, vector: null }));
    await recompute();
    const held = await techniquesOf();
    const techniques = await db.select({ id: mitreTechniques.id }).from(mitreTechniques);
    await db.insert(entryOpenings).values([evidenceId, quietEvidenceId].flatMap((assetEvidenceId) => techniques.map(({ id }) => ({
      tenantId,
      assetEvidenceId,
      supportingAssetId: assetId,
      mitreTechniqueId: id,
      cveId: cveRowId,
      opening: 0.5,
      threat: 0.5,
    })))).onConflictDoNothing();

    await recompute();

    expect(held).toContain('T1190');
    expect(techniques.length * 2).toBeGreaterThan(1000);
    expect(await techniquesOf()).toEqual(held);
  });

  it('should never let one tenant read another tenant rows', async () => {
    const assetId = await createAsset();
    await writeFinding(assetId, await log4shell());
    const otherTenantId = await createTenant(services, adminUserId);
    const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };
    const otherAssetId = await createAsset({ origin: otherOrigin });
    await writeFinding(otherAssetId, await log4shell(otherTenantId), otherOrigin);
    await recompute();
    await recompute(otherOrigin);

    const mine = await db.select().from(createSecuredSchema(db, adminOrigin).entryOpenings);
    const theirs = await db.select().from(createSecuredSchema(db, otherOrigin).entryOpenings);

    expect(mine.length).toBeGreaterThan(0);
    expect(theirs.length).toBeGreaterThan(0);
    expect(mine.every((row) => row.tenantId === tenantId && row.supportingAssetId === assetId)).toBe(true);
    expect(theirs.every((row) => row.tenantId === otherTenantId && row.supportingAssetId === otherAssetId)).toBe(true);
  });

  describe('the TTP screen, ruled by the same applicability', () => {
    it('should give an internal workstation a T1189 cell', async () => {
      const assetId = await createAsset({ exposure: 'internal', category: 'host', subcategory: 'workstation' });
      await writeFinding(assetId, await insertCve('CVE-2099-0208', { epss: 0.5, vector: CLIENT_SIDE_VECTOR }));

      await recompute();

      expect(await cellsOf(assetId)).toContain('T1189');
    });

    it('should drop the T1190 cell of an unknown exposure under the default setting, and give it back under internet_facing', async () => {
      const assetId = await createAsset({ exposure: 'unknown' });
      await writeFinding(assetId, await log4shell());

      await recompute();
      expect(await cellsOf(assetId)).not.toContain('T1190');

      await setUnknownExposure('internet_facing');
      await recompute();
      expect(await cellsOf(assetId)).toContain('T1190');
    });
  });
});

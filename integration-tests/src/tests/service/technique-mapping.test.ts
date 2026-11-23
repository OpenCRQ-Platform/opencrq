import type { EventOrigin } from '@app/module';
import {
  createSecuredSchema,
  cve,
  cveTechniqueMapping,
  cveTechniqueResolution,
  mitreTechniques,
  TECHNIQUE_T1003,
} from '@app/module';
import { eq, inArray, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { heldCveFeeds } from '../../helpers/held-cve-feeds';

const services = createTestServices(db);

/** In the curated corpus, so its finding resolves to stored rows. */
const LOG4SHELL = 'CVE-2021-44228';
const LOG4SHELL_CWE = ['CWE-917', 'CWE-502', 'CWE-20'];
const LOG4SHELL_VECTOR = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H';

/** No curated entry, no weakness class, no vector: the one shape that resolves to nothing. */
const UNMAPPABLE = 'CVE-2024-6387';

describe('Technique Mapping Service', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let adminTenantId: string;
  let assetId: string;

  const insertCve = async (
    tenantId: string,
    cveTextId: string,
    details?: { cwe: Array<string>, cvssVector: string },
  ): Promise<string> => {
    const id = uuidv7();
    await db.insert(cve).values([{
      id,
      tenantId,
      cveId: cveTextId,
      cwe: details?.cwe ?? null,
      cvssVector: details?.cvssVector ?? null,
    }]);
    return id;
  };

  const createAsset = async (origin: EventOrigin): Promise<string> => {
    const id = uuidv7();
    await services.withOrigin(origin).supportingAssets.createSupportingAsset({
      id,
      name: `Asset ${id.substring(0, 8)}`,
      description: null,
      ownerId: null,
      exposure: 'internet_facing',
      categoryId: 'host',
    });
    return id;
  };

  const createConnector = async (): Promise<string> => {
    const serviceAccountId = uuidv7();
    await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({
      id: serviceAccountId, name: 'Test Connector Bot',
    });
    await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('openaev', serviceAccountId);
    return (await services.withOrigin(adminOrigin).integrationSettings.getConnectorId('openaev'))!;
  };

  const writeFinding = async (cveRowId: string, origin: EventOrigin = adminOrigin, userId?: string) =>
    services.withOrigin(origin).supportingAssets.createEvidence({
      id: uuidv7(),
      supportingAssetId: assetId,
      cve: { rowId: cveRowId },
      userId: userId ?? adminUserId,
    });

  const resolutionOf = async (cveRowId: string) =>
    (await db.select().from(cveTechniqueResolution).where(eq(cveTechniqueResolution.cveId, cveRowId))).at(0);

  const mappingsOf = async (cveRowId: string) =>
    db.select().from(cveTechniqueMapping).where(eq(cveTechniqueMapping.cveId, cveRowId));

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    adminTenantId = setup.tenantId;
    assetId = await createAsset(adminOrigin);
  });

  describe('resolution at the finding write', () => {
    it('should resolve the vulnerability of a finding written one at a time', async () => {
      const cveRowId = await insertCve(adminTenantId, LOG4SHELL, { cwe: LOG4SHELL_CWE, cvssVector: LOG4SHELL_VECTOR });
      await writeFinding(cveRowId);

      const resolution = await resolutionOf(cveRowId);
      expect(resolution?.state).toBe('resolved');

      const mappings = await mappingsOf(cveRowId);
      expect(mappings.length).toBeGreaterThan(0);
      expect(mappings.every((row) => row.resolutionId === resolution!.id)).toBe(true);
      expect(mappings.every((row) => row.tenantId === adminTenantId)).toBe(true);
      expect(mappings.every((row) => row.tablesVersion === resolution!.tablesVersion)).toBe(true);
      expect(new Set(mappings.map((row) => row.lane))).toEqual(new Set(['curated']));
    });

    it('should mark a row naming a parent technique as parent grain and a sub-technique as its own', async () => {
      const cveRowId = await insertCve(adminTenantId, LOG4SHELL, { cwe: LOG4SHELL_CWE, cvssVector: LOG4SHELL_VECTOR });
      await writeFinding(cveRowId);

      const mappings = await mappingsOf(cveRowId);
      const catalogue = await db.select().from(mitreTechniques)
        .where(inArray(mitreTechniques.id, mappings.map((row) => row.mitreTechniqueId)));
      const grainByTechniqueId = new Map(catalogue.map((technique) => [
        technique.id,
        technique.isSubtechnique ? 'sub_technique' : 'parent',
      ]));

      expect(mappings.every((row) => row.grain === grainByTechniqueId.get(row.mitreTechniqueId))).toBe(true);
      expect(new Set(mappings.map((row) => row.grain))).toEqual(new Set(['parent', 'sub_technique']));
    });

    it('should resolve every distinct vulnerability a connector batch touches', async () => {
      const connectorId = await createConnector();
      const first = await insertCve(adminTenantId, LOG4SHELL, { cwe: LOG4SHELL_CWE, cvssVector: LOG4SHELL_VECTOR });
      const second = await insertCve(adminTenantId, 'CVE-2023-4966', { cwe: ['CWE-119'], cvssVector: LOG4SHELL_VECTOR });
      const otherAssetId = await createAsset(adminOrigin);

      await services.withOrigin(adminOrigin).supportingAssets.bulkUpsertEvidence([
        {
          id: uuidv7(), evaluatedAt: new Date(), supportingAssetId: assetId, cveId: first, mitreTechniqueId: null,
          expectationType: null, isExposed: true, connectorId, sourceFindingId: 'finding-1',
        },
        {
          id: uuidv7(), evaluatedAt: new Date(), supportingAssetId: otherAssetId, cveId: first, mitreTechniqueId: null,
          expectationType: null, isExposed: true, connectorId, sourceFindingId: 'finding-2',
        },
        {
          id: uuidv7(), evaluatedAt: new Date(), supportingAssetId: assetId, cveId: second, mitreTechniqueId: null,
          expectationType: null, isExposed: true, connectorId, sourceFindingId: 'finding-3',
        },
      ]);

      expect((await resolutionOf(first))?.state).toBe('resolved');
      expect((await resolutionOf(second))?.state).toBe('resolved');
    });

    it('should create nothing for a finding naming a technique rather than a vulnerability', async () => {
      const connectorId = await createConnector();
      await services.withOrigin(adminOrigin).supportingAssets.bulkUpsertEvidence([{
        id: uuidv7(), evaluatedAt: new Date(), supportingAssetId: assetId, cveId: null, mitreTechniqueId: TECHNIQUE_T1003,
        expectationType: 'detection', isExposed: true, securityPlatformType: 'SIEM',
        connectorId, sourceScenarioId: 'scenario-1', sourceFindingId: 'finding-1',
      }]);

      expect(await db.select().from(cveTechniqueResolution)).toEqual([]);
      expect(await db.select().from(cveTechniqueMapping)).toEqual([]);
    });
  });

  describe('the unresolved state', () => {
    it('should record that a vulnerability resolved to nothing rather than leaving no trace', async () => {
      const cveRowId = await insertCve(adminTenantId, UNMAPPABLE);
      await writeFinding(cveRowId);

      const resolution = await resolutionOf(cveRowId);
      expect(resolution?.state).toBe('unresolved');
      expect(await mappingsOf(cveRowId)).toEqual([]);
    });

    it('should stay distinguishable from a vulnerability that was never resolved', async () => {
      const resolvedToNothing = await insertCve(adminTenantId, UNMAPPABLE);
      const neverAsked = await insertCve(adminTenantId, 'CVE-2020-1472');
      await writeFinding(resolvedToNothing);

      expect(await resolutionOf(resolvedToNothing)).toBeDefined();
      expect(await resolutionOf(neverAsked)).toBeUndefined();
    });
  });

  describe('convergence', () => {
    it('should leave a current resolution alone when a second finding on it is written', async () => {
      const cveRowId = await insertCve(adminTenantId, LOG4SHELL, { cwe: LOG4SHELL_CWE, cvssVector: LOG4SHELL_VECTOR });
      await writeFinding(cveRowId);
      const first = await resolutionOf(cveRowId);

      const otherAssetId = await createAsset(adminOrigin);
      await services.withOrigin(adminOrigin).supportingAssets.createEvidence({
        id: uuidv7(), supportingAssetId: otherAssetId, cve: { rowId: cveRowId }, userId: adminUserId,
      });

      const second = await resolutionOf(cveRowId);
      expect(second?.id).toBe(first?.id);
      expect(second?.resolvedAt.getTime()).toBe(first?.resolvedAt.getTime());
    });

    it('should read the weakness link as soon as the weakness class arrives, storing no row for it', async () => {
      const cveRowId = await insertCve(adminTenantId, UNMAPPABLE);
      await writeFinding(cveRowId);
      expect((await resolutionOf(cveRowId))?.state).toBe('unresolved');

      await db.update(cve)
        .set({ cwe: LOG4SHELL_CWE, cvssVector: LOG4SHELL_VECTOR, updatedAt: sql`now()` })
        .where(eq(cve.id, cveRowId));

      const claims = await services.withOrigin(adminOrigin).techniqueMapping.getTechniqueClaims([cveRowId]);
      expect(claims.states).toEqual([{ cveId: cveRowId, state: 'resolved' }]);
      expect(claims.mappings.length).toBeGreaterThan(0);
      expect(claims.mappings.every((row) => row.lane === 'structural')).toBe(true);
      expect(await mappingsOf(cveRowId)).toEqual([]);
    });

    it('should read the weakness link the vulnerability feed fills in, with no finding written since', async () => {
      const cveRowId = await insertCve(adminTenantId, UNMAPPABLE);
      await writeFinding(cveRowId);

      await heldCveFeeds(services.withOrigin(adminOrigin).cve).upsertCvssScores([{
        cveId: UNMAPPABLE, cvss: 9.8, cvssVector: LOG4SHELL_VECTOR, cwe: LOG4SHELL_CWE, lastModified: '2024-01-10T00:00:00.000Z',
      }]);
      await services.withOrigin(adminOrigin).techniqueMapping.resolveTechniquesForCves([cveRowId]);

      const claims = await services.withOrigin(adminOrigin).techniqueMapping.getTechniqueClaims([cveRowId]);
      expect(claims.states).toEqual([{ cveId: cveRowId, state: 'resolved' }]);
      expect(claims.mappings.every((row) => row.lane === 'structural' && row.weaknesses.length > 0)).toBe(true);
    });

    it('should hand the topology rule the user interaction flag the feed states beside a 2.0 vector', async () => {
      const cveRowId = await insertCve(adminTenantId, UNMAPPABLE);
      const v2Vector = 'AV:N/AC:M/Au:N/C:P/I:P/A:P';

      await heldCveFeeds(services.withOrigin(adminOrigin).cve).upsertCvssScores([{
        cveId: UNMAPPABLE, cvss: 6.8, cvssVector: v2Vector, cvssV2UserInteractionRequired: true, lastModified: '2024-01-10T00:00:00.000Z',
      }]);

      const claims = await services.withOrigin(adminOrigin).techniqueMapping.getTechniqueClaims([cveRowId]);
      expect(claims.cves).toEqual([{ cveRowId, cwe: null, cvssVector: v2Vector, cvssV2UserInteractionRequired: true }]);
    });

    it('should leave the stored answer untouched when a feed bumps the row without changing what it says', async () => {
      const cveRowId = await insertCve(adminTenantId, LOG4SHELL, { cwe: LOG4SHELL_CWE, cvssVector: LOG4SHELL_VECTOR });
      await writeFinding(cveRowId);
      const before = await resolutionOf(cveRowId);
      const mappingIdsBefore = (await mappingsOf(cveRowId)).map((row) => row.id).sort();

      // The EPSS and KEV feeds bump the row daily without touching what the resolver reads. The
      // bump is placed a full second past the stored resolution rather than at now(): read back at
      // millisecond precision, a bump in the same millisecond would not count as stale.
      const bumpedAt = new Date(before!.resolvedAt.getTime() + 1000);
      await db.update(cve).set({ epss: 0.5, updatedAt: bumpedAt }).where(eq(cve.id, cveRowId));
      await services.withOrigin(adminOrigin).techniqueMapping.resolveTechniquesForCves([cveRowId]);

      const after = await resolutionOf(cveRowId);
      expect(after?.id).toBe(before?.id);
      expect(after?.resolvedAt.getTime()).toBe(before?.resolvedAt.getTime());
      expect((await mappingsOf(cveRowId)).map((row) => row.id).sort()).toEqual(mappingIdsBefore);
    });
  });

  describe('tenant isolation', () => {
    it('should hide one tenant\'s rows from another tenant entirely', async () => {
      const cveRowId = await insertCve(adminTenantId, LOG4SHELL, { cwe: LOG4SHELL_CWE, cvssVector: LOG4SHELL_VECTOR });
      await writeFinding(cveRowId);

      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };
      const otherViews = createSecuredSchema(db, otherOrigin);
      const ownViews = createSecuredSchema(db, adminOrigin);

      expect(await db.select().from(otherViews.cveTechniqueResolution)).toEqual([]);
      expect(await db.select().from(otherViews.cveTechniqueMapping)).toEqual([]);
      expect((await db.select().from(ownViews.cveTechniqueResolution)).length).toBe(1);
      expect((await db.select().from(ownViews.cveTechniqueMapping)).length).toBeGreaterThan(0);
    });
  });

  describe('lifecycle', () => {
    it('should take the resolution and its mapping rows with the vulnerability row', async () => {
      const cveRowId = await insertCve(adminTenantId, LOG4SHELL, { cwe: LOG4SHELL_CWE, cvssVector: LOG4SHELL_VECTOR });
      await writeFinding(cveRowId);
      expect((await mappingsOf(cveRowId)).length).toBeGreaterThan(0);

      await db.delete(cve).where(eq(cve.id, cveRowId));

      expect(await db.select().from(cveTechniqueResolution)).toEqual([]);
      expect(await db.select().from(cveTechniqueMapping)).toEqual([]);
    });
  });
});

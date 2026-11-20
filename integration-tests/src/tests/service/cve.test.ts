import type { CveListSortKey, EventOrigin } from '@app/module';
import { cveAffectedVersions, cveReferences } from '@app/module';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { expectReplayedSyncSilent } from '../../helpers/replayed-sync';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('CVE Service', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
  });

  describe('upsert operations', () => {
    it('should create a cve record via upsertEpssScores', async () => {
      await services.withOrigin(adminOrigin).cve.upsertEpssScores([
        { cveId: 'CVE-2024-0001', epss: 0.05, date: '2024-01-15' },
      ]);

      const result = await services.withOrigin(adminOrigin).cve.getCveByCveId('CVE-2024-0001');
      expect(result).toBeTruthy();
      expect(result!.cveId).toBe('CVE-2024-0001');
      expect(result!.epss).toBeCloseTo(0.05);
      expect(result!.epssUpdatedAt).toEqual(new Date('2024-01-15'));
    });

    it('should update epss score on second upsert', async () => {
      await services.withOrigin(adminOrigin).cve.upsertEpssScores([
        { cveId: 'CVE-2024-0002', epss: 0.10, date: '2024-01-15' },
      ]);

      await services.withOrigin(adminOrigin).cve.upsertEpssScores([
        { cveId: 'CVE-2024-0002', epss: 0.20, date: '2024-02-01' },
      ]);

      const result = await services.withOrigin(adminOrigin).cve.getCveByCveId('CVE-2024-0002');
      expect(result).toBeTruthy();
      expect(result!.epss).toBeCloseTo(0.20);
      expect(result!.epssUpdatedAt).toEqual(new Date('2024-02-01'));
    });

    it('should create a cve record via upsertCvssScores', async () => {
      await services.withOrigin(adminOrigin).cve.upsertCvssScores([
        {
          cveId: 'CVE-2024-0003',
          cvss: 9.8,
          lastModified: '2024-01-10T00:00:00.000Z',
          title: 'Critical RCE',
          description: 'Remote code execution vulnerability',
        },
      ]);

      const result = await services.withOrigin(adminOrigin).cve.getCveByCveId('CVE-2024-0003');
      expect(result).toBeTruthy();
      expect(result!.cvss).toBeCloseTo(9.8);
      expect(result!.cveTitle).toBe('Critical RCE');
      expect(result!.cveDescription).toBe('Remote code execution vulnerability');
    });

    it('should preserve existing epss score when upserting cvss', async () => {
      await services.withOrigin(adminOrigin).cve.upsertEpssScores([
        { cveId: 'CVE-2024-0004', epss: 0.42, date: '2024-01-01' },
      ]);
      await services.withOrigin(adminOrigin).cve.upsertCvssScores([
        { cveId: 'CVE-2024-0004', cvss: 7.5, lastModified: '2024-01-05T00:00:00.000Z' },
      ]);

      const result = await services.withOrigin(adminOrigin).cve.getCveByCveId('CVE-2024-0004');
      expect(result).toBeTruthy();
      expect(result!.epss).toBeCloseTo(0.42);
      expect(result!.cvss).toBeCloseTo(7.5);
    });

    it('should persist the CWE list and the CVSS vector via upsertCvssScores', async () => {
      await services.withOrigin(adminOrigin).cve.upsertCvssScores([
        {
          cveId: 'CVE-2024-0031',
          cvss: 9.8,
          cvssVector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
          cwe: ['CWE-917', 'CWE-502'],
          lastModified: '2024-01-10T00:00:00.000Z',
        },
      ]);

      const result = await services.withOrigin(adminOrigin).cve.getCveByCveId('CVE-2024-0031');
      expect(result).toBeTruthy();
      expect(result!.cvssVector).toBe('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H');
      expect(result!.cwe).toEqual(['CWE-917', 'CWE-502']);
    });

    it('should leave the CWE absent rather than empty when none is supplied', async () => {
      await services.withOrigin(adminOrigin).cve.upsertCvssScores([
        { cveId: 'CVE-2024-0032', cvss: 7.5, lastModified: '2024-01-10T00:00:00.000Z' },
      ]);

      const result = await services.withOrigin(adminOrigin).cve.getCveByCveId('CVE-2024-0032');
      expect(result).toBeTruthy();
      expect(result!.cwe).toBeNull();
      expect(result!.cvssVector).toBeNull();
    });

    it('should preserve a stored CWE and vector, with the score paired to that vector, when a later sync brings neither', async () => {
      await services.withOrigin(adminOrigin).cve.upsertCvssScores([
        {
          cveId: 'CVE-2024-0033',
          cvss: 9.8,
          cvssVector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
          cwe: ['CWE-22'],
          lastModified: '2024-01-10T00:00:00.000Z',
        },
      ]);
      await services.withOrigin(adminOrigin).cve.upsertCvssScores([
        { cveId: 'CVE-2024-0033', cvss: 9.9, lastModified: '2024-02-10T00:00:00.000Z' },
      ]);

      const result = await services.withOrigin(adminOrigin).cve.getCveByCveId('CVE-2024-0033');
      expect(result).toBeTruthy();
      expect(result!.cvss).toBeCloseTo(9.8);
      expect(result!.cwe).toEqual(['CWE-22']);
      expect(result!.cvssVector).toBe('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H');
    });

    it('should keep a connector score and its date when the feed brings a CWE and a description but no metric', async () => {
      await services.withOrigin(adminOrigin).cve.upsertDefenderReports([
        { cveId: 'CVE-2024-0037', cvss: 7.8, isExploitAvailable: null },
      ]);
      await services.withOrigin(adminOrigin).cve.upsertCvssScores([
        { cveId: 'CVE-2024-0037', cwe: ['CWE-122'], description: 'Heap overflow', lastModified: '2024-01-10T00:00:00.000Z' },
      ]);

      const result = await services.withOrigin(adminOrigin).cve.getCveByCveId('CVE-2024-0037');
      expect(result).toBeTruthy();
      expect(result!.cvss).toBeCloseTo(7.8);
      expect(result!.cvssUpdatedAt).toBeNull();
      expect(result!.cwe).toEqual(['CWE-122']);
      expect(result!.cveDescription).toBe('Heap overflow');
    });

    it('should leave a row untouched when a later sync re-confirms what it already states', async () => {
      const score = {
        cveId: 'CVE-2024-0035',
        cvss: 9.8,
        cvssVector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
        cwe: ['CWE-22'],
        lastModified: '2024-01-10T00:00:00.000Z',
        description: 'Path traversal',
      };
      await services.withOrigin(adminOrigin).cve.upsertCvssScores([score]);
      const before = await services.withOrigin(adminOrigin).cve.getCveByCveId('CVE-2024-0035');

      await services.withOrigin(adminOrigin).cve.upsertCvssScores([score]);

      const after = await services.withOrigin(adminOrigin).cve.getCveByCveId('CVE-2024-0035');
      expect(after!.updatedAt).toEqual(before!.updatedAt);
    });

    it('should move the update time when a later sync changes a value', async () => {
      await services.withOrigin(adminOrigin).cve.upsertCvssScores([
        { cveId: 'CVE-2024-0036', cvss: 7.5, lastModified: '2024-01-10T00:00:00.000Z' },
      ]);
      const before = await services.withOrigin(adminOrigin).cve.getCveByCveId('CVE-2024-0036');

      await services.withOrigin(adminOrigin).cve.upsertCvssScores([
        { cveId: 'CVE-2024-0036', cvss: 7.5, cwe: ['CWE-79'], lastModified: '2024-01-10T00:00:00.000Z' },
      ]);

      const after = await services.withOrigin(adminOrigin).cve.getCveByCveId('CVE-2024-0036');
      expect(after!.cwe).toEqual(['CWE-79']);
      expect(after!.updatedAt.getTime()).toBeGreaterThan(before!.updatedAt.getTime());
    });

    it('should not let a Defender score touch the CWE or the vector', async () => {
      await services.withOrigin(adminOrigin).cve.upsertCvssScores([
        {
          cveId: 'CVE-2024-0034',
          cvss: 9.8,
          cvssVector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
          cwe: ['CWE-787'],
          lastModified: '2024-01-10T00:00:00.000Z',
        },
      ]);
      await services.withOrigin(adminOrigin).cve.upsertDefenderReports([
        { cveId: 'CVE-2024-0034', cvss: 5.0, isExploitAvailable: true },
      ]);

      const result = await services.withOrigin(adminOrigin).cve.getCveByCveId('CVE-2024-0034');
      expect(result).toBeTruthy();
      expect(result!.cwe).toEqual(['CWE-787']);
      expect(result!.cvssVector).toBe('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H');
    });

    it('should create a cve record via upsertKevFlags', async () => {
      await services.withOrigin(adminOrigin).cve.upsertKevFlags([
        { cveId: 'CVE-2024-0005', dateAdded: '2024-03-01', title: 'Log4Shell Variant' },
      ]);

      const result = await services.withOrigin(adminOrigin).cve.getCveByCveId('CVE-2024-0005');
      expect(result).toBeTruthy();
      expect(result!.kev).toBe(true);
      expect(result!.cveTitle).toBe('Log4Shell Variant');
    });

    it('should preserve existing scores when upserting kev flag', async () => {
      await services.withOrigin(adminOrigin).cve.upsertEpssScores([
        { cveId: 'CVE-2024-0006', epss: 0.75, date: '2024-01-01' },
      ]);
      await services.withOrigin(adminOrigin).cve.upsertKevFlags([
        { cveId: 'CVE-2024-0006', dateAdded: '2024-02-01', title: 'Known Exploit' },
      ]);

      const result = await services.withOrigin(adminOrigin).cve.getCveByCveId('CVE-2024-0006');
      expect(result).toBeTruthy();
      expect(result!.epss).toBeCloseTo(0.75);
      expect(result!.kev).toBe(true);
    });
  });

  describe('pagination', () => {
    it('should return paginated results', async () => {
      const cveIds = Array.from({ length: 5 }, (_, i) => `CVE-2025-00${String(i + 1).padStart(2, '0')}`);
      await services.withOrigin(adminOrigin).cve.upsertEpssScores(
        cveIds.map((cveId) => ({ cveId, epss: 0.1, date: '2025-01-01' })),
      );

      const page1 = await services.withOrigin(adminOrigin).cve.listCve({ page: 1, limit: 3 });
      expect(page1.items).toHaveLength(3);
      expect(page1.total).toBeGreaterThanOrEqual(5);
      expect(page1.page).toBe(1);
      expect(page1.limit).toBe(3);

      const page2 = await services.withOrigin(adminOrigin).cve.listCve({ page: 2, limit: 3 });
      expect(page2.items.length).toBeGreaterThanOrEqual(2);

      const page1Ids = page1.items.map((i) => i.cveId);
      const page2Ids = page2.items.map((i) => i.cveId);
      const overlap = page1Ids.filter((id) => page2Ids.includes(id));
      expect(overlap).toHaveLength(0);
    });

    it('should return correct total count', async () => {
      await services.withOrigin(adminOrigin).cve.upsertEpssScores([
        { cveId: 'CVE-2025-9001', epss: 0.1, date: '2025-01-01' },
        { cveId: 'CVE-2025-9002', epss: 0.2, date: '2025-01-01' },
      ]);

      const result = await services.withOrigin(adminOrigin).cve.listCve({ page: 1, limit: 100 });
      expect(result.total).toBeGreaterThanOrEqual(2);
    });
  });

  describe('search and sort', () => {
    beforeEach(async () => {
      await services.withOrigin(adminOrigin).cve.upsertEpssScores([
        { cveId: 'CVE-2025-1001', epss: 0.9, date: '2025-01-01' },
        { cveId: 'CVE-2025-1002', epss: 0.1, date: '2025-01-01' },
        { cveId: 'CVE-2025-1003', epss: 0.5, date: '2025-01-01' },
      ]);
      await services.withOrigin(adminOrigin).cve.upsertCvssScores([
        { cveId: 'CVE-2025-1001', cvss: 5.0, lastModified: '2025-01-01T00:00:00.000Z' },
        { cveId: 'CVE-2025-1002', cvss: 9.8, lastModified: '2025-01-01T00:00:00.000Z', title: 'Log4Shell' },
      ]);
      await services.withOrigin(adminOrigin).cve.upsertKevFlags([
        { cveId: 'CVE-2025-1003', dateAdded: '2025-01-01', title: 'Known exploited flaw' },
      ]);
    });

    const listIds = async (params: { search?: string, sortBy?: CveListSortKey, sortDesc?: boolean }) =>
      (await services.withOrigin(adminOrigin).cve.listCve({ page: 1, limit: 100, ...params })).items.map((row) => row.cveId);

    it('should match a fragment of the CVE id', async () => {
      const result = await services.withOrigin(adminOrigin).cve.listCve({ page: 1, limit: 100, search: '1002' });
      expect(result.items.map((row) => row.cveId)).toEqual(['CVE-2025-1002']);
      expect(result.total).toBe(1);
    });

    it('should match the title case-insensitively', async () => {
      expect(await listIds({ search: 'log4shell' })).toEqual(['CVE-2025-1002']);
    });

    it('should match accents and ligatures in both directions', async () => {
      await services.withOrigin(adminOrigin).cve.upsertCvssScores([
        { cveId: 'CVE-2025-1001', cvss: 5.0, lastModified: '2025-01-02T00:00:00.000Z', title: 'École Straße' },
      ]);

      expect(await listIds({ search: 'ecole' })).toEqual(['CVE-2025-1001']);
      expect(await listIds({ search: 'strasse' })).toEqual(['CVE-2025-1001']);
      expect(await listIds({ search: 'log4' })).toEqual(['CVE-2025-1002']);
      expect(await listIds({ search: 'Lóg4' })).toEqual(['CVE-2025-1002']);
    });

    it('should take a LIKE wildcard in the search literally', async () => {
      expect(await listIds({ search: '%' })).toEqual([]);
    });

    it('should order by EPSS descending', async () => {
      expect(await listIds({ sortBy: 'epss', sortDesc: true })).toEqual(['CVE-2025-1001', 'CVE-2025-1003', 'CVE-2025-1002']);
    });

    it('should put an unscored CVE last when ordering by CVSS ascending', async () => {
      expect(await listIds({ sortBy: 'cvss', sortDesc: false })).toEqual(['CVE-2025-1001', 'CVE-2025-1002', 'CVE-2025-1003']);
    });

    it('should put the known exploited CVE first when ordering by KEV descending', async () => {
      expect((await listIds({ sortBy: 'kev', sortDesc: true }))[0]).toBe('CVE-2025-1003');
    });

    it('should read KEV from the CISA date, so a connector exploit-available flag is neither shown nor sorted as KEV', async () => {
      await services.withOrigin(adminOrigin).cve.upsertDefenderReports([
        { cveId: 'CVE-2025-1004', cvss: 6.0, isExploitAvailable: true },
      ]);

      const flagged = await services.withOrigin(adminOrigin).cve.getCveByCveId('CVE-2025-1004');
      const listed = await services.withOrigin(adminOrigin).cve.getCveByCveId('CVE-2025-1003');
      const [flaggedByIds] = await services.withOrigin(adminOrigin).cve.getCvesByCveIds(['CVE-2025-1004']);
      const page = await services.withOrigin(adminOrigin).cve.listCve({ page: 1, limit: 100, sortBy: 'kev', sortDesc: true });

      expect(flagged?.kev).toBe(false);
      expect(flaggedByIds.kev).toBe(false);
      expect(listed?.kev).toBe(true);
      expect(page.items[0].cveId).toBe('CVE-2025-1003');
      expect(page.items.filter((row) => row.kev).map((row) => row.cveId)).toEqual(['CVE-2025-1003']);
    });

    it('should put the known exploited CVE last when ordering by KEV ascending, a CVE CISA never listed included', async () => {
      expect((await listIds({ sortBy: 'kev', sortDesc: false })).at(-1)).toBe('CVE-2025-1003');
    });

    it('should leave out of the attach search the CVEs the asset already carries, and only those', async () => {
      const assetId = uuidv7();
      const otherAssetId = uuidv7();
      const read = services.withOrigin(adminOrigin);
      for (const id of [assetId, otherAssetId]) {
        await read.supportingAssets.createSupportingAsset({ id, name: id, description: null, ownerId: null, exposure: 'internal', categoryId: 'host' });
      }
      const attached = await read.cve.getCveByCveId('CVE-2025-1002');
      await read.supportingAssets.createEvidence({ id: uuidv7(), supportingAssetId: assetId, cveId: attached!.id, userId: adminUserId });

      const ids = async (excluded: string | null) => (await read.cve.searchCve('CVE-2025', excluded)).map((row) => row.cveId);
      expect(await ids(assetId)).toEqual(['CVE-2025-1001', 'CVE-2025-1003']);
      expect(await ids(otherAssetId)).toEqual(['CVE-2025-1001', 'CVE-2025-1002', 'CVE-2025-1003']);
      expect(await ids(null)).toEqual(['CVE-2025-1001', 'CVE-2025-1002', 'CVE-2025-1003']);
    });
  });

  describe('batch upsert', () => {
    it('should handle empty batch without error', async () => {
      await expect(
        services.withOrigin(adminOrigin).cve.upsertEpssScores([]),
      ).resolves.toBeUndefined();
    });
  });

  describe('remediation enrichment', () => {
    const rowIdOf = async (origin: EventOrigin, cveId: string): Promise<string> => {
      const row = await services.withOrigin(origin).cve.getCveByCveId(cveId);
      return row!.id;
    };

    it('should replace what the feed stated before rather than merging with it', async () => {
      await services.withOrigin(adminOrigin).cve.upsertEpssScores([
        { cveId: 'CVE-2025-FIXED', epss: 0.4, date: '2025-01-01' },
      ]);
      const cveRowId = await rowIdOf(adminOrigin, 'CVE-2025-FIXED');

      await services.withOrigin(adminOrigin).cve.replaceRemediation([{
        cveRowId,
        references: [{ url: 'https://vendor.example/advisory', tags: ['Patch'] }],
        affectedVersions: [{ product: 'libwebp', affectedUpTo: '1.3.2', affectedUpToIncluded: false }],
      }]);
      await services.withOrigin(adminOrigin).cve.replaceRemediation([{
        cveRowId,
        references: [{ url: 'https://vendor.example/advisory-v2' }],
        affectedVersions: [{ product: 'libwebp', affectedUpTo: '1.3.3', affectedUpToIncluded: false }],
      }]);

      const remediation = await services.withOrigin(adminOrigin).cve.getRemediation('CVE-2025-FIXED');
      expect(remediation.references.map((reference) => reference.url)).toEqual(['https://vendor.example/advisory-v2']);
      expect(remediation.affectedVersions.map((version) => version.affectedUpTo)).toEqual(['1.3.3']);
    });

    it('should clear the guidance a later record no longer states', async () => {
      await services.withOrigin(adminOrigin).cve.upsertEpssScores([
        { cveId: 'CVE-2025-WITHDRAWN', epss: 0.4, date: '2025-01-01' },
      ]);
      const cveRowId = await rowIdOf(adminOrigin, 'CVE-2025-WITHDRAWN');

      await services.withOrigin(adminOrigin).cve.replaceRemediation([{
        cveRowId,
        references: [{ url: 'https://vendor.example/withdrawn' }],
        affectedVersions: [{ product: 'libwebp', affectedUpTo: '1.3.2', affectedUpToIncluded: true }],
      }]);
      await services.withOrigin(adminOrigin).cve.replaceRemediation([{
        cveRowId,
        references: [],
        affectedVersions: [],
      }]);

      const remediation = await services.withOrigin(adminOrigin).cve.getRemediation('CVE-2025-WITHDRAWN');
      expect(remediation.references).toEqual([]);
      expect(remediation.affectedVersions).toEqual([]);
    });

    it('should keep the remediation of one tenant out of another', async () => {
      await services.withOrigin(adminOrigin).cve.upsertEpssScores([
        { cveId: 'CVE-2025-BOTH', epss: 0.4, date: '2025-01-01' },
      ]);
      const tenantBId = await createTenant(services, adminUserId);
      const tenantBOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };
      await services.withOrigin(tenantBOrigin).cve.upsertEpssScores([
        { cveId: 'CVE-2025-BOTH', epss: 0.4, date: '2025-01-01' },
      ]);

      await services.withOrigin(adminOrigin).cve.replaceRemediation([{
        cveRowId: await rowIdOf(adminOrigin, 'CVE-2025-BOTH'),
        references: [{ url: 'https://vendor.example/tenant-a' }],
        affectedVersions: [],
      }]);

      const remediationB = await services.withOrigin(tenantBOrigin).cve.getRemediation('CVE-2025-BOTH');
      expect(remediationB.references).toEqual([]);
    });

    describe('a feed walked again', () => {
      const idsByUrl = async () => new Map((await db.select().from(cveReferences)).map((row) => [row.url, row.id]));

      const walkFeeds = async () => {
        const read = services.withOrigin(adminOrigin);
        await read.cve.upsertCvssScores([{
          cveId: 'CVE-2025-WALK',
          cvss: 9.8,
          cvssVector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
          cwe: ['CWE-22'],
          lastModified: '2025-01-10T00:00:00.000Z',
          title: 'Path traversal',
          description: 'Reads files outside the root',
        }]);
        await read.cve.replaceRemediation([{
          cveRowId: await rowIdOf(adminOrigin, 'CVE-2025-WALK'),
          references: [
            { url: 'https://vendor.example/advisory', source: 'nvd@nist.gov', tags: ['Patch', 'Vendor Advisory'] },
            { url: 'https://vendor.example/mailing-list' },
          ],
          affectedVersions: [
            { vendor: 'vendor', product: 'libwebp', affectedFrom: '1.0.0', affectedUpTo: '1.3.2', affectedUpToIncluded: false },
            { affectedUpTo: '2.0', affectedUpToIncluded: true },
          ],
        }]);
        await read.cve.upsertKevFlags([{
          cveId: 'CVE-2025-WALK',
          dateAdded: '2025-02-01',
          requiredAction: 'Apply updates',
          ransomwareUse: 'Unknown',
          dueDate: '2025-02-22',
          notes: 'https://vendor.example/advisory',
        }]);
        await read.cve.upsertEpssScores([{ cveId: 'CVE-2025-WALK', epss: 0.42, date: '2025-03-01' }]);
      };

      it('should ring nothing and move no updated_at when the feeds state the same data', async () => {
        await walkFeeds();
        const before = await idsByUrl();

        await expectReplayedSyncSilent(walkFeeds);

        expect(await idsByUrl()).toEqual(before);
      });

      it('should replace only the reference the feed changed, and keep the ids of the others', async () => {
        await walkFeeds();
        const before = await idsByUrl();

        await services.withOrigin(adminOrigin).cve.replaceRemediation([{
          cveRowId: await rowIdOf(adminOrigin, 'CVE-2025-WALK'),
          references: [
            { url: 'https://vendor.example/advisory', source: 'nvd@nist.gov', tags: ['Patch'] },
            { url: 'https://vendor.example/mailing-list' },
          ],
          affectedVersions: [],
        }]);

        const after = await idsByUrl();
        expect(after.get('https://vendor.example/mailing-list')).toBe(before.get('https://vendor.example/mailing-list'));
        expect(after.get('https://vendor.example/advisory')).not.toBe(before.get('https://vendor.example/advisory'));
        const [advisory] = await db.select().from(cveReferences).where(eq(cveReferences.url, 'https://vendor.example/advisory'));
        expect(advisory.tags).toEqual(['Patch']);
      });

      it('should replace only the affected range the feed changed, and keep the ids of the others', async () => {
        await walkFeeds();
        const before = await db.select().from(cveAffectedVersions);
        const idOfUpTo = (rows: typeof before, upTo: string) => rows.find((row) => row.affectedUpTo === upTo)?.id;

        await services.withOrigin(adminOrigin).cve.replaceRemediation([{
          cveRowId: await rowIdOf(adminOrigin, 'CVE-2025-WALK'),
          references: [],
          affectedVersions: [
            { vendor: 'vendor', product: 'libwebp', affectedFrom: '1.0.0', affectedUpTo: '1.3.2', affectedUpToIncluded: true },
            { affectedUpTo: '2.0', affectedUpToIncluded: true },
          ],
        }]);

        const after = await db.select().from(cveAffectedVersions);
        expect(after).toHaveLength(2);
        expect(idOfUpTo(after, '2.0')).toBe(idOfUpTo(before, '2.0'));
        expect(idOfUpTo(after, '1.3.2')).not.toBe(idOfUpTo(before, '1.3.2'));
        expect(after.find((row) => row.affectedUpTo === '1.3.2')?.affectedUpToIncluded).toBe(true);
      });
    });

    it('refuses to read without a tenant, which no policy predicate would scope', async () => {
      await services.withOrigin(adminOrigin).cve.upsertEpssScores([
        { cveId: 'CVE-2025-NOTENANT', epss: 0.4, date: '2025-01-01' },
      ]);
      const tenantlessOrigin: EventOrigin = { type: 'platform', userId: adminUserId };

      await expect(services.withOrigin(tenantlessOrigin).cve.getRemediation('CVE-2025-NOTENANT'))
        .rejects.toThrow();
    });
  });

  describe('tenant isolation', () => {
    it('should not see CVEs from another tenant', async () => {
      await services.withOrigin(adminOrigin).cve.upsertEpssScores([
        { cveId: 'CVE-2025-TENANT-A', epss: 0.5, date: '2025-01-01' },
      ]);

      const tenantBId = await createTenant(services, adminUserId);
      const tenantBOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };

      const resultB = await services.withOrigin(tenantBOrigin).cve.listCve({ page: 1, limit: 100 });
      const cveIdsB = resultB.items.map((c) => c.cveId);
      expect(cveIdsB).not.toContain('CVE-2025-TENANT-A');
    });

    it('should allow the same CVE ID to be stored independently per tenant', async () => {
      await services.withOrigin(adminOrigin).cve.upsertEpssScores([
        { cveId: 'CVE-2025-SHARED', epss: 0.3, date: '2025-01-01' },
      ]);

      const tenantBId = await createTenant(services, adminUserId);
      const tenantBOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };

      await services.withOrigin(tenantBOrigin).cve.upsertEpssScores([
        { cveId: 'CVE-2025-SHARED', epss: 0.9, date: '2025-01-01' },
      ]);

      const resultA = await services.withOrigin(adminOrigin).cve.getCveByCveId('CVE-2025-SHARED');
      const resultB = await services.withOrigin(tenantBOrigin).cve.getCveByCveId('CVE-2025-SHARED');

      expect(resultA!.epss).toBeCloseTo(0.3);
      expect(resultB!.epss).toBeCloseTo(0.9);
    });
  });
});

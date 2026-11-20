import type { AssetCategory, AssetCriticality, ConnectorAssetInput, EventOrigin, ReportedSoftware, SupportingAssetExposure } from '@app/module';
import { assetEvidence, assetEvidenceSourceSoftware } from '@app/module';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { expectReplayedSyncSilent } from '../../helpers/replayed-sync';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const NO_LONGER_REPORTED = 'No longer reported by Microsoft Defender';

/**
 * Simulates the per-page materialization that graphSyncHandler performs:
 * get connectorId, upsert CVE shells, upsert assets, upsert evidence, dismiss the findings of
 * the page's devices it no longer carries, markSynced. A row with an empty CveId is a device
 * without a vulnerability, as the Graph query returns one. Accepts pre-mapped values
 * (categoryId, exposure, criticality) to avoid duplicating mapping logic from
 * graph-mapping-utils, which is covered by unit tests in back. Returns the dismissed count.
 */
// Defender's last contact with a device, which dates its findings in the handler: a replay of the
// same page carries the same one.
const DEVICE_LAST_SEEN = new Date('2026-06-01T00:00:00Z');

const materializePage = async (
  origin: EventOrigin,
  rows: Array<{
    DeviceId: string,
    CveId: string,
    DeviceName?: string,
    categoryId: AssetCategory,
    exposure: SupportingAssetExposure,
    criticality: AssetCriticality,
    software?: Array<ReportedSoftware>,
    lastSeen?: Date,
  }>,
  syncStartedAt: Date,
): Promise<number> => {
  const svc = services.withOrigin(origin);

  const connectorId = await svc.integrationSettings.getConnectorId('microsoft_graph');
  if (!connectorId) {
    throw new Error('connectorId not found — configure the integration before calling materializePage');
  }

  // Taken before this page's findings are ingested, mirroring graphSyncHandler: the real clock,
  // never the caller's syncStartedAt, since bulkUpsertEvidence stamps lastReportedAt with the
  // real clock too and the two must be comparable for the enumeration mark to mean anything.
  const enumeratedAt = new Date();

  const cveMap = new Map<string, { cveId: string, cvss: number | null, isExploitAvailable: boolean | null }>();
  for (const row of rows) {
    if (row.CveId !== '' && !cveMap.has(row.CveId)) {
      cveMap.set(row.CveId, { cveId: row.CveId, cvss: null, isExploitAvailable: null });
    }
  }
  await svc.cve.upsertDefenderReports([...cveMap.values()]);

  const deviceMap = new Map<string, typeof rows[number]>();
  for (const row of rows) {
    if (!deviceMap.has(row.DeviceId)) {
      deviceMap.set(row.DeviceId, row);
    }
  }
  const assetRows: Array<ConnectorAssetInput> = [...deviceMap.values()].map((row) => ({
    name: row.DeviceName ?? null,
    exposure: row.exposure,
    categoryId: row.categoryId,
    connectorId,
    source: 'microsoft_graph',
    sourceAssetId: row.DeviceId,
    criticality: row.criticality,
    firstSeenAt: syncStartedAt,
    lastSeenAt: syncStartedAt,
  }));
  const assetIdMap = await svc.supportingAssets.bulkUpsertAssets(assetRows);

  const cveIdMap = await svc.cve.getCveIdMap([...cveMap.keys()]);
  // bulkUpsertEvidence dedupes rows that target the same DB row (e.g. the same CVE
  // reported by multiple vulnerable packages on the same device), no need to do it here.
  const evidenceRows = rows
    .filter((row) => row.CveId !== '' && cveIdMap.has(row.CveId) && assetIdMap.has(row.DeviceId))
    .map((row) => ({
      id: uuidv7(),
      evaluatedAt: row.lastSeen ?? DEVICE_LAST_SEEN,
      supportingAssetId: assetIdMap.get(row.DeviceId)!,
      cveId: cveIdMap.get(row.CveId)!,
      mitreTechniqueId: null,
      expectationType: null,
      isExposed: true,
      connectorId,
      sourceFindingId: `${row.DeviceId}:${row.CveId}`,
      software: row.software,
    }));
  await svc.supportingAssets.bulkUpsertEvidence(evidenceRows);
  await svc.supportingAssets.markAssetsEnumerated({
    connectorId,
    supportingAssetIds: [...assetIdMap.values()],
    scope: '',
    enumeratedAt,
  });
  const dismissed = await svc.supportingAssets.recomputeEvidenceStateForAssets({
    supportingAssetIds: [...assetIdMap.values()],
    reason: NO_LONGER_REPORTED,
  });

  await svc.integrationSettings.markSynced('microsoft_graph', syncStartedAt);
  return dismissed;
};

/** What the asset's findings tab lists, in every state. */
const findingsOf = async (origin: EventOrigin, supportingAssetId: string) => (await services.withOrigin(origin).findingScore.listAssetFindings({
  supportingAssetId, page: 1, limit: 50, state: null, mitreTechniqueExternalId: null, expectationType: null, search: null, sortBy: 'name', sortDesc: false,
})).items;

const assetsOf = async (origin: EventOrigin) => (await services.withOrigin(origin).supportingAssets.listSupportingAssets({
  page: 1, limit: 50, search: null, source: null, mappedToOrganizationId: null, membershipOrganizationId: null, sortBy: 'name', sortDesc: false,
})).items;

describe('Microsoft Graph sync + materialization', () => {
  let adminOrigin: EventOrigin;
  let connectorOrigin: EventOrigin;
  let adminUserId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;

    // Create a service account that acts as the Defender connector identity
    const serviceAccountId = uuidv7();
    await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({
      id: serviceAccountId,
      name: 'Test Defender Bot',
    });

    await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('microsoft_graph', serviceAccountId);

    connectorOrigin = { type: 'connector', serviceAccountId, tenantId: setup.tenantId };
  });

  describe('run stamp', () => {
    const settings = () => services.withOrigin(adminOrigin).integrationSettings;

    it('is null when no sync has occurred', async () => {
      expect((await settings().getIntegrationSettings('microsoft_graph'))?.lastReportedAt).toBeNull();
    });

    it('markSynced persists the instant the sync began', async () => {
      const ts = new Date('2026-06-25T10:00:00Z');
      await services.withOrigin(connectorOrigin).integrationSettings.markSynced('microsoft_graph', ts);

      expect((await settings().getIntegrationSettings('microsoft_graph'))?.lastReportedAt).toEqual(ts);
    });
  });

  describe('materialize', () => {
    const syncStartedAt = new Date('2026-06-25T10:00:00Z');

    it('materializes one supporting_asset per unique DeviceId', async () => {
      await materializePage(connectorOrigin, [
        { DeviceId: 'dev-1', CveId: 'CVE-2024-001', DeviceName: 'Server1', categoryId: 'host', exposure: 'internet_facing', criticality: 'high' },
        { DeviceId: 'dev-1', CveId: 'CVE-2024-002', DeviceName: 'Server1', categoryId: 'host', exposure: 'internet_facing', criticality: 'high' },
      ], syncStartedAt);

      const assets = await assetsOf(adminOrigin);
      expect(assets).toHaveLength(1);
      expect(assets[0].name).toBe('Server1');
      expect(assets[0].exposure).toBe('internet_facing');
      expect(assets[0].categoryId).toBe('host');
      expect(assets[0].criticality).toBe('high');
    });

    it('creates one asset_evidence per DeviceId×CveId pair with applicable state', async () => {
      await materializePage(connectorOrigin, [
        { DeviceId: 'dev-1', CveId: 'CVE-2024-001', DeviceName: 'Server1', categoryId: 'host', exposure: 'internal', criticality: 'medium' },
        { DeviceId: 'dev-1', CveId: 'CVE-2024-002', DeviceName: 'Server1', categoryId: 'host', exposure: 'internal', criticality: 'medium' },
      ], syncStartedAt);

      const assets = await assetsOf(adminOrigin);
      expect(assets).toHaveLength(1);

      const evidence = await findingsOf(adminOrigin, assets[0].id);
      expect(evidence).toHaveLength(2);
      expect(evidence.every((e) => e.currentState === 'applicable')).toBe(true);
    });

    it('deduplicates multiple rows for the same DeviceId×CveId pair (e.g. multiple vulnerable packages) into a single evidence', async () => {
      await materializePage(connectorOrigin, [
        { DeviceId: 'dev-1', CveId: 'CVE-2024-001', DeviceName: 'Server1', categoryId: 'host', exposure: 'internal', criticality: 'medium' },
        { DeviceId: 'dev-1', CveId: 'CVE-2024-001', DeviceName: 'Server1', categoryId: 'host', exposure: 'internal', criticality: 'medium' },
        { DeviceId: 'dev-1', CveId: 'CVE-2024-001', DeviceName: 'Server1', categoryId: 'host', exposure: 'internal', criticality: 'medium' },
      ], syncStartedAt);

      const assets = await assetsOf(adminOrigin);
      expect(assets).toHaveLength(1);

      const evidence = await findingsOf(adminOrigin, assets[0].id);
      expect(evidence).toHaveLength(1);
    });

    it('upserts CVE shells so evidence FK targets exist', async () => {
      await materializePage(connectorOrigin, [
        { DeviceId: 'dev-1', CveId: 'CVE-2024-999', categoryId: 'host', exposure: 'internal', criticality: 'unknown' },
      ], syncStartedAt);

      const cveIdMap = await services.withOrigin(adminOrigin).cve.getCveIdMap(['CVE-2024-999']);
      expect(cveIdMap.has('CVE-2024-999')).toBe(true);
    });

    it('is idempotent — re-materializing the same data does not duplicate assets or evidence', async () => {
      const data = [
        { DeviceId: 'dev-1', CveId: 'CVE-2024-001', DeviceName: 'Server1', categoryId: 'host' as const, exposure: 'internal' as const, criticality: 'medium' as const },
      ];

      await materializePage(connectorOrigin, data, syncStartedAt);
      await materializePage(connectorOrigin, data, new Date('2026-06-26T10:00:00Z'));

      const assets = await assetsOf(adminOrigin);
      expect(assets).toHaveLength(1);

      const evidence = await findingsOf(adminOrigin, assets[0].id);
      expect(evidence).toHaveLength(1);
    });

    it('should ring nothing and move no updated_at when the same page is synced again', async () => {
      const page = [
        {
          DeviceId: 'dev-1', CveId: 'CVE-2024-001', DeviceName: 'Server1', categoryId: 'host' as const, exposure: 'internal' as const, criticality: 'medium' as const,
          software: [{ vendor: 'openssl', name: 'openssl', version: '3.0.15.0' }, { vendor: 'openssl', name: 'openssl', version: '4.0.2.0' }],
        },
        { DeviceId: 'dev-1', CveId: 'CVE-2024-002', DeviceName: 'Server1', categoryId: 'host' as const, exposure: 'internal' as const, criticality: 'medium' as const },
        { DeviceId: 'dev-2', CveId: '', DeviceName: 'Laptop2', categoryId: 'host' as const, exposure: 'internal' as const, criticality: 'medium' as const },
      ];
      const connectorId = (await services.withOrigin(connectorOrigin).integrationSettings.getConnectorId('microsoft_graph'))!;
      const reconcileRelations = async (observedAt: Date) => {
        const assets = await assetsOf(adminOrigin);
        await services.withOrigin(connectorOrigin).supportingAssets.reconcileConnectorRelations({
          connectorId,
          kind: 'primary_user_of',
          observedAt,
          relations: [{
            fromAssetId: assets.find((a) => a.name === 'Laptop2')!.id,
            toAssetId: assets.find((a) => a.name === 'Server1')!.id,
            source: 'entra_registered_owner',
          }],
          retiredIds: [],
        });
      };
      await materializePage(connectorOrigin, page, syncStartedAt);
      await reconcileRelations(syncStartedAt);

      await expectReplayedSyncSilent(async () => {
        const replayedAt = new Date('2026-06-26T10:00:00Z');
        await materializePage(connectorOrigin, page, replayedAt);
        await reconcileRelations(replayedAt);
      });
    });

    it('does not materialize assets into another tenant', async () => {
      await materializePage(connectorOrigin, [
        { DeviceId: 'dev-1', CveId: 'CVE-001', DeviceName: 'S1', categoryId: 'host', exposure: 'internal', criticality: 'unknown' },
      ], syncStartedAt);

      const tenantBId = await createTenant(services, adminUserId);
      const tenantBOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };

      const assetsB = await assetsOf(tenantBOrigin);
      expect(assetsB).toHaveLength(0);
    });
  });

  describe('findings Defender no longer reports', () => {
    const host = { DeviceName: 'Server1', categoryId: 'host' as const, exposure: 'internal' as const, criticality: 'medium' as const };
    // Real, ordered instants: materializePage compares its own enumeration mark against
    // lastReportedAt, which bulkUpsertEvidence always stamps with the real clock.
    const round = (n: number) => new Date(Date.now() + n * 1000);

    const evidenceOf = async (deviceName: string) => {
      const assets = await assetsOf(adminOrigin);
      const asset = assets.find((a) => a.name === deviceName)!;
      return findingsOf(adminOrigin, asset.id);
    };
    const historyOf = async (evidenceId: string) =>
      (await services.withOrigin(adminOrigin).supportingAssets.getEvidenceDetail(evidenceId))!.history;

    it('dismisses a finding a revisited device no longer carries, and brings it back once reported again', async () => {
      await materializePage(connectorOrigin, [
        { DeviceId: 'dev-1', CveId: 'CVE-2024-001', ...host },
        { DeviceId: 'dev-1', CveId: 'CVE-2024-002', ...host },
      ], round(1));

      const dismissed = await materializePage(connectorOrigin, [
        { DeviceId: 'dev-1', CveId: 'CVE-2024-001', ...host },
      ], round(2));

      expect(dismissed).toBe(1);
      const afterFix = await evidenceOf('Server1');
      expect(afterFix.find((e) => e.cveId === 'CVE-2024-001')!.currentState).toBe('applicable');
      const fixed = afterFix.find((e) => e.cveId === 'CVE-2024-002')!;
      expect(fixed.currentState).toBe('dismissed');
      const dismissal = (await historyOf(fixed.evidenceId)).at(-1)!;
      expect(dismissal.reason).toBe(NO_LONGER_REPORTED);
      expect(dismissal.origin).toBe('no_longer_reported');
      expect(dismissal.changedByUserId).toBeNull();
      expect(dismissal.dismissalType).toBeNull();

      const reported = await materializePage(connectorOrigin, [
        { DeviceId: 'dev-1', CveId: 'CVE-2024-001', ...host },
        { DeviceId: 'dev-1', CveId: 'CVE-2024-002', ...host },
      ], round(3));

      expect(reported).toBe(0);
      const back = (await evidenceOf('Server1')).find((e) => e.cveId === 'CVE-2024-002')!;
      expect(back.currentState).toBe('applicable');
      expect((await historyOf(back.evidenceId)).map((h) => h.state)).toEqual(['applicable', 'dismissed', 'applicable']);
    });

    it('dismisses every finding of a device that comes back without a vulnerability, and counts a re-sync as zero', async () => {
      await materializePage(connectorOrigin, [
        { DeviceId: 'dev-1', CveId: 'CVE-2024-001', ...host },
        { DeviceId: 'dev-1', CveId: 'CVE-2024-002', ...host },
      ], round(1));

      const dismissed = await materializePage(connectorOrigin, [{ DeviceId: 'dev-1', CveId: '', ...host }], round(2));
      const again = await materializePage(connectorOrigin, [{ DeviceId: 'dev-1', CveId: '', ...host }], round(3));

      expect(dismissed).toBe(2);
      expect(again).toBe(0);
      const evidence = await evidenceOf('Server1');
      expect(evidence).toHaveLength(2);
      expect(evidence.every((e) => e.currentState === 'dismissed')).toBe(true);
    });

    it('leaves alone the devices the page did not revisit', async () => {
      await materializePage(connectorOrigin, [
        { DeviceId: 'dev-1', CveId: 'CVE-2024-001', ...host },
        { DeviceId: 'dev-2', CveId: 'CVE-2024-001', ...host, DeviceName: 'Server2' },
      ], round(1));

      const dismissed = await materializePage(connectorOrigin, [{ DeviceId: 'dev-1', CveId: '', ...host }], round(2));

      expect(dismissed).toBe(1);
      expect((await evidenceOf('Server1'))[0].currentState).toBe('dismissed');
      expect((await evidenceOf('Server2'))[0].currentState).toBe('applicable');
    });

    it('never overrides a state a person set, and does not count it', async () => {
      await materializePage(connectorOrigin, [{ DeviceId: 'dev-1', CveId: 'CVE-2024-001', ...host }], round(1));
      const [evidence] = await evidenceOf('Server1');
      await services.withOrigin(adminOrigin).supportingAssets.markEvidenceApplicable({
        evidenceId: evidence.evidenceId,
        changedByUserId: adminUserId,
      });

      const dismissed = await materializePage(connectorOrigin, [{ DeviceId: 'dev-1', CveId: '', ...host }], round(2));

      expect(dismissed).toBe(0);
      const [after] = await evidenceOf('Server1');
      expect(after.currentState).toBe('applicable');
      expect(await historyOf(after.evidenceId)).toHaveLength(2);
    });

    /**
     * Mirrors what a real OpenAEV CVE sync writes: an asset-wide provenance row (scope '')
     * plus the enumeration mark that dates its own silence, taken before the
     * report the way `openaevSyncHandler` does. `bulkUpsertEvidence` stamps `lastReportedAt` with
     * the real clock, so this mark must be captured before it for the row to compare as fresh.
     */
    const reportViaOpenaev = async (otherConnectorId: string, supportingAssetId: string, cveId: string) => {
      const enumeratedAt = new Date();
      await services.withOrigin(adminOrigin).supportingAssets.bulkUpsertEvidence([{
        id: uuidv7(),
        evaluatedAt: new Date(),
        supportingAssetId,
        cveId,
        mitreTechniqueId: null,
        expectationType: null,
        isExposed: true,
        connectorId: otherConnectorId,
        sourceFindingId: 'other:CVE-2024-001',
      }]);
      await services.withOrigin(adminOrigin).supportingAssets.markAssetsEnumerated({
        connectorId: otherConnectorId,
        supportingAssetIds: [supportingAssetId],
        scope: '',
        enumeratedAt,
      });
    };

    it('leaves alone a finding another connector still reports', async () => {
      await materializePage(connectorOrigin, [{ DeviceId: 'dev-1', CveId: 'CVE-2024-001', ...host }], round(1));
      const defenderConnectorId = (await services.withOrigin(adminOrigin).integrationSettings.getConnectorId('microsoft_graph'))!;

      const otherServiceAccountId = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: otherServiceAccountId, name: 'Other Bot' });
      await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('openaev', otherServiceAccountId);
      const otherConnectorId = (await services.withOrigin(adminOrigin).integrationSettings.getConnectorId('openaev'))!;
      const [defenderEvidence] = await evidenceOf('Server1');
      const cveIdMap = await services.withOrigin(adminOrigin).cve.getCveIdMap(['CVE-2024-001']);
      await reportViaOpenaev(otherConnectorId, defenderEvidence.supportingAssetId, cveIdMap.get('CVE-2024-001')!);

      // Same CVE on the same asset is one finding whatever number of connectors report it (CAP-3).
      const merged = await evidenceOf('Server1');
      expect(merged).toHaveLength(1);
      const detail = await services.withOrigin(adminOrigin).supportingAssets.getEvidenceDetail(merged[0].evidenceId);
      expect(detail!.sources.map((s) => s.connectorId).sort()).toEqual([defenderConnectorId, otherConnectorId].sort());

      const dismissed = await materializePage(connectorOrigin, [{ DeviceId: 'dev-1', CveId: '', ...host }], round(2));

      // OpenAEV's own source still compares as fresher than its own last enumeration mark: the
      // OR across sources keeps the finding applicable regardless of what Defender now reports.
      expect(dismissed).toBe(0);
      expect((await evidenceOf('Server1'))[0].currentState).toBe('applicable');
    });

    it('dismisses a finding whose other connector has re-enumerated the asset without reporting it again', async () => {
      await materializePage(connectorOrigin, [{ DeviceId: 'dev-1', CveId: 'CVE-2024-001', ...host }], round(1));

      const otherServiceAccountId = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: otherServiceAccountId, name: 'Other Bot' });
      await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('openaev', otherServiceAccountId);
      const otherConnectorId = (await services.withOrigin(adminOrigin).integrationSettings.getConnectorId('openaev'))!;
      const [defenderEvidence] = await evidenceOf('Server1');
      const cveIdMap = await services.withOrigin(adminOrigin).cve.getCveIdMap(['CVE-2024-001']);
      await reportViaOpenaev(otherConnectorId, defenderEvidence.supportingAssetId, cveIdMap.get('CVE-2024-001')!);

      // OpenAEV walks this asset again and does not see the CVE this time: its mark moves past
      // the report above, so its own source stops standing behind the finding.
      await services.withOrigin(adminOrigin).supportingAssets.markAssetsEnumerated({
        connectorId: otherConnectorId,
        supportingAssetIds: [defenderEvidence.supportingAssetId],
        scope: '',
        enumeratedAt: new Date(),
      });

      const dismissed = await materializePage(connectorOrigin, [{ DeviceId: 'dev-1', CveId: '', ...host }], round(2));

      expect(dismissed).toBe(1);
      expect((await evidenceOf('Server1'))[0].currentState).toBe('dismissed');
    });
  });

  describe('Defender device id on the evidence source', () => {
    const svc = () => services.withOrigin(connectorOrigin);

    /** One asset reached through two Defender device ids, as a merge leaves it, and one CVE on it. */
    const seedMergedDevices = async () => {
      const connectorId = (await svc().integrationSettings.getConnectorId('microsoft_graph'))!;
      await svc().cve.upsertCves([{ cveId: 'CVE-2024-001' }]);
      const assetIdMap = await svc().supportingAssets.bulkUpsertAssets(['old-device', 'new-device'].map((sourceAssetId) => ({
        name: 'Server1',
        exposure: 'internal' as const,
        categoryId: 'host' as const,
        connectorId,
        source: 'microsoft_graph',
        sourceAssetId,
        criticality: 'medium' as const,
        firstSeenAt: new Date('2026-06-25T10:00:00Z'),
        lastSeenAt: new Date('2026-06-25T10:00:00Z'),
        mergedIntoSourceAssetId: sourceAssetId === 'old-device' ? 'new-device' : null,
      })));
      const cveId = (await svc().cve.getCveIdMap(['CVE-2024-001'])).get('CVE-2024-001')!;
      return { connectorId, cveId, supportingAssetId: assetIdMap.get('new-device')! };
    };

    const sourcesOf = async (supportingAssetId: string) => {
      const [evidence] = await findingsOf(adminOrigin, supportingAssetId);
      return (await services.withOrigin(adminOrigin).supportingAssets.getEvidenceDetail(evidence.evidenceId))!.sources;
    };

    const report = (
      seed: Awaited<ReturnType<typeof seedMergedDevices>>,
      deviceIds: Array<string>,
    ) => svc().supportingAssets.bulkUpsertEvidence(deviceIds.map((deviceId) => ({
      id: uuidv7(),
      evaluatedAt: new Date(),
      supportingAssetId: seed.supportingAssetId,
      cveId: seed.cveId,
      mitreTechniqueId: null,
      expectationType: null,
      isExposed: true,
      connectorId: seed.connectorId,
      sourceFindingId: `${seed.supportingAssetId}:CVE-2024-001`,
      externalReference: deviceId,
    })));

    it('keeps one source for the two sides of a merge, carrying one of their device ids', async () => {
      const seed = await seedMergedDevices();

      await report(seed, ['old-device', 'new-device']);

      const sources = await sourcesOf(seed.supportingAssetId);
      expect(sources).toHaveLength(1);
      expect(sources[0].sourceFindingId).toBe(`${seed.supportingAssetId}:CVE-2024-001`);
      expect(['old-device', 'new-device']).toContain(sources[0].externalReference);
    });

    it('fills in the device id on a source an earlier run wrote without one', async () => {
      const seed = await seedMergedDevices();
      await svc().supportingAssets.bulkUpsertEvidence([{
        id: uuidv7(),
        evaluatedAt: new Date(),
        supportingAssetId: seed.supportingAssetId,
        cveId: seed.cveId,
        mitreTechniqueId: null,
        expectationType: null,
        isExposed: true,
        connectorId: seed.connectorId,
        sourceFindingId: `${seed.supportingAssetId}:CVE-2024-001`,
      }]);
      expect((await sourcesOf(seed.supportingAssetId))[0].externalReference).toBeNull();

      await report(seed, ['new-device']);

      const sources = await sourcesOf(seed.supportingAssetId);
      expect(sources).toHaveLength(1);
      expect(sources[0].externalReference).toBe('new-device');
    });
  });

  describe('vulnerable software', () => {
    const host = { DeviceName: 'Mac1', categoryId: 'host' as const, exposure: 'internal' as const, criticality: 'medium' as const };
    const chrome = (version: string) => ({ vendor: 'google', name: 'chrome_for_mac', version });

    const detailOf = async () => {
      const [asset] = await assetsOf(adminOrigin);
      const [finding] = await findingsOf(adminOrigin, asset.id);
      return (await services.withOrigin(adminOrigin).supportingAssets.getEvidenceDetail(finding.evidenceId))!;
    };

    it('should show the software and version Defender names for a finding', async () => {
      await materializePage(connectorOrigin, [{ DeviceId: 'dev-1', CveId: 'CVE-2026-112992', ...host, software: [chrome('155.0.8059.85')] }], new Date());

      expect((await detailOf()).software).toEqual([chrome('155.0.8059.85')]);
    });

    it('should keep every version of one product Defender names on one finding', async () => {
      const versions = ['3.0.15.0', '3.0.18.0', '3.4.1.0', '3.4.6.0', '3.5.7.0', '3.5.8.0', '3.6.1.0', '3.6.3.0', '4.0.2.0'];
      await materializePage(connectorOrigin, [{
        DeviceId: 'dev-1', CveId: 'CVE-2026-35189', ...host,
        software: versions.map((version) => ({ vendor: 'openssl', name: 'openssl', version })),
      }], new Date());

      const { software } = await detailOf();
      expect(software.map((entry) => entry.version).sort()).toEqual(versions);
    });

    it('should name no software on a finding no source names any for', async () => {
      await materializePage(connectorOrigin, [{ DeviceId: 'dev-1', CveId: 'CVE-2026-1', ...host }], new Date());

      expect((await detailOf()).software).toEqual([]);
    });

    it('should replace a version Defender stops naming with the one it names now', async () => {
      await materializePage(connectorOrigin, [{ DeviceId: 'dev-1', CveId: 'CVE-2026-112992', ...host, software: [chrome('155.0.8059.85')] }], new Date());
      await materializePage(connectorOrigin, [{ DeviceId: 'dev-1', CveId: 'CVE-2026-112992', ...host, software: [chrome('156.0.1.2')] }], new Date());

      expect((await detailOf()).software).toEqual([chrome('156.0.1.2')]);
    });

    it('should keep the software of the newer observation when an older one is replayed after it', async () => {
      await materializePage(connectorOrigin, [{
        DeviceId: 'dev-1', CveId: 'CVE-2026-112992', ...host, software: [chrome('156.0.1.2')], lastSeen: new Date('2026-10-21T00:00:00Z'),
      }], new Date());
      await materializePage(connectorOrigin, [{
        DeviceId: 'dev-1', CveId: 'CVE-2026-112992', ...host, software: [chrome('155.0.8059.85')], lastSeen: new Date('2026-10-20T00:00:00Z'),
      }], new Date());

      expect((await detailOf()).software).toEqual([chrome('156.0.1.2')]);
    });

    it('should leave the software in place when a report says nothing about it', async () => {
      await materializePage(connectorOrigin, [{ DeviceId: 'dev-1', CveId: 'CVE-2026-112992', ...host, software: [chrome('155.0.8059.85')] }], new Date());
      await materializePage(connectorOrigin, [{ DeviceId: 'dev-1', CveId: 'CVE-2026-112992', ...host }], new Date());

      expect((await detailOf()).software).toEqual([chrome('155.0.8059.85')]);
    });

    it('should delete the software of a finding with it', async () => {
      await materializePage(connectorOrigin, [{ DeviceId: 'dev-1', CveId: 'CVE-2026-112992', ...host, software: [chrome('155.0.8059.85')] }], new Date());
      const { id } = await detailOf();

      await db.delete(assetEvidence).where(eq(assetEvidence.id, id));

      expect(await db.select().from(assetEvidenceSourceSoftware)).toEqual([]);
    });
  });
});

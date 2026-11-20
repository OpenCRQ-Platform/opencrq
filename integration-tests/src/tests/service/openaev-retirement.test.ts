import type { EventOrigin } from '@app/module';
import { assetEvidence, assetEvidenceHistory, assetEvidenceSources, TECHNIQUE_T1003, TECHNIQUE_T1003_001 } from '@app/module';
import { asc, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { evidenceRowsOfAsset } from '../../helpers/evidence-rows';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const RETIREMENT_REASON = 'No longer reported by OpenAEV';
const SCENARIO = 'scenario-1';

const pause = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('OpenAEV evidence retirement', () => {
  let adminOrigin: EventOrigin;
  let connectorOrigin: EventOrigin;
  let tenantId: string;
  let adminUserId: string;
  let connectorId: string;
  let otherConnectorId: string;
  let assetId: string;

  const writeEvidence = (
    platformType: string,
    options: { connector?: string, scope?: string, technique?: string, asset?: string } = {},
  ) => services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertEvidence([{
    id: uuidv7(),
    evaluatedAt: new Date(),
    supportingAssetId: options.asset ?? assetId,
    cveId: null,
    mitreTechniqueId: options.technique ?? TECHNIQUE_T1003,
    expectationType: 'detection',
    isExposed: true,
    securityPlatformType: platformType,
    connectorId: options.connector ?? connectorId,
    sourceScenarioId: options.scope ?? SCENARIO,
    sourceSimulationId: 'sim-1',
    sourceInjectId: 'inject-1',
    sourceFindingId: `${options.asset ?? assetId}:${options.technique ?? TECHNIQUE_T1003}:${platformType}:${options.scope ?? SCENARIO}`,
    scope: options.scope ?? SCENARIO,
  }]);

  const sourcesOf = async () => {
    const rows = await db.select({
      id: assetEvidenceSources.id,
      connectorId: assetEvidenceSources.connectorId,
      scope: assetEvidenceSources.scope,
      lastReportedAt: assetEvidenceSources.lastReportedAt,
      updatedAt: assetEvidenceSources.updatedAt,
      evaluatedAt: assetEvidenceSources.evaluatedAt,
      isExposed: assetEvidenceSources.isExposed,
      securityPlatformType: assetEvidence.securityPlatformType,
      mitreTechniqueId: assetEvidence.mitreTechniqueId,
    })
      .from(assetEvidenceSources)
      .innerJoin(assetEvidence, eq(assetEvidence.id, assetEvidenceSources.assetEvidenceId));
    return rows;
  };

  const statesOf = async () => {
    const evidence = await evidenceRowsOfAsset(assetId);
    return evidence.map((row) => row.currentState);
  };

  const key = (overrides: Partial<{ scope: string, mitreTechniqueId: string, supportingAssetId: string, securityPlatformTypes: Array<string> }> = {}) => ({
    supportingAssetId: assetId,
    scope: SCENARIO,
    mitreTechniqueId: TECHNIQUE_T1003,
    expectationType: 'detection' as const,
    securityPlatformTypes: ['EDR', 'SIEM'],
    ...overrides,
  });

  const enumerateAndRecompute = async (enumeratedAt: Date) => {
    const svc = services.withOrigin(connectorOrigin);
    await svc.supportingAssets.markAssetsEnumerated({ connectorId, supportingAssetIds: [assetId], scope: SCENARIO, enumeratedAt });
    return svc.supportingAssets.recomputeEvidenceStateForAssets({ supportingAssetIds: [assetId], reason: RETIREMENT_REASON });
  };

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
    adminUserId = setup.userId;

    const serviceAccountId = uuidv7();
    await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'OpenAEV Bot' });
    await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('openaev', serviceAccountId);
    connectorOrigin = { type: 'connector', serviceAccountId, tenantId };
    connectorId = (await services.withOrigin(connectorOrigin).integrationSettings.getConnectorId('openaev'))!;

    const graphAccountId = uuidv7();
    await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: graphAccountId, name: 'Graph Bot' });
    await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('microsoft_graph', graphAccountId);
    otherConnectorId = (await services.withOrigin({ type: 'connector', serviceAccountId: graphAccountId, tenantId }).integrationSettings.getConnectorId('microsoft_graph'))!;

    assetId = uuidv7();
    await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
      id: assetId, name: 'endpoint-1', description: null, ownerId: null, exposure: 'internal', categoryId: 'host',
    });
  });

  describe('refreshEvidenceSources', () => {
    it('keeps every listed platform type of a refreshed finding applicable through a full re-read', async () => {
      await writeEvidence('EDR');
      await writeEvidence('SIEM');
      await pause();
      const t0 = new Date();
      await pause();

      const refreshed = await services.withOrigin(connectorOrigin).supportingAssets.refreshEvidenceSources({
        connectorId, keys: [key()], reportedAt: t0,
      });
      const dismissed = await enumerateAndRecompute(t0);

      expect(refreshed).toBe(2);
      expect(dismissed).toBe(0);
      expect(await statesOf()).toEqual(['applicable', 'applicable']);
    });

    it('refreshes only the listed platform types and lets the others lapse', async () => {
      await writeEvidence('EDR');
      await writeEvidence('SIEM');
      await pause();
      const t0 = new Date();
      await pause();

      const refreshed = await services.withOrigin(connectorOrigin).supportingAssets.refreshEvidenceSources({
        connectorId, keys: [key({ securityPlatformTypes: ['EDR'] })], reportedAt: t0,
      });
      const dismissed = await enumerateAndRecompute(t0);

      expect(refreshed).toBe(1);
      expect(dismissed).toBe(1);
      const stateByType = new Map((await evidenceRowsOfAsset(assetId))
        .map((row) => [row.securityPlatformType, row.currentState]));
      expect(stateByType.get('EDR')).toBe('applicable');
      expect(stateByType.get('SIEM')).toBe('dismissed');
    });

    it('matches a platform type of its own, the unknown one included', async () => {
      await writeEvidence('unknown');
      await writeEvidence('EDR');
      await pause();

      const refreshed = await services.withOrigin(connectorOrigin).supportingAssets.refreshEvidenceSources({
        connectorId, keys: [key({ securityPlatformTypes: ['unknown'] })], reportedAt: new Date(),
      });

      expect(refreshed).toBe(1);
    });

    it('refreshes the platform types of every key given, each against its own technique', async () => {
      await writeEvidence('EDR');
      await writeEvidence('SIEM', { technique: TECHNIQUE_T1003_001 });
      await writeEvidence('EDR', { technique: TECHNIQUE_T1003_001 });
      await pause();

      const refreshed = await services.withOrigin(connectorOrigin).supportingAssets.refreshEvidenceSources({
        connectorId,
        keys: [
          key({ securityPlatformTypes: ['EDR'] }),
          key({ mitreTechniqueId: TECHNIQUE_T1003_001, securityPlatformTypes: ['SIEM'] }),
        ],
        reportedAt: new Date(),
      });

      expect(refreshed).toBe(2);
    });

    it('refreshes nothing for a key with no platform type', async () => {
      await writeEvidence('EDR');

      expect(await services.withOrigin(connectorOrigin).supportingAssets.refreshEvidenceSources({
        connectorId, keys: [key({ securityPlatformTypes: [] })], reportedAt: new Date(Date.now() + 60_000),
      })).toBe(0);
    });

    it('dismisses every platform type of a finding that was not refreshed', async () => {
      await writeEvidence('EDR');
      await writeEvidence('SIEM');
      await pause();

      const dismissed = await enumerateAndRecompute(new Date());

      expect(dismissed).toBe(2);
      expect(await statesOf()).toEqual(['dismissed', 'dismissed']);
      const reasons = await db.select({ reason: assetEvidenceHistory.reason }).from(assetEvidenceHistory)
        .where(eq(assetEvidenceHistory.state, 'dismissed'));
      expect(reasons.map((r) => r.reason)).toEqual([RETIREMENT_REASON, RETIREMENT_REASON]);
    });

    it('writes the retirement of a finding a person handed back, though it was already dismissed', async () => {
      await writeEvidence('EDR');
      const [finding] = await evidenceRowsOfAsset(assetId);
      const admin = services.withOrigin(adminOrigin).supportingAssets;
      await admin.dismissEvidence({ evidenceId: finding.id, dismissalType: 'false_positive', reasonCode: 'detection_error', reason: 'Noise', changedByUserId: adminUserId });
      await admin.resetEvidenceState({ evidenceId: finding.id, changedByUserId: adminUserId });
      await pause();

      const dismissed = await enumerateAndRecompute(new Date());
      await enumerateAndRecompute(new Date());

      expect(dismissed).toBe(0);
      const history = await db.select({ origin: assetEvidenceHistory.origin, state: assetEvidenceHistory.state }).from(assetEvidenceHistory)
        .orderBy(asc(assetEvidenceHistory.stateChangedAt), asc(assetEvidenceHistory.id));
      expect(history).toEqual([
        { origin: 'exposed', state: 'applicable' },
        { origin: 'user', state: 'dismissed' },
        { origin: 'reset', state: 'dismissed' },
        { origin: 'no_longer_reported', state: 'dismissed' },
      ]);
    });

    it('does not refresh another connector\'s source on the same finding', async () => {
      await writeEvidence('EDR');
      await writeEvidence('EDR', { connector: otherConnectorId });
      await pause();
      const t0 = new Date();

      const refreshed = await services.withOrigin(connectorOrigin).supportingAssets.refreshEvidenceSources({
        connectorId, keys: [key()], reportedAt: t0,
      });

      expect(refreshed).toBe(1);
      const sources = await sourcesOf();
      expect(sources.find((s) => s.connectorId === connectorId)!.lastReportedAt.getTime()).toBe(t0.getTime());
      expect(sources.find((s) => s.connectorId === otherConnectorId)!.lastReportedAt.getTime()).toBeLessThan(t0.getTime());
    });

    it('does not refresh a source of another scope or another technique', async () => {
      await writeEvidence('EDR');
      await writeEvidence('EDR', { scope: 'scenario-2' });
      await writeEvidence('EDR', { technique: TECHNIQUE_T1003_001 });
      await pause();
      const t0 = new Date();

      const refreshed = await services.withOrigin(connectorOrigin).supportingAssets.refreshEvidenceSources({
        connectorId, keys: [key()], reportedAt: t0,
      });

      expect(refreshed).toBe(1);
      const untouched = (await sourcesOf()).filter((s) => s.lastReportedAt.getTime() < t0.getTime());
      expect(untouched.map((s) => [s.scope, s.mitreTechniqueId]).sort()).toEqual([
        [SCENARIO, TECHNIQUE_T1003_001],
        ['scenario-2', TECHNIQUE_T1003],
      ].sort());
    });

    it('never moves a source back to an earlier instant', async () => {
      await writeEvidence('EDR');
      const [before] = await sourcesOf();
      const earlier = new Date(before.lastReportedAt.getTime() - 60_000);

      const refreshed = await services.withOrigin(connectorOrigin).supportingAssets.refreshEvidenceSources({
        connectorId, keys: [key()], reportedAt: earlier,
      });

      expect(refreshed).toBe(1);
      const [after] = await sourcesOf();
      expect(after.lastReportedAt.getTime()).toBe(before.lastReportedAt.getTime());
    });

    it('moves only the sync clock, leaving verdict, evaluation and history alone', async () => {
      await writeEvidence('EDR');
      const [before] = await sourcesOf();
      const historyBefore = await db.select().from(assetEvidenceHistory);
      const later = new Date(before.lastReportedAt.getTime() + 60_000);

      await services.withOrigin(connectorOrigin).supportingAssets.refreshEvidenceSources({
        connectorId, keys: [key()], reportedAt: later,
      });

      const [after] = await sourcesOf();
      expect(after.lastReportedAt.getTime()).toBe(later.getTime());
      expect(after.isExposed).toBe(before.isExposed);
      expect(after.evaluatedAt).toEqual(before.evaluatedAt);
      expect(after.updatedAt).toEqual(before.updatedAt);
      expect(await db.select().from(assetEvidenceHistory)).toEqual(historyBefore);
    });

    it('refreshes nothing for an empty key list', async () => {
      await writeEvidence('EDR');

      expect(await services.withOrigin(connectorOrigin).supportingAssets.refreshEvidenceSources({
        connectorId, keys: [], reportedAt: new Date(),
      })).toBe(0);
    });

    it('leaves another tenant\'s sources untouched', async () => {
      await writeEvidence('EDR');
      const [before] = await sourcesOf();
      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };

      const refreshed = await services.withOrigin(otherOrigin).supportingAssets.refreshEvidenceSources({
        connectorId, keys: [key()], reportedAt: new Date(before.lastReportedAt.getTime() + 60_000),
      });

      expect(refreshed).toBe(0);
      const [after] = await sourcesOf();
      expect(after.lastReportedAt.getTime()).toBe(before.lastReportedAt.getTime());
    });
  });

  describe('findEvidenceScopePairsForConnector', () => {
    it('lists each (asset, scope) of the technique sources once, without the CVE sources nor other connectors', async () => {
      const secondAssetId = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id: secondAssetId, name: 'endpoint-2', description: null, ownerId: null, exposure: 'internal', categoryId: 'host',
      });
      await writeEvidence('EDR');
      await writeEvidence('SIEM');
      await writeEvidence('EDR', { scope: 'scenario-2' });
      await writeEvidence('EDR', { asset: secondAssetId });
      await writeEvidence('EDR', { connector: otherConnectorId, scope: 'scenario-3' });
      await services.withOrigin(adminOrigin).cve.upsertCves([{ cveId: 'CVE-2024-555' }]);
      const cveUuid = (await services.withOrigin(adminOrigin).cve.getCveIdMap(['CVE-2024-555'])).get('CVE-2024-555')!;
      for (const scope of ['', 'oaev-1']) {
        await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertEvidence([{
          id: uuidv7(),
          evaluatedAt: new Date(),
          supportingAssetId: assetId,
          cveId: cveUuid,
          mitreTechniqueId: null,
          expectationType: null,
          isExposed: true,
          connectorId,
          sourceFindingId: `${scope}:CVE-2024-555`,
          scope,
        }]);
      }

      const pairs = await services.withOrigin(connectorOrigin).supportingAssets.findEvidenceScopePairsForConnector(connectorId);

      const sorted = (list: Array<{ supportingAssetId: string, scope: string }>) =>
        list.map((p) => `${p.supportingAssetId}|${p.scope}`).sort();
      expect(sorted(pairs)).toEqual(sorted([
        { supportingAssetId: assetId, scope: SCENARIO },
        { supportingAssetId: assetId, scope: 'scenario-2' },
        { supportingAssetId: secondAssetId, scope: SCENARIO },
      ]));
    });

    it('does not list another tenant\'s sources', async () => {
      await writeEvidence('EDR');
      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };

      expect(await services.withOrigin(otherOrigin).supportingAssets.findEvidenceScopePairsForConnector(connectorId)).toEqual([]);
    });
  });
});

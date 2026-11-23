import type { EventOrigin, EvidenceActivityScope } from '@app/module';
import { assetEvidence, assetEvidenceHistory, assetEvidenceSources, assetEvidenceVerdicts, ConnectorBackedEvidenceError, createProtectedDB, createSecuredSchema, cve, EVIDENCE_ACTIVITY_DAYS, EvidenceAlreadyExistsError, findingScoreHistory, findingScores, integrationSettings, supportingAssetTags, tags, tagSources, TECHNIQUE_T1003 } from '@app/module';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { insertSyncedVerdict } from '../../helpers/evidence-rows';
import { createTenant, createTenantUser, createTenantWithAdmin } from '../../helpers/factories';
import { holdWriteOpen, waitUntilBlockedByAnotherBackend } from '../../helpers/held-transaction';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const insertCve = async (tenantId: string, cveTextId: string): Promise<string> => {
  const id = uuidv7();
  await db.insert(cve).values([{ id, tenantId, cveId: cveTextId }]);
  return id;
};

/** What the asset's findings tab lists, in every state. */
const findingsOf = async (origin: EventOrigin, supportingAssetId: string) => (await services.withOrigin(origin).findingScore.listAssetFindings({
  supportingAssetId, page: 1, limit: 50, state: null, mitreTechniqueExternalId: null, expectationType: null, search: null, sortBy: 'name', sortDesc: false,
})).items;

type VersionedTable = 'supporting_assets' | 'supporting_asset_sources' | 'supporting_asset_machine_properties' | 'supporting_asset_tags' | 'tags' | 'tag_sources';

/** xmin is the row version: it only moves when Postgres actually rewrites the row. */
const rowVersions = async (table: VersionedTable): Promise<Map<string, string>> => {
  const { rows } = await db.execute<{ id: string, v: string }>(sql`SELECT id::text AS id, xmin::text AS v FROM ${sql.raw(table)}`);
  return new Map(rows.map((row) => [row.id, row.v]));
};

const movedRowIds = (before: Map<string, string>, after: Map<string, string>): Array<string> =>
  [...after].filter(([id, version]) => before.get(id) !== version).map(([id]) => id);

describe('Supporting Assets Service', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let adminTenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    adminTenantId = setup.tenantId;
  });

  describe('asset evidence', () => {
    let assetId: string;

    beforeEach(async () => {
      assetId = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id: assetId, name: 'Asset with findings', description: null,
        ownerId: null, exposure: 'internet_facing', categoryId: 'host',
      });
    });

    it('should create evidence and auto-create first history entry as applicable', async () => {
      const tenantId = adminTenantId;
      const cveUuid = await insertCve(tenantId, 'CVE-2023-1234');
      await services.withOrigin(adminOrigin).supportingAssets.createEvidence({
        id: uuidv7(),
        supportingAssetId: assetId,
        cve: { rowId: cveUuid },
        userId: adminUserId,
      });

      const evidences = await findingsOf(adminOrigin, assetId);
      expect(evidences).toHaveLength(1);
      expect(evidences[0].cveId).toBe('CVE-2023-1234');
      expect(evidences[0].currentState).toBe('applicable');
    });

    it('should refuse to attach another tenant\'s CVE, as an unknown one, and the database refuses it too', async () => {
      const otherTenantId = await createTenant(services, adminUserId);
      const foreignCveId = await insertCve(otherTenantId, 'CVE-2023-7777');
      const attach = (cveId: string) => services.withOrigin(adminOrigin).supportingAssets.createEvidence({
        id: uuidv7(), supportingAssetId: assetId, cve: { rowId: cveId }, userId: adminUserId,
      });

      await expect(attach(foreignCveId)).rejects.toThrow('CVE not found');
      await expect(attach(uuidv7())).rejects.toThrow('CVE not found');
      await expect(db.insert(assetEvidence).values({ id: uuidv7(), tenantId: adminTenantId, supportingAssetId: assetId, cveId: foreignCveId }))
        .rejects.toMatchObject({ cause: { code: '23503', constraint: 'asset_evidence_cve_tenant_fk' } });
      expect(await db.select().from(assetEvidence)).toHaveLength(0);
    });

    it('should enforce unique (supporting_asset_id, cve_id, mitre_technique_id, expectation_type, security_platform_type, connector_id, source_scenario_id)', async () => {
      const userId = adminUserId;
      const tenantId = adminTenantId;
      const cveUuid = await insertCve(tenantId, 'CVE-2023-9999');
      await services.withOrigin(adminOrigin).supportingAssets.createEvidence({
        id: uuidv7(), supportingAssetId: assetId,
        cve: { rowId: cveUuid }, userId,
      });

      await expect(
        services.withOrigin(adminOrigin).supportingAssets.createEvidence({
          id: uuidv7(), supportingAssetId: assetId,
          cve: { rowId: cveUuid }, userId,
        }),
      ).rejects.toBeInstanceOf(EvidenceAlreadyExistsError);
    });

    it('should throw a business conflict error when two different users attach the same CVE to the same asset', async () => {
      const tenantId = adminTenantId;
      const cveUuid = await insertCve(tenantId, 'CVE-2023-4444');
      const secondUser = await createTenantUser(services, db, adminOrigin);

      await services.withOrigin(adminOrigin).supportingAssets.createEvidence({
        id: uuidv7(),
        supportingAssetId: assetId,
        cve: { rowId: cveUuid },
        userId: adminUserId,
      });

      await expect(
        services.withOrigin(secondUser.origin).supportingAssets.createEvidence({
          id: uuidv7(),
          supportingAssetId: assetId,
          cve: { rowId: cveUuid },
          userId: secondUser.userId,
        }),
      ).rejects.toBeInstanceOf(EvidenceAlreadyExistsError);
    });

    it('should delete a hand-attached finding with its history, its score and the score journal', async () => {
      const tenantId = adminTenantId;
      const cveUuid = await insertCve(tenantId, 'CVE-2023-7777');
      const evidenceId = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createEvidence({
        id: evidenceId,
        supportingAssetId: assetId,
        cve: { rowId: cveUuid },
        userId: adminUserId,
        changedByUserId: adminUserId,
      });
      // The recompute job is the only writer of these two, so the projection is seeded by hand
      // here: what is under test is the cascade, not how the figures were arrived at.
      await db.insert(findingScores).values({
        assetEvidenceId: evidenceId,
        tenantId,
        score: 42,
        band: 'medium',
        exploitability: 0.5,
        impact: 0.5,
      });
      await db.insert(findingScoreHistory).values({
        id: uuidv7(),
        assetEvidenceId: evidenceId,
        tenantId,
        score: 42,
        band: 'medium',
        changedAt: new Date(),
      });

      await services.withOrigin(adminOrigin).supportingAssets.deleteEvidence({ evidenceId });

      expect(await findingsOf(adminOrigin, assetId)).toHaveLength(0);
      expect(await db.select().from(assetEvidence).where(eq(assetEvidence.id, evidenceId))).toHaveLength(0);
      expect(await db.select().from(assetEvidenceHistory)
        .where(eq(assetEvidenceHistory.assetEvidenceId, evidenceId))).toHaveLength(0);
      expect(await db.select().from(findingScores)
        .where(eq(findingScores.assetEvidenceId, evidenceId))).toHaveLength(0);
      expect(await db.select().from(findingScoreHistory)
        .where(eq(findingScoreHistory.assetEvidenceId, evidenceId))).toHaveLength(0);
    });

    it('should refuse to delete a finding a connector reported', async () => {
      const serviceAccountId = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({
        id: serviceAccountId, name: 'Test Connector Bot',
      });
      await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('openaev', serviceAccountId);
      const connectorId = (await services.withOrigin(adminOrigin).integrationSettings.getConnectorId('openaev'))!;

      await services.withOrigin(adminOrigin).supportingAssets.bulkUpsertEvidence([{
        id: uuidv7(), evaluatedAt: new Date(), supportingAssetId: assetId, cveId: null, mitreTechniqueId: TECHNIQUE_T1003,
        expectationType: 'detection', isExposed: true, securityPlatformType: 'SIEM',
        connectorId,
        sourceScenarioId: 'scenario-1', sourceSimulationId: 'ex-1', sourceInjectId: 'inject-1', sourceFindingId: 'finding-1',
      }]);
      const [evidence] = await findingsOf(adminOrigin, assetId);

      await expect(
        services.withOrigin(adminOrigin).supportingAssets.deleteEvidence({ evidenceId: evidence.evidenceId }),
      ).rejects.toBeInstanceOf(ConnectorBackedEvidenceError);
      expect(await db.select().from(assetEvidence).where(eq(assetEvidence.id, evidence.evidenceId))).toHaveLength(1);
    });

    it('should not let another tenant delete a finding', async () => {
      const cveUuid = await insertCve(adminTenantId, 'CVE-2023-8888');
      const evidenceId = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createEvidence({
        id: evidenceId,
        supportingAssetId: assetId,
        cve: { rowId: cveUuid },
        userId: adminUserId,
        changedByUserId: adminUserId,
      });
      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };

      await expect(
        services.withOrigin(otherOrigin).supportingAssets.deleteEvidence({ evidenceId }),
      ).rejects.toThrow();
      expect(await db.select().from(assetEvidence).where(eq(assetEvidence.id, evidenceId))).toHaveLength(1);
    });

    it('should hide a finding\'s history and test verdicts from another tenant, and refuse its writes to them', async () => {
      const serviceAccountId = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'Test Connector Bot' });
      await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('openaev', serviceAccountId);
      const connectorId = (await services.withOrigin(adminOrigin).integrationSettings.getConnectorId('openaev'))!;
      await services.withOrigin(adminOrigin).supportingAssets.bulkUpsertEvidence([{
        id: uuidv7(), evaluatedAt: new Date(), supportingAssetId: assetId, cveId: null, mitreTechniqueId: TECHNIQUE_T1003,
        expectationType: 'detection', isExposed: true, securityPlatformType: 'SIEM', connectorId, sourceFindingId: 'finding-1',
      }]);
      const [finding] = await findingsOf(adminOrigin, assetId);
      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };
      const ownViews = createSecuredSchema(db, adminOrigin);
      const otherViews = createSecuredSchema(db, otherOrigin);

      expect(await db.select().from(ownViews.assetEvidenceHistory)).toHaveLength(1);
      expect(await db.select().from(ownViews.assetEvidenceVerdicts)).toHaveLength(1);
      expect(await db.select().from(otherViews.assetEvidenceHistory)).toEqual([]);
      expect(await db.select().from(otherViews.assetEvidenceVerdicts)).toEqual([]);

      const otherDb = createProtectedDB(db, (callback) => db.transaction(callback), otherOrigin);
      const at = new Date();
      await expect(otherDb.insert(assetEvidenceHistory).values([{
        id: uuidv7(), tenantId: adminTenantId, assetEvidenceId: finding.evidenceId, state: 'dismissed', stateChangedAt: at, changedByUserId: null, origin: 'not_exposed',
      }])).rejects.toThrow('Cannot create for another tenant');
      await expect(otherDb.insert(assetEvidenceVerdicts).values([{
        id: uuidv7(), tenantId: adminTenantId, assetEvidenceId: finding.evidenceId, isExposed: false, observedAt: at, recordedAt: at,
      }])).rejects.toThrow('Cannot create for another tenant');
      await expect(otherDb.insert(assetEvidenceVerdicts).values([{
        id: uuidv7(), tenantId: otherTenantId, assetEvidenceId: finding.evidenceId, isExposed: false, observedAt: at, recordedAt: at,
      }])).rejects.toMatchObject({ cause: { code: '23503', constraint: 'asset_evidence_verdicts_evidence_tenant_fk' } });
      expect(await db.select().from(assetEvidenceVerdicts)).toHaveLength(1);
    });

    it('should still refuse to delete a finding whose connector was deleted, its observation standing', async () => {
      const serviceAccountId = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({
        id: serviceAccountId, name: 'Test Connector Bot',
      });
      await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('openaev', serviceAccountId);
      const connectorId = (await services.withOrigin(adminOrigin).integrationSettings.getConnectorId('openaev'))!;

      await services.withOrigin(adminOrigin).supportingAssets.bulkUpsertEvidence([{
        id: uuidv7(), evaluatedAt: new Date(), supportingAssetId: assetId, cveId: null, mitreTechniqueId: TECHNIQUE_T1003,
        expectationType: 'detection', isExposed: true, securityPlatformType: 'SIEM',
        connectorId,
        sourceScenarioId: 'scenario-1', sourceSimulationId: 'ex-1', sourceInjectId: 'inject-1', sourceFindingId: 'finding-1',
      }]);
      const [evidence] = await findingsOf(adminOrigin, assetId);
      await db.delete(integrationSettings).where(eq(integrationSettings.id, connectorId));

      await expect(
        services.withOrigin(adminOrigin).supportingAssets.deleteEvidence({ evidenceId: evidence.evidenceId }),
      ).rejects.toBeInstanceOf(ConnectorBackedEvidenceError);
    });

    it('should refuse a delete that a connector observes while it runs, rather than cascade the observation away', async () => {
      const serviceAccountId = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({
        id: serviceAccountId, name: 'Test Connector Bot',
      });
      await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('openaev', serviceAccountId);
      const connectorId = (await services.withOrigin(adminOrigin).integrationSettings.getConnectorId('openaev'))!;
      const cveUuid = await insertCve(adminTenantId, 'CVE-2023-6666');
      const evidenceId = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createEvidence({
        id: evidenceId,
        supportingAssetId: assetId,
        cve: { rowId: cveUuid },
        userId: adminUserId,
        changedByUserId: adminUserId,
      });

      const syncing = holdWriteOpen((tx) => tx.insert(assetEvidenceSources).values({
        id: uuidv7(),
        tenantId: adminTenantId,
        assetEvidenceId: evidenceId,
        connectorId,
        sourceFindingId: 'race-1',
        isExposed: true,
      }));
      await syncing.locked;

      const deleting = services.withOrigin(adminOrigin).supportingAssets.deleteEvidence({ evidenceId });
      const blocked = await waitUntilBlockedByAnotherBackend();
      syncing.commit();
      await syncing.done;

      // Without the row lock the delete reads no source, since the insert is still uncommitted,
      // and goes on to destroy it through the cascade.
      expect(blocked).toBe(true);
      await expect(deleting).rejects.toBeInstanceOf(ConnectorBackedEvidenceError);
      expect(await db.select().from(assetEvidence).where(eq(assetEvidence.id, evidenceId))).toHaveLength(1);
      expect(await db.select().from(assetEvidenceSources)
        .where(eq(assetEvidenceSources.assetEvidenceId, evidenceId))).toHaveLength(1);
    });

    it('requires a userId: connector-attributed findings go through bulkUpsertEvidence, never createEvidence', async () => {
      const tenantId = adminTenantId;
      const cveUuid = await insertCve(tenantId, 'CVE-2023-5555');
      await expect(
        services.withOrigin(adminOrigin).supportingAssets.createEvidence({
          id: uuidv7(), supportingAssetId: assetId,
          cve: { rowId: cveUuid },
          userId: null,
        }),
      ).rejects.toThrow();
    });

    it('bulkUpsertEvidence dedupes rows targeting the same DB row within a single call', async () => {
      // Simulates a connector sync producing several raw rows for the same finding
      // (e.g. the same MITRE technique reported via two overlapping OpenAEV findings with
      // no inject reference): bulkUpsertEvidence must not send them in the same INSERT
      // statement's ON CONFLICT target, or Postgres would raise
      // "ON CONFLICT DO UPDATE command cannot affect row a second time".
      const serviceAccountId = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({
        id: serviceAccountId, name: 'Test Connector Bot',
      });
      await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('openaev', serviceAccountId);
      const connectorId = (await services.withOrigin(adminOrigin).integrationSettings.getConnectorId('openaev'))!;

      await services.withOrigin(adminOrigin).supportingAssets.bulkUpsertEvidence([
        {
          id: uuidv7(), evaluatedAt: new Date(), supportingAssetId: assetId, cveId: null, mitreTechniqueId: TECHNIQUE_T1003,
          expectationType: 'detection', isExposed: true, securityPlatformType: 'SIEM',
          connectorId,
          sourceScenarioId: 'scenario-1', sourceSimulationId: 'ex-1', sourceInjectId: 'inject-1', sourceFindingId: 'finding-1',
        },
        {
          id: uuidv7(), evaluatedAt: new Date(), supportingAssetId: assetId, cveId: null, mitreTechniqueId: TECHNIQUE_T1003,
          expectationType: 'detection', isExposed: false, securityPlatformType: 'SIEM',
          connectorId,
          sourceScenarioId: 'scenario-1', sourceSimulationId: 'ex-2', sourceInjectId: 'inject-2', sourceFindingId: 'f2',
        },
      ]);

      const evidences = await findingsOf(adminOrigin, assetId);
      expect(evidences).toHaveLength(1);
      expect(evidences[0].mitreTechniqueExternalId).toBe('T1003');
    });

    it('bulkUpsertEvidence keeps a finding exposed while one of two sources reporting it at one instant says so, in either order', async () => {
      const serviceAccountId = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({
        id: serviceAccountId, name: 'Test Connector Bot',
      });
      await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('openaev', serviceAccountId);
      const connectorId = (await services.withOrigin(adminOrigin).integrationSettings.getConnectorId('openaev'))!;
      const evaluatedAt = new Date('2026-02-01T00:00:00Z');

      const assetId2 = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id: assetId2, name: 'Asset with same-time findings', description: null,
        ownerId: null, exposure: 'internet_facing', categoryId: 'host',
      });

      const upsertForAsset = async (targetAssetId: string, rows: Array<{ id: string, isExposed: boolean, sourceFindingId: string }>) => {
        await services.withOrigin(adminOrigin).supportingAssets.bulkUpsertEvidence(rows.map((row) => ({
          id: row.id,
          supportingAssetId: targetAssetId,
          cveId: null,
          mitreTechniqueId: TECHNIQUE_T1003,
          expectationType: 'detection',
          isExposed: row.isExposed,
          securityPlatformType: 'SIEM',
          evaluatedAt,
          connectorId,
          sourceScenarioId: 'scenario-1',
          sourceSimulationId: 'sim-1',
          sourceInjectId: 'inject-1',
          sourceFindingId: row.sourceFindingId,
        })));
      };

      await upsertForAsset(assetId, [
        { id: uuidv7(), isExposed: true, sourceFindingId: 'finding-b' },
        { id: uuidv7(), isExposed: false, sourceFindingId: 'finding-a' },
      ]);
      await upsertForAsset(assetId2, [
        { id: uuidv7(), isExposed: false, sourceFindingId: 'finding-a' },
        { id: uuidv7(), isExposed: true, sourceFindingId: 'finding-b' },
      ]);

      for (const targetAssetId of [assetId, assetId2]) {
        const [finding] = await findingsOf(adminOrigin, targetAssetId);
        expect(finding.currentState).toBe('applicable');
        const detail = await services.withOrigin(adminOrigin).supportingAssets.getEvidenceDetail(finding.evidenceId);
        expect(detail!.history.map(({ state, origin }) => `${state}/${origin}`)).toEqual(['applicable/exposed']);
      }
    });

    it('bulkUpsertEvidence keeps the most recent evaluatedAt among duplicates targeting the same DB row', async () => {
      const serviceAccountId = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({
        id: serviceAccountId, name: 'Test Connector Bot',
      });
      await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('openaev', serviceAccountId);
      const connectorId = (await services.withOrigin(adminOrigin).integrationSettings.getConnectorId('openaev'))!;
      const older = new Date('2026-01-01T00:00:00Z');
      const newer = new Date('2026-01-10T00:00:00Z');

      // The most recent observation (`newer`) is deliberately placed LAST in the array: a
      // naive "last occurrence wins" dedup would keep `older` instead.
      await services.withOrigin(adminOrigin).supportingAssets.bulkUpsertEvidence([
        {
          id: uuidv7(), supportingAssetId: assetId, cveId: null, mitreTechniqueId: TECHNIQUE_T1003,
          expectationType: 'detection', isExposed: true, securityPlatformType: 'SIEM', evaluatedAt: newer,
          connectorId,
          sourceScenarioId: 'scenario-1', sourceSimulationId: 'ex-1', sourceInjectId: 'inject-1', sourceFindingId: 'finding-newer',
        },
        {
          id: uuidv7(), supportingAssetId: assetId, cveId: null, mitreTechniqueId: TECHNIQUE_T1003,
          expectationType: 'detection', isExposed: true, securityPlatformType: 'SIEM', evaluatedAt: older,
          connectorId,
          sourceScenarioId: 'scenario-1', sourceSimulationId: 'ex-2', sourceInjectId: 'inject-2', sourceFindingId: 'finding-older',
        },
      ]);

      const evidences = await findingsOf(adminOrigin, assetId);
      expect(evidences).toHaveLength(1);
      expect(evidences[0].lastEvaluatedAt).toEqual(newer);
    });

    describe('bulkUpsertEvidence over one source', () => {
      let connectorId: string;

      const observation = (isExposed: boolean, evaluatedAt: string, extra: { sourceSimulationId?: string, sourceInjectId?: string, reason?: string } = {}) => ({
        id: uuidv7(), supportingAssetId: assetId, cveId: null, mitreTechniqueId: TECHNIQUE_T1003,
        expectationType: 'detection' as const, isExposed, securityPlatformType: 'SIEM',
        evaluatedAt: new Date(evaluatedAt), connectorId, sourceScenarioId: 'scenario-1', sourceFindingId: 'scenario-scenario-1',
        ...extra,
      });

      const sync = (...rows: Array<ReturnType<typeof observation>>) => services.withOrigin(adminOrigin).supportingAssets.bulkUpsertEvidence(rows);

      const detail = async () => {
        const [finding] = await findingsOf(adminOrigin, assetId);
        return (await services.withOrigin(adminOrigin).supportingAssets.getEvidenceDetail(finding.evidenceId))!;
      };

      const historyOf = async () => (await detail()).history.map(({ state, origin }) => `${state}/${origin}`);

      const verdictsOf = async () => (await db
        .select({ isExposed: assetEvidenceVerdicts.isExposed, observedAt: assetEvidenceVerdicts.observedAt })
        .from(assetEvidenceVerdicts)
        .orderBy(asc(assetEvidenceVerdicts.recordedAt), asc(assetEvidenceVerdicts.observedAt)))
        .map(({ isExposed, observedAt }) => `${isExposed ? 'exposed' : 'held'}@${observedAt.toISOString().slice(0, 10)}`);

      beforeEach(async () => {
        const serviceAccountId = uuidv7();
        await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'Test Connector Bot' });
        await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('openaev', serviceAccountId);
        connectorId = (await services.withOrigin(adminOrigin).integrationSettings.getConnectorId('openaev'))!;
      });

      it('dates a history row when it was learned and keeps the date of its test beside it', async () => {
        const before = Date.now();
        await sync(observation(true, '2026-01-10T00:00:00Z'));

        const [row] = (await detail()).history;
        expect(row.observedAt).toEqual(new Date('2026-01-10T00:00:00Z'));
        expect(row.stateChangedAt.getTime()).toBeGreaterThanOrEqual(before);
      });

      it('records a new history entry when a re-sync changes the finding\'s state', async () => {
        await sync(observation(true, '2026-01-01T00:00:00Z'));
        await sync(observation(false, '2026-01-10T00:00:00Z'));

        expect(await historyOf()).toEqual(['applicable/exposed', 'dismissed/not_exposed']);
        expect((await findingsOf(adminOrigin, assetId))[0].currentState).toBe('dismissed');
      });

      it('logs every verdict change of a batch and writes the state the batch ends on', async () => {
        await sync(
          observation(true, '2026-01-01T00:00:00Z'),
          observation(false, '2026-01-05T00:00:00Z'),
          observation(true, '2026-01-10T00:00:00Z'),
        );

        expect(await verdictsOf()).toEqual(['exposed@2026-01-01', 'held@2026-01-05', 'exposed@2026-01-10']);
        expect(await historyOf()).toEqual(['applicable/exposed']);
      });

      it('logs nothing and writes nothing when a re-read sends every observation again', async () => {
        const reRead = () => sync(observation(false, '2026-01-05T00:00:00Z'), observation(true, '2026-01-10T00:00:00Z'));
        await reRead();
        await reRead();
        await reRead();

        expect(await verdictsOf()).toEqual(['held@2026-01-05', 'exposed@2026-01-10']);
        expect(await historyOf()).toEqual(['applicable/exposed']);
      });

      it('drops a late observation older than the verdict its source holds, however often it is replayed', async () => {
        await sync(observation(true, '2026-01-10T00:00:00Z'));
        for (let replay = 0; replay < 3; replay += 1) {
          await sync(observation(false, '2026-01-05T00:00:00Z'));
        }

        expect(await verdictsOf()).toEqual(['exposed@2026-01-10']);
        expect(await historyOf()).toEqual(['applicable/exposed']);
        expect((await findingsOf(adminOrigin, assetId))[0].lastEvaluatedAt).toEqual(new Date('2026-01-10T00:00:00Z'));
      });

      it('never rewrites the past when a late batch changes the state back before the verdict in force', async () => {
        await sync(observation(true, '2026-01-01T00:00:00Z'), observation(false, '2026-01-10T00:00:00Z'));
        const before = await historyOf();
        await sync(observation(false, '2026-01-03T00:00:00Z'), observation(true, '2026-01-05T00:00:00Z'));

        expect(await historyOf()).toEqual(before);
        expect((await findingsOf(adminOrigin, assetId))[0].currentState).toBe('dismissed');
      });

      it('keeps the first source proof IDs when a re-sync keeps the same state', async () => {
        await sync(observation(true, '2026-01-01T00:00:00Z', { sourceSimulationId: 'sim-1', sourceInjectId: 'inject-1' }));
        await sync(observation(true, '2026-01-10T00:00:00Z', { sourceSimulationId: 'sim-2', sourceInjectId: 'inject-2' }));

        const found = await detail();
        expect(found.history).toHaveLength(1);
        expect(found.sourceSimulationId).toBe('sim-1');
        expect(found.sourceInjectId).toBe('inject-1');
      });

      it('updates the source proof IDs when the state changes', async () => {
        await sync(observation(true, '2026-01-01T00:00:00Z', { sourceSimulationId: 'sim-1', sourceInjectId: 'inject-1' }));
        await sync(observation(false, '2026-01-10T00:00:00Z', { sourceSimulationId: 'sim-2', sourceInjectId: 'inject-2' }));

        const found = await detail();
        expect(found.history.map((h) => h.state)).toEqual(['applicable', 'dismissed']);
        expect(found.sourceScenarioId).toBe('scenario-1');
        expect(found.sourceSimulationId).toBe('sim-2');
        expect(found.sourceInjectId).toBe('inject-2');
      });

      it('never overrides a state a person set', async () => {
        await sync(observation(true, '2026-01-01T00:00:00Z'));
        const [finding] = await findingsOf(adminOrigin, assetId);
        await services.withOrigin(adminOrigin).supportingAssets.dismissEvidence({
          evidenceId: finding.evidenceId, dismissalType: 'false_positive', reasonCode: 'detection_error', reason: 'False positive', changedByUserId: adminUserId,
        });

        await sync(observation(true, '2026-01-10T00:00:00Z'));

        expect((await findingsOf(adminOrigin, assetId))[0].currentState).toBe('dismissed');
        expect(await historyOf()).toEqual(['applicable/exposed', 'dismissed/user']);
      });

      describe('after a person handed the finding back', () => {
        const recompute = () => services.withOrigin(adminOrigin).supportingAssets.recomputeEvidenceStateForAssets({ supportingAssetIds: [assetId], reason: 'No longer reported' });
        const afterHandover = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

        beforeEach(async () => {
          await sync(observation(true, '2026-01-01T00:00:00Z'));
          const [finding] = await findingsOf(adminOrigin, assetId);
          await services.withOrigin(adminOrigin).supportingAssets.dismissEvidence({
            evidenceId: finding.evidenceId, dismissalType: 'false_positive', reasonCode: 'detection_error', reason: 'Noise', changedByUserId: adminUserId,
          });
          await services.withOrigin(adminOrigin).supportingAssets.resetEvidenceState({ evidenceId: finding.evidenceId, changedByUserId: adminUserId });
        });

        it('writes the first verdict given after the handover, though it agrees', async () => {
          await sync(observation(false, afterHandover(60_000)));

          expect(await historyOf()).toEqual(['applicable/exposed', 'dismissed/user', 'dismissed/reset', 'dismissed/not_exposed']);
        });

        it('writes nothing for a verdict given before the handover, agreeing or not', async () => {
          await sync(observation(false, '2026-01-10T00:00:00Z'));
          await sync(observation(true, '2026-01-11T00:00:00Z'));

          expect(await historyOf()).toEqual(['applicable/exposed', 'dismissed/user', 'dismissed/reset']);
        });

        it('lets no retirement pass read a verdict from before the handover back into the finding', async () => {
          await sync(observation(true, '2026-01-11T00:00:00Z'));
          await recompute();

          expect(await historyOf()).toEqual(['applicable/exposed', 'dismissed/user', 'dismissed/reset']);
        });

        it('reads only the verdict given after the handover once one came', async () => {
          await sync(observation(true, afterHandover(60_000)));
          await recompute();

          expect(await historyOf()).toEqual(['applicable/exposed', 'dismissed/user', 'dismissed/reset', 'applicable/exposed']);
        });
      });

      describe('around a retirement', () => {
        const retirementPass = async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          const svc = services.withOrigin(adminOrigin).supportingAssets;
          await svc.markAssetsEnumerated({ connectorId, supportingAssetIds: [assetId], scope: '', enumeratedAt: new Date() });
          await svc.recomputeEvidenceStateForAssets({ supportingAssetIds: [assetId], reason: 'No longer reported' });
        };

        it('retires a finding its source left out, once, with the retirement\'s wording', async () => {
          await sync(observation(false, '2026-01-10T00:00:00Z'));
          await retirementPass();
          await retirementPass();

          expect((await detail()).history.map(({ state, origin, reason }) => `${state}/${origin}/${reason}`)).toEqual([
            'dismissed/not_exposed/null', 'dismissed/no_longer_reported/No longer reported',
          ]);
        });

        it('reopens a retired finding at the sync that reports it again, whatever the date of its test', async () => {
          await sync(observation(true, '2026-01-10T00:00:00Z'));
          await retirementPass();
          expect((await findingsOf(adminOrigin, assetId))[0].currentState).toBe('dismissed');

          await sync(observation(true, '2026-01-12T00:00:00Z'));

          expect(await historyOf()).toEqual(['applicable/exposed', 'dismissed/no_longer_reported', 'applicable/exposed']);
        });

        it('reads a retired finding tested again as not exposed rather than no longer reported', async () => {
          await sync(observation(true, '2026-01-10T00:00:00Z'));
          await retirementPass();
          await sync(observation(false, '2026-01-15T00:00:00Z'));
          await sync(observation(false, '2026-01-25T00:00:00Z'));

          expect(await historyOf()).toEqual(['applicable/exposed', 'dismissed/no_longer_reported', 'dismissed/not_exposed']);
        });
      });

      it('keeps the newest verdict on its source when an older observation is replayed, so a retirement pass reads it', async () => {
        await sync(observation(false, '2026-01-10T00:00:00Z', { reason: 'Prevented on the 10th' }));
        await sync(observation(true, '2026-01-05T00:00:00Z', { reason: 'Exposed on the 5th' }));

        const sources = await db
          .select({ isExposed: assetEvidenceSources.isExposed, lastSeenAt: assetEvidenceSources.lastSeenAt, reason: assetEvidenceSources.reason })
          .from(assetEvidenceSources);
        expect(sources).toEqual([{ isExposed: false, lastSeenAt: new Date('2026-01-10T00:00:00Z'), reason: 'Prevented on the 10th' }]);
      });
    });

    describe('bulkUpsertEvidence and the retirement pass over sources that disagree', () => {
      let connectorId: string;

      const observation = (sourceFindingId: string, isExposed: boolean, evaluatedAt: string) => ({
        id: uuidv7(), supportingAssetId: assetId, cveId: null, mitreTechniqueId: TECHNIQUE_T1003,
        expectationType: 'detection' as const, isExposed, securityPlatformType: 'SIEM',
        evaluatedAt: new Date(evaluatedAt), connectorId, sourceFindingId,
      });

      const historyOf = async () => {
        const [finding] = await findingsOf(adminOrigin, assetId);
        return (await services.withOrigin(adminOrigin).supportingAssets.getEvidenceDetail(finding.evidenceId))!.history.map(({ state, origin }) => `${state}/${origin}`);
      };

      const recompute = () => services.withOrigin(adminOrigin).supportingAssets.recomputeEvidenceStateForAssets({ supportingAssetIds: [assetId], reason: 'No longer reported' });

      beforeEach(async () => {
        const serviceAccountId = uuidv7();
        await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'Test Connector Bot' });
        await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('openaev', serviceAccountId);
        connectorId = (await services.withOrigin(adminOrigin).integrationSettings.getConnectorId('openaev'))!;
      });

      it('agrees with the retirement pass when two sources disagree at one instant', async () => {
        await services.withOrigin(adminOrigin).supportingAssets.bulkUpsertEvidence([
          observation('source-a', true, '2026-01-10T00:00:00Z'),
          observation('source-b', false, '2026-01-10T00:00:00Z'),
        ]);
        await recompute();

        expect(await historyOf()).toEqual(['applicable/exposed']);
      });

      it('agrees with the retirement pass when two sources disagree at two instants, in separate calls', async () => {
        await services.withOrigin(adminOrigin).supportingAssets.bulkUpsertEvidence([observation('source-a', true, '2026-01-01T00:00:00Z')]);
        await services.withOrigin(adminOrigin).supportingAssets.bulkUpsertEvidence([observation('source-b', false, '2026-01-03T00:00:00Z')]);
        await recompute();
        await services.withOrigin(adminOrigin).supportingAssets.bulkUpsertEvidence([observation('source-b', false, '2026-01-05T00:00:00Z')]);
        await recompute();

        expect(await historyOf()).toEqual(['applicable/exposed']);
      });

      it('points the finding at the simulation agreeing with its new state, not at the batch\'s latest', async () => {
        await services.withOrigin(adminOrigin).supportingAssets.bulkUpsertEvidence([
          { ...observation('source-a', true, '2026-01-01T00:00:00Z'), sourceSimulationId: 'sim-exposing' },
          { ...observation('source-b', false, '2026-01-02T00:00:00Z'), sourceSimulationId: 'sim-holding' },
        ]);

        const [finding] = await findingsOf(adminOrigin, assetId);
        const detail = await services.withOrigin(adminOrigin).supportingAssets.getEvidenceDetail(finding.evidenceId);
        expect(detail).toMatchObject({ currentState: 'applicable', sourceSimulationId: 'sim-exposing' });
      });

      it('closes the finding once the last source reporting it exposed says otherwise', async () => {
        await services.withOrigin(adminOrigin).supportingAssets.bulkUpsertEvidence([
          observation('source-a', true, '2026-01-01T00:00:00Z'),
          observation('source-b', false, '2026-01-01T00:00:00Z'),
        ]);
        await services.withOrigin(adminOrigin).supportingAssets.bulkUpsertEvidence([observation('source-a', false, '2026-01-07T00:00:00Z')]);
        await recompute();

        expect(await historyOf()).toEqual(['applicable/exposed', 'dismissed/not_exposed']);
      });

      // Stored with the larger id first, under the smaller source finding id, so neither the
      // physical order nor the unique index's order agrees with the id order the derivation uses.
      it.each([
        ['opens', null, true, 'wording of the smaller id'],
        ['closes', 'applicable' as const, false, 'wording of the larger id'],
      ])('%s a finding on two sources tied at one instant with the wording their ids settle', async (_, priorState, isExposed, expectedReason) => {
        const evidenceId = uuidv7();
        await db.insert(assetEvidence).values({
          id: evidenceId, tenantId: adminTenantId, supportingAssetId: assetId,
          mitreTechniqueId: TECHNIQUE_T1003, expectationType: 'detection', securityPlatformType: 'SIEM',
        });
        if (priorState !== null) {
          await insertSyncedVerdict(evidenceId, priorState, new Date('2026-01-01T00:00:00Z'), { connectorId });
        }
        const smallerId = uuidv7();
        const largerId = uuidv7();
        for (const [id, sourceFindingId, reason] of [[largerId, 'source-a', 'wording of the larger id'], [smallerId, 'source-b', 'wording of the smaller id']]) {
          await db.insert(assetEvidenceSources).values({
            id, tenantId: adminTenantId, assetEvidenceId: evidenceId, connectorId, sourceFindingId, isExposed, reason,
            evaluatedAt: new Date('2026-01-10T00:00:00Z'),
          });
        }

        await recompute();

        const [latest] = await db.select({ reason: assetEvidenceHistory.reason }).from(assetEvidenceHistory)
          .where(eq(assetEvidenceHistory.assetEvidenceId, evidenceId))
          .orderBy(desc(assetEvidenceHistory.stateChangedAt));
        expect(latest.reason).toBe(expectedReason);
      });

      it('dates the closure at the walk that left out the last exposed source, not at the older test of the source still reporting', async () => {
        const svc = services.withOrigin(adminOrigin).supportingAssets;
        await svc.bulkUpsertEvidence([observation('source-a', true, '2026-01-01T00:00:00Z'), observation('source-b', false, '2026-01-02T00:00:00Z')]);
        await new Promise((resolve) => setTimeout(resolve, 5));
        const walkedAt = new Date();
        await svc.markAssetsEnumerated({ connectorId, supportingAssetIds: [assetId], scope: '', enumeratedAt: walkedAt });
        await new Promise((resolve) => setTimeout(resolve, 5));
        await svc.bulkUpsertEvidence([observation('source-b', false, '2026-01-03T00:00:00Z')]);

        const [finding] = await findingsOf(adminOrigin, assetId);
        const { history } = (await svc.getEvidenceDetail(finding.evidenceId))!;
        expect(history.map(({ state, origin, observedAt }) => [`${state}/${origin}`, observedAt])).toEqual([
          ['applicable/exposed', new Date('2026-01-01T00:00:00Z')],
          ['dismissed/not_exposed', walkedAt],
        ]);
      });
    });

    describe('bulkUpsertEvidence over several tests of one source', () => {
      let connectorId: string;

      const observation = (isExposed: boolean) => ({
        id: uuidv7(), supportingAssetId: assetId, cveId: null, mitreTechniqueId: TECHNIQUE_T1003,
        expectationType: 'detection' as const, isExposed, securityPlatformType: 'SIEM',
        evaluatedAt: new Date('2026-01-10T00:00:00Z'), connectorId, sourceFindingId: 'scenario-1',
      });

      const readBack = async () => ({
        history: (await db.select({ state: assetEvidenceHistory.state, origin: assetEvidenceHistory.origin }).from(assetEvidenceHistory)
          .orderBy(asc(assetEvidenceHistory.stateChangedAt), asc(assetEvidenceHistory.id)))
          .map(({ state, origin }) => `${state}/${origin}`),
        sources: (await db.select({ isExposed: assetEvidenceSources.isExposed }).from(assetEvidenceSources)).map(({ isExposed }) => isExposed),
        verdicts: (await db.select({ isExposed: assetEvidenceVerdicts.isExposed }).from(assetEvidenceVerdicts)
          .orderBy(asc(assetEvidenceVerdicts.recordedAt), asc(assetEvidenceVerdicts.id)))
          .map(({ isExposed }) => isExposed),
      });

      beforeEach(async () => {
        const serviceAccountId = uuidv7();
        await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'Test Connector Bot' });
        await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('openaev', serviceAccountId);
        connectorId = (await services.withOrigin(adminOrigin).integrationSettings.getConnectorId('openaev'))!;
      });

      it.each([
        ['exposed first', [true, false]],
        ['exposed last', [false, true]],
      ])('keeps the exposed one on the source, in the verdict log and in the state, %s in the batch', async (_, verdicts) => {
        await services.withOrigin(adminOrigin).supportingAssets.bulkUpsertEvidence(verdicts.map(observation));

        expect(await readBack()).toEqual({ history: ['applicable/exposed'], sources: [true], verdicts: [true] });
      });

      it('keeps the exposed one when the other is delivered again in a later call', async () => {
        await services.withOrigin(adminOrigin).supportingAssets.bulkUpsertEvidence([observation(true)]);
        await services.withOrigin(adminOrigin).supportingAssets.bulkUpsertEvidence([observation(false)]);

        expect(await readBack()).toEqual({ history: ['applicable/exposed'], sources: [true], verdicts: [true] });
      });

      it('takes the exposed one when it is delivered in a later call', async () => {
        await services.withOrigin(adminOrigin).supportingAssets.bulkUpsertEvidence([observation(false)]);
        await services.withOrigin(adminOrigin).supportingAssets.bulkUpsertEvidence([observation(true)]);

        expect(await readBack()).toEqual({ history: ['dismissed/not_exposed', 'applicable/exposed'], sources: [true], verdicts: [false, true] });
      });

      it.each([
        ['not exposed', 'in one batch', false, [['first', 'second']]],
        ['not exposed', 'in two calls', false, [['first'], ['second']]],
        ['exposed', 'in one batch', true, [['first', 'second']]],
        ['exposed', 'in two calls', true, [['first'], ['second']]],
      ])('keeps the later of two %s results of one instant, %s', async (_, __, isExposed, calls) => {
        for (const reasons of calls) {
          await services.withOrigin(adminOrigin).supportingAssets.bulkUpsertEvidence(reasons.map((reason) => ({ ...observation(isExposed), reason })));
        }

        expect(await db.select({ reason: assetEvidenceSources.reason }).from(assetEvidenceSources)).toEqual([{ reason: 'second' }]);
      });

      it('logs no verdict for a later result that agrees with the one its source holds', async () => {
        await services.withOrigin(adminOrigin).supportingAssets.bulkUpsertEvidence([observation(true)]);
        await services.withOrigin(adminOrigin).supportingAssets.bulkUpsertEvidence([{ ...observation(true), evaluatedAt: new Date('2026-01-20T00:00:00Z') }]);

        expect(await readBack()).toEqual({ history: ['applicable/exposed'], sources: [true], verdicts: [true] });
      });
    });

    it('bulkUpsertEvidence rejects calls without tenant context', async () => {
      const serviceAccountId = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({
        id: serviceAccountId, name: 'Test Connector Bot',
      });
      await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('openaev', serviceAccountId);
      const connectorId = (await services.withOrigin(adminOrigin).integrationSettings.getConnectorId('openaev'))!;

      await expect(
        services.withOrigin({ type: 'platform', userId: adminUserId }).supportingAssets.bulkUpsertEvidence([{
          id: uuidv7(),
          evaluatedAt: new Date(),
          supportingAssetId: assetId,
          cveId: null,
          mitreTechniqueId: TECHNIQUE_T1003,
          expectationType: 'detection',
          isExposed: true,
          securityPlatformType: 'SIEM',
          connectorId,
          sourceFindingId: 'missing-tenant',
        }]),
      ).rejects.toThrow('Tenant context required');
    });

    it('bulkUpsertEvidence accepts an empty batch and performs no write', async () => {
      await services.withOrigin(adminOrigin).supportingAssets.bulkUpsertEvidence([]);

      const evidences = await findingsOf(adminOrigin, assetId);
      expect(evidences).toHaveLength(0);
    });

    it('bulkUpsertEvidence persists connector-provided reason into evidence history', async () => {
      const serviceAccountId = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({
        id: serviceAccountId, name: 'Test Connector Bot',
      });
      await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('openaev', serviceAccountId);
      const connectorId = (await services.withOrigin(adminOrigin).integrationSettings.getConnectorId('openaev'))!;
      const reason = 'Reported by Microsoft Defender';

      await services.withOrigin(adminOrigin).supportingAssets.bulkUpsertEvidence([{
        id: uuidv7(),
        supportingAssetId: assetId,
        cveId: null,
        mitreTechniqueId: TECHNIQUE_T1003,
        expectationType: 'detection',
        isExposed: false,
        securityPlatformType: 'SIEM',
        evaluatedAt: new Date('2026-01-01T00:00:00Z'),
        connectorId,
        sourceFindingId: 'finding-with-reason',
        reason,
      }]);

      const evidences = await findingsOf(adminOrigin, assetId);
      expect(evidences).toHaveLength(1);
      const detail = await services.withOrigin(adminOrigin).supportingAssets.getEvidenceDetail(evidences[0].evidenceId);
      expect(detail!.history).toHaveLength(1);
      expect(detail!.history[0].reason).toBe(reason);
      expect(detail!.history[0].state).toBe('dismissed');
    });

    it('should dismiss evidence and create a history entry', async () => {
      const userId = adminUserId;
      const tenantId = adminTenantId;
      const evidenceId = uuidv7();
      const cveUuid = await insertCve(tenantId, 'CVE-2023-4242');
      await services.withOrigin(adminOrigin).supportingAssets.createEvidence({
        id: evidenceId, supportingAssetId: assetId,
        cve: { rowId: cveUuid }, userId,
      });

      await services.withOrigin(adminOrigin).supportingAssets.dismissEvidence({
        evidenceId,
        dismissalType: 'risk_accepted',
        reasonCode: 'business_exception',
        reason: 'Risk accepted by security team',
        changedByUserId: userId,
      });

      const evidences = await findingsOf(adminOrigin, assetId);
      expect(evidences[0].currentState).toBe('dismissed');
      const detail = await services.withOrigin(adminOrigin).supportingAssets.getEvidenceDetail(evidenceId);
      expect(detail!.history.at(-1)!.reason).toBe('Risk accepted by security team');
    });

    it('should mark evidence back as applicable', async () => {
      const userId = adminUserId;
      const tenantId = adminTenantId;
      const evidenceId = uuidv7();
      const cveUuid = await insertCve(tenantId, 'CVE-2023-7777');
      await services.withOrigin(adminOrigin).supportingAssets.createEvidence({
        id: evidenceId, supportingAssetId: assetId,
        cve: { rowId: cveUuid }, userId,
      });
      await services.withOrigin(adminOrigin).supportingAssets.dismissEvidence({
        evidenceId,
        dismissalType: 'risk_accepted',
        reasonCode: 'wont_fix',
        reason: 'Dismissed',
        changedByUserId: userId,
      });

      await services.withOrigin(adminOrigin).supportingAssets.markEvidenceApplicable({
        evidenceId, changedByUserId: userId,
      });

      const evidences = await findingsOf(adminOrigin, assetId);
      expect(evidences[0].currentState).toBe('applicable');
    });

    it('should count only the applicable findings on the asset and in the asset list', async () => {
      const dismissedId = uuidv7();
      const reopenedId = uuidv7();
      for (const [id, cveName] of [[uuidv7(), 'CVE-2023-5001'], [dismissedId, 'CVE-2023-5002'], [reopenedId, 'CVE-2023-5003']]) {
        await services.withOrigin(adminOrigin).supportingAssets.createEvidence({
          id, supportingAssetId: assetId, cve: { rowId: await insertCve(adminTenantId, cveName) }, userId: adminUserId,
        });
      }
      for (const evidenceId of [dismissedId, reopenedId]) {
        await services.withOrigin(adminOrigin).supportingAssets.dismissEvidence({
          evidenceId, dismissalType: 'risk_accepted', reasonCode: 'wont_fix', reason: 'Dismissed', changedByUserId: adminUserId,
        });
      }
      await services.withOrigin(adminOrigin).supportingAssets.markEvidenceApplicable({
        evidenceId: reopenedId, changedByUserId: adminUserId,
      });

      const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(assetId);
      expect(asset?.applicableEvidenceCount).toBe(2);
      const page = await services.withOrigin(adminOrigin).supportingAssets.listSupportingAssets({
        page: 1, limit: 50, search: null, source: null, mappedToOrganizationId: null, membershipOrganizationId: null, sortBy: 'name', sortDesc: false,
      });
      expect(page.items.find((item) => item.id === assetId)?.applicableEvidenceCount).toBe(2);
    });

    it('files the type and the reason code on the history row it writes', async () => {
      const evidenceId = uuidv7();
      const cveUuid = await insertCve(adminTenantId, 'CVE-2023-8181');
      await services.withOrigin(adminOrigin).supportingAssets.createEvidence({
        id: evidenceId, supportingAssetId: assetId, cve: { rowId: cveUuid }, userId: adminUserId,
      });

      await services.withOrigin(adminOrigin).supportingAssets.dismissEvidence({
        evidenceId,
        dismissalType: 'false_positive',
        reasonCode: 'not_applicable',
        reason: 'The vulnerable component is not deployed here',
        changedByUserId: adminUserId,
      });

      const detail = await services.withOrigin(adminOrigin).supportingAssets.getEvidenceDetail(evidenceId);
      const decision = detail?.history.at(-1);
      // Both halves, read back through the surface the pages use: the type is what separates a risk
      // the organisation lives with from a finding that was never true, and the code carries it into
      // reporting. A repository mapping that dropped either would leave the state chip intact.
      expect(decision?.dismissalType).toBe('false_positive');
      expect(decision?.dismissalReasonCode).toBe('not_applicable');
      expect(decision?.origin).toBe('user');
    });

    it('refuses a reason code that belongs to the other dismissal type', async () => {
      const evidenceId = uuidv7();
      const cveUuid = await insertCve(adminTenantId, 'CVE-2023-8282');
      await services.withOrigin(adminOrigin).supportingAssets.createEvidence({
        id: evidenceId, supportingAssetId: assetId, cve: { rowId: cveUuid }, userId: adminUserId,
      });

      // `detection_error` is a false-positive code: an accepted risk claiming it would say the
      // finding is both true and untrue.
      await expect(services.withOrigin(adminOrigin).supportingAssets.dismissEvidence({
        evidenceId,
        dismissalType: 'risk_accepted',
        reasonCode: 'detection_error',
        reason: 'Wrong pair',
        changedByUserId: adminUserId,
      })).rejects.toThrow();

      const detail = await services.withOrigin(adminOrigin).supportingAssets.getEvidenceDetail(evidenceId);
      expect(detail?.currentState).toBe('applicable');
    });
  });

  describe('evidence activity', () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    /** Noon UTC `days` days ago, well inside that UTC day. */
    const noonDaysAgo = (days: number): Date => {
      const at = new Date(Date.now() - days * DAY_MS);
      at.setUTCHours(12, 0, 0, 0);
      return at;
    };
    const utcDay = (at: Date): string => at.toISOString().slice(0, 10);

    const createAsset = async (name: string): Promise<string> => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id, name, description: null, ownerId: null, exposure: 'internal', categoryId: 'host',
      });
      return id;
    };

    /** A finding whose history is exactly `changes`, so each test dates its own state changes. */
    const addFinding = async (
      supportingAssetId: string,
      flaw: { cveId: string } | { mitreTechniqueId: string },
      changes: Array<[Date, 'applicable' | 'dismissed']>,
    ): Promise<void> => {
      const id = uuidv7();
      await db.insert(assetEvidence).values([{
        id, tenantId: adminTenantId, supportingAssetId,
        cveId: 'cveId' in flaw ? flaw.cveId : null,
        mitreTechniqueId: 'mitreTechniqueId' in flaw ? flaw.mitreTechniqueId : null,
        expectationType: 'mitreTechniqueId' in flaw ? 'detection' : null,
      }]);
      for (const [stateChangedAt, state] of changes) {
        await db.insert(assetEvidenceHistory).values({
          id: uuidv7(), tenantId: adminTenantId, assetEvidenceId: id, stateChangedAt, observedAt: stateChangedAt, state, origin: state === 'applicable' ? 'exposed' : 'not_exposed',
        });
      }
    };

    const activity = async (scope: EvidenceActivityScope, timeZone = 'UTC', origin: EventOrigin = adminOrigin) =>
      services.withOrigin(origin).supportingAssets.getEvidenceActivity(scope, timeZone);
    const countOn = (series: Array<{ day: string, count: number }>, day: string) => series.find((point) => point.day === day)?.count;
    /** The count of each day, named by how many days ago it is. */
    const countsOver = (series: Array<{ day: string, count: number }>, daysAgo: Array<number>) =>
      daysAgo.map((days) => countOn(series, utcDay(noonDaysAgo(days))));

    it('should return every day the heatmap draws, ending today, all zero for a CVE with no finding', async () => {
      const series = await activity({ cveId: 'CVE-9999-0000' });

      expect(series).toHaveLength(EVIDENCE_ACTIVITY_DAYS);
      expect(series.at(-1)?.day).toBe(utcDay(new Date()));
      expect(series.every((point) => point.count === 0)).toBe(true);
    });

    it('should count a finding on the days it stood applicable, from the day it was raised to the day it was dismissed', async () => {
      const assetId = await createAsset('Server');
      const cveId = await insertCve(adminTenantId, 'CVE-2025-001');
      await addFinding(assetId, { cveId }, [[noonDaysAgo(10), 'applicable'], [noonDaysAgo(5), 'dismissed'], [noonDaysAgo(2), 'applicable']]);

      const series = await activity({ cveId: 'CVE-2025-001' });

      expect(countsOver(series, [11, 10, 6, 5, 3, 2, 0])).toEqual([0, 1, 1, 0, 0, 1, 1]);
    });

    it('should add up the findings of every asset the CVE is found on, and only of that CVE', async () => {
      const cveId = await insertCve(adminTenantId, 'CVE-2025-002');
      const otherCveId = await insertCve(adminTenantId, 'CVE-2025-003');
      await addFinding(await createAsset('Asset 1'), { cveId }, [[noonDaysAgo(4), 'applicable']]);
      await addFinding(await createAsset('Asset 2'), { cveId }, [[noonDaysAgo(2), 'applicable']]);
      await addFinding(await createAsset('Asset 3'), { cveId: otherCveId }, [[noonDaysAgo(3), 'applicable']]);

      const series = await activity({ cveId: 'CVE-2025-002' });

      expect(countsOver(series, [5, 4, 3, 2, 0])).toEqual([0, 1, 1, 2, 2]);
    });

    it('should not count a finding with no history, nor one dismissed the day it was raised', async () => {
      const cveId = await insertCve(adminTenantId, 'CVE-2025-004');
      await addFinding(await createAsset('Asset 1'), { cveId }, []);
      const raised = noonDaysAgo(3);
      await addFinding(await createAsset('Asset 2'), { cveId }, [[raised, 'applicable'], [new Date(raised.getTime() + 60_000), 'dismissed']]);

      const series = await activity({ cveId: 'CVE-2025-004' });

      expect(series.every((point) => point.count === 0)).toBe(true);
    });

    it('should count a finding raised before the window from its first day, and leave out one dismissed before it', async () => {
      const cveId = await insertCve(adminTenantId, 'CVE-2025-005');
      await addFinding(await createAsset('Asset 1'), { cveId }, [[noonDaysAgo(500), 'applicable']]);
      await addFinding(await createAsset('Asset 2'), { cveId }, [[noonDaysAgo(500), 'applicable'], [noonDaysAgo(400), 'dismissed']]);

      const series = await activity({ cveId: 'CVE-2025-005' });

      expect(series.every((point) => point.count === 1)).toBe(true);
    });

    it('should read the day of a change in the viewer time zone', async () => {
      const assetId = await createAsset('Asset');
      const cveId = await insertCve(adminTenantId, 'CVE-2025-006');
      // Late evening in UTC is already the next morning in Tokyo.
      const lateEvening = noonDaysAgo(3);
      lateEvening.setUTCHours(23, 30);
      await addFinding(assetId, { cveId }, [[lateEvening, 'applicable']]);
      const utcEvening = utcDay(lateEvening);
      const tokyoMorning = utcDay(new Date(lateEvening.getTime() + DAY_MS));

      const inUtc = await activity({ cveId: 'CVE-2025-006' }, 'UTC');
      const inTokyo = await activity({ cveId: 'CVE-2025-006' }, 'Asia/Tokyo');

      expect([countOn(inUtc, utcEvening), countOn(inUtc, tokyoMorning)]).toEqual([1, 1]);
      expect([countOn(inTokyo, utcEvening), countOn(inTokyo, tokyoMorning)]).toEqual([0, 1]);
    });

    it('should count the findings of a technique across assets, and of one asset across its flaws', async () => {
      const assetId = await createAsset('Asset');
      const otherAssetId = await createAsset('Other asset');
      const cveId = await insertCve(adminTenantId, 'CVE-2025-007');
      await addFinding(assetId, { mitreTechniqueId: TECHNIQUE_T1003 }, [[noonDaysAgo(3), 'applicable']]);
      await addFinding(otherAssetId, { mitreTechniqueId: TECHNIQUE_T1003 }, [[noonDaysAgo(1), 'applicable']]);
      await addFinding(assetId, { cveId }, [[noonDaysAgo(2), 'applicable']]);

      expect(countsOver(await activity({ mitreTechniqueId: TECHNIQUE_T1003 }), [3, 2, 1])).toEqual([1, 1, 2]);
      expect(countsOver(await activity({ supportingAssetId: assetId }), [3, 2, 1])).toEqual([1, 2, 2]);
    });

    it('should not count another tenant findings', async () => {
      const assetId = await createAsset('Tenant A asset');
      const cveId = await insertCve(adminTenantId, 'CVE-2025-020');
      await addFinding(assetId, { cveId }, [[noonDaysAgo(2), 'applicable']]);
      await addFinding(assetId, { mitreTechniqueId: TECHNIQUE_T1003 }, [[noonDaysAgo(2), 'applicable']]);
      const tenantBId = await createTenant(services, adminUserId);
      const tenantBOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };

      for (const scope of [{ cveId: 'CVE-2025-020' }, { mitreTechniqueId: TECHNIQUE_T1003 }, { supportingAssetId: assetId }]) {
        const series = await activity(scope, 'UTC', tenantBOrigin);
        expect(series.every((point) => point.count === 0)).toBe(true);
      }
    });
  });

  describe('derived name', () => {
    let connectorOrigin: EventOrigin;
    let connectorId: string;

    beforeEach(async () => {
      const serviceAccountId = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'Defender Bot' });
      await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('microsoft_graph', serviceAccountId);
      connectorOrigin = { type: 'connector', serviceAccountId, tenantId: adminTenantId };
      connectorId = (await services.withOrigin(connectorOrigin).integrationSettings.getConnectorId('microsoft_graph'))!;
    });

    const upsertUnnamedMachine = async (properties: { hostname?: string | null }) => {
      const idMap = await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([{
        sourceAssetId: 'dev-1', connectorId, source: 'microsoft_graph', categoryId: 'host',
        properties: { family: 'machine', ipAddresses: ['10.0.0.5'], macAddresses: ['aabbccddeeff'], ...properties },
      }]);
      return idMap.get('dev-1')!;
    };

    const listed = async (id: string) => {
      const page = await services.withOrigin(adminOrigin).supportingAssets.listSupportingAssets({
        page: 1, limit: 50, search: null, source: null, mappedToOrganizationId: null, membershipOrganizationId: null, sortBy: 'name', sortDesc: false,
      });
      return page.items.find((item) => item.id === id)!;
    };

    it('names an asset no source named after its address, in the detail and in the list', async () => {
      const id = await upsertUnnamedMachine({});

      const detail = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id);
      expect(detail!.name).toBeNull();
      expect(detail!.derivedName).toBe('10.0.0.5');
      const row = await listed(id);
      expect(row.name).toBeNull();
      expect(row.derivedName).toBe('10.0.0.5');
    });

    it('follows a later synchronisation that reports a hostname', async () => {
      const id = await upsertUnnamedMachine({});

      await upsertUnnamedMachine({ hostname: 'srv-new' });

      const detail = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id);
      expect(detail!.derivedName).toBe('srv-new');
      expect((await listed(id)).derivedName).toBe('srv-new');
    });

    it('never stores a blank connector name', async () => {
      const idMap = await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([{
        sourceAssetId: 'dev-blank', connectorId, source: 'microsoft_graph', categoryId: 'host', name: '   ',
        properties: { family: 'machine', ipAddresses: ['10.0.0.6'] },
      }]);

      const detail = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(idMap.get('dev-blank')!);
      expect(detail!.name).toBeNull();
      expect(detail!.sources.map((s) => s.reportedName)).toEqual([null]);
    });

    it('names a hand-created asset with no name from the properties typed with it', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id, name: null, description: null, ownerId: null, exposure: 'unknown', categoryId: 'host',
        properties: { family: 'machine', hostname: 'typed-host' },
      });

      const detail = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id);
      expect(detail!.name).toBeNull();
      expect(detail!.derivedName).toBe('typed-host');
    });

    it('reads back the vendor and model typed by hand, flagged as hand-entered, and names the asset from them', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id, name: null, description: null, ownerId: null, exposure: 'unknown', categoryId: 'host',
        properties: { family: 'machine', vendor: 'Dell', model: 'PowerEdge R740' },
      });

      const detail = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id);
      expect(detail!.properties).toMatchObject({ family: 'machine', vendor: 'Dell', model: 'PowerEdge R740' });
      expect(detail!.manualProperties).toMatchObject({ family: 'machine', vendor: 'Dell', model: 'PowerEdge R740' });
      expect(detail!.name).toBeNull();
      expect(detail!.derivedName).toBe('Dell PowerEdge R740');
    });

    it('names an asset from the properties typed in an edit', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id, name: null, description: null, ownerId: null, exposure: 'unknown', categoryId: 'host',
      });
      expect((await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id))!.derivedName).toBeNull();

      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(id, {
        properties: { family: 'machine', ipAddresses: ['10.0.0.9'] },
      });

      expect((await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id))!.derivedName).toBe('10.0.0.9');
    });

    it('does not pin the derived name as a manual one when only the description is edited', async () => {
      const id = await upsertUnnamedMachine({});

      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(id, { description: 'Lab switch' });

      const detail = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id);
      expect(detail!.manualValues.map((v) => v.attribute)).not.toContain('name');
      expect(detail!.name).toBeNull();
      expect(detail!.derivedName).toBe('10.0.0.5');
    });

    it('keeps the derived name beside a name typed by hand', async () => {
      const id = await upsertUnnamedMachine({});

      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(id, { name: 'Lab switch' });

      const detail = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id);
      expect(detail!.name).toBe('Lab switch');
      expect(detail!.derivedName).toBe('10.0.0.5');
    });

    it('re-derives the name from the connector alone when the hand-set values are cleared', async () => {
      const id = await upsertUnnamedMachine({});
      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(id, {
        properties: { family: 'machine', hostname: 'typed-host' },
      });
      expect((await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id))!.derivedName).toBe('typed-host');

      await services.withOrigin(adminOrigin).supportingAssets.resyncSupportingAssetWithConnectors(id);

      expect((await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(id))!.derivedName).toBe('10.0.0.5');
    });

    it('names an unclassified asset from the property block its source carries', async () => {
      const idMap = await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([
        {
          sourceAssetId: 'dev-generic-machine', connectorId, source: 'microsoft_graph', categoryId: 'generic_asset',
          properties: { family: 'machine', ipAddresses: ['10.0.0.7'], macAddresses: ['aabbccddeeff'] },
        },
        {
          sourceAssetId: 'dev-generic-identity', connectorId, source: 'microsoft_graph', categoryId: 'generic_asset',
          properties: { family: 'identity', directoryObjectId: 'obj-generic' },
        },
      ]);

      const machine = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(idMap.get('dev-generic-machine')!);
      const account = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(idMap.get('dev-generic-identity')!);
      expect(machine!.name).toBeNull();
      expect(machine!.derivedName).toBe('10.0.0.7');
      expect(account!.derivedName).toBe('obj-generic');
    });
  });

  describe('tags', () => {
    let connectorOrigin: EventOrigin;
    let connectorId: string;

    beforeEach(async () => {
      const serviceAccountId = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({
        id: serviceAccountId,
        name: 'OpenAEV Bot',
      });
      await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('openaev', serviceAccountId);
      connectorOrigin = { type: 'connector', serviceAccountId, tenantId: adminTenantId };
      connectorId = (await services.withOrigin(connectorOrigin).integrationSettings.getConnectorId('openaev'))!;
    });

    const upsertAssetTaggedWith = async (tagIds: Array<string>) => {
      const idMap = await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([
        { sourceAssetId: 'ep-1', categoryId: 'host', connectorId, source: 'openaev', name: 'srv-01' },
      ]);
      const assetId = idMap.get('ep-1')!;
      await services.withOrigin(connectorOrigin).supportingAssets.setAssetTags(connectorId, [{ supportingAssetId: assetId, tagIds }]);
      return assetId;
    };

    it('scopes the tag vocabulary to its own tenant', async () => {
      await services.withOrigin(connectorOrigin).supportingAssets.upsertTagVocabulary(connectorId, [
        { sourceTagId: 'oa-tag-1', name: 'Critical', color: '#ff0000' },
      ]);

      const otherTenantId = await createTenant(services, adminUserId);
      const otherAdminOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };
      const otherServiceAccountId = uuidv7();
      await services.withOrigin(otherAdminOrigin).serviceAccounts.createServiceAccount({ id: otherServiceAccountId, name: 'Other Bot' });
      await services.withOrigin(otherAdminOrigin).integrationSettings.configureIntegration('openaev', otherServiceAccountId);
      const otherConnectorOrigin: EventOrigin = { type: 'connector', serviceAccountId: otherServiceAccountId, tenantId: otherTenantId };
      const otherConnectorId = (await services.withOrigin(otherConnectorOrigin).integrationSettings.getConnectorId('openaev'))!;

      await services.withOrigin(otherConnectorOrigin).supportingAssets.upsertTagVocabulary(otherConnectorId, [
        { sourceTagId: 'oa-tag-1', name: 'Critical', color: '#ff0000' },
      ]);

      const allTags = await db.select().from(tags);
      expect(allTags).toHaveLength(2);
      expect(new Set(allTags.map((t) => t.tenantId))).toEqual(new Set([adminTenantId, otherTenantId]));
    });

    it('deletes an asset\'s tag links when the asset is deleted', async () => {
      const tagIdBySourceTagId = await services.withOrigin(connectorOrigin).supportingAssets.upsertTagVocabulary(connectorId, [
        { sourceTagId: 'oa-tag-1', name: 'Critical', color: '#ff0000' },
      ]);
      const assetId = await upsertAssetTaggedWith([...tagIdBySourceTagId.values()]);
      expect(await db.select().from(supportingAssetTags)).toHaveLength(1);

      await services.withOrigin(adminOrigin).supportingAssets.deleteSupportingAssets([assetId]);

      expect(await db.select().from(supportingAssetTags)).toHaveLength(0);
    });

    it('keeps the canonical tag and its asset links when the connector that reported it is deleted', async () => {
      const tagIdBySourceTagId = await services.withOrigin(connectorOrigin).supportingAssets.upsertTagVocabulary(connectorId, [
        { sourceTagId: 'oa-tag-1', name: 'Critical', color: '#ff0000' },
      ]);
      const tagId = tagIdBySourceTagId.get('oa-tag-1')!;
      const assetId = await upsertAssetTaggedWith([tagId]);

      await db.delete(integrationSettings).where(eq(integrationSettings.id, connectorId));

      const [tagRow] = await db.select().from(tags).where(eq(tags.id, tagId));
      expect(tagRow).toBeTruthy();
      expect(tagRow.name).toBe('Critical');

      const [originRow] = await db.select().from(tagSources).where(eq(tagSources.tagId, tagId));
      expect(originRow.connectorId).toBeNull();

      const links = await db.select().from(supportingAssetTags).where(eq(supportingAssetTags.supportingAssetId, assetId));
      expect(links).toHaveLength(1);
      expect(links[0].tagId).toBe(tagId);
      expect(links[0].connectorId).toBeNull();
    });

    it('renames in place after the connector was deleted and reconfigured, rather than splitting off the origin it left behind', async () => {
      await services.withOrigin(connectorOrigin).supportingAssets.upsertTagVocabulary(connectorId, [
        { sourceTagId: 'oa-tag-1', name: 'Critical', color: '#ff0000' },
      ]);
      // Deleting a connector only nulls `connector_id` on its origins: the rows survive with their
      // `source_tag_id`, and a reconfigured connector gets a new id, so it never finds them again.
      await db.delete(integrationSettings).where(eq(integrationSettings.id, connectorId));
      const newServiceAccountId = uuidv7();
      await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: newServiceAccountId, name: 'OpenAEV Bot 2' });
      await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('openaev', newServiceAccountId);
      const newConnectorOrigin: EventOrigin = { type: 'connector', serviceAccountId: newServiceAccountId, tenantId: adminTenantId };
      const newConnectorId = (await services.withOrigin(newConnectorOrigin).integrationSettings.getConnectorId('openaev'))!;

      await services.withOrigin(newConnectorOrigin).supportingAssets.upsertTagVocabulary(newConnectorId, [
        { sourceTagId: 'oa-tag-1', name: 'Critical', color: '#ff0000' },
      ]);
      const renamed = await services.withOrigin(newConnectorOrigin).supportingAssets.upsertTagVocabulary(newConnectorId, [
        { sourceTagId: 'oa-tag-1', name: 'Business critical', color: '#ff0000' },
      ]);

      const allTags = await db.select().from(tags);
      expect(allTags).toHaveLength(1);
      expect(allTags[0].name).toBe('Business critical');
      expect(renamed.get('oa-tag-1')).toBe(allTags[0].id);
    });

    it('replaces, rather than accumulates, an asset\'s tags on a second pass with a different set', async () => {
      const tagIdBySourceTagId = await services.withOrigin(connectorOrigin).supportingAssets.upsertTagVocabulary(connectorId, [
        { sourceTagId: 'oa-tag-1', name: 'Critical', color: '#ff0000' },
        { sourceTagId: 'oa-tag-2', name: 'Reviewed', color: '#00ff00' },
      ]);
      const assetId = await upsertAssetTaggedWith([tagIdBySourceTagId.get('oa-tag-1')!]);
      expect(await db.select().from(supportingAssetTags)).toHaveLength(1);

      await services.withOrigin(connectorOrigin).supportingAssets.setAssetTags(connectorId, [
        { supportingAssetId: assetId, tagIds: [tagIdBySourceTagId.get('oa-tag-2')!] },
      ]);

      const links = await db.select().from(supportingAssetTags);
      expect(links).toHaveLength(1);
      expect(links[0].tagId).toBe(tagIdBySourceTagId.get('oa-tag-2'));
    });

    it('is idempotent: a second pass with the same tag payload leaves the vocabulary and links unchanged', async () => {
      const payload = [{ sourceTagId: 'oa-tag-1', name: 'Critical', color: '#ff0000' }];
      const firstMap = await services.withOrigin(connectorOrigin).supportingAssets.upsertTagVocabulary(connectorId, payload);
      const assetId = await upsertAssetTaggedWith([...firstMap.values()]);

      const secondMap = await services.withOrigin(connectorOrigin).supportingAssets.upsertTagVocabulary(connectorId, payload);
      await services.withOrigin(connectorOrigin).supportingAssets.setAssetTags(connectorId, [
        { supportingAssetId: assetId, tagIds: [...secondMap.values()] },
      ]);

      expect(secondMap.get('oa-tag-1')).toBe(firstMap.get('oa-tag-1'));
      expect(await db.select().from(tags)).toHaveLength(1);
      expect(await db.select().from(supportingAssetTags)).toHaveLength(1);
    });

    it('rewrites no link when the same tag set comes again, and only the delta when it changes', async () => {
      const tagIdBySourceTagId = await services.withOrigin(connectorOrigin).supportingAssets.upsertTagVocabulary(connectorId, [
        { sourceTagId: 'oa-tag-1', name: 'Critical', color: '#ff0000' },
        { sourceTagId: 'oa-tag-2', name: 'Reviewed', color: '#00ff00' },
        { sourceTagId: 'oa-tag-3', name: 'Legacy', color: '#0000ff' },
      ]);
      const [criticalId, reviewedId, legacyId] = ['oa-tag-1', 'oa-tag-2', 'oa-tag-3'].map((k) => tagIdBySourceTagId.get(k)!);
      const assetId = await upsertAssetTaggedWith([criticalId, reviewedId]);
      const set = (tagIds: Array<string>) => services.withOrigin(connectorOrigin).supportingAssets.setAssetTags(connectorId, [{ supportingAssetId: assetId, tagIds }]);
      const linkIdByTag = async () => new Map((await db.select().from(supportingAssetTags)).map((link) => [link.tagId, link.id]));
      const before = await rowVersions('supporting_asset_tags');
      const idsBefore = await linkIdByTag();

      await set([reviewedId, criticalId]);
      expect(movedRowIds(before, await rowVersions('supporting_asset_tags'))).toEqual([]);

      await set([criticalId, legacyId]);
      const idsAfter = await linkIdByTag();
      expect(new Set(idsAfter.keys())).toEqual(new Set([criticalId, legacyId]));
      expect(idsAfter.get(criticalId)).toBe(idsBefore.get(criticalId));
      expect(movedRowIds(before, await rowVersions('supporting_asset_tags'))).toEqual([idsAfter.get(legacyId)]);
    });

    it('writes nothing to the vocabulary when the same tags come again, but still applies a new colour', async () => {
      const payload = [{ sourceTagId: 'oa-tag-1', name: 'Critical', color: '#ff0000' }];
      await services.withOrigin(connectorOrigin).supportingAssets.upsertTagVocabulary(connectorId, payload);
      const tagsBefore = await rowVersions('tags');
      const originsBefore = await rowVersions('tag_sources');

      await services.withOrigin(connectorOrigin).supportingAssets.upsertTagVocabulary(connectorId, payload);

      expect(movedRowIds(tagsBefore, await rowVersions('tags'))).toEqual([]);
      expect(movedRowIds(originsBefore, await rowVersions('tag_sources'))).toEqual([]);

      await services.withOrigin(connectorOrigin).supportingAssets.upsertTagVocabulary(connectorId, [{ ...payload[0], color: '#00ff00' }]);

      const [origin] = await db.select().from(tagSources);
      expect(origin.reportedColor).toBe('#00ff00');
    });

    it('records the new name of an origin whose tag already carries it, so a later report of the old name renames the tag back', async () => {
      const payload = [{ sourceTagId: 'oa-tag-1', name: 'Critical', color: '#ff0000' }];
      await services.withOrigin(connectorOrigin).supportingAssets.upsertTagVocabulary(connectorId, payload);
      await db.update(tags).set({ name: 'Business critical' });

      await services.withOrigin(connectorOrigin).supportingAssets.upsertTagVocabulary(connectorId, [{ ...payload[0], name: 'Business critical' }]);
      const [origin] = await db.select().from(tagSources);
      expect(origin.reportedName).toBe('Business critical');

      await services.withOrigin(connectorOrigin).supportingAssets.upsertTagVocabulary(connectorId, payload);
      const allTags = await db.select().from(tags);
      expect(allTags.map((tag) => tag.name)).toEqual(['Critical']);
    });

    it('replaces only the syncing connector\'s own links, leaving a manually-set tag on the same asset untouched', async () => {
      const tagIdBySourceTagId = await services.withOrigin(connectorOrigin).supportingAssets.upsertTagVocabulary(connectorId, [
        { sourceTagId: 'oa-tag-1', name: 'Critical', color: '#ff0000' },
        { sourceTagId: 'oa-tag-2', name: 'Reviewed', color: '#00ff00' },
      ]);
      const criticalId = tagIdBySourceTagId.get('oa-tag-1')!;
      const reviewedId = tagIdBySourceTagId.get('oa-tag-2')!;
      const assetId = await upsertAssetTaggedWith([criticalId]);
      await services.withOrigin(adminOrigin).supportingAssets.setAssetTags(null, [
        { supportingAssetId: assetId, tagIds: [reviewedId] },
      ]);
      expect(await db.select().from(supportingAssetTags)).toHaveLength(2);

      // The connector resyncs with no tags at all for this asset — its own link must clear, the
      // manual one must not.
      await services.withOrigin(connectorOrigin).supportingAssets.setAssetTags(connectorId, [
        { supportingAssetId: assetId, tagIds: [] },
      ]);

      const links = await db.select().from(supportingAssetTags).where(eq(supportingAssetTags.supportingAssetId, assetId));
      expect(links).toHaveLength(1);
      expect(links[0].tagId).toBe(reviewedId);
      expect(links[0].connectorId).toBeNull();
    });

    it('marks a tag manual only for the asset link the manual author actually set, not one a connector reported on the same asset', async () => {
      const tagIdBySourceTagId = await services.withOrigin(connectorOrigin).supportingAssets.upsertTagVocabulary(connectorId, [
        { sourceTagId: 'oa-tag-1', name: 'Critical', color: '#ff0000' },
      ]);
      const assetId = await upsertAssetTaggedWith([tagIdBySourceTagId.get('oa-tag-1')!]);

      await services.withOrigin(adminOrigin).supportingAssets.updateSupportingAsset(assetId, { tagNames: ['PCI'] });

      const asset = await services.withOrigin(adminOrigin).supportingAssets.getSupportingAsset(assetId);
      const critical = asset!.tags.find((tag) => tag.name === 'Critical')!;
      const pci = asset!.tags.find((tag) => tag.name === 'PCI')!;
      expect(critical.isManual).toBe(false);
      expect(pci.isManual).toBe(true);
    });

    describe('multiple authors of the same tag on the same asset', () => {
      let otherConnectorOrigin: EventOrigin;
      let otherConnectorId: string;

      beforeEach(async () => {
        const otherServiceAccountId = uuidv7();
        await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({
          id: otherServiceAccountId,
          name: 'Defender Bot',
        });
        await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('microsoft_graph', otherServiceAccountId);
        otherConnectorOrigin = { type: 'connector', serviceAccountId: otherServiceAccountId, tenantId: adminTenantId };
        otherConnectorId = (await services.withOrigin(otherConnectorOrigin).integrationSettings.getConnectorId('microsoft_graph'))!;
      });

      it('keeps one row per author, resolving to a single tag rather than one author overwriting the other', async () => {
        const tagIdBySourceTagId = await services.withOrigin(connectorOrigin).supportingAssets.upsertTagVocabulary(connectorId, [
          { sourceTagId: 'oa-tag-1', name: 'production', color: '#ff0000' },
        ]);
        const tagId = tagIdBySourceTagId.get('oa-tag-1')!;
        const assetId = await upsertAssetTaggedWith([tagId]);

        await services.withOrigin(otherConnectorOrigin).supportingAssets.setAssetTags(otherConnectorId, [
          { supportingAssetId: assetId, tagIds: [tagId] },
        ]);

        const links = await db.select().from(supportingAssetTags).where(eq(supportingAssetTags.supportingAssetId, assetId));
        expect(links).toHaveLength(2);
        expect(new Set(links.map((l) => l.connectorId))).toEqual(new Set([connectorId, otherConnectorId]));
        // One pastille: whatever renders this asset's tags must dedupe on tagId.
        expect(new Set(links.map((l) => l.tagId))).toEqual(new Set([tagId]));
      });

      it('leaves another author\'s link on a shared tag intact when one author stops asserting it', async () => {
        const tagIdBySourceTagId = await services.withOrigin(connectorOrigin).supportingAssets.upsertTagVocabulary(connectorId, [
          { sourceTagId: 'oa-tag-1', name: 'production', color: '#ff0000' },
        ]);
        const tagId = tagIdBySourceTagId.get('oa-tag-1')!;
        const assetId = await upsertAssetTaggedWith([tagId]);
        await services.withOrigin(otherConnectorOrigin).supportingAssets.setAssetTags(otherConnectorId, [
          { supportingAssetId: assetId, tagIds: [tagId] },
        ]);

        await services.withOrigin(connectorOrigin).supportingAssets.setAssetTags(connectorId, [
          { supportingAssetId: assetId, tagIds: [] },
        ]);

        const links = await db.select().from(supportingAssetTags).where(eq(supportingAssetTags.supportingAssetId, assetId));
        expect(links).toHaveLength(1);
        expect(links[0].connectorId).toBe(otherConnectorId);
        expect(links[0].tagId).toBe(tagId);
      });
    });

    describe('resolution', () => {
      let otherConnectorOrigin: EventOrigin;
      let otherConnectorId: string;

      beforeEach(async () => {
        const otherServiceAccountId = uuidv7();
        await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({
          id: otherServiceAccountId,
          name: 'Defender Bot',
        });
        await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('microsoft_graph', otherServiceAccountId);
        otherConnectorOrigin = { type: 'connector', serviceAccountId: otherServiceAccountId, tenantId: adminTenantId };
        otherConnectorId = (await services.withOrigin(otherConnectorOrigin).integrationSettings.getConnectorId('microsoft_graph'))!;
      });

      it('renames a tag in place when its one origin reports a new name', async () => {
        const firstMap = await services.withOrigin(connectorOrigin).supportingAssets.upsertTagVocabulary(connectorId, [
          { sourceTagId: 'oa-tag-1', name: 'Critcial', color: '#ff0000' },
        ]);
        const tagId = firstMap.get('oa-tag-1')!;

        const secondMap = await services.withOrigin(connectorOrigin).supportingAssets.upsertTagVocabulary(connectorId, [
          { sourceTagId: 'oa-tag-1', name: 'Critical', color: '#ff0000' },
        ]);

        expect(secondMap.get('oa-tag-1')).toBe(tagId);
        const [tagRow] = await db.select().from(tags).where(eq(tags.id, tagId));
        expect(tagRow.name).toBe('Critical');
        expect(await db.select().from(tags)).toHaveLength(1);
      });

      it('splits a tag when a renamed origin has a sibling still reporting the old name, and sends each author\'s link on the shared asset to the right row', async () => {
        // Both connectors resolve onto the same canonical tag: the first creates it, the second
        // attaches to it by name.
        const firstMap = await services.withOrigin(connectorOrigin).supportingAssets.upsertTagVocabulary(connectorId, [
          { sourceTagId: 'oa-tag-1', name: 'production', color: '#ff0000' },
        ]);
        const originalTagId = firstMap.get('oa-tag-1')!;
        const secondMap = await services.withOrigin(otherConnectorOrigin).supportingAssets.upsertTagVocabulary(otherConnectorId, [
          { sourceTagId: 'mg-tag-9', name: 'production', color: null },
        ]);
        expect(secondMap.get('mg-tag-9')).toBe(originalTagId);

        // Both connectors assert "production" on the very same asset — a shared composite key
        // could not carry both assertions at once; a surrogate id can.
        const assetId = await upsertAssetTaggedWith([originalTagId]);
        await services.withOrigin(otherConnectorOrigin).supportingAssets.setAssetTags(otherConnectorId, [
          { supportingAssetId: assetId, tagIds: [originalTagId] },
        ]);
        expect(await db.select().from(supportingAssetTags).where(eq(supportingAssetTags.supportingAssetId, assetId))).toHaveLength(2);

        // The first connector renames its own origin; the second still reports "production".
        const renamedMap = await services.withOrigin(connectorOrigin).supportingAssets.upsertTagVocabulary(connectorId, [
          { sourceTagId: 'oa-tag-1', name: 'prod', color: '#ff0000' },
        ]);
        const splitTagId = renamedMap.get('oa-tag-1')!;
        expect(splitTagId).not.toBe(originalTagId);

        const allTags = await db.select().from(tags);
        expect(new Set(allTags.map((t) => t.name))).toEqual(new Set(['production', 'prod']));

        // Simulates the sync handler re-linking this connector's own assets with the resolved id;
        // the other connector has not resynced, so its own row is untouched.
        await services.withOrigin(connectorOrigin).supportingAssets.setAssetTags(connectorId, [
          { supportingAssetId: assetId, tagIds: [splitTagId] },
        ]);

        const links = await db.select().from(supportingAssetTags).where(eq(supportingAssetTags.supportingAssetId, assetId));
        expect(links).toHaveLength(2);
        const tagIdByAuthor = new Map(links.map((link) => [link.connectorId, link.tagId]));
        expect(tagIdByAuthor.get(connectorId)).toBe(splitTagId);
        expect(tagIdByAuthor.get(otherConnectorId)).toBe(originalTagId);
      });

      it('merges two tags when a renamed origin lands on a name another tag already uses', async () => {
        const productionMap = await services.withOrigin(connectorOrigin).supportingAssets.upsertTagVocabulary(connectorId, [
          { sourceTagId: 'oa-tag-1', name: 'production', color: '#ff0000' },
        ]);
        const productionId = productionMap.get('oa-tag-1')!;
        const typoMap = await services.withOrigin(otherConnectorOrigin).supportingAssets.upsertTagVocabulary(otherConnectorId, [
          { sourceTagId: 'mg-tag-1', name: 'produtcion', color: null },
        ]);
        const typoId = typoMap.get('mg-tag-1')!;
        expect(typoId).not.toBe(productionId);

        const fixedMap = await services.withOrigin(otherConnectorOrigin).supportingAssets.upsertTagVocabulary(otherConnectorId, [
          { sourceTagId: 'mg-tag-1', name: 'production', color: null },
        ]);

        expect(fixedMap.get('mg-tag-1')).toBe(productionId);
        expect(await db.select().from(tags).where(eq(tags.id, typoId))).toHaveLength(0);
        expect(await db.select().from(tags)).toHaveLength(1);
      });

      it('leaves no orphan behind when both origins of one tag are renamed in the same payload', async () => {
        // Two OpenAEV sub-tenants hold their own tag id for the same name, so one connector can
        // be the origin of a canonical tag twice over.
        const firstMap = await services.withOrigin(connectorOrigin).supportingAssets.upsertTagVocabulary(connectorId, [
          { sourceTagId: 'oa-tag-a', name: 'production', color: '#ff0000' },
          { sourceTagId: 'oa-tag-b', name: 'production', color: '#ff0000' },
        ]);
        expect(firstMap.get('oa-tag-a')).toBe(firstMap.get('oa-tag-b'));

        const renamedMap = await services.withOrigin(connectorOrigin).supportingAssets.upsertTagVocabulary(connectorId, [
          { sourceTagId: 'oa-tag-a', name: 'prod-eu', color: '#ff0000' },
          { sourceTagId: 'oa-tag-b', name: 'prod-us', color: '#ff0000' },
        ]);

        expect(renamedMap.get('oa-tag-a')).not.toBe(renamedMap.get('oa-tag-b'));
        const allTags = await db.select().from(tags);
        expect(new Set(allTags.map((t) => t.name))).toEqual(new Set(['prod-eu', 'prod-us']));
      });

      it('does not hand a name a rename freed in the same payload to the origin reporting it next', async () => {
        await services.withOrigin(connectorOrigin).supportingAssets.upsertTagVocabulary(connectorId, [
          { sourceTagId: 'oa-tag-1', name: 'production', color: '#ff0000' },
        ]);

        const secondMap = await services.withOrigin(connectorOrigin).supportingAssets.upsertTagVocabulary(connectorId, [
          { sourceTagId: 'oa-tag-1', name: 'prod', color: '#ff0000' },
          { sourceTagId: 'oa-tag-2', name: 'production', color: '#00ff00' },
        ]);

        expect(secondMap.get('oa-tag-2')).not.toBe(secondMap.get('oa-tag-1'));
        const tagNameById = new Map((await db.select().from(tags)).map((t) => [t.id, t.name]));
        expect(tagNameById.get(secondMap.get('oa-tag-1')!)).toBe('prod');
        expect(tagNameById.get(secondMap.get('oa-tag-2')!)).toBe('production');
      });

      it('attaches an unknown origin to the tag already carrying the name it reports', async () => {
        const firstMap = await services.withOrigin(connectorOrigin).supportingAssets.upsertTagVocabulary(connectorId, [
          { sourceTagId: 'oa-tag-1', name: 'production', color: '#ff0000' },
        ]);
        const tagId = firstMap.get('oa-tag-1')!;

        const secondMap = await services.withOrigin(otherConnectorOrigin).supportingAssets.upsertTagVocabulary(otherConnectorId, [
          { sourceTagId: 'mg-tag-1', name: 'production', color: null },
        ]);

        expect(secondMap.get('mg-tag-1')).toBe(tagId);
        expect(await db.select().from(tags)).toHaveLength(1);
        expect(await db.select().from(tagSources)).toHaveLength(2);
      });
    });
  });
});

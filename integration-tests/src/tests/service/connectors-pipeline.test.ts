import type { EventOrigin } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);
const SYSTEM_ORIGIN: EventOrigin = { type: 'system' };

describe('connectors pipeline reads', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    tenantId = setup.tenantId;
  });

  const configureConnector = async (source: 'microsoft_graph' | 'drata') => {
    const serviceAccountId = uuidv7();
    await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({
      id: serviceAccountId,
      name: `Bot ${serviceAccountId.substring(0, 8)}`,
    });
    await services.withOrigin(adminOrigin).integrationSettings.configureIntegration(source, serviceAccountId);
    const connectorOrigin: EventOrigin = { type: 'connector', serviceAccountId, tenantId };
    const connectorId = (await services.withOrigin(connectorOrigin).integrationSettings.getConnectorId(source))!;
    return { connectorOrigin, connectorId };
  };

  describe('jobs.getActiveRunCounts', () => {
    it('counts queued and running runs of the requested kinds only', async () => {
      const jobs = services.withOrigin(SYSTEM_ORIGIN).jobs;
      await jobs.enqueueJob({ kind: 'cve-epss-sync', tenantId, payload: {} });
      await jobs.enqueueJob({ kind: 'cve-cvss-sync', tenantId, payload: {} });
      await jobs.enqueueJob({ kind: 'internal-projection', tenantId, payload: {} });
      await jobs.claimNext('worker-1', ['cve-cvss-sync'], 30_000);

      const counts = await services.withOrigin(adminOrigin).jobs
        .getActiveRunCounts(tenantId, ['cve-epss-sync', 'cve-cvss-sync']);
      expect(counts).toEqual({ queued: 1, running: 1 });
    });

    it('answers zero for an empty kind set without touching the database', async () => {
      const counts = await services.withOrigin(adminOrigin).jobs.getActiveRunCounts(tenantId, []);
      expect(counts).toEqual({ queued: 0, running: 0 });
    });

    it("never counts another tenant's runs", async () => {
      const otherTenantId = await createTenant(services, adminUserId);
      await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({ kind: 'cve-epss-sync', tenantId: otherTenantId, payload: {} });

      const counts = await services.withOrigin(adminOrigin).jobs.getActiveRunCounts(tenantId, ['cve-epss-sync']);
      expect(counts).toEqual({ queued: 0, running: 0 });
    });
  });

  describe('connectors.countIngestedRecords', () => {
    it('counts connector-written entity rows and excludes manual ones', async () => {
      await services.withOrigin(adminOrigin).cve.upsertEpssScores([
        { cveId: 'CVE-2024-0001', epss: 0.05, date: '2024-01-15' },
        { cveId: 'CVE-2024-0002', epss: 0.10, date: '2024-01-15' },
      ]);

      const graph = await configureConnector('microsoft_graph');
      const idMap = await services.withOrigin(graph.connectorOrigin).supportingAssets.bulkUpsertAssets([
        { sourceAssetId: 'dev-1', categoryId: 'host', connectorId: graph.connectorId, source: 'microsoft_graph', name: 'Device 1' },
      ]);
      const connectorAssetId = idMap.get('dev-1')!;
      await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id: uuidv7(), name: 'Hand-made', description: null, ownerId: null, exposure: 'unknown', categoryId: 'host',
        properties: { family: 'machine', hostname: 'hand-made.local' },
      });

      const firstCve = await services.withOrigin(adminOrigin).cve.getCveByCveId('CVE-2024-0001');
      const secondCve = await services.withOrigin(adminOrigin).cve.getCveByCveId('CVE-2024-0002');
      await services.withOrigin(adminOrigin).supportingAssets.bulkUpsertEvidence([{
        id: uuidv7(),
        evaluatedAt: new Date(),
        supportingAssetId: connectorAssetId,
        cveId: firstCve!.id,
        mitreTechniqueId: null,
        expectationType: null,
        isExposed: true,
        connectorId: graph.connectorId,
        sourceFindingId: 'dev-1:CVE-2024-0001',
      }]);
      await services.withOrigin(adminOrigin).supportingAssets.createEvidence({
        id: uuidv7(), supportingAssetId: connectorAssetId, cveId: secondCve!.id, userId: adminUserId,
      });

      const capabilities = await services.withOrigin(adminOrigin).controlCapabilities.getControlCapabilities();
      const manualCapability = capabilities.find((capability) => capability.externalId === 'IDP')!;
      await services.withOrigin(adminOrigin).controlCapabilities.upsertAssessment(manualCapability.id, 'L2', 'L2', null);
      const drata = await configureConnector('drata');
      // DCF-88 is WAF's only evidence pair, so the derivation writes WAF alone.
      await services.withOrigin(drata.connectorOrigin).drata.replaceMirror({
        syncedAt: new Date(),
        frameworks: [],
        controls: [{ drataId: 88, code: 'DCF-88', name: 'WAF', description: null, isReady: true, isMonitored: true, hasEvidence: true, hasPolicy: true, archivedAt: null }],
      });
      await services.withOrigin({ type: 'job', tenantId, jobKind: 'capability-derivation', interactive: false })
        .controlCapabilities.rederiveAssessments();

      await services.withOrigin(adminOrigin).openctiConnector.upsertStreamObject(
        tenantId, 'intrusion-set--a', 'intrusion-set', { id: 'intrusion-set--a' },
      );

      const total = await services.withOrigin(adminOrigin).connectors.countIngestedRecords(tenantId);
      // 2 CVEs + 1 connector asset + 1 connector evidence + 1 Drata-fed assessment + 1 stream object.
      // The manual asset (and its hand-typed observation), the manual evidence and the manual assessment stay out.
      expect(total).toBe(6);
    });

    it('should stop counting a mirrored object the stream deleted, tombstone or not', async () => {
      const mirror = services.withOrigin(adminOrigin).openctiConnector;
      await mirror.upsertStreamObject(tenantId, 'intrusion-set--a', 'intrusion-set', { id: 'intrusion-set--a' });
      expect(await services.withOrigin(adminOrigin).connectors.countIngestedRecords(tenantId)).toBe(1);

      await mirror.deleteStreamObject(tenantId, 'intrusion-set--a');

      expect(await services.withOrigin(adminOrigin).connectors.countIngestedRecords(tenantId)).toBe(0);
    });

    it("never counts another tenant's rows", async () => {
      await services.withOrigin(adminOrigin).cve.upsertEpssScores([
        { cveId: 'CVE-2024-0001', epss: 0.05, date: '2024-01-15' },
      ]);
      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };

      expect(await services.withOrigin(adminOrigin).connectors.countIngestedRecords(tenantId)).toBe(1);
      expect(await services.withOrigin(otherOrigin).connectors.countIngestedRecords(otherTenantId)).toBe(0);
    });
  });
});

import type { EventOrigin } from '@app/module';
import { assetEvidence, controlCapabilities, crqControlWhatIfResults, crqIndicatorRuns, cve } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';
const DAY_MS = 24 * 60 * 60 * 1000;

describe('CISO dashboard endpoints (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let anonymous: ReturnType<typeof createTrpcTestClient>;

  let tenantId: string;
  let capabilityId: string;

  beforeAll(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);
    anonymous = createTrpcTestClient(server);

    const adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

    tenantId = uuidv7();
    await services.withOrigin({ type: 'platform', userId: adminId })
      .tenants.createTenant({ id: tenantId, name: 'CISO Tenant' }, adminId);
    const origin: EventOrigin = { type: 'client', userId: adminId, tenantId };

    const [outcome] = await services.withOrigin(origin).attackOutcomes.getAttackOutcomes();
    const organizationId = uuidv7();
    await services.withOrigin(origin).organizations.createOrganizations([{ id: organizationId, name: 'Acme' }]);
    const scenarioId = uuidv7();
    await services.withOrigin(origin).riskScenarios.createRiskScenario({
      id: scenarioId, organizationId, name: 'Ransomware', description: null, attackOutcomeId: outcome.id, primaryAssetIds: [],
    });

    const runId = uuidv7();
    await db.insert(crqIndicatorRuns).values({
      id: runId,
      riskScenarioId: scenarioId,
      createdAt: new Date(Date.now() - 200 * DAY_MS),
      iterations: 1000,
      vulnerabilityP5: 0.1,
      vulnerabilityP50: 0.2,
      vulnerabilityP95: 0.3,
      lefMean: 2,
      aleMean: 200_000,
      aleP10: 100_000,
      aleP90: 400_000,
      techniqueCount: 10,
      coveredTechniqueCount: 5,
    });

    const [capability] = await db.select().from(controlCapabilities).limit(1);
    capabilityId = capability.id;
    await db.insert(crqControlWhatIfResults).values({
      id: uuidv7(),
      runId,
      controlId: capabilityId,
      controlKind: 'capability',
      dimension: 'coverage',
      currentStrength: 'L1',
      upgradedStrength: 'L1',
      currentCoverage: 'L1',
      upgradedCoverage: 'L2',
      aleReductionMean: 30_000,
    });

    const assetId = uuidv7();
    await services.withOrigin(origin).supportingAssets.createSupportingAsset({
      id: assetId, name: 'Core DB', description: null, ownerId: null, exposure: 'internal', categoryId: 'host', criticality: 'high',
    });
    const cveId = uuidv7();
    await db.insert(cve).values([{ id: cveId, tenantId, cveId: 'CVE-2026-0401', cvss: 9.1 }]);
    await db.insert(assetEvidence).values([{ id: uuidv7(), supportingAssetId: assetId, tenantId, cveId, userId: adminId }]);
    await services.withOrigin(origin).findingScore.recomputeFindingScores();
  }, 600_000);

  describe('dashboard.getExposureTrend', () => {
    it('should reach back a year and carry the derived likelihood and magnitude', async () => {
      const res = await client.query('dashboard.getExposureTrend', { windowDays: 365 }, { tenantId });

      expect(res.status).toBe(200);
      const points = res.json.result.data;
      expect(points.length).toBeGreaterThan(190);
      expect(points.at(-1)).toMatchObject({ ale: 200_000, lef: 2, likelihood: 1 - Math.exp(-2), magnitude: 100_000 });
    });

    it.each([0, 367])('should refuse a window of %i days', async (windowDays) => {
      const res = await client.query('dashboard.getExposureTrend', { windowDays }, { tenantId });

      expect(res.json.error.data.code).toBe('BAD_REQUEST');
    });

    it('should refuse an unauthenticated caller', async () => {
      const res = await anonymous.query('dashboard.getExposureTrend', { windowDays: 365 }, { tenantId });

      expect(res.json.error.data.code).toBe('UNAUTHORIZED');
    });
  });

  describe('dashboard.getRiskScopeFigures', () => {
    it('should rank the risk scope with its figures', async () => {
      const res = await client.query('dashboard.getRiskScopeFigures', { windowDays: 365 }, { tenantId });

      expect(res.status).toBe(200);
      expect(res.json.result.data).toEqual([expect.objectContaining({
        name: 'Acme', scenarioCount: 1, ale: 200_000, lef: 2, magnitude: 100_000, aleChange: 0,
        aleBaseline: expect.objectContaining({ ale: 200_000 }),
        windowStart: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      })]);
    });

    it.each([0, 367])('should refuse a window of %i days', async (windowDays) => {
      const res = await client.query('dashboard.getRiskScopeFigures', { windowDays }, { tenantId });

      expect(res.json.error.data.code).toBe('BAD_REQUEST');
    });

    it('should refuse an unauthenticated caller', async () => {
      const res = await anonymous.query('dashboard.getRiskScopeFigures', { windowDays: 365 }, { tenantId });

      expect(res.json.error.data.code).toBe('UNAUTHORIZED');
    });
  });

  describe('dashboard.getTopControlMoves', () => {
    it('should carry the move with its rungs', async () => {
      const res = await client.query('dashboard.getTopControlMoves', {}, { tenantId });

      expect(res.status).toBe(200);
      expect(res.json.result.data).toEqual([expect.objectContaining({
        controlId: capabilityId, dimension: 'coverage', currentCoverage: 'L1', upgradedCoverage: 'L2', scenarioCount: 1, totalAleReduction: 30_000,
      })]);
    });

    it('should refuse an unauthenticated caller', async () => {
      const res = await anonymous.query('dashboard.getTopControlMoves', {}, { tenantId });

      expect(res.json.error.data.code).toBe('UNAUTHORIZED');
    });
  });

  describe('findingScore.getTopVulnerabilities', () => {
    it('should carry the grouped vulnerability', async () => {
      const res = await client.query('findingScore.getTopVulnerabilities', { organizationId: null }, { tenantId });

      expect(res.status).toBe(200);
      expect(res.json.result.data).toEqual([expect.objectContaining({
        cveId: 'CVE-2026-0401', impactedAssetCount: 1, sources: [], worstEvidenceId: expect.any(String),
      })]);
    });

    it('should refuse a malformed scope id', async () => {
      const res = await client.query('findingScore.getTopVulnerabilities', { organizationId: 'not-a-uuid' }, { tenantId });

      expect(res.json.error.data.code).toBe('BAD_REQUEST');
    });

    it('should refuse an unauthenticated caller', async () => {
      const res = await anonymous.query('findingScore.getTopVulnerabilities', { organizationId: null }, { tenantId });

      expect(res.json.error.data.code).toBe('UNAUTHORIZED');
    });
  });
});

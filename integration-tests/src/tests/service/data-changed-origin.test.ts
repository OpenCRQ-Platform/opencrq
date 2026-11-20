import type { EventOrigin } from '@app/module';
import {
  assetEvidence, assetEvidenceSources, budgetReviewLines, budgetReviews, createServices, crqIndicatorGroupScores, crqIndicatorRuns,
  jobDependenciesService, notifications, organizations, schema, supportingAssetRelations, supportingAssets, TECHNIQUE_T1003,
  tenants,
} from '@app/module';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { getWorkerDbName, pgConfig } from '../../setup/pg-config';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

interface DataChangedEvent {
  tenantId?: string,
  table: string,
  op: string,
  origin?: string | null,
  interactive?: boolean | null,
}

const isDataChangedEvent = (value: unknown): value is DataChangedEvent =>
  typeof value === 'object' && value !== null
  && 'table' in value && typeof value.table === 'string'
  && 'op' in value && typeof value.op === 'string';

describe('data_changed doorbell hygiene', () => {
  const events: Array<DataChangedEvent> = [];
  let listener: pg.Client;
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let tenantId: string;
  let userId: string;

  const eventsFor = (table: string, op?: string): Array<DataChangedEvent> =>
    events.filter((event) => event.table === table && (op === undefined || event.op === op));

  const waitForEvent = async (predicate: (event: DataChangedEvent) => boolean, timeoutMs = 3_000): Promise<DataChangedEvent> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = events.find(predicate);
      if (found) {
        return found;
      }
      if (Date.now() > deadline) {
        throw new Error('Expected data_changed notification never arrived');
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };

  const settle = async (ms = 400): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  beforeAll(async () => {
    listener = new pg.Client({ ...pgConfig, database: getWorkerDbName() });
    await listener.connect();
    listener.on('notification', (msg) => {
      if (!msg.payload) {
        return;
      }
      const parsed: unknown = JSON.parse(msg.payload);
      if (isDataChangedEvent(parsed)) {
        events.push(parsed);
      }
    });
    await listener.query('LISTEN data_changed');
  });

  afterAll(async () => {
    await listener.end();
  });

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    tenantId = setup.tenantId;
    userId = setup.userId;
    events.length = 0;
  });

  const createOrganization = async (): Promise<string> => {
    const id = uuidv7();
    await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id, name: `Org ${id.substring(0, 8)}` }]);
    return id;
  };

  it('should stay silent on an UPDATE writing values identical to the stored row', async () => {
    const id = await createOrganization();
    await waitForEvent((event) => event.table === 'organizations' && event.op === 'INSERT');
    events.length = 0;

    const stored = await db.select().from(organizations).where(eq(organizations.id, id));
    await db.update(organizations).set(stored[0]).where(eq(organizations.id, id));
    await settle();
    expect(eventsFor('organizations', 'UPDATE')).toHaveLength(0);

    await db.update(organizations).set({ description: 'changed' }).where(eq(organizations.id, id));
    const event = await waitForEvent((entry) => entry.table === 'organizations' && entry.op === 'UPDATE');
    expect(event.tenantId).toBe(tenantId);
  });

  it('should stay silent on a no-op update to a global table, and notify a real one without a tenant', async () => {
    const id = uuidv7();
    await db.insert(notifications).values({ id, userId, type: 'probe', title: 'Probe', message: 'Probe' });
    const inserted = await waitForEvent((event) => event.table === 'notifications' && event.op === 'INSERT');
    expect(inserted.tenantId).toBeUndefined();
    events.length = 0;

    const stored = await db.select().from(notifications).where(eq(notifications.id, id));
    // Column by column rather than the whole row: `created_at` keeps microseconds Postgres would
    // read back as a distinct value once Drizzle has rounded it to milliseconds.
    await db.update(notifications).set({ title: stored[0].title, read: stored[0].read }).where(eq(notifications.id, id));
    await settle();
    expect(eventsFor('notifications', 'UPDATE')).toHaveLength(0);

    await db.update(notifications).set({ read: true }).where(eq(notifications.id, id));
    const event = await waitForEvent((entry) => entry.table === 'notifications' && entry.op === 'UPDATE');
    expect(event.tenantId).toBeUndefined();
  });

  it('should name the job kind on a write the writer performs under a job origin, and none otherwise', async () => {
    const jobOrigin: EventOrigin = { type: 'job', tenantId, jobKind: 'probe-recompute', interactive: false };
    await services.withOrigin(jobOrigin).jobs.enqueueJob({ kind: 'probe-tagged', tenantId, payload: {} });
    const tagged = await waitForEvent((event) => event.table === 'jobs' && event.op === 'INSERT');
    expect(tagged.origin).toBe('probe-recompute');
    expect(tagged.tenantId).toBe(tenantId);

    events.length = 0;
    await services.withOrigin({ type: 'system' }).jobs.enqueueJob({ kind: 'probe-untagged', tenantId, payload: {} });
    const untagged = await waitForEvent((event) => event.table === 'jobs' && event.op === 'INSERT');
    expect(untagged.origin ?? null).toBeNull();
  });

  it('should relay whether the run is awaited alongside its kind', async () => {
    const awaitedOrigin: EventOrigin = { type: 'job', tenantId, jobKind: 'probe-recompute', interactive: true };
    await services.withOrigin(awaitedOrigin).jobs.enqueueJob({ kind: 'probe-awaited', tenantId, payload: {} });
    const tagged = await waitForEvent((event) => event.table === 'jobs' && event.op === 'INSERT');
    expect(tagged.interactive).toBe(true);

    events.length = 0;
    const sweepOrigin: EventOrigin = { type: 'job', tenantId, jobKind: 'probe-sweep', interactive: false };
    await services.withOrigin(sweepOrigin).jobs.enqueueJob({ kind: 'probe-swept', tenantId, payload: {} });
    const sweep = await waitForEvent((event) => event.table === 'jobs' && event.op === 'INSERT');
    expect(sweep.interactive).toBe(false);

    events.length = 0;
    await services.withOrigin({ type: 'system' }).jobs.enqueueJob({ kind: 'probe-untagged', tenantId, payload: {} });
    const untagged = await waitForEvent((event) => event.table === 'jobs' && event.op === 'INSERT');
    expect(untagged.interactive ?? null).toBeNull();
  });

  it('should relay the run behind a write made under its caller\'s authorization', async () => {
    const id = await createOrganization();
    await waitForEvent((event) => event.table === 'organizations' && event.op === 'INSERT');
    events.length = 0;

    // What `crq-simulation` and the six connector syncs do: the origin stays the caller's, so the
    // policies still see them, while the run it belongs to reaches the payload all the same.
    const borrowed: EventOrigin = {
      type: 'client',
      userId: adminUserId,
      tenantId,
      job: { jobKind: 'probe-connector-sync', interactive: true },
    };
    await services.withOrigin(borrowed).organizations.updateOrganization(id, { description: 'written by the sync' });

    const event = await waitForEvent((entry) => entry.table === 'organizations' && entry.op === 'UPDATE');
    expect(event.origin).toBe('probe-connector-sync');
    expect(event.interactive).toBe(true);
  });

  it('should name the job kind on an update issued outside any atomic block', async () => {
    const id = await createOrganization();
    await waitForEvent((event) => event.table === 'organizations' && event.op === 'INSERT');
    events.length = 0;

    const jobOrigin: EventOrigin = { type: 'job', tenantId, jobKind: 'probe-recompute', interactive: false };
    await services.withOrigin(jobOrigin).organizations.updateOrganization(id, { description: 'written by the job' });

    const event = await waitForEvent((entry) => entry.table === 'organizations' && entry.op === 'UPDATE');
    expect(event.origin).toBe('probe-recompute');
    expect(event.tenantId).toBe(tenantId);
  });

  it('should not leak the tag past the transaction onto the pooled connection', async () => {
    const id = await createOrganization();
    await waitForEvent((event) => event.table === 'organizations' && event.op === 'INSERT');

    // One physical connection, so the write below provably reuses the one the writer tagged.
    const singlePool = new pg.Pool({ ...pgConfig, database: getWorkerDbName(), max: 1 });
    try {
      await createServices([jobDependenciesService], drizzle(singlePool, { schema }))
        .withOrigin({ type: 'job', tenantId, jobKind: 'probe-recompute', interactive: false })
        .jobDependencies.replaceObservation('probe-recompute', tenantId, { reads: ['asset_evidence'], writes: [] });

      events.length = 0;
      const borrower = await singlePool.connect();
      try {
        await borrower.query('UPDATE organizations SET description = $1 WHERE id = $2', ['borrower write', id]);
      } finally {
        borrower.release();
      }
      const event = await waitForEvent((entry) => entry.table === 'organizations' && entry.op === 'UPDATE');
      expect(event.origin ?? null).toBeNull();
    } finally {
      await singlePool.end();
    }
  });

  it('should still notify SSE-style listeners of a real change with tenant routing intact', async () => {
    await createOrganization();
    const event = await waitForEvent((entry) => entry.table === 'organizations' && entry.op === 'INSERT');
    expect(event.tenantId).toBe(tenantId);
    expect(event.op).toBe('INSERT');
  });

  it('should name the job kind on a delete issued outside any atomic block', async () => {
    const id = await createOrganization();
    await waitForEvent((event) => event.table === 'organizations' && event.op === 'INSERT');
    events.length = 0;

    const jobOrigin: EventOrigin = { type: 'job', tenantId, jobKind: 'probe-recompute', interactive: false };
    await services.withOrigin(jobOrigin).organizations.deleteOrganizations([id]);

    const event = await waitForEvent((entry) => entry.table === 'organizations' && entry.op === 'DELETE');
    expect(event.origin).toBe('probe-recompute');
    expect(event.tenantId).toBe(tenantId);
  });

  /** The seven trigger functions carry the same gate by hand, so each one is exercised on a table it routes. */
  const expectNoOpGate = async (table: string, noOpUpdate: () => PromiseLike<unknown>, realUpdate: () => PromiseLike<unknown>): Promise<void> => {
    events.length = 0;
    await noOpUpdate();
    await settle();
    expect(eventsFor(table, 'UPDATE'), `${table} rang on a no-op update`).toHaveLength(0);

    await realUpdate();
    const event = await waitForEvent((entry) => entry.table === table && entry.op === 'UPDATE');
    expect(event.tenantId).toBe(tenantId);
  };

  it('should gate no-op updates in the self-tenant trigger function', async () => {
    const stored = (await db.select().from(tenants).where(eq(tenants.id, tenantId)))[0];
    await expectNoOpGate(
      'tenants',
      () => db.update(tenants).set({ name: stored.name }).where(eq(tenants.id, tenantId)),
      () => db.update(tenants).set({ name: `${stored.name} renamed` }).where(eq(tenants.id, tenantId)),
    );
  });

  const createAsset = async (name: string): Promise<string> => {
    const id = uuidv7();
    await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
      id, name, description: null, ownerId: null, exposure: 'internal', categoryId: 'host', criticality: 'high',
    });
    return id;
  };

  it('should not ring when only a sync date moves, in the tenant trigger function', async () => {
    const assetId = await createAsset('Synced asset');
    await waitForEvent((event) => event.table === 'supporting_assets' && event.op === 'INSERT');

    await expectNoOpGate(
      'supporting_assets',
      () => db.update(supportingAssets).set({ lastSeenAt: new Date('2026-10-01T00:00:00Z') }).where(eq(supportingAssets.id, assetId)),
      () => db.update(supportingAssets).set({ name: 'Renamed asset' }).where(eq(supportingAssets.id, assetId)),
    );
  });

  it('should not ring when only a sync date moves, in the via-FK trigger function', async () => {
    const assetId = await createAsset('Evidence asset');
    const evidenceId = uuidv7();
    await db.insert(assetEvidence).values([{
      id: evidenceId, supportingAssetId: assetId, tenantId, mitreTechniqueId: TECHNIQUE_T1003, expectationType: 'prevention',
    }]);
    const sourceId = uuidv7();
    await db.insert(assetEvidenceSources).values([{ id: sourceId, tenantId, assetEvidenceId: evidenceId, reportedSeverity: 'low' }]);
    const inserted = await waitForEvent((event) => event.table === 'asset_evidence_sources' && event.op === 'INSERT');
    expect(inserted.tenantId).toBe(tenantId);

    await expectNoOpGate(
      'asset_evidence_sources',
      () => db.update(assetEvidenceSources)
        .set({ lastReportedAt: new Date('2026-10-01T00:00:00Z'), lastSeenAt: new Date('2026-10-01T00:00:00Z') })
        .where(eq(assetEvidenceSources.id, sourceId)),
      () => db.update(assetEvidenceSources).set({ reportedSeverity: 'critical' }).where(eq(assetEvidenceSources.id, sourceId)),
    );
  });

  it('should not ring when only the report date of a relation moves', async () => {
    const identityId = await createAsset('Identity');
    const deviceId = await createAsset('Device');
    await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('microsoft_graph', null);
    const connectorId = (await services.withOrigin(adminOrigin).integrationSettings.getConnectorId('microsoft_graph'))!;
    const relationId = uuidv7();
    await db.insert(supportingAssetRelations).values({
      id: relationId,
      tenantId,
      connectorId,
      fromAssetId: identityId,
      toAssetId: deviceId,
      kind: 'primary_user_of',
      source: 'entra_registered_owner',
      firstSeenAt: new Date('2026-09-01T00:00:00Z'),
      lastReportedAt: new Date('2026-09-01T00:00:00Z'),
    });
    await waitForEvent((event) => event.table === 'supporting_asset_relations' && event.op === 'INSERT');

    await expectNoOpGate(
      'supporting_asset_relations',
      () => db.update(supportingAssetRelations).set({ lastReportedAt: new Date('2026-10-01T00:00:00Z') }).where(eq(supportingAssetRelations.id, relationId)),
      () => db.update(supportingAssetRelations).set({ source: 'intune_primary_user' }).where(eq(supportingAssetRelations.id, relationId)),
    );
  });

  const createRiskScenario = async (): Promise<string> => {
    const organizationId = await createOrganization();
    const outcome = (await services.withOrigin(adminOrigin).attackOutcomes.getAttackOutcomes()).at(0);
    if (!outcome) {
      throw new Error('No attack outcome seeded');
    }
    const riskScenarioId = uuidv7();
    await services.withOrigin(adminOrigin).riskScenarios.createRiskScenario({
      id: riskScenarioId,
      organizationId,
      name: 'Gated scenario',
      description: null,
      attackOutcomeId: outcome.id,
      primaryAssetIds: [],
    });
    return riskScenarioId;
  };

  /** A CRQ run under a risk scenario of the tenant, the parent of the run-routed tables. */
  const createCrqRun = async (): Promise<string> => {
    const riskScenarioId = await createRiskScenario();
    const runId = uuidv7();
    await db.insert(crqIndicatorRuns).values({
      id: runId,
      riskScenarioId,
      iterations: 10,
      vulnerabilityP5: 0.1,
      vulnerabilityP50: 0.2,
      vulnerabilityP95: 0.3,
      techniqueCount: 1,
      coveredTechniqueCount: 0,
    });
    const inserted = await waitForEvent((event) => event.table === 'crq_indicator_runs' && event.op === 'INSERT');
    expect(inserted.tenantId).toBe(tenantId);
    return runId;
  };

  it('should gate no-op updates in the via-FK trigger function', async () => {
    const runId = await createCrqRun();
    await expectNoOpGate(
      'crq_indicator_runs',
      () => db.update(crqIndicatorRuns).set({ iterations: 10 }).where(eq(crqIndicatorRuns.id, runId)),
      () => db.update(crqIndicatorRuns).set({ iterations: 20 }).where(eq(crqIndicatorRuns.id, runId)),
    );
  });

  it('should gate no-op updates in the two-hop FK trigger function', async () => {
    const organizationId = await createOrganization();
    const reviewId = uuidv7();
    await db.insert(budgetReviews).values({ id: reviewId, organizationId, name: 'Gated review', periodStart: '2026-01-01' });
    const lineId = uuidv7();
    await db.insert(budgetReviewLines).values({ id: lineId, reviewId, name: 'Gated line', nature: 'run', amountSpent: 100 });
    const inserted = await waitForEvent((event) => event.table === 'budget_review_lines' && event.op === 'INSERT');
    expect(inserted.tenantId).toBe(tenantId);

    await expectNoOpGate(
      'budget_review_lines',
      () => db.update(budgetReviewLines).set({ amountSpent: 100 }).where(eq(budgetReviewLines.id, lineId)),
      () => db.update(budgetReviewLines).set({ amountSpent: 200 }).where(eq(budgetReviewLines.id, lineId)),
    );
  });

  it('should gate no-op updates in the CRQ-run trigger function', async () => {
    const runId = await createCrqRun();
    const scoreId = uuidv7();
    await db.insert(crqIndicatorGroupScores).values({
      id: scoreId,
      runId,
      share: 1,
      vulnerabilityP5: 0.1,
      vulnerabilityP50: 0.2,
      vulnerabilityP95: 0.3,
      vulnerabilityMean: 0.2,
    });
    const inserted = await waitForEvent((event) => event.table === 'crq_indicator_group_scores' && event.op === 'INSERT');
    expect(inserted.tenantId).toBe(tenantId);

    await expectNoOpGate(
      'crq_indicator_group_scores',
      () => db.update(crqIndicatorGroupScores).set({ share: 1 }).where(eq(crqIndicatorGroupScores.id, scoreId)),
      () => db.update(crqIndicatorGroupScores).set({ share: 0.5 }).where(eq(crqIndicatorGroupScores.id, scoreId)),
    );
  });
});

import { createJobContext } from '@app/back/src/engines/job-runtime/job-context-factory';
import { bundleRescoreKey, threatOutcomeCounterRecomputeHandler } from '@app/back/src/features/threat-outcome-counter/threat-outcome-counter-recompute-handler';
import type { EventOrigin } from '@app/module';
import {
  jobs,
  openctiStreamObjects,
  OUTCOME_COUNTER_VERSION,
  parseThreatBundle,
  storedFiles,
  threatAnalyses,
  threatOutcomeCounterVersions,
} from '@app/module';
import { and, asc, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

// The handler books its follow-ups through the backend's own database engine, which builds from the
// backend config at import time, and the shared setup stubs that config out.
vi.mock('../../../../back/src/config', async () => {
  const setup = await import('../../setup/pg-config');
  return {
    config: () => ({ postgres: { ...setup.pgConfig, database: setup.getWorkerDbName() } }),
    pmConfig: {},
    getProcessName: () => 'test',
  };
});

const services = createTestServices(db);

const KIND = 'threat-outcome-counter-recompute';
const MIRRORED = 'intrusion-set--cccccccc-0000-4000-8000-000000000001';
const UPLOADED = 'intrusion-set--cccccccc-0000-4000-8000-000000000002';

const groupObject = (id: string, name: string) => ({
  type: 'intrusion-set',
  id,
  name,
  description: 'The group encrypts files on victim networks and demands a ransom payment in exchange for the decryption key.',
  confidence: 80,
});

describe('the outcome counter recompute job', () => {
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

  const run = () => threatOutcomeCounterRecomputeHandler(createJobContext({
    jobId: uuidv7(),
    tenantId,
    kind: KIND,
    interactive: false,
    payload: {},
    attempt: 1,
    state: null,
    signal: new AbortController().signal,
    deps: { updateProgress: () => Promise.resolve(), saveStateSnapshot: () => Promise.resolve() },
    runDb: db,
  }));

  const ingest = (...objects: Array<Record<string, unknown>>) => services.withOrigin(adminOrigin).threatAnalyses.ingestBundle(
    parseThreatBundle({ type: 'bundle', id: 'bundle--cccccccc-0000-4000-8000-0000000000ff', objects }),
    tenantId,
    'stix-import',
  );

  const analysisOf = async (stixId: string) => {
    const row = (await db.select().from(threatAnalyses)
      .where(and(eq(threatAnalyses.tenantId, tenantId), eq(threatAnalyses.stixId, stixId)))).at(0);
    if (!row) {
      throw new Error(`No threat for ${stixId}`);
    }
    return row;
  };

  const dispatchedVersion = async () =>
    (await db.select().from(threatOutcomeCounterVersions).where(eq(threatOutcomeCounterVersions.tenantId, tenantId))).at(0)?.dispatchedVersion ?? null;

  /** What a deploy of a new model leaves behind: the tenant was last dispatched under another version. */
  const dispatchedUnder = (version: string) => db.insert(threatOutcomeCounterVersions).values([{ tenantId, dispatchedVersion: version }])
    .onConflictDoUpdate({ target: threatOutcomeCounterVersions.tenantId, set: { dispatchedVersion: version } });

  const forgetModel = (stixId: string) => db.update(threatAnalyses).set({ outcomeModelVersion: null })
    .where(and(eq(threatAnalyses.tenantId, tenantId), eq(threatAnalyses.stixId, stixId)));

  const mirrorRow = async (stixId: string) =>
    (await db.select().from(openctiStreamObjects)
      .where(and(eq(openctiStreamObjects.tenantId, tenantId), eq(openctiStreamObjects.stixId, stixId))))[0];

  const bundleJobs = () => db.select().from(jobs)
    .where(and(eq(jobs.tenantId, tenantId), eq(jobs.kind, 'threat-bundle-outcome-rescore')))
    .orderBy(asc(jobs.enqueuedAt));

  const storeFile = async (createdAt: string, createdBy: string | null = adminUserId): Promise<string> => {
    const id = uuidv7();
    await db.insert(storedFiles).values([{
      id, tenantId, storageKey: uuidv7(), originalName: `${id}.json`, mimeType: 'application/json', sizeBytes: 2, createdBy, createdAt: new Date(createdAt),
    }]);
    return id;
  };

  /** The mirror holds the threat, as the stream would have left it once rebuilt. */
  const mirrorThreat = async (stixId: string, name: string) => {
    const connector = services.withOrigin(adminOrigin).openctiConnector;
    await connector.upsertStreamObject(tenantId, stixId, 'intrusion-set', groupObject(stixId, name));
    await services.withOrigin({ type: 'job', tenantId, jobKind: 'opencti-mirror-rebuild', interactive: false })
      .openctiConnector.rebuildPendingBatch(tenantId, 50);
  };

  it('should mark a threat the mirror holds when it was never scored, and have the rebuild score it', async () => {
    await mirrorThreat(MIRRORED, 'Harbor Locksmiths');
    await forgetModel(MIRRORED);
    expect((await mirrorRow(MIRRORED)).pending).toBe(false);

    await run();

    expect((await mirrorRow(MIRRORED)).pending).toBe(true);
    expect(await bundleJobs()).toEqual([]);
    await services.withOrigin({ type: 'job', tenantId, jobKind: 'opencti-mirror-rebuild', interactive: false })
      .openctiConnector.rebuildPendingBatch(tenantId, 50);
    expect((await analysisOf(MIRRORED)).outcomeModelVersion).toBe(OUTCOME_COUNTER_VERSION);
  });

  it('should mark a threat scored under another model version', async () => {
    await mirrorThreat(MIRRORED, 'Harbor Locksmiths');
    await db.update(threatAnalyses).set({ outcomeModelVersion: '2020.01' }).where(eq(threatAnalyses.tenantId, tenantId));

    await run();

    expect((await mirrorRow(MIRRORED)).pending).toBe(true);
  });

  it('should leave a threat already marked as it is, so a run does not wake the mirror again', async () => {
    await mirrorThreat(MIRRORED, 'Harbor Locksmiths');
    await forgetModel(MIRRORED);
    await run();
    const marked = await mirrorRow(MIRRORED);
    await dispatchedUnder('2020.01');

    await run();

    expect((await mirrorRow(MIRRORED)).updatedAt).toEqual(marked.updatedAt);
  });

  it('should leave current threats alone: no mark, no booking', async () => {
    await mirrorThreat(MIRRORED, 'Harbor Locksmiths');
    await ingest(groupObject(UPLOADED, 'Dock Wardens'));
    await storeFile('2026-01-01T00:00:00Z');

    await run();

    expect((await mirrorRow(MIRRORED)).pending).toBe(false);
    expect(await bundleJobs()).toEqual([]);
  });

  it('should book one rescore reading every stored file oldest upload first, for the threats the mirror does not hold', async () => {
    await mirrorThreat(MIRRORED, 'Harbor Locksmiths');
    await ingest(groupObject(UPLOADED, 'Dock Wardens'));
    await forgetModel(MIRRORED);
    await forgetModel(UPLOADED);
    const newest = await storeFile('2026-03-01T00:00:00Z');
    const oldest = await storeFile('2026-01-01T00:00:00Z');

    await run();

    const booked = await bundleJobs();
    expect(booked.map((job) => job.payload)).toEqual([{
      files: [{ storedFileId: oldest, userId: adminUserId }, { storedFileId: newest, userId: adminUserId }],
      stixIds: [UPLOADED],
    }]);
    expect(booked.map((job) => job.idempotencyKey)).toEqual([bundleRescoreKey()]);
    expect(booked.every((job) => !job.interactive && job.triggeredBy === 'system')).toBe(true);
  });

  it('should not book the rescore again once its run is over, even when the threat is still stale', async () => {
    await ingest(groupObject(UPLOADED, 'Dock Wardens'));
    await forgetModel(UPLOADED);
    await storeFile('2026-01-01T00:00:00Z');
    await run();
    await db.update(jobs).set({ status: 'succeeded', finishedAt: new Date() }).where(eq(jobs.tenantId, tenantId));
    await dispatchedUnder('2020.01');

    await run();

    expect(await bundleJobs()).toHaveLength(1);
  });

  it('should book nothing for a file whose uploader no longer exists', async () => {
    await ingest(groupObject(UPLOADED, 'Dock Wardens'));
    await forgetModel(UPLOADED);
    await storeFile('2026-01-01T00:00:00Z', null);

    await run();

    expect(await bundleJobs()).toEqual([]);
  });

  it('should send a stale threat the mirror holds to the mirror alone, not to the files', async () => {
    await mirrorThreat(MIRRORED, 'Harbor Locksmiths');
    await forgetModel(MIRRORED);
    await storeFile('2026-01-01T00:00:00Z');

    await run();

    expect(await bundleJobs()).toEqual([]);
  });

  it('should leave a stale default threat to its own sync: no booking, and the version recorded', async () => {
    await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle(
      parseThreatBundle({ type: 'bundle', id: 'bundle--cccccccc-0000-4000-8000-0000000000fe', objects: [groupObject(UPLOADED, 'Dock Wardens')] }),
      tenantId,
      'default-threats',
    );
    await forgetModel(UPLOADED);
    await storeFile('2026-01-01T00:00:00Z');

    await run();

    expect(await bundleJobs()).toEqual([]);
    expect(await dispatchedVersion()).toBe(OUTCOME_COUNTER_VERSION);
  });

  it('should record the model version once every stale threat is sent back', async () => {
    await mirrorThreat(MIRRORED, 'Harbor Locksmiths');
    await forgetModel(MIRRORED);

    await run();

    expect(await dispatchedVersion()).toBe(OUTCOME_COUNTER_VERSION);
  });

  // The rescoring writes the analyses batch after batch: a run that read them again would be woken
  // by each batch, so once the version is recorded nothing else is read.
  it('should read no analysis once the current version is recorded', async () => {
    await mirrorThreat(MIRRORED, 'Harbor Locksmiths');
    await run();
    await forgetModel(MIRRORED);

    await run();

    expect((await mirrorRow(MIRRORED)).pending).toBe(false);
  });

  it('should send the threats back again once the recorded version is an older model', async () => {
    await mirrorThreat(MIRRORED, 'Harbor Locksmiths');
    await run();
    await forgetModel(MIRRORED);
    await dispatchedUnder('2020.01');

    await run();

    expect((await mirrorRow(MIRRORED)).pending).toBe(true);
    expect(await dispatchedVersion()).toBe(OUTCOME_COUNTER_VERSION);
  });
});

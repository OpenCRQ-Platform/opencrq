import type { EventOrigin } from '@app/module';
import { jobs as jobsTable } from '@app/module';
import { eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantWithAdmin } from '../../../helpers/factories';
import { holdWriteOpen, waitUntilBlockedByAnotherBackend } from '../../../helpers/held-transaction';
import { db } from '../../../setup/db';
import { createTestServices, truncateAllTables } from '../../../setup/test-context';

const services = createTestServices(db);
const SYSTEM_ORIGIN: EventOrigin = { type: 'system' };

const levers = (...ids: Array<string>) => ({ techniques: false, cves: false, levers: ids, plans: [] });
const plans = (...ids: Array<string>) => ({ techniques: false, cves: false, levers: [], plans: ids });

const readJob = async (jobId: string) =>
  (await db.select().from(jobsTable).where(eq(jobsTable.id, jobId))).at(0);

describe('jobs idempotency key dedup', () => {
  let tenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    tenantId = setup.tenantId;
  });

  it('returns the same jobId for two enqueues with the same idempotency key', async () => {
    const first = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: { run: 1 },
      idempotencyKey: 'daily-2026-05-21',
    });
    const second = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: { run: 2 },
      idempotencyKey: 'daily-2026-05-21',
    });

    expect(first.alreadyExisted).toBe(false);
    expect(second.alreadyExisted).toBe(true);
    expect(second.jobId).toBe(first.jobId);
  });

  it('keeps the first payload on a fold for a kind that declares no payload fold', async () => {
    const jobsService = services.withOrigin(SYSTEM_ORIGIN).jobs;
    const { jobId } = await jobsService.enqueueJob({ kind: 'noop', tenantId, payload: { asks: ['a'] }, idempotencyKey: 'k' });
    await jobsService.enqueueJob({ kind: 'noop', tenantId, payload: { asks: ['b'] }, idempotencyKey: 'k' });

    expect((await readJob(jobId))!.payload).toEqual({ asks: ['a'] });
  });

  it('widens the payload of a kind that declares a fold, and follows it on the dedupe key', async () => {
    const jobsService = services.withOrigin(SYSTEM_ORIGIN).jobs;
    const { jobId } = await jobsService.enqueueJob({ kind: 'crq-simulation', tenantId, payload: { riskScenarioId: 's', profile: levers('a') }, idempotencyKey: 'k' });
    await jobsService.enqueueJob({ kind: 'crq-simulation', tenantId, payload: { riskScenarioId: 's', profile: plans('p') }, idempotencyKey: 'k' });

    const widened = { riskScenarioId: 's', profile: { techniques: false, cves: false, levers: ['a'], plans: ['p'] } };
    expect((await readJob(jobId))!.payload).toEqual(widened);
    expect(await jobsService.enqueueJob({ kind: 'crq-simulation', tenantId, payload: widened })).toEqual({ jobId, alreadyExisted: true });
  });

  it('folds the ask into the active row already carrying the widened payload, under another key', async () => {
    const jobsService = services.withOrigin(SYSTEM_ORIGIN).jobs;
    const { jobId: held } = await jobsService.enqueueJob({ kind: 'crq-simulation', tenantId, payload: { riskScenarioId: 's', profile: levers('a') }, idempotencyKey: 'k1' });
    const { jobId: other } = await jobsService.enqueueJob({
      kind: 'crq-simulation',
      tenantId,
      payload: { riskScenarioId: 's', profile: { techniques: false, cves: false, levers: ['a'], plans: ['p'] } },
      idempotencyKey: 'k2',
    });

    const folded = await jobsService.enqueueJob({
      kind: 'crq-simulation',
      tenantId,
      payload: { riskScenarioId: 's', profile: plans('p') },
      idempotencyKey: 'k1',
      interactive: true,
    });

    expect(folded).toEqual({ jobId: other, alreadyExisted: true });
    expect((await readJob(held))!.payload).toEqual({ riskScenarioId: 's', profile: levers('a') });
    expect((await readJob(other))!.interactive).toBe(true);
  });

  it('allows re-enqueue with the same key once the previous job is no longer active', async () => {
    const first = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
      idempotencyKey: 'k',
    });
    await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('w1', ['noop'], 30_000);
    await services.withOrigin(SYSTEM_ORIGIN).jobs.recordSuccess(first.jobId, 'w1');

    const second = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
      idempotencyKey: 'k',
    });

    expect(second.alreadyExisted).toBe(false);
    expect(second.jobId).not.toBe(first.jobId);
  });

  it('should name, among the keys asked, only those an active job holds', async () => {
    const jobsService = services.withOrigin(SYSTEM_ORIGIN).jobs;
    const finished = await jobsService.enqueueJob({ kind: 'noop', tenantId, payload: { run: 'finished' }, idempotencyKey: 'finished' });
    await jobsService.claimNext('w1', ['noop'], 30_000);
    await jobsService.recordSuccess(finished.jobId, 'w1');
    await jobsService.enqueueJob({ kind: 'noop', tenantId, payload: { run: 'queued' }, idempotencyKey: 'queued' });
    await jobsService.enqueueJob({ kind: 'noop', tenantId, payload: { run: 'not-asked' }, idempotencyKey: 'not-asked' });

    expect(await jobsService.getActiveIdempotencyKeys(tenantId, ['finished', 'queued', 'never-enqueued'])).toEqual(new Set(['queued']));
    expect(await jobsService.getActiveIdempotencyKeys(tenantId, [])).toEqual(new Set());
  });

  // The fold the dispatcher does in memory, owed again once the ask has reached the table: a save
  // absorbed by a queued sweep must not be served on the sweep's window.
  it('raises a queued sweep to interactive when an awaited ask is absorbed into it', async () => {
    const sweep = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
      idempotencyKey: 'fold',
    });
    expect((await readJob(sweep.jobId))?.interactive).toBe(false);

    const save = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
      idempotencyKey: 'fold',
      interactive: true,
    });

    expect(save.jobId).toBe(sweep.jobId);
    expect((await readJob(sweep.jobId))?.interactive).toBe(true);
  });

  it('never lowers an awaited job back to the coarse window', async () => {
    const save = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
      idempotencyKey: 'fold',
      interactive: true,
    });
    await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
      idempotencyKey: 'fold',
    });

    expect((await readJob(save.jobId))?.interactive).toBe(true);
  });

  // Past the claim the run has already stamped its window on the transactions it writes, so
  // raising the row would say one thing while its notifications say another.
  it('does not raise a job that has already been claimed', async () => {
    const running = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
      idempotencyKey: 'fold',
    });
    await services.withOrigin(SYSTEM_ORIGIN).jobs.claimNext('w1', ['noop'], 30_000);

    const absorbed = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
      idempotencyKey: 'fold',
      interactive: true,
    });

    expect(absorbed.jobId).toBe(running.jobId);
    expect((await readJob(running.jobId))?.interactive).toBe(false);
  });

  // Whichever of the two absorption paths the pair takes — the in-transaction find, or the unique
  // violation when both insert — the surviving row must carry the awaited window. Which one runs
  // here is a matter of timing, so this pins the invariant rather than either branch.
  it('leaves one row on the awaited window when a save and a sweep book the same key at once', async () => {
    const [first, second] = await Promise.all([
      services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
        kind: 'noop',
        tenantId,
        payload: {},
        idempotencyKey: 'race',
      }),
      services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
        kind: 'noop',
        tenantId,
        payload: {},
        idempotencyKey: 'race',
        interactive: true,
      }),
    ]);

    expect(second.jobId).toBe(first.jobId);
    expect((await readJob(first.jobId))?.interactive).toBe(true);
  });

  // The absorption out of the transaction: an uncommitted winner is invisible to the finders
  // inside, so the enqueue misses it, blocks on `jobs_idempotency_idx` at the INSERT, and is
  // handed the unique violation once the holder commits.
  it('raises the winner when the ask loses the insert race outright', async () => {
    const winnerId = uuidv7();
    const holder = holdWriteOpen((tx) =>
      tx.insert(jobsTable).values({
        id: winnerId,
        tenantId,
        kind: 'noop',
        payload: { winner: true },
        payloadHash: 'held-by-hand',
        idempotencyKey: 'lost-race',
      }),
    );
    await holder.locked;

    const absorbed = services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
      idempotencyKey: 'lost-race',
      interactive: true,
    });
    const blocked = await waitUntilBlockedByAnotherBackend();
    holder.commit();
    const [result] = await Promise.all([absorbed, holder.done]);

    expect(blocked).toBe(true);
    expect(result.jobId).toBe(winnerId);
    expect(result.alreadyExisted).toBe(true);
    expect((await readJob(winnerId))?.interactive).toBe(true);
  });

  // The claim lands between the fold's read and its write, and the fold's writes are fenced on the
  // status it was told, so an unlocked read leaves it writing nothing while the enqueue still
  // reports the ask as taken.
  it('owes a follow-up when a claim takes the row it is folding into', async () => {
    const { jobId } = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
      idempotencyKey: 'claim-race',
    });
    const claimer = holdWriteOpen((tx) =>
      tx.execute(sql`
        UPDATE jobs SET status = 'running', claimed_by = 'w1', claimed_at = now(),
          leased_until = now() + interval '30 seconds', started_at = now(), attempt = attempt + 1
        WHERE id = ${jobId} AND status = 'queued'
      `),
    );
    await claimer.locked;

    const absorbed = services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: {},
      idempotencyKey: 'claim-race',
      interactive: true,
    });
    const blocked = await waitUntilBlockedByAnotherBackend();
    claimer.commit();
    const [result] = await Promise.all([absorbed, claimer.done]);

    expect(blocked).toBe(true);
    expect(result.jobId).toBe(jobId);
    const job = await readJob(jobId);
    expect(job?.status).toBe('running');
    expect(job?.interactive).toBe(false);
    expect(job?.absorbedAsk).toBe(true);
    expect(job?.absorbedAskInteractive).toBe(true);
  });

  it('does not dedup when no idempotency key is provided and payloads differ', async () => {
    const a = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: { x: 1 },
    });
    const b = await services.withOrigin(SYSTEM_ORIGIN).jobs.enqueueJob({
      kind: 'noop',
      tenantId,
      payload: { x: 2 },
    });

    expect(a.jobId).not.toBe(b.jobId);
    expect(b.alreadyExisted).toBe(false);
  });
});

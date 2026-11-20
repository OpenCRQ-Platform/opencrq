import { newError } from '@app/utils';
import { and, asc, count, desc, eq, gt, gte, ilike, inArray, isNull, lt, lte, not, notInArray, or, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { EventOrigin, SecuredSchema } from '../../security';
import type {
  ActiveRunCounts,
  ClaimedJob,
  JobErrorRecord,
  JobStatus,
  ListJobsFilters,
  ProgressUpdate,
  RunClaimability,
  RunCounts,
  RunListOrder,
  RunQuery,
  RunSortKey,
  RunSummary,
  ScenarioComputation,
  ScheduledBooking,
  SerializedSlot,
  SettledJob,
} from './types';
import { foldedLike } from '../../db/fold-text';
import { escapeLikePattern } from '../../db/like-pattern';
import { orderNullsLast } from '../../db/order-nulls-last';
import { defineRepository } from '../../registry';
import { ACTIVE_JOB_STATUSES, jobErrors, jobs, TERMINAL_JOB_STATUSES } from './schema';

const DEFAULT_LIST_LIMIT = 100;

const assertSystemOrigin = (eventOrigin: EventOrigin, method: string): void => {
  if (eventOrigin.type !== 'system') {
    throw newError(`jobs.${method} requires a system event origin`, { actualType: eventOrigin.type });
  }
};

// Server-side SQL fragments (now(), make_interval) used in place of JS Date
// to avoid worker-clock skew on lease/run_after writes.
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast to Date for timestamp columns
const sqlAsDate = (expr: ReturnType<typeof sql>) => expr as unknown as Date;

const absorbTarget = (views: SecuredSchema) => ({
  id: views.jobs.id,
  tenantId: views.jobs.tenantId,
  kind: views.jobs.kind,
  status: views.jobs.status,
  payload: views.jobs.payload,
  resumes: sql<boolean>`${views.jobs.stateSnapshot} is not null`,
  absorbedAsk: views.jobs.absorbedAsk,
  absorbedAskInteractive: views.jobs.absorbedAskInteractive,
  triggeredBy: views.jobs.triggeredBy,
  triggeredById: views.jobs.triggeredById,
  askedByOthers: views.jobs.askedByOthers,
});

/**
 * Every return to `queued`. The attempt that follows answers what the run absorbed exactly when it
 * starts clean, so a row left with resume state keeps the ask and a row left without discharges it,
 * taking over its awaited window when somebody waits on it. Written as SQL rather than from a read
 * value because the snapshot is the handler's to write and this runs after its last chance to.
 */
const keepAskOnlyIfResuming = () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: SQL expression for a boolean column
  interactive: sql`interactive OR (absorbed_ask AND absorbed_ask_interactive AND state_snapshot IS NULL)` as unknown as boolean,
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: SQL expression for a boolean column
  absorbedAsk: sql`absorbed_ask AND state_snapshot IS NOT NULL` as unknown as boolean,
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: SQL expression for a boolean column
  absorbedAskInteractive: sql`absorbed_ask_interactive AND state_snapshot IS NOT NULL` as unknown as boolean,
});

/**
 * Guards a worker's return to `queued`, which clears `abort_requested_at`: a run asked to stop is
 * never requeued, since the request would be gone before the runtime's poll reads it. The caller
 * cancels it instead.
 */
const notAskedToStop = () => isNull(jobs.abortRequestedAt);

/** Every `RunSortKey` but `duration`, which is a computed expression rather than a stored column. */
const RUN_SORT_COLUMNS = (views: SecuredSchema): Record<Exclude<RunSortKey, 'duration'>, PgColumn> => ({
  enqueuedAt: views.jobs.enqueuedAt,
  startedAt: views.jobs.startedAt,
  claimedAt: views.jobs.claimedAt,
  finishedAt: views.jobs.finishedAt,
  kind: views.jobs.kind,
  status: views.jobs.status,
  triggeredBy: views.jobs.triggeredBy,
  attempt: views.jobs.attempt,
  priority: views.jobs.priority,
});

/** The default sort, `enqueuedAt`, walks `jobs_tenant_idx` in both directions. */
const runOrderBy = (views: SecuredSchema, sortBy: RunSortKey, sortDesc: boolean) => orderNullsLast(
  sortBy === 'duration' ? sql`(${views.jobs.finishedAt} - ${views.jobs.claimedAt})` : RUN_SORT_COLUMNS(views)[sortBy],
  sortDesc,
);

/** The columns a run-list row exposes to a client, shared by every read that projects one. */
const runListColumns = (views: SecuredSchema) => ({
  id: views.jobs.id,
  kind: views.jobs.kind,
  status: views.jobs.status,
  enqueuedAt: views.jobs.enqueuedAt,
  startedAt: views.jobs.startedAt,
  claimedAt: views.jobs.claimedAt,
  finishedAt: views.jobs.finishedAt,
  processedTotal: views.jobs.processedTotal,
  expectedTotal: views.jobs.expectedTotal,
  progressMessage: views.jobs.progressMessage,
  attempt: views.jobs.attempt,
  maxAttempts: views.jobs.maxAttempts,
  priority: views.jobs.priority,
  runAfter: views.jobs.runAfter,
  leasedUntil: views.jobs.leasedUntil,
  errorMessage: views.jobs.errorMessage,
  triggeredBy: views.jobs.triggeredBy,
  triggeredById: views.jobs.triggeredById,
  payload: views.jobs.payload,
  absorbedAsk: views.jobs.absorbedAsk,
  interactive: views.jobs.interactive,
});

const withTypedPayload = <T extends { payload: unknown }>(row: T): T & { payload: Record<string, unknown> } => ({
  ...row,
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- jsonb column: handler-defined payload is always Record<string, unknown>
  payload: row.payload as Record<string, unknown>,
});

// The payload is left out: the response redacts it, and matching the raw text would let a search
// recover a redacted value one character at a time.
const searchRuns = (views: SecuredSchema, search: string) => or(
  ilike(views.jobs.kind, `%${escapeLikePattern(search)}%`),
  foldedLike(views.jobs.progressMessageFolded, search, 'contains'),
  foldedLike(views.jobs.errorMessageFolded, search, 'contains'),
);

const buildRunFilters = (views: SecuredSchema, query: RunQuery) => [
  eq(views.jobs.tenantId, query.tenantId),
  query.kinds ? inArray(views.jobs.kind, [...query.kinds]) : undefined,
  query.statuses ? inArray(views.jobs.status, [...query.statuses]) : undefined,
  query.triggeredBy ? inArray(views.jobs.triggeredBy, [...query.triggeredBy]) : undefined,
  query.enqueuedFrom ? gte(views.jobs.enqueuedAt, query.enqueuedFrom) : undefined,
  query.enqueuedTo ? lte(views.jobs.enqueuedAt, query.enqueuedTo) : undefined,
  query.startedFrom ? gte(views.jobs.startedAt, query.startedFrom) : undefined,
  query.startedTo ? lte(views.jobs.startedAt, query.startedTo) : undefined,
  query.finishedFrom ? gte(views.jobs.finishedAt, query.finishedFrom) : undefined,
  query.finishedTo ? lte(views.jobs.finishedAt, query.finishedTo) : undefined,
  query.search ? searchRuns(views, query.search) : undefined,
].filter((c) => c !== undefined);

const settled = (row: typeof jobs.$inferSelect): SettledJob => ({
  id: row.id,
  absorbedAsk: row.absorbedAsk,
  absorbedAskInteractive: row.absorbedAskInteractive,
});

export const jobsRepository = defineRepository({
  insertJob: ({ db }, values: typeof jobs.$inferInsert) =>
    db.insert(jobs).values([values]),

  /**
   * `onConflictDoNothing` for the key already held: another active run of it answers the absorbed
   * ask just as well, where a raised unique violation would take down the terminal transition that
   * books this one.
   */
  insertFollowUpJob: async ({ db }, values: typeof jobs.$inferInsert): Promise<ReadonlyArray<{ id: string }>> => {
    const rows = await db.insert(jobs).values([values]).onConflictDoNothing().returning();
    return rows.map((r) => ({ id: r.id }));
  },

  markAbsorbedAsk: ({ db }, jobId: string, interactive: boolean) => {
    // Never written false: an ask nobody waits on must not unmark one that is waited on.
    const set: Partial<typeof jobs.$inferInsert> = interactive
      ? { absorbedAsk: true, absorbedAskInteractive: true }
      : { absorbedAsk: true };
    return db.update(jobs)
      .set(set)
      .where(and(eq(jobs.id, jobId), inArray(jobs.status, [...ACTIVE_JOB_STATUSES])));
  },

  // Never written false: a fold by the starter must not unmark a run others already wait on.
  markAskedByOthers: ({ db }, jobId: string) =>
    db.update(jobs)
      .set({ askedByOthers: true })
      .where(and(eq(jobs.id, jobId), inArray(jobs.status, [...ACTIVE_JOB_STATUSES]))),

  dropAbsorbedAsk: ({ db }, jobId: string) =>
    db.update(jobs)
      .set({ absorbedAsk: false, absorbedAskInteractive: false })
      .where(and(eq(jobs.id, jobId), inArray(jobs.status, [...ACTIVE_JOB_STATUSES]))),

  replaceActivePayload: ({ db }, jobId: string, payload: Record<string, unknown>, payloadHash: string) =>
    db.update(jobs)
      .set({ payload, payloadHash })
      .where(and(eq(jobs.id, jobId), inArray(jobs.status, [...ACTIVE_JOB_STATUSES]))),

  findActiveByIdempotencyKey: async ({ db, views }, tenantId: string, idempotencyKey: string) => {
    const rows = await db
      .select(absorbTarget(views))
      .from(views.jobs)
      .where(and(
        eq(views.jobs.tenantId, tenantId),
        eq(views.jobs.idempotencyKey, idempotencyKey),
        inArray(views.jobs.status, [...ACTIVE_JOB_STATUSES]),
      ))
      .limit(1);
    return rows.at(0);
  },

  findActiveIdempotencyKeys: async ({ db, views }, tenantId: string, idempotencyKeys: ReadonlyArray<string>) => {
    if (idempotencyKeys.length === 0) {
      return [];
    }
    return await db
      .selectDistinct({ idempotencyKey: views.jobs.idempotencyKey })
      .from(views.jobs)
      .where(and(
        eq(views.jobs.tenantId, tenantId),
        inArray(views.jobs.idempotencyKey, [...idempotencyKeys]),
        inArray(views.jobs.status, [...ACTIVE_JOB_STATUSES]),
      ));
  },

  /** Never reads a payload back: the caller learns only that a run exists. */
  hasActiveComputationForScenario: async ({ db, views }, tenantId: string, computation: ScenarioComputation): Promise<boolean> => {
    const scenarioIdInPayload = sql`${views.jobs.payload}->>'riskScenarioId'`;
    const rows = await db
      .select({ id: views.jobs.id })
      .from(views.jobs)
      .where(and(
        eq(views.jobs.tenantId, tenantId),
        inArray(views.jobs.status, [...ACTIVE_JOB_STATUSES]),
        or(
          and(
            eq(views.jobs.kind, computation.recomputeKind),
            or(eq(scenarioIdInPayload, computation.riskScenarioId), sql`${scenarioIdInPayload} is null`),
          ),
          eq(views.jobs.idempotencyKey, computation.simulationKey),
          computation.tenantWideKinds.length > 0 ? inArray(views.jobs.kind, [...computation.tenantWideKinds]) : undefined,
        ),
      ))
      .limit(1);
    return rows.length > 0;
  },

  /** The keys among `idempotencyKeys` that any run of the tenant ever held, whatever its status. */
  findBookedIdempotencyKeys: async ({ db, views }, tenantId: string, idempotencyKeys: ReadonlyArray<string>) => {
    if (idempotencyKeys.length === 0) {
      return [];
    }
    return await db
      .selectDistinct({ idempotencyKey: views.jobs.idempotencyKey })
      .from(views.jobs)
      .where(and(
        eq(views.jobs.tenantId, tenantId),
        inArray(views.jobs.idempotencyKey, [...idempotencyKeys]),
      ));
  },

  /**
   * The same row, held for the rest of the caller's transaction, so the status it reports cannot
   * change before the caller has acted on it: a claim racing the fold either waits behind this lock
   * or is skipped by `findNextClaimable`, which takes its candidates `SKIP LOCKED`. The guarantee is
   * the caller's, not this method's, since outside an `atomic` a row lock ends with the statement.
   */
  lockActiveByIdempotencyKey: async ({ db, views }, tenantId: string, idempotencyKey: string) => {
    const rows = await db
      .select(absorbTarget(views))
      .from(views.jobs)
      .where(and(
        eq(views.jobs.tenantId, tenantId),
        eq(views.jobs.idempotencyKey, idempotencyKey),
        inArray(views.jobs.status, [...ACTIVE_JOB_STATUSES]),
      ))
      .limit(1)
      .for('update');
    return rows.at(0);
  },

  // Served by `jobs_scheduler_idx`, which is what keeps this off the tenant's other jobs: without it
  // the walk goes back over every one of them, and over the whole history until five are booked.
  findRecentScheduledBookings: ({ db, views }, tenantId: string, kind: string, limit: number): Promise<Array<ScheduledBooking>> =>
    db
      .select({ status: views.jobs.status, finishedAt: views.jobs.finishedAt })
      .from(views.jobs)
      .where(and(
        eq(views.jobs.tenantId, tenantId),
        eq(views.jobs.kind, kind),
        eq(views.jobs.triggeredBy, 'scheduler'),
      ))
      .orderBy(desc(views.jobs.enqueuedAt))
      .limit(limit),

  findActiveByDedupeKey: async ({ db, views }, kind: string, tenantId: string, payloadHash: string) => {
    const rows = await db
      .select(absorbTarget(views))
      .from(views.jobs)
      .where(and(
        eq(views.jobs.kind, kind),
        eq(views.jobs.tenantId, tenantId),
        eq(views.jobs.payloadHash, payloadHash),
        inArray(views.jobs.status, [...ACTIVE_JOB_STATUSES]),
      ))
      .limit(1);
    return rows.at(0);
  },

  /** `lockActiveByIdempotencyKey` on every active run of a kind, in id order, and the same transactional contract. */
  lockActiveByKind: ({ db, views }, tenantId: string, kind: string) =>
    db
      .select(absorbTarget(views))
      .from(views.jobs)
      .where(and(
        eq(views.jobs.tenantId, tenantId),
        eq(views.jobs.kind, kind),
        inArray(views.jobs.status, [...ACTIVE_JOB_STATUSES]),
      ))
      .orderBy(asc(views.jobs.id))
      .for('update'),

  /** `lockActiveByIdempotencyKey` on the payload key, and the same transactional contract. */
  lockActiveByDedupeKey: async ({ db, views }, kind: string, tenantId: string, payloadHash: string) => {
    const rows = await db
      .select(absorbTarget(views))
      .from(views.jobs)
      .where(and(
        eq(views.jobs.kind, kind),
        eq(views.jobs.tenantId, tenantId),
        eq(views.jobs.payloadHash, payloadHash),
        inArray(views.jobs.status, [...ACTIVE_JOB_STATUSES]),
      ))
      .limit(1)
      .for('update');
    return rows.at(0);
  },

  /** `lockActiveByIdempotencyKey` on one row by id, whatever its status, and the same transactional contract. */
  lockJobById: async ({ db, views }, jobId: string) => {
    const rows = await db
      .select({ id: views.jobs.id, status: views.jobs.status, askedByOthers: views.jobs.askedByOthers })
      .from(views.jobs)
      .where(eq(views.jobs.id, jobId))
      .limit(1)
      .for('update');
    return rows.at(0);
  },

  findJobById: async ({ db, views }, id: string) => {
    const rows = await db.select().from(views.jobs).where(eq(views.jobs.id, id)).limit(1);
    return rows.at(0);
  },

  listJobs: ({ db, views }, filters: ListJobsFilters) => {
    const conditions = [];
    if (filters.tenantId) {
      conditions.push(eq(views.jobs.tenantId, filters.tenantId));
    }
    if (filters.kind) {
      conditions.push(eq(views.jobs.kind, filters.kind));
    }
    if (filters.status) {
      const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
      conditions.push(inArray(views.jobs.status, statuses));
    }
    return db
      .select()
      .from(views.jobs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(views.jobs.enqueuedAt))
      .limit(filters.limit ?? DEFAULT_LIST_LIMIT)
      .offset(filters.offset ?? 0);
  },

  // An aggregate, not listJobs: that read caps at DEFAULT_LIST_LIMIT rows and a busy queue
  // would silently undercount.
  findActiveRunCounts: async ({ db, views }, tenantId: string, kinds: ReadonlyArray<string>): Promise<ActiveRunCounts> => {
    if (kinds.length === 0) {
      return { queued: 0, running: 0 };
    }
    const [row] = await db
      .select({
        queued: sql<number>`count(*) filter (where ${eq(views.jobs.status, 'queued')})`,
        running: sql<number>`count(*) filter (where ${eq(views.jobs.status, 'running')})`,
      })
      .from(views.jobs)
      .where(and(eq(views.jobs.tenantId, tenantId), inArray(views.jobs.kind, [...kinds])));
    return {
      queued: Number(row?.queued ?? 0),
      running: Number(row?.running ?? 0),
    };
  },

  /**
   * Per job kind, the run in flight and the last one that stopped. Two queries whatever the number of
   * kinds asked for, the connectors list asking for every kind at once.
   *
   * A terminal transition always stamps `finished_at`, so ordering the stopped runs on it is total.
   */
  findRunSummariesByKind: async ({ db, views }, tenantId: string, kinds: ReadonlyArray<string>): Promise<Array<RunSummary>> => {
    if (kinds.length === 0) {
      return [];
    }
    const scoped = and(eq(views.jobs.tenantId, tenantId), inArray(views.jobs.kind, [...kinds]));
    const columns = {
      id: views.jobs.id,
      kind: views.jobs.kind,
      status: views.jobs.status,
      enqueuedAt: views.jobs.enqueuedAt,
      startedAt: views.jobs.startedAt,
      claimedAt: views.jobs.claimedAt,
      finishedAt: views.jobs.finishedAt,
      processedTotal: views.jobs.processedTotal,
      expectedTotal: views.jobs.expectedTotal,
      attempt: views.jobs.attempt,
      maxAttempts: views.jobs.maxAttempts,
      triggeredBy: views.jobs.triggeredBy,
      triggeredById: views.jobs.triggeredById,
      askedByOthers: views.jobs.askedByOthers,
    };
    const [terminalRows, activeRows] = await Promise.all([
      // eslint-disable-next-line app/no-distinct-on-subquery -- grows with the tenant's finished runs, which the purge caps by age, not count
      db
        .selectDistinctOn([views.jobs.kind], columns)
        .from(views.jobs)
        .where(and(scoped, inArray(views.jobs.status, [...TERMINAL_JOB_STATUSES])))
        .orderBy(views.jobs.kind, desc(views.jobs.finishedAt)),
      // bounded-by: the tenant's queued and running runs
      db
        .selectDistinctOn([views.jobs.kind], columns)
        .from(views.jobs)
        .where(and(scoped, inArray(views.jobs.status, [...ACTIVE_JOB_STATUSES])))
        .orderBy(views.jobs.kind, desc(views.jobs.enqueuedAt)),
    ]);
    const terminalByKind = new Map(terminalRows.map((row) => [row.kind, row]));
    const activeByKind = new Map(activeRows.map((row) => [row.kind, row]));
    return kinds.map((kind) => ({
      kind,
      activeRun: activeByKind.get(kind) ?? null,
      lastTerminalRun: terminalByKind.get(kind) ?? null,
    }));
  },

  /**
   * Per tenant and job kind, the status of the run in flight and of the last one that stopped,
   * across every tenant: the platform's own health read, system origin only. Two queries whatever
   * the number of tenants.
   */
  findPlatformRunStatuses: async ({ db, views }, eventOrigin: EventOrigin): Promise<Array<{
    tenantId: string,
    kind: string,
    activeStatus: JobStatus | null,
    lastTerminalStatus: JobStatus | null,
  }>> => {
    assertSystemOrigin(eventOrigin, 'findPlatformRunStatuses');
    const columns = { tenantId: views.jobs.tenantId, kind: views.jobs.kind, status: views.jobs.status };
    const [terminalRows, activeRows] = await Promise.all([
      // eslint-disable-next-line app/no-distinct-on-subquery -- grows with the finished runs, which the purge caps by age, not count
      db
        .selectDistinctOn([views.jobs.tenantId, views.jobs.kind], columns)
        .from(views.jobs)
        .where(inArray(views.jobs.status, [...TERMINAL_JOB_STATUSES]))
        .orderBy(views.jobs.tenantId, views.jobs.kind, desc(views.jobs.finishedAt)),
      // bounded-by: the queued and running runs
      db
        .selectDistinctOn([views.jobs.tenantId, views.jobs.kind], columns)
        .from(views.jobs)
        .where(inArray(views.jobs.status, [...ACTIVE_JOB_STATUSES]))
        .orderBy(views.jobs.tenantId, views.jobs.kind, desc(views.jobs.enqueuedAt)),
    ]);
    const statuses = new Map<string, { tenantId: string, kind: string, activeStatus: JobStatus | null, lastTerminalStatus: JobStatus | null }>();
    const entryOf = (row: { tenantId: string, kind: string }) => {
      const key = `${row.tenantId}\u0000${row.kind}`;
      const held = statuses.get(key) ?? { tenantId: row.tenantId, kind: row.kind, activeStatus: null, lastTerminalStatus: null };
      statuses.set(key, held);
      return held;
    };
    for (const row of terminalRows) {
      entryOf(row).lastTerminalStatus = row.status;
    }
    for (const row of activeRows) {
      entryOf(row).activeStatus = row.status;
    }
    return [...statuses.values()];
  },

  /** The error count is joined on by the service, not by a per-row subquery here. */
  findRunsByKind: async (
    { db, views },
    tenantId: string,
    kind: string,
    statuses: ReadonlyArray<JobStatus>,
    order: RunListOrder,
    limit: number,
  ) => {
    // The cap always takes the newest, whichever way they are then shown: cutting an ascending
    // order would keep the oldest and drop the runs a reader came for.
    const rows = await db
      .select(runListColumns(views))
      .from(views.jobs)
      .where(and(
        eq(views.jobs.tenantId, tenantId),
        eq(views.jobs.kind, kind),
        inArray(views.jobs.status, [...statuses]),
      ))
      .orderBy(order === 'enqueued-asc' ? desc(views.jobs.enqueuedAt) : desc(views.jobs.finishedAt))
      .limit(limit);
    const ordered = order === 'enqueued-asc' ? rows.reverse() : rows;
    return ordered.map(withTypedPayload);
  },

  countRunsByKind: async ({ db, views }, tenantId: string, kind: string): Promise<RunCounts> => {
    const [row] = await db
      .select({
        active: sql<number>`count(*) filter (where ${inArray(views.jobs.status, [...ACTIVE_JOB_STATUSES])})`,
        terminal: sql<number>`count(*) filter (where ${inArray(views.jobs.status, [...TERMINAL_JOB_STATUSES])})`,
      })
      .from(views.jobs)
      .where(and(eq(views.jobs.tenantId, tenantId), eq(views.jobs.kind, kind)));
    return {
      active: Number(row?.active ?? 0),
      terminal: Number(row?.terminal ?? 0),
    };
  },

  /**
   * Every run across every kind, for the Runs view: filtered, sorted and paged server-side. Order
   * always breaks ties on `id`, since two runs of one salve can share the same instant and an
   * unbroken tie would skip or repeat rows across pages.
   */
  findRuns: async ({ db, views }, query: RunQuery) => {
    const conditions = buildRunFilters(views, query);
    const rows = await db
      .select(runListColumns(views))
      .from(views.jobs)
      .where(and(...conditions))
      .orderBy(runOrderBy(views, query.sortBy, query.sortDesc), asc(views.jobs.id))
      .limit(query.limit)
      .offset(query.offset);
    return rows.map(withTypedPayload);
  },

  countRuns: async ({ db, views }, query: RunQuery): Promise<number> => {
    const conditions = buildRunFilters(views, query);
    const [row] = await db
      .select({ value: count() })
      .from(views.jobs)
      .where(and(...conditions));
    return row?.value ?? 0;
  },

  /**
   * The queue view's `pending` section, ordered as the queue itself would hand these rows out:
   * `findNextClaimable` skips a row whose `run_after` has not come due, or whose kind already has
   * a sibling `running` with a live lease, and leaves it for the next poll rather than passing it
   * over entirely. `claimability` names that outcome per row, computed here rather than trusted
   * from the caller, and the order surfaces it first so the rows actually next in line lead.
   *
   * The sibling test is answered from a plain membership query rather than a correlated subquery:
   * every row read here already belongs to `tenantId` alone, so "a live sibling of this kind
   * exists for this tenant" reduces to "this kind is in the small set fetched once up front".
   */
  findPendingQueue: async (
    { db, views },
    tenantId: string,
    serializedKinds: ReadonlyArray<string>,
    sharedSlots: ReadonlyArray<ReadonlyArray<string>>,
    limit: number,
    offset: number,
  ) => {
    const blockingRows = serializedKinds.length === 0 ? [] : await db
      .select({ kind: views.jobs.kind })
      .from(views.jobs)
      .where(and(
        eq(views.jobs.tenantId, tenantId),
        eq(views.jobs.status, 'running'),
        inArray(views.jobs.kind, [...serializedKinds]),
        sql`${views.jobs.leasedUntil} > now()`,
      ));
    const runningKinds = new Set(blockingRows.map((row) => row.kind));
    const blockingKinds = [...new Set([
      ...runningKinds,
      ...sharedSlots.filter((group) => group.some((kind) => runningKinds.has(kind))).flat(),
    ])];

    const isWaitingForSchedule = sql`${views.jobs.runAfter} > now()`;
    const isBlockedBySibling = blockingKinds.length > 0 ? inArray(views.jobs.kind, blockingKinds) : sql`false`;
    const claimabilityRank = sql`case when (${isWaitingForSchedule}) then 1 when (${isBlockedBySibling}) then 2 else 0 end`;
    const claimability = sql<RunClaimability>`case when (${isWaitingForSchedule}) then 'waiting-for-schedule' when (${isBlockedBySibling}) then 'blocked-by-sibling' else 'next' end`;

    const rows = await db
      .select({ ...runListColumns(views), claimability })
      .from(views.jobs)
      .where(and(eq(views.jobs.tenantId, tenantId), eq(views.jobs.status, 'queued')))
      .orderBy(claimabilityRank, desc(views.jobs.priority), asc(views.jobs.runAfter), asc(views.jobs.id))
      .limit(limit)
      .offset(offset);
    return rows.map(withTypedPayload);
  },

  findRunDetail: async ({ db, views }, id: string) => {
    const rows = await db
      .select(runListColumns(views))
      .from(views.jobs)
      .where(eq(views.jobs.id, id))
      .limit(1);
    const row = rows.at(0);
    return row ? withTypedPayload(row) : undefined;
  },

  /** The run, if any, that was booked to answer what `jobId` absorbed: see `bookSuccessor`. */
  findAnsweringRunId: async ({ db, views }, jobId: string): Promise<string | undefined> => {
    const rows = await db
      .select({ id: views.jobs.id })
      .from(views.jobs)
      .where(and(eq(views.jobs.triggeredBy, 'system'), eq(views.jobs.triggeredById, jobId)))
      .limit(1);
    return rows.at(0)?.id;
  },

  countErrorsByJobIds: async ({ db, views }, jobIds: ReadonlyArray<string>) => {
    if (jobIds.length === 0) {
      return [];
    }
    const rows = await db
      .select({ jobId: views.jobErrors.jobId, count: sql<number>`count(*)` })
      .from(views.jobErrors)
      .where(inArray(views.jobErrors.jobId, [...jobIds]))
      .groupBy(views.jobErrors.jobId);
    return rows.map((row) => ({ jobId: row.jobId, count: Number(row.count) }));
  },

  /** `stack` is a server trace and stays here: the reader that calls this serves a browser. */
  findJobErrors: ({ db, views }, jobId: string): Promise<Array<JobErrorRecord>> => db
    .select({
      id: views.jobErrors.id,
      occurredAt: views.jobErrors.occurredAt,
      attempt: views.jobErrors.attempt,
      retryable: views.jobErrors.retryable,
      message: views.jobErrors.message,
    })
    .from(views.jobErrors)
    .where(eq(views.jobErrors.jobId, jobId))
    .orderBy(asc(views.jobErrors.occurredAt)),

  /**
   * `serializedKinds` are the kinds that may not have two runs in flight for one tenant: a queued
   * job of such a kind is passed over while a sibling of the same kind and tenant is running, and
   * stays queued for the next poll. Enforced here rather than in the worker because several
   * replicas claim from this one table. The sibling's own lease must still be live: an expired one
   * means its worker died without releasing it, and this must not hold the queued job hostage until
   * the reaper gets around to flipping that row back to `queued`. `sharedSlots` widens that test
   * across kinds: a queued job of a group is passed over while any kind of the group runs.
   */
  findNextClaimable: async (
    { db },
    eventOrigin: EventOrigin,
    kinds: ReadonlyArray<string>,
    serializedKinds: ReadonlyArray<string> = [],
    held: ReadonlyArray<SerializedSlot> = [],
    sharedSlots: ReadonlyArray<ReadonlyArray<string>> = [],
  ) => {
    assertSystemOrigin(eventOrigin, 'findNextClaimable');
    if (kinds.length === 0) {
      return undefined;
    }
    const notAlreadyRunning = serializedKinds.length === 0 ? undefined : or(
      notInArray(jobs.kind, [...serializedKinds]),
      sql`NOT EXISTS (SELECT 1 FROM jobs sibling WHERE sibling.kind = jobs.kind AND sibling.tenant_id = jobs.tenant_id AND sibling.status = 'running' AND sibling.leased_until > now())`,
    );
    const noSlotMateRunning = sharedSlots.map((group) => or(
      notInArray(jobs.kind, [...group]),
      sql`NOT EXISTS (SELECT 1 FROM jobs sibling WHERE sibling.kind IN ${[...group]} AND sibling.tenant_id = jobs.tenant_id AND sibling.status = 'running' AND sibling.leased_until > now())`,
    ));
    // The row goes terminal before its handler settles, so between the two the sibling test above
    // sees nothing running and the caller is the only one that still knows the slot is taken.
    const notHeldByCaller = held.length === 0 ? undefined : and(
      ...held.map((slot) => not(and(eq(jobs.kind, slot.kind), eq(jobs.tenantId, slot.tenantId))!)),
    );
    const rows = await db
      .select({ id: jobs.id })
      // eslint-disable-next-line app/no-raw-table-in-reads -- FOR UPDATE SKIP LOCKED requires a real table; system-only, guarded by assertSystemOrigin above
      .from(jobs)
      .where(and(
        eq(jobs.status, 'queued'),
        sql`run_after <= now()`,
        inArray(jobs.kind, [...kinds]),
        notAlreadyRunning,
        ...noSlotMateRunning,
        notHeldByCaller,
      ))
      .orderBy(desc(jobs.priority), asc(jobs.runAfter), asc(jobs.id))
      .for('update', { skipLocked: true })
      .limit(1);
    return rows.at(0);
  },

  claimJob: async ({ db }, jobId: string, workerId: string, leaseMs: number): Promise<ClaimedJob | undefined> => {
    const rows = await db.update(jobs)
      .set({
        status: 'running',
        claimedAt: sqlAsDate(sql`now()`),
        claimedBy: workerId,
        leasedUntil: sqlAsDate(sql`now() + make_interval(secs => ${leaseMs} / 1000.0)`),
        startedAt: sqlAsDate(sql`COALESCE(started_at, now())`),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: SQL expression for numeric column increment
        attempt: sql`attempt + 1` as unknown as number,
      })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, 'queued')))
      .returning();
    const row = rows.at(0);
    if (!row) {
      return undefined;
    }
    return {
      id: row.id,
      tenantId: row.tenantId,
      kind: row.kind,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- jsonb column: handler-defined payload is always Record<string, unknown>
      payload: row.payload as Record<string, unknown>,
      attempt: row.attempt,
      maxAttempts: row.maxAttempts,
      maxRuntimeMs: row.maxRuntimeMs,
      bounded: row.bounded,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- jsonb column: stateSnapshot is always Record<string, unknown> when present
      stateSnapshot: row.stateSnapshot as Record<string, unknown> | null,
      processedTotal: row.processedTotal,
      expectedTotal: row.expectedTotal,
      leasedUntil: row.leasedUntil instanceof Date ? row.leasedUntil : new Date(row.leasedUntil!),
      triggeredBy: row.triggeredBy,
      triggeredById: row.triggeredById,
      interactive: row.interactive,
    };
  },

  renewLease: async ({ db }, jobId: string, workerId: string, leaseMs: number): Promise<ReadonlyArray<{ id: string }>> => {
    const rows = await db.update(jobs)
      .set({ leasedUntil: sqlAsDate(sql`now() + make_interval(secs => ${leaseMs} / 1000.0)`) })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, 'running'), eq(jobs.claimedBy, workerId)))
      .returning();
    return rows.map((r) => ({ id: r.id }));
  },

  markSuccess: async ({ db }, jobId: string, workerId: string): Promise<ReadonlyArray<SettledJob>> => {
    const rows = await db.update(jobs)
      .set({
        status: 'succeeded',
        finishedAt: sqlAsDate(sql`now()`),
        errorMessage: null,
        leasedUntil: null,
        abortRequestedAt: null,
      })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, 'running'), eq(jobs.claimedBy, workerId)))
      .returning();
    return rows.map(settled);
  },

  markFailedRetry: async ({ db }, jobId: string, workerId: string, retryDelayMs: number, errorMessage: string): Promise<ReadonlyArray<{ id: string, runAfter: Date }>> => {
    const rows = await db.update(jobs)
      .set({
        status: 'queued',
        runAfter: sqlAsDate(sql`now() + make_interval(secs => ${retryDelayMs} / 1000.0)`),
        errorMessage,
        claimedAt: null,
        claimedBy: null,
        leasedUntil: null,
        abortRequestedAt: null,
        ...keepAskOnlyIfResuming(),
      })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, 'running'), eq(jobs.claimedBy, workerId), notAskedToStop()))
      .returning();
    return rows.map((r) => ({ id: r.id, runAfter: r.runAfter instanceof Date ? r.runAfter : new Date(r.runAfter) }));
  },

  /** Measured on the database clock, from the first start every later claim keeps. */
  findRunAgeMs: async ({ db, views }, jobId: string): Promise<number | undefined> => {
    const rows = await db.select({ ageMs: sql<number>`extract(epoch from now() - ${views.jobs.startedAt}) * 1000`.mapWith(Number) })
      .from(views.jobs)
      .where(eq(views.jobs.id, jobId))
      .limit(1);
    return rows.at(0)?.ageMs;
  },

  // Not a failure: error_message stays as it was and the attempt is handed back, so a deferral
  // leaves no trace on the run. The age fence is what ends the deferrals. Age runs from
  // `started_at`, which the first claim sets and every later one keeps, so the time the run spent
  // queued behind others is not counted against its wait for its inputs.
  markDeferred: async ({ db }, jobId: string, workerId: string, delayMs: number, maxWaitMs: number): Promise<ReadonlyArray<{ id: string, runAfter: Date }>> => {
    const rows = await db.update(jobs)
      .set({
        status: 'queued',
        runAfter: sqlAsDate(sql`now() + make_interval(secs => ${delayMs} / 1000.0)`),
        claimedAt: null,
        claimedBy: null,
        leasedUntil: null,
        abortRequestedAt: null,
        ...keepAskOnlyIfResuming(),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: SQL expression for numeric column decrement
        attempt: sql`GREATEST(0, attempt - 1)` as unknown as number,
      })
      .where(and(
        eq(jobs.id, jobId),
        eq(jobs.status, 'running'),
        eq(jobs.claimedBy, workerId),
        notAskedToStop(),
        gt(jobs.startedAt, sqlAsDate(sql`now() - make_interval(secs => ${maxWaitMs} / 1000.0)`)),
      ))
      .returning();
    return rows.map((r) => ({ id: r.id, runAfter: r.runAfter instanceof Date ? r.runAfter : new Date(r.runAfter) }));
  },

  markFailedDlq: async ({ db }, jobId: string, workerId: string, errorMessage: string): Promise<ReadonlyArray<SettledJob>> => {
    const rows = await db.update(jobs)
      .set({
        status: 'dlq',
        finishedAt: sqlAsDate(sql`now()`),
        errorMessage,
        leasedUntil: null,
      })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, 'running'), eq(jobs.claimedBy, workerId)))
      .returning();
    return rows.map(settled);
  },

  // Graceful-shutdown release: requeue without consuming an attempt, so a job
  // preempted by SIGTERM survives rolling deploys instead of drifting to DLQ.
  releaseClaim: async ({ db }, jobId: string, workerId: string): Promise<ReadonlyArray<{ id: string, kind: string, tenantId: string }>> => {
    const rows = await db.update(jobs)
      .set({
        status: 'queued',
        claimedAt: null,
        claimedBy: null,
        leasedUntil: null,
        abortRequestedAt: null,
        ...keepAskOnlyIfResuming(),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: SQL expression for numeric column decrement
        attempt: sql`GREATEST(0, attempt - 1)` as unknown as number,
      })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, 'running'), eq(jobs.claimedBy, workerId), notAskedToStop()))
      .returning();
    return rows.map((r) => ({ id: r.id, kind: r.kind, tenantId: r.tenantId }));
  },

  // Batch reaper: no claimed_by fence, the original workers are presumed dead
  // and findOrphanedJobs holds the row locks via FOR UPDATE SKIP LOCKED.
  reapToRetryBatch: async ({ db }, jobIds: ReadonlyArray<string>, retryDelayMs: number, errorMessage: string) => {
    if (jobIds.length === 0) {
      return;
    }
    await db.update(jobs)
      .set({
        status: 'queued',
        runAfter: sqlAsDate(sql`now() + make_interval(secs => ${retryDelayMs} / 1000.0)`),
        errorMessage,
        claimedAt: null,
        claimedBy: null,
        leasedUntil: null,
        abortRequestedAt: null,
        ...keepAskOnlyIfResuming(),
      })
      .where(and(inArray(jobs.id, [...jobIds]), eq(jobs.status, 'running')));
  },

  reapToDlqBatch: async ({ db }, jobIds: ReadonlyArray<string>, errorMessage: string): Promise<ReadonlyArray<SettledJob>> => {
    if (jobIds.length === 0) {
      return [];
    }
    const rows = await db.update(jobs)
      .set({
        status: 'dlq',
        finishedAt: sqlAsDate(sql`now()`),
        errorMessage,
        leasedUntil: null,
      })
      .where(and(inArray(jobs.id, [...jobIds]), eq(jobs.status, 'running')))
      .returning();
    return rows.map(settled);
  },

  reapToCancelledBatch: async ({ db }, jobIds: ReadonlyArray<string>): Promise<ReadonlyArray<SettledJob>> => {
    if (jobIds.length === 0) {
      return [];
    }
    const rows = await db.update(jobs)
      .set({ status: 'cancelled', finishedAt: sqlAsDate(sql`now()`), leasedUntil: null })
      .where(and(inArray(jobs.id, [...jobIds]), eq(jobs.status, 'running')))
      .returning();
    return rows.map(settled);
  },

  /**
   * A queued sweep absorbing an ask somebody waits on must not serve it on the sweep's window.
   * Raises only — the `interactive` predicate is what makes it one, and it also keeps a run already
   * marked from taking a no-op UPDATE that would ring the jobs doorbell for nothing. Restricted to
   * `queued`: a claimed run has already stamped its window on the transactions it writes.
   */
  raiseInteractive: ({ db }, jobId: string) =>
    db.update(jobs)
      .set({ interactive: true })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, 'queued'), eq(jobs.interactive, false))),

  cancelQueued: async ({ db }, jobId: string): Promise<ReadonlyArray<{ id: string }>> => {
    const rows = await db.update(jobs)
      .set({ status: 'cancelled', finishedAt: sqlAsDate(sql`now()`), leasedUntil: null })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, 'queued')))
      .returning();
    return rows.map((r) => ({ id: r.id }));
  },

  /**
   * Cancels the queued jobs of a kind whose payload names one of these ids. What a delete owes the
   * runs it made pointless: the handler would find nothing to work on and burn its attempts against
   * the dead-letter queue.
   */
  cancelQueuedByPayloadId: async ({ db }, kind: string, payloadKey: string, ids: ReadonlyArray<string>): Promise<number> => {
    if (ids.length === 0) {
      return 0;
    }
    return (await db.update(jobs)
      .set({ status: 'cancelled', finishedAt: sqlAsDate(sql`now()`), leasedUntil: null })
      .where(and(
        eq(jobs.kind, kind),
        eq(jobs.status, 'queued'),
        inArray(sql`${jobs.payload}->>${payloadKey}`, [...ids]),
      ))
      .returning()).length;
  },

  /**
   * The running half of the same delete. A run already claimed cannot be cancelled from here, only
   * asked to stop: left alone it prices a scenario that no longer exists for as long as the pricing
   * takes, holds the tenant's slot of a serialized kind meanwhile, and fails its insert on the
   * foreign key at the end.
   */
  requestAbortIfRunningByPayloadId: async ({ db }, kind: string, payloadKey: string, ids: ReadonlyArray<string>): Promise<void> => {
    if (ids.length === 0) {
      return;
    }
    await db.update(jobs)
      .set({ abortRequestedAt: sqlAsDate(sql`COALESCE(abort_requested_at, now())`) })
      .where(and(
        eq(jobs.kind, kind),
        eq(jobs.status, 'running'),
        inArray(sql`${jobs.payload}->>${payloadKey}`, [...ids]),
      ));
  },

  requestAbortIfRunning: ({ db }, jobId: string) =>
    db.update(jobs)
      .set({ abortRequestedAt: sqlAsDate(sql`COALESCE(abort_requested_at, now())`) })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, 'running'))),

  // Fenced on claimed_by so a stale worker can't cancel a job another worker now owns.
  markCancelledByWorker: async ({ db }, jobId: string, workerId: string): Promise<ReadonlyArray<SettledJob>> => {
    const rows = await db.update(jobs)
      .set({ status: 'cancelled', finishedAt: sqlAsDate(sql`now()`), leasedUntil: null })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, 'running'), eq(jobs.claimedBy, workerId)))
      .returning();
    return rows.map(settled);
  },

  // startedAt is sticky (set once on first claim via COALESCE in claimNext):
  // not reset here so time-to-first-execution metrics survive DLQ retries.
  markRetryFromDlq: ({ db }, jobId: string) =>
    db.update(jobs)
      .set({
        status: 'queued',
        attempt: 0,
        errorMessage: null,
        finishedAt: null,
        claimedAt: null,
        claimedBy: null,
        leasedUntil: null,
        abortRequestedAt: null,
        runAfter: sqlAsDate(sql`now()`),
        // A new execution, which answers by running: what the old one absorbed was answered by
        // the run its own terminal transition booked, and the askers it had are not this one's.
        absorbedAsk: false,
        absorbedAskInteractive: false,
        askedByOthers: false,
      })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, 'dlq'))),

  updateProgress: async ({ db }, jobId: string, workerId: string, progress: ProgressUpdate): Promise<ReadonlyArray<{ id: string }>> => {
    const set: Partial<typeof jobs.$inferInsert> = {};
    if (progress.processedTotal !== undefined) {
      set.processedTotal = progress.processedTotal;
    }
    if (progress.expectedTotal !== undefined) {
      set.expectedTotal = progress.expectedTotal;
    }
    if (progress.message !== undefined) {
      set.progressMessage = progress.message;
    }
    if (Object.keys(set).length === 0) {
      return [];
    }

    const rows = await db.update(jobs)
      .set(set)
      .where(and(eq(jobs.id, jobId), eq(jobs.status, 'running'), eq(jobs.claimedBy, workerId)))
      .returning();
    return rows.map((r) => ({ id: r.id }));
  },

  saveStateSnapshot: async ({ db }, jobId: string, workerId: string, state: Record<string, unknown>): Promise<ReadonlyArray<{ id: string }>> => {
    const rows = await db.update(jobs)
      .set({ stateSnapshot: state })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, 'running'), eq(jobs.claimedBy, workerId)))
      .returning();
    return rows.map((r) => ({ id: r.id }));
  },

  insertJobError: ({ db }, values: typeof jobErrors.$inferInsert) =>
    db.insert(jobErrors).values([values]),

  findOrphanedJobs: async ({ db }, eventOrigin: EventOrigin, limit: number = DEFAULT_LIST_LIMIT) => {
    assertSystemOrigin(eventOrigin, 'findOrphanedJobs');
    return db
      .select({
        id: jobs.id,
        kind: jobs.kind,
        tenantId: jobs.tenantId,
        attempt: jobs.attempt,
        maxAttempts: jobs.maxAttempts,
        abortRequested: sql<boolean>`${jobs.abortRequestedAt} IS NOT NULL`,
      })
      // eslint-disable-next-line app/no-raw-table-in-reads -- FOR UPDATE SKIP LOCKED requires a real table; system-only, guarded by assertSystemOrigin above
      .from(jobs)
      .where(and(eq(jobs.status, 'running'), sql`leased_until < now()`))
      .orderBy(jobs.leasedUntil)
      .for('update', { skipLocked: true })
      .limit(limit);
  },

  /**
   * Bounded by a subquery rather than a direct `LIMIT` on the `DELETE`, which Postgres does not
   * accept. A `queued` or `running` row has no `finished_at`, so `lt` can never match it — the
   * predicate excludes them without naming them.
   */
  deleteFinishedJobsBefore: async (
    { db, views },
    tenantId: string,
    statuses: ReadonlyArray<JobStatus>,
    before: Date,
    limit: number,
  ): Promise<number> => {
    const scoped = and(eq(views.jobs.tenantId, tenantId), inArray(views.jobs.status, [...statuses]));
    // The last run `findRunSummariesByKind` reads: without it a kind that runs rarely would read
    // `never_ran` once its only run is past the bound.
    // eslint-disable-next-line app/no-distinct-on-subquery -- grows with the tenant's finished runs, which this purge caps by age, not count
    const lastRunPerKind = db
      .selectDistinctOn([views.jobs.kind], { id: views.jobs.id })
      .from(views.jobs)
      .where(scoped)
      .orderBy(views.jobs.kind, desc(views.jobs.finishedAt));
    const candidateIds = db
      .select({ id: views.jobs.id })
      .from(views.jobs)
      .where(and(
        scoped,
        lt(views.jobs.finishedAt, before),
        notInArray(views.jobs.id, lastRunPerKind),
      ))
      .limit(limit);
    const rows = await db.delete(jobs).where(inArray(jobs.id, candidateIds)).returning();
    return rows.length;
  },

  isAbortRequested: async ({ db, views }, jobId: string): Promise<boolean> => {
    const rows = await db
      .select({ abortRequestedAt: views.jobs.abortRequestedAt })
      .from(views.jobs)
      .where(eq(views.jobs.id, jobId))
      .limit(1);
    const row = rows.at(0);
    return row !== undefined && row.abortRequestedAt !== null;
  },
});

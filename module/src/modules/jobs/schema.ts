import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { defineSecurityPolicies, jobChildTenantIsolationPolicy, tenantIsolationPolicy } from '../../security';
import { tenants } from '../tenants';

export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'cancelled', 'dlq'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** The two groups partition `JOB_STATUSES`: a status added there belongs to one of them. */
export const ACTIVE_JOB_STATUSES = ['queued', 'running'] as const;
export const TERMINAL_JOB_STATUSES = ['succeeded', 'cancelled', 'dlq'] as const;
/** The statuses a run can hold once it has stopped. A run still queued or running has none. */
export type TerminalRunStatus = (typeof TERMINAL_JOB_STATUSES)[number];

export const TRIGGERED_BY_VALUES = ['user', 'scheduler', 'system', 'event', 'connector'] as const;
export type TriggeredBy = (typeof TRIGGERED_BY_VALUES)[number];

export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  idempotencyKey: text('idempotency_key'),
  // eslint-disable-next-line no-restricted-syntax -- payload is handler-defined: a relational shape per kind would force one table per job kind, breaking the generic-queue abstraction
  payload: jsonb('payload').notNull().default({}),
  payloadHash: text('payload_hash').notNull(),
  priority: integer('priority').notNull().default(50),
  runAfter: timestamp('run_after', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  maxRuntimeMs: integer('max_runtime_ms').notNull().default(15 * 60 * 1000),
  bounded: boolean('bounded').notNull().default(true),
  status: text('status').notNull().default('queued').$type<JobStatus>(),
  triggeredBy: text('triggered_by').notNull().default('system').$type<TriggeredBy>(),
  triggeredById: text('triggered_by_id'),
  /**
   * Whether somebody is waiting on this run's result, which is a different question from
   * `triggered_by`: that one records who asked, and the two come apart — a service account asking
   * for one scenario's simulation waits exactly as a person does, and the dispatcher books every
   * routed change as `event` whether a save is watching it or a sweep is feeding it. Only the
   * enqueue site knows both, so only it can answer this. It decides the doorbell
   * window the run's writes ring on, and defaults to the sweep's coarse one: a run nobody declared
   * is a run nobody named a waiter for.
   */
  interactive: boolean('interactive').notNull().default(false),
  /**
   * An ask reached this run after it had started, and only a run that starts clean answers the asks
   * absorbed before it: one resuming from `state_snapshot` continues a pass begun before the ask
   * existed. A return to `queued` leaving no resume state therefore clears the flag, the attempt
   * that follows answering by reading afresh. Otherwise it travels on, through that attempt or
   * through a continuation, until the transition ending the execution books one run of the same key
   * to answer it. It stays on that terminal row, `markRetryFromDlq` clearing it only when the row is
   * sent round again, which opens an execution of its own. A starter's own cancel of a row no other
   * asker folded into clears it too, the asks it absorbed being theirs.
   */
  absorbedAsk: boolean('absorbed_ask').notNull().default(false),
  /** The absorbed ask's own waiter flag, carried to the run that answers it. Read only while `absorbedAsk`. */
  absorbedAskInteractive: boolean('absorbed_ask_interactive').notNull().default(false),
  /**
   * An asker other than `triggered_by` / `triggered_by_id` folded an ask into this row while it was
   * active, so the run answers several askers and is no longer its starter's alone. Never written
   * false by a fold; `markRetryFromDlq` clears it, a retry opening an execution of its own.
   */
  askedByOthers: boolean('asked_by_others').notNull().default(false),
  claimedAt: timestamp('claimed_at', { withTimezone: true, mode: 'date' }),
  claimedBy: text('claimed_by'),
  leasedUntil: timestamp('leased_until', { withTimezone: true, mode: 'date' }),
  abortRequestedAt: timestamp('abort_requested_at', { withTimezone: true, mode: 'date' }),
  attempt: integer('attempt').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  enqueuedAt: timestamp('enqueued_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
  finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
  errorMessage: text('error_message'),
  errorMessageFolded: text('error_message_folded').generatedAlwaysAs(sql`fold_text(error_message)`),
  // eslint-disable-next-line no-restricted-syntax -- state_snapshot is per-handler resume state (Singer-style): shape is opaque to the framework and only meaningful to the handler that produced it
  stateSnapshot: jsonb('state_snapshot'),
  processedTotal: integer('processed_total').notNull().default(0),
  expectedTotal: integer('expected_total'),
  progressMessage: text('progress_message'),
  progressMessageFolded: text('progress_message_folded').generatedAlwaysAs(sql`fold_text(progress_message)`),
}, (table) => [
  index('jobs_claim_idx')
    .on(table.priority.desc().nullsFirst(), table.runAfter.asc())
    .where(sql`status = 'queued'`),
  index('jobs_lease_idx')
    .on(table.leasedUntil)
    .where(sql`status = 'running'`),
  uniqueIndex('jobs_idempotency_idx')
    .on(table.tenantId, table.idempotencyKey)
    .where(sql`idempotency_key IS NOT NULL AND status IN ('queued', 'running')`),
  uniqueIndex('jobs_dedup_idx')
    .on(table.kind, table.tenantId, table.payloadHash)
    .where(sql`status IN ('queued', 'running')`),
  index('jobs_tenant_idx').on(table.tenantId, table.enqueuedAt.desc().nullsFirst()),
  // The scheduler reads its own last bookings of one kind. Without this the walk goes back over
  // every other job of the tenant, and over the whole history while it has yet to book five.
  index('jobs_scheduler_idx')
    .on(table.tenantId, table.kind, table.enqueuedAt.desc().nullsFirst())
    .where(sql`triggered_by = 'scheduler'`),
  check('jobs_absorbed_ask_interactive_ck', sql`absorbed_ask OR NOT absorbed_ask_interactive`),
]);

defineSecurityPolicies(jobs, tenantIsolationPolicy);

export const jobErrors = pgTable('job_errors', {
  id: uuid('id').primaryKey(),
  jobId: uuid('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  attempt: integer('attempt').notNull(),
  retryable: boolean('retryable').notNull(),
  message: text('message').notNull(),
  stack: text('stack'),
  occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  index('job_errors_job_id_idx').on(table.jobId, table.occurredAt.desc().nullsFirst()),
]);

defineSecurityPolicies(jobErrors, jobChildTenantIsolationPolicy);

/** The steps a run reports counts for, in the order a run takes them. */
export const JOB_STEPS = ['inventory', 'observations'] as const;
export type JobStep = (typeof JOB_STEPS)[number];

/** What a step counted: the assets an inventory went over, the findings the observations wrote. */
export const JOB_STEP_ENTITIES = ['assets', 'findings'] as const;
export type JobStepEntity = (typeof JOB_STEP_ENTITIES)[number];

/**
 * What one step of a run read and did to one kind of object, so a run that succeeded with nothing
 * new reads as such. One row per (run, step, entity): a retried attempt replaces its row. `created`
 * is null where the write does not tell a new object from an updated one; `mode` says how the step
 * read its source (`full` or `incremental`), null where it has no such choice.
 */
export const jobStepCounts = pgTable('job_step_counts', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  jobId: uuid('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  step: text('step').notNull().$type<JobStep>(),
  entity: text('entity').notNull().$type<JobStepEntity>(),
  mode: text('mode'),
  read: integer('read').notNull().default(0),
  written: integer('written').notNull().default(0),
  created: integer('created'),
  removed: integer('removed').notNull().default(0),
  skipped: integer('skipped').notNull().default(0),
  recordedAt: timestamp('recorded_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('job_step_counts_job_step_entity_uq').on(table.jobId, table.step, table.entity),
]);

defineSecurityPolicies(jobStepCounts, tenantIsolationPolicy);

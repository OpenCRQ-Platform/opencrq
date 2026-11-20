import {
  ACTIVE_JOB_STATUSES,
  CONNECTOR_SOURCES,
  isDisplayedJobKind,
  JOB_BACKED_CONNECTOR_KINDS,
  JOB_CATALOGUE_ENTRIES,
  JOB_STATUSES,
  originTrigger,
  RUN_SORT_KEYS,
  SCHEDULE_CADENCES,
  sharedSlotGroups,
  TERMINAL_JOB_STATUSES,
  TRIGGERED_BY_VALUES,
} from '@app/module';
import type { EventOrigin, JobCatalogueEntry, TriggeredBy } from '@app/module';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import type { TenantProcedure } from '../app-router-router';
import { config } from '../../../config';
import { router } from '../../../trpc';
import { minutesOfDay, nextDailyOccurrence } from '../../job-scheduler/daily-schedule';
import { defaultThreatsRunState, readConnectorSchedule, resolveRunnableConnectors } from '../connectors/connector-configuration';
import { pagedOutput } from '../pagination';
import { JobKindSchema, toJobKind } from './job-kind';
import {
  emptyRunHistory,
  JobLogsSchema,
  JobRunHistorySchema,
  JobRunListItemSchema,
  logRetentionRuns,
  PendingRunListItemSchema,
  RUN_LIST_CAP,
  RunDetailSchema,
  RunSnapshotSchema,
  serialiseJobRunListItem,
  serialiseLogGroup,
  serialisePendingRunListItem,
  serialiseRun,
  serialiseRunDetail,
} from './run-contract';

const JobIdInput = z.object({ id: z.uuid() });
const JobKindInput = z.object({ kind: z.string() });

/** `limit` is capped well above `RUN_LIST_CAP`: this view has no per-kind split to lean on. */
const RUN_QUERY_LIMIT_CAP = 200;

const RunQueryInput = z.object({
  kinds: z.array(z.string()).nullable().default(null),
  statuses: z.array(z.enum(JOB_STATUSES)).nullable().default(null),
  triggeredBy: z.array(z.enum(TRIGGERED_BY_VALUES)).nullable().default(null),
  enqueuedFrom: z.coerce.date().nullable().default(null),
  enqueuedTo: z.coerce.date().nullable().default(null),
  startedFrom: z.coerce.date().nullable().default(null),
  startedTo: z.coerce.date().nullable().default(null),
  finishedFrom: z.coerce.date().nullable().default(null),
  finishedTo: z.coerce.date().nullable().default(null),
  search: z.string().nullable().default(null),
  sortBy: z.enum(RUN_SORT_KEYS).default('enqueuedAt'),
  sortDesc: z.boolean().default(true),
  limit: z.number().int().min(1).max(RUN_QUERY_LIMIT_CAP).default(RUN_LIST_CAP),
  offset: z.number().int().min(0).default(0),
});

/** Four small tables share one screen in the Queue view: a page of `RUN_LIST_CAP` has no place there. */
const QUEUE_PAGE_DEFAULT_LIMIT = 10;
const QUEUE_PAGE_LIMIT_CAP = 100;

const QueuePageInput = z.object({
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(QUEUE_PAGE_LIMIT_CAP).default(QUEUE_PAGE_DEFAULT_LIMIT),
});

const toQueuePage = ({ page, limit }: z.infer<typeof QueuePageInput>) => ({ limit, offset: (page - 1) * limit });

const serialiseQueuePage = <TItem, TSchemaItem>(
  page: { items: ReadonlyArray<TItem>, total: number },
  input: z.infer<typeof QueuePageInput>,
  serialise: (item: TItem) => TSchemaItem,
) => ({
  items: page.items.map(serialise),
  total: page.total,
  page: input.page,
  limit: input.limit,
});

const JobScheduleItemSchema = z.object({
  kind: z.string(),
  /** Null for a platform job, whose schedule is the deployment's `recompute.daily_at`. */
  source: z.enum(CONNECTOR_SOURCES).nullable(),
  cadence: z.enum(SCHEDULE_CADENCES),
  atMinute: z.number().int().nullable(),
  weekday: z.number().int().nullable(),
  timeZone: z.string().nullable(),
  nextRunAt: z.string().nullable(),
  lastRun: RunSnapshotSchema,
});

const JobErrorSchema = z.object({
  id: z.string(),
  occurredAt: z.string(),
  attempt: z.number().int(),
  retryable: z.boolean(),
  message: z.string(),
});

interface PayloadAccessServices {
  capabilities: { hasManageSecurity: () => Promise<boolean> },
  platformCapabilities: { hasPlatformAccess: () => Promise<boolean> },
}

interface OwnRunServices {
  jobs: { getJob: (id: string) => Promise<{ triggeredBy: TriggeredBy, triggeredById: string | null } | undefined> },
}

/**
 * Whether the caller may see Settings → Jobs. The disjunction is the one `settings/jobs` already
 * applies in its `beforeLoad`: `hasManageSecurity` alone would refuse the platform-access users that
 * page admits.
 */
const hasJobsAccess = async (scoped: PayloadAccessServices): Promise<boolean> => {
  const [hasManageSecurity, hasPlatformAccess] = await Promise.all([
    scoped.capabilities.hasManageSecurity(),
    scoped.platformCapabilities.hasPlatformAccess(),
  ]);
  return hasManageSecurity || hasPlatformAccess;
};

/**
 * Gates the procedures serving a run's payload or its log lines, which are handler-defined and carry
 * third-party messages, so the tenant scoping alone does not make them safe. It covers a run's errors
 * too, except a connector run's. The kind list and the run metadata stay open to any tenant member.
 */
const requirePayloadAccess = async (scoped: PayloadAccessServices): Promise<void> => {
  if (!await hasJobsAccess(scoped)) {
    throw new TRPCError({ code: 'FORBIDDEN' });
  }
};

/**
 * Without jobs access, a caller cancels or retries only a run they started. An unknown id and
 * another tenant's (which `getJob` reads as absent) are refused alike, so the answer does not tell
 * them apart from someone else's run.
 */
const requireOwnRun = async (scoped: OwnRunServices, origin: EventOrigin, jobId: string): Promise<void> => {
  const job = await scoped.jobs.getJob(jobId);
  const own = originTrigger(origin);
  if (job?.triggeredBy !== own.triggeredBy || job.triggeredById !== own.triggeredById) {
    throw new TRPCError({ code: 'FORBIDDEN' });
  }
};

/** The catalogued kind, or the BAD_REQUEST every procedure addressing a kind must raise for it. */
const requireRegisteredKind = (kind: string): JobCatalogueEntry => {
  const entry = JOB_CATALOGUE_ENTRIES.find((candidate) => candidate.kind === kind && isDisplayedJobKind(candidate.kind));
  if (!entry) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'This job kind is not registered.' });
  }
  return entry;
};

export const jobsRouter = (procedure: TenantProcedure) => router({
  // bounded-by: one schedule per job-backed connector and per daily kind of JOB_CATALOGUE
  listSchedules: procedure
    .output(z.array(JobScheduleItemSchema))
    .query(async ({ ctx: { services, origin } }) => {
      const { tenantId } = origin;
      if (!tenantId) {
        return [];
      }
      const scoped = services.withOrigin(origin);
      const dailyKinds = JOB_CATALOGUE_ENTRIES.filter((entry) => entry.daily).map((entry) => entry.kind);
      const [settings, defaultThreats, saved, summaries] = await Promise.all([
        scoped.integrationSettings.getAllIntegrationSettings(),
        scoped.defaultThreats.getSettings(tenantId),
        scoped.jobSchedules.getSchedules(tenantId),
        scoped.jobs.getRunSummariesByKind(tenantId, [...JOB_BACKED_CONNECTOR_KINDS, ...dailyKinds]),
      ]);
      const savedByKind = new Map(saved.map((row) => [row.kind, row]));
      const lastRunOf = (kind: string) => serialiseRun(summaries.find((summary) => summary.kind === kind)?.lastTerminalRun ?? null);
      const nowMs = Date.now();

      const connectors = resolveRunnableConnectors(config().connectors, tenantId, settings, defaultThreatsRunState(defaultThreats)).map(({ entry, payload }) => {
        const { schedule, nextRunAt } = readConnectorSchedule(entry, savedByKind.get(entry.jobKind) ?? null, payload !== null, nowMs);
        return {
          kind: entry.jobKind,
          source: entry.source,
          ...schedule,
          nextRunAt: nextRunAt?.toISOString() ?? null,
          lastRun: lastRunOf(entry.jobKind),
        };
      });

      const atMinute = minutesOfDay(config().recompute.daily_at);
      const platform = dailyKinds.map((kind) => ({
        kind,
        source: null,
        cadence: 'daily' as const,
        atMinute,
        weekday: null,
        timeZone: 'UTC',
        nextRunAt: nextDailyOccurrence(nowMs, tenantId, atMinute).at.toISOString(),
        lastRun: lastRunOf(kind),
      }));
      return [...connectors, ...platform];
    }),

  // bounded-by: JOB_CATALOGUE_ENTRIES, one row per displayed job kind
  listJobKinds: procedure
    .output(z.array(JobKindSchema))
    .query(async ({ ctx: { services, origin } }) => {
      const entries = JOB_CATALOGUE_ENTRIES.filter((entry) => isDisplayedJobKind(entry.kind));
      const { tenantId } = origin;
      const summaries = tenantId
        ? await services.withOrigin(origin).jobs.getRunSummariesByKind(tenantId, entries.map((entry) => entry.kind))
        : [];
      const summaryByKind = new Map(summaries.map((summary) => [summary.kind, summary]));
      return entries
        .map((entry) => toJobKind(entry, summaryByKind.get(entry.kind)))
        .sort((a, b) => a.kind.localeCompare(b.kind));
    }),

  getJobKind: procedure
    .input(JobKindInput)
    .output(JobKindSchema)
    .query(async ({ input, ctx: { services, origin } }) => {
      const entry = requireRegisteredKind(input.kind);
      const { tenantId } = origin;
      const summaries = tenantId
        ? await services.withOrigin(origin).jobs.getRunSummariesByKind(tenantId, [entry.kind])
        : [];
      return toJobKind(entry, summaries[0]);
    }),

  listRuns: procedure
    .input(JobKindInput)
    .output(JobRunHistorySchema)
    .query(async ({ input, ctx: { services, origin } }) => {
      const entry = requireRegisteredKind(input.kind);
      const { tenantId } = origin;
      if (!tenantId) {
        return emptyRunHistory();
      }
      const scoped = services.withOrigin(origin);
      await requirePayloadAccess(scoped);
      const [inProgress, completed, counts] = await Promise.all([
        scoped.jobs.listRunsForKind(tenantId, entry.kind, ACTIVE_JOB_STATUSES, 'enqueued-asc', RUN_LIST_CAP),
        scoped.jobs.listRunsForKind(tenantId, entry.kind, TERMINAL_JOB_STATUSES, 'finished-desc', RUN_LIST_CAP),
        scoped.jobs.countRunsForKind(tenantId, entry.kind),
      ]);
      return {
        inProgress: inProgress.map(serialiseJobRunListItem),
        completed: completed.map(serialiseJobRunListItem),
        inProgressCount: counts.active,
        completedCount: counts.terminal,
        serverNow: new Date().toISOString(),
      };
    }),

  /** The Runs view: every kind together, filtered, sorted and paged server-side. */
  listAllRuns: procedure
    .input(RunQueryInput)
    .output(z.object({ items: z.array(JobRunListItemSchema), total: z.number().int() }))
    .query(async ({ input, ctx: { services, origin } }) => {
      input.kinds?.forEach(requireRegisteredKind);
      const { tenantId } = origin;
      if (!tenantId) {
        return { items: [], total: 0 };
      }
      const scoped = services.withOrigin(origin);
      await requirePayloadAccess(scoped);
      const { items, total } = await scoped.jobs.queryRuns({ tenantId, ...input });
      return { items: items.map(serialiseJobRunListItem), total };
    }),

  /**
   * The Queue view's four sections in one round trip, so a page change anywhere costs one request.
   * `pending` is ordered as the queue itself hands runs out, `running` by `claimedAt` ascending,
   * `failed` and `succeeded` by `finishedAt` descending.
   */
  listQueue: procedure
    .input(z.object({
      pending: QueuePageInput,
      running: QueuePageInput,
      failed: QueuePageInput,
      succeeded: QueuePageInput,
    }))
    .output(z.object({
      pending: pagedOutput(PendingRunListItemSchema),
      running: pagedOutput(JobRunListItemSchema),
      failed: pagedOutput(JobRunListItemSchema),
      succeeded: pagedOutput(JobRunListItemSchema),
      serverNow: z.string(),
    }))
    .query(async ({ input, ctx: { services, origin } }) => {
      const { tenantId } = origin;
      if (!tenantId) {
        const serverNow = new Date().toISOString();
        return {
          pending: { items: [], total: 0, page: 1, limit: 0 },
          running: { items: [], total: 0, page: 1, limit: 0 },
          failed: { items: [], total: 0, page: 1, limit: 0 },
          succeeded: { items: [], total: 0, page: 1, limit: 0 },
          serverNow,
        };
      }
      const scoped = services.withOrigin(origin);
      await requirePayloadAccess(scoped);
      const sharedSlots = sharedSlotGroups(JOB_CATALOGUE_ENTRIES);
      const serializedKinds = JOB_CATALOGUE_ENTRIES
        .filter((entry) => entry.observed || entry.serialized || sharedSlots.some((group) => group.includes(entry.kind)))
        .map((entry) => entry.kind);
      const sections = await scoped.jobs.listQueue({
        tenantId,
        serializedKinds,
        sharedSlots,
        pending: toQueuePage(input.pending),
        running: toQueuePage(input.running),
        failed: toQueuePage(input.failed),
        succeeded: toQueuePage(input.succeeded),
      });
      return {
        pending: serialiseQueuePage(sections.pending, input.pending, serialisePendingRunListItem),
        running: serialiseQueuePage(sections.running, input.running, serialiseJobRunListItem),
        failed: serialiseQueuePage(sections.failed, input.failed, serialiseJobRunListItem),
        succeeded: serialiseQueuePage(sections.succeeded, input.succeeded, serialiseJobRunListItem),
        serverNow: new Date().toISOString(),
      };
    }),

  /** A run's detail view. Tenant-scoped by the view, like `getJob`: another tenant's id reads as not found. */
  getRun: procedure
    .input(JobIdInput)
    .output(RunDetailSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) => {
      const scoped = services.withOrigin(origin);
      await requirePayloadAccess(scoped);
      const run = await scoped.jobs.getRun(input.id);
      return run ? serialiseRunDetail(run) : null;
    }),

  listLogs: procedure
    .input(JobKindInput)
    .output(JobLogsSchema)
    .query(async ({ input, ctx: { services, origin } }) => {
      const entry = requireRegisteredKind(input.kind);
      const { tenantId } = origin;
      if (!tenantId) {
        return { groups: [] };
      }
      const scoped = services.withOrigin(origin);
      await requirePayloadAccess(scoped);
      const groups = await scoped.jobLogs.listRunGroups(tenantId, entry.kind, logRetentionRuns());
      return { groups: groups.filter((group) => group.lines.length > 0).map(serialiseLogGroup) };
    }),

  /** One run's lines, for its detail page. Tenant-scoped like `getRun`: another tenant's id reads as no line. */
  listRunLogs: procedure
    .input(JobIdInput)
    .output(JobLogsSchema)
    .query(async ({ input, ctx: { services, origin } }) => {
      const { tenantId } = origin;
      if (!tenantId) {
        return { groups: [] };
      }
      const scoped = services.withOrigin(origin);
      await requirePayloadAccess(scoped);
      const group = await scoped.jobLogs.getRunGroup(tenantId, input.id);
      return { groups: group && group.lines.length > 0 ? [serialiseLogGroup(group)] : [] };
    }),

  // eslint-disable-next-line app/no-unbounded-list-query -- grows with the run's retries from the dead-letter queue, up to maxAttempts errors each
  listJobErrors: procedure
    .input(JobIdInput)
    .output(z.array(JobErrorSchema))
    .query(async ({ input, ctx: { services, origin } }) => {
      const scoped = services.withOrigin(origin);
      const job = await scoped.jobs.getJob(input.id);
      if (!job) {
        return [];
      }
      // A connector run's errors stay open: the connectors' Works tab reads them under its own gate.
      if (!JOB_BACKED_CONNECTOR_KINDS.includes(job.kind)) {
        await requirePayloadAccess(scoped);
      }
      const errors = await scoped.jobs.getJobErrors(input.id);
      return errors.map((error) => ({
        id: error.id,
        occurredAt: error.occurredAt.toISOString(),
        attempt: error.attempt,
        retryable: error.retryable,
        message: error.message,
      }));
    }),

  // A run id reaches the browser from the connector's run history, so this read answers with the
  // status its caller watches and never with the stored row behind it.
  getJob: procedure
    .input(JobIdInput)
    .output(z.object({ id: z.string(), status: z.enum(JOB_STATUSES), enqueuedAt: z.string(), startedAt: z.string().nullable() }).nullable())
    .query(async ({ input, ctx: { services, origin } }) => {
      const job = await services.withOrigin(origin).jobs.getJob(input.id);
      return job
        ? { id: job.id, status: job.status, enqueuedAt: job.enqueuedAt.toISOString(), startedAt: job.startedAt?.toISOString() ?? null }
        : null;
    }),

  /**
   * What the tenant still has in flight for these kinds, which is the only honest signal that a
   * queue is idle. No screen reads it: its one caller is the estate bench, which cannot time a run
   * against a busy queue, and it is kept rather than made a script's own query because it is
   * tenant-scoped like every other read here and exposes nothing a tenant cannot already count.
   */
  // eslint-disable-next-line app/no-unused-router-endpoint -- read by the estate bench alone, see above
  getActiveRunCounts: procedure
    .input(z.object({ kinds: z.array(z.string()).min(1) }))
    .output(z.object({ queued: z.number().int(), running: z.number().int() }))
    .query(async ({ input, ctx: { services, origin } }) => {
      if (!origin.tenantId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      return await services.withOrigin(origin).jobs.getActiveRunCounts(origin.tenantId, input.kinds);
    }),

  getLastJob: procedure
    .input(z.object({ kind: z.string() }))
    .output(z.object({
      id: z.string(),
      status: z.string(),
      enqueuedAt: z.string(),
    }).nullable())
    .query(async ({ input, ctx: { services, origin } }) => {
      const jobs = await services.withOrigin(origin).jobs.listJobs({
        kind: input.kind,
        tenantId: origin.tenantId,
        limit: 1,
      });
      const job = jobs[0];
      if (!job) {
        return null;
      }
      return {
        id: job.id,
        status: job.status,
        enqueuedAt: job.enqueuedAt.toISOString(),
      };
    }),

  cancelJob: procedure
    .input(JobIdInput)
    .mutation(async ({ input, ctx: { services, origin } }) => {
      const scoped = services.withOrigin(origin);
      const viaJobsAccess = await hasJobsAccess(scoped);
      if (!viaJobsAccess) {
        await requireOwnRun(scoped, origin, input.id);
      }
      // A run other askers folded into answers them too, so only jobs access may cancel it.
      if (await scoped.jobs.cancelJob(input.id, { refuseIfShared: !viaJobsAccess }) === 'shared') {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      return { cancelled: true };
    }),

  retryFromDlq: procedure
    .input(JobIdInput)
    .mutation(async ({ input, ctx: { services, origin } }) => {
      const scoped = services.withOrigin(origin);
      if (!await hasJobsAccess(scoped)) {
        await requireOwnRun(scoped, origin, input.id);
      }
      await scoped.jobs.retryFromDlq(input.id);
      return { retried: true };
    }),
});

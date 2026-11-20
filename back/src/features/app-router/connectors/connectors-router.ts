import {
  ACTIVE_JOB_STATUSES,
  CONNECTOR_DOMAINS,
  CONNECTOR_ENTRIES,
  CONNECTOR_INVENTORY,
  CONNECTOR_MECHANISMS,
  CONNECTOR_SCOPE_KINDS,
  CONNECTOR_SOURCES,
  CONNECTOR_STATES,
  deriveConnectorState,
  deriveStreamConnection,
  deriveStreamConnectorState,
  INTEGRATION_SOURCES,
  isValidTimeZone,
  isWellFormedSchedule,
  JOB_BACKED_CONNECTOR_KINDS,
  jobBackedConnector,
  offeredCadences,
  originTrigger,
  SCHEDULE_CADENCES,
  STREAM_CONNECTIONS,
  STREAM_LOG_SCOPE_KIND,
  TERMINAL_JOB_STATUSES,
} from '@app/module';
import type { ConnectorSource, IntegrationSource } from '@app/module';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import type { AppRouterTelemetry, TenantProcedure } from '../app-router-router';
import { config } from '../../../config';
import { STREAM_LOG_RETENTION_LINES, WORKER_HEARTBEAT_STALE_AFTER_MS } from '../../../config-schema';
import { router } from '../../../trpc';
import {
  emptyRunHistory,
  JobLogsSchema,
  logRetentionRuns,
  RUN_LIST_CAP,
  RunHistorySchema,
  RunSnapshotSchema,
  serialiseLogGroup,
  serialiseLogLine,
  serialiseRun,
  serialiseRunListItem,
  terminalRunStatus,
} from '../jobs/run-contract';
import { computeTimelineProgressPercent } from '../opencti/opencti-backfill-progress-utils';
import { defaultThreatsRunState, readConnectorSchedule, resolveConnectorConfigurations, resolveRunnableConnectors } from './connector-configuration';

const ConnectorListItemSchema = z.object({
  source: z.enum(CONNECTOR_SOURCES),
  domain: z.enum(CONNECTOR_DOMAINS),
  mechanism: z.enum(CONNECTOR_MECHANISMS),
  scopeKinds: z.array(z.enum(CONNECTOR_SCOPE_KINDS)),
  platformConfigured: z.boolean(),
  tenantConfigured: z.boolean(),
  url: z.string().nullable(),
  state: z.enum(CONNECTOR_STATES),
  /** False for a connector switched off by its own switch, whatever its configuration. */
  enabled: z.boolean(),
  activeRun: RunSnapshotSchema,
  lastRun: RunSnapshotSchema,
});

const ConnectorCardSchema = ConnectorListItemSchema.extend({
  /** Null for a live stream, which has no run to schedule. */
  schedule: z.object({
    cadence: z.enum(SCHEDULE_CADENCES),
    nextRunAt: z.string().nullable(),
  }).nullable(),
});

const PipelineSnapshotSchema = z.object({
  configuredConnectors: z.number().int(),
  queuedRuns: z.number().int(),
  runningNow: z.number().int(),
  recordsIngested: z.number().int(),
  streamCatchupPercent: z.number().nullable(),
  workerAnswering: z.boolean(),
});

const EMPTY_PIPELINE_SNAPSHOT = {
  configuredConnectors: 0,
  queuedRuns: 0,
  runningNow: 0,
  recordsIngested: 0,
  streamCatchupPercent: null,
  workerAnswering: true,
};

const SourceInput = z.object({ source: z.enum(CONNECTOR_SOURCES) });

const workerStaleAfterSeconds = (): number =>
  (config().jobs?.heartbeat_stale_after_ms ?? WORKER_HEARTBEAT_STALE_AFTER_MS) / 1000;

const streamLogRetentionLines = (): number => config().jobs?.log_retention_lines ?? STREAM_LOG_RETENTION_LINES;

const StreamStateSchema = z.object({
  connection: z.enum(STREAM_CONNECTIONS),
  streamId: z.string().nullable(),
  cursor: z.string().nullable(),
  lastEventAt: z.string().nullable(),
  historyStartAt: z.string().nullable(),
  backfillTargetAt: z.string().nullable(),
  reachedLiveTail: z.boolean(),
  backfillPercent: z.number().nullable(),
  objectsRead: z.number().int(),
  objectsReadAt: z.string().nullable(),
  objectsHeld: z.number().int(),
});

const UNCONFIGURED_STREAM_STATE = {
  connection: 'not_configured' as const,
  streamId: null,
  cursor: null,
  lastEventAt: null,
  historyStartAt: null,
  backfillTargetAt: null,
  reachedLiveTail: false,
  backfillPercent: null,
  objectsRead: 0,
  objectsReadAt: null,
  objectsHeld: 0,
};

const NamedSchema = z.object({ id: z.string(), name: z.string() });

const ConnectorDetailSchema = ConnectorListItemSchema.extend({
  jobKind: z.string().nullable(),
  settingsUpdatedAt: z.string().nullable(),
  lastReportedAt: z.string().nullable(),
  serviceAccount: NamedSchema.nullable(),
  groups: z.array(NamedSchema),
  roles: z.array(NamedSchema),
  activeRunId: z.string().nullable(),
  lastRunId: z.string().nullable(),
  lastRunState: z.unknown(),
  streamCursor: z.string().nullable(),
  streamLastEventAt: z.string().nullable(),
  streamEnabled: z.boolean().nullable(),
  streamReachedLiveTail: z.boolean().nullable(),
});

const ConnectorScheduleSchema = z.object({
  cadence: z.enum(SCHEDULE_CADENCES),
  atMinute: z.number().int().nullable(),
  weekday: z.number().int().nullable(),
  timeZone: z.string().nullable(),
  /** Null when nothing will run: a manual schedule, or a connector that is not configured. */
  nextRunAt: z.string().nullable(),
  offeredCadences: z.array(z.enum(SCHEDULE_CADENCES)),
});

const SetScheduleInput = z.object({
  source: z.enum([...INTEGRATION_SOURCES, 'default_threats']),
  cadence: z.enum(SCHEDULE_CADENCES),
  atMinute: z.number().int().min(0).max(24 * 60 - 1).nullable(),
  weekday: z.number().int().min(0).max(6).nullable(),
  timeZone: z.string().max(64).nullable(),
});

/** The stream connector keeps its own settings row, so only these six bind through `integration_settings`. */
const isIntegrationSource = (source: ConnectorSource): source is IntegrationSource =>
  (INTEGRATION_SOURCES as ReadonlyArray<string>).includes(source);

export const connectorsRouter = (
  procedure: TenantProcedure,
  telemetry: AppRouterTelemetry = {},
) => router({
  getPipelineSnapshot: procedure
    .output(PipelineSnapshotSchema)
    .query(async ({ ctx: { services, origin } }) => {
      const { tenantId } = origin;
      if (!tenantId) {
        return EMPTY_PIPELINE_SNAPSHOT;
      }
      const scoped = services.withOrigin(origin);
      const staleAfterSeconds = workerStaleAfterSeconds();
      const [settings, openctiSettings, defaultThreats, activeCounts, recordsIngested, workerAnswering] = await Promise.all([
        scoped.integrationSettings.getAllIntegrationSettings(),
        scoped.openctiConnector.getSettings(tenantId),
        scoped.defaultThreats.getSettings(tenantId),
        scoped.jobs.getActiveRunCounts(tenantId, JOB_BACKED_CONNECTOR_KINDS),
        scoped.connectors.countIngestedRecords(tenantId),
        scoped.workers.isAnyWorkerAlive(staleAfterSeconds),
      ]);
      const configurations = resolveConnectorConfigurations(config().connectors, tenantId, settings, openctiSettings, defaultThreatsRunState(defaultThreats));
      return {
      // Wired end-to-end: a bound service account with no platform credentials cannot feed anything.
      // Default Threats is on for every tenant by default, so it says nothing about what the tenant configured.
        configuredConnectors: Object.entries(configurations)
          .filter(([source, c]) => source !== 'default_threats' && c.platformConfigured && c.tenantConfigured && c.enabled)
          .length,
        queuedRuns: activeCounts.queued,
        runningNow: activeCounts.running,
        recordsIngested,
        workerAnswering,
        streamCatchupPercent: computeTimelineProgressPercent({
          historyStartAt: openctiSettings?.historyStartAt ?? null,
          backfillTargetAt: openctiSettings?.backfillTargetAt ?? null,
          currentEventAt: openctiSettings?.lastEventAt ?? null,
        }),
      };
    }),

  // bounded-by: CONNECTOR_SOURCES, one card per connector
  listConnectors: procedure
    .output(z.array(ConnectorCardSchema))
    .query(async ({ ctx: { services, origin } }) => {
      const scoped = services.withOrigin(origin);
      const { tenantId } = origin;
      const [settings, openctiSettings, defaultThreats, runSummaries, savedSchedules] = await Promise.all([
        tenantId ? scoped.integrationSettings.getAllIntegrationSettings() : [],
        tenantId ? scoped.openctiConnector.getSettings(tenantId) : null,
        tenantId ? scoped.defaultThreats.getSettings(tenantId) : null,
        tenantId ? scoped.jobs.getRunSummariesByKind(tenantId, JOB_BACKED_CONNECTOR_KINDS) : [],
        tenantId ? scoped.jobSchedules.getSchedules(tenantId) : [],
      ]);

      const defaultThreatsState = defaultThreats === null ? null : defaultThreatsRunState(defaultThreats);
      const configurations = resolveConnectorConfigurations(config().connectors, tenantId, settings, openctiSettings, defaultThreatsState);
      const summaryByKind = new Map(runSummaries.map((summary) => [summary.kind, summary]));
      const savedByKind = new Map(savedSchedules.map((row) => [row.kind, row]));
      const runnable = new Set(tenantId && defaultThreatsState
        ? resolveRunnableConnectors(config().connectors, tenantId, settings, defaultThreatsState)
          .filter((connector) => connector.payload !== null)
          .map((connector) => connector.entry.source)
        : []);
      const nowMs = Date.now();
      const cardSchedule = (source: ConnectorSource) => {
        const jobEntry = jobBackedConnector(source);
        if (jobEntry === null) {
          return null;
        }
        const { schedule, nextRunAt } = readConnectorSchedule(jobEntry, savedByKind.get(jobEntry.jobKind) ?? null, runnable.has(source), nowMs);
        return { cadence: schedule.cadence, nextRunAt: nextRunAt?.toISOString() ?? null };
      };

      return CONNECTOR_ENTRIES.map((entry) => {
        const configuration = configurations[entry.source];
        const summary = entry.jobKind === null ? undefined : summaryByKind.get(entry.jobKind);
        const lastRun = summary?.lastTerminalRun ?? null;
        const activeRun = summary?.activeRun ?? null;

        const state = entry.mechanism === 'live_stream'
          ? deriveStreamConnectorState({
            platformConfigured: configuration.platformConfigured,
            tenantConfigured: configuration.tenantConfigured,
            authFailed: openctiSettings?.authFailedAt != null,
            enabled: openctiSettings?.enabled === true,
            reachedLiveTail: openctiSettings?.reachedLiveTailAt != null,
          })
          : deriveConnectorState({
            platformConfigured: configuration.platformConfigured,
            tenantConfigured: configuration.tenantConfigured,
            enabled: configuration.enabled,
            hasActiveRun: activeRun !== null,
            lastTerminalRunStatus: terminalRunStatus(lastRun),
          });

        return {
          source: entry.source,
          domain: entry.domain,
          mechanism: entry.mechanism,
          scopeKinds: [...entry.scopeKinds],
          platformConfigured: configuration.platformConfigured,
          tenantConfigured: configuration.tenantConfigured,
          url: configuration.url,
          state,
          enabled: configuration.enabled,
          activeRun: serialiseRun(activeRun),
          lastRun: serialiseRun(lastRun),
          schedule: cardSchedule(entry.source),
        };
      });
    }),

  getConnector: procedure
    .input(SourceInput)
    .output(ConnectorDetailSchema)
    .query(async ({ input, ctx: { services, origin } }) => {
      const scoped = services.withOrigin(origin);
      const { tenantId } = origin;
      const entry = CONNECTOR_INVENTORY[input.source];
      const integrationSource = isIntegrationSource(input.source) ? input.source : null;

      const [settings, openctiSettings, defaultThreats, summaries] = await Promise.all([
        tenantId ? scoped.integrationSettings.getAllIntegrationSettings() : [],
        tenantId ? scoped.openctiConnector.getSettings(tenantId) : null,
        tenantId ? scoped.defaultThreats.getSettings(tenantId) : null,
        tenantId && entry.jobKind !== null ? scoped.jobs.getRunSummariesByKind(tenantId, [entry.jobKind]) : [],
      ]);

      const configuration = resolveConnectorConfigurations(
        config().connectors,
        tenantId,
        settings,
        openctiSettings,
        defaultThreats === null ? null : defaultThreatsRunState(defaultThreats),
      )[input.source];
      const own = integrationSource === null ? null : settings.find((row) => row.source === integrationSource) ?? null;
      const activeRun = summaries[0]?.activeRun ?? null;
      const lastRun = summaries[0]?.lastTerminalRun ?? null;
      const serviceAccountId = input.source === 'opencti'
        ? openctiSettings?.serviceAccountId ?? null
        : own?.serviceAccountId ?? null;

      // `service_accounts` is gated on MANAGE_SECURITY on top of tenant isolation, so a reader
      // without it gets nothing back and the three identity rows render empty.
      const [serviceAccount, groups, roles, lastJob] = await Promise.all([
        serviceAccountId === null ? null : scoped.serviceAccounts.getServiceAccount(serviceAccountId),
        serviceAccountId === null ? [] : scoped.serviceAccounts.getServiceAccountGroups(serviceAccountId),
        serviceAccountId === null ? [] : scoped.serviceAccounts.getServiceAccountRoles(serviceAccountId),
        lastRun === null ? null : scoped.jobs.getJob(lastRun.id),
      ]);

      const state = entry.mechanism === 'live_stream'
        ? deriveStreamConnectorState({
          platformConfigured: configuration.platformConfigured,
          tenantConfigured: configuration.tenantConfigured,
          authFailed: openctiSettings?.authFailedAt != null,
          enabled: openctiSettings?.enabled === true,
          reachedLiveTail: openctiSettings?.reachedLiveTailAt != null,
        })
        : deriveConnectorState({
          platformConfigured: configuration.platformConfigured,
          tenantConfigured: configuration.tenantConfigured,
          enabled: configuration.enabled,
          hasActiveRun: activeRun !== null,
          lastTerminalRunStatus: terminalRunStatus(lastRun),
        });

      const settingsUpdatedAt = input.source === 'opencti'
        ? openctiSettings?.updatedAt ?? null
        : own?.updatedAt ?? null;

      return {
        source: entry.source,
        domain: entry.domain,
        mechanism: entry.mechanism,
        scopeKinds: [...entry.scopeKinds],
        jobKind: entry.jobKind,
        platformConfigured: configuration.platformConfigured,
        tenantConfigured: configuration.tenantConfigured,
        url: configuration.url,
        state,
        activeRun: serialiseRun(activeRun),
        lastRun: serialiseRun(lastRun),
        activeRunId: activeRun?.id ?? null,
        lastRunId: lastRun?.id ?? null,
        lastRunState: lastJob?.stateSnapshot ?? null,
        settingsUpdatedAt: settingsUpdatedAt?.toISOString() ?? null,
        lastReportedAt: (input.source === 'default_threats' ? defaultThreats?.loadedAt : own?.lastReportedAt)?.toISOString() ?? null,
        serviceAccount: serviceAccount ? { id: serviceAccount.id, name: serviceAccount.name } : null,
        groups: groups.map(({ group }) => ({ id: group.id, name: group.name })),
        roles: roles.map((role) => ({ id: role.id, name: role.name })),
        streamCursor: input.source === 'opencti' ? openctiSettings?.cursor ?? null : null,
        streamLastEventAt: input.source === 'opencti'
          ? openctiSettings?.lastEventAt?.toISOString() ?? null
          : null,
        streamEnabled: input.source === 'opencti' ? openctiSettings?.enabled === true : null,
        streamReachedLiveTail: input.source === 'opencti' ? openctiSettings?.reachedLiveTailAt != null : null,
        enabled: configuration.enabled,
      };
    }),

  listRuns: procedure
    .input(SourceInput)
    .output(RunHistorySchema)
    .query(async ({ input, ctx: { services, origin } }) => {
      const entry = CONNECTOR_INVENTORY[input.source];
      if (entry.jobKind === null) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This connector runs continuously and produces no runs.',
        });
      }
      const { tenantId } = origin;
      if (!tenantId) {
        return emptyRunHistory();
      }
      const scoped = services.withOrigin(origin);
      const [inProgress, completed, counts] = await Promise.all([
        scoped.jobs.listRunsForKind(tenantId, entry.jobKind, ACTIVE_JOB_STATUSES, 'enqueued-asc', RUN_LIST_CAP),
        scoped.jobs.listRunsForKind(tenantId, entry.jobKind, TERMINAL_JOB_STATUSES, 'finished-desc', RUN_LIST_CAP),
        scoped.jobs.countRunsForKind(tenantId, entry.jobKind),
      ]);
      return {
        inProgress: inProgress.map(serialiseRunListItem),
        completed: completed.map(serialiseRunListItem),
        inProgressCount: counts.active,
        completedCount: counts.terminal,
        serverNow: new Date().toISOString(),
      };
    }),

  listLogs: procedure
    .input(SourceInput)
    .output(JobLogsSchema)
    .query(async ({ input, ctx: { services, origin } }) => {
      const { tenantId } = origin;
      if (!tenantId) {
        return { groups: [] };
      }
      const scoped = services.withOrigin(origin);
      const entry = CONNECTOR_INVENTORY[input.source];

      if (entry.jobKind === null) {
        const lines = await scoped.jobLogs.listScopeLines(tenantId, STREAM_LOG_SCOPE_KIND, streamLogRetentionLines());
        return {
          groups: lines.length === 0
            ? []
            : [{ runId: null, status: null, startedAt: null, lines: lines.map(serialiseLogLine) }],
        };
      }

      const groups = await scoped.jobLogs.listRunGroups(tenantId, entry.jobKind, logRetentionRuns());
      return { groups: groups.filter((group) => group.lines.length > 0).map(serialiseLogGroup) };
    }),

  getStreamState: procedure
    .input(SourceInput)
    .output(StreamStateSchema)
    .query(async ({ input, ctx: { services, origin } }) => {
      if (CONNECTOR_INVENTORY[input.source].jobKind !== null) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This connector runs as a job and holds no stream.',
        });
      }
      const { tenantId } = origin;
      if (!tenantId) {
        return UNCONFIGURED_STREAM_STATE;
      }
      const scoped = services.withOrigin(origin);
      const [settings, objectsHeld, runtimeAnswering, serviceAccountActive] = await Promise.all([
        scoped.openctiConnector.getSettings(tenantId),
        scoped.openctiConnector.countStreamObjects(tenantId),
        scoped.workers.isAnyWorkerAlive(workerStaleAfterSeconds()),
        scoped.openctiConnector.isBoundServiceAccountActive(tenantId),
      ]);
      const configuration = resolveConnectorConfigurations(config().connectors, tenantId, [], settings, null)[input.source];
      return {
        connection: deriveStreamConnection({
          platformConfigured: configuration.platformConfigured,
          tenantConfigured: configuration.tenantConfigured,
          authFailed: settings?.authFailedAt != null,
          enabled: settings?.enabled === true,
          runtimeAnswering,
          serviceAccountActive,
        }),
        streamId: settings?.streamId ?? null,
        cursor: settings?.cursor ?? null,
        lastEventAt: settings?.lastEventAt?.toISOString() ?? null,
        historyStartAt: settings?.historyStartAt?.toISOString() ?? null,
        backfillTargetAt: settings?.backfillTargetAt?.toISOString() ?? null,
        reachedLiveTail: settings?.reachedLiveTailAt != null,
        backfillPercent: computeTimelineProgressPercent({
          historyStartAt: settings?.historyStartAt ?? null,
          backfillTargetAt: settings?.backfillTargetAt ?? null,
          currentEventAt: settings?.lastEventAt ?? null,
        }),
        objectsRead: settings?.objectsRead ?? 0,
        objectsReadAt: settings?.objectsReadAt?.toISOString() ?? null,
        objectsHeld,
      };
    }),

  syncNow: procedure
    .input(SourceInput)
    .output(z.object({ jobId: z.string() }))
    .mutation(async ({ input, ctx: { services, origin } }) => {
      const { tenantId } = origin;
      if (!tenantId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      const entry = jobBackedConnector(input.source);
      if (entry === null) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This connector runs continuously and has no run to enqueue.',
        });
      }
      const scoped = services.withOrigin(origin);
      const [settings, defaultThreats] = await Promise.all([
        scoped.integrationSettings.getAllIntegrationSettings(),
        scoped.defaultThreats.getSettings(tenantId),
      ]);
      const payload = resolveRunnableConnectors(config().connectors, tenantId, settings, defaultThreatsRunState(defaultThreats))
        .find((connector) => connector.entry.source === input.source)?.payload ?? null;
      if (payload === null) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'This connector is not configured for this tenant.' });
      }
      const minuteSlot = new Date().toISOString().slice(0, 16);
      const { jobId } = await scoped.jobs.enqueueJob({
        kind: entry.jobKind,
        tenantId,
        payload,
        idempotencyKey: `${tenantId}:${entry.idempotencyPrefix}-${minuteSlot}`,
        // The run assumes the service account from its payload, so this books who asked rather
        // than whose authorization it will run on.
        ...originTrigger(origin),
        interactive: true,
        maxRuntimeMs: entry.maxRuntimeMs,
        maxAttempts: entry.maxAttempts,
      });
      try {
        telemetry.onConnectorSyncLaunched?.();
      } catch {
      // Telemetry must never break the business flow.
      }
      return { jobId };
    }),

  reconnectStream: procedure
    .input(SourceInput)
    .output(z.void())
    .mutation(async ({ input, ctx: { services, origin } }) => {
      const { tenantId } = origin;
      if (!tenantId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      if (CONNECTOR_INVENTORY[input.source].jobKind !== null) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This connector runs as a job and holds no stream.',
        });
      }
      const scoped = services.withOrigin(origin);
      // The stream's position is the connector's own state, gated like the switch that runs it.
      if (!await scoped.capabilities.hasManageSecurity()) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      const settings = await scoped.openctiConnector.getSettings(tenantId);
      if (!settings?.streamId || !settings.serviceAccountId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'This stream is not configured for this tenant.' });
      }
      if (!settings.enabled) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'This stream is switched off.' });
      }
      // Reconnecting would abandon the backfill and reconnect nothing: the consumer refuses to start
      // on a deactivated account.
      if (!await scoped.openctiConnector.isBoundServiceAccountActive(tenantId)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'This stream is bound to a deactivated service account.' });
      }
      await scoped.openctiConnector.reconnectAtLiveTail(tenantId);
    }),

  resetState: procedure
    .input(SourceInput)
    .output(z.void())
    .mutation(async ({ input, ctx: { services, origin } }) => {
      const { tenantId } = origin;
      if (!tenantId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      const scoped = services.withOrigin(origin);
      if (!await scoped.capabilities.hasManageSecurity()) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      if (isIntegrationSource(input.source)) {
        await scoped.integrationSettings.clearSyncWatermark(input.source);
        if (input.source === 'openaev') {
          const connectorId = await scoped.integrationSettings.getConnectorId('openaev');
          if (connectorId) {
            await scoped.openaevConnector.resetState(connectorId);
          }
        }
        return;
      }
      if (input.source === 'default_threats') {
        await scoped.defaultThreats.forgetLoad();
        return;
      }
      await scoped.openctiConnector.resetStreamState(tenantId);
    }),

  /** A connector with no schedule saved reads its default, which the scheduler runs it on. */
  getSchedule: procedure
    .input(SourceInput)
    .output(ConnectorScheduleSchema.nullable())
    .query(async ({ input, ctx: { services, origin } }) => {
      const { tenantId } = origin;
      const entry = jobBackedConnector(input.source);
      if (!tenantId || entry === null) {
        return null;
      }
      const scoped = services.withOrigin(origin);
      const [settings, defaultThreats, saved] = await Promise.all([
        scoped.integrationSettings.getAllIntegrationSettings(),
        scoped.defaultThreats.getSettings(tenantId),
        scoped.jobSchedules.getSchedule(tenantId, entry.jobKind),
      ]);
      const runnable = resolveRunnableConnectors(config().connectors, tenantId, settings, defaultThreatsRunState(defaultThreats))
        .some((connector) => connector.entry.source === entry.source && connector.payload !== null);
      const { schedule, nextRunAt } = readConnectorSchedule(entry, saved, runnable, Date.now());
      return {
        ...schedule,
        nextRunAt: nextRunAt?.toISOString() ?? null,
        offeredCadences: offeredCadences(entry.minIntervalHours),
      };
    }),

  setSchedule: procedure
    .input(SetScheduleInput)
    .output(z.void())
    .mutation(async ({ input, ctx: { services, origin } }) => {
      const { tenantId } = origin;
      if (!tenantId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      const scoped = services.withOrigin(origin);
      // The permission that configures the integration.
      if (!await scoped.capabilities.hasManageSecurity()) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      const entry = CONNECTOR_INVENTORY[input.source];
      const schedule = { cadence: input.cadence, atMinute: input.atMinute, weekday: input.weekday, timeZone: input.timeZone };
      if (schedule.timeZone !== null && !isValidTimeZone(schedule.timeZone)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unknown time zone.' });
      }
      if (!isWellFormedSchedule(schedule)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'This cadence takes a different set of fields.' });
      }
      if (!offeredCadences(entry.minIntervalHours).includes(schedule.cadence)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'This connector cannot run that often.' });
      }
      await scoped.jobSchedules.saveSchedule(tenantId, entry.jobKind, schedule, Date.now());
    }),
});

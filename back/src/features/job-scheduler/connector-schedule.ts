import type { EnqueueJobOptions, EnqueueJobResult, JobScheduleRow, RunSummary, Schedule } from '@app/module';
import type { RunnableConnector } from '../app-router/connectors/connector-configuration';

export type OccurrenceOutcome =
  | 'enqueued'
  /** A run of the connector was already queued or running. */
  | 'skipped_active'
  | 'skipped_unconfigured'
  | 'claimed_elsewhere';

export type OccurrenceReport =
  | { kind: string, occurrence: Date, outcome: OccurrenceOutcome }
  | { kind: string, outcome: 'failed', error: unknown };

export interface ConnectorScheduleDeps {
  listConnectors: (tenantId: string) => Promise<ReadonlyArray<RunnableConnector>>,
  schedules: {
    getSchedules: (tenantId: string) => Promise<Array<JobScheduleRow>>,
    ensureSchedule: (tenantId: string, kind: string, schedule: Schedule, nowMs: number) => Promise<void>,
    claimOccurrence: (row: JobScheduleRow, nowMs: number) => Promise<Date | null>,
    releaseOccurrence: (row: JobScheduleRow, claimed: Date) => Promise<void>,
  },
  jobs: {
    askActiveRuns: (tenantId: string, kind: string, asker: { triggeredBy: 'scheduler' }) => Promise<boolean>,
    getRunSummariesByKind: (tenantId: string, kinds: ReadonlyArray<string>) => Promise<Array<RunSummary>>,
    enqueueJob: (options: EnqueueJobOptions) => Promise<EnqueueJobResult>,
  },
  now: () => number,
}

/** How long a connector with nothing loaded yet waits after a run before the next attempt. */
export const FIRST_LOAD_RETRY_MS = 60 * 60 * 1000;

/**
 * Serves one tenant's due connector occurrences, each at most once. The claim moves the next run to
 * the first slot after now before anything is enqueued, so a skipped or a long-missed occurrence is
 * passed over rather than replayed. A manual run never touches the row, so it leaves the cadence
 * where it was. An occurrence whose enqueue fails is handed back for the next tick. A configured
 * connector with no schedule of its own gets its default here. A connector that throws is reported
 * `failed` and the next ones are still served.
 */
export const runDueConnectorSchedules = async (
  tenantId: string,
  deps: ConnectorScheduleDeps,
): Promise<Array<OccurrenceReport>> => {
  const nowMs = deps.now();
  const [connectors, rows] = await Promise.all([
    deps.listConnectors(tenantId),
    deps.schedules.getSchedules(tenantId),
  ]);
  const rowByKind = new Map(rows.map((row) => [row.kind, row]));
  const reports: Array<OccurrenceReport> = [];

  const enqueue = async (entry: RunnableConnector['entry'], payload: Record<string, unknown>, idempotencyKey: string) =>
    deps.jobs.enqueueJob({
      kind: entry.jobKind,
      tenantId,
      payload,
      idempotencyKey,
      triggeredBy: 'scheduler',
      interactive: false,
      maxRuntimeMs: entry.maxRuntimeMs,
      maxAttempts: entry.maxAttempts,
      skipIfActive: true,
    });

  // A connector nothing has loaded for owes a run whatever its schedule says, but a mirror that is down
  // is retried at most once an hour, not on every tick.
  const firstLoadDue = async (entry: RunnableConnector['entry']): Promise<boolean> => {
    const [summary] = await deps.jobs.getRunSummariesByKind(tenantId, [entry.jobKind]);
    if (summary?.activeRun) {
      return false;
    }
    const finishedAt = summary?.lastTerminalRun?.finishedAt;
    return !finishedAt || nowMs - finishedAt.getTime() >= FIRST_LOAD_RETRY_MS;
  };

  const serve = async ({ entry, payload, firstRunNow }: RunnableConnector): Promise<void> => {
    const row = rowByKind.get(entry.jobKind);
    if (!row && payload !== null) {
      await deps.schedules.ensureSchedule(tenantId, entry.jobKind, entry.defaultSchedule, nowMs);
    }
    if (payload !== null && firstRunNow && await firstLoadDue(entry)) {
      const enqueued = await enqueue(entry, payload, `${tenantId}:${entry.idempotencyPrefix}-first`);
      reports.push({ kind: entry.jobKind, occurrence: new Date(nowMs), outcome: enqueued.alreadyExisted ? 'skipped_active' : 'enqueued' });
    }
    if (!row) {
      return;
    }
    if (row.nextRunAt === null || row.nextRunAt.getTime() > nowMs) {
      return;
    }
    const occurrence = row.nextRunAt;
    const report = (outcome: OccurrenceOutcome): void => {
      reports.push({ kind: entry.jobKind, occurrence, outcome });
    };
    const claimed = await deps.schedules.claimOccurrence(row, nowMs);
    if (claimed === null) {
      report('claimed_elsewhere');
      return;
    }
    if (payload === null) {
      report('skipped_unconfigured');
      return;
    }
    let enqueued: EnqueueJobResult;
    try {
      // Any active run answers the occurrence, whatever its payload, and owes it to the askers
      // relying on it: the claim has already consumed it.
      if (await deps.jobs.askActiveRuns(tenantId, entry.jobKind, { triggeredBy: 'scheduler' })) {
        report('skipped_active');
        return;
      }
      // A Sync now can still start between the count and the enqueue: `skipIfActive` keeps it from
      // owing a second run on this occurrence's behalf.
      // The payload Sync now books, so the dedupe folds either into the other rather than running both.
      enqueued = await enqueue(entry, payload, `${tenantId}:${entry.idempotencyPrefix}-scheduled-${occurrence.toISOString()}`);
    } catch (error) {
      await deps.schedules.releaseOccurrence(row, claimed);
      throw error;
    }
    report(enqueued.alreadyExisted ? 'skipped_active' : 'enqueued');
  };

  for (const connector of connectors) {
    try {
      await serve(connector);
    } catch (error) {
      reports.push({ kind: connector.entry.jobKind, outcome: 'failed', error });
    }
  }
  return reports;
};

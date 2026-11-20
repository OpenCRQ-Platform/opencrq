import { and, asc, desc, eq, gt, inArray, lt, ne, notInArray, or } from 'drizzle-orm';
import type { JobLogLevel } from './schema';
import { defineRepository } from '../../registry';
import { jobLogs } from './schema';

/** The oldest line retention keeps, as the (instant, id) pair the store is ordered on. */
export interface JobLogCutoff {
  occurredAt: Date,
  id: string,
}

export interface JobLogLineInput {
  id: string,
  tenantId: string,
  jobId: string | null,
  scopeId: string,
  scopeKind: string,
  level: JobLogLevel,
  message: string,
  detail: string | null,
  occurredAt: Date,
}

const LINE_COLUMNS = {
  id: jobLogs.id,
  jobId: jobLogs.jobId,
  level: jobLogs.level,
  message: jobLogs.message,
  detail: jobLogs.detail,
  occurredAt: jobLogs.occurredAt,
};

export const jobLogsRepository = defineRepository({
  appendLines: async ({ db }, lines: ReadonlyArray<JobLogLineInput>) => {
    if (lines.length === 0) {
      return;
    }
    await db.insert(jobLogs).values([...lines]);
  },

  findLinesByJobIds: async ({ db, views }, tenantId: string, jobIds: ReadonlyArray<string>) => {
    if (jobIds.length === 0) {
      return [];
    }
    return db.select(LINE_COLUMNS)
      .from(views.jobLogs)
      .where(and(eq(views.jobLogs.tenantId, tenantId), inArray(views.jobLogs.jobId, [...jobIds])))
      .orderBy(asc(views.jobLogs.occurredAt), asc(views.jobLogs.id));
  },

  /** Newest first, so the caller takes the tail of a long session rather than its head. */
  findRecentLinesByScopeKind: async ({ db, views }, tenantId: string, scopeKind: string, limit: number) =>
    db.select(LINE_COLUMNS)
      .from(views.jobLogs)
      .where(and(eq(views.jobLogs.tenantId, tenantId), eq(views.jobLogs.scopeKind, scopeKind)))
      .orderBy(desc(views.jobLogs.occurredAt), desc(views.jobLogs.id))
      .limit(limit),

  /**
   * A run still waiting for its first attempt has written nothing: counted among the kept runs, it
   * would push one that has lines out of the set. A retry waiting its turn keeps its earlier attempts.
   */
  findRecentRuns: async ({ db, views }, tenantId: string, kind: string, limit: number) =>
    db.select({
      id: views.jobs.id,
      status: views.jobs.status,
      enqueuedAt: views.jobs.enqueuedAt,
      startedAt: views.jobs.startedAt,
    })
      .from(views.jobs)
      .where(and(
        eq(views.jobs.tenantId, tenantId),
        eq(views.jobs.kind, kind),
        or(ne(views.jobs.status, 'queued'), gt(views.jobs.attempt, 0)),
      ))
      .orderBy(desc(views.jobs.enqueuedAt), desc(views.jobs.id))
      .limit(limit),

  findRun: async ({ db, views }, tenantId: string, jobId: string) =>
    db.select({
      id: views.jobs.id,
      status: views.jobs.status,
      enqueuedAt: views.jobs.enqueuedAt,
      startedAt: views.jobs.startedAt,
    })
      .from(views.jobs)
      .where(and(eq(views.jobs.tenantId, tenantId), eq(views.jobs.id, jobId)))
      .then((rows) => rows.at(0) ?? null),

  deleteLinesOutsideRuns: async ({ db }, tenantId: string, scopeKind: string, keptJobIds: ReadonlyArray<string>) => {
    const scopeRows = and(eq(jobLogs.tenantId, tenantId), eq(jobLogs.scopeKind, scopeKind));
    await db.delete(jobLogs).where(
      keptJobIds.length === 0 ? scopeRows : and(scopeRows, notInArray(jobLogs.jobId, [...keptJobIds])),
    );
  },

  /** Deletes on the (instant, id) pair: a burst shares a millisecond, and an instant alone would keep it whole. */
  deleteLinesBefore: async ({ db }, tenantId: string, scopeKind: string, cutoff: JobLogCutoff) => {
    await db.delete(jobLogs).where(and(
      eq(jobLogs.tenantId, tenantId),
      eq(jobLogs.scopeKind, scopeKind),
      or(
        lt(jobLogs.occurredAt, cutoff.occurredAt),
        and(eq(jobLogs.occurredAt, cutoff.occurredAt), lt(jobLogs.id, cutoff.id)),
      ),
    ));
  },

  findOldestKeptLine: async ({ db, views }, tenantId: string, scopeKind: string, keepLines: number): Promise<JobLogCutoff | null> =>
    db.select({ occurredAt: views.jobLogs.occurredAt, id: views.jobLogs.id })
      .from(views.jobLogs)
      .where(and(eq(views.jobLogs.tenantId, tenantId), eq(views.jobLogs.scopeKind, scopeKind)))
      .orderBy(desc(views.jobLogs.occurredAt), desc(views.jobLogs.id))
      .offset(keepLines - 1)
      .limit(1)
      .then((rows) => rows.at(0) ?? null),
});

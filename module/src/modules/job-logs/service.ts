import type { JobLogLineInput } from './repository';
import type { JobLogLine, JobLogRunGroup } from './grouping';
import { defineService } from '../../registry';
import { groupRunLines } from './grouping';
import { jobLogsRepository } from './repository';

export const jobLogsService = defineService(
  'jobLogs',
  jobLogsRepository,
).implement({
  appendLines: async ({ repo }, lines: ReadonlyArray<JobLogLineInput>) => repo.appendLines(lines),

  listRunGroups: async (
    { repo },
    tenantId: string,
    kind: string,
    keepRuns: number,
  ): Promise<Array<JobLogRunGroup>> => {
    const runs = await repo.findRecentRuns(tenantId, kind, keepRuns);
    if (runs.length === 0) {
      return [];
    }
    const rows = await repo.findLinesByJobIds(tenantId, runs.map((run) => run.id));
    return groupRunLines(runs, rows);
  },

  getRunGroup: async ({ repo }, tenantId: string, jobId: string): Promise<JobLogRunGroup | null> => {
    const run = await repo.findRun(tenantId, jobId);
    if (!run) {
      return null;
    }
    const rows = await repo.findLinesByJobIds(tenantId, [run.id]);
    return groupRunLines([run], rows).at(0) ?? null;
  },

  listScopeLines: async (
    { repo },
    tenantId: string,
    scopeKind: string,
    limit: number,
  ): Promise<Array<JobLogLine>> => {
    const rows = await repo.findRecentLinesByScopeKind(tenantId, scopeKind, limit);
    return rows
      .map((row) => ({
        id: row.id,
        level: row.level,
        message: row.message,
        detail: row.detail,
        occurredAt: row.occurredAt,
      }))
      .reverse();
  },

  trimToRecentRuns: async ({ repo }, tenantId: string, kind: string, keepRuns: number) => {
    const runs = await repo.findRecentRuns(tenantId, kind, keepRuns);
    await repo.deleteLinesOutsideRuns(tenantId, kind, runs.map((run) => run.id));
  },

  trimToLineCount: async ({ repo }, tenantId: string, scopeKind: string, keepLines: number) => {
    const cutoff = await repo.findOldestKeptLine(tenantId, scopeKind, keepLines);
    if (cutoff === null) {
      return;
    }
    await repo.deleteLinesBefore(tenantId, scopeKind, cutoff);
  },
});

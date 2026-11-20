import { deriveJobHealth, JOB_HEALTHS } from '@app/module';
import type { JobCatalogueEntry, RunSummary } from '@app/module';
import { z } from 'zod';
import { activeRunStatus, RunSnapshotSchema, serialiseRun, terminalRunStatus } from './run-contract';

export const JobKindSchema = z.object({
  kind: z.string(),
  observed: z.boolean(),
  daily: z.boolean(),
  health: z.enum(JOB_HEALTHS),
  activeRun: RunSnapshotSchema,
  lastRun: RunSnapshotSchema,
});

export const toJobKind = (entry: JobCatalogueEntry, summary: RunSummary | undefined): z.infer<typeof JobKindSchema> => {
  const activeRun = summary?.activeRun ?? null;
  const lastRun = summary?.lastTerminalRun ?? null;
  return {
    kind: entry.kind,
    observed: entry.observed,
    daily: entry.daily,
    health: deriveJobHealth({
      activeRunStatus: activeRunStatus(activeRun),
      lastTerminalRunStatus: terminalRunStatus(lastRun),
    }),
    activeRun: serialiseRun(activeRun),
    lastRun: serialiseRun(lastRun),
  };
};

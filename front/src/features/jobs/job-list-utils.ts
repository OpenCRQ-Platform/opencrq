import { includesFolded } from '@app/utils/text-fold';
import type { JobHealth } from '@app/module/client';

/**
 * What needs attention first on the list page: a kind whose last run failed, one running, one
 * queued, one that has never run, then one that already went through.
 */
export const JOB_HEALTH_ORDER: ReadonlyArray<JobHealth> = ['failing', 'running', 'queued', 'never_ran', 'healthy'];

export interface JobHealthEntry {
  kind: string,
  health: JobHealth,
}

const byKind = (a: JobHealthEntry, b: JobHealthEntry): number => a.kind.localeCompare(b.kind);

export const sortJobsByAttention = <T extends JobHealthEntry>(entries: ReadonlyArray<T>): Array<T> =>
  [...entries].sort((a, b) => JOB_HEALTH_ORDER.indexOf(a.health) - JOB_HEALTH_ORDER.indexOf(b.health) || byKind(a, b));

export const filterJobsBySearch = <T extends JobHealthEntry>(entries: ReadonlyArray<T>, search: string): Array<T> =>
  entries.filter((entry) => includesFolded(entry.kind, search));

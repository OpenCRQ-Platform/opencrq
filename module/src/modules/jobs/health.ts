import type { TerminalRunStatus } from './schema';

export const JOB_HEALTHS = ['running', 'queued', 'never_ran', 'healthy', 'failing'] as const;
export type JobHealth = (typeof JOB_HEALTHS)[number];

interface JobHealthInput {
  activeRunStatus: 'queued' | 'running' | null,
  /** Null when no run has ever stopped, which is what `never_ran` reads. */
  lastTerminalRunStatus: TerminalRunStatus | null,
}

/**
 * The health of a job kind. Conditions are ordered and the first match wins, which puts a run in
 * flight above the last terminal run: `running` reads `running`, `queued` reads `queued`, either
 * even if the previous run reached the dead-letter queue.
 *
 * A cancelled run reads `healthy`: it is a deliberate stop, not a failure.
 */
export const deriveJobHealth = ({ activeRunStatus, lastTerminalRunStatus }: JobHealthInput): JobHealth => {
  if (activeRunStatus === 'running') {
    return 'running';
  }
  if (activeRunStatus === 'queued') {
    return 'queued';
  }
  if (lastTerminalRunStatus === null) {
    return 'never_ran';
  }
  return lastTerminalRunStatus === 'dlq' ? 'failing' : 'healthy';
};

/** Worst first: what one kind reads across tenants is the worst of what it reads in each. */
const HEALTH_SEVERITY: ReadonlyArray<JobHealth> = ['failing', 'running', 'queued', 'healthy', 'never_ran'];

/**
 * One health per job kind for the whole platform, from the health each tenant reads for it: a kind
 * whose last run reached the dead-letter queue in any tenant reads `failing`, whatever the others
 * read. Sorted by kind so two equal platforms give equal answers.
 */
export const platformJobHealths = (
  perTenant: ReadonlyArray<{ kind: string, health: JobHealth }>,
): Array<{ kind: string, health: JobHealth }> => {
  const worst = new Map<string, JobHealth>();
  for (const { kind, health } of perTenant) {
    const held = worst.get(kind);
    if (held === undefined || HEALTH_SEVERITY.indexOf(health) < HEALTH_SEVERITY.indexOf(held)) {
      worst.set(kind, health);
    }
  }
  return [...worst.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, health]) => ({ kind, health }));
};

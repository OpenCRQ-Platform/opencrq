import type { SQLWrapper } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { RepositoryContext } from '../../registry';
import { and, asc, desc, eq, gte, isNotNull, lte, sql } from 'drizzle-orm';

type ScenarioRuns = RepositoryContext['views']['crqIndicatorRuns'];

export interface RunSampling {
  /** The series starts at the scenario's first quantified run at or after this instant. */
  since: Date,
  now: Date,
  /** Instants spread evenly from that first run to `now`, both ends included. */
  samples: number,
}

/**
 * A scenario's quantified runs read as of `samples` instants spread evenly over its own history in
 * the window, as a subquery of one row per distinct run (two instants landing on the same run give
 * one row), unordered, so a burst of runs moves the last instant only. Each instant is one probe of
 * `crq_indicator_runs_risk_scenario_created_idx`, so the read is bounded by `samples` whatever the
 * run cadence.
 *
 * `riskScenarioId` may be an outer query's column, for a lateral join. `pick` selects the run
 * columns carried beside `runId` and `at`, which it cannot reuse as keys.
 */
export const sampleRunsAsOf = <TFields extends Record<string, PgColumn>>(
  { db, views }: Pick<RepositoryContext, 'db' | 'views'>,
  riskScenarioId: SQLWrapper | string,
  { since, now, samples }: RunSampling,
  pick: (runs: ScenarioRuns) => TFields & { [K in keyof TFields & ('runId' | 'at')]: never },
  alias: string,
) => {
  const runs = views.crqIndicatorRuns;
  const lastStep = Math.max(1, Math.trunc(samples) - 1);

  const firstRun = db
    .select({ at: runs.createdAt })
    .from(runs)
    .where(and(eq(runs.riskScenarioId, riskScenarioId), gte(runs.createdAt, since), isNotNull(runs.aleMean)))
    .orderBy(asc(runs.createdAt), asc(runs.id))
    .limit(1)
    .as('first_run');
  const instant = sql`${firstRun.at} + (${now.toISOString()}::timestamptz - ${firstRun.at}) * (sample_step.step::float8 / ${sql.raw(String(lastStep))})`;
  const picks = pick(runs);
  // Typed without the picks, which the generic would leave unresolved for the joins below.
  const fields: { runId: typeof runs.id, at: typeof runs.createdAt } = { ...picks, runId: runs.id, at: runs.createdAt };
  const asOf = db
    .select(fields)
    .from(runs)
    .where(and(eq(runs.riskScenarioId, riskScenarioId), lte(runs.createdAt, instant), isNotNull(runs.aleMean)))
    .orderBy(desc(runs.createdAt), desc(runs.id))
    .limit(1)
    .as('as_of');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- a subquery exposes each picked column under its own key, typed as the column it was picked from
  const picked = Object.fromEntries(Object.keys(picks).map((key) => [key, (asOf as unknown as Record<string, unknown>)[key]])) as TFields;

  // bounded-by: its input is `samples` limit-1 probes of one scenario; DISTINCT ON only merges instants landing on one run
  return db
    .selectDistinctOn([asOf.runId], { ...picked, runId: asOf.runId, at: asOf.at })
    .from(firstRun)
    .crossJoin(sql`generate_series(0, ${sql.raw(String(lastStep))}) as sample_step(step)`)
    .innerJoinLateral(asOf, sql`true`)
    .as(alias);
};

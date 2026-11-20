import type { SQL } from 'drizzle-orm';
import type { RepositoryContext } from '../../registry';
import type { CrqRunFamily } from './run-profile';
import { and, desc, eq, sql } from 'drizzle-orm';
import { LATERAL_ON } from '../../db/lateral';

type ReadContext = Pick<RepositoryContext, 'db' | 'views'>;

/**
 * The runs a family's figures are read from, for `familyRunOwnership` to share out: per scenario,
 * every run computing the family whole or in part, from the newest one computing it whole onwards.
 * `where` scopes the scenarios and names only `views.riskScenarios`.
 *
 * Both reads are probes of `crq_indicator_runs_risk_scenario_created_idx` from the newest run down,
 * so a scenario costs the runs since its last whole run, not its history. One that never computed
 * the family whole reads every run it has.
 */
export const familyRunsQuery = ({ db, views }: ReadContext, family: CrqRunFamily, where?: SQL) => {
  const runs = views.crqIndicatorRuns;
  const scenario = views.riskScenarios;

  const wholeRun = db
    .select({ createdAt: runs.createdAt, id: runs.id })
    .from(runs)
    .where(and(eq(runs.riskScenarioId, scenario.id), sql`${family} = any(${runs.profile})`))
    .orderBy(desc(runs.createdAt), desc(runs.id))
    .limit(1)
    .as('whole_run');

  const familyRuns = db
    .select({
      runId: runs.id,
      riskScenarioId: runs.riskScenarioId,
      profile: runs.profile,
      rank: sql<number>`(row_number() over (order by ${runs.createdAt} desc, ${runs.id} desc))::int`.as('rank'),
    })
    .from(runs)
    .where(and(
      eq(runs.riskScenarioId, scenario.id),
      // On `created_at` alone, so the bound reaches the index; `id` then breaks a timestamp tie, as
      // two runs of one scenario written in one transaction share it. The upper bound only makes it a
      // range: alone, the lower one is estimated at a third of each scenario's history, a cost that
      // grows with it and on a large tenant has JIT inline and optimize the plan.
      sql`${runs.createdAt} >= coalesce(${wholeRun.createdAt}, '-infinity')`,
      sql`${runs.createdAt} <= 'infinity'`,
      sql`(${wholeRun.id} is null or ${runs.createdAt} > ${wholeRun.createdAt} or ${runs.id} >= ${wholeRun.id})`,
      sql`exists (select 1 from unnest(${runs.profile}) as token where token = ${family} or starts_with(token, ${`${family}:`}))`,
    ))
    .as('family_runs');

  return db
    .select({
      runId: familyRuns.runId,
      riskScenarioId: familyRuns.riskScenarioId,
      rank: familyRuns.rank,
      profile: familyRuns.profile,
    })
    .from(scenario)
    .leftJoinLateral(wholeRun, LATERAL_ON)
    .innerJoinLateral(familyRuns, LATERAL_ON)
    .where(where);
};

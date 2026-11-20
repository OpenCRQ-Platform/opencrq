import type { PgColumn, SelectedFields, SubqueryWithSelection } from 'drizzle-orm/pg-core';
import type { RepositoryContext } from '../../registry';
import { and, desc, eq, lt } from 'drizzle-orm';

type ReadContext = Pick<RepositoryContext, 'db' | 'views'>;

/**
 * Latest run first. `id desc` breaks a `created_at` tie: two runs of the same scenario written in one
 * transaction share the timestamp.
 */
export const latestRunFirst = (views: RepositoryContext['views']) => [desc(views.crqIndicatorRuns.createdAt), desc(views.crqIndicatorRuns.id)];

/**
 * A scenario's latest run, or its latest run created before `before`, as `fields` of
 * `views.crqIndicatorRuns`, for a `leftJoinLateral` / `innerJoinLateral(..., LATERAL_ON)`: a `limit 1`
 * probe of `crq_indicator_runs_risk_scenario_created_idx`, correlated on `views.riskScenarios.id`
 * unless given another scenario id column in `riskScenarioId`.
 */
export const latestRunOf = <TFields extends SelectedFields>(
  { db, views }: ReadContext,
  fields: TFields,
  { riskScenarioId = views.riskScenarios.id, before }: { riskScenarioId?: PgColumn, before?: Date } = {},
) =>
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle's builder types do not resolve over a generic selection; the subquery exposes each field under its own key, typed as the column selected
  db
    .select(fields as SelectedFields)
    .from(views.crqIndicatorRuns)
    .where(and(
      eq(views.crqIndicatorRuns.riskScenarioId, riskScenarioId),
      before ? lt(views.crqIndicatorRuns.createdAt, before) : undefined,
    ))
    .orderBy(...latestRunFirst(views))
    .limit(1)
    .as('latest_run') as unknown as SubqueryWithSelection<TFields, 'latest_run'>;

import type { RepositoryContext } from '../../registry';
import { and, eq, exists, max, sql } from 'drizzle-orm';
import { validEstimateConditions } from '../scenario-loss-estimates/valid-estimate';

type ReadContext = Pick<RepositoryContext, 'db' | 'views'>;

/**
 * A closed scope mapping and declaring nothing has no estate to price, answered per row of `views.riskScenarios`
 * joined to its organization. A boolean rather than a count: the mapping runs to hundreds of
 * thousands of rows and a list only ever asks whether it is empty.
 */
export const noMappedAssetOf = ({ db, views }: ReadContext) =>
  sql<boolean>`coalesce(${views.organizations.estateMode} = 'closed' and not ${exists(
    db.select({ mapped: sql`1` })
      .from(views.organizationAssets)
      .where(eq(views.organizationAssets.organizationId, views.riskScenarios.organizationId)),
  )} and not ${exists(
    db.select({ declared: sql`1` })
      .from(views.declaredEstate)
      .where(eq(views.declaredEstate.organizationId, views.riskScenarios.organizationId)),
  )}, false)`;

/**
 * The freshness of a scenario's inputs, as subqueries over `views.riskScenarios`: `pricing` and
 * `tefInput` join laterally, `tefEstimate` on its `riskScenarioId`. Every read computing readiness
 * takes them from here, so two lists can never disagree on a scenario's status.
 */
export const inputFreshnessOf = ({ db, views }: ReadContext, organizationId?: string) => {
  const scenario = views.riskScenarios;
  const losses = views.scenarioLossEstimates;

  // `computePertExpectedValue` in SQL, summed per row: PERT is linear, so this is the total
  // `getFinancialSummary` prices from the summed triple. A row with a hole or an out-of-order
  // triple prices nothing there either.
  const pricing = db
    .select({
      expectedValue: sql<number | null>`sum((${losses.minValue} + 4 * ${losses.likelyValue} + ${losses.maxValue}) / 6)`.as('expected_value'),
      updatedAt: max(losses.updatedAt).as('pricing_updated_at'),
    })
    .from(losses)
    .where(and(eq(losses.riskScenarioId, scenario.id), ...validEstimateConditions(views)))
    .as('pricing');

  const tefInput = db
    .select({ updatedAt: views.crqIndicatorTefInputs.updatedAt })
    .from(views.crqIndicatorTefInputs)
    .where(eq(views.crqIndicatorTefInputs.riskScenarioId, scenario.id))
    .as('tef_input');

  // The organization filter is repeated inside, or the group runs over every estimate of the tenant.
  const tefEstimate = db
    .select({
      riskScenarioId: views.tefEstimates.riskScenarioId,
      createdAt: max(views.tefEstimates.createdAt).as('tef_estimate_created_at'),
    })
    .from(views.tefEstimates)
    .innerJoin(views.riskScenarios, eq(views.tefEstimates.riskScenarioId, views.riskScenarios.id))
    .where(organizationId ? eq(views.riskScenarios.organizationId, organizationId) : undefined)
    .groupBy(views.tefEstimates.riskScenarioId)
    .as('tef_estimate');

  return { pricing, tefInput, tefEstimate };
};

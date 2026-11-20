import { gte, isNotNull, lte } from 'drizzle-orm';
import type { RepositoryContext } from '../../registry';

// Three bounds present and ordered min ≤ likely ≤ max — the single definition of "valid" every
// caller reading `validOnly` estimates shares, so a scenario's own page and any other split of the
// same data can never disagree on which rows count.
export const validEstimateConditions = (views: RepositoryContext['views']) => [
  isNotNull(views.scenarioLossEstimates.minValue),
  isNotNull(views.scenarioLossEstimates.likelyValue),
  isNotNull(views.scenarioLossEstimates.maxValue),
  lte(views.scenarioLossEstimates.minValue, views.scenarioLossEstimates.likelyValue),
  gte(views.scenarioLossEstimates.maxValue, views.scenarioLossEstimates.likelyValue),
];

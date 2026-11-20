export interface PlanCosts {
  costOneOff: number | null,
  costRecurringAnnual: number | null,
}

export interface PlanReturn {
  /** Null when neither cost is entered, which is not zero. */
  costYear1: number | null,
  returnPercent: number | null,
}

/**
 * The one place a plan's return is computed: a component recomputing it would be a second
 * definition. A cost of zero leaves it undefined rather than infinite.
 */
export const summarisePlanReturn = (totalAleReduction: number | null, costs: PlanCosts): PlanReturn => {
  const costYear1 = costs.costOneOff === null && costs.costRecurringAnnual === null
    ? null
    : (costs.costOneOff ?? 0) + (costs.costRecurringAnnual ?? 0);
  const returnPercent = costYear1 === null || costYear1 <= 0 || totalAleReduction === null
    ? null
    : ((totalAleReduction - costYear1) / costYear1) * 100;
  return { costYear1, returnPercent };
};

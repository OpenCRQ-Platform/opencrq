export const TREATMENT_PLAN_STATUSES = ['draft', 'active', 'completed', 'abandoned'] as const;
export type TreatmentPlanStatus = typeof TREATMENT_PLAN_STATUSES[number];

export const isTreatmentPlanStatus = (value: string): value is TreatmentPlanStatus =>
  (TREATMENT_PLAN_STATUSES as ReadonlyArray<string>).includes(value);

import { t } from '@lingui/core/macro';

type DwellSensitivity = 'none' | 'weak' | 'strong';

type ScalingVariable =
  | 'systems_in_scope'
  | 'counsel_hours'
  | 'public_severity_tier'
  | 'response_headcount_days'
  | 'destroyed_device_count'
  | 'outage_days'
  | 'revenue_band'
  | 'payment_flow_value'
  | 'affected_record_count'
  | 'claim_and_jurisdiction_count'
  | 'regulated_revenue'
  | 'contracted_revenue'
  | 'recurring_revenue_margin'
  | 'rd_investment';

/** Thunks, not strings: the active locale is only known at render time. */
const DWELL_SENSITIVITY_LABELS: Record<DwellSensitivity, () => string> = {
  none: () => t`None`,
  weak: () => t`Weak`,
  strong: () => t`Strong`,
};

const SCALING_VARIABLE_LABELS: Record<ScalingVariable, () => string> = {
  systems_in_scope: () => t`Systems in scope`,
  counsel_hours: () => t`Counsel hours`,
  public_severity_tier: () => t`Public severity tier`,
  response_headcount_days: () => t`Response headcount-days`,
  destroyed_device_count: () => t`Destroyed device count`,
  outage_days: () => t`Outage days`,
  revenue_band: () => t`Revenue band`,
  payment_flow_value: () => t`Payment flow value`,
  affected_record_count: () => t`Affected record count`,
  claim_and_jurisdiction_count: () => t`Claim and jurisdiction count`,
  regulated_revenue: () => t`Regulated revenue`,
  contracted_revenue: () => t`Contracted revenue`,
  recurring_revenue_margin: () => t`Recurring revenue margin`,
  rd_investment: () => t`R&D investment`,
};

const dwellSensitivityLookup = new Map<string, () => string>(Object.entries(DWELL_SENSITIVITY_LABELS));
const scalingVariableLookup = new Map<string, () => string>(Object.entries(SCALING_VARIABLE_LABELS));

/** Translated label for a loss driver's dwell-time sensitivity, falling back to the raw code. */
export const getDwellSensitivityLabel = (value: string): string => dwellSensitivityLookup.get(value)?.() ?? value;

/** Translated label for the business quantity a loss driver scales with, falling back to the raw code. */
export const getScalingVariableLabel = (value: string): string => scalingVariableLookup.get(value)?.() ?? value;

/** How much attacker dwell time changes the size of a loss driver. */
export const DWELL_SENSITIVITY_VALUES = ['none', 'weak', 'strong'] as const;
export type DwellSensitivity = typeof DWELL_SENSITIVITY_VALUES[number];

/**
 * The business quantity a loss driver scales with.
 * Four drivers deliberately share `affected_record_count`: it is the key a later comonotone
 * coupling uses to find exactly that subset.
 */
export const SCALING_VARIABLE_VALUES = [
  'systems_in_scope',
  'counsel_hours',
  'public_severity_tier',
  'response_headcount_days',
  'destroyed_device_count',
  'outage_days',
  'revenue_band',
  'payment_flow_value',
  'affected_record_count',
  'claim_and_jurisdiction_count',
  'regulated_revenue',
  'contracted_revenue',
  'recurring_revenue_margin',
  'rd_investment',
] as const;
export type ScalingVariable = typeof SCALING_VARIABLE_VALUES[number];

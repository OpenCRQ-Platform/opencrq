/**
 * PERT formula: E = (Min + 4 × Likely + Max) / 6
 *
 * Shared by the risk-scenario financial-impact form and the dashboard exposure flow,
 * which splits a scenario's annual loss across its loss drivers by their expected values.
 */
export const computePert = (min: number, likely: number, max: number): number =>
  (min + 4 * likely + max) / 6;

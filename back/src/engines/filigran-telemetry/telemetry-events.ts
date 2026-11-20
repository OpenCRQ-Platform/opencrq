/**
 * In-memory feature-usage event counters (OpenCRQ has no Redis, unlike
 * OpenCTI). Counters accumulate between telemetry exports and are drained at
 * observation time: with a PeriodicExportingMetricReader, gauge callbacks run
 * exactly once per export, so each export window reports the count of events
 * since the previous export. Counts are lost on process restart - acceptable
 * for anonymous usage statistics.
 */
export interface EventCounterDefinition {
  name: string,
  description: string,
}

export const EVENT_COUNTERS: Array<EventCounterDefinition> = [
  {
    name: 'user_login_count',
    description: 'Number of user sessions created since the previous telemetry export',
  },
  {
    name: 'risk_scenario_created_count',
    description: 'Number of risk scenarios created since the previous telemetry export',
  },
  {
    name: 'crq_simulation_launched_count',
    description: 'Number of CRQ simulations launched since the previous telemetry export',
  },
  {
    name: 'connector_sync_launched_count',
    description: 'Number of connector sync jobs launched since the previous telemetry export',
  },
];

const counters = new Map<string, number>();

export const incrementEventCounter = (name: string, amount = 1): void => {
  counters.set(name, (counters.get(name) ?? 0) + amount);
};

export const drainEventCounter = (name: string): number => {
  const value = counters.get(name) ?? 0;
  counters.set(name, 0);
  return value;
};

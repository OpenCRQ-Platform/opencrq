export const SCENARIO_INPUT_KINDS = ['tef', 'loss-drivers'] as const;

export type ScenarioInputKind = typeof SCENARIO_INPUT_KINDS[number];

/** Ordered worst first: the order a list of scenarios reads in when sorted by status. */
export const SCENARIO_READINESS_STATUSES = ['no-mapped-asset', 'incomplete', 'not-simulated', 'stale', 'ready'] as const;

export type ScenarioReadinessStatus = typeof SCENARIO_READINESS_STATUSES[number];

export interface ScenarioReadiness {
  status: ScenarioReadinessStatus,
  /** Inputs never filled in. */
  missing: Array<ScenarioInputKind>,
  /** Inputs edited after the last run, so the stored figures no longer reflect them. */
  outdated: Array<ScenarioInputKind>,
}

export interface ScenarioReadinessInput {
  /**
   * The scenario sits in a closed scope holding no asset, so no run can start over its estate. Only
   * a caller that read the scope supplies it; `missing` and `outdated` do not depend on it.
   */
  noMappedAsset?: boolean,
  lastRunAt: Date | null,
  /** Null means the input was never filled in. */
  tefUpdatedAt: Date | null,
  lossDriversUpdatedAt: Date | null,
  /**
   * The frequency is the platform's own estimate (auto mode) and none is stored yet: it is computed
   * and stored on the first read of the scenario's TEF or at its first run, so it is neither
   * missing nor outdated.
   */
  tefDerivedOnRead?: boolean,
}

/**
 * The one next action a scenario needs, as a status.
 *
 * Precedence follows what blocks what: an estate holding nothing leaves no run to start whatever
 * the inputs say, an input that was never filled in makes both a run and a re-run pointless, and a
 * scenario that has never run cannot have drifted from its inputs.
 */
export const computeScenarioReadiness = ({
  noMappedAsset = false,
  lastRunAt,
  tefUpdatedAt,
  lossDriversUpdatedAt,
  tefDerivedOnRead = false,
}: ScenarioReadinessInput): ScenarioReadiness => {
  const inputs: Array<{ kind: ScenarioInputKind, updatedAt: Date | null, derivedOnRead: boolean }> = [
    { kind: 'tef', updatedAt: tefUpdatedAt, derivedOnRead: tefDerivedOnRead && tefUpdatedAt === null },
    { kind: 'loss-drivers', updatedAt: lossDriversUpdatedAt, derivedOnRead: false },
  ];

  const missing = inputs.filter((input) => input.updatedAt === null && !input.derivedOnRead).map((input) => input.kind);
  const outdated = lastRunAt === null
    ? []
    : inputs
      .filter((input) => input.updatedAt !== null && input.updatedAt > lastRunAt)
      .map((input) => input.kind);

  const status = noMappedAsset
    ? 'no-mapped-asset'
    : missing.length > 0
      ? 'incomplete'
      : lastRunAt === null
        ? 'not-simulated'
        : outdated.length > 0
          ? 'stale'
          : 'ready';

  return { status, missing, outdated };
};

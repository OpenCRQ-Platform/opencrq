import {
  AttackOutcome_FinancialFraudFundsTheft,
  AttackOutcome_ServiceDisruption,
} from './attack-outcomes-ids';

export const ATTACK_PATH_KEYS = [
  'outside_perimeter',
  'access_held_or_outside_perimeter',
] as const;

export type AttackPathKey = (typeof ATTACK_PATH_KEYS)[number];

export interface PathWithoutInitialAccess {
  /** Names the path among a run's unplayable obstacles. */
  readonly key: AttackPathKey,
  /** The share of the outcome's attacks that take it, in [0, 1]. */
  readonly share: number,
  /** The Impact techniques it plays, parents. */
  readonly techniqueExternalIds: ReadonlyArray<string>,
}

/** Keyed by catalogue outcome id; an outcome absent here sends no attack around initial access. */
export const PATHS_WITHOUT_INITIAL_ACCESS: Readonly<Record<string, PathWithoutInitialAccess>> = {
  // The outcome's frequency counts DDoS incidents, which need no foothold.
  [AttackOutcome_ServiceDisruption]: { key: 'outside_perimeter', share: 1, techniqueExternalIds: ['T1498', 'T1499'] },
  // A floor: the BEC cases that start from a spoofed domain or an insider.
  [AttackOutcome_FinancialFraudFundsTheft]: { key: 'access_held_or_outside_perimeter', share: 0.05, techniqueExternalIds: ['T1657'] },
};

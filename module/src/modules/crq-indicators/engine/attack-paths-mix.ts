import { newError } from '@app/utils';
import type { AttackRunOutcomes } from './attack-run-evaluation';

/** Where an attack run ends up, by the path it took. The four shares sum to 1. */
export interface AttackPathShares {
  readonly stoppedAtInitialAccess: number,
  readonly direct: number,
  readonly long: number,
  readonly withoutInitialAccess: number,
}

/**
 * Mixes the chains an attack can take into one partition. `direct` and `long` are each a chain's
 * full partition whose door already cleared at `doorTarget` and `doorOther`; a chain left out
 * (`direct` null when no target fell) contributes nothing. `blocked` is what the other three leave,
 * clamped at 0 when rounding makes them sum past 1. With the long chain alone its partition is
 * returned as is, so a scenario no direct path or share touches prices exactly as the full chain.
 * `long` is null only when every attack goes around the door, where it weighs nothing.
 */
export const mixAttackPaths = (input: {
  readonly doorTarget: number,
  readonly doorOther: number,
  readonly direct: AttackRunOutcomes | null,
  readonly long: AttackRunOutcomes | null,
  readonly withoutInitialAccessShare: number,
  readonly withoutInitialAccess: AttackRunOutcomes | null,
}): { outcomes: AttackRunOutcomes, shares: AttackPathShares } => {
  const { doorTarget, doorOther, direct, long, withoutInitialAccessShare: g, withoutInitialAccess } = input;

  if (g > 0 && withoutInitialAccess === null) {
    throw newError('A share of attacks around the initial access has no partition to price it', { share: g });
  }
  if (long === null && g < 1) {
    throw newError('Attacks through the initial access have no long partition to price them', { share: g });
  }

  const shares = {
    stoppedAtInitialAccess: Math.max(0, (1 - g) * (1 - doorTarget - doorOther)),
    direct: (1 - g) * doorTarget,
    long: (1 - g) * doorOther,
    withoutInitialAccess: g,
  };

  if (direct === null && g === 0 && long !== null) {
    return { outcomes: long, shares };
  }

  const part = (pick: (outcomes: AttackRunOutcomes) => number): number =>
    (1 - g) * ((direct === null ? 0 : pick(direct)) + (long === null ? 0 : pick(long)))
    + (withoutInitialAccess === null ? 0 : g * pick(withoutInitialAccess));

  const evicted = part((o) => o.evicted);
  const impactDetected = part((o) => o.impactDetected);
  const impactUndetected = part((o) => o.impactUndetected);

  return {
    outcomes: {
      blocked: Math.max(0, 1 - (evicted + impactDetected + impactUndetected)),
      evicted,
      impactDetected,
      impactUndetected,
    },
    shares,
  };
};

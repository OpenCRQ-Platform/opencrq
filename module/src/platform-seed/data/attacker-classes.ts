import type { ActorClass } from '../../modules/threat-analyses/actor-classes';
import { ATTACK_RUN_DAYS_BY_CLASS } from '../../modules/crq-indicators/engine/attack-run-constants';
import { ACTOR_CLASS_VALUES } from '../../modules/threat-analyses/actor-classes';

export interface SeededAttacker {
  actorClass: ActorClass,
  share: number,
  vulnerabilityMean: number,
  vulnerabilityP5: number,
  vulnerabilityP50: number,
  vulnerabilityP95: number,
  reactionTimeExceededShare: number,
}

export interface SeededClassAttacker extends SeededAttacker {
  attackRunDays: number,
}

const weightedMean = (
  actors: ReadonlyArray<SeededAttacker>,
  share: number,
  value: (actor: SeededAttacker) => number,
): number => actors.reduce((total, actor) => total + actor.share * value(actor), 0) / share;

/**
 * The attackers the engine would store: one per actor class present, standing for its actors. A
 * weighted mean keeps `p5 <= p50 <= p95`, and the summed shares keep the run's vulnerability
 * recomposable from the rows.
 */
export const foldAttackersByClass = (attackers: ReadonlyArray<SeededAttacker>): Array<SeededClassAttacker> =>
  ACTOR_CLASS_VALUES.flatMap((actorClass) => {
    const actors = attackers.filter((attacker) => attacker.actorClass === actorClass);
    const share = actors.reduce((total, actor) => total + actor.share, 0);
    if (!(share > 0)) {
      return [];
    }
    return [{
      actorClass,
      share,
      vulnerabilityMean: weightedMean(actors, share, (actor) => actor.vulnerabilityMean),
      vulnerabilityP5: weightedMean(actors, share, (actor) => actor.vulnerabilityP5),
      vulnerabilityP50: weightedMean(actors, share, (actor) => actor.vulnerabilityP50),
      vulnerabilityP95: weightedMean(actors, share, (actor) => actor.vulnerabilityP95),
      reactionTimeExceededShare: weightedMean(actors, share, (actor) => actor.reactionTimeExceededShare),
      attackRunDays: ATTACK_RUN_DAYS_BY_CLASS[actorClass],
    }];
  });

import { newError } from '@app/utils';
import type { AttackerState } from './walk-resolver';
import { RESOURCE_TOUCHING_TACTIC_EXTERNAL_IDS, TACTIC_WALK_RULES } from './attack-walk';
import { tacticDepth } from './walk-depth';
import { EMPTY_ATTACKER_STATE, grantEffects, isActionPlayable } from './walk-resolver';

export interface AttackRunObstacle {
  /** The attacker fact this obstacle grants, or the terminal tactic when it is the objective. */
  readonly key: string,
  readonly tacticExternalIds: ReadonlyArray<string>,
  readonly depth: number,
  readonly resourceTouching: boolean,
  readonly stateBefore: AttackerState,
}

/**
 * The obstacles of one scenario, derived by walking the shipped prerequisite table from the empty
 * state to the terminal tactic and never written down. Tactics granting the same fact pool into
 * one obstacle, and the walk table's own row order is what puts credentials before knowledge.
 *
 * The terminal tactic is a scenario parameter and it changes three things: it excludes the other
 * outcome's terminal line, it sets the obstacle count, and it grades the depth and therefore the
 * asset weighting.
 */
export const buildObstacles = (terminalTacticExternalId: string): Array<AttackRunObstacle> => {
  const obstacles: Array<AttackRunObstacle> = [];
  let state = EMPTY_ATTACKER_STATE;
  while (!isActionPlayable(state, terminalTacticExternalId)) {
    const playable = TACTIC_WALK_RULES.filter((rule) => rule.requires.every((fact) => state.has(fact)));
    const fact = playable.flatMap((rule) => rule.grants).find((granted) => !state.has(granted));
    if (fact === undefined) {
      throw newError('The walk table cannot reach the terminal tactic from the empty state', { terminalTacticExternalId });
    }
    const pooled = playable.filter((rule) => rule.grants.includes(fact));
    obstacles.push({
      key: fact,
      tacticExternalIds: pooled.map((rule) => rule.tacticExternalId),
      depth: Math.max(...pooled.map((rule) => tacticDepth(rule.tacticExternalId, terminalTacticExternalId))),
      resourceTouching: pooled.some((rule) => RESOURCE_TOUCHING_TACTIC_EXTERNAL_IDS.includes(rule.tacticExternalId)),
      stateBefore: state,
    });
    state = pooled.reduce((next, rule) => grantEffects(next, rule.tacticExternalId), state);
  }
  obstacles.push({
    key: terminalTacticExternalId,
    tacticExternalIds: [terminalTacticExternalId],
    depth: tacticDepth(terminalTacticExternalId, terminalTacticExternalId),
    resourceTouching: RESOURCE_TOUCHING_TACTIC_EXTERNAL_IDS.includes(terminalTacticExternalId),
    stateBefore: state,
  });
  return obstacles;
};

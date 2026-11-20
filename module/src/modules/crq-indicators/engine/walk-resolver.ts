import type { AttackerFact, WalkRule } from './attack-walk';
import { TACTIC_WALK_RULES, TECHNIQUE_WALK_EXCEPTIONS } from './attack-walk';

/** The facts the attacker currently holds. Immutable: granting facts returns a new state. */
export type AttackerState = ReadonlySet<AttackerFact>;

export const EMPTY_ATTACKER_STATE: AttackerState = new Set();

const RULE_BY_TACTIC = new Map(TACTIC_WALK_RULES.map((rule) => [rule.tacticExternalId, rule]));

const holdsAll = (state: AttackerState, facts: ReadonlyArray<AttackerFact>): boolean =>
  facts.every((fact) => state.has(fact));

/**
 * The rule governing one action: the technique's own exception when it carries one, its tactic's
 * row otherwise. Undefined for pre-compromise tactics, which are not steps of the walk.
 */
export const walkRuleFor = (tacticExternalId: string, techniqueExternalId?: string): WalkRule | undefined =>
  (techniqueExternalId !== undefined ? TECHNIQUE_WALK_EXCEPTIONS[techniqueExternalId] : undefined)
  ?? RULE_BY_TACTIC.get(tacticExternalId);

/** Exactly the tactics whose required facts are all held. */
export const playableTactics = (state: AttackerState): Array<string> => TACTIC_WALK_RULES
  .filter((rule) => holdsAll(state, rule.requires))
  .map((rule) => rule.tacticExternalId);

export const isActionPlayable = (state: AttackerState, tacticExternalId: string, techniqueExternalId?: string): boolean => {
  const rule = walkRuleFor(tacticExternalId, techniqueExternalId);
  return rule !== undefined && holdsAll(state, rule.requires);
};

/** The state after succeeding at the action, its granted facts added. */
export const grantEffects = (state: AttackerState, tacticExternalId: string, techniqueExternalId?: string): AttackerState => {
  const rule = walkRuleFor(tacticExternalId, techniqueExternalId);
  if (rule === undefined || rule.grants.length === 0) {
    return state;
  }
  return new Set([...state, ...rule.grants]);
};

/**
 * Whether an outcome's objective has been reached: its declared terminal tactic was successfully
 * played. The objective is granted there and only there; no fact accumulation reaches it.
 */
export const isObjectiveReached = (
  succeededTacticExternalIds: ReadonlyArray<string>,
  terminalTacticExternalId: string,
): boolean => succeededTacticExternalIds.includes(terminalTacticExternalId);

import type { AttackerFact } from './attack-walk';
import { TACTIC_WALK_RULES } from './attack-walk';

/**
 * Depth of a step, the `d` the asset weighting reads: 0 at the door, 1 at the objective.
 *
 * It is a property of the tactic, not of the attacker's state, so two runs reaching the same tactic
 * by different routes weigh the estate the same way. The grading is the walk table's own: a tactic
 * sits as deep as the number of facts it transitively costs, over what the scenario's terminal
 * tactic costs. Initial access costs nothing and lands on 0, the terminal costs everything and
 * lands on 1, and nothing in between needs a hand-written position.
 *
 * Technique-level exceptions stay out of the grading. T1078 is a door into initial access rather
 * than a deeper step, and letting it grant foothold here would charge every downstream tactic the
 * credentials it demands.
 */

const GRANTERS_BY_FACT = new Map<AttackerFact, Array<ReadonlyArray<AttackerFact>>>();
for (const rule of TACTIC_WALK_RULES) {
  for (const fact of rule.grants) {
    const granters = GRANTERS_BY_FACT.get(fact) ?? [];
    granters.push(rule.requires);
    GRANTERS_BY_FACT.set(fact, granters);
  }
}

/**
 * Cheapest set of facts to hold before each fact is reachable, itself included. Cheapest, because
 * several tactics grant the same fact and the attacker needs only one of them: charging a fact the
 * union of its routes would push every tactic below it deeper than the walk places it.
 *
 * Relaxed to a fixpoint rather than recursed, so that a route through a fact not yet costed is
 * simply skipped on this pass and picked up on the next. It settles because every pass that
 * changes anything either costs a fact for the first time or costs it lower.
 */
const cheapestClosureByFact = (): Map<AttackerFact, ReadonlySet<AttackerFact>> => {
  const closures = new Map<AttackerFact, ReadonlySet<AttackerFact>>();
  let settled = false;
  while (!settled) {
    settled = true;
    for (const [fact, granters] of GRANTERS_BY_FACT) {
      for (const requires of granters) {
        if (requires.some((required) => !closures.has(required))) {
          continue;
        }
        const candidate = new Set<AttackerFact>([fact]);
        for (const required of requires) {
          for (const held of closures.get(required) ?? []) {
            candidate.add(held);
          }
        }
        const current = closures.get(fact);
        if (current === undefined || candidate.size < current.size) {
          closures.set(fact, candidate);
          settled = false;
        }
      }
    }
  }
  return closures;
};

const CLOSURE_BY_FACT = cheapestClosureByFact();

const prerequisiteCost = (requires: ReadonlyArray<AttackerFact>): number => {
  const union = new Set<AttackerFact>();
  for (const fact of requires) {
    for (const held of CLOSURE_BY_FACT.get(fact) ?? [fact]) {
      union.add(held);
    }
  }
  return union.size;
};

const TACTIC_COST = new Map<string, number>(
  TACTIC_WALK_RULES.map((rule) => [rule.tacticExternalId, prerequisiteCost(rule.requires)]),
);

/** Facts a tactic transitively costs, the raw grading {@link tacticDepth} normalizes. */
export const tacticPrerequisiteCost = (tacticExternalId: string): number =>
  TACTIC_COST.get(tacticExternalId) ?? 0;

/**
 * Successful steps an attack run ending on this tactic cannot do without: one per fact on the cheapest
 * route, plus the terminal step itself. Five to reach an impact, six to reach an exfiltration.
 *
 * Derived rather than written down, because it is the chain length the eviction race divides: a
 * table edit that adds an obstacle has to move the remaining-time window with it, and a written
 * constant would leave the two out of step.
 */
export const minimalAttackRunSteps = (terminalTacticExternalId: string): number =>
  tacticPrerequisiteCost(terminalTacticExternalId) + 1;

/**
 * Depth of a step of `tacticExternalId` in a scenario ending on `terminalTacticExternalId`, in
 * [0, 1]. A tactic costing more than the terminal (impact, in a scenario ending on exfiltration) is
 * already as deep as that walk goes.
 */
export const tacticDepth = (tacticExternalId: string, terminalTacticExternalId: string): number => {
  const terminalCost = tacticPrerequisiteCost(terminalTacticExternalId);
  if (terminalCost === 0 || !TACTIC_COST.has(tacticExternalId)) {
    return 0;
  }
  return Math.min(tacticPrerequisiteCost(tacticExternalId) / terminalCost, 1);
};

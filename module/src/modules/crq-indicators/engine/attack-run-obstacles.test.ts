import { describe, expect, it } from 'vitest';
import { buildObstacles } from './attack-run-obstacles';
import { minimalAttackRunSteps } from './walk-depth';

/**
 * The chain the whole law is evaluated over, derived from the walk table alone. Every barrier, the
 * eviction race and the per-technique pass read this order and this grading, so an obstacle that
 * appears, disappears or changes depth here moves every euro the engine reports.
 */

describe('buildObstacles', () => {
  it('derives the impact chain from the walk table, five obstacles in the walk order', () => {
    expect(buildObstacles('TA0040').map((obstacle) => obstacle.key))
      .toEqual(['foothold', 'credentials', 'knowledge', 'deep_access', 'TA0040']);
  });

  it('derives the exfiltration chain, collection being the extra obstacle', () => {
    expect(buildObstacles('TA0010').map((obstacle) => obstacle.key))
      .toEqual(['foothold', 'credentials', 'knowledge', 'deep_access', 'gathered_data', 'TA0010']);
  });

  /*
   * The chain length divides the eviction race's remaining window, so the two derivations have to
   * agree: one counts the obstacles the walk yields, the other the facts the terminal transitively
   * costs. A walk-table edit that moves one and not the other shows up here.
   */
  it('yields as many obstacles as the terminal tactic transitively costs', () => {
    for (const terminal of ['TA0040', 'TA0010']) {
      expect(buildObstacles(terminal), terminal).toHaveLength(minimalAttackRunSteps(terminal));
    }
  });

  it('pools the tactics granting one fact into a single obstacle', () => {
    const credentials = buildObstacles('TA0040').find((obstacle) => obstacle.key === 'credentials');
    expect(credentials?.tacticExternalIds.toSorted()).toEqual(['TA0004', 'TA0006']);
  });

  it('grades the door at depth zero, the objective at depth one, and boosts only where the resource is touched', () => {
    const chain = buildObstacles('TA0040');
    expect(chain[0].depth).toBe(0);
    expect(chain[chain.length - 1].depth).toBe(1);
    expect(chain.filter((obstacle) => obstacle.resourceTouching).map((obstacle) => obstacle.key)).toEqual(['TA0040']);
  });
});

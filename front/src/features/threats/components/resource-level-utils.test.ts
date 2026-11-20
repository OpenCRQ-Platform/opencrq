import { describe, expect, it } from 'vitest';
import { RESOURCE_LEVELS, resourceLevelRank, toResourceLevel } from './resource-level-utils';

describe('resourceLevelRank', () => {
  it.each([
    ['individual', 1],
    ['club', 2],
    ['contest', 3],
    ['team', 4],
    ['organization', 5],
    ['government', 6],
  ])('ranks %s at %i', (value, rank) => {
    expect(resourceLevelRank(value)).toBe(rank);
  });

  it('reads a stored value whatever its case and surrounding spaces', () => {
    expect(resourceLevelRank('  Government ')).toBe(6);
  });

  it('has no rank for a value outside the six built-ins', () => {
    expect(resourceLevelRank('nation-state')).toBeNull();
  });

  it('has no rank for a missing value', () => {
    expect(resourceLevelRank(null)).toBeNull();
    expect(resourceLevelRank('')).toBeNull();
  });

  it('gives the six built-ins six distinct ranks', () => {
    expect(new Set(RESOURCE_LEVELS.map(resourceLevelRank)).size).toBe(6);
  });
});

describe('toResourceLevel', () => {
  it('normalizes a built-in', () => {
    expect(toResourceLevel('Team')).toBe('team');
  });

  it('returns null for an unknown value', () => {
    expect(toResourceLevel('unknown')).toBeNull();
  });
});

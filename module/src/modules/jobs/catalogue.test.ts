import { describe, expect, it } from 'vitest';
import { isDisplayedJobKind, JOB_CATALOGUE_ENTRIES, sharedSlotGroups } from './catalogue';

describe('isDisplayedJobKind', () => {
  it('accepts a catalogued kind', () => {
    expect(isDisplayedJobKind('crq-simulation')).toBe(true);
  });

  it('refuses the test-only noop kind and an uncatalogued one', () => {
    expect(isDisplayedJobKind('noop')).toBe(false);
    expect(isDisplayedJobKind('not-a-real-kind')).toBe(false);
  });
});

describe('sharedSlotGroups', () => {
  it('joins the kinds a declaration links, transitively, and leaves the others out', () => {
    expect(sharedSlotGroups([
      { kind: 'a', serializedWith: 'b' },
      { kind: 'c' },
      { kind: 'd', serializedWith: 'e' },
      { kind: 'e', serializedWith: 'b' },
    ])).toEqual([['a', 'b', 'd', 'e']]);
  });

  it('puts the price job in the slot of the simulation it must never run beside', () => {
    expect(sharedSlotGroups(JOB_CATALOGUE_ENTRIES)).toEqual([['crq-price-recompute', 'crq-simulation']]);
  });
});

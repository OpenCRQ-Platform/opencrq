import { describe, expect, it } from 'vitest';
import { isOtherAsker } from './askers';

describe('isOtherAsker', () => {
  const userRow = { triggeredBy: 'user', triggeredById: 'user-1' } as const;

  it('is false for the same user', () => {
    expect(isOtherAsker(userRow, { triggeredBy: 'user', triggeredById: 'user-1' })).toBe(false);
  });

  it('is true for another user', () => {
    expect(isOtherAsker(userRow, { triggeredBy: 'user', triggeredById: 'user-2' })).toBe(true);
  });

  it('is true for a connector carrying the same id string as the user', () => {
    expect(isOtherAsker(userRow, { triggeredBy: 'connector', triggeredById: 'user-1' })).toBe(true);
  });

  it('is true for a scheduler ask on a user row', () => {
    expect(isOtherAsker(userRow, { triggeredBy: 'scheduler' })).toBe(true);
  });

  it('is false for an ask with no trigger on a system row with no id', () => {
    expect(isOtherAsker({ triggeredBy: 'system', triggeredById: null }, {})).toBe(false);
  });
});

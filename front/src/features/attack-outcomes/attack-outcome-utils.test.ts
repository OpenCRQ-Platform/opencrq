import { describe, expect, it } from 'vitest';
import { computeLossDriverShares } from './attack-outcome-utils';

describe('computeLossDriverShares', () => {
  it('computes each driver share against the split total, preserving the given order', () => {
    const shares = computeLossDriverShares([
      { driverId: 'id-b', driver: 'b', amount: 300 },
      { driverId: 'id-a', driver: 'a', amount: 100 },
    ]);
    expect(shares).toEqual([
      { driverId: 'id-b', driver: 'b', amount: 300, share: 0.75 },
      { driverId: 'id-a', driver: 'a', amount: 100, share: 0.25 },
    ]);
  });

  it('returns a zero share when the total is zero', () => {
    const shares = computeLossDriverShares([{ driverId: 'id-a', driver: 'a', amount: 0 }]);
    expect(shares).toEqual([{ driverId: 'id-a', driver: 'a', amount: 0, share: 0 }]);
  });
});

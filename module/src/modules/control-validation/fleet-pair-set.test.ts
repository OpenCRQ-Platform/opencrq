import { describe, expect, it } from 'vitest';
import { fleetPairSet } from './fleet-pair-set';

const families = (count: number): Array<string> => Array.from({ length: count }, (_, index) => `FAMILY_${index}`);

describe('fleet pair set', () => {
  it('reads a set back in family order, then expectation type order', () => {
    const { pairsIn } = fleetPairSet(['EDR', 'XDR']);

    expect(pairsIn('5')).toEqual([
      { platformTypeKey: 'EDR', expectationType: 'detection' },
      { platformTypeKey: 'XDR', expectationType: 'detection' },
    ]);
    expect(pairsIn('10')).toEqual([
      { platformTypeKey: 'EDR', expectationType: 'prevention' },
      { platformTypeKey: 'XDR', expectationType: 'prevention' },
    ]);
    expect(pairsIn('0')).toEqual([]);
  });

  it('reads the last pair of the largest set past what a JavaScript number holds exactly', () => {
    const { pairsIn } = fleetPairSet(families(31));

    expect(pairsIn((1n << 61n).toString())).toEqual([{ platformTypeKey: 'FAMILY_30', expectationType: 'prevention' }]);
  });

  it('refuses more pairs than a bigint holds bits besides its sign', () => {
    expect(() => fleetPairSet(families(32))).toThrow('A fleet pair set holds at most 63 pairs');
  });
});

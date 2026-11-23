import { describe, expect, it } from 'vitest';
import { fingerprintOf } from './run-fingerprint';

describe('fingerprintOf', () => {
  it('answers the same digest for the same value built in another key order', () => {
    expect(fingerprintOf({ tef: { min: 1, max: 4 }, worlds: 50 }))
      .toBe(fingerprintOf({ worlds: 50, tef: { max: 4, min: 1 } }));
  });

  it('tells apart a change in the last bit of a number', () => {
    expect(fingerprintOf({ share: 0.1 + 0.2 })).not.toBe(fingerprintOf({ share: 0.3 }));
  });

  it('tells apart values whose text alone would collide', () => {
    expect(fingerprintOf(['1'])).not.toBe(fingerprintOf([1]));
    expect(fingerprintOf(['a', 'bc'])).not.toBe(fingerprintOf(['ab', 'c']));
    expect(fingerprintOf({ plan: null })).not.toBe(fingerprintOf({ plan: undefined }));
  });

  it('reads the content of a map and a set, not only their size', () => {
    expect(fingerprintOf(new Map([['T1566', 'p-1']]))).not.toBe(fingerprintOf(new Map([['T1566', 'p-2']])));
    expect(fingerprintOf(new Set(['T1566']))).not.toBe(fingerprintOf(new Set(['T1190'])));
  });

  it('answers the same digest for a map or a set filled in another order', () => {
    expect(fingerprintOf(new Map([['T1566', 'p-1'], ['T1190', 'p-2']])))
      .toBe(fingerprintOf(new Map([['T1190', 'p-2'], ['T1566', 'p-1']])));
    expect(fingerprintOf(new Set(['T1566', 'T1190']))).toBe(fingerprintOf(new Set(['T1190', 'T1566'])));
  });

  it('keeps a map key bound to its own value', () => {
    expect(fingerprintOf(new Map([['T1566', 'p-1'], ['T1190', 'p-2']])))
      .not.toBe(fingerprintOf(new Map([['T1566', 'p-2'], ['T1190', 'p-1']])));
  });

  it('keeps the order of an array, which the engine may sum in', () => {
    expect(fingerprintOf([1, 2])).not.toBe(fingerprintOf([2, 1]));
  });

  it('refuses a value it cannot read, rather than hashing it as nothing', () => {
    expect(() => fingerprintOf({ draw: () => 1 })).toThrow('A value cannot be fingerprinted');
  });
});

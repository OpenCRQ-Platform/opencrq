import { describe, expect, it } from 'vitest';
import { fingerprintRunInputs } from './run-fingerprint';

describe('fingerprintRunInputs', () => {
  it('answers the same digest for the same value built in another key order', () => {
    expect(fingerprintRunInputs({ tef: { min: 1, max: 4 }, worlds: 50 }))
      .toBe(fingerprintRunInputs({ worlds: 50, tef: { max: 4, min: 1 } }));
  });

  it('tells apart a change in the last bit of a number', () => {
    expect(fingerprintRunInputs({ share: 0.1 + 0.2 })).not.toBe(fingerprintRunInputs({ share: 0.3 }));
  });

  it('tells apart values whose text alone would collide', () => {
    expect(fingerprintRunInputs(['1'])).not.toBe(fingerprintRunInputs([1]));
    expect(fingerprintRunInputs(['a', 'bc'])).not.toBe(fingerprintRunInputs(['ab', 'c']));
    expect(fingerprintRunInputs({ plan: null })).not.toBe(fingerprintRunInputs({ plan: undefined }));
  });

  it('reads the content of a map and a set, not only their size', () => {
    expect(fingerprintRunInputs(new Map([['T1566', 'p-1']]))).not.toBe(fingerprintRunInputs(new Map([['T1566', 'p-2']])));
    expect(fingerprintRunInputs(new Set(['T1566']))).not.toBe(fingerprintRunInputs(new Set(['T1190'])));
  });

  it('answers the same digest for a map or a set filled in another order', () => {
    expect(fingerprintRunInputs(new Map([['T1566', 'p-1'], ['T1190', 'p-2']])))
      .toBe(fingerprintRunInputs(new Map([['T1190', 'p-2'], ['T1566', 'p-1']])));
    expect(fingerprintRunInputs(new Set(['T1566', 'T1190']))).toBe(fingerprintRunInputs(new Set(['T1190', 'T1566'])));
  });

  it('keeps a map key bound to its own value', () => {
    expect(fingerprintRunInputs(new Map([['T1566', 'p-1'], ['T1190', 'p-2']])))
      .not.toBe(fingerprintRunInputs(new Map([['T1566', 'p-2'], ['T1190', 'p-1']])));
  });

  it('keeps the order of an array, which the engine may sum in', () => {
    expect(fingerprintRunInputs([1, 2])).not.toBe(fingerprintRunInputs([2, 1]));
  });

  it('refuses a value it cannot read, rather than hashing it as nothing', () => {
    expect(() => fingerprintRunInputs({ draw: () => 1 })).toThrow('A run input cannot be fingerprinted');
  });
});

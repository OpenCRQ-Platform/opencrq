import { describe, expect, it } from 'vitest';
import { isHiddenThreat, threatNotFoundData } from './hidden-threat-utils';

describe('threatNotFoundData', () => {
  it('should carry the answer of the hidden lookup', async () => {
    expect(await threatNotFoundData(() => Promise.resolve(true))).toEqual({ hidden: true });
    expect(await threatNotFoundData(() => Promise.resolve(false))).toEqual({ hidden: false });
  });

  it('should fall back to not hidden when the lookup fails, so the reader still gets "not found"', async () => {
    expect(await threatNotFoundData(() => Promise.reject(new Error('network')))).toEqual({ hidden: false });
  });
});

describe('isHiddenThreat', () => {
  it('should be true only for data saying the threat is hidden', () => {
    expect(isHiddenThreat({ hidden: true })).toBe(true);
    expect(isHiddenThreat({ hidden: false })).toBe(false);
    expect(isHiddenThreat(undefined)).toBe(false);
    expect(isHiddenThreat(null)).toBe(false);
    expect(isHiddenThreat({ hidden: 'true' })).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { exposureIsNotApplicable } from './exposure-utils';

describe('exposureIsNotApplicable', () => {
  it('reads an identity with no exposure as not applicable', () => {
    expect(exposureIsNotApplicable('identity', 'unknown')).toBe(true);
  });

  it('keeps an exposure someone set on an identity', () => {
    expect(exposureIsNotApplicable('identity', 'internet_facing')).toBe(false);
  });

  it('keeps unknown as unknown on every other category', () => {
    expect(exposureIsNotApplicable('host', 'unknown')).toBe(false);
  });
});

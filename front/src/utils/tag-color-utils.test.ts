import { describe, expect, it } from 'vitest';
import { tagColorHex } from './tag-color-utils';

describe('tagColorHex', () => {
  it('returns a 6-digit hex colour', () => {
    expect(tagColorHex('production')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('is stable for the same name', () => {
    expect(tagColorHex('production')).toBe(tagColorHex('production'));
  });

  it('gives different names different colours', () => {
    expect(tagColorHex('production')).not.toBe(tagColorHex('staging'));
  });
});

import { describe, expect, it } from 'vitest';
import { resolveDisplayCategory, TECHNIQUE_CATEGORY_STYLE } from './technique-category';

describe('resolveDisplayCategory', () => {
  it('overrides the curated category to revoked when the technique is revoked', () => {
    expect(resolveDisplayCategory({ category: 'signature', revoked: true })).toBe('revoked');
    expect(resolveDisplayCategory({ category: 'related', revoked: true })).toBe('revoked');
  });

  it('keeps the curated category when the technique is not revoked', () => {
    expect(resolveDisplayCategory({ category: 'signature', revoked: false })).toBe('signature');
    expect(resolveDisplayCategory({ category: 'related', revoked: false })).toBe('related');
    expect(resolveDisplayCategory({ category: 'inferred', revoked: false })).toBe('inferred');
  });
});

describe('TECHNIQUE_CATEGORY_STYLE', () => {
  it('pins each category to its severity and highlight color', () => {
    expect(TECHNIQUE_CATEGORY_STYLE).toEqual({
      signature: { severity: 'info', highlight: 'blue' },
      related: { severity: 'low', highlight: 'green' },
      inferred: { severity: 'high', highlight: 'orange' },
      revoked: { severity: 'critical', highlight: 'red' },
    });
  });
});

import { describe, expect, it } from 'vitest';
import { manualValuesInEffect } from './manual-values-utils';

describe('manualValuesInEffect', () => {
  it('keeps a pinned subcategory the asset still reads', () => {
    expect(manualValuesInEffect([{ attribute: 'subcategory', value: 'laptop' }], 'laptop')).toHaveLength(1);
  });

  it('drops a dormant one, the category having moved away from it', () => {
    expect(manualValuesInEffect([{ attribute: 'subcategory', value: 'laptop' }], null)).toEqual([]);
  });

  it('leaves every other attribute alone', () => {
    const values = [{ attribute: 'criticality' as const, value: 'high' }, { attribute: 'name' as const, value: 'x' }];
    expect(manualValuesInEffect(values, null)).toEqual(values);
  });
});

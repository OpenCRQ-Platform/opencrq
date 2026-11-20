import { describe, expect, it } from 'vitest';
import { isPerimeterEmpty } from './perimeter-empty-card-utils';

describe('isPerimeterEmpty', () => {
  it('is false while the organization list is not loaded yet', () => {
    expect(isPerimeterEmpty(undefined)).toBe(false);
  });

  it('is true for a loaded empty list', () => {
    expect(isPerimeterEmpty([])).toBe(true);
  });

  it('is false once the tenant holds an organization', () => {
    expect(isPerimeterEmpty([{ id: 'org-1' }])).toBe(false);
  });
});

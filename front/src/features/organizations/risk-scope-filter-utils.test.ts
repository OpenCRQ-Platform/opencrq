import { describe, expect, it } from 'vitest';
import { filterByRiskScope } from './risk-scope-filter-utils';

const rows = [{ id: 'a', organizationId: 'europe' }, { id: 'b', organizationId: 'retail' }, { id: 'c', organizationId: 'europe' }];

describe('filterByRiskScope', () => {
  it('keeps every row for all scopes', () => {
    expect(filterByRiskScope(rows, 'all')).toEqual(rows);
  });

  it('keeps the rows of the chosen scope only', () => {
    expect(filterByRiskScope(rows, 'europe').map((row) => row.id)).toEqual(['a', 'c']);
  });
});

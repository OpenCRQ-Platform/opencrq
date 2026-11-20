import { describe, expect, it } from 'vitest';
import { resolveOptionFilter } from './option-filter-utils';

describe('resolveOptionFilter', () => {
  it('should keep the fallback untouched regardless of the available values', () => {
    expect(resolveOptionFilter('all', undefined, 'all')).toBe('all');
    expect(resolveOptionFilter('all', [], 'all')).toBe('all');
    expect(resolveOptionFilter('all', ['drata'], 'all')).toBe('all');
  });

  it('should keep a non-default value while the available values are not yet known', () => {
    // The options query is still pending (`undefined`), not empty on purpose: the value must not
    // be dropped before the tenant's real options have had a chance to confirm it.
    expect(resolveOptionFilter('drata', undefined, 'all')).toBe('drata');
  });

  it('should fall back once the available values are known and do not include the value', () => {
    expect(resolveOptionFilter('drata', [], 'all')).toBe('all');
    expect(resolveOptionFilter('drata', ['crowdstrike'], 'all')).toBe('all');
  });

  it('should keep a value that is among the known available values', () => {
    expect(resolveOptionFilter('drata', ['drata', 'crowdstrike'], 'all')).toBe('drata');
  });
});

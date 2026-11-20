import { describe, expect, it } from 'vitest';
import { scopePath } from './scope-path-utils';

describe('scopePath', () => {
  it('builds the tenant scope', () => {
    expect(scopePath('tenant-1', undefined, 'findings')).toBe('/tenant-1/findings');
    expect(scopePath('tenant-1', undefined, '')).toBe('/tenant-1');
  });

  it('builds the organization scope', () => {
    expect(scopePath('tenant-1', 'org-1', 'findings')).toBe('/tenant-1/org-1/findings');
    expect(scopePath('tenant-1', 'org-1', '')).toBe('/tenant-1/org-1');
  });
});

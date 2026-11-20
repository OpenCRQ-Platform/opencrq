import { describe, expect, it } from 'vitest';
import { sourceAuthorityRank } from './source-authority';

describe('sourceAuthorityRank', () => {
  it('ranks microsoft_graph above openaev', () => {
    expect(sourceAuthorityRank('microsoft_graph')).toBeLessThan(sourceAuthorityRank('openaev'));
  });
  it('ranks any unlisted source last, including null', () => {
    expect(sourceAuthorityRank('openaev')).toBeLessThan(sourceAuthorityRank('drata'));
    expect(sourceAuthorityRank('drata')).toBe(sourceAuthorityRank(null));
  });
  it('ranks a manual observation ahead of every connector, whatever its authority', () => {
    expect(sourceAuthorityRank(null, 'user')).toBeLessThan(sourceAuthorityRank('microsoft_graph'));
  });
});

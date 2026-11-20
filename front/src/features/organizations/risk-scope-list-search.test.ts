import { describe, expect, it } from 'vitest';
import { riskScopeListSearchSchema } from './risk-scope-list-search';

describe('riskScopeListSearchSchema', () => {
  it('lists every scope when the address names none', () => {
    expect(riskScopeListSearchSchema.parse({})).toEqual({ riskScope: 'all' });
  });

  it('keeps a scope id', () => {
    expect(riskScopeListSearchSchema.parse({ riskScope: '0199a0b4-6a2e-7c1d-9f3e-5b8a2c4d6e10' }))
      .toEqual({ riskScope: '0199a0b4-6a2e-7c1d-9f3e-5b8a2c4d6e10' });
  });

  it('lists every scope for a value that cannot name one', () => {
    expect(riskScopeListSearchSchema.parse({ riskScope: 'acme' })).toEqual({ riskScope: 'all' });
  });
});

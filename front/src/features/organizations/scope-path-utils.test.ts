import { describe, expect, it } from 'vitest';
import { riskScopeHref } from './scope-path-utils';

const TENANT = '0199e2a0-0000-7000-8000-000000000001';
const SCOPE_A = '0199e2a0-0000-7000-8000-00000000000a';
const SCOPE_B = '0199e2a0-0000-7000-8000-00000000000b';

const at = (pathname: string, searchStr = '', hash = '') => ({ pathname, searchStr, hash });

describe('riskScopeHref', () => {
  it('should replace the scope and keep the tab', () => {
    expect(riskScopeHref(at(`/${TENANT}/${SCOPE_A}/primary-assets/p1/dependencies`), TENANT, SCOPE_A, SCOPE_B))
      .toBe(`/${TENANT}/${SCOPE_B}/primary-assets/p1/dependencies`);
  });

  it('should insert the scope on a tenant address', () => {
    expect(riskScopeHref(at(`/${TENANT}/risk-scenarios/s1/crq`), TENANT, undefined, SCOPE_B))
      .toBe(`/${TENANT}/${SCOPE_B}/risk-scenarios/s1/crq`);
  });

  it('should keep the search and the hash', () => {
    expect(riskScopeHref(at(`/${TENANT}/${SCOPE_A}/risk-scenarios/s1/findings`, '?page=2', 'top'), TENANT, SCOPE_A, SCOPE_B))
      .toBe(`/${TENANT}/${SCOPE_B}/risk-scenarios/s1/findings?page=2#top`);
  });

  it('should leave an entity id that equals the scope id untouched', () => {
    expect(riskScopeHref(at(`/${TENANT}/${SCOPE_A}/primary-assets/${SCOPE_A}`), TENANT, SCOPE_A, SCOPE_B))
      .toBe(`/${TENANT}/${SCOPE_B}/primary-assets/${SCOPE_A}`);
  });
});

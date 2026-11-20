import { describe, expect, it } from 'vitest';
import { canonicalExternalIdHref } from './external-id-path-utils';

const TENANT = '/0199e2a0-0000-7000-8000-000000000001';

const at = (pathname: string, searchStr = '', hash = '') => ({ pathname, searchStr, hash });

describe('canonicalExternalIdHref', () => {
  it('should return null when the identifier is already uppercase', () => {
    expect(canonicalExternalIdHref(at(`${TENANT}/settings/taxonomies/mitre-attack/techniques/T1003.001/overview`), 'T1003.001')).toBeNull();
  });

  it('should uppercase a sub-technique and keep the tab it was opened on', () => {
    expect(canonicalExternalIdHref(at(`${TENANT}/settings/taxonomies/mitre-attack/techniques/t1003.001/coverage`), 't1003.001'))
      .toBe(`${TENANT}/settings/taxonomies/mitre-attack/techniques/T1003.001/coverage`);
  });

  it('should uppercase a tactic at the end of the path', () => {
    expect(canonicalExternalIdHref(at(`${TENANT}/settings/taxonomies/mitre-attack/tactics/ta0006`), 'ta0006'))
      .toBe(`${TENANT}/settings/taxonomies/mitre-attack/tactics/TA0006`);
  });

  it('should uppercase a mixed-case identifier', () => {
    expect(canonicalExternalIdHref(at(`${TENANT}/settings/taxonomies/mitre-attack/tactics/Ta0006`), 'Ta0006'))
      .toBe(`${TENANT}/settings/taxonomies/mitre-attack/tactics/TA0006`);
  });

  it('should keep the search and the hash', () => {
    expect(canonicalExternalIdHref(at(`${TENANT}/settings/taxonomies/mitre-attack/techniques/t1059/assets`, '?page=2', 'top'), 't1059'))
      .toBe(`${TENANT}/settings/taxonomies/mitre-attack/techniques/T1059/assets?page=2#top`);
  });

  it('should leave the tenant segment untouched', () => {
    const tenant = '/0199e2a0-0000-7000-8000-00000000abcd';
    expect(canonicalExternalIdHref(at(`${tenant}/settings/taxonomies/mitre-attack/tactics/ta0001`), 'ta0001'))
      .toBe(`${tenant}/settings/taxonomies/mitre-attack/tactics/TA0001`);
  });

  it('should return null when the identifier is not a segment of the path', () => {
    expect(canonicalExternalIdHref(at(`${TENANT}/settings/taxonomies/mitre-attack/tactics`), 'ta0001')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import {
  canonicalLinkRoles,
  combineInheritedCriteria,
  inheritedCriteriaOfRoles,
  isStorableLinkRoleSet,
  LINK_ROLE_INHERITANCE,
} from './link-roles';

describe('inheritedCriteriaOfRoles', () => {
  it('should give one role its row of the matrix', () => {
    expect(inheritedCriteriaOfRoles(['reads'])).toEqual({
      availability: 'lower', integrity: 'lower', confidentiality: 'full', traceability: 'none',
    });
  });

  it('should take the strongest per criterion across roles', () => {
    expect(inheritedCriteriaOfRoles(['monitors', 'supports_availability'])).toEqual({
      availability: 'full', integrity: 'none', confidentiality: 'lower', traceability: 'full',
    });
  });

  it('should let unknown inherit every criterion in full', () => {
    expect(inheritedCriteriaOfRoles(['unknown'])).toEqual({
      availability: 'full', integrity: 'full', confidentiality: 'full', traceability: 'full',
    });
  });

  it('should inherit nothing from no role', () => {
    expect(inheritedCriteriaOfRoles([])).toEqual({
      availability: 'none', integrity: 'none', confidentiality: 'none', traceability: 'none',
    });
  });
});

describe('combineInheritedCriteria', () => {
  it('should take the strongest per criterion across links', () => {
    expect(combineInheritedCriteria([LINK_ROLE_INHERITANCE.reads, LINK_ROLE_INHERITANCE.performs])).toEqual({
      availability: 'full', integrity: 'full', confidentiality: 'full', traceability: 'lower',
    });
  });
});

describe('isStorableLinkRoleSet', () => {
  it('should accept several known roles', () => {
    expect(isStorableLinkRoleSet(['stores', 'processes'])).toBe(true);
  });

  it('should accept unknown alone', () => {
    expect(isStorableLinkRoleSet(['unknown'])).toBe(true);
  });

  it('should refuse unknown beside another role', () => {
    expect(isStorableLinkRoleSet(['unknown', 'stores'])).toBe(false);
  });

  it('should refuse no role', () => {
    expect(isStorableLinkRoleSet([])).toBe(false);
  });
});

describe('canonicalLinkRoles', () => {
  it('should drop duplicates and follow the list order', () => {
    expect(canonicalLinkRoles(['transmits', 'stores', 'transmits'])).toEqual(['stores', 'transmits']);
  });
});

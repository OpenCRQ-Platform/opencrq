import { describe, expect, it } from 'vitest';
import { isEvidenceStateFilter, matchesEvidenceStateFilter, resolveEvidenceState } from './evidence-state-utils';

describe('isEvidenceStateFilter', () => {
  it('should accept the three filter values', () => {
    expect(isEvidenceStateFilter('all')).toBe(true);
    expect(isEvidenceStateFilter('applicable')).toBe(true);
    expect(isEvidenceStateFilter('dismissed')).toBe(true);
  });

  it('should reject anything else', () => {
    expect(isEvidenceStateFilter('APPLICABLE')).toBe(false);
    expect(isEvidenceStateFilter('')).toBe(false);
  });
});

describe('resolveEvidenceState', () => {
  it('should read a missing state as applicable', () => {
    expect(resolveEvidenceState(null)).toBe('applicable');
    expect(resolveEvidenceState(undefined)).toBe('applicable');
  });

  it('should return the state it was given', () => {
    expect(resolveEvidenceState('dismissed')).toBe('dismissed');
  });
});

describe('matchesEvidenceStateFilter', () => {
  it('should let everything through on all', () => {
    expect(matchesEvidenceStateFilter('dismissed', 'all')).toBe(true);
    expect(matchesEvidenceStateFilter('applicable', 'all')).toBe(true);
    expect(matchesEvidenceStateFilter(null, 'all')).toBe(true);
  });

  it('should keep only the state asked for', () => {
    expect(matchesEvidenceStateFilter('applicable', 'applicable')).toBe(true);
    expect(matchesEvidenceStateFilter('dismissed', 'applicable')).toBe(false);
    expect(matchesEvidenceStateFilter('dismissed', 'dismissed')).toBe(true);
  });

  it('should count a stateless finding as applicable', () => {
    expect(matchesEvidenceStateFilter(null, 'applicable')).toBe(true);
    expect(matchesEvidenceStateFilter(null, 'dismissed')).toBe(false);
  });
});

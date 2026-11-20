import { describe, expect, it } from 'vitest';
import { getCvssSeverityLevel } from './cvss-severity';

describe('getCvssSeverityLevel', () => {
  it('should return null for a null score', () => {
    expect(getCvssSeverityLevel(null)).toBeNull();
  });

  it('should classify critical scores', () => {
    expect(getCvssSeverityLevel(9.0)).toBe('critical');
    expect(getCvssSeverityLevel(10)).toBe('critical');
  });

  it('should classify high scores', () => {
    expect(getCvssSeverityLevel(8.9)).toBe('high');
    expect(getCvssSeverityLevel(7.0)).toBe('high');
  });

  it('should classify medium scores', () => {
    expect(getCvssSeverityLevel(6.9)).toBe('medium');
    expect(getCvssSeverityLevel(4.0)).toBe('medium');
  });

  it('should classify low scores', () => {
    expect(getCvssSeverityLevel(3.9)).toBe('low');
    expect(getCvssSeverityLevel(0.1)).toBe('low');
  });

  it('should classify a 0.0 score as none, not low', () => {
    expect(getCvssSeverityLevel(0)).toBe('none');
    expect(getCvssSeverityLevel(0.09)).toBe('none');
  });

  it('should return null for scores outside the CVSS range', () => {
    expect(getCvssSeverityLevel(-1)).toBeNull();
    expect(getCvssSeverityLevel(10.1)).toBeNull();
    expect(getCvssSeverityLevel(Number.NaN)).toBeNull();
  });
});

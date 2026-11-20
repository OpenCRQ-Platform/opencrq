import { describe, expect, it } from 'vitest';
import { findReservedProcessNameCollision } from './process-profile';

describe('findReservedProcessNameCollision', () => {
  it('reports the collision when a process is named after the reserved name', () => {
    expect(findReservedProcessNameCollision(['api', 'pm', 'worker'], 'pm')).toBe('pm');
  });

  it('reports no collision when the reserved name is absent', () => {
    expect(findReservedProcessNameCollision(['api', 'worker'], 'pm')).toBeUndefined();
  });

  it('is exact and case-sensitive: a differently-cased name is not a collision', () => {
    expect(findReservedProcessNameCollision(['PM', 'worker'], 'pm')).toBeUndefined();
  });

  it('compares against the name the caller actually runs under, not the default one', () => {
    expect(findReservedProcessNameCollision(['api', 'supervisor'], 'supervisor')).toBe('supervisor');
  });
});

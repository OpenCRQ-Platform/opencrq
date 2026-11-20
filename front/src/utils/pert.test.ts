import { describe, expect, it } from 'vitest';
import { computePert } from './pert';

describe('computePert', () => {
  it('should compute PERT expected value', () => {
    expect(computePert(100, 200, 600)).toBe(250);
  });

  it('should handle equal values', () => {
    expect(computePert(100, 100, 100)).toBe(100);
  });

  it('should handle zero values', () => {
    expect(computePert(0, 0, 0)).toBe(0);
  });
});

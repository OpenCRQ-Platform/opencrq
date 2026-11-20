import { describe, expect, it } from 'vitest';
import { reconcileColumnOrder } from './use-table-column-ordering';

describe('reconcileColumnOrder', () => {
  it('should return current columns when saved order matches', () => {
    expect(reconcileColumnOrder(['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('should preserve saved order for existing columns', () => {
    expect(reconcileColumnOrder(['c', 'a', 'b'], ['a', 'b', 'c'])).toEqual(['c', 'a', 'b']);
  });

  it('should remove stale columns from saved order', () => {
    expect(reconcileColumnOrder(['a', 'removed', 'b'], ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('should append new columns defined last at the end', () => {
    expect(reconcileColumnOrder(['a', 'b'], ['a', 'b', 'c', 'd'])).toEqual(['a', 'b', 'c', 'd']);
  });

  it('should insert a new column right after the column defined before it', () => {
    expect(reconcileColumnOrder(['id', 'efficacy', 'actions'], ['id', 'efficacy', 'explanation', 'actions']))
      .toEqual(['id', 'efficacy', 'explanation', 'actions']);
  });

  it('should follow a moved predecessor', () => {
    expect(reconcileColumnOrder(['efficacy', 'id', 'actions'], ['id', 'efficacy', 'explanation', 'actions']))
      .toEqual(['efficacy', 'explanation', 'id', 'actions']);
  });

  it('should insert a new first column at the start', () => {
    expect(reconcileColumnOrder(['b', 'a'], ['new', 'a', 'b'])).toEqual(['new', 'b', 'a']);
  });

  it('should handle empty saved order', () => {
    expect(reconcileColumnOrder([], ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('should handle completely different columns', () => {
    expect(reconcileColumnOrder(['x', 'y'], ['a', 'b'])).toEqual(['a', 'b']);
  });

  it('should handle combined add and remove', () => {
    expect(reconcileColumnOrder(['b', 'removed', 'a'], ['a', 'b', 'new'])).toEqual(['b', 'new', 'a']);
  });
});

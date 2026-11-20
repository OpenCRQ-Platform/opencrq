import { describe, expect, it } from 'vitest';
import { resolveAssetsEmptyState } from './assets-empty-state-utils';

const args = (overrides: Partial<Parameters<typeof resolveAssetsEmptyState>[0]> = {}) => ({
  total: 0,
  search: '',
  source: 'all',
  category: 'all',
  estateMode: undefined,
  estateTotal: undefined,
  ...overrides,
});

describe('resolveAssetsEmptyState', () => {
  it('should show nothing while the list holds rows', () => {
    expect(resolveAssetsEmptyState(args({ total: 12 }))).toBeNull();
  });

  it('should say no result when a search matched nothing', () => {
    expect(resolveAssetsEmptyState(args({ search: 'router' }))).toBe('no-results');
  });

  it('should say no result when a source filter matched nothing', () => {
    expect(resolveAssetsEmptyState(args({ source: 'crowdstrike' }))).toBe('no-results');
  });

  it('should say no result when a category filter matched nothing', () => {
    expect(resolveAssetsEmptyState(args({ category: 'identity' }))).toBe('no-results');
  });

  it('should say no result when a group filter matched nothing', () => {
    expect(resolveAssetsEmptyState(args({ group: '0190f2b4-6c1e-7a3b-8d4f-2e5a6b7c8d9e' }))).toBe('no-results');
  });

  it('should say no result in a closed scope too, before its estate is known', () => {
    expect(resolveAssetsEmptyState(args({ search: 'router', estateMode: 'closed' }))).toBe('no-results');
  });

  it('should read whitespace as no search at all', () => {
    expect(resolveAssetsEmptyState(args({ search: '   ' }))).toBe('estate-empty');
  });

  it('should send a closed scope with nothing mapped to the mapping, not to a connector', () => {
    expect(resolveAssetsEmptyState(args({ estateMode: 'closed', estateTotal: 42 }))).toBe('scope-unmapped');
  });

  it('should not offer to map an estate that holds no asset either', () => {
    expect(resolveAssetsEmptyState(args({ estateMode: 'closed', estateTotal: 0 }))).toBe('estate-empty');
  });

  it('should hold both cards back while the estate is unknown', () => {
    expect(resolveAssetsEmptyState(args({ estateMode: 'closed' }))).toBeNull();
  });

  it('should treat an open scope as the estate it spans', () => {
    expect(resolveAssetsEmptyState(args({ estateMode: 'open' }))).toBe('estate-empty');
  });
});

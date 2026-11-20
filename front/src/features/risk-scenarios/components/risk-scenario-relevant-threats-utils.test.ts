import { describe, expect, it } from 'vitest';
import { resolveRelevantThreatsEmptyState } from './risk-scenario-relevant-threats-utils';

describe('resolveRelevantThreatsEmptyState', () => {
  it('should show no empty state at all when the scenario matched something', () => {
    expect(resolveRelevantThreatsEmptyState({ itemCount: 1, hasAnyAnalyses: true })).toBeNull();
  });

  it('should distinguish an empty catalog from a catalog that simply matched nothing', () => {
    expect(resolveRelevantThreatsEmptyState({ itemCount: 0, hasAnyAnalyses: false })).toBe('no-analyses');
    expect(resolveRelevantThreatsEmptyState({ itemCount: 0, hasAnyAnalyses: true })).toBe('no-matches');
  });
});

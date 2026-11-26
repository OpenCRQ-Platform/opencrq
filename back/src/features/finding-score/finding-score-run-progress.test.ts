import { describe, expect, it } from 'vitest';
import { findingScoreRunProgress } from './finding-score-run-progress';

describe('findingScoreRunProgress', () => {
  it('should report the walk as processed and expected totals', () => {
    const progress = findingScoreRunProgress({ scored: 42, changedFindings: 0, changedPostures: 0, changedUniqueFindings: 0, changedCount: 0 });
    expect(progress.processedTotal).toBe(42);
    expect(progress.expectedTotal).toBe(42);
  });

  it('should say a run that moved nothing changed nothing', () => {
    const progress = findingScoreRunProgress({ scored: 42, changedFindings: 0, changedPostures: 0, changedUniqueFindings: 0, changedCount: 0 });
    expect(JSON.parse(progress.message)).toMatchObject({ changedCount: 0 });
  });

  it('should carry what moved, by kind', () => {
    const summary = { scored: 10, changedFindings: 3, changedPostures: 1, changedUniqueFindings: 2, changedCount: 6 };
    expect(JSON.parse(findingScoreRunProgress(summary).message)).toEqual(summary);
  });
});

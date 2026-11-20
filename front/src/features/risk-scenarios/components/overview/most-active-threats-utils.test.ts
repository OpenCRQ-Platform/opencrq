import { describe, expect, it } from 'vitest';
import { MAX_MOST_ACTIVE_THREATS, rankMostActiveThreats } from './most-active-threats-utils';

const threat = (id: string, activityScore: number | null, combinedRelevance = 0.5) => ({ id, activityScore, combinedRelevance });

describe('rankMostActiveThreats', () => {
  it('should rank the most active threat first', () => {
    const ranked = rankMostActiveThreats([threat('quiet', 0.1), threat('loud', 0.9), threat('middle', 0.5)]);

    expect(ranked.map((row) => row.id)).toEqual(['loud', 'middle', 'quiet']);
  });

  it('should leave out a threat whose activity is unknown, however relevant it is', () => {
    const ranked = rankMostActiveThreats([threat('unknown', null, 1), threat('known-zero', 0, 0.01), threat('known', 0.0001, 0.01)]);

    expect(ranked.map((row) => row.id)).toEqual(['known', 'known-zero']);
  });

  it('should separate equal activities by relevance', () => {
    const ranked = rankMostActiveThreats([
      threat('low', 0.5, 0.2),
      threat('high', 0.5, 0.9),
      threat('unknown-high', null, 0.8),
    ]);

    expect(ranked.map((row) => row.id)).toEqual(['high', 'low']);
  });

  it('should keep at most six dated threats', () => {
    const dated = Array.from({ length: MAX_MOST_ACTIVE_THREATS + 2 }, (_, index) => threat(`dated-${index}`, 0.9 - index / 20));

    expect(rankMostActiveThreats([threat('unknown', null, 1), ...dated]).map((row) => row.id))
      .toEqual(dated.slice(0, MAX_MOST_ACTIVE_THREATS).map((row) => row.id));
  });

  it('should rank nothing when every activity is unknown', () => {
    expect(rankMostActiveThreats([threat('a', null), threat('b', null, 0.9)])).toEqual([]);
  });

  it('should not reorder the array it receives', () => {
    const threats = [threat('unknown', null), threat('quiet', 0.1), threat('loud', 0.9)];

    rankMostActiveThreats(threats);

    expect(threats.map((row) => row.id)).toEqual(['unknown', 'quiet', 'loud']);
  });

  it('should rank nothing for an empty list', () => {
    expect(rankMostActiveThreats([])).toEqual([]);
  });
});

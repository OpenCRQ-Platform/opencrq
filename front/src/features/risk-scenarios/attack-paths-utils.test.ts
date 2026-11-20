import { describe, expect, it } from 'vitest';
import { splitUnplayableObstacles } from './attack-paths-utils';

describe('splitUnplayableObstacles', () => {
  it('tells the attack paths a run cannot play from the walk obstacles, each in its order', () => {
    expect(splitUnplayableObstacles(['knowledge', 'outside_perimeter', 'TA0040', 'access_held_or_outside_perimeter']))
      .toEqual({ walk: ['knowledge', 'TA0040'], paths: ['outside_perimeter', 'access_held_or_outside_perimeter'] });
  });

  it('names no path when the run lists walk obstacles only, or nothing', () => {
    expect(splitUnplayableObstacles(['foothold'])).toEqual({ walk: ['foothold'], paths: [] });
    expect(splitUnplayableObstacles([])).toEqual({ walk: [], paths: [] });
  });
});

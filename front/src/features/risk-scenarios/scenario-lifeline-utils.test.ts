import { describe, expect, it } from 'vitest';
import { placeLifelineByTime } from './scenario-lifeline-utils';

const NOW = new Date('2026-04-01T00:00:00.000Z');

describe('placeLifelineByTime', () => {
  it('should span the axis from the oldest point to now', () => {
    expect(placeLifelineByTime([
      '2026-03-02T00:00:00.000Z',
      '2026-03-17T00:00:00.000Z',
      '2026-03-31T00:00:00.000Z',
    ], NOW)).toEqual([0, 0.5, 29 / 30]);
  });

  it('should place uneven runs by their dates rather than evenly', () => {
    const xs = placeLifelineByTime([
      '2026-03-22T00:00:00.000Z',
      '2026-03-31T00:00:00.000Z',
      '2026-04-01T00:00:00.000Z',
    ], NOW);

    expect(xs).toEqual([0, 0.9, 1]);
  });

  it('should end the axis on the latest point when it is ahead of now', () => {
    expect(placeLifelineByTime(['2026-03-31T00:00:00.000Z', '2026-04-02T00:00:00.000Z'], NOW)).toEqual([0, 1]);
  });

  it('should leave a single point to its own rendering', () => {
    expect(placeLifelineByTime(['2026-03-31T00:00:00.000Z'], NOW)).toBeUndefined();
  });

  it('should fall back to even spacing when every point sits at now', () => {
    expect(placeLifelineByTime([NOW.toISOString(), NOW.toISOString()], NOW)).toBeUndefined();
  });
});

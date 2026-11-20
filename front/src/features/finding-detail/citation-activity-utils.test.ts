import { describe, expect, it } from 'vitest';
import { buildCitationActivity } from './citation-activity-utils';

const NOW = new Date(2026, 7, 19);

describe('buildCitationActivity', () => {
  it('draws twelve months ending on the current one', () => {
    const { cells } = buildCitationActivity([], NOW);
    expect(cells).toHaveLength(12);
    expect(cells[0].month).toEqual(new Date(2025, 8, 1));
    expect(cells[11].month).toEqual(new Date(2026, 7, 1));
  });

  it('tallies the citations opened in each month', () => {
    const { cells, peak } = buildCitationActivity([
      { state: 'applicable', stateChangedAt: new Date(2026, 5, 3) },
      { state: 'applicable', stateChangedAt: new Date(2026, 5, 28) },
      { state: 'applicable', stateChangedAt: new Date(2026, 6, 9) },
    ], NOW);
    expect(cells[9].count).toBe(2);
    expect(cells[10].count).toBe(1);
    expect(peak).toBe(2);
  });

  it('ignores the closing of a citation window', () => {
    const { cells, total } = buildCitationActivity([
      { state: 'applicable', stateChangedAt: new Date(2026, 5, 3) },
      { state: 'inactive', stateChangedAt: new Date(2026, 6, 3) },
    ], NOW);
    expect(cells[10].count).toBe(0);
    expect(total).toBe(1);
  });

  it('counts citations older than the window in the total and keeps the strip empty', () => {
    const { cells, total, latestAt } = buildCitationActivity([
      { state: 'applicable', stateChangedAt: new Date(2019, 2, 4) },
    ], NOW);
    expect(cells.every((cell) => cell.count === 0)).toBe(true);
    expect(total).toBe(1);
    expect(latestAt).toEqual(new Date(2019, 2, 4));
  });

  it('reads dates given as strings', () => {
    const { cells } = buildCitationActivity([
      { state: 'applicable', stateChangedAt: new Date(2026, 6, 9).toISOString() },
    ], NOW);
    expect(cells[10].count).toBe(1);
  });

  it('has no peak and no latest date when nothing was ever cited', () => {
    const { peak, total, latestAt } = buildCitationActivity([], NOW);
    expect(peak).toBe(0);
    expect(total).toBe(0);
    expect(latestAt).toBeNull();
  });
});

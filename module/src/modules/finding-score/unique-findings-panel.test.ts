import { describe, expect, it } from 'vitest';
import type { UniqueFindingsPanelRows } from './unique-findings-panel';
import { foldUniqueFindingsPanel } from './unique-findings-panel';

const WINDOW = {
  windowStart: new Date('2026-10-04T10:00:00.000Z'),
  previousWindowStart: new Date('2026-09-27T10:00:00.000Z'),
};

const rows = (journalStartsAt: Date | null): UniqueFindingsPanelRows => ({
  current: [
    { band: 'critical', total: 3, techniqueGroups: 0, newInWindow: 1 },
    { band: 'low', total: 5, techniqueGroups: 0, newInWindow: 0 },
    { band: null, total: 6, techniqueGroups: 4, newInWindow: 2 },
  ],
  atWindowStart: [
    { band: 'critical', total: 2, newInWindow: 1 },
    { band: 'medium', total: 4, newInWindow: 0 },
    { band: null, total: 1, newInWindow: 1 },
  ],
  journalStartsAt,
});

describe('foldUniqueFindingsPanel', () => {
  it('counts technique groups in the total and in no band', () => {
    const counts = foldUniqueFindingsPanel(rows(null), WINDOW);

    expect(counts.uniqueFindings).toBe(14);
    expect(counts.techniqueGroups).toBe(4);
    expect(counts.bands.reduce((total, band) => total + band.total, 0)).toBe(8);
  });

  it('counts an unscored CVE group as new without banding it', () => {
    expect(foldUniqueFindingsPanel(rows(null), WINDOW).newInWindow).toBe(3);
  });

  it('gives every band a figure, an empty one at zero', () => {
    expect(foldUniqueFindingsPanel(rows(null), WINDOW).bands).toEqual([
      { band: 'critical', total: 3, newInWindow: 1 },
      { band: 'high', total: 0, newInWindow: 0 },
      { band: 'medium', total: 0, newInWindow: 0 },
      { band: 'low', total: 5, newInWindow: 0 },
    ]);
  });

  it('reads the CVE groups and their bands at the window start from the journal', () => {
    expect(foldUniqueFindingsPanel(rows(new Date('2026-01-01T00:00:00.000Z')), WINDOW).baselines).toEqual({
      cveGroupsBefore: 7,
      bandsBefore: [
        { band: 'critical', total: 2 },
        { band: 'high', total: 0 },
        { band: 'medium', total: 4 },
        { band: 'low', total: 0 },
      ],
      newInPreviousWindow: 2,
    });
  });

  it('draws no baseline when the estate never journaled a line', () => {
    expect(foldUniqueFindingsPanel(rows(null), WINDOW).baselines).toBeNull();
  });

  it('draws no baseline when the journal starts at or after the window start', () => {
    expect(foldUniqueFindingsPanel(rows(WINDOW.windowStart), WINDOW).baselines).toBeNull();
  });

  it('withholds the previous new-count alone when the journal starts inside the previous window', () => {
    const baselines = foldUniqueFindingsPanel(rows(new Date('2026-09-30T00:00:00.000Z')), WINDOW).baselines;

    expect(baselines?.cveGroupsBefore).toBe(7);
    expect(baselines?.newInPreviousWindow).toBeNull();
  });
});

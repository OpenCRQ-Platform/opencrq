import { describe, expect, it } from 'vitest';
import {
  fitRiskScopeSlots,
  readChangeChip,
  resolveDashboardScope,
  selectBestLikelihoodMovers,
  selectWorstLikelihoodMovers,
  sortSummariesByAle,
  summarizeOtherRiskScopes,
  toTenthsOfPoints,
} from './dashboard-utils';

describe('sortSummariesByAle', () => {
  it('sorts by latest ALE descending with missing values last', () => {
    const sorted = sortSummariesByAle([
      { id: 'none', latestRun: null },
      { id: 'low', latestRun: { aleMean: 10 } },
      { id: 'high', latestRun: { aleMean: 900 } },
      { id: 'null-ale', latestRun: { aleMean: null } },
    ]);
    expect(sorted.map((s) => s.id)).toEqual(['high', 'low', 'none', 'null-ale']);
  });

  it('ranks a scenario whose scope maps no asset as unpriced', () => {
    const sorted = sortSummariesByAle([
      { id: 'retired', latestRun: { aleMean: 900 }, noMappedAsset: true },
      { id: 'low', latestRun: { aleMean: 10 } },
    ]);
    expect(sorted.map((s) => s.id)).toEqual(['low', 'retired']);
  });
});

describe('likelihood movers', () => {
  const mover = (id: string, likelihoodChange: number | null, extra: { noMappedAsset?: boolean } = {}) => ({
    id,
    likelihoodChange,
    ...extra,
  });
  const summaries = [
    mover('up-9', 0.09),
    mover('up-2', 0.02),
    mover('up-4', 0.04),
    mover('up-1', 0.01),
    mover('down-12', -0.12),
    mover('down-5', -0.05),
    mover('down-8', -0.08),
    mover('down-3', -0.03),
    mover('flat', 0.0004),
    mover('no-baseline', null),
    { id: 'no-run', likelihoodChange: null },
    mover('retired', 0.5, { noMappedAsset: true }),
  ];

  it('lists the three scenarios whose likelihood rose most, largest first', () => {
    expect(selectWorstLikelihoodMovers(summaries).map((s) => s.id)).toEqual(['up-9', 'up-4', 'up-2']);
  });

  it('lists the three scenarios whose likelihood fell most, largest fall first', () => {
    expect(selectBestLikelihoodMovers(summaries).map((s) => s.id)).toEqual(['down-12', 'down-8', 'down-5']);
  });

  it('keeps a change of a tenth of a point', () => {
    expect(selectBestLikelihoodMovers([mover('slight', -0.0026)]).map((s) => s.id)).toEqual(['slight']);
  });

  it('leaves out a change that rounds to no point, and a scenario without one', () => {
    const quiet = [mover('flat', 0.0004), mover('flat-down', -0.0004), mover('no-baseline', null)];
    expect(selectWorstLikelihoodMovers(quiet)).toEqual([]);
    expect(selectBestLikelihoodMovers(quiet)).toEqual([]);
  });
});

describe('toTenthsOfPoints', () => {
  it('reads a probability change in points to one decimal', () => {
    expect(toTenthsOfPoints(0.09)).toBe(9);
    expect(toTenthsOfPoints(-0.0026)).toBe(-0.3);
    expect(toTenthsOfPoints(0.0004)).toBe(0);
  });
});

describe('readChangeChip', () => {
  const formatTenths = (change: number): string => `${toTenthsOfPoints(change)} pts`;

  it('reads a change its label rounds to zero as no change, even when its relative move counts as a rise', () => {
    expect(readChangeChip({ change: 0.00004, direction: 'up' }, formatTenths)).toEqual({ label: '0 pts', sign: 0, direction: 'flat' });
  });

  it('keeps the sign and the direction of a change its label shows', () => {
    expect(readChangeChip({ change: -0.0026, direction: 'down' }, formatTenths)).toEqual({ label: '-0.3 pts', sign: -1, direction: 'down' });
  });
});

describe('resolveDashboardScope', () => {
  const europe = '0199a0b4-6a2e-7c1d-9f3e-5b8a2c4d6e10';
  const retail = '0199a0b4-6a2e-7c1d-9f3e-5b8a2c4d6e11';

  it('reads the whole tenant on all risk scopes', () => {
    expect(resolveDashboardScope(undefined, 'all')).toBeUndefined();
  });

  it('reads the scope the parameter names at tenant level', () => {
    expect(resolveDashboardScope(undefined, europe)).toBe(europe);
  });

  it('reads the scope the address is under, whatever the parameter', () => {
    expect(resolveDashboardScope(retail, 'all')).toBe(retail);
    expect(resolveDashboardScope(retail, europe)).toBe(retail);
  });
});

describe('fitRiskScopeSlots', () => {
  it('should fit one more column for every 216 px', () => {
    expect(fitRiskScopeSlots(847, 9).columns).toBe(3);
    expect(fitRiskScopeSlots(848, 9).columns).toBe(4);
    expect(fitRiskScopeSlots(1280, 9).columns).toBe(6);
  });

  it('should give the last column to the remaining scopes when they outnumber the columns', () => {
    expect(fitRiskScopeSlots(848, 9)).toEqual({ columns: 4, shownCount: 3, hasOther: true });
  });

  it('should give every scope its own card when they fit', () => {
    expect(fitRiskScopeSlots(848, 4)).toEqual({ columns: 4, shownCount: 4, hasOther: false });
  });

  it('should keep two columns on a narrow group', () => {
    expect(fitRiskScopeSlots(0, 5)).toEqual({ columns: 2, shownCount: 1, hasOther: true });
  });
});

describe('summarizeOtherRiskScopes', () => {
  const scopes = [
    { scenarioCount: 4, ale: 600, aleChange: 100, aleBaseline: { date: '2026-01-01', ale: 500 } },
    { scenarioCount: 2, ale: 300, aleChange: -50, aleBaseline: { date: '2026-01-01', ale: 350 } },
    { scenarioCount: 1, ale: 100, aleChange: null, aleBaseline: { date: '2026-10-04', ale: 100 } },
    { scenarioCount: 3, ale: null, aleChange: null, aleBaseline: null },
  ];

  it('should add up the scopes past the shown ones, against the whole tenant', () => {
    expect(summarizeOtherRiskScopes(scopes, 1)).toEqual({ scopeCount: 3, scenarioCount: 6, ale: 400, aleChange: 50, aleSince: '2026-01-01', share: 0.4 });
  });

  it('should read the change from the first day any remaining scope carries a figure', () => {
    const later = [
      { scenarioCount: 1, ale: 300, aleChange: -50, aleBaseline: { date: '2026-01-01', ale: 350 } },
      { scenarioCount: 1, ale: 200, aleChange: 20, aleBaseline: { date: '2026-06-01', ale: 180 } },
    ];

    expect(summarizeOtherRiskScopes(later, 0).aleChange).toBe(150);
  });

  it('should read no change where every remaining scope was first priced today', () => {
    expect(summarizeOtherRiskScopes(scopes, 2).aleChange).toBeNull();
  });

  it('should read no figure where none of the remaining scopes has one', () => {
    expect(summarizeOtherRiskScopes(scopes, 3)).toEqual({ scopeCount: 1, scenarioCount: 3, ale: null, aleChange: null, aleSince: null, share: null });
  });

  it('should name the earliest baseline as the day the summed change starts from', () => {
    const later = [
      { scenarioCount: 1, ale: 300, aleChange: -50, aleBaseline: { date: '2026-06-01', ale: 350 } },
      { scenarioCount: 1, ale: 200, aleChange: 20, aleBaseline: { date: '2026-03-01', ale: 180 } },
    ];

    expect(summarizeOtherRiskScopes(later, 0).aleSince).toBe('2026-03-01');
  });
});

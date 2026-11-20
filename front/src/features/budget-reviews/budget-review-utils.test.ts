import { describe, expect, it } from 'vitest';
import type { ReviewControl } from './budget-review-utils';
import {
  buildLineChoices,
  buildMovesWithin,
  changedPeriodStart,
  closeBlocker,
  dayTimestamp,
  editYearOptions,
  figureOf,
  firstAndMore,
  fiscalYearLabel,
  isAmortized,
  labelRows,
  lineControls,
  lineCountByNature,
  linePayloadControls,
  monthsAfterPeriod,
  movedWithoutBuildLine,
  pointLabelSide,
  prudentReturnPercent,
  reviewPeriod,
  reviewPeriodEnd,
  reviewPeriodStart,
  reviewStartMonths,
  reviewUpdatePayload,
  reviewYearOptions,
  sameControls,
  scaleSteps,
  timelineMargin,
  withoutBuildGap,
} from './budget-review-utils';

const control = (capabilityId: string, overrides: Partial<ReviewControl> = {}): ReviewControl => ({
  capabilityId,
  name: capabilityId,
  start: { strengthRung: 'L1', coverageBucket: 'L1' },
  end: { strengthRung: 'L2', coverageBucket: 'L2' },
  moved: true,
  buildLine: null,
  ...overrides,
});

describe('reviewYearOptions', () => {
  it('offers the current year first, then the four before it', () => {
    expect(reviewYearOptions(new Date(Date.UTC(2026, 9, 5)))).toEqual([2026, 2025, 2024, 2023, 2022]);
  });

  it('reads the year in UTC, where a time zone ahead of it has already turned', () => {
    expect(reviewYearOptions(new Date('2027-01-01T01:00:00+03:00'))[0]).toBe(2026);
  });
});

describe('reviewStartMonths', () => {
  it('offers every month of a past year, and the current one up to this month', () => {
    expect(reviewStartMonths(2025, new Date(Date.UTC(2026, 9, 5)))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(reviewStartMonths(2026, new Date(Date.UTC(2026, 3, 5)))).toEqual([1, 2, 3, 4]);
  });

  it('stops at the current month in UTC, which the API checks a period start against', () => {
    expect(reviewStartMonths(2026, new Date('2026-05-01T01:00:00+03:00'))).toEqual([1, 2, 3, 4]);
    expect(reviewStartMonths(2026, new Date('2026-04-30T23:00:00-03:00'))).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('reviewPeriodStart', () => {
  it('is the first day of the month', () => {
    expect(reviewPeriodStart(2025, 4)).toBe('2025-04-01');
    expect(reviewPeriodStart(2026, 11)).toBe('2026-11-01');
  });
});

describe('fiscalYearLabel', () => {
  it('names a January start by its year and any other by both years it spans', () => {
    expect(fiscalYearLabel('2026-01-01')).toBe('2026');
    expect(fiscalYearLabel('2025-04-01')).toBe('2025-2026');
  });
});

describe('reviewPeriodEnd', () => {
  it('ends the twelve months on the day before the same month a year later', () => {
    expect(reviewPeriodEnd('2025-05-01')).toBe('2026-04-30');
    expect(reviewPeriodEnd('2026-01-01')).toBe('2026-12-31');
    expect(reviewPeriodEnd('2023-03-01')).toBe('2024-02-29');
  });
});

describe('editYearOptions', () => {
  it('offers the usual years when the stored one is among them', () => {
    expect(editYearOptions('2024-04-01', new Date(Date.UTC(2026, 9, 5)))).toEqual([2026, 2025, 2024, 2023, 2022]);
  });

  it('keeps a stored year that has aged out of them', () => {
    expect(editYearOptions('2019-04-01', new Date(Date.UTC(2026, 9, 5)))).toEqual([2026, 2025, 2024, 2023, 2022, 2019]);
  });
});

describe('changedPeriodStart', () => {
  it('answers nothing while the choice is the stored period', () => {
    expect(changedPeriodStart('2025-04-01', 2025, 4)).toBeNull();
  });

  it('answers the new start when the month or the year moved', () => {
    expect(changedPeriodStart('2025-04-01', 2025, 5)).toBe('2025-05-01');
    expect(changedPeriodStart('2025-04-01', 2024, 4)).toBe('2024-04-01');
  });
});

describe('reviewUpdatePayload', () => {
  const values = { name: 'Fiscal year 2025-2026', ownerId: null, context: 'Voted in April.' };

  it('leaves the period start out when it did not move', () => {
    expect(reviewUpdatePayload('2025-04-01', { ...values, startYear: 2025, startMonth: 4 })).toEqual(values);
  });

  it('sends the period start when it moved', () => {
    expect(reviewUpdatePayload('2025-04-01', { ...values, startYear: 2025, startMonth: 5 })).toEqual({ ...values, periodStart: '2025-05-01' });
  });
});

describe('reviewPeriod', () => {
  it('ends a running period today', () => {
    expect(reviewPeriod('2025-11-01', '2026-10-31', new Date(2026, 9, 5))).toEqual({ from: '2025-11-01', to: '2026-10-05' });
  });

  it('ends a past period on its last day', () => {
    expect(reviewPeriod('2025-04-01', '2026-03-31', new Date(2026, 9, 5))).toEqual({ from: '2025-04-01', to: '2026-03-31' });
  });
});

describe('withoutBuildGap', () => {
  const build = { aleReductionMean: 1.3e6, aleReductionP10: 0.9e6, aleReductionP90: 1.8e6 };
  const points = [{ date: '2026-01-01', ale: 2.5e6, without: 2.5e6 }, { date: '2026-10-05', ale: 2.1e6, without: 3.4e6 }];

  it('reads the gap on the curve\'s last day, with the build figure\'s spread around it', () => {
    const gap = withoutBuildGap(points, build);
    expect(gap).toMatchObject({
      date: '2026-10-05',
      current: 2.1e6,
      without: 3.4e6,
      reductionSpread: { low: 0.9e6, high: 1.8e6 },
      withoutSpread: { low: 3e6, high: 3.9e6 },
    });
    expect(gap!.reduction).toBeCloseTo(1.3e6);
  });

  it('scales the build figure\'s spread to the gap drawn when the curve ends on another level', () => {
    const gap = withoutBuildGap([{ date: '2026-09-30', ale: 1.8e6, without: 2.34e6 }], { aleReductionMean: 0.6e6, aleReductionP10: 0.3e6, aleReductionP90: 0.9e6 });
    expect(gap!.reductionSpread!.low).toBeCloseTo(0.27e6);
    expect(gap!.reductionSpread!.high).toBeCloseTo(0.81e6);
  });

  it('draws no spread when the figure carries none', () => {
    expect(withoutBuildGap(points, { ...build, aleReductionP90: null })).toMatchObject({ reductionSpread: null, withoutSpread: null });
    expect(withoutBuildGap(points, { ...build, aleReductionMean: 0 })).toMatchObject({ reductionSpread: null });
    expect(withoutBuildGap(points, null)!.reduction).toBeCloseTo(1.3e6);
  });

  it('floors the band drawn at zero, and keeps the spread as priced for its label', () => {
    const low = [{ date: '2026-10-05', ale: 0.2e6, without: 0.3e6 }];
    expect(withoutBuildGap(low, { aleReductionMean: 0.1e6, aleReductionP10: -0.5e6, aleReductionP90: 0.6e6 })).toMatchObject({
      reductionSpread: { low: -0.5e6, high: 0.6e6 },
      withoutSpread: { low: 0, high: 0.8e6 },
    });
  });

  it('draws nothing with no curve, no history, or no gap', () => {
    expect(withoutBuildGap([], build)).toBeNull();
    expect(withoutBuildGap([{ date: '2026-10-05', ale: 2e6, without: null }], build)).toBeNull();
    expect(withoutBuildGap([{ date: '2026-10-05', ale: 2e6, without: 2e6 }], build)).toBeNull();
  });
});

describe('buildMovesWithin', () => {
  const lines = [{ id: 'identity', name: 'Identity hardening' }, { id: 'dlp', name: 'Data loss' }];
  const controls = [{ capabilityId: 'mfa', name: 'IDP' }, { capabilityId: 'edr', name: 'EDR' }, { capabilityId: 'dlp', name: 'DLP' }];
  const moved = (lineId: string, capabilityIds: Array<string>, finished: boolean) => ({ lineId, capabilityIds, finished });

  it('names the lines and controls moved each day within the window, dropping the days out of it', () => {
    expect(buildMovesWithin([
      { date: '2025-10-31', lines: [moved('dlp', ['dlp'], false)] },
      { date: '2026-03-15', lines: [moved('identity', ['mfa'], false)] },
      { date: '2026-06-10', lines: [moved('identity', ['edr', 'gone'], true), moved('dlp', ['dlp'], true)] },
      { date: '2026-10-08', lines: [moved('dlp', ['dlp'], true)] },
    ], lines, controls, '2025-11-01', '2026-10-07')).toEqual([
      { date: '2026-03-15', lines: [{ lineName: 'Identity hardening', controlNames: ['IDP'], finished: false }] },
      {
        date: '2026-06-10',
        lines: [
          { lineName: 'Identity hardening', controlNames: ['EDR'], finished: true },
          { lineName: 'Data loss', controlNames: ['DLP'], finished: true },
        ],
      },
    ]);
  });

  it('drops a day whose lines are no longer the review\'s', () => {
    expect(buildMovesWithin([{ date: '2026-03-15', lines: [moved('removed', ['mfa'], true)] }], lines, controls, '2025-11-01', '2026-10-07')).toEqual([]);
  });
});

describe('labelRows', () => {
  it('lifts a label onto the next row while the one before it on the row has not ended', () => {
    expect(labelRows([
      { start: 0, width: 30 },
      { start: 20, width: 30 },
      { start: 35, width: 30 },
      { start: 55, width: 10 },
    ])).toEqual([0, 1, 0, 1]);
  });
});

describe('timelineMargin', () => {
  it('keeps the margin asked for, the period drawn on the rest of the plot', () => {
    expect(timelineMargin(800, 1000, 200)).toEqual({ msPerPx: 1, marginMs: 200 });
  });

  it('caps the margin at 40 % of a narrow plot', () => {
    expect(timelineMargin(300, 500, 400)).toEqual({ msPerPx: 1, marginMs: 200 });
  });
});

describe('monthsAfterPeriod', () => {
  it('counts the whole months from the day after the period, and none within it', () => {
    expect(monthsAfterPeriod('2026-03-31', new Date('2026-10-06T10:00:00Z'))).toBe(6);
    expect(monthsAfterPeriod('2026-03-31', new Date('2026-04-20T10:00:00Z'))).toBe(0);
    expect(monthsAfterPeriod('2026-03-31', new Date('2026-03-15T10:00:00Z'))).toBe(0);
  });
});

describe('pointLabelSide', () => {
  it('sets a label right of a point on the left edge of the plot, and left of any other', () => {
    expect(pointLabelSide(100, 100)).toEqual({ textAnchor: 'start', offsetX: 8 });
    expect(pointLabelSide(101, 100)).toEqual({ textAnchor: 'end', offsetX: -8 });
  });
});

describe('lineControls', () => {
  const controls = [control('a', { name: 'A' }), control('b', { name: 'B' }), control('c', { name: 'C' })];

  it('keeps the line\'s controls in its own order, and skips one the review does not know', () => {
    expect(lineControls(['c', 'gone', 'a'], controls).map((row) => row.capabilityId)).toEqual(['c', 'a']);
  });
});

describe('firstAndMore', () => {
  it('shows at most three items, and counts the rest', () => {
    expect(firstAndMore(['A', 'B'])).toEqual({ shown: ['A', 'B'], more: 0 });
    expect(firstAndMore(['A', 'B', 'C', 'D', 'E'])).toEqual({ shown: ['A', 'B', 'C'], more: 2 });
  });
});

describe('scaleSteps', () => {
  const levels = ['L0', 'L1', 'L2', 'L3'];

  it('keeps the steps held at both ends and marks the ones the period gained', () => {
    expect(scaleSteps(levels, 'L1', 'L2')).toEqual(['kept', 'gained', 'empty']);
  });

  it('marks the steps a fall lost', () => {
    expect(scaleSteps(levels, 'L3', 'L1')).toEqual(['kept', 'lost', 'lost']);
  });

  it('reads a level that did not move as kept steps only', () => {
    expect(scaleSteps(levels, 'L2', 'L2')).toEqual(['kept', 'kept', 'empty']);
    expect(scaleSteps(levels, 'L0', 'L0')).toEqual(['empty', 'empty', 'empty']);
  });
});

describe('figureOf', () => {
  const figures = [
    { basket: 'line' as const, lineId: 'a' },
    { basket: 'line' as const, lineId: 'b' },
    { basket: 'build' as const, lineId: null },
  ];

  it('finds a line by its id, and a total by its basket', () => {
    expect(figureOf(figures, 'line', 'b')).toBe(figures[1]);
    expect(figureOf(figures, 'build')).toBe(figures[2]);
    expect(figureOf(figures, 'ensemble')).toBeUndefined();
  });
});

describe('isAmortized', () => {
  it('holds when the yearly cost is below the spend, never when they match', () => {
    expect(isAmortized({ spent: 120_000, annualSpent: 40_000 })).toBe(true);
    expect(isAmortized({ spent: 120_000, annualSpent: 120_000 })).toBe(false);
    expect(isAmortized({ spent: 0, annualSpent: 0 })).toBe(false);
  });
});

describe('prudentReturnPercent', () => {
  it('is the return on the p10 of the loss avoided', () => {
    expect(prudentReturnPercent({ aleReductionP10: 900_000, spent: 400_000 })).toBe(125);
    expect(prudentReturnPercent({ aleReductionP10: 100_000, spent: 400_000 })).toBe(-75);
  });

  it('is undefined without a p10 or without a spend, as the main return is', () => {
    expect(prudentReturnPercent({ aleReductionP10: null, spent: 400_000 })).toBeNull();
    expect(prudentReturnPercent({ aleReductionP10: 900_000, spent: 0 })).toBeNull();
  });
});

describe('movedWithoutBuildLine', () => {
  it('keeps the moves no build line accounts for', () => {
    const controls = [
      control('free'),
      control('held', { buildLine: { id: 'line', name: 'EDR' } }),
      control('still', { moved: false }),
    ];

    expect(movedWithoutBuildLine(controls).map((row) => row.capabilityId)).toEqual(['free']);
  });

  it('is empty once every move belongs to a build line', () => {
    expect(movedWithoutBuildLine([control('held', { buildLine: { id: 'line', name: 'EDR' } })])).toEqual([]);
  });
});

describe('buildLineChoices', () => {
  const controls = [
    control('b-free', { name: 'Backups' }),
    control('a-other', { name: 'IDP', buildLine: { id: 'other', name: 'MFA rollout' } }),
    control('c-mine', { name: 'EDR', buildLine: { id: 'mine', name: 'EDR' } }),
    control('d-still', { name: 'Logging', moved: false }),
  ];

  it('offers every move, names the other line holding one, and puts the held ones last', () => {
    const choices = buildLineChoices(controls, 'mine', []);

    expect(choices.map((choice) => [choice.control.capabilityId, choice.heldBy?.name ?? null])).toEqual([
      ['b-free', null],
      ['c-mine', null],
      ['a-other', 'MFA rollout'],
    ]);
  });

  it('keeps a control the line holds even when it no longer moved', () => {
    expect(buildLineChoices(controls, 'mine', ['d-still']).map((choice) => choice.control.capabilityId)).toContain('d-still');
  });

  it('treats every held move as another line\'s on a new line', () => {
    expect(buildLineChoices(controls, null, []).filter((choice) => choice.heldBy !== null).map((choice) => choice.control.capabilityId))
      .toEqual(['c-mine', 'a-other']);
  });
});

describe('linePayloadControls', () => {
  const controls = [control('free'), control('held', { buildLine: { id: 'other', name: 'Other' } })];

  it('drops from a build line a move another build line holds', () => {
    const choices = buildLineChoices(controls, 'mine', ['free', 'held']);

    expect(linePayloadControls('build', ['free', 'held'], choices)).toEqual(['free']);
  });

  it('keeps every control of a run line, a control may sit in a build and a run line', () => {
    const choices = buildLineChoices(controls, 'mine', ['free', 'held']);

    expect(linePayloadControls('run', ['free', 'held'], choices)).toEqual(['free', 'held']);
  });
});

describe('sameControls', () => {
  it('compares sets, not orders', () => {
    expect(sameControls(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameControls(['a'], ['a', 'b'])).toBe(false);
  });
});

describe('lineCountByNature', () => {
  it('counts the lines of each nature', () => {
    expect(lineCountByNature([{ nature: 'build' }, { nature: 'run' }, { nature: 'build' }])).toEqual({ build: 2, run: 1 });
  });
});

describe('closeBlocker', () => {
  const reviewFigures = (figures: Array<{ state: 'priced' | 'expired' | 'not-priced' }>, olderThanHeadlineNames: Array<string> = []) => ({ figures, olderThanHeadlineNames });

  it('asks for a line first, then for priced figures', () => {
    expect(closeBlocker(0, reviewFigures([{ state: 'expired' }]))).toBe('no-line');
    expect(closeBlocker(2, reviewFigures([{ state: 'expired' }]))).toBe('unpriced');
    expect(closeBlocker(2, undefined)).toBe('unpriced');
    expect(closeBlocker(2, reviewFigures([{ state: 'priced' }]))).toBeNull();
  });

  it('lets a review close only once every figure is priced', () => {
    expect(closeBlocker(1, reviewFigures([{ state: 'priced' }, { state: 'priced' }]))).toBeNull();
    expect(closeBlocker(1, reviewFigures([{ state: 'priced' }, { state: 'expired' }]))).toBe('unpriced');
    expect(closeBlocker(1, reviewFigures([{ state: 'not-priced' }]))).toBe('unpriced');
  });

  it('keeps it open while the figures load or when there are none', () => {
    expect(closeBlocker(1, undefined)).toBe('unpriced');
    expect(closeBlocker(1, reviewFigures([]))).toBe('unpriced');
  });

  it('keeps a review with no line open, however its figures stand', () => {
    expect(closeBlocker(0, reviewFigures([{ state: 'priced' }]))).toBe('no-line');
    expect(closeBlocker(0, reviewFigures([{ state: 'priced' }], ['Ransomware']))).toBe('no-line');
  });

  it('refuses priced figures that come from a run older than a scenario\'s latest', () => {
    expect(closeBlocker(2, reviewFigures([{ state: 'priced' }, { state: 'priced' }], ['Ransomware']))).toBe('outdated');
  });

  it('asks for priced figures before asking to re-simulate older ones', () => {
    expect(closeBlocker(2, reviewFigures([{ state: 'expired' }], ['Ransomware']))).toBe('unpriced');
  });
});

describe('dayTimestamp', () => {
  it('reads a day as its UTC midnight', () => {
    expect(dayTimestamp('2026-03-01')).toBe(Date.UTC(2026, 2, 1));
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildEstimatesPayload,
  conflictingDraftRows,
  getEffectiveValues,
  getRowPert,
  getRowValidationError,
  isRecomputeNoticeStanding,
  isRefusalPostureRow,
  isRowComplete,
  parseNum,
  partitionEstimateRows,
  planEstimatesSave,
  reconcileDraftRows,
  sumEstimateTotals,
} from './scenario-loss-utils';

describe('parseNum', () => {
  it('should return null for empty string', () => {
    expect(parseNum('')).toBeNull();
  });

  it('should parse valid numbers', () => {
    expect(parseNum('42')).toBe(42);
    expect(parseNum('3.14')).toBe(3.14);
    expect(parseNum('0')).toBe(0);
    expect(parseNum('-10')).toBe(-10);
  });

  it('should return null for non-finite values', () => {
    expect(parseNum('Infinity')).toBeNull();
    expect(parseNum('NaN')).toBeNull();
    expect(parseNum('abc')).toBeNull();
  });
});

describe('getRowValidationError', () => {
  it('should return null for valid row', () => {
    expect(getRowValidationError({ minValue: '100', likelyValue: '200', maxValue: '300' })).toBeNull();
  });

  it('should return null for equal values', () => {
    expect(getRowValidationError({ minValue: '100', likelyValue: '100', maxValue: '100' })).toBeNull();
  });

  it('should return null for empty values', () => {
    expect(getRowValidationError({ minValue: '', likelyValue: '', maxValue: '' })).toBeNull();
  });

  it('should detect min > likely', () => {
    expect(getRowValidationError({ minValue: '300', likelyValue: '200', maxValue: '400' })).toBe('MIN_GT_LIKELY');
  });

  it('should detect likely > max', () => {
    expect(getRowValidationError({ minValue: '100', likelyValue: '500', maxValue: '400' })).toBe('LIKELY_GT_MAX');
  });

  it('should detect min > max', () => {
    expect(getRowValidationError({ minValue: '500', likelyValue: '', maxValue: '100' })).toBe('MIN_GT_MAX');
  });

  it('should return null for partially filled valid row', () => {
    expect(getRowValidationError({ minValue: '100', likelyValue: '', maxValue: '300' })).toBeNull();
  });
});

describe('isRowComplete', () => {
  it('should return true for fully filled valid row', () => {
    expect(isRowComplete({ minValue: '100', likelyValue: '200', maxValue: '300' })).toBe(true);
  });

  it('should return false for empty row', () => {
    expect(isRowComplete({ minValue: '', likelyValue: '', maxValue: '' })).toBe(false);
  });

  it('should return false for partially filled row', () => {
    expect(isRowComplete({ minValue: '100', likelyValue: '', maxValue: '300' })).toBe(false);
  });

  it('should return false for filled but invalid row', () => {
    expect(isRowComplete({ minValue: '500', likelyValue: '200', maxValue: '300' })).toBe(false);
  });
});

describe('getRowPert', () => {
  it('should compute PERT for valid complete row', () => {
    expect(getRowPert({ minValue: '100', likelyValue: '200', maxValue: '600' })).toBe(250);
  });

  it('should return null for incomplete row', () => {
    expect(getRowPert({ minValue: '100', likelyValue: '', maxValue: '300' })).toBeNull();
  });

  it('should return null for invalid row (min > likely)', () => {
    expect(getRowPert({ minValue: '300', likelyValue: '200', maxValue: '400' })).toBeNull();
  });

  it('should return null for invalid row (likely > max)', () => {
    expect(getRowPert({ minValue: '100', likelyValue: '500', maxValue: '300' })).toBeNull();
  });

  it('should handle equal values', () => {
    expect(getRowPert({ minValue: '100', likelyValue: '100', maxValue: '100' })).toBe(100);
  });
});

describe('partitionEstimateRows', () => {
  const row = (lossDriverId: string, values: Partial<{ minValue: string, likelyValue: string, maxValue: string }> = {}) => ({
    lossDriverId,
    minValue: '',
    likelyValue: '',
    maxValue: '',
    ...values,
  });
  const cell = {
    attackOutcomeId: 'outcome-1',
    attackOutcomeName: 'Ransomware',
    businessValueCategoryId: 'category-1',
    businessValueCategoryCode: 'personal-data',
    businessValueCategoryName: 'Personal data',
    businessValueCategoryCatalogId: null,
  };

  it('puts a recommended driver in the recommended group with the cells that justify it', () => {
    const result = partitionEstimateRows([row('d1'), row('d2')], [{ lossDriverId: 'd1', viaCells: [cell] }]);

    expect(result.recommended.map((r) => r.lossDriverId)).toEqual(['d1']);
    expect(result.recommended[0].viaCells).toEqual([cell]);
    expect(result.notRecommended).toEqual([]);
    expect(result.rest.map((r) => r.lossDriverId)).toEqual(['d2']);
  });

  it('surfaces a driver estimated outside the recommendation instead of hiding it', () => {
    const result = partitionEstimateRows(
      [row('d1'), row('d2', { likelyValue: '5000' })],
      [{ lossDriverId: 'd1', viaCells: [cell] }],
    );

    expect(result.notRecommended.map((r) => r.lossDriverId)).toEqual(['d2']);
    expect(result.rest).toEqual([]);
  });

  it('sends everything to the rest when nothing is recommended', () => {
    const result = partitionEstimateRows([row('d1'), row('d2')], []);

    expect(result.recommended).toEqual([]);
    expect(result.notRecommended).toEqual([]);
    expect(result.rest.map((r) => r.lossDriverId)).toEqual(['d1', 'd2']);
  });

  it('counts a driver both recommended and estimated once, as recommended', () => {
    const result = partitionEstimateRows(
      [row('d1', { minValue: '100', likelyValue: '200', maxValue: '300' })],
      [{ lossDriverId: 'd1', viaCells: [cell] }],
    );

    expect(result.recommended.map((r) => r.lossDriverId)).toEqual(['d1']);
    expect(result.notRecommended).toEqual([]);
    expect(result.rest).toEqual([]);
  });

  it('keeps a driver the analyst added explicitly out of the catalog list', () => {
    const result = partitionEstimateRows([row('d1'), row('d2')], [], ['d2']);

    expect(result.notRecommended.map((r) => r.lossDriverId)).toEqual(['d2']);
    expect(result.rest.map((r) => r.lossDriverId)).toEqual(['d1']);
  });
});

describe('buildEstimatesPayload', () => {
  const filledRow = (lossDriverId: string) => ({
    lossDriverId, minValue: '100', likelyValue: '200', maxValue: '300',
  });
  const blankRow = (lossDriverId: string) => ({
    lossDriverId, minValue: '', likelyValue: '', maxValue: '',
  });

  it('sends a set entry for a filled row', () => {
    const payload = buildEstimatesPayload([filledRow('d1')], new Set());
    expect(payload).toEqual([{ lossDriverId: 'd1', action: 'set', minValue: 100, likelyValue: 200, maxValue: 300 }]);
  });

  it('sends a clear tombstone for a row blanked back to empty that has a persisted estimate', () => {
    const payload = buildEstimatesPayload([blankRow('d1')], new Set(['d1']));
    expect(payload).toEqual([{ lossDriverId: 'd1', action: 'clear' }]);
  });

  it('omits a blank row that never had a persisted estimate', () => {
    const payload = buildEstimatesPayload([blankRow('d1')], new Set());
    expect(payload).toEqual([]);
  });

  it('handles a mix of set, clear and omitted rows in one payload', () => {
    const payload = buildEstimatesPayload(
      [filledRow('d1'), blankRow('d2'), blankRow('d3')],
      new Set(['d2']),
    );
    expect(payload).toEqual([
      { lossDriverId: 'd1', action: 'set', minValue: 100, likelyValue: 200, maxValue: 300 },
      { lossDriverId: 'd2', action: 'clear' },
    ]);
  });
});

describe('getEffectiveValues', () => {
  const automatic = { lossDriverId: 'd1', minValue: 10, likelyValue: 20, maxValue: 30, lowConfidence: false, isPosture: false };

  it('counts a manual row for its inputs', () => {
    const row = { lossDriverId: 'd1', source: 'manual' as const, minValue: '1', likelyValue: '2', maxValue: '3' };
    expect(getEffectiveValues(row, automatic)).toEqual({ minValue: '1', likelyValue: '2', maxValue: '3' });
  });

  it('counts an auto row for its automatic figures once they are known', () => {
    const row = { lossDriverId: 'd1', source: 'auto' as const, minValue: '1', likelyValue: '2', maxValue: '3' };
    expect(getEffectiveValues(row, automatic)).toEqual({ minValue: '10', likelyValue: '20', maxValue: '30' });
  });

  it('counts an auto row for its stored figures while the automatic ones are unknown', () => {
    const row = { lossDriverId: 'd1', source: 'auto' as const, minValue: '1', likelyValue: '2', maxValue: '3' };
    expect(getEffectiveValues(row, undefined)).toEqual({ minValue: '1', likelyValue: '2', maxValue: '3' });
  });
});

describe('sumEstimateTotals', () => {
  it('sums complete rows and skips incomplete or invalid ones', () => {
    const totals = sumEstimateTotals([
      { minValue: '100', likelyValue: '200', maxValue: '600' },
      { minValue: '', likelyValue: '50', maxValue: '60' },
      { minValue: '90', likelyValue: '10', maxValue: '100' },
    ]);
    expect(totals).toEqual({ min: 100, likely: 200, max: 600, pert: 250 });
  });

  it('reports a zero PERT when nothing is priced', () => {
    expect(sumEstimateTotals([]).pert).toBe(0);
  });
});

describe('getRowValidationError on negative values', () => {
  it('flags a negative cell before the ordering rules', () => {
    expect(getRowValidationError({ minValue: '-5', likelyValue: '10', maxValue: '20' })).toBe('NEGATIVE');
    expect(getRowValidationError({ minValue: '5', likelyValue: '10', maxValue: '-1' })).toBe('NEGATIVE');
  });

  it('accepts zero', () => {
    expect(getRowValidationError({ minValue: '0', likelyValue: '0', maxValue: '0' })).toBeNull();
  });

  it('gives an ordered negative triplet no PERT', () => {
    expect(getRowPert({ minValue: '-30', likelyValue: '-20', maxValue: '-10' })).toBeNull();
  });
});

describe('reconcileDraftRows', () => {
  const row = (lossDriverId: string, source: 'auto' | 'manual', values: [string, string, string] = ['1', '2', '3']) => ({
    lossDriverId, source, minValue: values[0], likelyValue: values[1], maxValue: values[2],
  });

  it('takes the server version of a row the analyst did not touch', () => {
    const base = [row('d1', 'auto')];
    expect(reconcileDraftRows(base, base, [row('d1', 'manual', ['7', '8', '9'])])).toEqual([row('d1', 'manual', ['7', '8', '9'])]);
  });

  it('keeps the analyst\'s version of a row they changed', () => {
    const edited = row('d1', 'manual', ['4', '5', '6']);
    expect(reconcileDraftRows([row('d1', 'auto')], [edited], [row('d1', 'manual', ['7', '8', '9'])])).toEqual([edited]);
  });

  it('keeps a row the analyst removed out', () => {
    expect(reconcileDraftRows([row('d1', 'manual')], [], [row('d1', 'manual', ['7', '8', '9'])])).toEqual([]);
  });

  it('keeps a row the analyst added', () => {
    const added = row('d9', 'manual', ['', '', '']);
    expect(reconcileDraftRows([], [added], [])).toEqual([added]);
  });

  it('adds a row that appeared on the server and drops an untouched one that disappeared', () => {
    const base = [row('d1', 'manual')];
    expect(reconcileDraftRows(base, base, [row('d2', 'auto')])).toEqual([row('d2', 'auto')]);
  });
});

describe('conflictingDraftRows', () => {
  const row = (lossDriverId: string, source: 'auto' | 'manual', values: [string, string, string] = ['1', '2', '3']) => ({
    lossDriverId, source, minValue: values[0], likelyValue: values[1], maxValue: values[2],
  });

  it('returns the server version of a row both sides changed, to different versions', () => {
    const base = [row('d1', 'manual'), row('d2', 'manual'), row('d3', 'manual')];
    const draft = [row('d1', 'manual', ['4', '5', '6']), row('d2', 'manual', ['4', '5', '6']), row('d3', 'manual')];
    const server = [row('d1', 'manual', ['7', '8', '9']), row('d2', 'manual', ['4', '5', '6']), row('d3', 'auto')];
    expect(conflictingDraftRows(base, draft, server, [])).toEqual([row('d1', 'manual', ['7', '8', '9'])]);
  });

  it('counts a row both sides added as changed on both', () => {
    expect(conflictingDraftRows([], [row('d9', 'manual', ['4', '5', '6'])], [row('d9', 'manual')], [])).toEqual([row('d9', 'manual')]);
  });

  it('keeps a previous conflict while the draft still differs from the server', () => {
    const base = [row('d1', 'manual')];
    const draft = [row('d1', 'manual', ['4', '5', '6'])];
    expect(conflictingDraftRows(base, draft, base, ['d1'])).toEqual([row('d1', 'manual')]);
    expect(conflictingDraftRows(base, draft, draft, ['d1'])).toEqual([]);
  });
});

describe('planEstimatesSave', () => {
  const row = (lossDriverId: string, source: 'auto' | 'manual', values: [string, string, string] = ['1', '2', '3']) => ({
    lossDriverId, source, minValue: values[0], likelyValue: values[1], maxValue: values[2],
  });

  it('writes nothing when nothing changed', () => {
    const initial = [row('d1', 'auto'), row('d2', 'manual')];
    expect(planEstimatesSave(initial, initial, new Set(['d1', 'd2']))).toEqual({ estimates: [], revertLossDriverIds: [] });
  });

  it('reverts a row switched back to auto', () => {
    const plan = planEstimatesSave([row('d1', 'manual')], [row('d1', 'auto')], new Set(['d1']));
    expect(plan).toEqual({ estimates: [], revertLossDriverIds: ['d1'] });
  });

  it('sends nothing for a row switched to manual with its loaded figures', () => {
    const plan = planEstimatesSave([row('d1', 'auto')], [row('d1', 'manual')], new Set(['d1']));
    expect(plan.estimates).toEqual([]);
  });

  it('sets a row switched to manual once its figures differ from the loaded ones', () => {
    const plan = planEstimatesSave([row('d1', 'auto')], [row('d1', 'manual', ['1', '4', '9'])], new Set(['d1']));
    expect(plan.estimates).toEqual([{ lossDriverId: 'd1', action: 'set', minValue: 1, likelyValue: 4, maxValue: 9 }]);
  });

  it('sets a manual row whose figures changed', () => {
    const plan = planEstimatesSave([row('d1', 'manual')], [row('d1', 'manual', ['1', '5', '9'])], new Set(['d1']));
    expect(plan.estimates).toEqual([{ lossDriverId: 'd1', action: 'set', minValue: 1, likelyValue: 5, maxValue: 9 }]);
  });

  it('ignores a manual row changed only in formatting', () => {
    const plan = planEstimatesSave([row('d1', 'manual')], [row('d1', 'manual', ['1.0', '2', '03'])], new Set(['d1']));
    expect(plan.estimates).toEqual([]);
  });

  it('clears a stored row the analyst removed', () => {
    const plan = planEstimatesSave([row('d1', 'manual')], [], new Set(['d1']));
    expect(plan.estimates).toEqual([{ lossDriverId: 'd1', action: 'clear' }]);
  });

  it('sends nothing for an added row removed before it was ever saved', () => {
    const plan = planEstimatesSave([], [], new Set());
    expect(plan.estimates).toEqual([]);
  });

  it('sets an added row', () => {
    const plan = planEstimatesSave([], [row('d9', 'manual')], new Set());
    expect(plan.estimates).toEqual([{ lossDriverId: 'd9', action: 'set', minValue: 1, likelyValue: 2, maxValue: 3 }]);
  });
});

describe('isRefusalPostureRow', () => {
  const row = (overrides: Partial<Parameters<typeof isRefusalPostureRow>[0]> = {}) => ({
    provenance: 'questionnaire' as const,
    isPosture: true,
    ...overrides,
  });

  it('reads a questionnaire-derived row the server flagged as the refusal posture', () => {
    expect(isRefusalPostureRow(row())).toBe(true);
  });

  it('does not read the flag once the displayed provenance has flipped to manual', () => {
    expect(isRefusalPostureRow(row({ provenance: 'manual' }))).toBe(false);
  });

  it('does not read an ordinary row the server never flagged as the posture', () => {
    expect(isRefusalPostureRow(row({ isPosture: false }))).toBe(false);
  });
});

describe('isRecomputeNoticeStanding', () => {
  const earlier = new Date('2026-01-01T10:00:00Z');
  const later = new Date('2026-01-01T10:00:05Z');

  it('stands while the profile marker says a recompute is owed', () => {
    expect(isRecomputeNoticeStanding(true, later, later)).toBe(true);
  });

  it('stands while the summary is ahead of the rows the table still shows', () => {
    expect(isRecomputeNoticeStanding(false, later, earlier)).toBe(true);
  });

  it('clears once the rows have caught up with the summary', () => {
    expect(isRecomputeNoticeStanding(false, later, later)).toBe(false);
  });

  it('clears when a row is newer than the summary, which reads validated rows only', () => {
    expect(isRecomputeNoticeStanding(false, earlier, later)).toBe(false);
  });

  it('clears on a scenario with no rows on either side', () => {
    expect(isRecomputeNoticeStanding(false, null, null)).toBe(false);
  });

  // The summary's timestamp crosses tRPC as a string while the rows' stays a Date.
  it('compares across the two shapes the timestamps arrive in', () => {
    expect(isRecomputeNoticeStanding(false, later.toISOString(), earlier)).toBe(true);
    expect(isRecomputeNoticeStanding(false, earlier.toISOString(), later)).toBe(false);
  });
});

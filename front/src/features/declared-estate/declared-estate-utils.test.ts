import { describe, expect, it } from 'vitest';
import type { DeclaredEstateDraft } from './declared-estate-utils';
import {
  answerOf,
  answerShapeOf,
  asksExposure,
  changedAnswers,
  DECLARED_ESTATE_KINDS_IN_ASSET_ORDER,
  declaredEstateComparisonChartOf,
  declaredEstateMixOf,
  draftError,
  draftOf,
  EMPTY_DRAFT,
  eventMovesOf,
  eventTypeOf,
  hasUnsavedDrafts,
  pickChoice,
  pickMode,
  representativeCount,
  resolveDrafts,
} from './declared-estate-utils';

const custom = (mode: DeclaredEstateDraft['mode'], low: number | null, high: number | null, internetFacing: boolean | null = null): DeclaredEstateDraft =>
  ({ choice: 'custom', mode, low, high, internetFacing });

describe('declared estate drafts', () => {
  it('should read two bounds a band names as that band, and anything else as an exact number or a range', () => {
    expect(draftOf({ low: 51, high: 250 }, null).choice).toBe('51_250');
    expect(draftOf({ low: 5001, high: 25_000 }, true)).toMatchObject({ choice: 'over_5000', internetFacing: true });
    expect(draftOf({ low: 180, high: 180 }, null)).toEqual(custom('exact', 180, 180));
    expect(draftOf({ low: 100, high: 200 }, null)).toEqual(custom('range', 100, 200));
    expect(draftOf(null, null)).toEqual(EMPTY_DRAFT);
  });

  it('should answer a band, an exact number and a range as a low and a high bound', () => {
    expect(answerOf('workstations', { ...EMPTY_DRAFT, choice: '1001_5000' }).bounds).toEqual({ low: 1001, high: 5000 });
    expect(answerOf('workstations', { ...EMPTY_DRAFT, choice: 'over_5000' }).bounds).toEqual({ low: 5001, high: 25_000 });
    expect(answerOf('workstations', custom('exact', 180, 180)).bounds).toEqual({ low: 180, high: 180 });
    expect(answerOf('workstations', custom('range', 100, 200)).bounds).toEqual({ low: 100, high: 200 });
  });

  it('should flag a specified answer with no number or with its bounds the wrong way round', () => {
    expect(draftError(custom('exact', null, null))).toBe('MISSING_COUNT');
    expect(draftError(custom('range', 10, null))).toBe('MISSING_COUNT');
    expect(draftError(custom('range', 200, 100))).toBe('LOW_ABOVE_HIGH');
    expect(draftError(custom('range', 100, 200))).toBeNull();
  });

  it('should flag a number the answer cannot hold', () => {
    expect(draftError(custom('exact', -1, -1))).toBe('NOT_A_COUNT');
    expect(draftError(custom('exact', 1.5, 1.5))).toBe('NOT_A_COUNT');
    expect(draftError(custom('range', 10, 10_000_001))).toBe('NOT_A_COUNT');
    expect(draftError(custom('range', 0, 10_000_000))).toBeNull();
  });

  it('should hold a draft still being typed as unsaved, though it saves nothing yet', () => {
    expect(hasUnsavedDrafts({ servers: custom('range', 10, null) }, [])).toBe(true);
    expect(hasUnsavedDrafts({ servers: EMPTY_DRAFT }, [])).toBe(false);
  });

  it('should ask the exposure only of a kind that can be exposed and holds at least one asset', () => {
    expect(asksExposure('servers', { ...EMPTY_DRAFT, choice: '1_10' })).toBe(true);
    expect(asksExposure('servers', { ...EMPTY_DRAFT, choice: 'none' })).toBe(false);
    expect(asksExposure('people', { ...EMPTY_DRAFT, choice: '1_10' })).toBe(false);
  });

  it('should drop an exposure the question no longer asks', () => {
    expect(answerOf('servers', { ...EMPTY_DRAFT, choice: 'none', internetFacing: true }).internetFacing).toBeNull();
  });

  it('should clear the answer when the selected band is picked again', () => {
    expect(pickChoice({ ...EMPTY_DRAFT, choice: '11_50' }, null)).toEqual(EMPTY_DRAFT);
  });

  it('should keep the number typed when switching between an exact number and a range', () => {
    expect(pickMode(custom('range', 40, 90), 'exact')).toEqual(custom('exact', 40, 40));
    expect(pickMode(custom('exact', 40, 40), 'range')).toEqual(custom('range', 40, 40));
  });

  it('should send only the kinds whose answer moved, a cleared one with null bounds', () => {
    const stored = [
      { kind: 'servers' as const, bounds: { low: 11, high: 50 }, internetFacing: false },
      { kind: 'people' as const, bounds: { low: 1, high: 10 }, internetFacing: null },
    ];

    expect(changedAnswers({
      servers: draftOf({ low: 11, high: 50 }, false),
      people: EMPTY_DRAFT,
      workstations: { ...EMPTY_DRAFT, choice: '51_250' },
    }, stored)).toEqual([
      { kind: 'workstations', bounds: { low: 51, high: 250 }, internetFacing: null },
      { kind: 'people', bounds: null, internetFacing: null },
    ]);
  });

  it('should send nothing for a new scope whose kinds were all left or put back unanswered', () => {
    const putBack = pickChoice({ ...EMPTY_DRAFT, choice: '1_10' }, null);

    expect(changedAnswers({}, [])).toEqual([]);
    expect(changedAnswers({ servers: EMPTY_DRAFT, people: putBack }, [])).toEqual([]);
    expect(hasUnsavedDrafts({ people: putBack }, [])).toBe(false);
  });

  it('should prefer the reader\'s edit over the stored answer, kind by kind', () => {
    const drafts = resolveDrafts({ servers: { ...EMPTY_DRAFT, choice: '1_10' } }, [
      { kind: 'servers', bounds: { low: 11, high: 50 }, internetFacing: null },
      { kind: 'people', bounds: { low: 11, high: 50 }, internetFacing: null },
    ]);

    expect(drafts.size).toBe(12);
    expect(drafts.get('servers')?.choice).toBe('1_10');
    expect(drafts.get('people')?.choice).toBe('11_50');
    expect(drafts.get('workstations')).toEqual(EMPTY_DRAFT);
  });

  it('should read an answer for the history as a band, one number or a range', () => {
    expect(answerShapeOf(null)).toEqual({ type: 'none' });
    expect(answerShapeOf({ low: 0, high: 0 })).toEqual({ type: 'band', band: 'none' });
    expect(answerShapeOf({ low: 7, high: 7 })).toEqual({ type: 'exact', count: 7 });
    expect(answerShapeOf({ low: 7, high: 9 })).toEqual({ type: 'range', low: 7, high: 9 });
  });

  it('should read a journal line as a first answer, a change or a clearing', () => {
    const answered = { bounds: { low: 11, high: 50 }, internetFacing: null };
    const empty = { bounds: null, internetFacing: null };

    expect(eventTypeOf(empty, answered)).toBe('set');
    expect(eventTypeOf(answered, { ...answered, internetFacing: true })).toBe('change');
    expect(eventTypeOf(answered, empty)).toBe('clear');
  });

  it('should list only the parts of an answer a journal line moved', () => {
    const before = { bounds: { low: 11, high: 50 }, internetFacing: false };

    expect(eventMovesOf(before, { bounds: { low: 180, high: 180 }, internetFacing: true })).toEqual(['count', 'exposure']);
    expect(eventMovesOf(before, { ...before, internetFacing: true })).toEqual(['exposure']);
    expect(eventMovesOf(before, { ...before, bounds: { low: 11, high: 60 } })).toEqual(['count']);
  });
});

describe('declared estate mix', () => {
  it('should list the kinds in the order the assets page lists their categories, a split category keeping its kinds together', () => {
    expect(DECLARED_ESTATE_KINDS_IN_ASSET_ORDER).toEqual([
      'workstations', 'servers', 'containers', 'cloud_resources', 'web_applications', 'network_devices',
      'mobile_devices', 'iot_ot_devices', 'people', 'service_accounts', 'saas_applications', 'ai_systems',
    ]);
  });

  it('should read a range on a log scale, a range from 0 linearly and an exact number as itself', () => {
    expect(Math.round(representativeCount({ low: 1001, high: 5000 }))).toBe(2237);
    expect(representativeCount({ low: 0, high: 10 })).toBe(5);
    expect(representativeCount({ low: 180, high: 180 })).toBe(180);
  });

  it('should group the answered kinds per category, largest first, and list the unanswered ones apart', () => {
    const mix = declaredEstateMixOf([
      { kind: 'web_applications', bounds: { low: 1, high: 10 }, internetFacing: false },
      { kind: 'servers', bounds: { low: 180, high: 180 }, internetFacing: true },
      { kind: 'workstations', bounds: { low: 251, high: 1000 }, internetFacing: null },
      { kind: 'people', bounds: { low: 400, high: 450 }, internetFacing: null },
      { kind: 'cloud_resources', bounds: { low: 0, high: 0 }, internetFacing: null },
      { kind: 'mobile_devices', bounds: null, internetFacing: null },
    ]);

    expect(mix.categories.map((category) => category.category)).toEqual(['host', 'identity', 'web_application', 'cloud_resource']);
    expect(mix.categories[0]).toMatchObject({ low: 431, high: 1180, internetFacing: true });
    expect(mix.categories[0].kinds.map((entry) => entry.kind)).toEqual(['workstations', 'servers']);
    expect(mix.categories[3]).toMatchObject({ size: 0, internetFacing: false });
    expect(mix.largest).toBe(mix.categories[0].size);
    expect(mix).toMatchObject({ low: 832, high: 1640 });
    expect(mix.unanswered).toEqual(['containers', 'network_devices', 'mobile_devices', 'iot_ot_devices', 'service_accounts', 'saas_applications', 'ai_systems']);
  });
});

describe('declaredEstateComparisonChartOf', () => {
  it('should add up each category, the largest of measure and declaration first, on one scale', () => {
    const chart = declaredEstateComparisonChartOf([
      { kind: 'workstations', bounds: { low: 1001, high: 5000 }, measured: 291, state: 'below' },
      { kind: 'servers', bounds: { low: 11, high: 50 }, measured: 38, state: 'within' },
      { kind: 'people', bounds: { low: 400, high: 450 }, measured: 410, state: 'within' },
      { kind: 'service_accounts', bounds: null, measured: 64, state: 'not_declared' },
      { kind: 'saas_applications', bounds: null, measured: 24, state: 'not_declared' },
      { kind: 'cloud_resources', bounds: { low: 11, high: 50 }, measured: 0, state: 'none_measured' },
      { kind: 'containers', bounds: null, measured: 0, state: 'not_declared' },
    ]);

    expect(chart.rows.map((row) => row.category)).toEqual(['host', 'identity', 'cloud_resource', 'saas_application']);
    expect(chart.rows[0]).toEqual({ category: 'host', measured: 329, bounds: { low: 1012, high: 5050 }, partial: false });
    expect(chart.rows[1]).toEqual({ category: 'identity', measured: 474, bounds: { low: 400, high: 450 }, partial: true });
    expect(chart.rows[3]).toEqual({ category: 'saas_application', measured: 24, bounds: null, partial: false });
    expect(chart.largest).toBe(5050);
    expect(chart.declares).toBe(true);
  });

  it('should tell a chart with nothing declared, as on the whole tenant', () => {
    const chart = declaredEstateComparisonChartOf([
      { kind: 'servers', bounds: null, measured: 4, state: 'not_declared' },
      { kind: 'people', bounds: null, measured: 9, state: 'not_declared' },
    ]);

    expect(chart.rows.map((row) => row.category)).toEqual(['identity', 'host']);
    expect(chart.largest).toBe(9);
    expect(chart.declares).toBe(false);
  });
});

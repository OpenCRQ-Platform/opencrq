import { i18n } from '@lingui/core';
import type { ChangeCategoryKey, ChangeEvent } from '@app/module/client';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ChangesRun, ChronologyInput } from './run-changes-utils';
import { formatFractionAsPercent } from '../../../../utils/format-number';
import { DEFENCES_DIGITS, formatDefences } from '../overview/ale-decomposition-utils';
import {
  buildChronology,
  buildCurve,
  clickRange,
  curveView,
  curveXs,
  draggedRange,
  easeInOut,
  localDayBounds,
  matchingPeriod,
  moveRangeEnd,
  pairOfChanges,
  periodRange,
  readTiles,
  resolveComparedPair,
  spanRange,
  stepToward,
  TAB_VALUE,
  timeAtX,
  timeX,
} from './run-changes-utils';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

const run = (id: string, day: number, overrides: Partial<ChangesRun> = {}): ChangesRun => ({
  id,
  createdAt: new Date(Date.UTC(2026, 9, day)).toISOString(),
  ale: 1_000_000 * day,
  tef: 4,
  susceptibility: 0.25,
  magnitude: 2_000_000,
  ...overrides,
});

const fiveRuns = [run('r5', 5), run('r4', 4), run('r3', 3), run('r2', 2), run('r1', 1)];

const event = (overrides: Partial<ChangeEvent>): ChangeEvent => ({
  category: 'run-results',
  moment: { kind: 'balance' },
  direction: 'up',
  item: { kind: 'run-figure', key: 'tef', label: null, link: null },
  sentence: { key: 'value-changed', parts: {} },
  values: null,
  ...overrides,
});

describe('resolveComparedPair', () => {
  it('compares the latest run with the last one at least seven days older by default', () => {
    const pair = resolveComparedPair([run('r20', 20), run('r15', 15), run('r13', 13), run('r9', 9), run('r1', 1)], undefined, undefined);

    expect([pair?.before.id, pair?.after.id]).toEqual(['r13', 'r20']);
  });

  it('falls back to the oldest run when the history is shorter than seven days', () => {
    expect(resolveComparedPair(fiveRuns, undefined, undefined)?.before.id).toBe('r1');
  });

  it('takes the two runs the address names, the earlier as before whatever their order', () => {
    const pair = resolveComparedPair(fiveRuns, 'r4', 'r2');

    expect([pair?.before.id, pair?.after.id]).toEqual(['r2', 'r4']);
  });

  it('falls back to the default on an unknown or repeated run', () => {
    expect(resolveComparedPair(fiveRuns, 'gone', 'r2')?.after.id).toBe('r5');
    expect(resolveComparedPair(fiveRuns, 'r2', 'r2')?.before.id).toBe('r1');
  });

  it('answers null with fewer than two runs', () => {
    expect(resolveComparedPair([run('r1', 1)], undefined, undefined)).toBeNull();
  });
});

describe('pairOfChanges', () => {
  const compared = { before: fiveRuns[1], after: fiveRuns[0] };

  it('reads the pair the changes on screen were computed for, not the pair just picked', () => {
    const pair = pairOfChanges(fiveRuns, { before: { id: 'r1' }, after: { id: 'r3' } }, compared);

    expect([pair.before.id, pair.after.id]).toEqual(['r1', 'r3']);
  });

  it('falls back to the compared pair when a run of the changes is no longer in the history', () => {
    expect(pairOfChanges(fiveRuns, { before: { id: 'gone' }, after: { id: 'r3' } }, compared)).toBe(compared);
  });
});

describe('the tab figures', () => {
  it('read the loss, the TEF, the susceptibility in percent and the magnitude', () => {
    const reading = run('r', 1);

    expect(TAB_VALUE.ale(reading)).toBe(1_000_000);
    expect(TAB_VALUE.tef(reading)).toBe(4);
    expect(TAB_VALUE.susceptibility(reading)).toBe(25);
    expect(TAB_VALUE.magnitude(reading)).toBe(2_000_000);
  });

  it('read the susceptibility in percent scaled in decimal, as the change list prints the same run', () => {
    const atHalf = { ...run('r', 1), susceptibility: 0.0185 };
    expect(formatDefences(TAB_VALUE.susceptibility(atHalf)!)).toBe(formatFractionAsPercent(0.0185, DEFENCES_DIGITS));
    expect(formatDefences(TAB_VALUE.susceptibility(atHalf)!)).toBe('1.9%');
  });

  it('draw every run oldest first', () => {
    expect(buildCurve(fiveRuns, 'ale').map((point) => point.runId)).toEqual(['r1', 'r2', 'r3', 'r4', 'r5']);
  });
});

describe('the compared range', () => {
  const daily = buildCurve([run('r40', 40), run('r39', 39), run('r20', 20), run('r9', 9), run('r1', 1)], 'ale');

  it('places each run by its date', () => {
    expect(curveXs(daily).map((x) => Math.round(x * 39))).toEqual([0, 8, 19, 38, 39]);
  });

  it('places a time on the same scale, clamped to the curve', () => {
    expect(Math.round(timeX(daily, new Date(Date.UTC(2026, 9, 20))) * 39)).toBe(19);
    expect(timeX(daily, new Date(Date.UTC(2026, 11, 1)))).toBe(1);
  });

  it('bounds a time by its local day', () => {
    expect(localDayBounds(new Date(2026, 9, 2, 16, 5))).toEqual([new Date(2026, 9, 2), new Date(2026, 9, 3)]);
  });

  it('compares the latest run with the previous one, or with the last run at least the period older', () => {
    expect(periodRange(daily, 'previous')).toEqual([3, 4]);
    expect(periodRange(daily, '7d')).toEqual([2, 4]);
    expect(periodRange(daily, '30d')).toEqual([1, 4]);
  });

  it('falls back to the oldest run when the history is shorter than the period', () => {
    expect(periodRange(daily, '90d')).toEqual([0, 4]);
  });

  it('names the first period giving the compared range, and none for a range picked on the curve', () => {
    expect(matchingPeriod(daily, [3, 4])).toBe('previous');
    expect(matchingPeriod(daily, [0, 4])).toBe('90d');
    expect(matchingPeriod(daily, [1, 2])).toBeNull();
  });

  it('never moves an end onto or past the other', () => {
    expect(moveRangeEnd([1, 3], 'before', 4)).toEqual([2, 3]);
    expect(moveRangeEnd([1, 3], 'after', 0)).toEqual([1, 2]);
    expect(moveRangeEnd([1, 3], 'after', 4)).toEqual([1, 4]);
  });

  it('moves the nearer end onto a clicked run', () => {
    expect(clickRange([2, 6], 0)).toEqual([0, 6]);
    expect(clickRange([2, 6], 3)).toEqual([3, 6]);
    expect(clickRange([2, 6], 5)).toEqual([2, 5]);
    expect(clickRange([2, 6], 8)).toEqual([2, 8]);
    expect(clickRange([2, 6], 6)).toEqual([2, 6]);
  });

  it('spans a drag in either direction once it has left its run', () => {
    expect(spanRange(4, 4)).toBeNull();
    expect(spanRange(4, 1)).toEqual([1, 4]);
  });

  it('reads a drag at the pointer, an end within the range and a span from where it started', () => {
    expect(draggedRange([2, 6], { kind: 'end', end: 'before' }, 0)).toEqual([0, 6]);
    expect(draggedRange([2, 6], { kind: 'span', start: 8 }, 3)).toEqual([3, 8]);
    expect(draggedRange([2, 6], { kind: 'span', start: 8 }, 8)).toBeNull();
  });

  it('shows the whole history unzoomed and the compared range, padded, once zoomed', () => {
    const xs = [0, 0.5, 0.6, 1];
    expect(curveView(xs, [1, 2], 0)).toEqual({ from: 0, to: 1 });
    const zoomed = curveView(xs, [1, 2], 1);
    expect(zoomed.from).toBeCloseTo(0.496);
    expect(zoomed.to).toBeCloseTo(0.604);
  });

  it('steps a progress toward its target at its pace, never past it', () => {
    expect(stepToward(0, 1, 100, 400)).toBeCloseTo(0.25);
    expect(stepToward(0.9, 1, 100, 400)).toBe(1);
    expect(stepToward(0.5, 0, 100, 400)).toBeCloseTo(0.25);
    expect(stepToward(0.2, 0, 100, 400)).toBe(0);
    expect(stepToward(0, 1, 16, 0)).toBe(1);
  });

  it('reads the time a position stands for, beyond the history as well', () => {
    const points = buildCurve([run('r3', 11), run('r1', 1)], 'ale');
    expect(timeAtX(points, 0.5)).toEqual(new Date(Date.UTC(2026, 9, 6)));
    expect(timeAtX(points, -0.1)).toEqual(new Date(Date.UTC(2026, 9, 0)));
  });

  it('eases a progress in and out around its middle', () => {
    expect([0, 0.25, 0.5, 0.75, 1].map(easeInOut)).toEqual([0, 0.125, 0.5, 0.875, 1]);
  });
});

describe('tiles and chronology', () => {
  const categories = [
    { key: 'run-results' as const, tabs: ['ale' as const, 'magnitude' as const] },
    { key: 'model' as const, tabs: ['ale' as const] },
  ];
  const events = [
    event({ direction: 'up' }),
    event({ direction: 'down', item: { kind: 'actor-class-share', key: 'state_sponsored', label: null, link: null } }),
    event({ category: 'model', direction: 'none', item: { kind: 'model-setting', key: 'catalogue-vintage', label: null, link: null } }),
  ];

  it('count each tile\'s ups, downs and neutral changes', () => {
    expect(readTiles(categories, events, 'ale')).toEqual([
      { key: 'run-results', up: 1, down: 1, neutral: 0 },
      { key: 'model', up: 0, down: 0, neutral: 1 },
    ]);
  });

  it('show only the tiles of the tab', () => {
    expect(readTiles(categories, events, 'magnitude').map((tile) => tile.key)).toEqual(['run-results']);
  });

  const compared = (list: ReadonlyArray<ChangeEvent>, runs: ChronologyInput['runs'] = []): ChronologyInput => ({
    before: { id: 'before', readAt: '2026-09-29T10:00:00.000Z' },
    after: { id: 'after', readAt: '2026-10-06T10:00:00.000Z' },
    runs,
    events: list,
  });

  it('leave only the rows of the selected tiles, and every row of the tab without a filter', () => {
    const tiles = readTiles(categories, events, 'ale');
    const categoriesOf = (filter: ReadonlyArray<ChangeCategoryKey>) => buildChronology(compared(events), tiles, filter).balance.map((row) => row.category);

    expect(categoriesOf(['model'])).toEqual(['model']);
    expect(categoriesOf(['run-results', 'model'])).toEqual(['run-results', 'run-results', 'model']);
    expect(categoriesOf([])).toHaveLength(3);
  });

  const cveGroup = (at: string, group: Pick<NonNullable<ChangeEvent['group']>, 'kind' | 'up' | 'down' | 'bands'>): ChangeEvent => event({
    category: 'findings-other',
    moment: { kind: 'recorded', at },
    direction: group.up >= group.down ? 'up' : 'down',
    item: { kind: 'cve-group', key: group.kind, label: null, link: null },
    sentence: { key: 'cve-group', parts: { count: group.up + group.down } },
    group: { ...group, from: at, to: at },
  });
  const otherFindings = [{ key: 'findings-other' as const, tabs: ['ale' as const] }, { key: 'technique-coverage' as const, tabs: ['ale' as const] }];

  it('count a group of CVEs in its tile as its ups and downs, not as one change', () => {
    const groups = [
      cveGroup('2026-10-02T09:00:00.000Z', { kind: 'appeared', up: 15_230, down: 0, bands: [{ from: null, to: 'medium', count: 15_230 }] }),
      cveGroup('2026-10-03T09:00:00.000Z', { kind: 'band-moved', up: 38, down: 7, bands: [{ from: 'low', to: 'medium', count: 38 }, { from: 'medium', to: 'low', count: 7 }] }),
    ];

    expect(readTiles(otherFindings, groups, 'ale')).toEqual([
      { key: 'findings-other', up: 15_268, down: 7, neutral: 0 },
      { key: 'technique-coverage', up: 0, down: 0, neutral: 0 },
    ]);
  });

  it('count a group of first measured assets in its tile as neutral changes, beside the ups and downs of the posture moves', () => {
    const assetGroup = (at: string, group: Pick<NonNullable<ChangeEvent['group']>, 'kind' | 'up' | 'down' | 'bands'>): ChangeEvent => event({
      category: 'assets-other',
      moment: { kind: 'recorded', at },
      direction: group.up + group.down === 0 ? 'none' : 'up',
      item: { kind: 'asset-group', key: group.kind, label: null, link: null },
      sentence: { key: 'asset-group', parts: {} },
      group: { ...group, from: at, to: at },
    });
    const groups = [
      assetGroup('2026-10-02T09:00:00.000Z', { kind: 'first-measured', up: 0, down: 0, bands: [{ from: null, to: 'medium', count: 150 }, { from: null, to: null, count: 22 }] }),
      assetGroup('2026-10-03T09:00:00.000Z', { kind: 'posture-moved', up: 51, down: 17, bands: [{ from: 'low', to: 'medium', count: 51 }, { from: 'medium', to: 'low', count: 17 }] }),
    ];

    expect(readTiles([{ key: 'assets-other' as const, tabs: ['ale' as const] }], groups, 'ale')).toEqual([
      { key: 'assets-other', up: 51, down: 17, neutral: 172 },
    ]);
  });

  it('keep two groups of one kind apart around a run drawn between them, and join them once that run is filtered out', () => {
    const rows = [
      cveGroup('2026-10-02T08:00:00.000Z', { kind: 'appeared', up: 3, down: 0, bands: [{ from: null, to: 'medium', count: 2 }, { from: null, to: 'low', count: 1 }] }),
      event({ category: 'technique-coverage', moment: { kind: 'run', runId: 'middle' }, item: { kind: 'technique-family', key: 'T1078/identity', label: null, link: null } }),
      cveGroup('2026-10-02T15:00:00.000Z', { kind: 'appeared', up: 4, down: 0, bands: [{ from: null, to: 'low', count: 4 }] }),
      cveGroup('2026-10-02T16:00:00.000Z', { kind: 'left', up: 0, down: 2, bands: [{ from: 'medium', to: null, count: 2 }] }),
    ];
    const input = compared(rows, [{ id: 'middle', readAt: '2026-10-02T12:00:00.000Z' }]);
    const tiles = readTiles(otherFindings, rows, 'ale');

    expect(buildChronology(input, tiles, []).nodes.map((node) => node.events.map((row) => row.group?.up ?? row.item.kind))).toEqual([
      [3],
      ['technique-family'],
      [4, 0],
    ]);

    const [joined] = buildChronology(input, tiles, ['findings-other']).nodes;
    expect(joined.events.map((row) => row.group)).toEqual([
      {
        kind: 'appeared',
        from: '2026-10-02T08:00:00.000Z',
        to: '2026-10-02T15:00:00.000Z',
        up: 7,
        down: 0,
        bands: [{ from: null, to: 'low', count: 5 }, { from: null, to: 'medium', count: 2 }],
      },
      { kind: 'left', from: '2026-10-02T16:00:00.000Z', to: '2026-10-02T16:00:00.000Z', up: 0, down: 2, bands: [{ from: 'medium', to: null, count: 2 }] },
    ]);
    expect(rows[0].group?.up).toBe(3);
  });

  it('keep two Critical groups apart around Critical rows listed between them, once the runs splitting them are filtered out', () => {
    const critical = (at: string, up: number): ChangeEvent => ({
      ...cveGroup(at, { kind: 'appeared', up, down: 0, bands: [{ from: null, to: 'critical', count: up }] }),
      category: 'findings-critical',
    });
    const rows = [
      critical('2026-10-02T08:00:00.000Z', 8),
      event({ category: 'technique-coverage', moment: { kind: 'run', runId: 'first' }, item: { kind: 'technique-family', key: 'T1078/identity', label: null, link: null } }),
      event({ category: 'findings-critical', moment: { kind: 'recorded', at: '2026-10-02T11:00:00.000Z' }, item: { kind: 'cve', key: 'CVE-2024-3400', label: 'CVE-2024-3400', link: null } }),
      event({ category: 'technique-coverage', moment: { kind: 'run', runId: 'second' }, item: { kind: 'technique-family', key: 'T1133/edge', label: null, link: null } }),
      critical('2026-10-02T15:00:00.000Z', 7),
    ];
    const input = compared(rows, [{ id: 'first', readAt: '2026-10-02T10:00:00.000Z' }, { id: 'second', readAt: '2026-10-02T12:00:00.000Z' }]);
    const tiles = readTiles([{ key: 'findings-critical' as const, tabs: ['ale' as const] }, ...otherFindings], rows, 'ale');

    const [node] = buildChronology(input, tiles, ['findings-critical']).nodes;
    expect(node.events.map((row) => row.group?.up ?? row.item.key)).toEqual([8, 'CVE-2024-3400', 7]);
  });

  it('place each change where it becomes observable: recorded ones by local day, a run\'s on its node, the later run\'s above the balance', () => {
    const tiles = readTiles(categories, events, 'ale');
    const chronology = buildChronology(compared([
      event({ moment: { kind: 'recorded', at: '2026-10-01T09:00:00.000Z' } }),
      event({ moment: { kind: 'recorded', at: '2026-10-01T15:00:00.000Z' } }),
      event({ moment: { kind: 'run', runId: 'middle' } }),
      event({ moment: { kind: 'run', runId: 'middle' } }),
      event({ moment: { kind: 'recorded', at: '2026-10-04T12:00:00.000Z' } }),
      event({ moment: { kind: 'run', runId: 'after' } }),
      event({}),
    ], [{ id: 'middle', readAt: '2026-10-03T11:20:00.000Z' }]), tiles, []);

    expect(chronology.nodes.map((node) => [node.kind, node.events.length, node.marker.kind])).toEqual([
      ['recorded', 2, 'day'],
      ['run', 2, 'run'],
      ['recorded', 1, 'day'],
    ]);
    expect(chronology.nodes[1].at.toISOString()).toBe('2026-10-03T11:20:00.000Z');
    expect(chronology.after.events).toHaveLength(1);
    expect(chronology.after.marker).toEqual({ kind: 'run', runId: 'after', at: new Date('2026-10-06T10:00:00.000Z') });
    expect(chronology.balance).toHaveLength(1);
  });

  it('give the time to every stop sharing its day, and split a day\'s recorded changes around its run', () => {
    const tiles = readTiles(categories, events, 'ale');
    const chronology = buildChronology(compared([
      event({ moment: { kind: 'recorded', at: '2026-10-02T09:00:00.000Z' } }),
      event({ moment: { kind: 'run', runId: 'middle' } }),
      event({ moment: { kind: 'recorded', at: '2026-10-02T16:05:00.000Z' } }),
      event({ moment: { kind: 'recorded', at: '2026-10-03T12:00:00.000Z' } }),
    ], [{ id: 'middle', readAt: '2026-10-02T11:20:00.000Z' }]), tiles, []);

    expect(chronology.nodes.map((node) => [node.kind, node.withTime, node.marker.kind])).toEqual([
      ['recorded', true, 'moment'],
      ['run', true, 'run'],
      ['recorded', true, 'moment'],
      ['recorded', false, 'day'],
    ]);
    expect([chronology.before.withTime, chronology.after.withTime]).toEqual([false, false]);
  });

  it('give the time to both ends when they fall on the same day', () => {
    const chronology = buildChronology({
      before: { id: 'before', readAt: '2026-10-07T08:12:00.000Z' },
      after: { id: 'after', readAt: '2026-10-07T14:02:00.000Z' },
      runs: [],
      events: [],
    }, [], []);

    expect([chronology.before.withTime, chronology.after.withTime]).toEqual([true, true]);
  });
});

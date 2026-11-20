import { describe, expect, it } from 'vitest';
import { observedAtSortValue, readActivityWindow } from './activity-utils';

describe('observedAtSortValue', () => {
  it('gives the instant of a Date', () => {
    const observed = new Date('2026-06-01T00:00:00.000Z');

    expect(observedAtSortValue(observed)).toBe(observed.getTime());
  });

  it('reads an ISO string like the equivalent Date', () => {
    const observed = new Date('2026-06-01T08:30:00.000Z');

    expect(observedAtSortValue(observed.toISOString())).toBe(observedAtSortValue(observed));
  });

  it('puts a more recent observation above an older one', () => {
    const recent = observedAtSortValue('2026-06-10T00:00:00.000Z')!;
    const older = observedAtSortValue('2026-03-10T00:00:00.000Z')!;

    expect(recent).toBeGreaterThan(older);
  });

  it('has no value for a threat never observed', () => {
    expect(observedAtSortValue(null)).toBeUndefined();
  });

  it('has no value for an unparseable date', () => {
    expect(observedAtSortValue('not a date')).toBeUndefined();
  });
});

describe('readActivityWindow', () => {
  const now = new Date('2026-11-18T10:00:00.000Z');
  const window = (relStartTime: string | null, relStopTime: string | null) => ({ relStartTime, relStopTime });

  it('reads a window the source closed in the past as closed', () => {
    expect(readActivityWindow(window('2026-01-01T00:00:00.000Z', '2026-06-30T00:00:00.000Z'), now)).toEqual({
      kind: 'closed',
      opensAt: new Date('2026-01-01T00:00:00.000Z'),
      closesAt: new Date('2026-06-30T00:00:00.000Z'),
    });
  });

  it('reads a window with no end as still open', () => {
    expect(readActivityWindow(window('2026-01-01T00:00:00.000Z', null), now))
      .toEqual({ kind: 'open', opensAt: new Date('2026-01-01T00:00:00.000Z') });
  });

  it('reads a window the source closes in the future as still open', () => {
    expect(readActivityWindow(window('2026-01-01T00:00:00.000Z', '2026-12-31T00:00:00.000Z'), now))
      .toEqual({ kind: 'open', opensAt: new Date('2026-01-01T00:00:00.000Z') });
  });

  it('keeps a window closing in the future with no start open, not unstated', () => {
    expect(readActivityWindow(window(null, '2026-12-31T00:00:00.000Z'), now)).toEqual({ kind: 'open', opensAt: null });
  });

  it('reads a start in the future as now', () => {
    expect(readActivityWindow(window('2027-01-01T00:00:00.000Z', '2027-12-31T00:00:00.000Z'), now))
      .toEqual({ kind: 'open', opensAt: now });
  });

  it('reads a window with neither date as unstated', () => {
    expect(readActivityWindow(window(null, null), now)).toEqual({ kind: 'unstated' });
  });
});

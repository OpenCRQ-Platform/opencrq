import type { CoverageBucket, StrengthRung } from '@app/module/client';
import { describe, expect, it } from 'vitest';
import type { CapabilityEvent } from '../types/capability';
import type { EffectivenessHistoryLine } from './effectiveness-lifeline-utils';
import { buildEffectivenessLifeline } from './effectiveness-lifeline-utils';

const DAY_MS = 86_400_000;
const NOW = new Date(Date.UTC(2026, 9, 6, 12));
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * DAY_MS);

const event = (id: string): CapabilityEvent => ({
  id,
  capabilityId: 'c',
  tenantId: 't',
  organizationId: null,
  userId: 'u',
  connector: null,
  type: 'assessment_change',
  oldStrength: null,
  newStrength: null,
  oldCoverage: null,
  newCoverage: null,
  strengthMode: null,
  coverageMode: null,
  comment: null,
  createdAt: '',
  userName: 'Alice',
  sources: [],
});

const line = (
  days: number,
  posture: [StrengthRung, CoverageBucket] | null,
  id: string | null = `e${days}`,
): EffectivenessHistoryLine => ({
  at: daysAgo(days),
  posture: posture === null
    ? null
    : { strengthRung: posture[0], coverageBucket: posture[1], strengthSource: 'tenant', coverageSource: 'tenant' },
  event: id === null ? null : event(id),
});

describe('buildEffectivenessLifeline', () => {
  it('should return nothing when no effectiveness was ever recorded', () => {
    expect(buildEffectivenessLifeline([], '90d', NOW)).toBeNull();
  });

  it('should open on the value in force when the window opens, unmarked, and hold the last value to now', () => {
    const lifeline = buildEffectivenessLifeline([
      line(240, ['L1', 'L2']),
      line(60, ['L2', 'L2']),
    ], '90d', NOW)!;

    expect(lifeline.values).toEqual([39, 59, 59]);
    expect(lifeline.start).toEqual(daysAgo(90));
    expect(lifeline.end).toEqual(NOW);
    expect(lifeline.marks).toHaveLength(1);
    expect(lifeline.marks[0]).toMatchObject({ value: 59, previous: 39, event: { id: 'e60' } });
    expect(lifeline.change).toBe(20);
  });

  it('should break the curve where the control was not assessed', () => {
    const lifeline = buildEffectivenessLifeline([
      line(40, ['L2', 'L3']),
      line(30, null),
      line(20, ['L1', 'L1']),
    ], '90d', NOW)!;

    expect(lifeline.values).toContain(null);
    expect(lifeline.marks.map((mark) => mark.previous)).toEqual([null, 84, null]);
  });

  it('should mark the line clearing the assessment at the end of the stretch it breaks', () => {
    const lifeline = buildEffectivenessLifeline([
      line(40, ['L2', 'L3']),
      line(30, null),
      line(20, ['L1', 'L1']),
    ], '90d', NOW)!;

    const cleared = lifeline.marks[1];
    expect(cleared).toMatchObject({ value: null, previous: 84, event: { id: 'e30' } });
    expect(lifeline.values[cleared.pointIndex]).toBe(84);
    expect(lifeline.values[cleared.pointIndex + 1]).toBeNull();
  });

  it('should fold a line scoring as the one before it', () => {
    const lifeline = buildEffectivenessLifeline([
      line(40, ['L2', 'L2']),
      line(30, ['L2', 'L2'], 'e30'),
      line(20, ['L3', 'L3']),
    ], '90d', NOW)!;

    expect(lifeline.marks.map((mark) => mark.event.id)).toEqual(['e40', 'e20']);
  });

  it('should tell a control declared absent from one with no coverage, though both score zero', () => {
    const lifeline = buildEffectivenessLifeline([
      line(40, ['L0', 'L3']),
      line(20, ['L2', 'L0']),
    ], '90d', NOW)!;

    expect(lifeline.marks).toHaveLength(2);
  });

  it('should draw the line anchoring on the live value without a mark', () => {
    const lifeline = buildEffectivenessLifeline([
      line(40, ['L1', 'L1']),
      line(1, ['L2', 'L3'], null),
    ], '90d', NOW)!;

    expect(lifeline.values.slice(0, 2)).toEqual([22, 84]);
    expect(lifeline.marks.map((mark) => mark.event.id)).toEqual(['e40']);
    expect(lifeline.latest).toBe(84);
  });

  it('should report the lowest and highest values drawn', () => {
    const lifeline = buildEffectivenessLifeline([
      line(40, ['L1', 'L1']),
      line(30, ['L3', 'L3']),
      line(20, ['L2', 'L2']),
    ], '90d', NOW)!;

    expect(lifeline.min).toBe(22);
    expect(lifeline.max).toBe(100);
  });

  it('should hold a single value flat from its date to now', () => {
    const lifeline = buildEffectivenessLifeline([line(10, ['L2', 'L2'])], '90d', NOW)!;

    expect(lifeline.values).toEqual([59, 59]);
    expect(lifeline.xs).toEqual([0, 1]);
    expect(lifeline.min).toBe(lifeline.max);
    expect(lifeline.marks[0]).toMatchObject({ x: 0, previous: null });
  });
});

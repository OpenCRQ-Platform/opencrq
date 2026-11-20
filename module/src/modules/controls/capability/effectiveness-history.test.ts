import { describe, expect, it } from 'vitest';
import type { CoverageBucket, StrengthRung } from './constants';
import type { ReplayedEvent } from './effectiveness-history';
import type { ResolvedPosture } from './scope-posture';
import { replayEffectivenessHistory } from './effectiveness-history';

const READ_AT = new Date('2026-10-06T12:00:00Z');
const SCOPE = 'org-1';

let sequence = 0;
const line = (
  day: number,
  newStrength: StrengthRung | null,
  newCoverage: CoverageBucket | null,
  organizationId: string | null = null,
): ReplayedEvent => {
  sequence += 1;
  return {
    id: `id-${String(sequence).padStart(4, '0')}`,
    organizationId,
    newStrength,
    newCoverage,
    createdAt: new Date(Date.UTC(2026, 0, day)),
  };
};

const tenantPosture = (strengthRung: StrengthRung, coverageBucket: CoverageBucket): ResolvedPosture => ({
  strengthRung,
  coverageBucket,
  strengthSource: 'tenant',
  coverageSource: 'tenant',
});

const strengthOnScope = (strengthRung: StrengthRung, coverageBucket: CoverageBucket): ResolvedPosture => ({
  ...tenantPosture(strengthRung, coverageBucket),
  strengthSource: 'scope',
});

const pairs = (lines: ReturnType<typeof replayEffectivenessHistory>) =>
  lines.map(({ posture }) => (posture === null ? null : `${posture.strengthRung}/${posture.coverageBucket}`));

describe('replayEffectivenessHistory', () => {
  it('replays the tenant declaration line by line', () => {
    const events = [line(1, 'L1', 'L1'), line(5, 'L2', 'L1'), line(9, 'L2', 'L3')];
    const lines = replayEffectivenessHistory(events, tenantPosture('L2', 'L3'), false, READ_AT);

    expect(pairs(lines)).toEqual(['L1/L1', 'L2/L1', 'L2/L3']);
    expect(lines.map(({ event }) => event)).toEqual(events);
  });

  it('reads a scope declaration over the tenant, the undeclared axis inherited', () => {
    const lines = replayEffectivenessHistory(
      [line(1, 'L1', 'L1'), line(5, 'L3', null, SCOPE)],
      strengthOnScope('L3', 'L1'),
      true,
      READ_AT,
    );

    expect(pairs(lines)).toEqual(['L1/L1', 'L3/L1']);
    expect(lines[1].posture).toMatchObject({ strengthSource: 'scope', coverageSource: 'tenant' });
  });

  it('follows the tenant again once the scope hands an axis back', () => {
    const lines = replayEffectivenessHistory(
      [line(1, 'L1', 'L1'), line(5, 'L3', null, SCOPE), line(9, null, null, SCOPE)],
      tenantPosture('L1', 'L1'),
      true,
      READ_AT,
    );

    expect(pairs(lines)).toEqual(['L1/L1', 'L3/L1', 'L1/L1']);
  });

  it('draws nothing for a tenant move on an axis the scope declares', () => {
    const tenantMove = line(9, 'L2', 'L1');
    const lines = replayEffectivenessHistory(
      [line(1, 'L1', 'L1'), line(5, 'L3', null, SCOPE), tenantMove],
      strengthOnScope('L3', 'L1'),
      true,
      READ_AT,
    );

    expect(lines.map(({ event }) => event)).not.toContain(tenantMove);
    expect(pairs(lines)).toEqual(['L1/L1', 'L3/L1']);
  });

  it('draws a tenant move on an axis the scope inherits', () => {
    const tenantMove = line(9, 'L1', 'L3');
    const lines = replayEffectivenessHistory(
      [line(1, 'L1', 'L1'), line(5, 'L3', null, SCOPE), tenantMove],
      strengthOnScope('L3', 'L3'),
      true,
      READ_AT,
    );

    expect(lines.at(-1)).toMatchObject({ event: tenantMove, posture: { strengthRung: 'L3', coverageBucket: 'L3' } });
  });

  it('reads a partial clearing as the floor on the cleared axis', () => {
    const lines = replayEffectivenessHistory(
      [line(1, 'L2', 'L2'), line(5, null, 'L2')],
      tenantPosture('L0', 'L2'),
      false,
      READ_AT,
    );

    expect(pairs(lines)).toEqual(['L2/L2', 'L0/L2']);
  });

  it('reads both axes cleared as not assessed', () => {
    const lines = replayEffectivenessHistory([line(1, 'L2', 'L2'), line(5, null, null)], null, false, READ_AT);

    expect(pairs(lines)).toEqual(['L2/L2', null]);
  });

  it('draws nothing for a line that moved no value', () => {
    const lines = replayEffectivenessHistory([line(1, 'L2', 'L2'), line(5, 'L2', 'L2')], tenantPosture('L2', 'L2'), false, READ_AT);

    expect(lines).toHaveLength(1);
  });

  it('anchors a control with no journal on its live value', () => {
    const lines = replayEffectivenessHistory([], tenantPosture('L2', 'L2'), false, READ_AT);

    expect(lines).toEqual([{ at: READ_AT, posture: tenantPosture('L2', 'L2'), event: null }]);
  });

  it('adds no anchor when the journal ends on the live value', () => {
    const lines = replayEffectivenessHistory([line(1, 'L2', 'L2')], tenantPosture('L2', 'L2'), false, READ_AT);

    expect(lines.map(({ event }) => event === null)).toEqual([false]);
  });

  it('anchors a scope declaration the journal never recorded', () => {
    const live = strengthOnScope('L3', 'L2');
    const lines = replayEffectivenessHistory([line(1, 'L1', 'L2')], live, true, READ_AT);

    expect(lines.at(-1)).toEqual({ at: READ_AT, posture: live, event: null });
  });

  it('orders lines of the same instant by id', () => {
    const first = { ...line(1, 'L1', 'L1'), id: 'b' };
    const second = { ...line(1, 'L2', 'L1'), id: 'c' };
    const lines = replayEffectivenessHistory([second, first], tenantPosture('L2', 'L1'), false, READ_AT);

    expect(pairs(lines)).toEqual(['L1/L1', 'L2/L1']);
  });
});

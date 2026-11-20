import { i18n } from '@lingui/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ValidationCell } from '../types/validation';
import {
  cellSuccessRate,
  describeProofFreshness,
  formatBoundedRate,
  MISSED_SHARE_THRESHOLD,
  resolvePostureTone,
  summariseProvenPosture,
} from './validation-summary-utils';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

const DAY_MS = 86_400_000;
const daysAgo = (days: number): Date => new Date(Date.now() - days * DAY_MS);

const cell = (index: number, met: boolean, latestProofAt: string | Date | null = null): ValidationCell => ({
  techniqueId: `technique-${index}`,
  techniqueExternalId: `T${1000 + index}`,
  function: 'detect',
  state: met ? 'validated' : 'contradicted',
  validatedVotes: met ? 2 : 1,
  totalVotes: 2,
  latestProofAt,
});

const cells = (met: number, missed: number): Array<ValidationCell> => [
  ...Array.from({ length: met }, (_, index) => cell(index, true)),
  ...Array.from({ length: missed }, (_, index) => cell(met + index, false)),
];

describe('resolvePostureTone', () => {
  it('reads positive when nothing was missed', () => {
    expect(resolvePostureTone(0)).toBe('positive');
  });

  it('reads warning below the threshold', () => {
    expect(resolvePostureTone(0.24)).toBe('warning');
  });

  it('reads destructive exactly at the threshold, which is inclusive', () => {
    expect(resolvePostureTone(MISSED_SHARE_THRESHOLD)).toBe('destructive');
  });

  it('reads destructive above the threshold', () => {
    expect(resolvePostureTone(1)).toBe('destructive');
  });
});

describe('summariseProvenPosture', () => {
  it('carries no rate when nothing was tested', () => {
    const posture = summariseProvenPosture([], 770);

    expect(posture.tested).toBe(0);
    expect(posture.met).toBe(0);
    expect(posture.missed).toBe(0);
    expect(posture.successRate).toBe(0);
    expect(posture.missedShare).toBe(0);
    expect(posture.coverageRate).toBe(0);
    expect(posture.credited).toBe(770);
  });

  it('reads a full success rate and a positive tone when every tested expectation held', () => {
    const posture = summariseProvenPosture(cells(12, 0), 770);

    expect(posture.tested).toBe(12);
    expect(posture.met).toBe(12);
    expect(posture.successRate).toBe(1);
    expect(posture.missedShare).toBe(0);
    expect(posture.tone).toBe('positive');
  });

  it('keeps a single miss out of four hundred under the threshold', () => {
    const posture = summariseProvenPosture(cells(399, 1), 770);

    expect(posture.tested).toBe(400);
    expect(posture.missed).toBe(1);
    expect(posture.missedShare).toBeCloseTo(0.0025);
    expect(posture.tone).toBe('warning');
  });

  it('turns destructive on the exact quarter, the boundary a refactor would move', () => {
    const posture = summariseProvenPosture(cells(3, 1), 770);

    expect(posture.missedShare).toBe(0.25);
    expect(posture.tone).toBe('destructive');
  });

  it('reads a zero success rate when every tested expectation was missed', () => {
    const posture = summariseProvenPosture(cells(0, 8), 770);

    expect(posture.successRate).toBe(0);
    expect(posture.missedShare).toBe(1);
    expect(posture.tone).toBe('destructive');
  });

  it('counts an expectation on the same threshold the expectation itself is read on', () => {
    const scarcelyMissed: ValidationCell = { ...cell(0, true), validatedVotes: 9, totalVotes: 10 };
    const posture = summariseProvenPosture([scarcelyMissed], 770);

    expect(posture.met).toBe(1);
    expect(posture.missed).toBe(0);
    expect(resolvePostureTone(1 - cellSuccessRate(scarcelyMissed))).toBe('warning');
  });

  it('measures proof coverage against what the catalogue credits, not against what was tested', () => {
    const posture = summariseProvenPosture(cells(20, 14), 770);

    expect(posture.coverageRate).toBeCloseTo(34 / 770);
  });

  it('reports no coverage rather than dividing by zero when the catalogue credits nothing', () => {
    const posture = summariseProvenPosture(cells(2, 0), 0);

    expect(posture.coverageRate).toBe(0);
  });

  it('dates the posture on its most recent expectation, whatever order the cells arrive in', () => {
    const posture = summariseProvenPosture([
      cell(0, true, '2026-08-11T00:00:00.000Z'),
      cell(1, true, '2026-08-16T00:00:00.000Z'),
      cell(2, true, '2026-08-02T00:00:00.000Z'),
    ], 770);

    expect(posture.latestProofAt).toEqual(new Date('2026-08-16T00:00:00.000Z'));
  });

  it('ignores an undated expectation rather than letting it erase the date of the others', () => {
    const posture = summariseProvenPosture([
      cell(0, true, null),
      cell(1, true, '2026-08-16T00:00:00.000Z'),
    ], 770);

    expect(posture.latestProofAt).toEqual(new Date('2026-08-16T00:00:00.000Z'));
  });

  it('carries no date when nothing tested carried one', () => {
    expect(summariseProvenPosture(cells(3, 0), 770).latestProofAt).toBeNull();
  });
});

describe('formatBoundedRate', () => {
  it('rounds an ordinary rate', () => {
    expect(formatBoundedRate(0.6176)).toBe('62%');
  });

  it('never rounds a measured coverage down to nothing, which the tested count would contradict', () => {
    expect(formatBoundedRate(1 / 770)).toBe('<1%');
  });

  it('still reads zero when nothing was measured at all', () => {
    expect(formatBoundedRate(0)).toBe('0%');
  });

  it('never rounds a rate up to a clean sweep while an expectation was missed', () => {
    expect(formatBoundedRate(501 / 502)).toBe('>99%');
  });

  it('still reads a hundred when nothing was missed', () => {
    expect(formatBoundedRate(1)).toBe('100%');
  });

  describe('in French', () => {
    beforeAll(() => {
      i18n.load('fr', {});
      i18n.activate('fr');
    });

    afterAll(() => {
      i18n.activate('en');
    });

    it('writes the percent sign the application language writes, on a rate and on both boundaries', () => {
      expect([formatBoundedRate(0.6176), formatBoundedRate(1 / 770), formatBoundedRate(501 / 502)]).toEqual(['62\u00a0%', '<1\u00a0%', '>99\u00a0%']);
    });
  });
});

describe('cellSuccessRate', () => {
  it('reads the share of scenarios that held', () => {
    expect(cellSuccessRate({ validatedVotes: 3, totalVotes: 4 })).toBe(0.75);
  });

  it('reads zero rather than dividing by zero when no scenario voted', () => {
    expect(cellSuccessRate({ validatedVotes: 0, totalVotes: 0 })).toBe(0);
  });
});

describe('describeProofFreshness', () => {
  it('carries the age of the most recent proof', () => {
    expect(describeProofFreshness(daysAgo(12))).toContain('12');
  });

  it('names today as today rather than as zero days', () => {
    expect(describeProofFreshness(new Date())).not.toContain('0 day');
  });

  it('reads an ISO string exactly as it reads a date', () => {
    expect(describeProofFreshness(daysAgo(30).toISOString())).toContain('30');
  });

  it('carries nothing when the counted results were all undated', () => {
    expect(describeProofFreshness(null)).toBeNull();
  });
});

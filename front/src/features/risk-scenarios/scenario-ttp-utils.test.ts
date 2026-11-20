import { describe, expect, it } from 'vitest';
import {
  buildTtpRows,
  formatShare,
  isUnplayedTechnique,
  shareOfExposure,
  usageFillRatio,
  usageStep,
  valueFillRatio,
  valueTone,
} from './scenario-ttp-utils';

const technique = (id: string, externalId: string, weight: number) => ({
  mitreTechniqueId: id,
  externalId,
  name: `Technique ${externalId}`,
  weight,
  threats: [{ id: 'actor-1', canonicalName: 'APT1', entityType: 'intrusion-set' as const, share: weight }],
  sourceCount: 1,
  tacticNames: ['Initial Access'],
});

describe('buildTtpRows', () => {
  it('should keep the repertoire order and carry the weight of each technique', () => {
    const rows = buildTtpRows({
      techniques: [technique('id-1', 'T1059', 0.6), technique('id-2', 'T1078', 0.2)],
      techniqueValues: [],
      reachGaps: [],
    });

    expect(rows.map((row) => row.externalId)).toEqual(['T1059', 'T1078']);
    expect(rows[0].weight).toBe(0.6);
  });

  it('should carry the two interdiction levers together onto the matching technique', () => {
    const rows = buildTtpRows({
      techniques: [technique('id-1', 'T1059', 0.6)],
      techniqueValues: [{ mitreTechniqueId: 'id-1', preventValueMean: 1200, detectValueMean: 300 }],
      reachGaps: [],
    });

    expect(rows[0].value).toBe(1500);
  });

  it('should keep each lever apart beside their total', () => {
    const rows = buildTtpRows({
      techniques: [technique('id-1', 'T1059', 0.6)],
      techniqueValues: [{ mitreTechniqueId: 'id-1', preventValueMean: 1200, detectValueMean: 300 }],
      reachGaps: [],
    });

    expect(rows[0].preventValue).toBe(1200);
    expect(rows[0].detectValue).toBe(300);
  });

  it('should leave both levers unpriced when either one is', () => {
    const rows = buildTtpRows({
      techniques: [technique('id-1', 'T1059', 0.6)],
      techniqueValues: [{ mitreTechniqueId: 'id-1', preventValueMean: 1200, detectValueMean: null }],
      reachGaps: [],
    });

    expect(rows[0].preventValue).toBeNull();
    expect(rows[0].detectValue).toBeNull();
    expect(rows[0].value).toBeNull();
  });

  it('should leave a technique the run never scored unpriced', () => {
    const rows = buildTtpRows({
      techniques: [technique('id-1', 'T1059', 0.6)],
      techniqueValues: [{ mitreTechniqueId: 'other', preventValueMean: 500, detectValueMean: 0 }],
      reachGaps: [],
    });

    expect(rows[0].value).toBeNull();
    expect(rows[0].gap).toBeNull();
  });

  it('should name the gap of a technique the run played but could not price', () => {
    const rows = buildTtpRows({
      techniques: [technique('id-1', 'T1059', 0.6)],
      techniqueValues: [{ mitreTechniqueId: 'id-1', preventValueMean: null, detectValueMean: null }],
      reachGaps: [{ mitreTechniqueId: 'id-1', gap: 'estate' }],
    });

    expect(rows[0].value).toBeNull();
    expect(rows[0].gap).toBe('estate');
  });

  it('should keep the first reason when a technique has a gap on several families', () => {
    const rows = buildTtpRows({
      techniques: [technique('id-1', 'T1059', 0.6)],
      techniqueValues: [],
      reachGaps: [
        { mitreTechniqueId: 'id-1', gap: 'catalogue' },
        { mitreTechniqueId: 'id-1', gap: 'estate' },
      ],
    });

    expect(rows[0].gap).toBe('catalogue');
  });

  it('should drop a technique the run priced that no admitted actor plays any more', () => {
    const rows = buildTtpRows({
      techniques: [technique('id-1', 'T1059', 0.6)],
      techniqueValues: [
        { mitreTechniqueId: 'id-1', preventValueMean: 500, detectValueMean: 0 },
        { mitreTechniqueId: 'stale', preventValueMean: 900, detectValueMean: 0 },
      ],
      reachGaps: [],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('id-1');
  });
});

describe('isUnplayedTechnique', () => {
  const rowWith = (preventValueMean: number | null, detectValueMean: number | null) => buildTtpRows({
    techniques: [technique('id-1', 'T1059', 0.6)],
    techniqueValues: [{ mitreTechniqueId: 'id-1', preventValueMean, detectValueMean }],
    reachGaps: [],
  })[0];

  it('should read two exact zeros as a technique the scenario never plays', () => {
    expect(isUnplayedTechnique(rowWith(0, 0))).toBe(true);
  });

  it('should read a residue on either lever as a technique that is played', () => {
    expect(isUnplayedTechnique(rowWith(0, 1e-9))).toBe(false);
    expect(isUnplayedTechnique(rowWith(3, 0))).toBe(false);
  });

  it('should not read an unpriced technique as unplayed', () => {
    expect(isUnplayedTechnique(rowWith(null, null))).toBe(false);
  });
});

describe('shareOfExposure', () => {
  it('should divide the value by the scenario exposure', () => {
    expect(shareOfExposure(18_000, 100_000)).toBeCloseTo(0.18, 10);
  });

  it('should give no share when the run carries no exposure', () => {
    expect(shareOfExposure(18_000, 0)).toBeNull();
  });
});

describe('valueFillRatio', () => {
  const EXPOSURE = 100_000;

  it('should turn the tone high on exactly the contribution that fills the bar', () => {
    expect(valueFillRatio(15_000, EXPOSURE)).toBe(1);
    expect(valueTone(15_000, EXPOSURE)).toBe('high');
    expect(valueFillRatio(14_999, EXPOSURE)).toBeLessThan(1);
    expect(valueTone(14_999, EXPOSURE)).toBe('medium');
    expect(valueFillRatio(7_500, EXPOSURE)).toBe(0.5);
  });

  it('should never overflow when a contribution passes the high cut', () => {
    expect(valueFillRatio(80_000, EXPOSURE)).toBe(1);
  });

  it('should draw no bar for a value below zero', () => {
    expect(valueFillRatio(-40_000, EXPOSURE)).toBe(0);
  });

  it('should draw no bar for an unpriced technique', () => {
    expect(valueFillRatio(null, EXPOSURE)).toBeNull();
  });

  it('should draw no bar when the run carries no exposure', () => {
    expect(valueFillRatio(9_000, 0)).toBeNull();
  });
});

describe('usageStep', () => {
  it('should step on the share itself, boundaries falling to the lower step', () => {
    expect(usageStep(0.351)).toBe(4);
    expect(usageStep(0.35)).toBe(3);
    expect(usageStep(0.2)).toBe(2);
    expect(usageStep(0.1)).toBe(1);
    expect(usageStep(0)).toBe(1);
  });

  it('should not brighten the most played technique of a barely played set', () => {
    // The whole point of the absolute reading: first among the seldom played is not common.
    expect(usageStep(0.02)).toBe(1);
  });
});

describe('usageFillRatio', () => {
  it('should draw the share itself, without rescaling', () => {
    expect(usageFillRatio(0.5)).toBeCloseTo(0.5, 10);
    expect(usageFillRatio(0.1)).toBeCloseTo(0.1, 10);
  });

  it('should not fill on the most played techniques of an ordinary scenario', () => {
    // Measured head of the seeded scenarios: 38% of the threat. A bar that fills here saturates the
    // whole head at once, which is what the absolute reading exists to break.
    expect(usageFillRatio(0.38)).toBeLessThan(0.5);
  });

  it('should fill only for a technique every admitted actor plays', () => {
    expect(usageFillRatio(1)).toBe(1);
  });
});

describe('valueTone', () => {
  // A scenario whose annual loss exposure is 100,000.
  const EXPOSURE = 100_000;

  it('should read a value below zero as benign, whatever its size', () => {
    expect(valueTone(-2_000, EXPOSURE)).toBe('benign');
    expect(valueTone(-40_000, EXPOSURE)).toBe('benign');
  });

  it('should read a technique whose interdiction barely moves the loss as benign', () => {
    expect(valueTone(0, EXPOSURE)).toBe('benign');
    expect(valueTone(458, EXPOSURE)).toBe('benign');
  });

  it('should step on the share of the exposure, a cut belonging to the tone above it', () => {
    expect(valueTone(15_000, EXPOSURE)).toBe('high');
    expect(valueTone(14_999, EXPOSURE)).toBe('medium');
    expect(valueTone(5_000, EXPOSURE)).toBe('medium');
    expect(valueTone(4_999, EXPOSURE)).toBe('low');
    expect(valueTone(1_000, EXPOSURE)).toBe('low');
    expect(valueTone(999, EXPOSURE)).toBe('benign');
  });

  it('should not raise the alarm on the largest of a set of trivial contributions', () => {
    // The whole point of reading against the exposure: first among trivia is not dangerous.
    expect(valueTone(5, EXPOSURE)).toBe('benign');
    expect(valueTone(5, 5)).toBe('high');
  });

  it('should stay benign when the run carries no exposure to measure against', () => {
    expect(valueTone(9_000, 0)).toBe('benign');
    expect(valueTone(9_000, -1)).toBe('benign');
  });
});

describe('formatShare', () => {
  it('should render a share as a whole percentage', () => {
    expect(formatShare(0.378)).toBe('38%');
    expect(formatShare(0.042)).toBe('4%');
  });
});

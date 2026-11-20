import { i18n } from '@lingui/core';
import { pricedFraction } from '@app/module/client';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DecompositionRun, RunTimeline } from './ale-decomposition-utils';
import { formatFractionAsPercent } from '../../../../utils/format-number';
import {
  buildAleDecomposition,
  DEFENCES_DIGITS,
  defencesOf,
  formatDefences,
  printedChange,
  threatOf,
} from './ale-decomposition-utils';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const NOW = new Date(2026, 6, 24, 12);

const isoAt = (daysBeforeNow: number): string => new Date(NOW.getTime() - daysBeforeNow * DAY_MS).toISOString();

let nextId = 0;

const run = (overrides: Partial<DecompositionRun> = {}): DecompositionRun => {
  nextId += 1;
  return {
    id: `run-${nextId}`,
    createdAt: isoAt(0),
    aleMean: 1_000_000,
    aleP10: 500_000,
    aleP90: 2_000_000,
    tefMin: 1,
    tefLikely: 2,
    tefMax: 4,
    outcomeEvicted: 0.2,
    outcomeImpactDetected: 0.3,
    outcomeImpactUndetected: 0.1,
    magnitudeMean: 300_000,
    ...overrides,
  };
};

/** `runs` oldest first, the latest two read from its end as the server reads them. */
const timelineOf = (runs: ReadonlyArray<DecompositionRun>): RunTimeline => ({
  latest: runs.toReversed().slice(0, 2),
  points: runs,
  until: NOW.toISOString(),
});

describe('buildAleDecomposition', () => {
  it("should read a single priced run's four values", () => {
    const decomposition = buildAleDecomposition(timelineOf([run()]));
    expect(decomposition.loss.value).toBe(1_000_000);
    expect(decomposition.loss.p10).toBe(500_000);
    expect(decomposition.loss.p90).toBe(2_000_000);
    expect(decomposition.threat.value).toBeCloseTo(2.1667, 4);
    const expectedDefences = pricedFraction({ evicted: 0.2, impactDetected: 0.3, impactUndetected: 0.1 }) * 100;
    expect(decomposition.defences.value).toBeCloseTo(expectedDefences, 10);
    expect(decomposition.business.value).toBe(300_000);
  });

  it('should print the susceptibility as the change list prints the same run, an exact half rounding up', () => {
    const atHalf = run({ outcomeEvicted: 0, outcomeImpactDetected: 0, outcomeImpactUndetected: 0.0185 });
    const changeList = formatFractionAsPercent(pricedFraction({ evicted: 0, impactDetected: 0, impactUndetected: 0.0185 }), DEFENCES_DIGITS);
    expect(formatDefences(defencesOf(atHalf)!)).toBe(changeList);
    expect(changeList).toBe('1.9%');
  });

  it("should read each factor's change against the previous run and identify the previous loss value", () => {
    const previous = run({ createdAt: isoAt(10) });
    const latest = run({ createdAt: isoAt(0), aleMean: 1_200_000, tefLikely: 3, outcomeEvicted: 0.25, magnitudeMean: 320_000 });
    const decomposition = buildAleDecomposition(timelineOf([previous, latest]));
    expect(decomposition.loss.change).toBeCloseTo(200_000, 6);
    expect(decomposition.loss.previous).toEqual({ value: previous.aleMean, at: new Date(previous.createdAt) });
    expect(decomposition.threat.change).toBeCloseTo(threatOf(latest)! - threatOf(previous)!, 10);
    expect(decomposition.defences.change).toBeCloseTo(defencesOf(latest)! - defencesOf(previous)!, 10);
    expect(decomposition.business.change).toBe(20_000);
  });

  it('should read the changes from the latest two runs, not from the sampled points', () => {
    const sampled = run({ createdAt: isoAt(30), aleMean: 100 });
    const previous = run({ createdAt: isoAt(0.01), aleMean: 900 });
    const latest = run({ createdAt: isoAt(0), aleMean: 1_000 });
    const decomposition = buildAleDecomposition({ latest: [latest, previous], points: [sampled, latest], until: NOW });
    expect(decomposition.loss.change).toBe(100);
  });

  it('should have no change and no previous with a single run', () => {
    const decomposition = buildAleDecomposition(timelineOf([run()]));
    expect(decomposition.loss.change).toBeNull();
    expect(decomposition.loss.previous).toBeNull();
    expect(decomposition.threat.change).toBeNull();
    expect(decomposition.defences.change).toBeNull();
    expect(decomposition.business.change).toBeNull();
  });

  it('should leave business.change null when the previous run predates the magnitude column, while the other changes still compute', () => {
    const previous = run({ createdAt: isoAt(10), magnitudeMean: null });
    const latest = run({ createdAt: isoAt(0) });
    const decomposition = buildAleDecomposition(timelineOf([previous, latest]));
    expect(decomposition.business.change).toBeNull();
    expect(decomposition.business.value).toBe(latest.magnitudeMean);
    expect(decomposition.loss.change).toBe(0);
    expect(decomposition.threat.change).toBeCloseTo(0, 10);
    expect(decomposition.defences.change).toBeCloseTo(0, 10);
  });

  it('should read threat.value as null when the latest run has no TEF, and drop it from the threat series', () => {
    const decomposition = buildAleDecomposition(timelineOf([run({ tefLikely: null })]));
    expect(decomposition.threat.value).toBeNull();
    expect(decomposition.threat.series).toHaveLength(0);
  });

  describe('placement by time', () => {
    it('should span the axis from the first sampled run to until', () => {
      const decomposition = buildAleDecomposition(timelineOf([run({ createdAt: isoAt(40) }), run({ createdAt: isoAt(0) })]));
      expect(decomposition.axis).toEqual({ start: new Date(isoAt(40)), end: NOW });
    });

    it('should have no axis and no series without a sampled run', () => {
      const decomposition = buildAleDecomposition({ latest: [run({ createdAt: isoAt(200) })], points: [], until: NOW });
      expect(decomposition.axis).toBeNull();
      expect(decomposition.loss.series).toEqual([]);
    });

    it('should place each point at its date, so a burst in the last hour only fills the right edge', () => {
      const burst = Array.from({ length: 20 }, (_, index) => run({ createdAt: new Date(NOW.getTime() - (60 - index) * MINUTE_MS).toISOString() }));
      const runs = [run({ createdAt: isoAt(90) }), run({ createdAt: isoAt(60) }), run({ createdAt: isoAt(30) }), ...burst];
      const xs = buildAleDecomposition(timelineOf(runs)).loss.series.map((point) => point.x);
      expect(xs.slice(0, 3)).toEqual([0, expect.closeTo(1 / 3, 10), expect.closeTo(2 / 3, 10)]);
      for (const x of xs.slice(3)) {
        expect(x).toBeGreaterThan(0.999);
      }
    });

    it('should place the four curves on the same axis', () => {
      const first = run({ createdAt: isoAt(20), tefLikely: null });
      const decomposition = buildAleDecomposition(timelineOf([first, run({ createdAt: isoAt(10) }), run({ createdAt: isoAt(0) })]));
      expect(decomposition.threat.series.map((point) => point.x)).toEqual([0.5, 1]);
      expect(decomposition.loss.series.map((point) => point.x)).toEqual([0, 0.5, 1]);
    });

    it('should hold the run in force now to the axis end', () => {
      const decomposition = buildAleDecomposition(timelineOf([run({ createdAt: isoAt(10), aleMean: 700 })]));
      expect(decomposition.loss.series.map(({ x, value }) => ({ x, value }))).toEqual([{ x: 0, value: 700 }, { x: 1, value: 700 }]);
    });

    it('should end a series at its last run when that run is no longer the one in force', () => {
      const sampled = run({ createdAt: isoAt(10) });
      const unpriced = run({ createdAt: isoAt(1), aleMean: null });
      const decomposition = buildAleDecomposition({ latest: [unpriced, sampled], points: [run({ createdAt: isoAt(20) }), sampled], until: NOW });
      expect(decomposition.loss.series.map((point) => point.x)).toEqual([0, 0.5]);
    });
  });
});

describe('printedChange', () => {
  it('should take the change between the two figures as printed, not round the raw change', () => {
    // 2.164 → 2.176 prints 2.16 → 2.18: the raw +0.012 would print +0.01.
    expect(printedChange(2.176, 0.012, 2)).toBe(0.02);
  });

  it('should keep a sub-point move visible at one decimal', () => {
    // 22.0 → 22.4: whole points would print 22 → 22 and a change of 0.
    expect(printedChange(22.4, 0.4, 1)).toBe(0.4);
    expect(printedChange(22.4, 0.4, 0)).toBe(0);
  });

  it('should read zero when both figures print the same', () => {
    expect(printedChange(2.171, 0.003, 2)).toBe(0);
  });

  it('should round each figure from its decimal form, as it prints', () => {
    // 1.004 → 1.005 prints 1.00 → 1.01, where `toFixed` would read 1.00 for both.
    expect(printedChange(1.005, 0.001, 2)).toBe(0.01);
  });
});

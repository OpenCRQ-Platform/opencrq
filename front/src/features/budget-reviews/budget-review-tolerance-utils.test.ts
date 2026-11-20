import { describe, expect, it } from 'vitest';
import type { ReviewToleranceScenario } from './budget-review-tolerance-utils';
import { hasAppliedTolerance, readingLabelBaseline, reviewToleranceSummary, toleranceChartModel } from './budget-review-tolerance-utils';

const TOLERANCE = { annualLoss: 2_000_000, maxExceedanceProbability: 0.05, source: 'scope' as const };

const reading = (probability: number, beyondTail = false) => ({ probability, beyondTail, curve: [] });

const scenario = (name: string, reference: number | null, withoutBuild: number | null, overrides: Partial<ReviewToleranceScenario> = {}): ReviewToleranceScenario => ({
  scenarioId: `id-${name}`,
  name,
  tolerance: TOLERANCE,
  reference: reference === null ? null : reading(reference),
  withoutBuild: withoutBuild === null ? null : reading(withoutBuild),
  olderThanHeadline: false,
  ...overrides,
});

describe('reviewToleranceSummary', () => {
  it('counts the scenarios outside at the reference, outside without the build work, and brought back', () => {
    const summary = reviewToleranceSummary([
      scenario('Ransomware', 0.03, 0.09),
      scenario('Exfiltration', 0.12, 0.15),
      scenario('Wire fraud', 0.01, 0.02),
    ]);

    expect(summary).toMatchObject({ assessed: 3, outsideAtReference: 1, outsideWithoutBuild: 2, broughtBack: 1 });
  });

  it('lists every scenario, brought back first, then outside at the reference, then within, each by name', () => {
    const summary = reviewToleranceSummary([
      scenario('Mail compromise', 0.12, 0.15),
      scenario('Wire fraud', 0.01, 0.02),
      scenario('Ransomware', 0.03, 0.09),
      scenario('Data exfiltration', 0.04, 0.07),
      scenario('Defacement', 0.06, 0.04),
      scenario('Account takeover', 0.02, 0.03),
    ]);

    expect(summary.rows.map((row) => row.name)).toEqual(['Data exfiltration', 'Ransomware', 'Defacement', 'Mail compromise', 'Account takeover', 'Wire fraud']);
  });

  it('lists the scenarios when every one is within tolerance in both readings', () => {
    const summary = reviewToleranceSummary([scenario('Ransomware', 0.03, 0.04), scenario('Exfiltration', 0.01, 0.02)]);

    expect(summary).toMatchObject({ assessed: 2, outsideAtReference: 0, outsideWithoutBuild: 0, broughtBack: 0 });
    expect(summary.rows.map((row) => row.name)).toEqual(['Exfiltration', 'Ransomware']);
  });

  it('reads a probability equal to the maximum as within tolerance', () => {
    const summary = reviewToleranceSummary([scenario('Ransomware', 0.05, 0.05)]);

    expect(summary.outsideAtReference).toBe(0);
    expect(summary.rows.map((row) => row.outsideAtReference)).toEqual([false]);
  });

  it('reads a probability past the tail as within tolerance, whatever the maximum', () => {
    const summary = reviewToleranceSummary([
      scenario('Ransomware', 0.03, 0.09, { reference: { probability: 0.001, beyondTail: true, curve: [] }, tolerance: { ...TOLERANCE, maxExceedanceProbability: 0.0001 } }),
    ]);

    expect(summary.outsideAtReference).toBe(0);
    expect(summary.outsideWithoutBuild).toBe(1);
  });

  it('leaves out of every count a scenario with no applied tolerance or a missing reading', () => {
    const summary = reviewToleranceSummary([
      scenario('No tolerance', 0.3, 0.4, { tolerance: null, reference: { probability: null, beyondTail: null, curve: [] }, withoutBuild: { probability: null, beyondTail: null, curve: [] } }),
      scenario('Not priced', null, null),
      scenario('Ransomware', 0.03, 0.09),
    ]);

    expect(summary).toMatchObject({ assessed: 1, outsideAtReference: 0, outsideWithoutBuild: 1, broughtBack: 1 });
    expect(summary.rows.map((row) => row.name)).toEqual(['Ransomware']);
  });

  it('carries the tolerance applied and where it comes from', () => {
    const [row] = reviewToleranceSummary([scenario('Ransomware', 0.03, 0.09, { tolerance: { ...TOLERANCE, source: 'scenario' } })]).rows;

    expect(row.applied).toEqual({ tolerance: { annualLoss: 2_000_000, maxExceedanceProbability: 0.05 }, source: 'scenario' });
  });
});

describe('reviewToleranceSummary olderThanHeadline', () => {
  it('carries onto the assessed row whether its curves come from an older run', () => {
    const { rows } = reviewToleranceSummary([
      scenario('Ransomware', 0.03, 0.09, { olderThanHeadline: true }),
      scenario('Wire fraud', 0.01, 0.02),
    ]);

    expect(rows.find((row) => row.name === 'Ransomware')?.olderThanHeadline).toBe(true);
    expect(rows.find((row) => row.name === 'Wire fraud')?.olderThanHeadline).toBe(false);
  });
});

describe('hasAppliedTolerance', () => {
  it('is true as soon as one scenario applies a tolerance, priced or not', () => {
    expect(hasAppliedTolerance([scenario('A', null, null, { tolerance: null }), scenario('B', null, null)])).toBe(true);
  });

  it('is false when no scenario applies one, or there is no scenario', () => {
    expect(hasAppliedTolerance([scenario('A', null, null, { tolerance: null })])).toBe(false);
    expect(hasAppliedTolerance([])).toBe(false);
  });
});

describe('toleranceChartModel', () => {
  const REFERENCE_CURVE = [{ loss: 0, probability: 0.2 }, { loss: 2_000_000, probability: 0.03 }, { loss: 6_000_000, probability: 0.001 }];
  const WITHOUT_BUILD_CURVE = [{ loss: 0, probability: 0.3 }, { loss: 2_000_000, probability: 0.09 }, { loss: 8_000_000, probability: 0.001 }];
  const priced = (overrides: Partial<ReviewToleranceScenario> = {}): ReviewToleranceScenario => scenario('Ransomware', null, null, {
    reference: { probability: 0.03, beyondTail: false, curve: REFERENCE_CURVE },
    withoutBuild: { probability: 0.09, beyondTail: false, curve: WITHOUT_BUILD_CURVE },
    ...overrides,
  });

  it('draws both curves, the reference first, and reads each at the tolerance amount', () => {
    const model = toleranceChartModel(priced());

    expect(model?.tolerance).toEqual({ annualLoss: 2_000_000, maxExceedanceProbability: 0.05 });
    expect(model?.series.map((series) => series.key)).toEqual(['reference', 'withoutBuild']);
    expect(model?.series[0].curve).toBe(REFERENCE_CURVE);
    expect(model?.series[0].read?.reading).toEqual({ probability: 0.03, beyondTail: false });
    expect(model?.series[1].read?.reading).toEqual({ probability: 0.09, beyondTail: false });
  });

  it('puts the higher read above its point and the lower one below', () => {
    const model = toleranceChartModel(priced());

    expect(model?.series[0].read?.side).toBe('below');
    expect(model?.series[1].read?.side).toBe('above');

    const crossed = toleranceChartModel(priced({
      reference: { probability: 0.06, beyondTail: false, curve: REFERENCE_CURVE },
      withoutBuild: { probability: 0.04, beyondTail: false, curve: WITHOUT_BUILD_CURVE },
    }));
    expect(crossed?.series[0].read?.side).toBe('above');
    expect(crossed?.series[1].read?.side).toBe('below');
  });

  it('keeps a read past the tail as an upper bound', () => {
    const model = toleranceChartModel(priced({ reference: { probability: 0.001, beyondTail: true, curve: REFERENCE_CURVE } }));

    expect(model?.series[0].read?.reading).toEqual({ probability: 0.001, beyondTail: true });
  });

  it('sizes the axes to both curves and the tolerance point', () => {
    expect(toleranceChartModel(priced())).toMatchObject({ lossMax: 8_000_000, probabilityMax: 0.3 });
    expect(toleranceChartModel(priced({ tolerance: { annualLoss: 10_000_000, maxExceedanceProbability: 0.5, source: 'scenario' } })))
      .toMatchObject({ lossMax: 10_000_000, probabilityMax: 0.5 });
  });

  it('draws the curves of a scenario with no applied tolerance, without a tolerance point or reads', () => {
    const model = toleranceChartModel(priced({
      tolerance: null,
      reference: { probability: null, beyondTail: null, curve: REFERENCE_CURVE },
      withoutBuild: { probability: null, beyondTail: null, curve: WITHOUT_BUILD_CURVE },
    }));

    expect(model?.tolerance).toBeNull();
    expect(model?.series.map((series) => series.read)).toEqual([null, null]);
    expect(model).toMatchObject({ lossMax: 8_000_000, probabilityMax: 0.3 });
  });

  it('has nothing to draw for a scenario not priced for the review, or with an empty curve', () => {
    expect(toleranceChartModel(priced({ reference: null, withoutBuild: null }))).toBeNull();
    expect(toleranceChartModel(priced({ withoutBuild: { probability: 0.09, beyondTail: false, curve: [] } }))).toBeNull();
  });
});

describe('readingLabelBaseline', () => {
  it('sets a label just above or below its dot when the tolerance diamond is clear of it', () => {
    expect(readingLabelBaseline('above', 100, 160)).toBe(94);
    expect(readingLabelBaseline('below', 100, 40)).toBe(114);
  });

  it('moves a label past the diamond when it would print over it', () => {
    expect(readingLabelBaseline('below', 100, 110)).toBe(130);
    expect(readingLabelBaseline('above', 100, 90)).toBe(78);
  });
});

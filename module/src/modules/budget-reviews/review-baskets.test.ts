import { describe, expect, it } from 'vitest';
import type { PostureValue, PricedReview, ReviewPricing } from './review-baskets';
import { annualLossBasketsOf, composeReviewPricing } from './review-baskets';

const at = (
  strengthRung: PostureValue['strengthRung'],
  coverageBucket: PostureValue['coverageBucket'],
): PostureValue => ({ strengthRung, coverageBucket });

const review = (overrides: Partial<PricedReview>): PricedReview => ({
  reviewId: 'review',
  version: 3,
  lines: [],
  start: new Map(),
  end: new Map(),
  steps: [],
  ...overrides,
});

const movesOf = (pricing: ReviewPricing, basketId: string | null) =>
  (basketId === null ? [] : pricing.baskets.find((basket) => basket.basketId === basketId)!.moves);

const differenceOf = (pricing: ReviewPricing, key: string) => pricing.differences.find((difference) => difference.key === key)!;

// EDR moved from L1/L1 to L2/L2 during the period, MFA held L3/L2 throughout.
const CURRENT = new Map([['edr', at('L2', 'L2')], ['mfa', at('L3', 'L2')]]);
const START = new Map([['edr', at('L1', 'L1')], ['mfa', at('L3', 'L2')]]);

describe('composeReviewPricing', () => {
  it('prices a build line as its controls set back to the period start against the run\'s own posture, for a running period', () => {
    const pricing = composeReviewPricing([review({
      lines: [{ lineId: 'build', nature: 'build', capabilityIds: ['edr'] }],
      start: START,
      end: CURRENT,
    })], CURRENT);

    const line = differenceOf(pricing, 'review:line:build');
    expect(line.subtrahendBasketId).toBeNull();
    expect(movesOf(pricing, line.minuendBasketId)).toEqual([{ controlId: 'edr', targetStrengthRung: 'L1', targetCoverageBucket: 'L1' }]);
  });

  it('prices a basket as strength and coverage targets alone', () => {
    const pricing = composeReviewPricing([review({
      lines: [{ lineId: 'build', nature: 'build', capabilityIds: ['edr'] }],
      start: START,
      end: CURRENT,
    })], CURRENT);

    const [move] = movesOf(pricing, differenceOf(pricing, 'review:line:build').minuendBasketId);
    expect(Object.keys(move)).toEqual(['controlId', 'targetStrengthRung', 'targetCoverageBucket']);
  });

  it('prices a build line whose controls never moved as the run\'s own posture against itself', () => {
    const pricing = composeReviewPricing([review({
      lines: [{ lineId: 'build', nature: 'build', capabilityIds: ['mfa'] }],
      start: START,
      end: CURRENT,
    })], CURRENT);

    expect(differenceOf(pricing, 'review:line:build')).toMatchObject({ minuendBasketId: null, subtrahendBasketId: null });
  });

  it('prices a run line as its controls absent against them at their period start level', () => {
    const pricing = composeReviewPricing([review({
      lines: [{ lineId: 'run', nature: 'run', capabilityIds: ['edr', 'mfa'] }],
      start: START,
      end: CURRENT,
    })], CURRENT);

    const line = differenceOf(pricing, 'review:line:run');
    expect(movesOf(pricing, line.minuendBasketId)).toEqual([
      { controlId: 'edr', targetStrengthRung: 'L0', targetCoverageBucket: 'L0' },
      { controlId: 'mfa', targetStrengthRung: 'L0', targetCoverageBucket: 'L0' },
    ]);
    expect(movesOf(pricing, line.subtrahendBasketId)).toEqual([{ controlId: 'edr', targetStrengthRung: 'L1', targetCoverageBucket: 'L1' }]);
  });

  /*
   * The build line's minuend and the run line's subtrahend are the same basket, which is what makes
   * a control in both lines telescope to its period end level against absent, priced once.
   */
  it('shares the period start basket between a build and a run line funding the same control', () => {
    const pricing = composeReviewPricing([review({
      lines: [
        { lineId: 'build', nature: 'build', capabilityIds: ['edr'] },
        { lineId: 'run', nature: 'run', capabilityIds: ['edr'] },
      ],
      start: START,
      end: CURRENT,
    })], CURRENT);

    expect(differenceOf(pricing, 'review:line:build').minuendBasketId)
      .toBe(differenceOf(pricing, 'review:line:run').subtrahendBasketId);
    expect(differenceOf(pricing, 'review:ensemble:').minuendBasketId)
      .toBe(differenceOf(pricing, 'review:line:run').minuendBasketId);
    expect(differenceOf(pricing, 'review:ensemble:').subtrahendBasketId).toBeNull();
  });

  it('prices the ensemble as one basket: run controls absent and build-only controls at the period start', () => {
    const pricing = composeReviewPricing([review({
      lines: [
        { lineId: 'build', nature: 'build', capabilityIds: ['edr'] },
        { lineId: 'run', nature: 'run', capabilityIds: ['mfa'] },
      ],
      start: START,
      end: CURRENT,
    })], CURRENT);

    expect(movesOf(pricing, differenceOf(pricing, 'review:ensemble:').minuendBasketId)).toEqual([
      { controlId: 'edr', targetStrengthRung: 'L1', targetCoverageBucket: 'L1' },
      { controlId: 'mfa', targetStrengthRung: 'L0', targetCoverageBucket: 'L0' },
    ]);
  });

  it('carries every control moved since the period end into every basket of a past period', () => {
    // EDR moved after the period ended: the past period's reference sets it back to its period end level.
    const pricing = composeReviewPricing([review({
      lines: [{ lineId: 'run', nature: 'run', capabilityIds: ['mfa'] }],
      start: new Map([['edr', at('L1', 'L1')], ['mfa', at('L3', 'L2')]]),
      end: new Map([['edr', at('L1', 'L1')], ['mfa', at('L3', 'L2')]]),
    })], CURRENT);

    const line = differenceOf(pricing, 'review:line:run');
    expect(movesOf(pricing, line.subtrahendBasketId)).toEqual([{ controlId: 'edr', targetStrengthRung: 'L1', targetCoverageBucket: 'L1' }]);
    expect(movesOf(pricing, line.minuendBasketId)).toEqual([
      { controlId: 'edr', targetStrengthRung: 'L1', targetCoverageBucket: 'L1' },
      { controlId: 'mfa', targetStrengthRung: 'L0', targetCoverageBucket: 'L0' },
    ]);
    expect(differenceOf(pricing, 'review:build:').minuendBasketId).toBe(line.subtrahendBasketId);
  });

  it('names one figure per line and three totals, each under the version it was read at', () => {
    const pricing = composeReviewPricing([review({
      lines: [{ lineId: 'build', nature: 'build', capabilityIds: ['edr'] }],
      start: START,
      end: CURRENT,
    })], CURRENT);

    expect(pricing.figures).toEqual([
      { key: 'review:line:build', reviewId: 'review', reviewVersion: 3, basket: 'line', lineId: 'build', stepOn: null },
      { key: 'review:build:', reviewId: 'review', reviewVersion: 3, basket: 'build', lineId: null, stepOn: null },
      { key: 'review:run:', reviewId: 'review', reviewVersion: 3, basket: 'run', lineId: null, stepOn: null },
      { key: 'review:ensemble:', reviewId: 'review', reviewVersion: 3, basket: 'ensemble', lineId: null, stepOn: null },
    ]);
  });

  /*
   * MFA moved in March from L1/L1, EDR in June, with NDR, in no build line, moving in between: on
   * the March step EDR and NDR stand where they stood that day, and the build controls go back to the
   * period start, which EDR already holds.
   */
  it('prices each move day but the last on that day\'s posture, every build control back at the period start', () => {
    const current = new Map([...CURRENT, ['ndr', at('L2', 'L1')]]);
    const march = new Map([['edr', at('L1', 'L1')], ['mfa', at('L3', 'L2')], ['ndr', at('L0', 'L0')]]);
    const pricing = composeReviewPricing([review({
      lines: [
        { lineId: 'identity', nature: 'build', capabilityIds: ['mfa'] },
        { lineId: 'endpoint', nature: 'build', capabilityIds: ['edr'] },
      ],
      start: new Map([['edr', at('L1', 'L1')], ['mfa', at('L1', 'L1')], ['ndr', at('L0', 'L0')]]),
      end: current,
      steps: [{ date: '2026-03-15', posture: march }],
    })], current);

    const step = differenceOf(pricing, 'review:step:2026-03-15');
    expect(movesOf(pricing, step.subtrahendBasketId)).toEqual([
      { controlId: 'edr', targetStrengthRung: 'L1', targetCoverageBucket: 'L1' },
      { controlId: 'ndr', targetStrengthRung: 'L0', targetCoverageBucket: 'L0' },
    ]);
    expect(movesOf(pricing, step.minuendBasketId)).toEqual([
      { controlId: 'edr', targetStrengthRung: 'L1', targetCoverageBucket: 'L1' },
      { controlId: 'mfa', targetStrengthRung: 'L1', targetCoverageBucket: 'L1' },
      { controlId: 'ndr', targetStrengthRung: 'L0', targetCoverageBucket: 'L0' },
    ]);
    expect(differenceOf(pricing, 'review:step-level:2026-03-15'))
      .toMatchObject({ minuendBasketId: step.subtrahendBasketId, subtrahendBasketId: null });
    expect(pricing.figures.filter((entry) => entry.basket === 'step')).toEqual([
      expect.objectContaining({ lineId: null, stepOn: '2026-03-15' }),
    ]);
  });

  it('sets a control moved twice back to the period start on each of its days', () => {
    const start = new Map([['mfa', at('L1', 'L1')]]);
    const pricing = composeReviewPricing([review({
      lines: [{ lineId: 'identity', nature: 'build', capabilityIds: ['mfa'] }],
      start,
      end: CURRENT,
      steps: [
        { date: '2026-03-15', posture: new Map([['edr', at('L2', 'L2')], ['mfa', at('L2', 'L1')]]) },
        { date: '2026-06-10', posture: new Map([['edr', at('L2', 'L2')], ['mfa', at('L3', 'L1')]]) },
      ],
    })], CURRENT);

    for (const date of ['2026-03-15', '2026-06-10']) {
      expect(movesOf(pricing, differenceOf(pricing, `review:step:${date}`).minuendBasketId)).toEqual([
        { controlId: 'mfa', targetStrengthRung: 'L1', targetCoverageBucket: 'L1' },
      ]);
    }
  });

  it('prices two reviews asking for the same posture once', () => {
    const line = [{ lineId: 'build', nature: 'build' as const, capabilityIds: ['edr'] }];
    const pricing = composeReviewPricing([
      review({ reviewId: 'first', lines: line, start: START, end: CURRENT }),
      review({ reviewId: 'second', lines: line, start: START, end: CURRENT }),
    ], CURRENT);

    expect(pricing.baskets).toHaveLength(1);
    expect(differenceOf(pricing, 'first:line:build').minuendBasketId).toBe(differenceOf(pricing, 'second:line:build').minuendBasketId);
  });

  it('reads a running period\'s tolerance on the run\'s own posture and on the build figure\'s minuend', () => {
    const pricing = composeReviewPricing([review({
      lines: [{ lineId: 'build', nature: 'build', capabilityIds: ['edr'] }, { lineId: 'run', nature: 'run', capabilityIds: ['mfa'] }],
      start: START,
      end: CURRENT,
    })], CURRENT);

    expect(pricing.exceedances).toEqual([{
      reviewId: 'review',
      reviewVersion: 3,
      referenceBasketId: null,
      withoutBuildBasketId: differenceOf(pricing, 'review:build:').minuendBasketId,
    }]);
    expect(annualLossBasketsOf(pricing.exceedances)).toEqual([differenceOf(pricing, 'review:build:').minuendBasketId]);
  });

  it('reads a past period\'s tolerance on its period end posture, and the same basket twice for a review without build work', () => {
    const pricing = composeReviewPricing([review({
      lines: [{ lineId: 'run', nature: 'run', capabilityIds: ['mfa'] }],
      start: START,
      end: START,
    })], CURRENT);

    const [exceedance] = pricing.exceedances;
    expect(movesOf(pricing, exceedance.referenceBasketId)).toEqual([{ controlId: 'edr', targetStrengthRung: 'L1', targetCoverageBucket: 'L1' }]);
    expect(exceedance.withoutBuildBasketId).toBe(exceedance.referenceBasketId);
    expect(annualLossBasketsOf(pricing.exceedances)).toEqual([exceedance.referenceBasketId]);
  });
});

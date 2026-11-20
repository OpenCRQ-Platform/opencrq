import type { BudgetLineNature, BudgetReviewStoredBasket } from './constants';
import type { CoverageBucket, StrengthRung } from '../controls/capability/constants';
import { compareCodePoints } from '@app/utils';
import { samePosture } from '../controls/capability/posture-at-date';

export interface PostureValue {
  strengthRung: StrengthRung,
  coverageBucket: CoverageBucket,
}

const ABSENT: PostureValue = { strengthRung: 'L0', coverageBucket: 'L0' };

export interface PricedReviewLine {
  lineId: string,
  nature: BudgetLineNature,
  capabilityIds: ReadonlyArray<string>,
}

export interface PricedReview {
  reviewId: string,
  version: number,
  lines: ReadonlyArray<PricedReviewLine>,
  /** The scope's posture just before the review's period starts. */
  start: ReadonlyMap<string, PostureValue>,
  /** The scope's posture just before the review's period ends, or today's while it runs. */
  end: ReadonlyMap<string, PostureValue>,
  /** Every day a build control moved but the last, as `YYYY-MM-DD`, with the scope's posture at its end. */
  steps: ReadonlyArray<{ date: string, posture: ReadonlyMap<string, PostureValue> }>,
}

/** One posture to price, as a set of moves away from the run's own. */
export interface ReviewBasket {
  basketId: string,
  moves: Array<{ controlId: string, targetStrengthRung: StrengthRung, targetCoverageBucket: CoverageBucket }>,
}

/** `ALE(minuend) - ALE(subtrahend)`, world by world; a null basket is the run's own posture. */
export interface ReviewBasketDifference {
  key: string,
  minuendBasketId: string | null,
  subtrahendBasketId: string | null,
}

export interface ReviewFigureKey {
  key: string,
  reviewId: string,
  reviewVersion: number,
  basket: BudgetReviewStoredBasket,
  lineId: string | null,
  stepOn: string | null,
}

/**
 * The two postures a review's risk tolerance is read at, those of its `build` figure: the reference
 * R and R with the build lines' controls at their period-start posture. A null basket is the run's own.
 */
export interface ReviewExceedanceKey {
  reviewId: string,
  reviewVersion: number,
  referenceBasketId: string | null,
  withoutBuildBasketId: string | null,
}

export interface ReviewPricing {
  baskets: Array<ReviewBasket>,
  differences: Array<ReviewBasketDifference>,
  figures: Array<ReviewFigureKey>,
  exceedances: Array<ReviewExceedanceKey>,
}

/** Every basket an exceedance names, once: the run's own posture already draws its annual loss. */
export const annualLossBasketsOf = (exceedances: ReadonlyArray<ReviewExceedanceKey>): Array<string> => [...new Set(exceedances
  .flatMap((exceedance) => [exceedance.referenceBasketId, exceedance.withoutBuildBasketId])
  .filter((basketId) => basketId !== null))];

const postureOf = (postures: ReadonlyMap<string, PostureValue>, capabilityId: string): PostureValue =>
  postures.get(capabilityId) ?? ABSENT;

/**
 * Every figure of the scope's open reviews, as paired differences between baskets the engine prices
 * on one run's worlds. With S the posture at the period's start, E at its end and A a control absent,
 * every basket starts from the reference R = E:
 *
 * - a build line B is worth `ALE(R, B at S) - ALE(R)`, what the period's posture changes removed;
 * - a run line F is worth `ALE(R, F absent) - ALE(R, F at S)`, the level held at the start against
 *   nothing, so a control in both a build and a run line telescopes to `ALE(R, absent) - ALE(R)`
 *   and is never counted twice;
 * - the build and run totals are the same over the union of each nature's controls;
 * - the ensemble prices every run control absent and every build-only control at S, against R, as
 *   one basket: summing the two totals would count twice what two stacked controls share;
 * - each step, P being the posture at that day's end, gets `step`, `ALE(P, every build control at S)
 *   - ALE(P)`, and `step-level`, `ALE(P) - ALE(R)`, so the risk curve reads the build work done by then
 *   on that day's posture. A build control yet to move already stands at S there. The last day a build
 *   control moved needs neither: the build figure is the step from it on.
 *
 * R is the run's own posture wherever E is (a running period), and for a past period every control
 * that moved since its end set back to its value then, so a past period reads the same whatever
 * moved after it. Two baskets holding the same moves are priced once, across reviews too, and a
 * basket moving nothing is the run's own posture.
 */
export const composeReviewPricing = (
  reviews: ReadonlyArray<PricedReview>,
  current: ReadonlyMap<string, PostureValue>,
): ReviewPricing => {
  const baskets: Array<ReviewBasket> = [];
  const basketIdBySignature = new Map<string, string>();

  const basketOf = (targets: ReadonlyMap<string, PostureValue>): string | null => {
    const moves = [...targets]
      .filter(([capabilityId, target]) => !samePosture(target, postureOf(current, capabilityId)))
      .sort(([first], [second]) => compareCodePoints(first, second))
      .map(([controlId, target]) => ({
        controlId,
        targetStrengthRung: target.strengthRung,
        targetCoverageBucket: target.coverageBucket,
      }));
    if (moves.length === 0) {
      return null;
    }
    const signature = moves
      .map((move) => `${move.controlId}:${move.targetStrengthRung}:${move.targetCoverageBucket}`)
      .join('|');
    const known = basketIdBySignature.get(signature);
    if (known !== undefined) {
      return known;
    }
    const basketId = `basket-${baskets.length}`;
    baskets.push({ basketId, moves });
    basketIdBySignature.set(signature, basketId);
    return basketId;
  };

  const differences: Array<ReviewBasketDifference> = [];
  const figures: Array<ReviewFigureKey> = [];
  const exceedances: Array<ReviewExceedanceKey> = [];

  for (const review of reviews) {
    const reference = new Map<string, PostureValue>();
    for (const [capabilityId, end] of review.end) {
      if (!samePosture(end, postureOf(current, capabilityId))) {
        reference.set(capabilityId, end);
      }
    }
    const referenceWith = (overrides: ReadonlyArray<[string, PostureValue]>): Map<string, PostureValue> =>
      new Map([...reference, ...overrides]);
    const atStart = (capabilityIds: Iterable<string>): Array<[string, PostureValue]> =>
      [...capabilityIds].map((capabilityId) => [capabilityId, postureOf(review.start, capabilityId)]);
    const absent = (capabilityIds: Iterable<string>): Array<[string, PostureValue]> =>
      [...capabilityIds].map((capabilityId) => [capabilityId, ABSENT]);

    const referenceBasket = basketOf(reference);
    const figure = (
      basket: BudgetReviewStoredBasket,
      lineId: string | null,
      minuend: ReadonlyMap<string, PostureValue>,
      subtrahendBasketId: string | null,
      stepOn: string | null = null,
    ) => {
      const key = `${review.reviewId}:${basket}:${lineId ?? stepOn ?? ''}`;
      differences.push({ key, minuendBasketId: basketOf(minuend), subtrahendBasketId });
      figures.push({ key, reviewId: review.reviewId, reviewVersion: review.version, basket, lineId, stepOn });
    };

    const buildControls = new Set(review.lines.filter((line) => line.nature === 'build').flatMap((line) => line.capabilityIds));
    const runControls = new Set(review.lines.filter((line) => line.nature === 'run').flatMap((line) => line.capabilityIds));

    for (const line of review.lines) {
      if (line.nature === 'build') {
        figure('line', line.lineId, referenceWith(atStart(line.capabilityIds)), referenceBasket);
      } else {
        figure('line', line.lineId, referenceWith(absent(line.capabilityIds)), basketOf(referenceWith(atStart(line.capabilityIds))));
      }
    }
    figure('build', null, referenceWith(atStart(buildControls)), referenceBasket);
    exceedances.push({
      reviewId: review.reviewId,
      reviewVersion: review.version,
      referenceBasketId: referenceBasket,
      withoutBuildBasketId: basketOf(referenceWith(atStart(buildControls))),
    });
    figure('run', null, referenceWith(absent(runControls)), basketOf(referenceWith(atStart(runControls))));
    const buildOnly = [...buildControls].filter((capabilityId) => !runControls.has(capabilityId));
    figure('ensemble', null, referenceWith([...atStart(buildOnly), ...absent(runControls)]), referenceBasket);

    for (const step of review.steps) {
      figure('step', null, new Map([...step.posture, ...atStart(buildControls)]), basketOf(step.posture), step.date);
      figure('step-level', null, step.posture, referenceBasket, step.date);
    }
  }

  return { baskets, differences, figures, exceedances };
};

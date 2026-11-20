/**
 * Noisy-OR combinator of the threat activity decay (`activity-scoring.ts`), which reads a set of
 * independent evidence signals as a probability: `P = 1 - PROD(1 - w_i)`. It is deliberately
 * uncapped, converging asymptotically to 1, and returns 0 on an empty signal set so "no evidence" and "evidence worth nothing" read the same.
 *
 * It is computed as `-expm1(SUM(log1p(-w_i)))`, the same maths: the literal `1 - PROD(1 - w)` rounds
 * a weight below ~5e-17 to exactly 0, which would erase a very old activity from the score.
 *
 * It is NOT the attacker-mixture math: the per-technique weight that feeds the CRQ run is a
 * normalized share (`technique-weighting.ts`), not a noisy-OR, precisely so that ingesting more CTI
 * cannot mechanically inflate vulnerability.
 */
export const combineSignalWeights = (signalWeights: Array<number>): number => {
  if (signalWeights.length === 0) {
    return 0;
  }
  // `0 -` rather than a unary minus, so a set of zero weights yields +0 and not -0.
  return 0 - Math.expm1(signalWeights.reduce((accumulator, weight) => accumulator + Math.log1p(-weight), 0));
};

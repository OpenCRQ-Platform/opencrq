const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

export const logGamma = (value: number): number => {
  if (value < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * value)) - logGamma(1 - value);
  }
  const shifted = value - 1;
  const series = LANCZOS.reduce((sum, coefficient, index) => sum + coefficient / (shifted + index + 1), 0.99999999999980993);
  const t = shifted + LANCZOS.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(series);
};

/** Lentz's continued fraction for the incomplete beta, converging for `x < (a+1)/(a+b+2)`. */
const betaContinuedFraction = (alpha: number, beta: number, x: number): number => {
  const tiny = 1e-30;
  const qab = alpha + beta;
  let c = 1;
  let d = 1 - (qab * x) / (alpha + 1);
  d = Math.abs(d) < tiny ? tiny : d;
  d = 1 / d;
  let fraction = d;
  for (let m = 1; m <= 200; m += 1) {
    const even = (m * (beta - m) * x) / ((alpha + 2 * m - 1) * (alpha + 2 * m));
    const odd = -((alpha + m) * (qab + m) * x) / ((alpha + 2 * m) * (alpha + 2 * m + 1));
    for (const numerator of [even, odd]) {
      d = 1 + numerator * d;
      d = 1 / (Math.abs(d) < tiny ? tiny : d);
      c = 1 + numerator / (Math.abs(c) < tiny ? tiny : c);
      fraction *= d * c;
    }
    if (Math.abs(d * c - 1) < 1e-14) {
      break;
    }
  }
  return fraction;
};

/** `I_x(a, b)`, the Beta cumulative distribution function. */
export const regularizedIncompleteBeta = (alpha: number, beta: number, x: number): number => {
  if (x <= 0) {
    return 0;
  }
  if (x >= 1) {
    return 1;
  }
  const front = Math.exp(logGamma(alpha + beta) - logGamma(alpha) - logGamma(beta)
    + alpha * Math.log(x) + beta * Math.log(1 - x));
  return x < (alpha + 1) / (alpha + beta + 2)
    ? (front * betaContinuedFraction(alpha, beta, x)) / alpha
    : 1 - (front * betaContinuedFraction(beta, alpha, 1 - x)) / beta;
};

/**
 * The Beta quantile, by bisection.
 *
 * The engine draws its PERT ranges by inverse transform rather than by rejection, so a draw is a
 * monotone function of one stratified uniform and its marginal is exact.
 */
export const betaQuantile = (alpha: number, beta: number, probability: number): number => {
  let low = 0;
  let high = 1;
  for (let step = 0; step < 40; step += 1) {
    const middle = (low + high) / 2;
    if (regularizedIncompleteBeta(alpha, beta, middle) < probability) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return (low + high) / 2;
};

const pertShape = (min: number, likely: number, max: number): { alpha: number, beta: number } => ({
  alpha: 1 + 4 * (likely - min) / (max - min),
  beta: 1 + 4 * (max - likely) / (max - min),
});

/** The PERT quantile on `[min, max]`: a scaled Beta with mode `likely`, inverted rather than drawn. */
export const pertQuantile = (min: number, likely: number, max: number, probability: number): number => {
  if (max <= min) {
    return min;
  }
  const { alpha, beta } = pertShape(min, likely, max);
  return min + (max - min) * betaQuantile(alpha, beta, probability);
};

/** `P(X < value)` for `X` the PERT on `[min, max]`, a step at that value for a range held to one value. */
export const pertBelow = (min: number, likely: number, max: number, value: number): number => {
  if (max <= min) {
    return min < value ? 1 : 0;
  }
  const { alpha, beta } = pertShape(min, likely, max);
  return regularizedIncompleteBeta(alpha, beta, (value - min) / (max - min));
};

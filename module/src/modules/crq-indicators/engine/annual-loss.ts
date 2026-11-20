import { logGamma } from './distributions';
import { createPrng, deriveSeed } from './prng';

/**
 * The year's loss of a scenario, which a loss exceedance curve reads. The spread of the worlds
 * cannot stand in for it: a world prices the expected loss of its year, not a year.
 */

/** The levels a run keeps its annual loss at: every percentile, then the tail a tolerance is usually set in. */
export const ANNUAL_LOSS_PROBABILITIES: ReadonlyArray<number> = [
  ...Array.from({ length: 99 }, (_, index) => (index + 1) / 100),
  0.995,
  0.998,
  0.999,
];

/**
 * Years drawn in each world. At one year per world, a scenario with a low LEF would draw its whole
 * tail from a few dozen years with a loss, and a year costs nothing next to a world's evaluation.
 */
export const ANNUAL_LOSS_YEARS_PER_WORLD = 10;

/** The TEF has no upper bound, so past this many events a year's summed loss is drawn from its normal limit. */
const EXACT_EVENT_LIMIT = 1000;

export interface AnnualLossQuantile {
  readonly probability: number,
  readonly loss: number,
}

export interface AnnualLossDistribution {
  readonly years: number,
  readonly mean: number,
  /** Years costing anything, an attack stopped in time included. */
  readonly lossYearShare: number,
  /** Years with at least one loss event, the sampled reading of `1 − e^−LEF`. */
  readonly lossEventYearShare: number,
  readonly quantiles: ReadonlyArray<AnnualLossQuantile>,
}

/** One kind of event a year can hold, drawn on its own Poisson count. */
export interface AnnualLossStream {
  /** One expected count per world. */
  readonly rates: Float64Array,
  /** What one event costs, as a fraction of its magnitude. */
  readonly pricedFraction: number,
  /** Whether the LEF counts it: an attack stopped in time costs its response without being a loss event. */
  readonly lossEvent: boolean,
}

export interface AnnualLossInputs {
  /** Every stream carries one rate per world, in the same order as `magnitudes`. */
  readonly streams: ReadonlyArray<AnnualLossStream>,
  /** The magnitudes the worlds drew. Each event resamples one, so they stand for the law of a single loss. */
  readonly magnitudes: Float64Array,
  readonly yearsPerWorld: number,
  readonly seed: string,
}

/** Inversion under a rate of ten, Hörmann's transformed rejection (PTRS) above, whose cost does not grow with the rate. */
export const poissonDraw = (rate: number, random: () => number): number => {
  if (rate <= 0) {
    return 0;
  }
  if (rate < 10) {
    const uniform = random();
    let count = 0;
    let term = Math.exp(-rate);
    let cumulative = term;
    while (uniform > cumulative && term > 0) {
      count += 1;
      term *= rate / count;
      cumulative += term;
    }
    return count;
  }
  const logRate = Math.log(rate);
  const b = 0.931 + 2.53 * Math.sqrt(rate);
  const a = -0.059 + 0.02483 * b;
  const logInverseAlpha = Math.log(1.1239 + 1.1328 / (b - 3.4));
  const squeeze = 0.9277 - 3.6224 / (b - 2);
  for (;;) {
    const u = random() - 0.5;
    const v = random();
    const distance = 0.5 - Math.abs(u);
    const count = Math.floor((2 * a / distance + b) * u + rate + 0.43);
    if (distance >= 0.07 && v <= squeeze) {
      return count;
    }
    if (count < 0 || (distance < 0.013 && v > distance)) {
      continue;
    }
    if (Math.log(v) + logInverseAlpha - Math.log(a / (distance * distance) + b) <= -rate + count * logRate - logGamma(count + 1)) {
      return count;
    }
  }
};

const normalDraw = (random: () => number): number =>
  Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());

const EMPTY: AnnualLossDistribution = {
  years: 0,
  mean: 0,
  lossYearShare: 0,
  lossEventYearShare: 0,
  quantiles: ANNUAL_LOSS_PROBABILITIES.map((probability) => ({ probability, loss: 0 })),
};

/**
 * Each year draws a Poisson count per stream on its world's rate, one magnitude per event, summed.
 * Every world and stream draws from its own seed: on one shared sequence, a count flipping under an
 * input moved in its last digits would shift every draw after it, and redraw the whole curve.
 */
export const sampleAnnualLosses = (inputs: AnnualLossInputs): AnnualLossDistribution => {
  const { streams, magnitudes, yearsPerWorld } = inputs;
  const years = magnitudes.length * yearsPerWorld;
  if (years === 0) {
    return EMPTY;
  }
  let magnitudeTotal = 0;
  let magnitudeSquares = 0;
  for (const magnitude of magnitudes) {
    magnitudeTotal += magnitude;
    magnitudeSquares += magnitude * magnitude;
  }
  const magnitudeMean = magnitudeTotal / magnitudes.length;
  const magnitudeVariance = Math.max(0, magnitudeSquares / magnitudes.length - magnitudeMean * magnitudeMean);

  const summedMagnitudes = (events: number, random: () => number): number => {
    if (events > EXACT_EVENT_LIMIT) {
      return Math.max(0, events * magnitudeMean + Math.sqrt(events * magnitudeVariance) * normalDraw(random));
    }
    let summed = 0;
    for (let event = 0; event < events; event += 1) {
      summed += magnitudes[Math.floor(random() * magnitudes.length)];
    }
    return summed;
  };

  const losses = new Float64Array(years);
  let total = 0;
  let lossYears = 0;
  let lossEventYears = 0;
  let year = 0;
  for (let world = 0; world < magnitudes.length; world += 1) {
    const randoms = streams.map((_, stream) => createPrng(deriveSeed(inputs.seed, `annual-loss:${world}:${stream}`)));
    for (let draw = 0; draw < yearsPerWorld; draw += 1) {
      let loss = 0;
      let lossEvents = 0;
      for (const [index, stream] of streams.entries()) {
        const events = poissonDraw(stream.rates[world], randoms[index]);
        loss += summedMagnitudes(events, randoms[index]) * stream.pricedFraction;
        lossEvents += stream.lossEvent ? events : 0;
      }
      losses[year] = loss;
      total += loss;
      lossYears += loss > 0 ? 1 : 0;
      lossEventYears += lossEvents > 0 ? 1 : 0;
      year += 1;
    }
  }
  losses.sort();
  return {
    years,
    mean: total / years,
    lossYearShare: lossYears / years,
    lossEventYearShare: lossEventYears / years,
    quantiles: ANNUAL_LOSS_PROBABILITIES.map((probability) => ({ probability, loss: losses[Math.floor(probability * years)] })),
  };
};

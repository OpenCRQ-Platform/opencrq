/**
 * How a control's declared efficacy on one (technique, function) is audited by what OpenAEV observed
 * there. A result says whether the host was protected, which an absent control and a present one
 * letting the technique through answer alike, so the observed rate estimates strength x coverage
 * itself and is read against it rather than multiplied into it.
 */

/** How far a technique's efficacy moves from the one its levers were priced on before they are booked again. */
export const TESTED_REBOOK_STEP = 0.05;

// A move landing on the step must count as one, whatever the float error.
const STEP_TOLERANCE = 1e-9;

export interface TestedResult {
  /** `T`: the share of the tests that held, in [0, 1]. */
  readonly rate: number,
  /** `n`: the scope's hosts with a counted result. */
  readonly hostsTested: number,
  /** `N`: the scope's hosts. */
  readonly scopeHosts: number,
}

/** `alpha = n / N`, the share of the scope's hosts the result speaks for; 0 when the scope holds none. */
export const testedCoverage = (tested: TestedResult): number =>
  (tested.scopeHosts > 0 && tested.hostsTested > 0 ? Math.min(1, tested.hostsTested / tested.scopeHosts) : 0);

/**
 * `min(D, (1 - alpha) x D + alpha x T)`: the declaration is the ceiling, since a test validates a
 * promise and cannot create coverage nobody declared, and a rate below it pulls it down as far as the
 * scope was tested. Exactly `declared` with no result, and a control declared absent stays absent.
 */
export const testedEfficacy = (declared: number, tested: TestedResult | undefined): number => {
  if (tested === undefined || !(declared > 0)) {
    return declared;
  }
  return declared - testedCoverage(tested) * Math.max(0, declared - tested.rate);
};

/** The weakest of the efficacies several results audit one declaration at; the declaration itself with none. */
export const lowestTestedEfficacy = (declared: number, tested: ReadonlyArray<TestedResult>): number =>
  Math.min(declared, ...tested.map((result) => testedEfficacy(declared, result)));

/** Whether a technique priced on `booked` reads far enough from `current` for its levers to be booked again. */
export const testedRebooks = (declared: number, booked: TestedResult | undefined, current: TestedResult | undefined): boolean =>
  Math.abs(testedEfficacy(declared, current) - testedEfficacy(declared, booked)) >= TESTED_REBOOK_STEP - STEP_TOLERANCE;

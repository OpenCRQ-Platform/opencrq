import { RiskScenario_DataBreachCrm, RiskScenario_DataBreachRetailPos } from './ids';

/**
 * The first day of the month eleven months back, or ten when that one is a January: a period still
 * running that straddles two calendar years and stays inside the capability seeder's 400-day log.
 */
export const runningPeriodStart = (now: Date): Date => {
  const monthsBack = now.getUTCMonth() === 11 ? 10 : 11;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1));
};

/**
 * `share` of the way through the running period, never the calendar year: early January would
 * squeeze the period's moves onto one day, after the last week's.
 */
export const withinRunningPeriod = (now: Date, share: number): Date => {
  const start = runningPeriodStart(now).getTime();
  return new Date(start + (now.getTime() - start) * share);
};

/** The fiscal year before the running one, closed shortly after it ended. */
export const previousPeriodStart = (now: Date): Date => {
  const running = runningPeriodStart(now);
  return new Date(Date.UTC(running.getUTCFullYear() - 1, running.getUTCMonth(), 1));
};

/** When the previous fiscal year's data loss project deployed DLP and IPS. */
export const previousBuildLanding = (now: Date): Date => {
  const previous = previousPeriodStart(now);
  return new Date(Date.UTC(previous.getUTCFullYear(), previous.getUTCMonth() + 6, 1));
};

export const periodStartColumn = (start: Date): string =>
  `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}-01`;

export interface PostureStep {
  at: Date,
  /** How much higher the scenario's loss ran before `at`. */
  factor: number,
}

interface ScenarioSteps {
  running: ReadonlyArray<PostureStep>,
  previous: ReadonlyArray<PostureStep>,
}

/**
 * Where in the running period the capability seeder moves the tenant's controls, EDR on a later day
 * so the identity project spans two, and declares the scope's PAM.
 */
export const RUNNING_PERIOD_MOVES = { controls: 0.5, edr: 0.6, scopePam: 0.7 } as const;

/** The day EDR moves again, inside the last week, which the run history's default comparison lists. */
export const EDR_LAST_WEEK_DAYS_AGO = 4;

const STEP_FACTORS: ReadonlyMap<string, { mfa: number, edr: number, pam: number, edrLastWeek: number, dataLoss: number }> = new Map([
  [RiskScenario_DataBreachCrm, { mfa: 1.25, edr: 1.16, pam: 1.17, edrLastWeek: 1.05, dataLoss: 1.2 }],
  [RiskScenario_DataBreachRetailPos, { mfa: 1.05, edr: 1.03, pam: 1.04, edrLastWeek: 1.02, dataLoss: 1.1 }],
]);

/**
 * When the build work of the payment platform scope moved its controls and what each move took off a
 * scenario's loss: the running year's identity project on the days the capability seeder moves IDP
 * and then EDR, its privileged access rollout on the day PAM is declared, EDR again inside the last
 * week, the previous year's data loss project half-way through that year. The run history steps down there and the reviews price
 * their build work at the same factors, so a curve and the counterfactual it is annotated with agree.
 * Undefined for a scenario outside that scope.
 */
export const postureStepsOf = (scenarioId: string, now: Date): ScenarioSteps | undefined => {
  const factors = STEP_FACTORS.get(scenarioId);
  if (factors === undefined) {
    return undefined;
  }
  return {
    running: [
      { at: withinRunningPeriod(now, RUNNING_PERIOD_MOVES.controls), factor: factors.mfa },
      { at: withinRunningPeriod(now, RUNNING_PERIOD_MOVES.edr), factor: factors.edr },
      { at: withinRunningPeriod(now, RUNNING_PERIOD_MOVES.scopePam), factor: factors.pam },
      { at: new Date(now.getTime() - EDR_LAST_WEEK_DAYS_AGO * 86_400_000), factor: factors.edrLastWeek },
    ],
    previous: [{ at: previousBuildLanding(now), factor: factors.dataLoss }],
  };
};

export const stepProduct = (steps: ReadonlyArray<PostureStep>): number =>
  steps.reduce((product, step) => product * step.factor, 1);

/** The loss on `date` relative to today's: every step still ahead of it. */
export const stepMultiplierAt = (steps: ReadonlyArray<PostureStep>, date: Date): number =>
  stepProduct(steps.filter((step) => step.at > date));

/** What the run line saves against its controls absent, as a multiple of the scenario's loss. */
export const RUN_LINE_MULTIPLE: ReadonlyMap<string, number> = new Map([
  [RiskScenario_DataBreachCrm, 1.4],
  [RiskScenario_DataBreachRetailPos, 0.5],
]);

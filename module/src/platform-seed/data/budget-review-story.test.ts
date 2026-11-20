import { describe, expect, it } from 'vitest';
import { postureStepsOf, previousPeriodStart, runningPeriodStart } from './budget-review-story';
import { RiskScenario_DataBreachCrm } from './ids';

const DAY_MS = 86_400_000;
const utcDay = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Two moves on one day write the same build step twice, which the closing refuses on its unique
 * basket, and a move after the last week's EDR one breaks the order the run history steps down in.
 * Both only showed on a few days of the year, so every day of a leap year is walked, at both ends.
 */
const SEED_INSTANTS = Array.from({ length: 366 }, (_, day) => Date.UTC(2028, 0, 1) + day * DAY_MS)
  .flatMap((midnight) => [new Date(midnight + 30 * 60_000), new Date(midnight + DAY_MS - 30 * 60_000)]);

describe('the budget review story', () => {
  it('moves the running year\'s controls in order, on days of their own, inside the period and before the last week\'s EDR move', () => {
    const broken = SEED_INSTANTS.filter((now) => {
      const { running } = postureStepsOf(RiskScenario_DataBreachCrm, now)!;
      const days = running.map((step) => utcDay(step.at));
      const ordered = running.every((step, index) => index === 0 || step.at > running[index - 1].at);
      return !ordered || new Set(days).size !== days.length || running[0].at < runningPeriodStart(now);
    });
    expect(broken.map(utcDay)).toEqual([]);
  });

  it('lands the previous year\'s build inside the previous period', () => {
    const broken = SEED_INSTANTS.filter((now) => {
      const [landing] = postureStepsOf(RiskScenario_DataBreachCrm, now)!.previous;
      return landing.at < previousPeriodStart(now) || landing.at >= runningPeriodStart(now);
    });
    expect(broken.map(utcDay)).toEqual([]);
  });
});

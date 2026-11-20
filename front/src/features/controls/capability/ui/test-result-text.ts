import { plural, t } from '@lingui/core/macro';
import type { CapabilityFunction } from '@app/module/client';
import type { TechniqueTestOutcome } from '../types/validation';
import { formatEnginePercent } from '../utils/engine-efficacy-utils';

/** "1/10 tests succeeded", or "10/10 tests detected" on detection. */
export const testCountText = (capabilityFunction: CapabilityFunction, { heldTests, tests }: Pick<TechniqueTestOutcome, 'heldTests' | 'tests'>): string =>
  (capabilityFunction === 'prevent'
    ? plural(tests, { one: `${heldTests}/# test succeeded`, other: `${heldTests}/# tests succeeded` })
    : plural(tests, { one: `${heldTests}/# test detected`, other: `${heldTests}/# tests detected` }));

/** "10/20 hosts tested". */
export const hostCountText = ({ hostsTested, scopeHosts }: Pick<TechniqueTestOutcome, 'hostsTested' | 'scopeHosts'>): string =>
  plural(scopeHosts, { one: `${hostsTested}/# host tested`, other: `${hostsTested}/# hosts tested` });

export const testResultText = (capabilityFunction: CapabilityFunction, tested: TechniqueTestOutcome): string => {
  const count = testCountText(capabilityFunction, tested);
  const rate = formatEnginePercent(tested.rate);
  return t`${count} (${rate})`;
};

export const hostResultText = (tested: TechniqueTestOutcome): string => {
  const count = hostCountText(tested);
  const share = formatEnginePercent(tested.share);
  return t`${count} (${share})`;
};

/** The result and the hosts its tests ran on, in one line, for a tooltip. */
export const openAevResultLine = (capabilityFunction: CapabilityFunction, tested: TechniqueTestOutcome): string => {
  const result = testResultText(capabilityFunction, tested);
  const hosts = hostResultText(tested);
  return t`${result} · ${hosts}`;
};

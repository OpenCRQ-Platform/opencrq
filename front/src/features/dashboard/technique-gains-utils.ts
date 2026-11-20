import { EMPTY_VALUE } from '../../utils/empty-value';
import { formatDollar } from '../../utils';

/** What removing a technique saves: it never succeeds, it is always detected, or both together. */
export type GainReading = 'prevention' | 'detection' | 'total';

export const GAIN_READINGS: ReadonlyArray<GainReading> = ['prevention', 'detection', 'total'];

export const DEFAULT_GAIN_READING: GainReading = 'total';

export interface TechniqueGain {
  id: string,
  externalId: string,
  name: string,
  prevention: number,
  detection: number,
  total: number,
}

export interface TacticGains {
  id: string,
  externalId: string,
  name: string,
  techniques: Array<TechniqueGain>,
}

/** Zero is a technique no attack path plays, and a figure below it is the simulation's noise. */
export const hasGain = (value: number): boolean => value > 0;

export const sortTechniques = (techniques: Array<TechniqueGain>, reading: GainReading): Array<TechniqueGain> =>
  [...techniques].sort((a, b) => (b[reading] - a[reading]) || a.externalId.localeCompare(b.externalId));

export const TECHNIQUES_PER_TACTIC = 5;

export const exceedsTechniqueCap = (tactics: Array<TacticGains>): boolean =>
  tactics.some((tactic) => tactic.techniques.length > TECHNIQUES_PER_TACTIC);

export const countGainingTechniques = (techniques: Array<TechniqueGain>, reading: GainReading): number =>
  techniques.filter((technique) => hasGain(technique[reading])).length;

export const largestGain = (tactics: Array<TacticGains>, reading: GainReading): number =>
  tactics.reduce((largest, tactic) => tactic.techniques.reduce((top, technique) => Math.max(top, technique[reading]), largest), 0);

export const FAINTEST_SHADE = 0.1;
export const STRONGEST_SHADE = 0.85;

export const gainShade = (value: number, largest: number): number | null => {
  if (!hasGain(value) || largest <= 0) {
    return null;
  }
  return FAINTEST_SHADE + (STRONGEST_SHADE - FAINTEST_SHADE) * Math.min(1, value / largest);
};

/** The hue the scenario TTP tab paints a technique's value with. */
export const shadeColor = (opacity: number): string =>
  // eslint-disable-next-line lingui/no-unlocalized-strings -- CSS colour expression, not copy
  `color-mix(in srgb, var(--fds-color-feedback-warning-primary) ${Math.round(opacity * 100)}%, transparent)`;

/** Past this opacity the negative ink contrasts with the shade better than the default one does. */
export const STRONG_SHADE = 0.7;

/** Unsigned, unlike the reductions beside it: the matrix reads as what a technique costs, not as a fall. */
export const formatGain = (value: number): string => (hasGain(value) ? formatDollar(value) : EMPTY_VALUE);

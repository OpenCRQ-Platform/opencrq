import { OUTCOME_WEIGHT_THRESHOLD } from '@app/module/client';
import { roundPercentPoints } from '@app/utils/decimals';
import { formatFractionAsPercent } from './format-number';

const THRESHOLD_PERCENT = roundPercentPoints(OUTCOME_WEIGHT_THRESHOLD, 0);

/**
 * A stored outcome probability as a percentage, whole unless rounding would land it on the
 * weighing threshold: a threat just above it must not read like one just below it, so both keep a
 * decimal there (50.3%, 49.6%) and only the threshold itself reads 50%.
 */
export const formatOutcomeProbability = (probability: number): string => {
  const onThreshold = roundPercentPoints(probability, 0) === THRESHOLD_PERCENT && probability !== OUTCOME_WEIGHT_THRESHOLD;
  return formatFractionAsPercent(probability, onThreshold ? 1 : 0);
};

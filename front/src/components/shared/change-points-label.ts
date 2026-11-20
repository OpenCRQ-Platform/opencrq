import { plural } from '@lingui/core/macro';
import { formatSignedPoints } from './lifeline-utils';

export const changePointsLabel = (points: number): string => {
  const signed = formatSignedPoints(points);
  return plural(Math.abs(points), { one: `${signed} pt`, other: `${signed} pts` });
};

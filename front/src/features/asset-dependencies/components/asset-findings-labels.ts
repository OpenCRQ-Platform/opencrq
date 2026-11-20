import { i18n } from '@lingui/core';
import { plural } from '@lingui/core/macro';
import type { FindingPill } from '../dependency-graph-utils';
import { postureBandForScore } from '@app/module/client';
import { postureBandWord } from '../../supporting-assets/components/posture-band-word';

export const findingCountLabel = ({ band, count }: FindingPill): string => (band === 'critical'
  ? plural(count, { one: '# critical', other: '# critical' })
  : plural(count, { one: '# high', other: '# high' }));

export const postureScoreLabel = (score: number): string => {
  const word = postureBandWord(postureBandForScore(score));
  return i18n._({
    id: 'OpenCRQ Posture score: {score} out of 100, {word}',
    message: 'OpenCRQ Posture score: {score} out of 100, {word}',
    values: { score, word },
  });
};

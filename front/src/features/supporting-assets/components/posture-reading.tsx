import { i18n } from '@lingui/core';
import { Trans } from '@lingui/react/macro';
import type { SeverityBand } from '@app/module/client';
import { SEVERITY_BANDS } from '@app/module/client';
import type { FunctionComponent } from 'react';
import { formatPosturePoints } from './crq-posture-utils';

interface PostureReadingProps {
  name: string,
  exploitability: number,
  countsByBand: Record<SeverityBand, number>,
  tailPoints: number,
}

export const PostureReading: FunctionComponent<PostureReadingProps> = ({ name, exploitability, countsByBand, tailPoints }) => {
  const at = i18n.locale || 'en';
  const total = SEVERITY_BANDS.reduce((sum, band) => sum + countsByBand[band], 0);
  if (exploitability >= 100) {
    return <Trans>Set by {name}, the worst of {total} applicable findings, which alone takes the whole posture.</Trans>;
  }
  if (total === 1) {
    return <Trans>Set by {name}, the only applicable finding.</Trans>;
  }
  const tail = formatPosturePoints(tailPoints, at);
  return <Trans>Set by {name}, the worst of {total} applicable findings. Their number takes {tail} more points.</Trans>;
};

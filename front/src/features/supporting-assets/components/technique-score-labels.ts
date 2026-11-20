import { t } from '@lingui/core/macro';
import { resolveSeverityBand } from '@app/module/client';
import { severityBandLabel } from '../../finding-score';

export const gaugeLabel = (name: string, figure: number): string => {
  const bandWord = severityBandLabel(resolveSeverityBand(figure));
  return t`${name}: ${figure} out of 100, ${bandWord} band`;
};

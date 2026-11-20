import { Trans } from '@lingui/react/macro';
import type { SeverityBand } from '@app/module/client';
import { FINDING_TREND_WINDOW_DAYS } from '@app/module/client';
import type { FunctionComponent } from 'react';
import type { BandCounts } from '../findings-panel-utils';
import { severityBandRange } from '../../finding-score/ui/severity-ramp';
import { formatNumber } from '../../../utils/format-number';
import { TrendMark } from './trend-pill';

interface BandTooltipProps {
  band: SeverityBand,
  counts: BandCounts,
  unit: 'finding' | 'uniqueFinding',
}

/**
 * How many of the findings or unique findings standing in the band today appeared inside the window.
 * A finding's banding a week ago is not kept, so for findings this is the only past the band card states.
 */
export const BandTooltip: FunctionComponent<BandTooltipProps> = ({ band, counts, unit }) => {
  const range = severityBandRange(band);
  const days = FINDING_TREND_WINDOW_DAYS;

  if (unit === 'uniqueFinding') {
    return <UniqueBandTooltip band={band} counts={counts} range={range} days={days} />;
  }

  if (counts.total === 0) {
    switch (band) {
      case 'critical':
        return <Trans>No finding currently sits in the critical band · score {range}</Trans>;
      case 'high':
        return <Trans>No finding currently sits in the high band · score {range}</Trans>;
      case 'medium':
        return <Trans>No finding currently sits in the medium band · score {range}</Trans>;
      case 'low':
        return <Trans>No finding currently sits in the low band · score {range}</Trans>;
    }
  }

  const total = formatNumber(counts.total);
  const mark = <TrendMark delta={counts.newInWindow} signed={false} />;
  switch (band) {
    case 'critical':
      return <Trans>{mark} of the {total} critical findings appeared over the last {days} days · score {range}</Trans>;
    case 'high':
      return <Trans>{mark} of the {total} high findings appeared over the last {days} days · score {range}</Trans>;
    case 'medium':
      return <Trans>{mark} of the {total} medium findings appeared over the last {days} days · score {range}</Trans>;
    case 'low':
      return <Trans>{mark} of the {total} low findings appeared over the last {days} days · score {range}</Trans>;
  }
};

const UniqueBandTooltip: FunctionComponent<{ band: SeverityBand, counts: BandCounts, range: string, days: number }> = ({ band, counts, range, days }) => {
  if (counts.total === 0) {
    switch (band) {
      case 'critical':
        return <Trans>No unique finding currently sits in the critical band · score {range}</Trans>;
      case 'high':
        return <Trans>No unique finding currently sits in the high band · score {range}</Trans>;
      case 'medium':
        return <Trans>No unique finding currently sits in the medium band · score {range}</Trans>;
      case 'low':
        return <Trans>No unique finding currently sits in the low band · score {range}</Trans>;
    }
  }

  const total = formatNumber(counts.total);
  const mark = <TrendMark delta={counts.newInWindow} signed={false} />;
  switch (band) {
    case 'critical':
      return <Trans>{mark} of the {total} critical unique findings appeared over the last {days} days · score {range}</Trans>;
    case 'high':
      return <Trans>{mark} of the {total} high unique findings appeared over the last {days} days · score {range}</Trans>;
    case 'medium':
      return <Trans>{mark} of the {total} medium unique findings appeared over the last {days} days · score {range}</Trans>;
    case 'low':
      return <Trans>{mark} of the {total} low unique findings appeared over the last {days} days · score {range}</Trans>;
  }
};

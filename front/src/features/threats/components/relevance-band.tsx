import { Chip } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import type { FunctionComponent, ReactElement } from 'react';
import type { RelevanceBandKind } from './relevance-proof-utils';
import { resolveRelevanceBand, toRelevancePercent } from './relevance-proof-utils';

interface RelevanceBandProps {
  relevance: number,
}

const BAND_SEVERITY: Record<RelevanceBandKind, 'critical' | 'high' | 'low'> = {
  strong: 'critical',
  moderate: 'high',
  weak: 'low',
};

const bandLabel = (band: RelevanceBandKind): string => {
  switch (band) {
    case 'strong':
      return t`Strong`;
    case 'moderate':
      return t`Moderate`;
    case 'weak':
      return t`Weak`;
  }
};

/** Relevance as an ordinal band only; the numeric percent is intentionally not printed. */
export const RelevanceBand: FunctionComponent<RelevanceBandProps> = ({ relevance }): ReactElement => {
  const percent = toRelevancePercent(relevance);
  const band = resolveRelevanceBand(percent);
  return (
    <span className="flex items-center gap-1.5">
      <Chip severity={BAND_SEVERITY[band]} label={bandLabel(band)} />
    </span>
  );
};

import { t } from '@lingui/core/macro';
import type { RevenueBand } from '@app/module/client';
import { EMPTY_VALUE } from './empty-value';

/**
 * Formats an organization revenue band into its display label.
 * Returns EMPTY_VALUE for null values.
 */
export const formatRevenueBand = (band: RevenueBand | null): string => {
  if (band === null) {
    return EMPTY_VALUE;
  }
  const labels: Record<RevenueBand, string> = {
    under_10m: t`< $10M`,
    '10m_100m': t`$10M-$100M`,
    '100m_1b': t`$100M-$1B`,
    '1b_10b': t`$1B-$10B`,
    '10b_100b': t`$10B-$100B`,
    over_100b: t`> $100B`,
  };
  return labels[band];
};

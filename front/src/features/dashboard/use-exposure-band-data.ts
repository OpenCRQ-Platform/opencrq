import { useQuery } from '@tanstack/react-query';
import type { BandMetric, BandWindowId, ExposureBandPoint } from './exposure-band-utils';
import { useTRPC } from '../../lib';
import { bandWindowDays, toExposureBandPoints } from './exposure-band-utils';

/**
 * The exposure timeline, over a window the caller chooses.
 *
 * `dashboard.getExposureBand` returns the series itself, one point per sampled day of an axis the
 * server builds from the window and the first run on file, so a longer history or more scenarios
 * never make it larger.
 */
export interface ExposureBandData {
  isLoading: boolean,
  points: Array<ExposureBandPoint>,
  /**
   * True when the history query failed. The curve would otherwise read as a portfolio that has
   * never been simulated, which is the one reading a blank timeline must not carry.
   */
  hasError: boolean,
}

export const useExposureBandData = (
  organizationId: string | undefined,
  windowId: BandWindowId,
  metric: BandMetric,
): ExposureBandData => {
  const trpc = useTRPC();
  const bandQuery = useQuery(trpc.dashboard.getExposureBand.queryOptions({ organizationId, windowDays: bandWindowDays(windowId) }));

  return {
    isLoading: bandQuery.isLoading,
    points: toExposureBandPoints(bandQuery.data ?? [], metric),
    hasError: bandQuery.isError,
  };
};

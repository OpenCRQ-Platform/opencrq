import type { FunctionComponent, ReactElement } from 'react';
import { plural, t } from '@lingui/core/macro';
import { useQuery } from '@tanstack/react-query';
import { countsByDayOf } from '../../../components/shared/activity-chart-utils';
import { EvidenceCountActivityChart } from '../../../components/shared/evidence-count-activity-chart';
import { useTRPC } from '../../../lib';
import { useReaderTimeZone } from '../../../hooks';

interface FindingsActivityChartProps {
  assetId: string,
}

export const FindingsActivityChart: FunctionComponent<FindingsActivityChartProps> = ({
  assetId,
}): ReactElement => {
  const trpc = useTRPC();
  const { timeZone, queryOptions, fallBackOn } = useReaderTimeZone();
  const { data, error } = useQuery(trpc.supportingAssets.getEvidenceActivityForAsset.queryOptions({ assetId, timeZone }, queryOptions));
  fallBackOn(error);
  return (
    <EvidenceCountActivityChart
      countsByDay={countsByDayOf(data)}
      getTooltip={(count) => count === 0
        ? t`no findings`
        : plural(count, { one: '# finding', other: '# findings' })}
      ariaLabel={t`Findings activity heatmap`}
    />
  );
};

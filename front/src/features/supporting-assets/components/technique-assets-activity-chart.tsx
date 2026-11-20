import type { FunctionComponent, ReactElement } from 'react';
import { plural, t } from '@lingui/core/macro';
import { useQuery } from '@tanstack/react-query';
import { countsByDayOf } from '../../../components/shared/activity-chart-utils';
import { EvidenceCountActivityChart } from '../../../components/shared/evidence-count-activity-chart';
import { useTRPC } from '../../../lib';
import { useReaderTimeZone } from '../../../hooks';

interface TechniqueAssetsActivityChartProps {
  mitreTechniqueId: string,
}

export const TechniqueAssetsActivityChart: FunctionComponent<TechniqueAssetsActivityChartProps> = ({
  mitreTechniqueId,
}): ReactElement => {
  const trpc = useTRPC();
  const { timeZone, queryOptions, fallBackOn } = useReaderTimeZone();
  const { data, error } = useQuery(trpc.supportingAssets.getEvidenceActivityForTechnique.queryOptions({ mitreTechniqueId, timeZone }, queryOptions));
  fallBackOn(error);
  return (
    <EvidenceCountActivityChart
      countsByDay={countsByDayOf(data)}
      getTooltip={(count) => count === 0
        ? t`no impacted assets`
        : plural(count, { one: '# asset', other: '# assets' })}
      ariaLabel={t`Impacted assets activity heatmap`}
    />
  );
};

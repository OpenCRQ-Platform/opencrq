import { TooltipProvider } from '@filigran/design-system';
import { Skeleton } from '@filigran/ui';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent, ReactNode } from 'react';
import type { PlanKpiRow } from '../treatment-plan-utils';
import { KpiCard } from '../../../components/shared/kpi-card';
import { formatDollar } from '../../../utils/format-currency';
import { planKpis } from '../treatment-plan-utils';

const KPI_COUNT = 4;

const TOOLTIP_DELAY_MS = 150;

const BandGrid: FunctionComponent<{ children: ReactNode }> = ({ children }) => (
  // `md:grid-cols-2` is shipped unlayered by `fds.css`, hence the arbitrary form.
  <div className="grid grid-cols-1 gap-3 md:grid-cols-[repeat(2,minmax(0,1fr))] xl:grid-cols-4">{children}</div>
);

interface TreatmentPlansKpiBandProps {
  /** The rows the list shows, so the band and the list never disagree. Undefined while loading. */
  plans: Array<PlanKpiRow> | undefined,
}

/** No trend: a plan keeps no history, so no previous value exists to compare against. */
export const TreatmentPlansKpiBand: FunctionComponent<TreatmentPlansKpiBandProps> = ({ plans }) => {
  if (plans === undefined) {
    return (
      <BandGrid>
        {Array.from({ length: KPI_COUNT }).map((_, index) => (
          <Skeleton key={index} className="h-[138px] w-full rounded-sm" />
        ))}
      </BandGrid>
    );
  }

  const kpis = planKpis(plans);
  const totalCost = formatDollar(kpis.totalCostYear1);

  return (
    <TooltipProvider delayDuration={TOOLTIP_DELAY_MS}>
      <BandGrid>
        <KpiCard
          label={t`Active plans`}
          icon="activity"
          tone="info"
          figure={kpis.activeCount}
          subtitle={plural(kpis.planCount, { one: 'out of # plan', other: 'out of # plans' })}
          tooltip={null}
        />
        <KpiCard
          label={t`Overdue`}
          icon="alarm-clock"
          tone="error"
          figure={kpis.overdueActiveCount}
          subtitle={plural(kpis.activeCount, { one: 'out of # active plan', other: 'out of # active plans' })}
          tooltip={null}
        />
        <KpiCard
          label={t`Negative return`}
          icon="thumbs-down"
          tone="warning"
          figure={kpis.negativeReturnCount}
          subtitle={plural(kpis.returnCount, { one: 'out of # plan with a return', other: 'out of # plans with a return' })}
          tooltip={<Trans>A plan whose first-year cost exceeds the annual loss it removes.</Trans>}
        />
        <KpiCard
          label={t`First-year cost`}
          icon="landmark"
          tone="neutral"
          figure={formatDollar(kpis.activeCostYear1)}
          subtitle={<Trans>active plans, out of {totalCost} in total</Trans>}
          tooltip={(
            <Trans>
              The one-off cost plus a year of recurring cost, summed over the active plans. ALE reductions are not
              summed: two plans moving the same control would both claim its reduction.
            </Trans>
          )}
        />
      </BandGrid>
    </TooltipProvider>
  );
};

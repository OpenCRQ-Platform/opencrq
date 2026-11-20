import { TooltipProvider } from '@filigran/design-system';
import { Skeleton } from '@filigran/ui';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent, ReactNode } from 'react';
import type { ReviewKpiRow, ToleranceScopeCount } from '../budget-review-kpi-utils';
import { KpiCard } from '../../../components/shared/kpi-card';
import { EmptyValue } from '../../../components/ui/empty-value';
import { formatDollar } from '../../../utils/format-currency';
import { formatReturnPercent } from '../../treatment-plans/treatment-plan-utils';
import { AleReduction } from '../../treatment-plans/ui/ale-reduction';
import { PlanReturn } from '../../treatment-plans/ui/plan-return';
import { latestTwoReviews, lossAvoidedTrendPercent, tenantReviewKpis, toleranceCount } from '../budget-review-kpi-utils';
import { prudentReturnPercent } from '../budget-review-utils';
import { FigureStateChip } from '../ui/review-chips';
import { ReviewTrendChip } from '../ui/review-trend-chip';
import { bandCaveat } from '../ui/figure-info';

const KPI_COUNT = 4;

const TOOLTIP_DELAY_MS = 150;

const BandGrid: FunctionComponent<{ children: ReactNode }> = ({ children }) => (
  // `md:grid-cols-2` is shipped unlayered by `fds.css`, hence the arbitrary form.
  <div className="grid grid-cols-1 gap-3 md:grid-cols-[repeat(2,minmax(0,1fr))] xl:grid-cols-4">{children}</div>
);

const CardSkeleton: FunctionComponent = () => <Skeleton className="h-[138px] w-full rounded-sm" />;

const toleranceTooltip = (): ReactNode => (
  <Trans>
    The tolerance applies to each scenario on its own, never to the sum of the scenarios, and is read on each
    scenario's latest simulation.
  </Trans>
);

interface OutsideToleranceCardProps {
  /** Undefined while they load, null when they could not be read. */
  toleranceCounts: Array<ToleranceScopeCount> | null | undefined,
  tenantWide: boolean,
}

const OutsideToleranceCard: FunctionComponent<OutsideToleranceCardProps> = ({ toleranceCounts, tenantWide }) => {
  if (toleranceCounts === undefined) {
    return <CardSkeleton />;
  }
  const count = toleranceCounts === null ? null : toleranceCount(toleranceCounts);
  const assessed = count?.assessed ?? 0;
  const outsideScopes = count?.outsideScopes ?? 0;
  let subtitle: ReactNode = null;
  if (count !== null) {
    if (assessed === 0) {
      subtitle = tenantWide ? <Trans>No risk tolerance is set on any scope.</Trans> : <Trans>No risk tolerance is set on this scope.</Trans>;
    } else if (tenantWide) {
      subtitle = t`out of ${plural(assessed, { one: '# scenario', other: '# scenarios' })}, in ${plural(outsideScopes, { one: '# scope', other: '# scopes' })}`;
    } else {
      subtitle = plural(assessed, { one: 'out of # scenario', other: 'out of # scenarios' });
    }
  }
  return (
    <KpiCard
      label={t`Outside tolerance`}
      icon="shield"
      tone="warning"
      figure={count === null || assessed === 0 ? <EmptyValue /> : count.outside}
      subtitle={subtitle}
      tooltip={toleranceTooltip()}
    />
  );
};

const spentSubtitle = (buildSpent: number): ReactNode => {
  const build = formatDollar(buildSpent);
  return <Trans>including {build} of build work</Trans>;
};

const lossAvoidedSubtitle = (review: ReviewKpiRow): ReactNode => {
  const { name, aleReductionP10: p10, aleReductionP90: p90 } = review;
  if (p10 === null || p90 === null) {
    return name;
  }
  const low = formatDollar(p10);
  const high = formatDollar(p90);
  return t`${name}, ${low} to ${high}`;
};

const ScopeCards: FunctionComponent<{ reviews: Array<ReviewKpiRow>, toleranceCounts: OutsideToleranceCardProps['toleranceCounts'] }> = ({ reviews, toleranceCounts }) => {
  const { latest, previous } = latestTwoReviews(reviews);
  if (latest === null) {
    return null;
  }
  const trendPercent = lossAvoidedTrendPercent(latest, previous);
  const prudent = prudentReturnPercent(latest.build);
  const prudentLabel = prudent === null ? null : formatReturnPercent(prudent);
  return (
    <>
      <OutsideToleranceCard toleranceCounts={toleranceCounts} tenantWide={false} />
      <KpiCard
        label={t`Loss avoided per year`}
        icon="shield-check"
        tone="success"
        figure={<AleReduction value={latest.aleReductionMean} expired={latest.state === 'expired'} />}
        trend={trendPercent === null || previous === null
          ? <FigureStateChip state={latest.state} />
          : <ReviewTrendChip percent={trendPercent} previousName={previous.name} />}
        subtitle={lossAvoidedSubtitle(latest)}
        tooltip={(
          <>
            <Trans>
              The annual loss the latest review's controls remove, priced as one basket: the overall figure of the
              review, not the sum of its lines.
            </Trans>
            {' '}
            {bandCaveat()}
          </>
        )}
      />
      <KpiCard
        label={t`Build return`}
        icon="wrench"
        tone="info"
        figure={<PlanReturn value={latest.build.returnPercent} expired={latest.build.state === 'expired'} />}
        trend={<FigureStateChip state={latest.build.state} />}
        subtitle={prudentLabel === null ? null : t`Prudent (p10): ${prudentLabel}`}
        tooltip={(
          <Trans>
            The return of the build work alone, not of the whole review: the run spending is left out, as its return is
            measured against removing every existing control.
          </Trans>
        )}
      />
      <KpiCard
        label={t`Spent`}
        icon="landmark"
        tone="neutral"
        figure={formatDollar(latest.spent)}
        subtitle={spentSubtitle(latest.build.spent)}
        tooltip={null}
      />
    </>
  );
};

const TenantCards: FunctionComponent<{ reviews: Array<ReviewKpiRow>, toleranceCounts: OutsideToleranceCardProps['toleranceCounts'] }> = ({ reviews, toleranceCounts }) => {
  const kpis = tenantReviewKpis(reviews);
  return (
    <>
      <OutsideToleranceCard toleranceCounts={toleranceCounts} tenantWide />
      <KpiCard
        label={t`Loss avoided per year`}
        icon="shield-check"
        tone="success"
        figure={<AleReduction value={kpis.lossAvoided} />}
        subtitle={kpis.lossAvoidedScopeCount === 0
          ? <Trans>No latest review is priced yet.</Trans>
          : plural(kpis.lossAvoidedScopeCount, { one: 'latest review of # scope', other: 'latest reviews of # scopes' })}
        tooltip={(
          <Trans>
            The sum, over the risk scopes, of the annual loss their latest review avoided, each priced as one basket.
            No p10 to p90 band is given: the bands of several scopes do not add up.
          </Trans>
        )}
      />
      <KpiCard
        label={t`Build return`}
        icon="wrench"
        tone="info"
        figure={<PlanReturn value={kpis.buildReturnPercent} />}
        subtitle={kpis.buildReturnPercent === null
          ? null
          : plural(kpis.scopesBelowZero, { one: '# scope below 0%', other: '# scopes below 0%' })}
        tooltip={(
          <Trans>
            The return of the build work alone, across scopes: the loss it avoided minus what it cost, divided by what it
            cost. Both are summed over the latest review of each scope that priced and paid for its build work, then
            divided. The run spending is left out: its return is measured against removing every existing control.
          </Trans>
        )}
      />
      <KpiCard
        label={t`Spent`}
        icon="landmark"
        tone="neutral"
        figure={formatDollar(kpis.spent)}
        subtitle={spentSubtitle(kpis.buildSpent)}
        tooltip={null}
      />
    </>
  );
};

interface BudgetReviewsKpiBandProps {
  /** The rows the list shows, so the band and the list never disagree. Undefined while loading. */
  reviews: Array<ReviewKpiRow> | undefined,
  /** The tolerance counts of the same scope or scopes as the reviews. */
  toleranceCounts: Array<ToleranceScopeCount> | null | undefined,
  /** One band over the reviews of every scope, instead of the one scope's. */
  tenantWide: boolean,
}

export const BudgetReviewsKpiBand: FunctionComponent<BudgetReviewsKpiBandProps> = ({ reviews, toleranceCounts, tenantWide }) => {
  if (reviews === undefined) {
    return (
      <BandGrid>
        {Array.from({ length: KPI_COUNT }).map((_, index) => <CardSkeleton key={index} />)}
      </BandGrid>
    );
  }

  return (
    <TooltipProvider delayDuration={TOOLTIP_DELAY_MS}>
      <BandGrid>
        {tenantWide
          ? <TenantCards reviews={reviews} toleranceCounts={toleranceCounts} />
          : <ScopeCards reviews={reviews} toleranceCounts={toleranceCounts} />}
      </BandGrid>
    </TooltipProvider>
  );
};

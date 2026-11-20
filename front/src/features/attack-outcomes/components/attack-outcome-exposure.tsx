import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import { Skeleton } from '@filigran/ui';
import type { FunctionComponent } from 'react';
import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MetricInfo, SectionCard } from '../../../components/shared';
import { categoricalChartColor } from '../../../components/shared/chart-utils';
import { ChartSwatch } from '../../../components/ui/chart-segment';
import { PieChart } from '../../../components/ui/pie-chart';
import { formatDollar } from '../../../utils/format-currency';
import { formatFractionAsPercent } from '../../../utils/format-number';
import { useTRPC } from '../../../lib';
import { useTheme } from '../../../providers';
import { computeLossDriverShares } from '../attack-outcome-utils';

interface AttackOutcomeExposureProps {
  attackOutcomeId: string,
}

/**
 * "What this outcome costs" and "which kinds of loss carry that cost": two different grandeurs in
 * one card, one an annual sum of simulated means, the other a per-occurrence estimate teams typed
 * by hand. Neither is drawn against the other, and each carries its own total.
 */
export const AttackOutcomeExposure: FunctionComponent<AttackOutcomeExposureProps> = ({ attackOutcomeId }) => {
  const trpc = useTRPC();
  const legendId = useId();
  const { effectiveTheme } = useTheme();
  const { data: summary, isLoading: isSummaryLoading, isError: isSummaryError } = useQuery(trpc.crqIndicators.getCrqSummaryForOutcome.queryOptions({ attackOutcomeId }));
  const { data: split, isLoading: isSplitLoading, isError: isSplitError } = useQuery(trpc.scenarioLossEstimates.getLossDriverSplitForOutcome.queryOptions({ attackOutcomeId }));

  if (isSummaryLoading || isSplitLoading) {
    return (
      <SectionCard title={t`Exposure`}>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-24 w-full" />
        </div>
      </SectionCard>
    );
  }

  // A failed read is not an absence: the empty state below asserts that nothing names this outcome,
  // which the page does not know once a query has failed.
  if (isSummaryError || isSplitError || !summary || !split) {
    return (
      <SectionCard title={t`Exposure`}>
        <p className="txt-sub-content text-muted-foreground">
          <Trans>Exposure could not be loaded.</Trans>
        </p>
      </SectionCard>
    );
  }

  const { rows, totalAleMean, pricedCount, totalCount } = summary.ledger;
  const shares = computeLossDriverShares(split.drivers);
  const splitTotal = split.total;
  const formattedSplitTotal = formatDollar(splitTotal);

  if (rows.length === 0 && shares.length === 0) {
    return (
      <SectionCard title={t`Exposure`}>
        <p className="txt-sub-content text-muted-foreground">
          <Trans>No risk scenario names this outcome yet.</Trans>
        </p>
      </SectionCard>
    );
  }

  return (
    <SectionCard title={t`Exposure`}>
      <div>
        <div className="flex items-center gap-1.5">
          <p className="txt-title font-medium tabular-nums">
            {totalAleMean === null
              ? <span className="text-muted-foreground italic">{t`Not priced`}</span>
              : formatDollar(totalAleMean)}
          </p>
          <MetricInfo
            title={t`Annual Loss Exposure`}
            what={<Trans>The yearly cost this outcome is expected to carry, summed across every risk scenario naming it.</Trans>}
            how={<Trans>Each named risk scenario is simulated on its own, and its ALE mean is added to the total.</Trans>}
          />
        </div>
        <p className="txt-sub-content text-muted-foreground">
          <Trans>{pricedCount} of {totalCount} priced.</Trans>
        </p>
        <p className="txt-sub-content text-muted-foreground">
          <Trans>
            Scenarios are priced one at a time, so this total is their sum, not the cost of them landing together
            — that would be more than any single scenario and less than the sum.
          </Trans>
        </p>
      </div>

      {rows.length > 0 && (
        <div>
          <table className="w-full">
            <thead>
              <tr>
                <th scope="col" className="txt-sub-content text-muted-foreground text-left font-normal">
                  <Trans>Risk scenario</Trans>
                </th>
                <th scope="col" className="txt-sub-content text-muted-foreground text-right font-normal">
                  <Trans>ALE mean</Trans>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.scenarioId}>
                  <td className="py-2">
                    <Link
                      from="/$tenantId/{-$organizationId}/settings/taxonomies/attack-outcomes/$attackOutcomeId"
                      to="/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId"
                      params={{ riskScenarioId: row.scenarioId }}
                      className="txt-default text-primary hover:underline"
                    >
                      {row.scenarioName}
                    </Link>
                    <span className="block txt-sub-content text-muted-foreground">{row.organizationName}</span>
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {row.aleMean === null
                      ? <span className="txt-default text-muted-foreground italic">{t`Not simulated`}</span>
                      : formatDollar(row.aleMean)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <p className="txt-sub-content text-muted-foreground">{t`Loss drivers`}</p>
            <MetricInfo
              title={t`Loss drivers`}
              what={<Trans>What a single occurrence of this outcome is estimated to cost, split by the kind of loss that drives it.</Trans>}
              how={<Trans>Recorded by hand on each risk scenario as a minimum, a most likely and a maximum, then summed here.</Trans>}
            />
          </div>
          {shares.length > 0 && (
            <p className="txt-default font-medium tabular-nums">{formattedSplitTotal}</p>
          )}
        </div>
        {shares.length === 0
          ? (
            <p className="txt-sub-content text-muted-foreground mt-1">
              <Trans>No loss estimate has been recorded on the scenarios naming this outcome.</Trans>
            </p>
          )
          : (
            <p className="txt-sub-content text-muted-foreground mt-1">
              <Trans>A different grandeur from the annual exposure above: it is drawn against its own total and never compared against it.</Trans>
            </p>
          )}
        {shares.length > 0 && (
          <div className="grid grid-cols-[9rem_1fr] gap-6 items-center mt-2">
            <PieChart
              ariaDescribedBy={legendId}
              ariaLabel={t`Loss driver split`}
              segments={shares.map((row, index) => ({
                key: row.driverId,
                value: row.amount,
                color: categoricalChartColor(effectiveTheme, index, shares.length),
              }))}
              size="size-36"
              total={splitTotal}
            />
            <ul id={legendId} className="flex flex-col gap-1">
              {shares.map((row, index) => (
                <li key={row.driverId} className="flex items-center gap-2 txt-table">
                  <ChartSwatch color={categoricalChartColor(effectiveTheme, index, shares.length)} />
                  <span className="flex-1">{row.driver}</span>
                  <span className="tabular-nums">{formatDollar(row.amount)}</span>
                  <span className="tabular-nums text-muted-foreground w-12 text-right">{formatFractionAsPercent(row.share, 0)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </SectionCard>
  );
};

import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Skeleton } from '@filigran/ui';
import { Link, useParams } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { FindingsFlowWindow } from '../findings-dashboard-utils';
import type { RemediationPacePayload } from '../remediation-pace-utils';
import { Lifeline } from '../../../components/shared';
import { useTRPC } from '../../../lib';
import { cn, formatFractionAsPercent, formatNumber } from '../../../utils';
import { EMPTY_VALUE } from '../../../utils/empty-value';
import { FlowWindowSelect } from '../components/flow-window-select';
import {
  BandName,
  FallingBehindAlert,
  formatDays,
  formatOccupancy,
  formatRate,
  NotEnoughHistory,
  OCCUPANCY_TONE_CLASS,
  OccupancyMeter,
  PaceVerdictLabel,
  RemediationPaceInfo,
} from '../components/remediation-pace-parts';
import { Caption, Figure, Panel } from '../components/slick-primitives';
import { TrendChangeChip } from '../components/trend-change-chip';
import { severityBandLabel } from '../../finding-score/ui/severity-ramp';
import { DEFAULT_FINDINGS_FLOW_WINDOW } from '../findings-dashboard-utils';
import { occupancyLevel, occupancySparkline, openChangeOverWindow } from '../remediation-pace-utils';

// eslint-disable-next-line lingui/no-unlocalized-strings -- Tailwind classes, not copy
const BAND_ROW_GRID = 'grid grid-cols-[6.5rem_minmax(0,1fr)_6rem_4rem_6rem] items-center gap-4';
const SPARKLINE_DOMAIN = { min: 0, max: 1 };

const signedPercent = (change: number): string => formatFractionAsPercent(Math.abs(change), 0);

interface RemediationPaceWidgetProps {
  organizationId?: string,
}

export const RemediationPaceWidget: FunctionComponent<RemediationPaceWidgetProps> = ({ organizationId }) => {
  const trpc = useTRPC();
  const [windowDays, setWindowDays] = useState<FindingsFlowWindow>(DEFAULT_FINDINGS_FLOW_WINDOW);
  const { data } = useQuery(trpc.dashboard.getRemediationPace.queryOptions({ organizationId, windowDays }));
  const { organizationId: pathOrganizationId } = useParams({ strict: false });

  return (
    <Panel
      title={<Trans>Remediation pace</Trans>}
      info={<RemediationPaceInfo />}
      action={<FlowWindowSelect value={windowDays} onChange={setWindowDays} disabled={data?.measurable === false} />}
    >
      {data === undefined ? (
        <Skeleton className="h-[460px] w-full" />
      ) : !data.measurable ? (
        <NotEnoughHistory measurableFrom={data.measurableFrom} />
      ) : (
        <PaceBody
          pace={data}
          detailsSearch={{ riskScope: pathOrganizationId === undefined && organizationId !== undefined ? organizationId : 'all', window: windowDays }}
        />
      )}
    </Panel>
  );
};

const PaceBody: FunctionComponent<{ pace: RemediationPacePayload, detailsSearch: { riskScope: string, window: FindingsFlowWindow } }> = ({ pace, detailsSearch }) => {
  const { total, bands } = pace;
  const level = occupancyLevel(total);
  const openChange = openChangeOverWindow(total);

  const secondaryFigures = [
    { key: 'new', caption: t`New / month`, value: formatRate(total.newPerMonth) },
    { key: 'capacity', caption: t`Capacity / month`, value: formatRate(total.capacityPerMonth) },
  ];

  return (
    <div className="flex h-full flex-col gap-4">
      <FallingBehindAlert bands={bands} />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap gap-x-8 gap-y-2">
          <div className="flex flex-col gap-0.5">
            <Caption>{t`Occupancy`}</Caption>
            <Figure className={cn('txt-title', level === 'within' ? undefined : OCCUPANCY_TONE_CLASS[level])}>
              {formatOccupancy(total)}
            </Figure>
          </div>
          {secondaryFigures.map((figure) => (
            <div key={figure.key} className="flex flex-col gap-0.5">
              <Caption>{figure.caption}</Caption>
              <Figure className="txt-body2 text-muted-foreground pt-2.5">{figure.value}</Figure>
            </div>
          ))}
          <div className="flex flex-col gap-0.5">
            <Caption>{t`Open findings`}</Caption>
            <span className="inline-flex items-center gap-2 pt-1.5">
              <Figure className="txt-body2 text-muted-foreground">{formatNumber(total.openCount)}</Figure>
              {openChange !== null && openChange !== 0 && (
                <TrendChangeChip
                  reading={{ change: openChange, direction: openChange > 0 ? 'up' : 'down' }}
                  formatChange={signedPercent}
                  title={t`Change over the window`}
                />
              )}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <Caption>{t`Median time open`}</Caption>
            <Figure className="txt-body2 text-muted-foreground pt-2.5">{formatDays(total.medianDaysOpen)}</Figure>
          </div>
        </div>

        <PaceVerdictLabel figures={total} windowDays={pace.windowDays} className="txt-sub-content shrink-0" />
      </div>

      <div className="overflow-x-auto">
        <div className="flex min-w-[30rem] flex-col" role="table" aria-label={t`Remediation pace by severity`}>
          <div role="row" className={cn(BAND_ROW_GRID, 'border-b pb-2')}>
            <span role="columnheader"><Caption>{t`Severity`}</Caption></span>
            <span role="columnheader"><Caption>{t`Occupancy`}</Caption></span>
            <span role="columnheader"><Caption>{t`6 months`}</Caption></span>
            <span role="columnheader"><Caption className="text-right">{t({ message: 'Open', context: 'findings still open, column header' })}</Caption></span>
            <span role="columnheader"><Caption className="text-right">{t`Median`}</Caption></span>
          </div>
          {bands.map((band) => {
            const bandLevel = occupancyLevel(band);
            const sparkline = occupancySparkline(band.occupancyHistory);
            const label = severityBandLabel(band.band);
            return (
              <div key={band.band} role="row" className={cn(BAND_ROW_GRID, 'txt-table border-b py-2.5')}>
                <span role="cell"><BandName band={band.band} /></span>
                <span role="cell"><OccupancyMeter figures={band} /></span>
                <span role="cell">
                  {sparkline.every((value) => value === null) ? (
                    <span className="text-muted-foreground">{EMPTY_VALUE}</span>
                  ) : (
                    <Lifeline
                      values={sparkline}
                      rise="bad"
                      domain={SPARKLINE_DOMAIN}
                      filled={false}
                      toneClassName={OCCUPANCY_TONE_CLASS[bandLevel]}
                      className="h-6"
                      ariaLabel={i18n._({ id: '{label} occupancy over the last 6 months', message: '{label} occupancy over the last 6 months', values: { label } })}
                    />
                  )}
                </span>
                <span role="cell" className="text-right font-medium tabular-nums">{formatNumber(band.openCount)}</span>
                <span role="cell" className="text-muted-foreground text-right font-medium tabular-nums">{formatDays(band.medianDaysOpen)}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-auto flex justify-end">
        <Link
          to="/$tenantId/{-$organizationId}/dashboards/$dashboardId"
          params={(prev) => ({ tenantId: prev.tenantId ?? '', organizationId: prev.organizationId, dashboardId: 'remediation-pace' })}
          search={detailsSearch}
          className="txt-sub-content text-primary font-medium hover:underline"
        >
          <Trans>View details</Trans>
        </Link>
      </div>
    </div>
  );
};

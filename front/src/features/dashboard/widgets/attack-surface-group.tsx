import { Skeleton } from '@filigran/ui';
import { AGED_FINDING_DAYS } from '@app/module/client';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import type { inferRouterOutputs } from '@trpc/server';
import type { FunctionComponent } from 'react';
import { DashboardGroup, KpiCard, MetricInfo } from '../../../components/shared';
import { useTRPC } from '../../../lib';
import { formatPanelCount } from '../../findings-home/findings-panel-utils';
import { DashboardWidgetCard } from '../components/dashboard-widget-card';
import { AssetMixCard } from './asset-mix-card';

/* eslint-disable lingui/no-unlocalized-strings -- Tailwind class lists, not copy */
/** `fds.css` ships `md:grid-cols-2` unlayered, which would beat our `xl:` rule. */
const TILE_GRID = 'grid grid-cols-1 gap-3 md:grid-cols-[repeat(2,minmax(0,1fr))]';
const FINDING_GRID = `${TILE_GRID} xl:grid-cols-[repeat(5,minmax(0,1fr))]`;
/* eslint-enable lingui/no-unlocalized-strings */

const TileSkeletons: FunctionComponent<{ count: number, className: string }> = ({ count, className }) => (
  <div className={className}>
    {Array.from({ length: count }).map((_, index) => <Skeleton key={index} className="h-[118px] w-full rounded-sm" />)}
  </div>
);

type OpenFindingFigures = inferRouterOutputs<TRPCRouter>['findingScore']['getOpenFindingFigures'];

const FindingsCard: FunctionComponent<{ figures: OpenFindingFigures | undefined }> = ({ figures }) => {
  const days = AGED_FINDING_DAYS;
  const locale = i18n.locale || 'en';
  return (
    <DashboardWidgetCard
      title={t`Findings`}
      info={(
        <MetricInfo
          title={t`Findings`}
          what={<Trans>The open findings of the scope, and how many of them are critical, exposed, exploited or old.</Trans>}
          how={(
            <Trans>
              Critical counts the findings in the critical score band, as the findings list does. Internet exposed counts
              those on an internet-facing asset, actively exploited those listed as known exploited, and the last figure
              those first seen more than {days} days ago.
            </Trans>
          )}
          caveat={<Trans>No figure shows a change: neither the known exploited flag nor an asset's exposure keeps a history.</Trans>}
        />
      )}
    >
      {figures === undefined
        ? <TileSkeletons count={5} className={FINDING_GRID} />
        : (
          <div className={FINDING_GRID}>
            <KpiCard elevation={3} label={t`Open findings`} icon="list" tone="info" figure={formatPanelCount(figures.open, locale)} subtitle={null} tooltip={null} />
            <KpiCard elevation={3} label={t`Critical`} icon="circle-alert" tone="error" figure={formatPanelCount(figures.critical, locale)} subtitle={null} tooltip={null} />
            <KpiCard elevation={3} label={t`Internet exposed`} icon="earth" tone="warning" figure={formatPanelCount(figures.internetExposed, locale)} subtitle={null} tooltip={null} />
            <KpiCard elevation={3} label={t`Actively exploited`} icon="bug" tone="error" figure={formatPanelCount(figures.knownExploited, locale)} subtitle={null} tooltip={null} />
            <KpiCard
              elevation={3}
              label={i18n._({ id: 'Open for more than {days} days', message: 'Open for more than {days} days', values: { days } })}
              icon="clock"
              tone="neutral"
              figure={formatPanelCount(figures.aged, locale)}
              subtitle={null}
              tooltip={null}
            />
          </div>
        )}
    </DashboardWidgetCard>
  );
};

interface AttackSurfaceGroupProps {
  organizationId?: string,
}

export const AttackSurfaceGroup: FunctionComponent<AttackSurfaceGroupProps> = ({ organizationId }) => {
  const trpc = useTRPC();
  const { data: figures } = useQuery(trpc.findingScore.getOpenFindingFigures.queryOptions({ organizationId: organizationId ?? null }));
  return (
    <DashboardGroup icon="radar" title={t`Attack surface`}>
      <AssetMixCard organizationId={organizationId} />
      <FindingsCard figures={figures} />
    </DashboardGroup>
  );
};

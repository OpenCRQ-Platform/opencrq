import { Button, Card, CardHeader, CardTitle, Tabs, TabsList, TabsTrigger } from '@filigran/design-system';
import { DataTable, Skeleton } from '@filigran/ui';
import type { ColumnDefWithOptionsHeader } from '@filigran/ui';
import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import { OUTCOME_WEIGHT_THRESHOLD } from '@app/module/client';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { inferRouterOutputs } from '@trpc/server';
import type { FunctionComponent, ReactElement, ReactNode } from 'react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { GainReading, TacticGains, TechniqueGain } from '../technique-gains-utils';
import { DashboardGroup, KpiCard, MetricInfo } from '../../../components/shared';
import { TooltipHint, TooltipHintProvider } from '../../../components/shared/tooltip-hint';
import { getDataTableI18nKey } from '../../../components/ui/data-table-i18n';
import { useTRPC } from '../../../lib';
import { cn, formatDollar, formatFractionAsPercent } from '../../../utils';
import { formatPanelCount } from '../../findings-home/findings-panel-utils';
import { ActivityGradeBadge, ThreatTypeBadge } from '../../threats';
import { HiddenThreatsHint } from '../../threats/components/hidden-threats-notice';
import { DashboardWidgetCard } from '../components/dashboard-widget-card';
import {
  countGainingTechniques,
  DEFAULT_GAIN_READING,
  exceedsTechniqueCap,
  FAINTEST_SHADE,
  formatGain,
  GAIN_READINGS,
  gainShade,
  largestGain,
  shadeColor,
  sortTechniques,
  STRONG_SHADE,
  STRONGEST_SHADE,
  TECHNIQUES_PER_TACTIC,
} from '../technique-gains-utils';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;
type ScopeThreat = RouterOutputs['dashboard']['getMostActiveThreats'][number];

const tableClassName = 'scrollbar-discreet overflow-auto [&_.twp]:mt-0 [&_th]:pl-2 [&_td]:px-2';

/* eslint-disable-next-line lingui/no-unlocalized-strings -- Tailwind class list, not copy */
const VOLUME_GRID = 'grid grid-cols-1 gap-3 md:grid-cols-[repeat(2,minmax(0,1fr))] xl:grid-cols-[repeat(5,minmax(0,1fr))]';

const ThreatCatalogCard: FunctionComponent = () => {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.threats.getCatalogVolumes.queryOptions());
  const locale = i18n.locale || 'en';
  return (
    <DashboardWidgetCard
      title={t`Threat catalog`}
      info={(
        <MetricInfo
          title={t`Threat catalog`}
          what={<Trans>What the integrations have synced: the threats by type, how many of them are active, and the CVEs they are reported to target.</Trans>}
          how={<Trans>A CVE several threats target counts once. A threat is active as on the Threats page, from how recently it was observed or reported.</Trans>}
          caveat={<Trans>The whole tenant's catalog, whichever scope is selected: a threat is matched against a scope, it does not belong to one.</Trans>}
        />
      )}
    >
      {data === undefined
        ? (
          <div className={VOLUME_GRID}>
            {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-[118px] w-full rounded-sm" />)}
          </div>
        )
        : (
          <div className={VOLUME_GRID}>
            <KpiCard elevation={3} label={t`Threat actors`} icon="custom/threat-actor-individual" tone="info" hint={<HiddenThreatsHint />} figure={formatPanelCount(data.threatActors, locale)} subtitle={null} tooltip={null} />
            <KpiCard elevation={3} label={t`Intrusion sets`} icon="custom/intrusion-set" tone="info" hint={<HiddenThreatsHint />} figure={formatPanelCount(data.intrusionSets, locale)} subtitle={null} tooltip={null} />
            <KpiCard elevation={3} label={t`Campaigns`} icon="chess-knight" tone="info" hint={<HiddenThreatsHint />} figure={formatPanelCount(data.campaigns, locale)} subtitle={null} tooltip={null} />
            <KpiCard elevation={3} label={t`Active threats`} icon="activity" tone="info" hint={<HiddenThreatsHint />} figure={formatPanelCount(data.active, locale)} subtitle={null} tooltip={null} />
            <KpiCard elevation={3} label={t`Targeted CVEs`} icon="bug" tone="info" hint={<HiddenThreatsHint />} figure={formatPanelCount(data.citedCves, locale)} subtitle={null} tooltip={null} />
          </div>
        )}
    </DashboardWidgetCard>
  );
};

const MostActiveThreatsTable: FunctionComponent<{ organizationId?: string }> = ({ organizationId }) => {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.dashboard.getMostActiveThreats.queryOptions({ organizationId }));
  const thresholdLabel = formatFractionAsPercent(OUTCOME_WEIGHT_THRESHOLD, 0);

  const columns: Array<ColumnDefWithOptionsHeader<ScopeThreat & { rank: number }, unknown>> = [
    {
      id: 'rank',
      header: '#',
      size: 48,
      enableSorting: false,
      cell: ({ row }): ReactElement => <span className="tabular-nums text-default-secondary">{row.original.rank}</span>,
    },
    {
      id: 'name',
      header: t`Threat`,
      size: 320,
      enableSorting: false,
      cell: ({ row }): ReactElement => (
        <Link
          to="/$tenantId/{-$organizationId}/threat-center/threats/$threatId"
          params={(prev) => ({ ...prev, tenantId: prev.tenantId ?? '', threatId: row.original.id })}
          className="block truncate font-medium hover:underline"
        >
          {row.original.name}
        </Link>
      ),
    },
    {
      id: 'type',
      header: t`Type`,
      size: 160,
      enableSorting: false,
      cell: ({ row }): ReactElement => <ThreatTypeBadge entityType={row.original.entityType} />,
    },
    {
      id: 'activity',
      header: t`Activity`,
      size: 130,
      enableSorting: false,
      cell: ({ row }): ReactElement => <ActivityGradeBadge lastObservedAt={row.original.lastObservedAt} />,
    },
    {
      id: 'scenarios',
      header: t`Scenarios`,
      size: 100,
      enableSorting: false,
      cell: ({ row }): ReactElement => <span className="tabular-nums">{row.original.scenarioCount}</span>,
    },
  ];

  return (
    <Card elevation={2} gap={8}>
      <CardHeader
        action={(
          <span className="flex min-h-6 items-center">
            <Link
              to="/$tenantId/{-$organizationId}/threat-center"
              params={(prev) => ({ ...prev, tenantId: prev.tenantId ?? '' })}
              className="font-content-compact text-content-compact text-filigran-brand-primary hover:underline"
            >
              {t`See all threats`}
            </Link>
          </span>
        )}
      >
        <CardTitle
          as="h3"
          endAdornment={(
            <>
              <MetricInfo
                title={t`Most active threats`}
                what={<Trans>The most active threats relevant to at least one of the scope's risk scenarios.</Trans>}
                how={(
                  <Trans>
                    A threat is relevant to a scenario as on the scenario's overview: OpenCRQ's internal model gives
                    it a probability above {thresholdLabel} of leading to the scenario's attack outcome. It counts
                    once however many scenarios it is relevant to, and the Scenarios column says how many. Ties on
                    activity go to the threat relevant to more scenarios.
                  </Trans>
                )}
              />
              <HiddenThreatsHint />
            </>
          )}
        >
          {t`Most active threats`}
        </CardTitle>
      </CardHeader>
      <div className={tableClassName}>
        <DataTable
          i18nKey={getDataTableI18nKey()}
          data={(data ?? []).map((threat, index) => ({ ...threat, rank: index + 1 }))}
          columns={columns}
          toolbar={<></>}
          isLoading={data === undefined}
        />
      </div>
    </Card>
  );
};

const readingLabel = (reading: GainReading): string => {
  switch (reading) {
    case 'prevention': return t`Prevention`;
    case 'detection': return t`Detection`;
    case 'total': return t`Total`;
  }
};

const GainLegend: FunctionComponent<{ largest: number }> = ({ largest }) => (
  <span className="flex items-center gap-2 font-content-caption text-content-caption text-default-secondary">
    {formatDollar(0)}
    <span
      aria-hidden="true"
      className="h-2 w-[120px] rounded-full"
      style={{ background: `linear-gradient(90deg, ${shadeColor(FAINTEST_SHADE)}, ${shadeColor(STRONGEST_SHADE)})` }}
    />
    {formatGain(largest)}
  </span>
);

const GainFigures: FunctionComponent<{ technique: TechniqueGain }> = ({ technique }) => (
  <span className="flex flex-col gap-0.5">
    <span className="font-medium">{technique.externalId} {technique.name}</span>
    {GAIN_READINGS.map((reading) => (
      <span key={reading} className="flex justify-between gap-4 tabular-nums">
        <span>{readingLabel(reading)}</span>
        <span>{formatGain(technique[reading])}</span>
      </span>
    ))}
  </span>
);

const TechniqueCell: FunctionComponent<{ technique: TechniqueGain, reading: GainReading, largest: number }> = ({ technique, reading, largest }) => {
  const shade = gainShade(technique[reading], largest);
  const strong = shade !== null && shade > STRONG_SHADE;
  const { externalId, name } = technique;
  const prevention = formatGain(technique.prevention);
  const detection = formatGain(technique.detection);
  const total = formatGain(technique.total);
  return (
    <TooltipHint hint={<GainFigures technique={technique} />}>
      <Link
        to="/$tenantId/{-$organizationId}/settings/taxonomies/mitre-attack/techniques/$techniqueExternalId"
        params={(prev) => ({ ...prev, tenantId: prev.tenantId ?? '', techniqueExternalId: externalId })}
        aria-label={i18n._({
          id: '{externalId} {name}: prevention {prevention}, detection {detection}, total {total}',
          message: '{externalId} {name}: prevention {prevention}, detection {detection}, total {total}',
          values: { externalId, name, prevention, detection, total },
        })}
        className={cn(
          'flex min-h-[58px] flex-col justify-between gap-1 rounded-[var(--fds-radius-sm)] border px-2 py-1.5 no-underline hover:brightness-110',
          shade === null && 'border-[var(--fds-border-elevation-subtle)] bg-[var(--fds-bg-elevation-default-layer-1)] text-default-secondary',
          strong && 'text-negative-primary',
        )}
        style={shade === null ? undefined : { background: shadeColor(shade), borderColor: shadeColor(0.35) }}
      >
        <span className="line-clamp-2 font-content-caption text-content-caption">
          <span className="font-mono">{externalId}</span> {name}
        </span>
        <span className="font-content-compact-bold text-content-compact tabular-nums">{formatGain(technique[reading])}</span>
      </Link>
    </TooltipHint>
  );
};

interface TacticColumnProps {
  tactic: TacticGains,
  reading: GainReading,
  largest: number,
  expanded: boolean,
}

const TacticColumn: FunctionComponent<TacticColumnProps> = ({ tactic, reading, largest, expanded }) => {
  const gaining = countGainingTechniques(tactic.techniques, reading);
  const listed = tactic.techniques.length;
  const sorted = sortTechniques(tactic.techniques, reading);
  return (
    <div className="flex w-[132px] shrink-0 flex-col gap-1.5">
      <div className="flex h-11 flex-col justify-center rounded-[var(--fds-radius-sm)] bg-[var(--fds-bg-elevation-default-layer-1)] px-2 py-1.5">
        <span className="truncate font-content-caption text-content-caption font-medium">{tactic.name}</span>
        <span className="font-content-caption text-content-caption text-default-secondary">
          <Trans>{gaining} / {listed} techniques</Trans>
        </span>
      </div>
      {(expanded ? sorted : sorted.slice(0, TECHNIQUES_PER_TACTIC)).map((technique) => (
        <TechniqueCell key={technique.id} technique={technique} reading={reading} largest={largest} />
      ))}
    </div>
  );
};

const ReadingSwitch: FunctionComponent<{ value: GainReading, onChange: (reading: GainReading) => void }> = ({ value, onChange }) => (
  <Tabs
    value={value}
    onValueChange={(next) => {
      const reading = GAIN_READINGS.find((candidate) => candidate === next);
      if (reading !== undefined) {
        onChange(reading);
      }
    }}
  >
    <TabsList aria-label={t`Figure shown`}>
      {GAIN_READINGS.map((reading) => <TabsTrigger key={reading} value={reading}>{readingLabel(reading)}</TabsTrigger>)}
    </TabsList>
  </Tabs>
);

const TechniqueGainsMatrix: FunctionComponent<{ organizationId?: string }> = ({ organizationId }) => {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.dashboard.getTechniqueGains.queryOptions({ organizationId }));
  const [reading, setReading] = useState<GainReading>(DEFAULT_GAIN_READING);
  const [expanded, setExpanded] = useState(false);
  const largest = largestGain(data ?? [], reading);
  const priced = (data ?? []).some((tactic) => tactic.techniques.length > 0);

  let body: ReactNode;
  if (data === undefined) {
    body = <Skeleton className="h-64 w-full" />;
  } else if (!priced) {
    body = (
      <p className="py-10 text-center font-content-compact text-content-compact text-default-secondary">
        <Trans>No simulation of the scope has priced a technique yet.</Trans>
      </p>
    );
  } else {
    body = (
      <TooltipHintProvider>
        <div className="scrollbar-discreet overflow-x-auto pb-1.5">
          <div className="flex w-max gap-1.5">
            {data.map((tactic) => <TacticColumn key={tactic.id} tactic={tactic} reading={reading} largest={largest} expanded={expanded} />)}
          </div>
        </div>
        {exceedsTechniqueCap(data) && (
          <div className="flex justify-center">
            <Button type="button" priority="tertiary" size="sm" onClick={() => setExpanded(!expanded)}>
              {expanded ? t`Show fewer techniques` : t`Show all techniques`}
            </Button>
          </div>
        )}
      </TooltipHintProvider>
    );
  }

  return (
    <Card elevation={2} gap={8}>
      <CardHeader
        className="items-center"
        action={(
          <span className="flex flex-wrap items-center gap-4">
            {largest > 0 && <GainLegend largest={largest} />}
            <ReadingSwitch value={reading} onChange={setReading} />
          </span>
        )}
      >
        <CardTitle
          as="h3"
          endAdornment={(
            <MetricInfo
              title={t`ATT&CK techniques`}
              what={<Trans>What each technique costs in expected annual loss, summed over the scope's risk scenarios.</Trans>}
              how={(
                <Trans>
                  Each scenario's latest simulation prices what the loss would shed if the technique never
                  succeeded (prevention) and if it were always detected (detection). A cell sums its figure over
                  those simulations, the total adding both, and is shaded against the largest figure of the
                  matrix. A scenario not yet simulated adds nothing.
                </Trans>
              )}
              caveat={(
                <Trans>
                  Do not add the figures up. The savings of two techniques overlap, and so do a technique's
                  prevention and detection: removing one leaves less for the other to save.
                </Trans>
              )}
            />
          )}
        >
          {t`ATT&CK techniques`}
        </CardTitle>
      </CardHeader>
      {body}
    </Card>
  );
};

interface ThreatsGroupProps {
  organizationId?: string,
}

export const ThreatsGroup: FunctionComponent<ThreatsGroupProps> = ({ organizationId }) => (
  <DashboardGroup icon="locate" title={t`Threats`}>
    <ThreatCatalogCard />
    <MostActiveThreatsTable organizationId={organizationId} />
    <TechniqueGainsMatrix organizationId={organizationId} />
  </DashboardGroup>
);

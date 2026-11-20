import { Button, Chip, Icon, IconButton, Paper, Text } from '@filigran/design-system';
import { Skeleton } from '@filigran/ui';
import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { inferRouterOutputs } from '@trpc/server';
import type { FunctionComponent, ReactNode } from 'react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { GapScale } from '../tolerance-gap-utils';
import { DashboardGroup, MetricInfo } from '../../../components/shared';
import { tileTonePaint } from '../../../components/shared/tile-tone';
import { useTRPC } from '../../../lib';
import { formatDollar, formatDollarChange } from '../../../utils';
import { formatThreshold, ScenarioRiskToleranceDrawer, ScopeRiskToleranceDrawer, TOLERANCE_GAP_GROUP_ANCHOR } from '../../risk-tolerance';
import { buildGapScale, formatGapRatio, summarizeToleranceGaps, TOLERANCE_GAP_ROW_LIMIT } from '../tolerance-gap-utils';

type ToleranceGaps = inferRouterOutputs<TRPCRouter>['dashboard']['getToleranceGaps'];
type ToleranceGapRow = ToleranceGaps['rows'][number];

const SCENARIO_ROUTE = '/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId' as const;
const DASHBOARD_ROUTE = '/$tenantId/{-$organizationId}/dashboards/$dashboardId' as const;

const linkClassName = 'text-filigran-brand-primary hover:underline focus-visible:underline';

/** Shared by the axis and every row, so the bars line up with the ticks. */
// eslint-disable-next-line lingui/no-unlocalized-strings -- a class list, not copy
const ROW_COLUMNS = 'grid grid-cols-[minmax(8rem,20rem)_minmax(6rem,1fr)_7.5rem] items-center gap-4';

const overrunPaint = tileTonePaint('critical');
const marginPaint = tileTonePaint('low');

const asPercent = (fraction: number): string => `${fraction * 100}%`;

/* eslint-disable lingui/no-unlocalized-strings -- CSS values, not copy */
/** Edge labels are kept inside the axis, and the threshold's sits beside its line rather than across it. */
const tickLabelShift = (position: number, threshold: boolean): string => {
  if (position >= 1) {
    return threshold ? 'translateX(calc(-100% - 6px))' : 'translateX(-100%)';
  }
  if (threshold) {
    return 'translateX(6px)';
  }
  return position <= 0 ? 'none' : 'translateX(-50%)';
};
/* eslint-enable lingui/no-unlocalized-strings */

const RiskTreatmentLink: FunctionComponent<{ children: ReactNode }> = ({ children }) => (
  <Link
    to={DASHBOARD_ROUTE}
    params={(prev) => ({ ...prev, tenantId: prev.tenantId ?? '', dashboardId: 'risk-treatment' })}
    search={(prev) => prev}
    className={`shrink-0 font-content-compact text-content-compact ${linkClassName}`}
  >
    {children}
  </Link>
);

const GapAxis: FunctionComponent<{ scale: GapScale }> = ({ scale }) => (
  <div aria-hidden="true" className={`${ROW_COLUMNS} h-5`}>
    <Text as="span" variant="content-caption" className="text-default-secondary">{t`Risk scenario`}</Text>
    <div className="relative h-full">
      {scale.ticks.map((tick) => (
        <span
          key={tick}
          className={`absolute bottom-0 whitespace-nowrap font-content-caption text-content-caption tabular-nums ${tick === 0 ? 'font-semibold text-default-primary' : 'text-default-secondary'}`}
          style={{ left: asPercent(scale.position(tick)), transform: tickLabelShift(scale.position(tick), tick === 0) }}
        >
          {tick === 0 ? t`Threshold` : formatDollarChange(tick)}
        </span>
      ))}
    </div>
    <Text as="span" variant="content-caption" className="text-default-secondary">{t`Gap`}</Text>
  </div>
);

interface GapRowProps {
  row: ToleranceGapRow,
  scale: GapScale,
  showScope: boolean,
  onEdit: () => void,
}

const GapRow: FunctionComponent<GapRowProps> = ({ row, scale, showScope, onEdit }) => {
  const paint = row.outside ? overrunPaint : marginPaint;
  const zero = scale.position(0);
  const end = scale.position(row.gap);
  const gap = formatDollarChange(row.gap);
  const magnitude = formatDollar(Math.abs(row.gap));
  const threshold = formatThreshold(row.tolerance);
  return (
    <li className={`${ROW_COLUMNS} min-h-12 border-b border-[var(--fds-border-elevation-subtle-soft)] py-1 last:border-b-0`}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <Link
          to={SCENARIO_ROUTE}
          params={(prev) => ({ ...prev, tenantId: prev.tenantId ?? '', organizationId: row.organizationId, riskScenarioId: row.scenarioId })}
          title={row.name}
          className="truncate font-content-base text-content-base text-default-primary hover:underline focus-visible:underline"
        >
          {row.name}
        </Link>
        <div className="flex min-w-0 items-center gap-1.5">
          {showScope && row.organizationName !== null && (
            <Text as="span" variant="content-caption" className="min-w-0 truncate text-default-secondary">{`${row.organizationName} ·`}</Text>
          )}
          <Text as="span" variant="content-caption" className="shrink-0 whitespace-nowrap text-default-secondary tabular-nums">{threshold}</Text>
          {row.source === 'scenario' && <Chip label={t`Own threshold`} className="shrink-0" />}
          <IconButton
            type="button"
            priority="tertiary"
            size="sm"
            icon={<Icon name="pencil" size={16} aria-hidden />}
            aria-label={i18n._({ id: 'Edit the risk tolerance of {name}', message: 'Edit the risk tolerance of {name}', values: { name: row.name } })}
            className="shrink-0"
            onClick={onEdit}
          />
        </div>
      </div>
      <div
        role="img"
        aria-label={row.outside
          ? i18n._({ id: 'Overrun of {magnitude} past the threshold applied', message: 'Overrun of {magnitude} past the threshold applied', values: { magnitude } })
          : i18n._({ id: 'Margin of {magnitude} below the threshold applied', message: 'Margin of {magnitude} below the threshold applied', values: { magnitude } })}
        className="relative h-full min-h-10"
      >
        <span
          className="absolute top-1/2 h-5 -translate-y-1/2"
          style={{
            left: asPercent(Math.min(zero, end)),
            width: asPercent(Math.abs(end - zero)),
            background: paint.glyph,
            borderRadius: row.outside ? '0 2px 2px 0' : '2px 0 0 2px',
          }}
        />
      </div>
      <div className="flex flex-col gap-0.5 tabular-nums">
        <Text as="span" variant="content-base" className="font-semibold" style={{ color: paint.text }}>{gap}</Text>
        <Text as="span" variant="content-caption" className="text-default-secondary">
          {i18n._({ id: '{ratio} the threshold', message: '{ratio} the threshold', values: { ratio: formatGapRatio(row.ratio) } })}
        </Text>
      </div>
    </li>
  );
};

const GapGridLines: FunctionComponent<{ scale: GapScale }> = ({ scale }) => (
  <div aria-hidden="true" className={`${ROW_COLUMNS} pointer-events-none absolute inset-0`}>
    <span />
    <div className="relative h-full">
      {scale.ticks.map((tick) => (
        <span
          key={tick}
          className="absolute inset-y-0"
          style={{
            left: asPercent(scale.position(tick)),
            width: tick === 0 ? 2 : 1,
            background: tick === 0 ? 'var(--fds-text-default-primary)' : 'var(--fds-border-elevation-subtle-soft)',
          }}
        />
      ))}
    </div>
    <span />
  </div>
);

const Legend: FunctionComponent = () => (
  <div className="flex flex-wrap items-center gap-5 font-content-caption text-content-caption text-default-secondary">
    <span className="inline-flex items-center gap-1.5">
      <span className="h-3 w-3 rounded-sm" style={{ background: overrunPaint.glyph }} />
      {t`Overrun (outside tolerance)`}
    </span>
    <span className="inline-flex items-center gap-1.5">
      <span className="h-3 w-3 rounded-sm" style={{ background: marginPaint.glyph }} />
      {t`Margin (within tolerance)`}
    </span>
  </div>
);

interface NoToleranceLineProps {
  gaps: ToleranceGaps,
  showScope: boolean,
  onSetScopeTolerance: (organizationId: string) => void,
}

/** Setting the scope's tolerance covers them all only when they share one scope. */
const NoToleranceLine: FunctionComponent<NoToleranceLineProps> = ({ gaps, showScope, onSetScopeTolerance }) => {
  const { noToleranceCount } = gaps;
  const [onlyScope] = gaps.noToleranceScopes.length === 1 ? gaps.noToleranceScopes : [];
  const scopeName = onlyScope?.organizationName ?? null;
  return (
    <Paper elevation={2} className="flex flex-wrap items-center gap-4 py-2">
      <Text as="span" variant="content-compact" className="min-w-0 grow text-default-secondary">
        {showScope && scopeName !== null
          ? i18n._({
            id: '{noToleranceCount, plural, one {# scenario with no tolerance, in {scopeName}} other {# scenarios with no tolerance, all in {scopeName}}}',
            message: '{noToleranceCount, plural, one {# scenario with no tolerance, in {scopeName}} other {# scenarios with no tolerance, all in {scopeName}}}',
            values: { noToleranceCount, scopeName },
          })
          : i18n._({
            id: '{noToleranceCount, plural, one {# scenario with no tolerance} other {# scenarios with no tolerance}}',
            message: '{noToleranceCount, plural, one {# scenario with no tolerance} other {# scenarios with no tolerance}}',
            values: { noToleranceCount },
          })}
      </Text>
      {onlyScope !== undefined && (
        <Button type="button" priority="tertiary" size="sm" startIcon={<Icon name="plus" size={16} />} className="shrink-0" onClick={() => onSetScopeTolerance(onlyScope.organizationId)}>
          {t`Set its risk tolerance`}
        </Button>
      )}
      <RiskTreatmentLink>{t`See which`}</RiskTreatmentLink>
    </Paper>
  );
};

interface ToleranceGapGroupProps {
  organizationId?: string,
}

export const ToleranceGapGroup: FunctionComponent<ToleranceGapGroupProps> = ({ organizationId }) => {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.dashboard.getToleranceGaps.queryOptions({ organizationId }));
  const [editedRow, setEditedRow] = useState<ToleranceGapRow | null>(null);
  const [editedScopeId, setEditedScopeId] = useState<string | null>(null);
  const summary = summarizeToleranceGaps(data?.rows ?? []);
  const scale = buildGapScale(summary.shown.map((row) => row.gap));

  let content: ReactNode;
  if (data === undefined) {
    content = <Skeleton className="h-72 w-full" />;
  } else {
    content = (
      <>
        {data.rows.length === 0
          ? (
            <Text as="p" variant="content-base" className="text-default-secondary">
              <Trans>No scenario under a risk tolerance has a simulation to compare with it yet.</Trans>
            </Text>
          )
          : (
            <Paper elevation={2} className="flex flex-col gap-1 tabular-nums">
              <Legend />
              <GapAxis scale={scale} />
              <div className="relative border-t border-[var(--fds-border-elevation-subtle)]">
                <GapGridLines scale={scale} />
                <ol aria-label={t`Risk scenarios by gap to tolerance, largest first`} className="relative m-0 list-none p-0">
                  {summary.shown.map((row) => (
                    <GapRow key={row.scenarioId} row={row} scale={scale} showScope={organizationId === undefined} onEdit={() => setEditedRow(row)} />
                  ))}
                </ol>
              </div>
              {summary.otherCount > 0 && (
                <div className="flex min-h-10 flex-wrap items-center gap-4 border-t border-[var(--fds-border-elevation-subtle)] pt-1">
                  <Text as="span" variant="content-base" className="min-w-0 grow text-default-secondary">
                    {summary.otherOutsideCount === 0
                      ? i18n._({
                        id: '+ {otherCount, plural, one {# other scenario, within its tolerance} other {# other scenarios, all within their tolerance}}',
                        message: '+ {otherCount, plural, one {# other scenario, within its tolerance} other {# other scenarios, all within their tolerance}}',
                        values: { otherCount: summary.otherCount },
                      })
                      : i18n._({
                        id: '+ {otherCount, plural, one {# other scenario} other {# other scenarios}}, {otherOutsideCount, plural, one {# still outside its tolerance} other {# still outside their tolerance}}',
                        message: '+ {otherCount, plural, one {# other scenario} other {# other scenarios}}, {otherOutsideCount, plural, one {# still outside its tolerance} other {# still outside their tolerance}}',
                        values: { otherCount: summary.otherCount, otherOutsideCount: summary.otherOutsideCount },
                      })}
                  </Text>
                  <RiskTreatmentLink>{t`See all in Risk treatment`}</RiskTreatmentLink>
                </div>
              )}
            </Paper>
          )}
        {data.noToleranceCount > 0 && (
          <NoToleranceLine gaps={data} showScope={organizationId === undefined} onSetScopeTolerance={setEditedScopeId} />
        )}
      </>
    );
  }

  return (
    <DashboardGroup
      id={TOLERANCE_GAP_GROUP_ANCHOR}
      icon="locate-fixed"
      title={t`Gap to tolerance`}
      info={(
        <MetricInfo
          title={t`Gap to tolerance`}
          what={(
            <Trans>
              How far each scenario sits from the risk tolerance applied to it, its own threshold or else its risk scope's: to the
              right it overruns the tolerance by that amount, to the left it keeps that margin.
            </Trans>
          )}
          how={(
            <Trans>
              The gap is the loss exceeded with the maximum tolerated probability minus the threshold amount, read on the loss
              exceedance curve of each scenario's latest simulation. Its ratio is that loss divided by the threshold amount. The
              group shows the {TOLERANCE_GAP_ROW_LIMIT} largest gaps.
            </Trans>
          )}
          caveat={<Trans>A scenario whose latest simulation kept no annual loss distribution has no curve to read, so it is left out.</Trans>}
        />
      )}
      action={summary.otherCount === 0 && data !== undefined && data.rows.length > 0
        ? <RiskTreatmentLink>{t`See the Risk treatment dashboard`}</RiskTreatmentLink>
        : undefined}
    >
      {content}
      <ScenarioRiskToleranceDrawer
        open={editedRow !== null}
        onClose={() => setEditedRow(null)}
        scenarioName={editedRow?.name ?? ''}
        riskScenarioId={editedRow?.scenarioId ?? ''}
        organizationId={editedRow?.organizationId ?? ''}
        scopeTolerance={editedRow?.scopeTolerance ?? null}
        ownTolerance={editedRow?.ownTolerance ?? null}
      />
      {editedScopeId !== null && <ScopeRiskToleranceDrawer organizationId={editedScopeId} open onClose={() => setEditedScopeId(null)} />}
    </DashboardGroup>
  );
};

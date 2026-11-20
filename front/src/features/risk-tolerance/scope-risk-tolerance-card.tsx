import { Button, Chip, Text } from '@filigran/design-system';
import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { InfoField, MetricInfo, SectionCard } from '../../components/shared';
import { useTRPC } from '../../lib';
import { formatDollar } from '../../utils';
import { countToleranceStatuses, formatToleranceProbability, TOLERANCE_GAP_GROUP_ANCHOR } from './risk-tolerance-utils';
import { ScopeRiskToleranceDrawer } from './scope-risk-tolerance-drawer';

const ToleranceStatusSummary: FunctionComponent<{ organizationId: string }> = ({ organizationId }) => {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.dashboard.getToleranceGaps.queryOptions({ organizationId }));
  if (data === undefined || data.rows.length === 0) {
    return null;
  }
  const { simulatedCount, outsideCount, withinCount, ownThresholdCount } = countToleranceStatuses(data.rows);
  return (
    <div className="flex flex-col gap-2.5 border-t border-[var(--fds-border-elevation-subtle)] pt-3.5">
      <Text as="span" variant="content-caption" className="text-default-secondary">
        {i18n._({
          id: '{simulatedCount, plural, one {Its # simulated scenario} other {Its # simulated scenarios}}',
          message: '{simulatedCount, plural, one {Its # simulated scenario} other {Its # simulated scenarios}}',
          values: { simulatedCount },
        })}
      </Text>
      <div className="flex flex-wrap items-center gap-2">
        {outsideCount > 0 && <Chip severity="critical" label={i18n._({ id: '{outsideCount} outside tolerance', message: '{outsideCount} outside tolerance', values: { outsideCount } })} />}
        {withinCount > 0 && <Chip severity="low" label={i18n._({ id: '{withinCount} within tolerance', message: '{withinCount} within tolerance', values: { withinCount } })} />}
        {ownThresholdCount > 0 && (
          <Chip
            label={i18n._({
              id: '{ownThresholdCount, plural, one {including # with its own threshold} other {including # with their own threshold}}',
              message: '{ownThresholdCount, plural, one {including # with its own threshold} other {including # with their own threshold}}',
              values: { ownThresholdCount },
            })}
          />
        )}
        <Link
          to="/$tenantId/{-$organizationId}/dashboards/$dashboardId"
          params={(prev) => ({ ...prev, tenantId: prev.tenantId ?? '', organizationId, dashboardId: 'risk' })}
          hash={TOLERANCE_GAP_GROUP_ANCHOR}
          className="ml-auto font-content-compact text-content-compact text-filigran-brand-primary hover:underline focus-visible:underline"
        >
          {t`See the gap to tolerance`}
        </Link>
      </div>
    </div>
  );
};

export const ScopeRiskToleranceCard: FunctionComponent<{ organizationId: string }> = ({ organizationId }) => {
  const trpc = useTRPC();
  const [editing, setEditing] = useState(false);
  const { data } = useQuery(trpc.organizations.getRiskTolerance.queryOptions({ organizationId }));

  if (data === undefined) {
    return null;
  }
  const { tolerance } = data;

  return (
    <>
      <SectionCard
        title={(
          <span className="inline-flex items-center gap-1">
            {t`Risk tolerance`}
            <MetricInfo
              title={t`Risk tolerance`}
              what={<Trans>The highest probability of a year's loss exceeding an amount the organisation accepts.</Trans>}
              how={<Trans>Applied to each scenario of the scope on its own, never to their sum. A scenario can set its own threshold from its loss exceedance curve.</Trans>}
            />
          </span>
        )}
        headerAction={tolerance === null
          ? undefined
          : <Button type="button" priority="secondary" size="sm" onClick={() => setEditing(true)}>{t`Edit`}</Button>}
      >
        {tolerance === null
          ? (
            <div className="flex items-center gap-4">
              <p className="grow text-default-secondary"><Trans>No risk tolerance is set on this scope.</Trans></p>
              <Button type="button" priority="primary" size="sm" className="shrink-0" onClick={() => setEditing(true)}>{t`Set a risk tolerance`}</Button>
            </div>
          )
          : (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-6">
                <InfoField title={t`Annual loss`} value={formatDollar(tolerance.annualLoss)} />
                <InfoField title={t`Maximum probability of exceeding it`} value={formatToleranceProbability(tolerance.maxExceedanceProbability)} />
              </div>
              <ToleranceStatusSummary organizationId={organizationId} />
            </div>
          )}
      </SectionCard>
      <ScopeRiskToleranceDrawer organizationId={organizationId} open={editing} onClose={() => setEditing(false)} />
    </>
  );
};

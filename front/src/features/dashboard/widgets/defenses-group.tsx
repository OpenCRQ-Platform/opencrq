import { Chip, Paper, ProgressBar, Text } from '@filigran/design-system';
import { Skeleton } from '@filigran/ui';
import type { StrengthRung } from '@app/module/client';
import { STRENGTH_RUNGS, TECHNIQUE_POSTURE_CHANGE_DAYS } from '@app/module/client';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import type { inferRouterOutputs } from '@trpc/server';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent, ReactNode } from 'react';
import type { TestTally } from '../defenses-utils';
import { DashboardGroup, MetricInfo } from '../../../components/shared';
import { useTRPC } from '../../../lib';
import { cn } from '../../../utils';
import { latestUpdatedFirst, toAssessmentListRows } from '../../compliance-assessments/compliance-assessments-utils';
import { AssessmentStatusChip, MeanMaturityChip } from '../../compliance-assessments/ui/maturity-chips';
import { readinessFromCounts } from '../../drata/drata-utils';
import { strengthLabel } from '../../controls/capability/ui/strength-label';
import { formatNumber } from '../../../utils/format-number';
import { DashboardWidgetCard } from '../components/dashboard-widget-card';
import { answeredPercent, applicableRequirementCount, countControlPosture, testScore, testScoreChange } from '../defenses-utils';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;
type Assessment = RouterOutputs['complianceAssessments']['getAssessments'][number];
type DrataFramework = RouterOutputs['drata']['getFrameworks'][number];

/** The most recently updated ones; the list holds the rest. */
const ASSESSMENT_LIMIT = 5;

const linkClassName = 'font-content-compact text-content-compact text-filigran-brand-primary hover:underline';

/* eslint-disable lingui/no-unlocalized-strings -- Tailwind class lists, not copy */
const ASSESSMENT_GRID = 'grid grid-cols-1 gap-3 md:grid-cols-[repeat(2,minmax(0,1fr))] xl:grid-cols-[repeat(3,minmax(0,1fr))]';
const POSTURE_GRID = 'grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,0.6fr)_repeat(2,minmax(0,1fr))]';
/* eslint-enable lingui/no-unlocalized-strings */

const AssessmentRow: FunctionComponent<{ assessment: Assessment }> = ({ assessment }) => {
  const { maturity } = assessment;
  const answered = maturity.answeredCount;
  const applicable = applicableRequirementCount(maturity);
  return (
    <Paper as="li" elevation={3} padding={16} className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2.5">
        <Link
          to="/$tenantId/{-$organizationId}/compliance/assessments/$assessmentId"
          params={(prev) => ({ ...prev, tenantId: prev.tenantId ?? '', assessmentId: assessment.id })}
          className="min-w-0 flex-1 truncate font-content-compact text-content-compact font-medium hover:underline"
        >
          {assessment.name}
        </Link>
        <AssessmentStatusChip status={assessment.status} />
      </div>
      <div className="flex items-center justify-between gap-2.5">
        <MeanMaturityChip meanLevel={maturity.meanLevel} />
        <Text as="span" variant="content-compact" className="whitespace-nowrap text-default-secondary tabular-nums">
          <Trans>{answered} / {applicable} answered</Trans>
        </Text>
      </div>
      <ProgressBar value={answeredPercent(maturity)} aria-label={t`Answered requirements`} />
    </Paper>
  );
};

const DrataFrameworkRow: FunctionComponent<{ framework: DrataFramework }> = ({ framework }) => {
  const { percent } = readinessFromCounts({
    total: framework.derivedTotalRequirements,
    inScope: framework.derivedInScopeRequirements,
    readyInScope: framework.derivedReadyInScopeRequirements,
  });
  return (
    <Paper as="li" elevation={3} padding={16} className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2.5">
        <Link
          to="/$tenantId/{-$organizationId}/compliance/$frameworkId"
          params={(prev) => ({ ...prev, tenantId: prev.tenantId ?? '', frameworkId: framework.id })}
          className="min-w-0 flex-1 truncate font-content-compact text-content-compact font-medium hover:underline"
        >
          {framework.name}
        </Link>
        <Chip severity="neutral" label={t`Synced`} />
      </div>
      <div className="flex items-center justify-between gap-2.5">
        <Text as="span" variant="content-compact" className="text-default-secondary"><Trans>Drata</Trans></Text>
        <Text as="span" variant="content-compact" className="whitespace-nowrap text-default-secondary tabular-nums">
          {percent === null ? <Trans>Nothing in scope</Trans> : <Trans>{percent}% ready</Trans>}
        </Text>
      </div>
      <ProgressBar value={percent ?? 0} aria-label={t`Ready requirements`} />
    </Paper>
  );
};

const ComplianceCard: FunctionComponent = () => {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.complianceAssessments.getAssessments.queryOptions());
  const { data: frameworks } = useQuery(trpc.drata.getFrameworks.queryOptions());
  const rows = latestUpdatedFirst(toAssessmentListRows(data ?? [], frameworks ?? [])).slice(0, ASSESSMENT_LIMIT);
  return (
    <DashboardWidgetCard
      title={t`Compliance`}
      info={(
        <MetricInfo
          title={t`Compliance`}
          what={<Trans>The tenant's latest compliance assessments, with their mean maturity and how far they are answered. A framework assessed in Drata shows how many of its in-scope requirements are ready instead.</Trans>}
          how={<Trans>The mean maturity is that of the answered requirements, out of 5. A requirement marked not applicable is left out of the answered count.</Trans>}
          caveat={<Trans>Assessments belong to the tenant, not to a risk scope: this card shows on the whole tenant only.</Trans>}
        />
      )}
      action={(
        <Link
          to="/$tenantId/{-$organizationId}/compliance/assessments"
          params={(prev) => ({ ...prev, tenantId: prev.tenantId ?? '' })}
          className={linkClassName}
        >
          <Trans>See assessments</Trans>
        </Link>
      )}
    >
      {(data === undefined || frameworks === undefined) && <Skeleton className="h-36 w-full" />}
      {data !== undefined && frameworks !== undefined && rows.length === 0 && (
        <Text as="p" variant="content-compact" className="text-default-secondary"><Trans>No assessment yet.</Trans></Text>
      )}
      {data !== undefined && frameworks !== undefined && rows.length > 0 && (
        <ul className={ASSESSMENT_GRID}>
          {rows.map((row) => (row.source === 'opencrq'
            ? <AssessmentRow key={row.id} assessment={row.assessment} />
            : <DrataFrameworkRow key={row.id} framework={row.framework} />))}
        </ul>
      )}
    </DashboardWidgetCard>
  );
};

const CHANGE_SEVERITY = { up: 'low', down: 'critical', flat: 'neutral' } as const;

const ScoreChangeChip: FunctionComponent<{ change: number | null }> = ({ change }) => {
  if (change === null) {
    return null;
  }
  const points = change;
  const label = change > 0
    ? i18n._({ id: '+{points} pts', message: '+{points} pts', values: { points } })
    : i18n._({ id: '{points} pts', message: '{points} pts', values: { points } });
  const days = TECHNIQUE_POSTURE_CHANGE_DAYS;
  const Arrow = change > 0 ? ArrowUp : ArrowDown;
  return (
    <Chip
      label={label}
      severity={CHANGE_SEVERITY[change > 0 ? 'up' : (change < 0 ? 'down' : 'flat')]}
      startIcon={change === 0 ? undefined : <Arrow className="h-4 w-4" />}
      title={i18n._({ id: 'Change over {days} days', message: 'Change over {days} days', values: { days } })}
      className="tabular-nums"
    />
  );
};

const ExpectationTile: FunctionComponent<{ label: string, current: TestTally | null, previous: TestTally | null, detail: (tally: TestTally) => ReactNode }> = ({
  label,
  current,
  previous,
  detail,
}) => {
  const score = testScore(current);
  return (
    <Paper elevation={3} padding={16} className="flex flex-col gap-2.5">
      <Text as="h4" variant="title-sm">{label}</Text>
      {score === null || current === null
        ? <Text as="p" variant="content-compact" className="text-default-secondary"><Trans>Not tested</Trans></Text>
        : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex items-baseline gap-1.5">
                <Text as="span" variant="title-xl" className="tabular-nums">{score}</Text>
                <Text as="span" variant="content-compact" className="text-default-secondary">/ 100</Text>
              </span>
              <ScoreChangeChip change={testScoreChange(current, previous)} />
            </div>
            <ProgressBar value={score} aria-label={label} />
            <Text as="p" variant="content-compact" className="text-default-secondary">{detail(current)}</Text>
          </>
        )}
    </Paper>
  );
};

const OpenAevPostureCard: FunctionComponent<{ organizationId?: string }> = ({ organizationId }) => {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.findingScore.getTechniqueTestPosture.queryOptions({ organizationId: organizationId ?? null }));
  const days = TECHNIQUE_POSTURE_CHANGE_DAYS;
  return (
    <DashboardWidgetCard
      title={t`OpenAEV posture`}
      info={(
        <MetricInfo
          title={t`OpenAEV posture`}
          what={<Trans>How well the defenses held when OpenAEV tested them on the scope's assets.</Trans>}
          how={(
            <Trans>
              Each score is the share of the latest OpenAEV results that held, out of 100: an attack blocked for
              prevention, an attack detected for detection. The change compares it with the results known {days} days ago.
            </Trans>
          )}
        />
      )}
    >
      {data === undefined && <Skeleton className="h-36 w-full" />}
      {data !== undefined && data.testedAssetCount === 0 && (
        <Text as="p" variant="content-compact" className="text-default-secondary">
          <Trans>Not tested: OpenAEV has no result on the assets of this scope.</Trans>
        </Text>
      )}
      {data !== undefined && data.testedAssetCount > 0 && (
        <div className={POSTURE_GRID}>
          <Paper elevation={3} padding={16} className="flex flex-col justify-between gap-2.5">
            <Text as="h4" variant="title-sm"><Trans>Tested assets</Trans></Text>
            <Text as="span" variant="title-xl" className="tabular-nums">{formatNumber(data.testedAssetCount)}</Text>
            <Text as="p" variant="content-compact" className="text-default-secondary"><Trans>With an OpenAEV result</Trans></Text>
          </Paper>
          <ExpectationTile
            label={t`Prevention`}
            current={data.expectations.prevention.current}
            previous={data.expectations.prevention.previous}
            detail={({ held, total }) => <Trans>{held} prevention results out of {total} blocked the attack</Trans>}
          />
          <ExpectationTile
            label={t`Detection`}
            current={data.expectations.detection.current}
            previous={data.expectations.detection.previous}
            detail={({ held, total }) => <Trans>{held} detection results out of {total} detected the attack</Trans>}
          />
        </div>
      )}
    </DashboardWidgetCard>
  );
};

/** The rung colours `StrengthBadge` gives each rung, so a rung reads the same here as in the controls list. */
const RUNG_FILL: Record<StrengthRung, string> = {
  L0: 'bg-[var(--fds-color-feedback-neutral-primary)]',
  L1: 'bg-[var(--fds-color-feedback-error-primary)]',
  L2: 'bg-[var(--fds-color-feedback-warning-primary)]',
  L3: 'bg-[var(--fds-color-feedback-success-primary)]',
};

const CountTile: FunctionComponent<{ label: string, count: number }> = ({ label, count }) => (
  <Paper elevation={3} padding={16} className="flex w-44 shrink-0 flex-col gap-4">
    <Text as="h4" variant="title-sm">{label}</Text>
    <Text as="span" variant="title-xl" className="tabular-nums">{formatNumber(count)}</Text>
  </Paper>
);

const ControlsCard: FunctionComponent<{ organizationId?: string }> = ({ organizationId }) => {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.controlCapabilities.getResolvedControlPosture.queryOptions({ organizationId: organizationId ?? null }));
  const counts = data === undefined ? null : countControlPosture(data);
  const assessed = counts === null ? 0 : counts.capabilityCount - counts.notAssessed;
  return (
    <DashboardWidgetCard
      title={t`Controls`}
      info={(
        <MetricInfo
          title={t`Controls`}
          what={<Trans>The control capabilities, how many are not assessed, and how many sit at each strength rung.</Trans>}
          how={<Trans>Read on the scope's posture: a strength the scope declares replaces the tenant's.</Trans>}
        />
      )}
    >
      {counts === null
        ? <Skeleton className="h-32 w-full" />
        : (
          <div className="flex flex-wrap items-stretch gap-3">
            <CountTile label={t`Controls`} count={counts.capabilityCount} />
            <CountTile label={t`Not assessed`} count={counts.notAssessed} />
            <Paper elevation={3} padding={16} className="flex min-w-64 flex-1 flex-col gap-3.5">
              <Text as="h4" variant="title-sm"><Trans>Strength</Trans></Text>
              <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-[var(--fds-bg-elevation-highlight-layer-0)]" aria-hidden="true">
                {STRENGTH_RUNGS.map((rung) => (counts.byRung[rung] === 0 ? null : (
                  <span key={rung} className={RUNG_FILL[rung]} style={{ width: `${(counts.byRung[rung] / Math.max(assessed, 1)) * 100}%` }} />
                )))}
              </div>
              <ul className="flex flex-wrap gap-x-5 gap-y-2">
                {STRENGTH_RUNGS.map((rung) => (
                  <li key={rung} className="flex items-center gap-1.5 font-content-compact text-content-compact text-default-secondary">
                    <span aria-hidden="true" className={cn('size-2.5 rounded-[2px]', RUNG_FILL[rung])} />
                    {strengthLabel(rung)}
                    <span className="text-default-primary tabular-nums">{counts.byRung[rung]}</span>
                  </li>
                ))}
              </ul>
            </Paper>
          </div>
        )}
    </DashboardWidgetCard>
  );
};

interface DefensesGroupProps {
  organizationId?: string,
}

export const DefensesGroup: FunctionComponent<DefensesGroupProps> = ({ organizationId }) => {
  // Assessments belong to the tenant: a risk scope has none to show.
  const showsCompliance = organizationId === undefined;
  return (
    <DashboardGroup icon="shield-check" title={t`Defenses and compliance`}>
      <OpenAevPostureCard organizationId={organizationId} />
      {showsCompliance && <ComplianceCard />}
      <ControlsCard organizationId={organizationId} />
    </DashboardGroup>
  );
};

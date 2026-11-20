import { Button, Card, CardHeader, CardTitle, Chip } from '@filigran/design-system';
import { DataTable } from '@filigran/ui';
import type { ColumnDefWithOptionsHeader } from '@filigran/ui';
import { resolveSeverityBand } from '@app/module/client';
import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Link, useNavigate } from '@tanstack/react-router';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { inferRouterOutputs } from '@trpc/server';
import type { FunctionComponent, ReactElement, ReactNode } from 'react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { EmptyValue } from '../../../components/ui/empty-value';
import { ControlIdPill, DashboardGroup, MetricInfo } from '../../../components/shared';
import { getDataTableI18nKey } from '../../../components/ui/data-table-i18n';
import { useTRPC } from '../../../lib';
import { formatDollar } from '../../../utils';
import { ScoreGaugeMark, severityBandLabel } from '../../finding-score';
import { getConnectorNameBySource } from '../../integrations';
import { ControlEvolutionBadges } from '../../risk-scenarios/components/control-evolution-badges';
import { leverDimensionLabel } from '../../risk-scenarios/components/lever-dimension-label';
import { TreatmentPlanCreateDrawer } from '../../treatment-plans/components/treatment-plan-create-drawer';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;
type ControlMove = RouterOutputs['dashboard']['getTopControlMoves'][number] & { id: string };
type Vulnerability = RouterOutputs['findingScore']['getTopVulnerabilities'][number] & { id: string };

const SeeAllLink: FunctionComponent<{ to: '/$tenantId/{-$organizationId}/controls' | '/$tenantId/{-$organizationId}/findings', label: string }> = ({ to, label }) => (
  <Link
    to={to}
    params={(prev) => ({ ...prev, tenantId: prev.tenantId ?? '' })}
    className="font-content-compact text-content-compact text-filigran-brand-primary hover:underline"
  >
    {label}
  </Link>
);

const TableCard: FunctionComponent<{ title: string, info: ReactNode, action: ReactNode, children: ReactNode }> = ({ title, info, action, children }) => (
  <Card elevation={2} gap={8}>
    <CardHeader action={<span className="flex min-h-6 items-center">{action}</span>}>
      <CardTitle as="h3" endAdornment={info}>{title}</CardTitle>
    </CardHeader>
    {children}
  </Card>
);

const tableClassName = 'scrollbar-discreet overflow-auto [&_.twp]:mt-0 [&_th]:pl-2 [&_td]:px-2';

const TopControlsTable: FunctionComponent<{ organizationId?: string }> = ({ organizationId }) => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const { data } = useQuery(trpc.dashboard.getTopControlMoves.queryOptions({ organizationId }));

  const columns: Array<ColumnDefWithOptionsHeader<ControlMove, unknown>> = [
    {
      id: 'externalId',
      header: t`ID`,
      size: 80,
      enableSorting: false,
      cell: ({ row }): ReactElement => <ControlIdPill externalId={row.original.externalId} />,
    },
    {
      id: 'name',
      header: t`Control`,
      size: 240,
      enableSorting: false,
      cell: ({ row }): ReactElement => <span className="block truncate font-medium">{row.original.name}</span>,
    },
    {
      id: 'category',
      header: t({ message: 'Change', context: 'kind of control move' }),
      size: 120,
      enableSorting: false,
      cell: ({ row }): ReactElement => <Chip label={leverDimensionLabel(row.original.dimension)} />,
    },
    {
      id: 'step',
      header: t`Step`,
      size: 230,
      enableSorting: false,
      cell: ({ row }): ReactElement => (
        <ControlEvolutionBadges
          dimension={row.original.dimension}
          currentStrength={row.original.currentStrength}
          upgradedStrength={row.original.upgradedStrength}
          currentCoverage={row.original.currentCoverage}
          upgradedCoverage={row.original.upgradedCoverage}
        />
      ),
    },
    {
      id: 'scenarios',
      header: t`Scenarios`,
      size: 90,
      enableSorting: false,
      cell: ({ row }): ReactElement => <span className="tabular-nums">{row.original.scenarioCount}</span>,
    },
    {
      id: 'reduction',
      header: t`ALE reduction`,
      size: 150,
      enableSorting: false,
      cell: ({ row }): ReactElement => (
        <span className="whitespace-nowrap font-title-sm text-title-sm font-semibold tabular-nums text-feedback-success-primary">
          −{formatDollar(row.original.totalAleReduction)}
        </span>
      ),
    },
  ];

  return (
    <TableCard
      title={t`Top recommended controls`}
      info={(
        <MetricInfo
          title={t`Top recommended controls`}
          what={<Trans>The control moves that would buy the most annual loss reduction, one per control.</Trans>}
          how={(
            <Trans>
              Each scenario's latest simulation prices every one-step move of every control. A row keeps
              the move whose reduction, summed over the scenarios it applies to, is the largest: the
              step, the scenario count and the reduction all belong to that move.
            </Trans>
          )}
          caveat={(
            <Trans>
              Do not add the column up. Each figure assumes the others do not happen: controls overlap,
              so the second move you make will be worth less than it says here.
            </Trans>
          )}
        />
      )}
      action={<SeeAllLink to="/$tenantId/{-$organizationId}/controls" label={t`See all controls`} />}
    >
      <div className={tableClassName}>
        <DataTable
          i18nKey={getDataTableI18nKey()}
          data={(data ?? []).map((move) => ({ ...move, id: move.controlId }))}
          columns={columns}
          toolbar={<></>}
          isLoading={data === undefined}
          onClickRow={(row) => {
            void navigate({
              to: '/$tenantId/{-$organizationId}/controls/$controlId/overview',
              params: (prev) => ({ tenantId: prev.tenantId!, controlId: row.original.controlId }),
            });
          }}
        />
      </div>
    </TableCard>
  );
};

const expectationLabel = (expectation: Vulnerability['expectationType']): string | null => {
  switch (expectation) {
    case 'prevention': return t`Prevention`;
    case 'detection': return t`Detection`;
    case null: return null;
  }
};

const VulnerabilityName: FunctionComponent<{ vulnerability: Vulnerability }> = ({ vulnerability }) => {
  if (vulnerability.cveId !== null) {
    return (
      <span className="flex min-w-0 flex-col">
        <span className="font-medium">{vulnerability.cveId}</span>
        {vulnerability.cveTitle !== null && <span className="truncate text-default-secondary">{vulnerability.cveTitle}</span>}
      </span>
    );
  }
  const expectation = expectationLabel(vulnerability.expectationType);
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="truncate font-medium">{vulnerability.mitreTechniqueExternalId} {vulnerability.mitreTechniqueName}</span>
      {expectation !== null && <Chip label={expectation} />}
    </span>
  );
};

const TopFindingsTable: FunctionComponent<{ organizationId?: string }> = ({ organizationId }) => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const { data } = useQuery(trpc.findingScore.getTopVulnerabilities.queryOptions({ organizationId: organizationId ?? null }));

  const columns: Array<ColumnDefWithOptionsHeader<Vulnerability, unknown>> = [
    {
      id: 'name',
      header: t`Finding`,
      size: 320,
      enableSorting: false,
      cell: ({ row }): ReactElement => <VulnerabilityName vulnerability={row.original} />,
    },
    {
      id: 'sources',
      header: t`Sources`,
      size: 240,
      enableSorting: false,
      cell: ({ row }): ReactElement => (
        <span className="flex flex-wrap gap-1.5">
          {row.original.sources.map((source) => <Chip key={source} label={getConnectorNameBySource(source) ?? source} />)}
        </span>
      ),
    },
    {
      id: 'score',
      header: t`Score`,
      size: 90,
      enableSorting: false,
      cell: ({ row }): ReactElement => {
        const { score } = row.original;
        if (score === null) {
          return <EmptyValue />;
        }
        const band = resolveSeverityBand(score);
        const bandWord = severityBandLabel(band);
        return <ScoreGaugeMark score={score} band={band} label={i18n._({ id: 'Finding score: {score} out of 100, {bandWord} band', message: 'Finding score: {score} out of 100, {bandWord} band', values: { score, bandWord } })} />;
      },
    },
    {
      id: 'assets',
      header: t`Impacted assets`,
      size: 130,
      enableSorting: false,
      cell: ({ row }): ReactElement => <span className="tabular-nums">{row.original.impactedAssetCount}</span>,
    },
  ];

  return (
    <TableCard
      title={t`Top recommended findings`}
      info={(
        <MetricInfo
          title={t`Top recommended findings`}
          what={<Trans>The open vulnerabilities to remediate first, each counted once over the assets it is found on.</Trans>}
          how={(
            <Trans>
              A row groups every applicable finding of one CVE, or of one technique in prevention or in detection,
              over the scope's assets. Its score is that of its worst finding, which the row opens.
            </Trans>
          )}
        />
      )}
      action={<SeeAllLink to="/$tenantId/{-$organizationId}/findings" label={t`See all findings`} />}
    >
      <div className={tableClassName}>
        <DataTable
          i18nKey={getDataTableI18nKey()}
          data={(data ?? []).map((vulnerability) => ({ ...vulnerability, id: vulnerability.worstEvidenceId }))}
          columns={columns}
          toolbar={<></>}
          isLoading={data === undefined}
          onClickRow={(row) => {
            void navigate({
              to: '/$tenantId/{-$organizationId}/findings/$evidenceId',
              params: (prev) => ({ tenantId: prev.tenantId!, evidenceId: row.original.worstEvidenceId }),
            });
          }}
        />
      </div>
    </TableCard>
  );
};

interface TreatmentRecommendationsGroupProps {
  organizationId?: string,
}

export const TreatmentRecommendationsGroup: FunctionComponent<TreatmentRecommendationsGroupProps> = ({ organizationId }) => {
  const navigate = useNavigate();
  const [isCreateOpen, setCreateOpen] = useState(false);

  const openPlan = (treatmentPlanId: string) => {
    void navigate({
      to: '/$tenantId/{-$organizationId}/treatment-plans/$treatmentPlanId',
      params: (prev) => ({ tenantId: prev.tenantId!, organizationId: organizationId ?? prev.organizationId, treatmentPlanId }),
    });
  };

  return (
    <DashboardGroup
      icon="list-checks"
      title={t`Risk treatment recommendations`}
      action={(
        <Button priority="secondary" onClick={() => setCreateOpen(true)}>
          <Trans>Create a risk treatment plan</Trans>
        </Button>
      )}
    >
      <TopControlsTable organizationId={organizationId} />
      <TopFindingsTable organizationId={organizationId} />
      <TreatmentPlanCreateDrawer
        open={isCreateOpen}
        onOpenChange={setCreateOpen}
        organizationId={organizationId}
        onCreated={openPlan}
      />
    </DashboardGroup>
  );
};

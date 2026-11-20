import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent, ReactElement } from 'react';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { inferRouterOutputs } from '@trpc/server';
import type { ColumnDefWithOptionsHeader } from '../../../../components/ui/data-table-types';
import { InfoTooltip, SectionCard } from '../../../../components/shared';
import { DataPageLayout } from '../../../../components/ui/data-page-layout';
import { useTRPC } from '../../../../lib';
import { AnswerChip } from '../../../compliance-assessments/ui/maturity-chips';

type ControlEvidence = inferRouterOutputs<TRPCRouter>['complianceAssessments']['getControlEvidence'][number];
type AssessmentEvidenceRow = ControlEvidence & { id: string };

const buildColumns = (): Array<ColumnDefWithOptionsHeader<AssessmentEvidenceRow, unknown>> => [
  {
    id: 'frameworkTitle',
    accessorKey: 'frameworkTitle',
    header: t`Framework`,
    size: 140,
  },
  {
    id: 'code',
    accessorKey: 'code',
    header: t`Code`,
    size: 110,
    cell: ({ row }): ReactElement => <span className="font-mono">{row.original.code}</span>,
  },
  {
    id: 'title',
    accessorKey: 'title',
    header: t`Requirement`,
    size: 480,
    cell: ({ row }): ReactElement => <span className="line-clamp-2">{row.original.title}</span>,
  },
  {
    id: 'assessmentName',
    accessorKey: 'assessmentName',
    header: t`Assessment`,
    size: 140,
    cell: ({ row }): ReactElement => (
      <Link
        from="/$tenantId/{-$organizationId}"
        to="compliance/assessments/$assessmentId"
        params={{ assessmentId: row.original.assessmentId }}
        className="text-primary hover:underline"
      >
        {row.original.assessmentName}
      </Link>
    ),
  },
  {
    id: 'level',
    accessorKey: 'level',
    header: t`Maturity`,
    size: 110,
    cell: ({ row }): ReactElement => <AnswerChip level={row.original.level} notApplicable={false} />,
  },
];

/** The published answers a control's value is derived from, one per linked requirement. */
export const CapabilityAssessmentEvidence: FunctionComponent<{ capabilityId: string }> = ({ capabilityId }) => {
  const trpc = useTRPC();
  const { data, isLoading } = useQuery(trpc.complianceAssessments.getControlEvidence.queryOptions({ capabilityId }));
  const rows = (data ?? []).map((evidence) => ({ ...evidence, id: evidence.requirementId }));
  const count = rows.length;

  return (
    <SectionCard
      title={(
        <span className="inline-flex items-center gap-1.5">
          <Trans>Assessment evidence · {count}</Trans>
          <InfoTooltip label={t`Which answers are listed`}>
            <Trans>The latest published answer of each requirement linked to this control. A draft assessment never appears.</Trans>
          </InfoTooltip>
        </span>
      )}
    >
      <DataPageLayout
        data={rows}
        columns={buildColumns()}
        isLoading={isLoading}
        storageKey="capability.assessmentEvidence"
        hideToolbar
        emptyState={(
          <p className="txt-sub-content text-muted-foreground">
            <Trans>No published assessment answers a requirement linked to this control.</Trans>
          </p>
        )}
      />
    </SectionCard>
  );
};

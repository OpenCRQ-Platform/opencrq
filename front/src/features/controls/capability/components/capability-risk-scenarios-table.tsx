import { Chip } from '@filigran/design-system';
import type { ColumnDefWithOptionsHeader } from '../../../../components/ui/data-table-types';
import { t } from '@lingui/core/macro';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { CapabilityRiskScenario } from '../types/capability';
import { DataPageLayout } from '../../../../components/ui/data-page-layout';
import { useTRPC } from '../../../../lib';
import { ScenarioMixturePendingLabel } from '../../../risk-scenarios/components';

export const CapabilityRiskScenariosTable = ({ capabilityId }: { capabilityId: string }) => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const { organizationId } = useParams({ strict: false });
  const { data: riskScenarios, isLoading } = useQuery(trpc.controlCapabilities.getControlCapabilityRiskScenarios.queryOptions({
    id: capabilityId,
    organizationId,
  }));
  const columns: Array<ColumnDefWithOptionsHeader<CapabilityRiskScenario, unknown>> = [
    {
      id: 'name',
      accessorKey: 'name',
      header: t`Name`,
      size: 400,
      cell: ({ row }) => (
        <span className="font-medium">{row.original.name} ({row.original.organizationName})</span>
      ),
    },
    {
      id: 'sharedTtpCount',
      accessorKey: 'sharedTtpCount',
      header: t`Shared TTP`,
      size: 120,
      cell: ({ row }) => {
        const { sharedTtpCount, mixturePending } = row.original;
        if (mixturePending) {
          return <ScenarioMixturePendingLabel />;
        }
        return <Chip label={t`${sharedTtpCount} TTP`} />;
      },
    },
  ];

  return (
    <DataPageLayout
      data={riskScenarios ?? []}
      isLoading={isLoading}
      columns={columns}
      storageKey="capability-riskScenarios"
      search={{ placeholder: t`Search risk scenarios...`, texts: (scenario) => [scenario.name, scenario.organizationName] }}
      onClickRow={(row) => {
        void navigate({
          to: '/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId',
          params: (prev) => ({
            tenantId: prev.tenantId!,
            organizationId: row.original.organizationId,
            riskScenarioId: row.original.id,
          }),
        });
      }}
    />
  );
};

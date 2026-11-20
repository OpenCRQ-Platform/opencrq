import { t } from '@lingui/core/macro';
import { createFileRoute, linkOptions, notFound, Outlet, redirect, useMatch } from '@tanstack/react-router';
import { FileX2 } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { RiskScenarioEditFocus } from '../../../../../features/risk-scenarios';
import { riskScopeHref } from '../../../../../features/organizations/scope-path-utils';
import { canRunScenario } from '../../../../../features/risk-scenarios/risk-scenario-utils';
import { RiskScenarioSimulateAction } from '../../../../../features/risk-scenarios/components/risk-scenario-simulate-action';
import { useCrqSimulationOrchestrator } from '../../../../../features/risk-scenarios/use-crq-simulation-orchestrator';
import { ErrorPage } from '../../../../../components/layout';
import { DetailPageLayout, RouteTabs } from '../../../../../components/shared';
import {
  RiskScenarioActions,
  RiskScenarioEditContext,
  RunCrqButton,
  useMissingDataItems,
  useScenarioControlRows,
} from '../../../../../features/risk-scenarios';
import { trpcClient, useTRPC } from '../../../../../lib';

const RiskScenarioNotFound = () => (
  <ErrorPage>
    <div className="relative mb-m mx-auto w-fit">
      <div className="absolute inset-0 rounded-full blur-xl bg-red/15" />
      <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-red/10">
        <FileX2 className="h-8 w-8 text-red/80" />
      </div>
    </div>
    <h1 className="mb-s">{t`Risk scenario unavailable`}</h1>
    <p className="txt-sub-content text-muted-foreground">{t`This risk scenario has been deleted or is no longer accessible.`}</p>
  </ErrorPage>
);

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId')({
  loader: async ({ params, location }) => {
    const riskScenario = await trpcClient.riskScenarios.getRiskScenario.query({ id: params.riskScenarioId });
    if (!riskScenario) {
      throw notFound();
    }
    // A scenario belongs to one risk scope, so the detail opens inside it whatever scope, or none, the
    // address named.
    if (params.organizationId !== riskScenario.organizationId) {
      throw redirect({ href: riskScopeHref(location, params.tenantId, params.organizationId, riskScenario.organizationId) });
    }
    return { riskScenario, crumb: riskScenario.name };
  },
  notFoundComponent: RiskScenarioNotFound,
  component: function RiskScenarioLayout() {
    const trpc = useTRPC();
    const { riskScenario: initialData } = Route.useLoaderData();
    const { data: scenario } = useQuery(trpc.riskScenarios.getRiskScenario.queryOptions(
      { id: initialData.id },
      { initialData },
    ));
    if (!scenario) {
      throw notFound();
    }

    const [edit, setEdit] = useState<RiskScenarioEditFocus | null>(null);
    // The comparison of two runs is a page of its own under the scenario, not one of its tabs.
    const isRunChangesPage = useMatch({ from: '/_auth/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId/changes', shouldThrow: false }) !== undefined;

    const { data: scope } = useQuery(trpc.organizations.getOrganization.queryOptions({ id: scenario.organizationId }));
    const noMappedAsset = scope?.noMappedAsset ?? false;
    const { isWhatIfStale, isMixturePending, isLoading: isLoadingControlRows } = useScenarioControlRows({
      riskScenarioId: scenario.id,
      organizationId: scenario.organizationId,
      attackOutcomeId: scenario.attackOutcome?.id ?? '',
    });
    const canRun = canRunScenario({ hasScope: scope != null, noMappedAsset, isLoadingMixture: isLoadingControlRows, isMixturePending });
    const { isRunning, isDisabled, onRun } = useCrqSimulationOrchestrator(scenario.id, { autoEnqueue: canRun });

    const staleItems = useMissingDataItems({ riskScenarioId: scenario.id, whatIfStale: isWhatIfStale, noMappedAsset });

    // Keyed on the tab an item belongs to, not on whether it carries a link: an input edited after
    // the last run has no link to offer and still leaves that tab's figures out of date.
    const warningOnThreatTab = staleItems.some((i) => i.labelKey === 'tef');
    const warningOnFinancialImpactTab = staleItems.some((i) => i.labelKey === 'loss-drivers');

    const tabs = [
      {
        key: 'overview',
        linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId', to: 'overview' }),
        label: t`Overview`,
      },
      {
        key: 'targets',
        linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId', to: 'targets' }),
        label: t`Targets`,
      },
      {
        key: 'findings',
        linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId', to: 'findings' }),
        label: t`Findings`,
      },
      {
        key: 'ttp',
        linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId', to: 'ttp' }),
        label: t`TTP`,
      },
      {
        key: 'threat',
        linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId', to: 'threat' }),
        label: t`Threat`,
        warning: warningOnThreatTab,
      },
      {
        key: 'financial-impact',
        linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId', to: 'financial-impact' }),
        label: t`Financial Impact`,
        warning: warningOnFinancialImpactTab,
      },
      {
        key: 'controls',
        linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId', to: 'controls' }),
        label: t`Controls`,
      },
      {
        key: 'crq',
        linkOption: linkOptions({ from: '/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId', to: 'crq' }),
        label: t`CRQ`,
      },
    ];

    if (isRunChangesPage) {
      return <Outlet />;
    }

    return (
      <DetailPageLayout
        title={scenario.name}
        actions={
          <div className="flex items-center gap-2">
            <RiskScenarioSimulateAction riskScenarioId={scenario.id} />
            <RiskScenarioActions riskScenario={scenario} edit={edit} onEditChange={setEdit} />
            <RunCrqButton
              isRunning={isRunning}
              isDisabled={isDisabled || !canRun}
              onRun={onRun}
            />
          </div>
        }
      >
        <RouteTabs tabs={tabs} />
        <RiskScenarioEditContext value={() => setEdit('primaryAssetIds')}>
          <Outlet />
        </RiskScenarioEditContext>
      </DetailPageLayout>
    );
  },
});

import { CHANGE_TABS } from '@app/module/client';
import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import { RunChangesPage } from '../../../../../../features/risk-scenarios';
import { useTRPC } from '../../../../../../lib';
import { Route as RiskScenarioRoute } from '../$riskScenarioId';

const runChangesSearchSchema = z.object({
  before: z.uuid().optional().catch(undefined),
  after: z.uuid().optional().catch(undefined),
  tab: z.enum(CHANGE_TABS).default('ale').catch('ale'),
});

const RunChangesRoutePage = () => {
  const trpc = useTRPC();
  const { riskScenario: initialData } = RiskScenarioRoute.useLoaderData();
  const { data: riskScenario } = useQuery(trpc.riskScenarios.getRiskScenario.queryOptions({ id: initialData.id }, { initialData }));
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  if (!riskScenario) {
    return null;
  }
  return (
    <RunChangesPage
      riskScenario={riskScenario}
      firstRunId={search.before}
      secondRunId={search.after}
      tab={search.tab}
      onCompare={(before, after) => navigate({ search: (previous) => ({ ...previous, before, after }), replace: true })}
      onTabChange={(tab) => navigate({ search: (previous) => ({ ...previous, tab }), replace: true })}
    />
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId/changes')({
  validateSearch: runChangesSearchSchema,
  loader: () => ({ crumb: t`What changed` }),
  component: RunChangesRoutePage,
});

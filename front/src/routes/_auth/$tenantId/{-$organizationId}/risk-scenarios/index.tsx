import { createFileRoute, stripSearchParams } from '@tanstack/react-router';
import { RISK_SCOPE_LIST_SEARCH_DEFAULTS, riskScopeListSearchSchema } from '../../../../../features/organizations/risk-scope-list-search';
import { PerimeterEmptyCard, RiskScenariosDataTable } from '../../../../../features';

const RouteComponent = () => {
  const { organizationId } = Route.useParams();

  if (organizationId !== undefined) {
    return <RiskScenariosDataTable organizationId={organizationId} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <PerimeterEmptyCard />
      <RiskScenariosDataTable />
    </div>
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/risk-scenarios/')({
  validateSearch: riskScopeListSearchSchema,
  search: { middlewares: [stripSearchParams(RISK_SCOPE_LIST_SEARCH_DEFAULTS)] },
  component: RouteComponent,
});

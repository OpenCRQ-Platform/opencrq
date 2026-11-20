import { createFileRoute, stripSearchParams } from '@tanstack/react-router';
import { RISK_SCOPE_LIST_SEARCH_DEFAULTS, riskScopeListSearchSchema } from '../../../../../features/organizations/risk-scope-list-search';
import { TreatmentPlansDataTable } from '../../../../../features';

const RouteComponent = () => {
  const { organizationId } = Route.useParams();
  return <TreatmentPlansDataTable organizationId={organizationId} />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/treatment-plans/')({
  validateSearch: riskScopeListSearchSchema,
  search: { middlewares: [stripSearchParams(RISK_SCOPE_LIST_SEARCH_DEFAULTS)] },
  component: RouteComponent,
});

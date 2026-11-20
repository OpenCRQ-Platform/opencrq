import { createFileRoute, stripSearchParams } from '@tanstack/react-router';
import { RISK_SCOPE_LIST_SEARCH_DEFAULTS, riskScopeListSearchSchema } from '../../../../../features/organizations/risk-scope-list-search';
import { BudgetReviewsDataTable } from '../../../../../features';

const RouteComponent = () => {
  const { organizationId } = Route.useParams();
  return <BudgetReviewsDataTable organizationId={organizationId} />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/budget-reviews/')({
  validateSearch: riskScopeListSearchSchema,
  search: { middlewares: [stripSearchParams(RISK_SCOPE_LIST_SEARCH_DEFAULTS)] },
  component: RouteComponent,
});

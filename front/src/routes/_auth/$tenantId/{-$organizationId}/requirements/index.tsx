import { createFileRoute, stripSearchParams } from '@tanstack/react-router';
import { RequirementsDataTable } from '../../../../../features';
import { REQUIREMENTS_LIST_SEARCH_DEFAULTS, requirementsListSearchSchema } from '../../../../../features/requirements/requirements-list-search';

const RouteComponent = () => {
  const { organizationId } = Route.useParams();
  return organizationId === undefined ? null : <RequirementsDataTable organizationId={organizationId} />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/requirements/')({
  validateSearch: requirementsListSearchSchema,
  search: { middlewares: [stripSearchParams(REQUIREMENTS_LIST_SEARCH_DEFAULTS)] },
  component: RouteComponent,
});

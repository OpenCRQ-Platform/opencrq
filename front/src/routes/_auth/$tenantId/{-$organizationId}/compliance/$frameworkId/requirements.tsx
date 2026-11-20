import { t } from '@lingui/core/macro';
import { createFileRoute, stripSearchParams } from '@tanstack/react-router';
import {
  DRATA_REQUIREMENTS_LIST_SEARCH_DEFAULTS,
  drataRequirementsListSearchSchema,
} from '../../../../../../features/drata/drata-requirements-list-search';
import { DrataRequirementsTable } from '../../../../../../features/drata';

const RouteComponent = () => {
  const { frameworkId } = Route.useParams();
  return <DrataRequirementsTable frameworkId={frameworkId} />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/compliance/$frameworkId/requirements')({
  validateSearch: drataRequirementsListSearchSchema,
  search: { middlewares: [stripSearchParams(DRATA_REQUIREMENTS_LIST_SEARCH_DEFAULTS)] },
  loader: () => ({ crumb: t`Requirements` }),
  component: RouteComponent,
});

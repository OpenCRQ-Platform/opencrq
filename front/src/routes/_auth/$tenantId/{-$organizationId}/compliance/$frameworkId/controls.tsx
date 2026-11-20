import { t } from '@lingui/core/macro';
import { createFileRoute, stripSearchParams } from '@tanstack/react-router';
import {
  DRATA_CONTROLS_LIST_SEARCH_DEFAULTS,
  drataControlsListSearchSchema,
} from '../../../../../../features/drata/drata-controls-list-search';
import { DrataControlsTable } from '../../../../../../features/drata';

const RouteComponent = () => {
  const { frameworkId } = Route.useParams();
  return <DrataControlsTable frameworkId={frameworkId} />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/compliance/$frameworkId/controls')({
  validateSearch: drataControlsListSearchSchema,
  search: { middlewares: [stripSearchParams(DRATA_CONTROLS_LIST_SEARCH_DEFAULTS)] },
  loader: () => ({ crumb: t`Controls` }),
  component: RouteComponent,
});

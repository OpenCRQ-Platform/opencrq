import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { GlobalSearchPage } from '../../../../features/global-search';
import { urlSearchText } from '../../../../utils';

const RouteComponent = () => {
  const { tenantId } = Route.useParams();
  const { search } = Route.useSearch();
  return <GlobalSearchPage tenantId={tenantId} search={search.trim()} />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/search')({
  validateSearch: z.object({ search: urlSearchText }),
  loader: () => ({ crumb: t`Search` }),
  component: RouteComponent,
});

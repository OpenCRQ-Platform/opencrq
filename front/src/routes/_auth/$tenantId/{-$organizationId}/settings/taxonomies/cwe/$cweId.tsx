import { createFileRoute } from '@tanstack/react-router';
import { CweDetailPage } from '../../../../../../../features';

const RouteComponent = () => {
  const { cweId } = Route.useParams();
  return <CweDetailPage cweId={cweId} />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/taxonomies/cwe/$cweId')({
  loader: ({ params }) => ({ crumb: params.cweId }),
  component: RouteComponent,
});

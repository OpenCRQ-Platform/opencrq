import { createFileRoute } from '@tanstack/react-router';
import { FileStorageDataTable } from '../../../../../../features';

const RouteComponent = () => <FileStorageDataTable />;

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/file-storage/')({
  component: RouteComponent,
});

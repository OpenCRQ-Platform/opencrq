import { createFileRoute, stripSearchParams } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { NOTIFICATIONS_LIST_SEARCH_DEFAULTS, notificationsListSearchSchema } from '../../../../../features/notifications/notifications-list-search';
import { NotificationsPage } from '../../../../../features';

const RouteComponent: FunctionComponent = () => (
  <NotificationsPage />
);

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/notifications/')({
  validateSearch: notificationsListSearchSchema,
  search: { middlewares: [stripSearchParams(NOTIFICATIONS_LIST_SEARCH_DEFAULTS)] },
  component: RouteComponent,
});

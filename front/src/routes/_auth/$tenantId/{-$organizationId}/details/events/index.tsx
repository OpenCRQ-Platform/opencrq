import { createFileRoute } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { ScopeEvents } from '../../../../../../features';

const ScopeEventsPage: FunctionComponent = () => {
  const { organizationId } = Route.useParams();

  if (organizationId === undefined) {
    return null;
  }

  return <ScopeEvents organizationId={organizationId} />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/details/events/')({
  component: ScopeEventsPage,
});

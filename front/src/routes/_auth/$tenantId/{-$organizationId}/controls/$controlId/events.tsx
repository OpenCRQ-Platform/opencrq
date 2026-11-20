import { createFileRoute } from '@tanstack/react-router';
import { t } from '@lingui/core/macro';
import { CapabilityEvents } from '../../../../../../features/controls/capability/components/capability-events';
import { Route as ControlRoute } from './route';

const CapabilityEventsPage = () => {
  const { capability } = ControlRoute.useLoaderData();
  return <CapabilityEvents capabilityId={capability.id} />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/controls/$controlId/events')({
  loader: () => ({ crumb: t`Events` }),
  component: CapabilityEventsPage,
});

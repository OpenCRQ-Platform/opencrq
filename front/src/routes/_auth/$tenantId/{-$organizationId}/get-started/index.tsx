import { createFileRoute } from '@tanstack/react-router';
import { GetStartedPage } from '../../../../../features/onboarding';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/get-started/')({
  component: GetStartedPage,
});

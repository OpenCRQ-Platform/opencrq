import { createFileRoute, useNavigate } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { DeclaredEstateTabContent } from '../../../../../../features';
import { tabForAction } from '../../../../../../features/organizations/scope-drawer-tabs';

const DeclaredEstatePage: FunctionComponent = () => {
  const { organizationId } = Route.useParams();
  const navigate = useNavigate();

  if (organizationId === undefined) {
    return null;
  }

  return (
    <DeclaredEstateTabContent
      organizationId={organizationId}
      onAnswerQuestionnaire={() => {
        void navigate({ to: '.', search: (prev) => ({ ...prev, scopeDrawerTab: tabForAction('declare-estate') }), replace: true });
      }}
    />
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/details/declared-estate/')({
  component: DeclaredEstatePage,
});

import { createFileRoute, useNavigate } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { FinancialProfileTabContent } from '../../../../../../features';
import { tabForAction } from '../../../../../../features/organizations/scope-drawer-tabs';

const FinancialProfilePage: FunctionComponent = () => {
  const { organizationId } = Route.useParams();
  const navigate = useNavigate();

  if (organizationId === undefined) {
    return null;
  }

  return (
    <FinancialProfileTabContent
      organizationId={organizationId}
      onAnswerQuestionnaire={() => {
        void navigate({ to: '.', search: (prev) => ({ ...prev, scopeDrawerTab: tabForAction('answer-questionnaire') }), replace: true });
      }}
    />
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/details/financial-profile/')({
  component: FinancialProfilePage,
});

import { useNavigate } from '@tanstack/react-router';

export const useOpenScopeWizard = (): () => void => {
  const navigate = useNavigate();
  return () => {
    void navigate({
      to: '/$tenantId/{-$organizationId}/risk-scopes/create',
      params: (prev) => ({ ...prev, tenantId: prev.tenantId! }),
    });
  };
};

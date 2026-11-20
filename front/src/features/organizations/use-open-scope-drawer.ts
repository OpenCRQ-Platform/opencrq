import { useNavigate } from '@tanstack/react-router';
import type { ScopeDrawerAction } from './scope-drawer-tabs';
import { tabForAction } from './scope-drawer-tabs';

/**
 * Sends the reader to the risk scope's own details page with the drawer open on the tab the action
 * asks for. Surfaces outside that page must not mount the drawer themselves: the estate they edit
 * belongs to the scope, not to the list they were reading.
 */
export const useOpenScopeDrawer = (): (organizationId: string, action: ScopeDrawerAction) => void => {
  const navigate = useNavigate();
  return (organizationId, action) => {
    void navigate({
      to: '/$tenantId/{-$organizationId}/details/overview',
      params: (prev) => ({ ...prev, tenantId: prev.tenantId!, organizationId }),
      search: { scopeDrawerTab: tabForAction(action) },
    });
  };
};

import { Header as FdsHeader, HeaderGroup } from '@filigran/design-system';
import type { FunctionComponent } from 'react';
import { NotificationBell } from '../../features/notifications';
import { AskAriane, CtemCommandCenterButton } from '../../features/xtm-one';
import { useOptionalTenant } from '../../providers';
import { Route } from '../../routes/_auth/route';
import { ScopeSlot } from './scope-slot';
import { UserProfileMenu } from './user-profile-menu';

export const Header: FunctionComponent = () => {
  const ctx = Route.useRouteContext();
  const tenantContext = useOptionalTenant();

  return (
    <FdsHeader className="shrink-0">
      <ScopeSlot />
      <HeaderGroup>
        <AskAriane firstName={(ctx.auth.user.name?.trim() || ctx.auth.user.email).split('@')[0].split(/\s+/)[0]} />
        <CtemCommandCenterButton />
        <NotificationBell />
        <UserProfileMenu auth={ctx.auth} tenantId={tenantContext?.tenantId} />
      </HeaderGroup>
    </FdsHeader>
  );
};

import { Header as FdsHeader, HeaderGroup } from '@filigran/design-system';
import type { FunctionComponent } from 'react';
import { NotificationBell } from '../../features/notifications';
import { AskAriane, CtemCommandCenterButton, useXtmOneSettings } from '../../features/xtm-one';
import { useOptionalTenant } from '../../providers';
import { Route } from '../../routes/_auth/route';
import { UserProfileMenu } from './user-profile-menu';

export const Header: FunctionComponent = () => {
  const ctx = Route.useRouteContext();
  const tenantContext = useOptionalTenant();
  const { data: xtmOneSettings } = useXtmOneSettings();
  const xtmOneConfigured = xtmOneSettings?.configured === true;

  return (
    <FdsHeader className="shrink-0">
      <HeaderGroup />
      {/* The AI cluster, then the platform actions behind the leading rule, as in OpenAEV and OpenCTI. */}
      <HeaderGroup>
        {xtmOneConfigured && (
          <>
            <AskAriane firstName={(ctx.auth.user.name?.trim() || ctx.auth.user.email).split('@')[0].split(/\s+/)[0]} />
            <CtemCommandCenterButton />
          </>
        )}
        <HeaderGroup separatorBefore={xtmOneConfigured}>
          <NotificationBell />
          <UserProfileMenu auth={ctx.auth} tenantId={tenantContext?.tenantId} />
        </HeaderGroup>
      </HeaderGroup>
    </FdsHeader>
  );
};

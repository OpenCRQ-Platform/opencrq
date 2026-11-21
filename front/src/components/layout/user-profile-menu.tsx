import { Icon, IconButton, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@filigran/design-system';
import { Link } from '@tanstack/react-router';
import type { FunctionComponent } from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { AuthContextType } from '../../features/auth/auth-context';
import { AccountCircleOutlinedIcon } from '../shared/top-bar-icons';

interface UserProfileMenuProps {
  auth: Extract<AuthContextType, { status: 'logged-in' }>,
  tenantId?: string,
}

export const UserProfileMenu: FunctionComponent<UserProfileMenuProps> = ({ auth, tenantId }) => {
  const { user } = auth;

  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton
          priority="tertiary"
          aria-label={t`Account`}
          icon={<AccountCircleOutlinedIcon />}
        />
      </MenuTrigger>
      <MenuContent align="end">
        <MenuLabel>{user.email}</MenuLabel>
        {tenantId && (
          <MenuItem asChild startIcon={<Icon name="user" size={16} />}>
            <Link to="/$tenantId/{-$organizationId}/profile" params={(prev) => ({ ...prev, tenantId })}>
              <Trans>Profile</Trans>
            </Link>
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuItem
          startIcon={<Icon name="log-out" size={16} />}
          onSelect={async () => {
            await auth.logout();
          }}
        >
          <Trans>Sign out</Trans>
        </MenuItem>
      </MenuContent>
    </Menu>
  );
};

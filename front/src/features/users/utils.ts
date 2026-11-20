import { t } from '@lingui/core/macro';

export const userDetailHref = (pathname: string, userId: string, searchStr = ''): string => `${pathname}/${userId}${searchStr}`;

export const getInitials = (name: string | null, email: string): string => {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    }
    return parts[0].slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
};

// Not a group: XTM One grants the status, so it is shown beside the groups, never edited here.
const SUPER_ADMINISTRATOR_TAG_ID = 'super-administrator';

/** A user's groups, with XTM One's super administrator status shown as one more tag. */
export const withSuperAdministratorTag = (
  groups: ReadonlyArray<{ id: string, name: string }>,
  isSuperAdmin: boolean,
): Array<{ id: string, name: string }> => (isSuperAdmin ? [...groups, { id: SUPER_ADMINISTRATOR_TAG_ID, name: t`Super Administrator` }] : [...groups]);

interface CapabilityGrant {
  capabilityId: string,
  capabilityName: string,
}

interface GroupGrant extends CapabilityGrant {
  roleId: string,
  roleName: string,
  groupId: string,
  groupName: string,
}

/**
 * A capability a user holds, and what grants it: a role of one of the user's groups, which an
 * administrator edits, or the super administrator status XTM One sets at sign-in, which no role or
 * group carries. A super administrator's row keeps the group and role fields, null.
 */
export type EffectivePermission =
  | GroupGrant & { grantedBy: 'group' }
  | CapabilityGrant & { grantedBy: 'super_administrator', roleId: null, roleName: null, groupId: null, groupName: null };

export const withGrantProvenance = (
  groupGrants: Array<GroupGrant>,
  superAdministratorGrants: Array<CapabilityGrant>,
): Array<EffectivePermission> => [
  ...groupGrants.map((grant) => ({ ...grant, grantedBy: 'group' as const })),
  ...superAdministratorGrants.map(({ capabilityId, capabilityName }) => ({
    capabilityId,
    capabilityName,
    grantedBy: 'super_administrator' as const,
    roleId: null,
    roleName: null,
    groupId: null,
    groupName: null,
  })),
];

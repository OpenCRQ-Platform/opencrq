interface GroupGrantRow {
  grantedBy?: 'group',
  capabilityId: string,
  capabilityName: string,
  roleId: string,
  roleName: string,
  groupId: string,
  groupName: string,
}

interface SuperAdministratorGrantRow {
  grantedBy: 'super_administrator',
  capabilityId: string,
  capabilityName: string,
}

/** A service account's rows carry no `grantedBy`: a role of one of its groups is all that grants it a capability. */
export type EffectivePermissionRow = GroupGrantRow | SuperAdministratorGrantRow;

export type Provenance =
  | { kind: 'group', groupId: string, groupName: string, roleId: string, roleName: string }
  | { kind: 'super_administrator' };

export const provenanceKey = (provenance: Provenance): string =>
  provenance.kind === 'group' ? `${provenance.groupId}:${provenance.roleId}` : provenance.kind;

const rowProvenance = (row: EffectivePermissionRow): Provenance => (row.grantedBy === 'super_administrator'
  ? { kind: 'super_administrator' }
  : { kind: 'group', groupId: row.groupId, groupName: row.groupName, roleId: row.roleId, roleName: row.roleName });

/** What grants each capability, the super administrator status first, each group and role once. */
export const provenanceByCapability = (rows: Array<EffectivePermissionRow>): Map<string, Array<Provenance>> => {
  const byCapability = new Map<string, Array<Provenance>>();
  for (const row of rows) {
    const entries = byCapability.get(row.capabilityId) ?? [];
    const provenance = rowProvenance(row);
    const key = provenanceKey(provenance);
    if (!entries.some((entry) => provenanceKey(entry) === key)) {
      if (provenance.kind === 'super_administrator') {
        entries.unshift(provenance);
      } else {
        entries.push(provenance);
      }
    }
    byCapability.set(row.capabilityId, entries);
  }
  return byCapability;
};

export const summarizeEffectivePermissions = (rows: Array<EffectivePermissionRow>) => {
  const groupIds = new Set<string>();
  const roleIds = new Set<string>();
  let superAdministrator = false;
  for (const row of rows) {
    if (row.grantedBy === 'super_administrator') {
      superAdministrator = true;
    } else {
      groupIds.add(row.groupId);
      roleIds.add(row.roleId);
    }
  }
  return {
    grantedCount: new Set(rows.map((row) => row.capabilityId)).size,
    groupCount: groupIds.size,
    roleCount: roleIds.size,
    superAdministrator,
  };
};

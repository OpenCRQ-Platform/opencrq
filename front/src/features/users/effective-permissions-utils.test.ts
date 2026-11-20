import { describe, expect, it } from 'vitest';
import type { EffectivePermissionRow } from './effective-permissions-utils';
import { provenanceByCapability, summarizeEffectivePermissions } from './effective-permissions-utils';

const viaGroup = (capabilityId: string, groupId: string, roleId: string): EffectivePermissionRow => ({
  grantedBy: 'group', capabilityId, capabilityName: capabilityId, groupId, groupName: `Group ${groupId}`, roleId, roleName: `Role ${roleId}`,
});

const asSuperAdministrator = (capabilityId: string): EffectivePermissionRow => ({
  grantedBy: 'super_administrator', capabilityId, capabilityName: capabilityId,
});

describe('provenanceByCapability', () => {
  it('should list each group and role granting a capability once', () => {
    const provenance = provenanceByCapability([viaGroup('c1', 'g1', 'r1'), viaGroup('c1', 'g1', 'r1'), viaGroup('c1', 'g2', 'r1')]);

    expect(provenance.get('c1')).toEqual([
      { kind: 'group', groupId: 'g1', groupName: 'Group g1', roleId: 'r1', roleName: 'Role r1' },
      { kind: 'group', groupId: 'g2', groupName: 'Group g2', roleId: 'r1', roleName: 'Role r1' },
    ]);
  });

  it('should put the super administrator grant before the groups that also grant the capability', () => {
    const provenance = provenanceByCapability([viaGroup('c1', 'g1', 'r1'), asSuperAdministrator('c1'), asSuperAdministrator('c2')]);

    expect(provenance.get('c1')?.map((entry) => entry.kind)).toEqual(['super_administrator', 'group']);
    expect(provenance.get('c2')).toEqual([{ kind: 'super_administrator' }]);
  });

  it('should read a row without a grant source as a group grant, as a service account has', () => {
    const serviceAccountRow = { capabilityId: 'c1', capabilityName: 'c1', groupId: 'g1', groupName: 'Group g1', roleId: 'r1', roleName: 'Role r1' };

    expect(provenanceByCapability([serviceAccountRow]).get('c1')).toEqual([
      { kind: 'group', groupId: 'g1', groupName: 'Group g1', roleId: 'r1', roleName: 'Role r1' },
    ]);
  });
});

describe('summarizeEffectivePermissions', () => {
  it('should count a super administrator with no group as holding every capability through no group or role', () => {
    expect(summarizeEffectivePermissions([asSuperAdministrator('c1'), asSuperAdministrator('c2')])).toEqual({
      grantedCount: 2, groupCount: 0, roleCount: 0, superAdministrator: true,
    });
  });

  it('should count a capability granted twice once, and only the groups and roles of group grants', () => {
    expect(summarizeEffectivePermissions([asSuperAdministrator('c1'), viaGroup('c1', 'g1', 'r1'), viaGroup('c2', 'g2', 'r2')])).toEqual({
      grantedCount: 2, groupCount: 2, roleCount: 2, superAdministrator: true,
    });
  });

  it('should leave an ordinary user unchanged', () => {
    expect(summarizeEffectivePermissions([viaGroup('c1', 'g1', 'r1'), viaGroup('c2', 'g1', 'r1')])).toEqual({
      grantedCount: 2, groupCount: 1, roleCount: 1, superAdministrator: false,
    });
  });
});

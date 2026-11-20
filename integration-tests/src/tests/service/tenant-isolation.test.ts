import type { EventOrigin } from '@app/module';
import {
  assetEvidence,
  assetEvidenceHistory,
  assetEvidenceSources,
  assetEvidenceSourceSoftware,
  AttackOutcome_DataBreachResale,
  Capability_ManageSecurity,
  deriveSeedId,
  riskScenarios,
  supportingAssetTags,
  tags,
  TECHNIQUE_T1027,
  tenants,
} from '@app/module';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createAdminUser, createTenant, createTenantUser } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('Multi-tenant Isolation', () => {
  let adminUserId: string;
  let tenantAId: string;
  let tenantBId: string;
  let userAOrigin: EventOrigin;
  let userBOrigin: EventOrigin;
  let userBId: string;

  beforeEach(async () => {
    await truncateAllTables(db);

    // Create admin and two tenants
    const admin = await createAdminUser(services);
    adminUserId = admin.userId;

    tenantAId = await createTenant(services, adminUserId);
    tenantBId = await createTenant(services, adminUserId);

    // Create a separate user for each tenant
    const userA = await createTenantUser(
      services, db,
      { type: 'client', userId: adminUserId, tenantId: tenantAId },
    );
    const userB = await createTenantUser(
      services, db,
      { type: 'client', userId: adminUserId, tenantId: tenantBId },
    );

    userAOrigin = userA.origin;
    userBOrigin = userB.origin;
    userBId = userB.userId;
  });

  describe('organizations isolation', () => {
    it('should not allow user A to see organizations in tenant B', async () => {
      // Create org in Tenant A
      const orgAId = uuidv7();
      await services.withOrigin(userAOrigin).organizations.createOrganizations([
        { id: orgAId, name: 'Org A' },
      ]);

      // Create org in Tenant B
      const orgBId = uuidv7();
      await services.withOrigin(userBOrigin).organizations.createOrganizations([
        { id: orgBId, name: 'Org B' },
      ]);

      // User A can see only Org A
      const orgsSeenByA = await services.withOrigin(userAOrigin).organizations.getOrganizations();
      expect(orgsSeenByA).toHaveLength(1);
      expect(orgsSeenByA[0].id).toBe(orgAId);

      // User B can see only Org B
      const orgsSeenByB = await services.withOrigin(userBOrigin).organizations.getOrganizations();
      expect(orgsSeenByB).toHaveLength(1);
      expect(orgsSeenByB[0].id).toBe(orgBId);
    });

    it('should reject creating an organization for another tenant', async () => {
      // tenantId is injected from origin, so the org is always created in User A's tenant.
      // ProtectedDB's create policy also rejects cross-tenant writes.
      const orgId = uuidv7();
      await services.withOrigin(userAOrigin).organizations.createOrganizations([
        { id: orgId, name: 'My Org' },
      ]);

      // Verify it's only visible in tenant A
      const orgsInB = await services.withOrigin(userBOrigin).organizations.getOrganizations();
      expect(orgsInB.find((o) => o.id === orgId)).toBeUndefined();
    });
  });

  describe('risk scope estate mapping isolation', () => {
    const createAsset = async (origin: EventOrigin) => {
      const assetId = uuidv7();
      await services.withOrigin(origin).supportingAssets.createSupportingAsset({
        id: assetId, name: 'Asset', description: null, ownerId: null, exposure: 'unknown', categoryId: 'host',
      });
      return assetId;
    };

    /** The mapping is never listed by id: what a scope maps is what its estate reader answers. */
    const mappedAssetIds = async (origin: EventOrigin, organizationId: string) =>
      (await services.withOrigin(origin).supportingAssets.listSupportingAssets({
        page: 1,
        limit: 50,
        search: null,
        source: null,
        mappedToOrganizationId: organizationId,
        membershipOrganizationId: null,
        sortBy: 'name',
        sortDesc: false,
      })).items.map((asset) => asset.id);

    const createClosedScopeWithAsset = async (origin: EventOrigin) => {
      const assetId = await createAsset(origin);
      const organizationId = uuidv7();
      await services.withOrigin(origin).organizations.createOrganizations([
        { id: organizationId, name: 'Closed scope', estateMode: 'closed', mappedAssetIds: [assetId] },
      ]);
      return { organizationId, assetId };
    };

    it('should not let user B read the mapping of a scope in tenant A', async () => {
      const { organizationId } = await createClosedScopeWithAsset(userAOrigin);

      expect(await mappedAssetIds(userAOrigin, organizationId)).toHaveLength(1);
      expect(await mappedAssetIds(userBOrigin, organizationId)).toHaveLength(0);
    });

    it('should not let user B write the mapping of a scope in tenant A', async () => {
      const { organizationId, assetId } = await createClosedScopeWithAsset(userAOrigin);

      // The scope does not exist for user B, so the write is refused before it can remove anything.
      await expect(services.withOrigin(userBOrigin).organizations.updateOrganization(organizationId, {
        mapping: { added: [], removed: [assetId] },
      })).rejects.toThrow('Risk scope not found');

      expect(await mappedAssetIds(userAOrigin, organizationId)).toEqual([assetId]);
    });

    it('should refuse a scope of tenant A mapping an asset of tenant B', async () => {
      const { organizationId, assetId } = await createClosedScopeWithAsset(userAOrigin);
      const assetOfB = await createAsset(userBOrigin);

      await expect(services.withOrigin(userAOrigin).organizations.updateOrganization(organizationId, {
        mapping: { added: [assetOfB], removed: [] },
      })).rejects.toThrow('Access Denied');

      expect(await mappedAssetIds(userAOrigin, organizationId)).toEqual([assetId]);
    });

    it('should refuse a scope born mapping an asset of another tenant', async () => {
      const assetOfB = await createAsset(userBOrigin);
      const organizationId = uuidv7();

      await expect(services.withOrigin(userAOrigin).organizations.createOrganizations([
        { id: organizationId, name: 'Closed scope', estateMode: 'closed', mappedAssetIds: [assetOfB] },
      ])).rejects.toThrow('Access Denied');

      expect(await services.withOrigin(userAOrigin).organizations.getOrganization(organizationId)).toBeUndefined();
    });

    it('should not count another tenant\'s mapping on the scope listing', async () => {
      await createClosedScopeWithAsset(userAOrigin);
      await services.withOrigin(userBOrigin).organizations.createOrganizations([
        { id: uuidv7(), name: 'Scope B' },
      ]);

      const scopesSeenByB = await services.withOrigin(userBOrigin).organizations.getOrganizations();
      expect(scopesSeenByB).toHaveLength(1);
      expect(scopesSeenByB[0].mappedAssetCount).toBe(0);
    });

    it('should let two scopes of the same tenant map the same asset', async () => {
      const { assetId } = await createClosedScopeWithAsset(userAOrigin);
      const secondScopeId = uuidv7();
      await services.withOrigin(userAOrigin).organizations.createOrganizations([
        { id: secondScopeId, name: 'Second closed scope', estateMode: 'closed', mappedAssetIds: [assetId] },
      ]);

      expect(await mappedAssetIds(userAOrigin, secondScopeId)).toEqual([assetId]);
    });
  });

  describe('references across tenants', () => {
    const FOREIGN_KEY_VIOLATION = '23503';

    const createScope = async (origin: EventOrigin) => {
      const organizationId = uuidv7();
      await services.withOrigin(origin).organizations.createOrganizations([{ id: organizationId, name: 'Scope' }]);
      return organizationId;
    };

    const createScenario = (origin: EventOrigin, organizationId: string, attackOutcomeId: string) =>
      services.withOrigin(origin).riskScenarios.createRiskScenario({
        id: uuidv7(), organizationId, name: 'Scenario', description: null, attackOutcomeId, primaryAssetIds: [],
      });

    const deleteTenantB = () => services.withOrigin({ type: 'platform', userId: adminUserId }).tenants.deleteTenants([tenantBId]);

    it('should refuse a scenario naming another tenant\'s attack outcome, as it refuses an unknown one', async () => {
      const organizationId = await createScope(userAOrigin);

      await expect(createScenario(userAOrigin, organizationId, deriveSeedId(tenantBId, AttackOutcome_DataBreachResale)))
        .rejects.toThrow('The attack outcome does not belong to this tenant');
      await expect(createScenario(userAOrigin, organizationId, uuidv7()))
        .rejects.toThrow('The attack outcome does not belong to this tenant');
      expect(await db.select().from(riskScenarios)).toHaveLength(0);
    });

    it('should still delete a tenant whose attack outcome another tenant tried to name', async () => {
      const organizationId = await createScope(userAOrigin);
      await expect(createScenario(userAOrigin, organizationId, deriveSeedId(tenantBId, AttackOutcome_DataBreachResale))).rejects.toThrow();

      await deleteTenantB();

      expect(await db.select().from(tenants).where(eq(tenants.id, tenantBId))).toHaveLength(0);
    });

    it('should refuse a scenario in another tenant\'s risk scope', async () => {
      const foreignScopeId = await createScope(userBOrigin);

      await expect(createScenario(userAOrigin, foreignScopeId, deriveSeedId(tenantAId, AttackOutcome_DataBreachResale)))
        .rejects.toThrow('The risk scope does not belong to this tenant');
      expect(await db.select().from(riskScenarios)).toHaveLength(0);
    });

    it('should refuse in the database a scenario whose outcome belongs to another tenant than its scope', async () => {
      const organizationId = await createScope(userAOrigin);

      await expect(db.insert(riskScenarios).values({
        id: uuidv7(), tenantId: tenantAId, organizationId, name: 'Scenario', attackOutcomeId: deriveSeedId(tenantBId, AttackOutcome_DataBreachResale),
      })).rejects.toMatchObject({ cause: { code: FOREIGN_KEY_VIOLATION, constraint: 'risk_scenarios_attack_outcome_tenant_fk' } });
      await expect(db.insert(riskScenarios).values({
        id: uuidv7(), tenantId: tenantBId, organizationId, name: 'Scenario', attackOutcomeId: deriveSeedId(tenantBId, AttackOutcome_DataBreachResale),
      })).rejects.toMatchObject({ cause: { code: FOREIGN_KEY_VIOLATION, constraint: 'risk_scenarios_organization_tenant_fk' } });
    });

    const createFinding = async (origin: EventOrigin, tenantId: string) => {
      const supportingAssetId = uuidv7();
      await services.withOrigin(origin).supportingAssets.createSupportingAsset({
        id: supportingAssetId, name: 'Asset', description: null, ownerId: null, exposure: 'unknown', categoryId: 'host',
      });
      const assetEvidenceId = uuidv7();
      await db.insert(assetEvidence).values({
        id: assetEvidenceId, supportingAssetId, tenantId, mitreTechniqueId: TECHNIQUE_T1027, expectationType: 'prevention',
      });
      return assetEvidenceId;
    };

    it('should refuse in the database a finding history row filed under another tenant than its finding', async () => {
      const assetEvidenceId = await createFinding(userAOrigin, tenantAId);

      await expect(db.insert(assetEvidenceHistory).values({
        id: uuidv7(), tenantId: tenantBId, assetEvidenceId, stateChangedAt: new Date(), state: 'dismissed', origin: 'not_exposed',
      })).rejects.toMatchObject({ cause: { code: FOREIGN_KEY_VIOLATION, constraint: 'asset_evidence_history_evidence_tenant_fk' } });
    });

    it('should refuse in the database a finding source filed under another tenant than its finding', async () => {
      const assetEvidenceId = await createFinding(userAOrigin, tenantAId);

      await expect(db.insert(assetEvidenceSources).values({ id: uuidv7(), tenantId: tenantBId, assetEvidenceId }))
        .rejects.toMatchObject({ cause: { code: FOREIGN_KEY_VIOLATION, constraint: 'asset_evidence_sources_evidence_tenant_fk' } });
    });

    it('should refuse in the database a source\'s software filed under another tenant than its source', async () => {
      const assetEvidenceSourceId = uuidv7();
      await db.insert(assetEvidenceSources).values({ id: assetEvidenceSourceId, tenantId: tenantAId, assetEvidenceId: await createFinding(userAOrigin, tenantAId) });

      await expect(db.insert(assetEvidenceSourceSoftware).values({ id: uuidv7(), tenantId: tenantBId, assetEvidenceSourceId, name: 'openssl', version: '3.0.1' }))
        .rejects.toMatchObject({ cause: { code: FOREIGN_KEY_VIOLATION, constraint: 'asset_evidence_source_software_source_fk' } });
    });

    const createAssetAndTag = async (origin: EventOrigin, tenantId: string) => {
      const supportingAssetId = uuidv7();
      await services.withOrigin(origin).supportingAssets.createSupportingAsset({
        id: supportingAssetId, name: 'Asset', description: null, ownerId: null, exposure: 'unknown', categoryId: 'host',
      });
      const tagId = uuidv7();
      await db.insert(tags).values({ id: tagId, tenantId, name: 'production' });
      return { supportingAssetId, tagId };
    };

    it('should refuse in the database a tag link naming another tenant\'s asset or tag', async () => {
      const own = await createAssetAndTag(userAOrigin, tenantAId);
      const foreign = await createAssetAndTag(userBOrigin, tenantBId);

      await expect(db.insert(supportingAssetTags).values({ id: uuidv7(), tenantId: tenantAId, supportingAssetId: own.supportingAssetId, tagId: foreign.tagId }))
        .rejects.toMatchObject({ cause: { code: FOREIGN_KEY_VIOLATION, constraint: 'supporting_asset_tags_tag_tenant_fk' } });
      await expect(db.insert(supportingAssetTags).values({ id: uuidv7(), tenantId: tenantAId, supportingAssetId: foreign.supportingAssetId, tagId: own.tagId }))
        .rejects.toMatchObject({ cause: { code: FOREIGN_KEY_VIOLATION, constraint: 'supporting_asset_tags_asset_tenant_fk' } });
    });

    it('should refuse a sync tagging another tenant\'s asset', async () => {
      const { tagId } = await createAssetAndTag(userAOrigin, tenantAId);
      const foreign = await createAssetAndTag(userBOrigin, tenantBId);

      await expect(services.withOrigin(userAOrigin).supportingAssets.setAssetTags(null, [{ supportingAssetId: foreign.supportingAssetId, tagIds: [tagId] }]))
        .rejects.toMatchObject({ cause: { code: FOREIGN_KEY_VIOLATION } });
      expect(await db.select().from(supportingAssetTags)).toHaveLength(0);
    });

    it('should refuse a decision on another tenant\'s finding, as on an unknown one', async () => {
      const foreignEvidenceId = await createFinding(userBOrigin, tenantBId);
      const userA = services.withOrigin(userAOrigin).supportingAssets;

      await expect(userA.markEvidenceApplicable({ evidenceId: foreignEvidenceId })).rejects.toThrow('Evidence not found');
      await expect(userA.dismissEvidence({ evidenceId: foreignEvidenceId, dismissalType: 'false_positive', reasonCode: 'not_applicable', reason: 'Not on this host' }))
        .rejects.toThrow('Evidence not found');
      await expect(userA.markEvidenceApplicable({ evidenceId: uuidv7() })).rejects.toThrow('Evidence not found');
      expect(await db.select().from(assetEvidenceHistory)).toHaveLength(0);
    });

    it('should refuse a finding decision written under a tenant\'s header by someone outside it', async () => {
      const evidenceId = await createFinding(userAOrigin, tenantAId);
      const outsiderInA: EventOrigin = { type: 'client', userId: userBId, tenantId: tenantAId };

      await expect(services.withOrigin(outsiderInA).supportingAssets.markEvidenceApplicable({ evidenceId, changedByUserId: userBId }))
        .rejects.toThrow('Access Denied');
      expect(await db.select().from(assetEvidenceHistory)).toHaveLength(0);
    });
  });

  describe('tenant membership filtering', () => {
    it('should only list tenants the user is a member of', async () => {
      // User A is only in Tenant A
      const tenantsA = await services.withOrigin(userAOrigin).tenants.getTenants();
      expect(tenantsA).toHaveLength(1);
      expect(tenantsA[0].id).toBe(tenantAId);

      // User B is only in Tenant B
      const tenantsB = await services.withOrigin(userBOrigin).tenants.getTenants();
      expect(tenantsB).toHaveLength(1);
      expect(tenantsB[0].id).toBe(tenantBId);

      // Admin is in both tenants
      const adminOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantAId };
      const tenantsAdmin = await services.withOrigin(adminOrigin).tenants.getTenants();
      expect(tenantsAdmin).toHaveLength(2);
    });
  });

  describe('user visibility across tenants', () => {
    it('should only list users that share the same tenant', async () => {
      // User A can see co-tenant members (admin + themselves)
      const usersSeenByA = await services.withOrigin(userAOrigin).users.getUsers();
      const userAIds = usersSeenByA.map((u) => u.id);
      expect(userAIds).toContain(adminUserId);
      // User B should NOT be visible to User A
      expect(userAIds).not.toContain(userBOrigin.type === 'client' ? userBOrigin.userId : '');
    });
  });

  describe('user in multiple tenants', () => {
    it('should see correct data based on origin tenantId', async () => {
      // Add admin to both tenants (already is)
      const adminInA: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantAId };
      const adminInB: EventOrigin = { type: 'client', userId: adminUserId, tenantId: tenantBId };

      // Create data in each tenant as admin
      const orgAId = uuidv7();
      await services.withOrigin(adminInA).organizations.createOrganizations([
        { id: orgAId, name: 'Org in A' },
      ]);
      const orgBId = uuidv7();
      await services.withOrigin(adminInB).organizations.createOrganizations([
        { id: orgBId, name: 'Org in B' },
      ]);

      // Admin in context of Tenant A sees only A's orgs
      const orgsInA = await services.withOrigin(adminInA).organizations.getOrganizations();
      expect(orgsInA).toHaveLength(1);
      expect(orgsInA[0].id).toBe(orgAId);

      // Admin in context of Tenant B sees only B's orgs
      const orgsInB = await services.withOrigin(adminInB).organizations.getOrganizations();
      expect(orgsInB).toHaveLength(1);
      expect(orgsInB[0].id).toBe(orgBId);
    });
  });

  describe('groups isolation', () => {
    let adminInA: EventOrigin;
    let adminInB: EventOrigin;

    beforeEach(() => {
      // Admin is in both tenants with MANAGE_SECURITY capability
      adminInA = { type: 'client', userId: adminUserId, tenantId: tenantAId };
      adminInB = { type: 'client', userId: adminUserId, tenantId: tenantBId };
    });

    it('should not allow admin in tenant A to see groups from tenant B', async () => {
      // Create a group in Tenant A
      const groupAId = uuidv7();
      await services.withOrigin(adminInA).groups.createGroup({
        id: groupAId, name: 'Group A',
      });

      // Create a group in Tenant B
      const groupBId = uuidv7();
      await services.withOrigin(adminInB).groups.createGroup({
        id: groupBId, name: 'Group B',
      });

      // Admin in context of Tenant A sees only Tenant A groups
      const groupsInA = await services.withOrigin(adminInA).groups.getGroups();
      const groupAIds = groupsInA.map((g) => g.id);
      expect(groupAIds).toContain(groupAId);
      expect(groupAIds).not.toContain(groupBId);

      // Admin in context of Tenant B sees only Tenant B groups
      const groupsInB = await services.withOrigin(adminInB).groups.getGroups();
      const groupBIds = groupsInB.map((g) => g.id);
      expect(groupBIds).toContain(groupBId);
      expect(groupBIds).not.toContain(groupAId);
    });

    it('should not allow admin in tenant A to get a group from tenant B by ID', async () => {
      const groupBId = uuidv7();
      await services.withOrigin(adminInB).groups.createGroup({
        id: groupBId, name: 'Secret Group B',
      });

      // Admin in Tenant A context cannot fetch Tenant B's group
      const crossTenantGroup = await services.withOrigin(adminInA).groups.getGroup(groupBId);
      expect(crossTenantGroup).toBeUndefined();
    });

    it('should not allow admin in tenant A to update a group in tenant B', async () => {
      const groupBId = uuidv7();
      await services.withOrigin(adminInB).groups.createGroup({
        id: groupBId, name: 'Group B',
      });

      // Admin in Tenant A context: update is a no-op (ProtectedDB filters via WHERE)
      await services.withOrigin(adminInA).groups.updateGroup(groupBId, { name: 'Hijacked' });

      // Verify the group name is unchanged in Tenant B
      const group = await services.withOrigin(adminInB).groups.getGroup(groupBId);
      expect(group!.name).toBe('Group B');
    });

    it('should not allow admin in tenant A to delete a group in tenant B', async () => {
      const groupBId = uuidv7();
      await services.withOrigin(adminInB).groups.createGroup({
        id: groupBId, name: 'Group B',
      });

      // Admin in Tenant A context: delete is a no-op (ProtectedDB filters via WHERE)
      await services.withOrigin(adminInA).groups.deleteGroup(groupBId);

      // Verify the group still exists in Tenant B
      const group = await services.withOrigin(adminInB).groups.getGroup(groupBId);
      expect(group).toBeTruthy();
    });

    it('should not allow admin in tenant A to see users in a group from tenant B', async () => {
      // Create a group in Tenant B and add a user to it
      const groupBId = uuidv7();
      await services.withOrigin(adminInB).groups.createGroup({
        id: groupBId, name: 'Group B',
      });
      const userB = await createTenantUser(services, db, adminInB);
      await services.withOrigin(adminInB).groups.addUserToGroup(groupBId, userB.userId);

      // Admin in Tenant A context should not see users in Tenant B's group
      const usersSeenByA = await services.withOrigin(adminInA).groups.getGroupUsers(groupBId);
      expect(usersSeenByA).toHaveLength(0);
    });

    it('should not allow admin in tenant A to add a user to a group in tenant B', async () => {
      // Create a group in Tenant B
      const groupBId = uuidv7();
      await services.withOrigin(adminInB).groups.createGroup({
        id: groupBId, name: 'Group B',
      });

      // Admin in Tenant A tries to add themselves to Tenant B's group
      await expect(
        services.withOrigin(adminInA).groups.addUserToGroup(groupBId, adminUserId),
      ).rejects.toThrow('Access Denied');
    });

    it('should not allow admin in tenant A to remove a user from a group in tenant B', async () => {
      // Create a group in Tenant B and add a user to it
      const groupBId = uuidv7();
      await services.withOrigin(adminInB).groups.createGroup({
        id: groupBId, name: 'Group B',
      });
      const userB = await createTenantUser(services, db, adminInB);
      await services.withOrigin(adminInB).groups.addUserToGroup(groupBId, userB.userId);

      // Admin in Tenant A tries to remove user from Tenant B's group
      await expect(
        services.withOrigin(adminInA).groups.removeUserFromGroup(groupBId, userB.userId),
      ).rejects.toThrow('Access Denied');

      // Verify user is still in Tenant B's group
      const usersInGroupB = await services.withOrigin(adminInB).groups.getGroupUsers(groupBId);
      expect(usersInGroupB.map((u) => u.user.id)).toContain(userB.userId);
    });

    it('should not allow admin in tenant A to see roles in a group from tenant B', async () => {
      // Create group + role in Tenant B and associate them
      const groupBId = uuidv7();
      await services.withOrigin(adminInB).groups.createGroup({
        id: groupBId, name: 'Group B',
      });
      const roleBId = uuidv7();
      await services.withOrigin(adminInB).roles.createRole({
        id: roleBId, name: 'Role B',
      });
      await services.withOrigin(adminInB).groups.addRoleToGroup(groupBId, roleBId);

      // Admin in Tenant A context should not see roles in Tenant B's group
      const rolesSeenByA = await services.withOrigin(adminInA).groups.getGroupRoles(groupBId);
      expect(rolesSeenByA).toHaveLength(0);
    });

    it('should not allow admin in tenant A to add a role to a group in tenant B', async () => {
      // Create a group in Tenant B and a role in Tenant A
      const groupBId = uuidv7();
      await services.withOrigin(adminInB).groups.createGroup({
        id: groupBId, name: 'Group B',
      });
      const roleAId = uuidv7();
      await services.withOrigin(adminInA).roles.createRole({
        id: roleAId, name: 'Role A',
      });

      // Admin in Tenant A tries to add their role to Tenant B's group
      await expect(
        services.withOrigin(adminInA).groups.addRoleToGroup(groupBId, roleAId),
      ).rejects.toThrow('Access Denied');
    });

    it('should not allow admin in tenant A to remove a role from a group in tenant B', async () => {
      // Create group + role in Tenant B and associate them
      const groupBId = uuidv7();
      await services.withOrigin(adminInB).groups.createGroup({
        id: groupBId, name: 'Group B',
      });
      const roleBId = uuidv7();
      await services.withOrigin(adminInB).roles.createRole({
        id: roleBId, name: 'Role B',
      });
      await services.withOrigin(adminInB).groups.addRoleToGroup(groupBId, roleBId);

      // Admin in Tenant A tries to remove the role from Tenant B's group
      await expect(
        services.withOrigin(adminInA).groups.removeRoleFromGroup(groupBId, roleBId),
      ).rejects.toThrow('Access Denied');

      // Verify role is still in Tenant B's group
      const rolesInGroupB = await services.withOrigin(adminInB).groups.getGroupRoles(groupBId);
      expect(rolesInGroupB.map((r) => r.role.id)).toContain(roleBId);
    });
  });

  describe('roles isolation', () => {
    let adminInA: EventOrigin;
    let adminInB: EventOrigin;

    beforeEach(() => {
      adminInA = { type: 'client', userId: adminUserId, tenantId: tenantAId };
      adminInB = { type: 'client', userId: adminUserId, tenantId: tenantBId };
    });

    it('should not allow admin in tenant A to see roles from tenant B', async () => {
      // Create a role in Tenant A
      const roleAId = uuidv7();
      await services.withOrigin(adminInA).roles.createRole({
        id: roleAId, name: 'Role A',
      });

      // Create a role in Tenant B
      const roleBId = uuidv7();
      await services.withOrigin(adminInB).roles.createRole({
        id: roleBId, name: 'Role B',
      });

      // Admin in context of Tenant A sees only Tenant A roles
      const rolesInA = await services.withOrigin(adminInA).roles.getRoles();
      const roleAIds = rolesInA.map((r) => r.id);
      expect(roleAIds).toContain(roleAId);
      expect(roleAIds).not.toContain(roleBId);

      // Admin in context of Tenant B sees only Tenant B roles
      const rolesInB = await services.withOrigin(adminInB).roles.getRoles();
      const roleBIds = rolesInB.map((r) => r.id);
      expect(roleBIds).toContain(roleBId);
      expect(roleBIds).not.toContain(roleAId);
    });

    it('should not allow admin in tenant A to get a role from tenant B by ID', async () => {
      const roleBId = uuidv7();
      await services.withOrigin(adminInB).roles.createRole({
        id: roleBId, name: 'Secret Role B',
      });

      // Admin in Tenant A context cannot fetch Tenant B's role
      const crossTenantRole = await services.withOrigin(adminInA).roles.getRole(roleBId);
      expect(crossTenantRole).toBeUndefined();
    });

    it('should not allow admin in tenant A to update a role in tenant B', async () => {
      const roleBId = uuidv7();
      await services.withOrigin(adminInB).roles.createRole({
        id: roleBId, name: 'Role B',
      });

      // Admin in Tenant A context: update is a no-op (ProtectedDB filters via WHERE)
      await services.withOrigin(adminInA).roles.updateRole(roleBId, { name: 'Hijacked' });

      // Verify the role name is unchanged in Tenant B
      const role = await services.withOrigin(adminInB).roles.getRole(roleBId);
      expect(role!.name).toBe('Role B');
    });

    it('should not allow admin in tenant A to delete a role in tenant B', async () => {
      const roleBId = uuidv7();
      await services.withOrigin(adminInB).roles.createRole({
        id: roleBId, name: 'Role B',
      });

      // Admin in Tenant A context: delete is a no-op (ProtectedDB filters via WHERE)
      await services.withOrigin(adminInA).roles.deleteRole(roleBId);

      // Verify the role still exists in Tenant B
      const role = await services.withOrigin(adminInB).roles.getRole(roleBId);
      expect(role).toBeTruthy();
    });

    it('should not allow admin in tenant A to see capabilities of a role in tenant B', async () => {
      // Create a role in Tenant B and add a capability to it
      const roleBId = uuidv7();
      await services.withOrigin(adminInB).roles.createRole({
        id: roleBId, name: 'Role B',
      });
      await services.withOrigin(adminInB).roles.addCapabilityToRole(roleBId, Capability_ManageSecurity);

      // Admin in Tenant A context should not see capabilities of Tenant B's role
      const capsSeenByA = await services.withOrigin(adminInA).roles.getRoleCapabilities(roleBId);
      expect(capsSeenByA).toHaveLength(0);
    });

    it('should not allow admin in tenant A to add a capability to a role in tenant B', async () => {
      // Create a role in Tenant B
      const roleBId = uuidv7();
      await services.withOrigin(adminInB).roles.createRole({
        id: roleBId, name: 'Role B',
      });

      // Admin in Tenant A tries to add a capability to Tenant B's role
      await expect(
        services.withOrigin(adminInA).roles.addCapabilityToRole(roleBId, Capability_ManageSecurity),
      ).rejects.toThrow('Access Denied');
    });

    it('should not allow admin in tenant A to remove a capability from a role in tenant B', async () => {
      // Create a role in Tenant B and add a capability to it
      const roleBId = uuidv7();
      await services.withOrigin(adminInB).roles.createRole({
        id: roleBId, name: 'Role B',
      });
      await services.withOrigin(adminInB).roles.addCapabilityToRole(roleBId, Capability_ManageSecurity);

      // Admin in Tenant A tries to remove the capability from Tenant B's role
      await expect(
        services.withOrigin(adminInA).roles.removeCapabilityFromRole(roleBId, Capability_ManageSecurity),
      ).rejects.toThrow('Access Denied');

      // Verify capability is still in Tenant B's role
      const capsInRoleB = await services.withOrigin(adminInB).roles.getRoleCapabilities(roleBId);
      expect(capsInRoleB.map((c) => c.capability.id)).toContain(Capability_ManageSecurity);
    });

    it('should not allow admin in tenant A to see groups associated with a role in tenant B', async () => {
      // Create group + role in Tenant B and associate them
      const groupBId = uuidv7();
      await services.withOrigin(adminInB).groups.createGroup({
        id: groupBId, name: 'Group B',
      });
      const roleBId = uuidv7();
      await services.withOrigin(adminInB).roles.createRole({
        id: roleBId, name: 'Role B',
      });
      await services.withOrigin(adminInB).groups.addRoleToGroup(groupBId, roleBId);

      // Admin in Tenant A context should not see groups linked to Tenant B's role
      const groupsSeenByA = await services.withOrigin(adminInA).roles.getRoleGroups(roleBId);
      expect(groupsSeenByA).toHaveLength(0);
    });
  });
});

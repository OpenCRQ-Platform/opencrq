import type { EventOrigin } from '@app/module';
import { organizationAssets, TECHNIQUE_T1003 } from '@app/module';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

const listAssets = (origin: EventOrigin, mappedToOrganizationId: string | null) =>
  services.withOrigin(origin).supportingAssets.listSupportingAssets({
    page: 1,
    limit: 50,
    search: null,
    source: null,
    mappedToOrganizationId,
    membershipOrganizationId: null,
    sortBy: 'name',
    sortDesc: false,
  });

/** Drizzle wraps the driver error, so the constraint that rejected the write is read off the cause. */
const violatedConstraint = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null || !('cause' in error)) {
    return undefined;
  }
  const { cause } = error;
  if (typeof cause !== 'object' || cause === null || !('constraint' in cause)) {
    return undefined;
  }
  return typeof cause.constraint === 'string' ? cause.constraint : undefined;
};

/** The mapping is never listed by id: what a scope maps is what its estate reader answers. */
const mappedAssetIds = async (origin: EventOrigin, organizationId: string) =>
  (await listAssets(origin, organizationId)).items.map((asset) => asset.id).sort();

describe('Risk scope estate', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let adminTenantId: string;
  let assetIds: Array<string>;

  const createAsset = async (name: string) => {
    const id = uuidv7();
    await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
      id, name, description: null, ownerId: null, exposure: 'unknown', categoryId: 'host',
    });
    return id;
  };

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    adminTenantId = setup.tenantId;
    assetIds = [await createAsset('asset-a'), await createAsset('asset-b'), await createAsset('asset-c')];
  });

  describe('the estate declaration', () => {
    it('should default a scope to the whole estate', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id, name: 'Open scope' }]);

      const scope = await services.withOrigin(adminOrigin).organizations.getOrganization(id);
      expect(scope!.estateMode).toBe('open');
      expect(scope!.estateChangedAt).toBeNull();
      expect(scope!.mappedAssetCount).toBe(0);
    });

    it('should resolve the mode a reader narrows on', async () => {
      const openId = uuidv7();
      const closedId = uuidv7();
      await services.withOrigin(adminOrigin).organizations.createOrganizations([
        { id: openId, name: 'Open scope' },
        { id: closedId, name: 'Closed scope', estateMode: 'closed', mappedAssetIds: [assetIds[0]] },
      ]);

      expect(await services.withOrigin(adminOrigin).organizations.resolveEstate(openId)).toEqual({ mode: 'open' });
      expect(await services.withOrigin(adminOrigin).organizations.resolveEstate(closedId)).toEqual({ mode: 'closed', organizationId: closedId });
    });

    it('should resolve nothing for a scope that does not exist', async () => {
      expect(await services.withOrigin(adminOrigin).organizations.resolveEstate(uuidv7())).toBeUndefined();
    });

    it('should birth a closed scope with no asset', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).organizations.createOrganizations([
        { id, name: 'Closed and empty', estateMode: 'closed', mappedAssetIds: [] },
      ]);

      const scope = await services.withOrigin(adminOrigin).organizations.getOrganization(id);
      expect(scope!.estateMode).toBe('closed');
      expect(scope!.mappedAssetCount).toBe(0);
      expect(await listAssets(adminOrigin, id)).toMatchObject({ total: 0 });
    });
  });

  describe('the mapping written as a delta', () => {
    let scopeId: string;

    beforeEach(async () => {
      scopeId = uuidv7();
      await services.withOrigin(adminOrigin).organizations.createOrganizations([
        { id: scopeId, name: 'Closed scope', estateMode: 'closed', mappedAssetIds: [assetIds[0], assetIds[1]] },
      ]);
    });

    it('should insert what was ticked and delete what was unticked', async () => {
      await services.withOrigin(adminOrigin).organizations.updateOrganization(scopeId, {
        mapping: { added: [assetIds[2]], removed: [assetIds[0]] },
      });

      expect(await mappedAssetIds(adminOrigin, scopeId)).toEqual([assetIds[1], assetIds[2]].sort());
    });

    it('should keep a row another save added while this one was open', async () => {
      await services.withOrigin(adminOrigin).organizations.updateOrganization(scopeId, {
        mapping: { added: [assetIds[2]], removed: [] },
      });
      await services.withOrigin(adminOrigin).organizations.updateOrganization(scopeId, {
        mapping: { added: [assetIds[0]], removed: [] },
      });

      expect(await mappedAssetIds(adminOrigin, scopeId)).toEqual(assetIds.slice().sort());
    });

    it('should accept a tick on a row the scope already maps', async () => {
      await services.withOrigin(adminOrigin).organizations.updateOrganization(scopeId, {
        mapping: { added: [assetIds[0], assetIds[2]], removed: [] },
      });

      expect(await mappedAssetIds(adminOrigin, scopeId)).toEqual(assetIds.slice().sort());
    });

    it('should leave the estate-changed date alone when every ticked row was already mapped', async () => {
      const before = (await services.withOrigin(adminOrigin).organizations.getOrganization(scopeId))!.estateChangedAt;
      await services.withOrigin(adminOrigin).organizations.updateOrganization(scopeId, {
        mapping: { added: [assetIds[0], assetIds[1]], removed: [assetIds[2]] },
      });

      const after = (await services.withOrigin(adminOrigin).organizations.getOrganization(scopeId))!.estateChangedAt;
      expect(after!.getTime()).toBe(before!.getTime());
    });

    it('should move the estate-changed date when the mapping moved', async () => {
      const before = (await services.withOrigin(adminOrigin).organizations.getOrganization(scopeId))!.estateChangedAt;
      await services.withOrigin(adminOrigin).organizations.updateOrganization(scopeId, {
        mapping: { added: [], removed: [assetIds[1]] },
      });

      const after = (await services.withOrigin(adminOrigin).organizations.getOrganization(scopeId))!.estateChangedAt;
      expect(after!.getTime()).toBeGreaterThan(before!.getTime());
    });

    it('should leave the estate-changed date alone when nothing moved', async () => {
      const before = (await services.withOrigin(adminOrigin).organizations.getOrganization(scopeId))!.estateChangedAt;
      await services.withOrigin(adminOrigin).organizations.updateOrganization(scopeId, {
        name: 'Renamed',
        mapping: { added: [], removed: [] },
      });

      const after = (await services.withOrigin(adminOrigin).organizations.getOrganization(scopeId))!.estateChangedAt;
      expect(after!.getTime()).toBe(before!.getTime());
    });

    it('should keep the mapping dormant when the scope returns to the whole estate', async () => {
      await services.withOrigin(adminOrigin).organizations.updateOrganization(scopeId, { estateMode: 'open' });

      const scope = await services.withOrigin(adminOrigin).organizations.getOrganization(scopeId);
      expect(scope!.estateMode).toBe('open');
      expect(scope!.mappedAssetCount).toBe(2);
    });

    it('should drop the mapping when the scope goes', async () => {
      await services.withOrigin(adminOrigin).organizations.deleteOrganizations([scopeId]);

      expect(await mappedAssetIds(adminOrigin, scopeId)).toHaveLength(0);
    });

    it('should drop the mapping row when the asset goes', async () => {
      await services.withOrigin(adminOrigin).supportingAssets.deleteSupportingAssets([assetIds[0]]);

      expect(await mappedAssetIds(adminOrigin, scopeId)).toEqual([assetIds[1]]);
    });

    it('should move the estate-changed date when the asset the cascade unmaps goes', async () => {
      const before = (await services.withOrigin(adminOrigin).organizations.getOrganization(scopeId))!.estateChangedAt;
      await services.withOrigin(adminOrigin).supportingAssets.deleteSupportingAssets([assetIds[0]]);

      const after = (await services.withOrigin(adminOrigin).organizations.getOrganization(scopeId))!.estateChangedAt;
      expect(after!.getTime()).toBeGreaterThan(before!.getTime());
    });

    it('should leave the estate-changed date alone when the asset that goes maps nowhere', async () => {
      const before = (await services.withOrigin(adminOrigin).organizations.getOrganization(scopeId))!.estateChangedAt;
      await services.withOrigin(adminOrigin).supportingAssets.deleteSupportingAssets([assetIds[2]]);

      const after = (await services.withOrigin(adminOrigin).organizations.getOrganization(scopeId))!.estateChangedAt;
      expect(after!.getTime()).toBe(before!.getTime());
    });

    it('should map an asset created by hand inside a closed scope', async () => {
      const createdId = uuidv7();
      await services.withOrigin(adminOrigin).supportingAssets.createSupportingAsset({
        id: createdId,
        name: 'created-in-scope',
        description: null,
        ownerId: null,
        exposure: 'unknown',
        categoryId: 'host',
        mapIntoOrganizationId: scopeId,
      });

      expect(await mappedAssetIds(adminOrigin, scopeId)).toEqual([assetIds[0], assetIds[1], createdId].sort());
    });
  });

  describe('the readers joining by mode', () => {
    it('should list the whole tenant estate for a scope measured over it', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).organizations.createOrganizations([{ id, name: 'Open scope' }]);

      const listed = await listAssets(adminOrigin, null);
      expect(listed.total).toBe(3);
    });

    it('should list the mapped assets alone for a closed scope', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).organizations.createOrganizations([
        { id, name: 'Closed scope', estateMode: 'closed', mappedAssetIds: [assetIds[0], assetIds[2]] },
      ]);

      const listed = await listAssets(adminOrigin, id);
      expect(listed.total).toBe(2);
      expect(listed.items.map((asset) => asset.id).sort()).toEqual([assetIds[0], assetIds[2]].sort());
    });

    it('should search asset names across accents and ligatures in both directions', async () => {
      const accentedId = await createAsset('École Straße');
      const search = async (term: string) => (await services.withOrigin(adminOrigin).supportingAssets.listSupportingAssets({
        page: 1,
        limit: 50,
        search: term,
        source: null,
        mappedToOrganizationId: null,
        membershipOrganizationId: null,
        sortBy: 'name',
        sortDesc: false,
      })).items.map((asset) => asset.id);

      expect(await search('ecole')).toEqual([accentedId]);
      expect(await search('strasse')).toEqual([accentedId]);
      expect(await search('ássét-a')).toEqual([assetIds[0]]);
    });

    it('should size the estate on the whole scope, never on the search', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).organizations.createOrganizations([
        { id, name: 'Closed scope', estateMode: 'closed', mappedAssetIds: [assetIds[0], assetIds[1], assetIds[2]] },
      ]);

      const searched = await services.withOrigin(adminOrigin).supportingAssets.listSupportingAssets({
        page: 1,
        limit: 50,
        search: 'asset-a',
        source: null,
        mappedToOrganizationId: id,
        membershipOrganizationId: null,
        sortBy: 'name',
        sortDesc: false,
      });
      expect(searched.total).toBe(1);
      expect(searched.estateTotal).toBe(3);
    });

    it('should say which rows a scope maps without narrowing the page', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).organizations.createOrganizations([
        { id, name: 'Closed scope', estateMode: 'closed', mappedAssetIds: [assetIds[1]] },
      ]);

      const offered = await services.withOrigin(adminOrigin).supportingAssets.listSupportingAssets({
        page: 1,
        limit: 50,
        search: null,
        source: null,
        mappedToOrganizationId: null,
        membershipOrganizationId: id,
        sortBy: 'name',
        sortDesc: false,
      });
      expect(offered.total).toBe(3);
      expect(offered.items.filter((asset) => asset.mapped).map((asset) => asset.id)).toEqual([assetIds[1]]);
    });

    it('should raise the mapped rows first, flip them last, and count each row\'s evidence', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).organizations.createOrganizations([
        { id, name: 'Closed scope', estateMode: 'closed', mappedAssetIds: [assetIds[0], assetIds[2]] },
      ]);
      for (const supportingAssetId of [assetIds[0], assetIds[1]]) {
        await services.withOrigin(adminOrigin).supportingAssets.createEvidence({
          id: uuidv7(),
          supportingAssetId,
          mitreTechniqueId: TECHNIQUE_T1003,
          expectationType: 'prevention',
          userId: adminUserId,
        });
      }

      const orderedBy = (sortDesc: boolean) => services.withOrigin(adminOrigin).supportingAssets.listSupportingAssets({
        page: 1,
        limit: 50,
        search: null,
        source: null,
        mappedToOrganizationId: null,
        membershipOrganizationId: id,
        sortBy: 'mapped',
        sortDesc,
      });

      const mappedFirst = await orderedBy(true);
      expect(mappedFirst.items.map((asset) => asset.id)).toEqual([assetIds[0], assetIds[2], assetIds[1]]);
      expect(mappedFirst.items.map((asset) => asset.applicableEvidenceCount)).toEqual([1, 0, 1]);

      const mappedLast = await orderedBy(false);
      expect(mappedLast.items.map((asset) => asset.id)).toEqual([assetIds[1], assetIds[0], assetIds[2]]);
    });

    it('should count only the estate assets on the findings tiles', async () => {
      const id = uuidv7();
      await services.withOrigin(adminOrigin).organizations.createOrganizations([
        { id, name: 'Closed scope', estateMode: 'closed', mappedAssetIds: [assetIds[0]] },
      ]);

      const scoped = await services.withOrigin(adminOrigin).findingScore.getFindingsPanelCounts(id);
      const tenantWide = await services.withOrigin(adminOrigin).findingScore.getFindingsPanelCounts();
      expect(scoped.estateAssetCount).toBe(1);
      expect(tenantWide.estateAssetCount).toBe(3);
    });

    it('should list only the findings of the mapped assets', async () => {
      const scopeId = uuidv7();
      await services.withOrigin(adminOrigin).organizations.createOrganizations([
        { id: scopeId, name: 'Closed scope', estateMode: 'closed', mappedAssetIds: [assetIds[1]] },
      ]);
      const evidenceIds = [uuidv7(), uuidv7()];
      for (const [index, evidenceId] of evidenceIds.entries()) {
        await services.withOrigin(adminOrigin).supportingAssets.createEvidence({
          id: evidenceId,
          supportingAssetId: assetIds[index],
          mitreTechniqueId: TECHNIQUE_T1003,
          expectationType: 'prevention',
          userId: adminUserId,
        });
      }
      await services.withOrigin(adminOrigin).findingScore.recomputeFindingScores();

      const listed = await services.withOrigin(adminOrigin).findingScore.listScoredFindings({
        page: 1, limit: 50, state: 'applicable', source: null, mappedToOrganizationId: scopeId, sortBy: 'score', sortDesc: true,
      });
      const tenantWide = await services.withOrigin(adminOrigin).findingScore.listScoredFindings({
        page: 1, limit: 50, state: 'applicable', source: null, mappedToOrganizationId: null, sortBy: 'score', sortDesc: true,
      });

      expect(tenantWide.total).toBe(2);
      expect(listed.total).toBe(1);
      expect(listed.items.map((row) => row.evidenceId)).toEqual([evidenceIds[1]]);
      expect(listed.unscored).toBe(0);
    });
  });

  describe('the pairing the database itself refuses', () => {
    it('should reject a row pairing a scope and an asset of two tenants', async () => {
      const scopeId = uuidv7();
      await services.withOrigin(adminOrigin).organizations.createOrganizations([
        { id: scopeId, name: 'Closed scope', estateMode: 'closed', mappedAssetIds: [] },
      ]);
      const otherTenantId = await createTenant(services, adminUserId);
      const otherOrigin: EventOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };
      const otherAssetId = uuidv7();
      await services.withOrigin(otherOrigin).supportingAssets.createSupportingAsset({
        id: otherAssetId, name: 'Other tenant asset', description: null, ownerId: null, exposure: 'unknown', categoryId: 'host',
      });

      const rejection: unknown = await db.insert(organizationAssets).values([{
        organizationId: scopeId,
        supportingAssetId: otherAssetId,
        tenantId: adminTenantId,
      }]).then(() => undefined, (error: unknown) => error);

      expect(violatedConstraint(rejection)).toBe('organization_assets_supporting_asset_tenant_fk');

      expect(await mappedAssetIds(adminOrigin, scopeId)).toEqual([]);
    });
  });
});

import type { DependencyRuleInput, EventOrigin } from '@app/module';
import { DependencyRuleNotFoundError, DependencyRuleRefusedError, PrimaryAssetNotFoundError, primaryAssetReach, supportingAssetTags, supportToPrimaryLinks, tags } from '@app/module';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('dependency rules', () => {
  let adminOrigin: EventOrigin;
  let tenantId: string;
  let organizationId: string;
  let primaryAssetId: string;
  let otherPrimaryAssetId: string;

  const as = (origin: EventOrigin) => services.withOrigin(origin);
  const admin = () => as(adminOrigin).assetDependencies;
  const jobOrigin = (): EventOrigin => ({ type: 'job', tenantId, jobKind: 'dependency-rules-apply', interactive: false });
  const apply = () => as(jobOrigin()).assetDependencies.applyDependencyRules();
  const reach = () => as({ type: 'job', tenantId, jobKind: 'primary-asset-reach-recompute', interactive: false }).assetDependencies.recomputePrimaryAssetReach();

  const NO_CONDITION = { categoryId: null, subcategoryId: null, namePattern: null, namePatternKind: null, tagId: null, source: null } as const;

  const rule = (overrides: Partial<DependencyRuleInput>): DependencyRuleInput => ({
    ...NO_CONDITION,
    name: 'Rule',
    primaryAssetId,
    roles: ['processes'],
    enabled: true,
    ...overrides,
  });

  const createAsset = async (name: string, categoryId: 'host' | 'saas_application' | 'web_application' = 'host') => {
    const id = uuidv7();
    await as(adminOrigin).supportingAssets.createSupportingAsset({
      id, name, description: null, ownerId: null, exposure: 'unknown', categoryId,
    });
    return id;
  };

  const linksOf = async () => (await db.select({
    supportingAssetId: supportToPrimaryLinks.supportingAssetId,
    primaryAssetId: supportToPrimaryLinks.primaryAssetId,
    roles: supportToPrimaryLinks.roles,
    ruleId: supportToPrimaryLinks.ruleId,
  }).from(supportToPrimaryLinks).where(eq(supportToPrimaryLinks.tenantId, tenantId)))
    .toSorted((a, b) => `${a.supportingAssetId}${a.primaryAssetId}`.localeCompare(`${b.supportingAssetId}${b.primaryAssetId}`));

  const linkedAssetIds = async (ruleId?: string) =>
    (await linksOf()).filter((link) => ruleId === undefined || link.ruleId === ruleId).map((link) => link.supportingAssetId).toSorted();

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    tenantId = setup.tenantId;
    organizationId = uuidv7();
    await as(adminOrigin).organizations.createOrganizations([{ id: organizationId, name: 'Org' }]);
    primaryAssetId = uuidv7();
    otherPrimaryAssetId = uuidv7();
    for (const [id, name] of [[primaryAssetId, 'Customer SaaS platform'], [otherPrimaryAssetId, 'Identity and mail']] as const) {
      await as(adminOrigin).primaryAssets.createPrimaryAsset({ id, organizationId, name, description: null, ownerId: null, businessValueCategoryIds: [] });
    }
  });

  describe('matching per condition', () => {
    it('matches on category', async () => {
      const host = await createAsset('db-1', 'host');
      await createAsset('crm', 'saas_application');
      const { id } = await admin().createDependencyRule(rule({ categoryId: 'host' }));

      await apply();

      expect(await linkedAssetIds(id)).toEqual([host]);
    });

    it('matches a glob on the name, anchored and case-insensitive', async () => {
      const match = await createAsset('API.Example-SaaS.io');
      await createAsset('example-saas.io.backup');
      const { id } = await admin().createDependencyRule(rule({ namePattern: '*.example-saas.io', namePatternKind: 'glob' }));

      await apply();

      expect(await linkedAssetIds(id)).toEqual([match]);
    });

    it('matches a regular expression on the name', async () => {
      const match = await createAsset('db-042');
      await createAsset('web-042');
      const { id } = await admin().createDependencyRule(rule({ namePattern: '^db-[0-9]+$', namePatternKind: 'regex' }));

      await apply();

      expect(await linkedAssetIds(id)).toEqual([match]);
    });

    it('matches on a tag, and on a tag merged into it', async () => {
      const tagged = await createAsset('tagged');
      const mergedTagged = await createAsset('merged-tagged');
      await createAsset('untagged');
      const tagId = uuidv7();
      const mergedTagId = uuidv7();
      await db.insert(tags).values([
        { id: tagId, tenantId, name: 'production' },
        { id: mergedTagId, tenantId, name: 'prod', mergedIntoTagId: tagId, mergedAt: new Date() },
      ]);
      await db.insert(supportingAssetTags).values([
        { id: uuidv7(), tenantId, supportingAssetId: tagged, tagId },
        { id: uuidv7(), tenantId, supportingAssetId: mergedTagged, tagId: mergedTagId },
      ]);
      const { id } = await admin().createDependencyRule(rule({ tagId }));

      await apply();

      expect(await linkedAssetIds(id)).toEqual([tagged, mergedTagged].toSorted());
    });

    it('needs every condition it sets', async () => {
      const both = await createAsset('db-1', 'host');
      await createAsset('db-2', 'web_application');
      await createAsset('web-1', 'host');
      const { id } = await admin().createDependencyRule(rule({ categoryId: 'host', namePattern: 'db-*', namePatternKind: 'glob' }));

      await apply();

      expect(await linkedAssetIds(id)).toEqual([both]);
    });

    it('writes the rule roles on its links', async () => {
      await createAsset('db-1');
      await admin().createDependencyRule(rule({ categoryId: 'host', roles: ['stores', 'processes'] }));

      await apply();

      expect((await linksOf())[0].roles.toSorted()).toEqual(['processes', 'stores']);
    });
  });

  describe('preview', () => {
    it('lists what apply then links, with its count', async () => {
      const assets = [await createAsset('db-a'), await createAsset('db-b'), await createAsset('db-c')];
      const conditions = { ...NO_CONDITION, namePattern: 'db-*', namePatternKind: 'glob' as const };

      const preview = await admin().previewDependencyRule({ ...conditions, primaryAssetId }, 2);
      await admin().createDependencyRule(rule(conditions));
      await apply();

      expect(preview.total).toBe(3);
      expect(preview.assets.map((asset) => asset.id)).toEqual(assets.slice(0, 2));
      expect(await linkedAssetIds()).toEqual(assets.toSorted());
    });

    it('leaves out the pairs a person linked or unlinked, and counts them', async () => {
      const manual = await createAsset('db-manual');
      const removed = await createAsset('db-removed');
      const free = await createAsset('db-free');
      const manualLinkId = uuidv7();
      const removedLinkId = uuidv7();
      await admin().createSupportToPrimaryLinks([
        { id: manualLinkId, supportingAssetId: manual, primaryAssetId },
        { id: removedLinkId, supportingAssetId: removed, primaryAssetId },
      ]);
      await admin().deleteSupportToPrimaryLinks([removedLinkId]);

      const preview = await admin().previewDependencyRule({ ...NO_CONDITION, namePattern: 'db-*', namePatternKind: 'glob', primaryAssetId });

      expect(preview).toMatchObject({ total: 1, alreadyManual: 1, suppressed: 1 });
      expect(preview.assets.map((asset) => asset.id)).toEqual([free]);
    });

    it('refuses an invalid regular expression', async () => {
      await expect(admin().previewDependencyRule({ ...NO_CONDITION, namePattern: '([', namePatternKind: 'regex', primaryAssetId }))
        .rejects.toThrow(DependencyRuleRefusedError);
    });
  });

  describe('manual wins', () => {
    it('never re-creates a rule link a person removed', async () => {
      const asset = await createAsset('db-1');
      await admin().createDependencyRule(rule({ categoryId: 'host' }));
      await apply();
      const [link] = await db.select({ id: supportToPrimaryLinks.id }).from(supportToPrimaryLinks);

      await admin().deleteSupportToPrimaryLinks([link.id]);
      await apply();

      expect(await linkedAssetIds()).toEqual([]);
      expect(asset).toBeDefined();
    });

    it('leaves a manual link as it is, roles included', async () => {
      const asset = await createAsset('db-1');
      await admin().createSupportToPrimaryLinks([{ id: uuidv7(), supportingAssetId: asset, primaryAssetId, roles: ['monitors'] }]);
      await admin().createDependencyRule(rule({ categoryId: 'host', roles: ['stores'] }));

      await apply();

      expect(await linksOf()).toEqual([{ supportingAssetId: asset, primaryAssetId, roles: ['monitors'], ruleId: null }]);
    });

    it('makes a rule link a person edits theirs, so the rule no longer removes it', async () => {
      const asset = await createAsset('db-1');
      const { id } = await admin().createDependencyRule(rule({ categoryId: 'host' }));
      await apply();
      const [link] = await db.select({ id: supportToPrimaryLinks.id }).from(supportToPrimaryLinks);

      await admin().updateSupportToPrimaryLinks([{ id: link.id, roles: ['administers'] }]);
      await admin().deleteDependencyRules([id]);
      await apply();

      expect(await linksOf()).toEqual([{ supportingAssetId: asset, primaryAssetId, roles: ['administers'], ruleId: null }]);
    });

    it('makes a rule link a person links again theirs', async () => {
      const asset = await createAsset('db-1');
      const { id } = await admin().createDependencyRule(rule({ categoryId: 'host' }));
      await apply();

      await admin().createSupportToPrimaryLinks([{ id: uuidv7(), supportingAssetId: asset, primaryAssetId }]);
      await admin().deleteDependencyRules([id]);
      await apply();

      expect(await linkedAssetIds()).toEqual([asset]);
    });
  });

  describe('re-apply', () => {
    it('links a new asset and unlinks one that no longer matches', async () => {
      const kept = await createAsset('db-kept');
      const renamed = await createAsset('db-renamed');
      const { id } = await admin().createDependencyRule(rule({ namePattern: 'db-*', namePatternKind: 'glob' }));
      await apply();

      await as(adminOrigin).supportingAssets.updateSupportingAsset(renamed, { name: 'web-renamed' });
      const added = await createAsset('db-new');
      await apply();

      expect(await linkedAssetIds(id)).toEqual([kept, added].toSorted());
    });

    it('follows a rule change: new roles, new primary asset', async () => {
      const asset = await createAsset('db-1');
      const { id } = await admin().createDependencyRule(rule({ categoryId: 'host' }));
      await apply();

      await admin().updateDependencyRule(id, rule({ categoryId: 'host', primaryAssetId: otherPrimaryAssetId, roles: ['stores'] }));
      await apply();

      expect(await linksOf()).toEqual([{ supportingAssetId: asset, primaryAssetId: otherPrimaryAssetId, roles: ['stores'], ruleId: id }]);
    });

    it('drops the links of a disabled or deleted rule', async () => {
      await createAsset('db-1');
      const { id } = await admin().createDependencyRule(rule({ categoryId: 'host' }));
      await apply();

      await admin().updateDependencyRule(id, rule({ categoryId: 'host', enabled: false }));
      await apply();
      expect(await linksOf()).toEqual([]);

      await admin().updateDependencyRule(id, rule({ categoryId: 'host' }));
      await apply();
      await admin().deleteDependencyRules([id]);
      expect(await linksOf()).toEqual([]);
    });

    it('gives a pair two rules match to the first by name', async () => {
      await createAsset('db-1');
      await admin().createDependencyRule(rule({ name: 'B rule', categoryId: 'host', roles: ['stores'] }));
      const { id: first } = await admin().createDependencyRule(rule({ name: 'A rule', namePattern: 'db-*', namePatternKind: 'glob', roles: ['reads'] }));

      await apply();

      expect((await linksOf()).map((link) => [link.ruleId, link.roles])).toEqual([[first, ['reads']]]);
    });

    it('writes nothing on a run with nothing to change', async () => {
      await createAsset('db-1');
      await admin().createDependencyRule(rule({ categoryId: 'host' }));
      await apply();

      expect(await apply()).toMatchObject({ inserted: 0, updated: 0, deleted: 0 });
    });

    it('refuses an origin that is not its job', async () => {
      await expect(admin().applyDependencyRules()).rejects.toThrow('applied by their job alone');
    });
  });

  it('feeds the reach as a manual link does', async () => {
    const asset = await createAsset('db-1');
    await admin().createDependencyRule(rule({ categoryId: 'host' }));
    await apply();
    await reach();

    const rows = await db.select({ supportingAssetId: primaryAssetReach.supportingAssetId }).from(primaryAssetReach)
      .where(eq(primaryAssetReach.primaryAssetId, primaryAssetId));
    expect(rows.map((row) => row.supportingAssetId)).toContain(asset);
  });

  it('reports the source of each link', async () => {
    const ruled = await createAsset('db-1');
    const manual = await createAsset('web-1', 'web_application');
    await admin().createSupportToPrimaryLinks([{ id: uuidv7(), supportingAssetId: manual, primaryAssetId }]);
    const { id } = await admin().createDependencyRule(rule({ name: 'Hosts', categoryId: 'host' }));
    await apply();

    const links = await admin().getSupportToPrimaryLinksByPrimaryAssetId(primaryAssetId);

    expect(links.find((link) => link.supportingAssetId === ruled)).toMatchObject({ source: 'rule', ruleId: id, ruleName: 'Hosts' });
    expect(links.find((link) => link.supportingAssetId === manual)).toMatchObject({ source: 'manual', ruleId: null, ruleName: null });
    expect((await admin().listDependencyRules()).map((row) => [row.name, row.linkCount])).toEqual([['Hosts', 1]]);
  });

  describe('refusals', () => {
    it('refuses a rule without a condition', async () => {
      await expect(admin().createDependencyRule(rule({}))).rejects.toThrow(DependencyRuleRefusedError);
    });

    it('refuses a name taken', async () => {
      await admin().createDependencyRule(rule({ categoryId: 'host' }));
      await expect(admin().createDependencyRule(rule({ categoryId: 'identity' }))).rejects.toThrow('already exists');
    });

    it('refuses a primary asset out of reach', async () => {
      await expect(admin().createDependencyRule(rule({ categoryId: 'host', primaryAssetId: uuidv7() }))).rejects.toThrow(PrimaryAssetNotFoundError);
    });

    it('refuses to update a rule that does not exist', async () => {
      await expect(admin().updateDependencyRule(uuidv7(), rule({ categoryId: 'host' }))).rejects.toThrow(DependencyRuleNotFoundError);
    });
  });
});

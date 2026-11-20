import type { EventOrigin } from '@app/module';
import { supportingAssetTags, TagMergeRefusedError, TagNameTakenError, TagNotFoundError, tags, tagSources } from '@app/module';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant, createTenantWithAdmin } from '../../helpers/factories';
import { holdWriteOpen, waitUntilBlockedByAnotherBackend } from '../../helpers/held-transaction';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

describe('Supporting Assets tag management', () => {
  let adminOrigin: EventOrigin;
  let adminUserId: string;
  let adminTenantId: string;
  let connectorOrigin: EventOrigin;
  let connectorId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    adminUserId = setup.userId;
    adminTenantId = setup.tenantId;

    const serviceAccountId = uuidv7();
    await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({ id: serviceAccountId, name: 'OpenAEV Bot' });
    await services.withOrigin(adminOrigin).integrationSettings.configureIntegration('openaev', serviceAccountId);
    connectorOrigin = { type: 'connector', serviceAccountId, tenantId: adminTenantId };
    connectorId = (await services.withOrigin(connectorOrigin).integrationSettings.getConnectorId('openaev'))!;
  });

  const assets = () => services.withOrigin(adminOrigin).supportingAssets;

  /** An asset a person created and tagged by hand: its tags have a manual origin. */
  const createManualAsset = async (name: string, tagNames: Array<string>, origin: EventOrigin = adminOrigin) => {
    const id = uuidv7();
    await services.withOrigin(origin).supportingAssets.createSupportingAsset({
      id, name, exposure: 'internal', categoryId: 'host', tagNames,
    });
    return id;
  };

  /** An asset OpenAEV reported, linked to the given tags as the connector. */
  const createConnectorAsset = async (sourceAssetId: string, tagIds: Array<string>) => {
    const idMap = await services.withOrigin(connectorOrigin).supportingAssets.bulkUpsertAssets([
      { sourceAssetId, categoryId: 'host', connectorId, source: 'openaev', name: sourceAssetId },
    ]);
    const assetId = idMap.get(sourceAssetId)!;
    await services.withOrigin(connectorOrigin).supportingAssets.setAssetTags(connectorId, [{ supportingAssetId: assetId, tagIds }]);
    return assetId;
  };

  const upsertOpenaevTag = async (sourceTagId: string, name: string) => {
    const idBySourceTagId = await services.withOrigin(connectorOrigin).supportingAssets.upsertTagVocabulary(connectorId, [
      { sourceTagId, name, color: '#ff0000' },
    ]);
    return idBySourceTagId.get(sourceTagId)!;
  };

  const tagIdOf = async (name: string, tenantId: string = adminTenantId) => {
    const [row] = await db.select().from(tags).where(and(eq(tags.tenantId, tenantId), eq(tags.name, name)));
    return row.id;
  };

  const tagNamesOf = async (assetId: string, origin: EventOrigin = adminOrigin) =>
    (await services.withOrigin(origin).supportingAssets.getSupportingAsset(assetId))!.tags.map((tag) => tag.name);

  const mergePointerOf = async (tagId: string) => {
    const [row] = await db.select().from(tags).where(eq(tags.id, tagId));
    return { mergedIntoTagId: row.mergedIntoTagId, mergedAt: row.mergedAt };
  };

  const snapshotLinksAndOrigins = async () => ({
    links: await db.select().from(supportingAssetTags).orderBy(asc(supportingAssetTags.id)),
    origins: await db.select().from(tagSources).orderBy(asc(tagSources.id)),
  });

  describe('tag management', () => {
    describe('rename', () => {
      it('should change the name shown on every asset carrying the tag', async () => {
        const tagId = await upsertOpenaevTag('oa-1', 'Production');
        const connectorAssetId = await createConnectorAsset('ep-1', [tagId]);
        const manualAssetId = await createManualAsset('manual-host', ['Production']);

        await assets().renameTag(tagId, 'Prod');

        expect(await tagNamesOf(connectorAssetId)).toEqual(['Prod']);
        expect(await tagNamesOf(manualAssetId)).toEqual(['Prod']);
      });

      it('should leave the name OpenAEV reports untouched', async () => {
        const tagId = await upsertOpenaevTag('oa-1', 'Production');

        await assets().renameTag(tagId, 'Prod');

        const origins = await db.select().from(tagSources).where(eq(tagSources.tagId, tagId));
        expect(origins.map((origin) => origin.reportedName)).toEqual(['Production']);
      });

      it('should refuse a name another tag holds', async () => {
        await createManualAsset('host-1', ['alpha', 'beta']);

        await expect(assets().renameTag(await tagIdOf('alpha'), 'beta')).rejects.toBeInstanceOf(TagNameTakenError);
      });

      it('should refuse the name of a merged tag', async () => {
        await createManualAsset('host-1', ['alpha', 'beta', 'gamma']);
        await assets().mergeTag(await tagIdOf('beta'), await tagIdOf('gamma'));

        await expect(assets().renameTag(await tagIdOf('alpha'), 'beta')).rejects.toBeInstanceOf(TagNameTakenError);
      });

      it('should do nothing when the name stays the same, trimmed or not', async () => {
        await createManualAsset('host-1', ['alpha']);
        const tagId = await tagIdOf('alpha');

        await assets().renameTag(tagId, 'alpha');
        await assets().renameTag(tagId, '  alpha  ');

        expect(await db.select().from(tags).where(eq(tags.id, tagId))).toMatchObject([{ name: 'alpha' }]);
      });
    });

    describe('merge', () => {
      it('should only set the pointer, leaving the asset links and the origins as they were', async () => {
        const openaevTagId = await upsertOpenaevTag('oa-1', 'Production');
        await createConnectorAsset('ep-1', [openaevTagId]);
        await createManualAsset('host-1', ['production', 'prod-eu']);
        const before = await snapshotLinksAndOrigins();

        await assets().mergeTag(openaevTagId, await tagIdOf('production'));

        expect(await snapshotLinksAndOrigins()).toEqual(before);
      });

      it('should record the target and the date on the merged tag', async () => {
        await createManualAsset('host-1', ['alpha', 'beta']);
        const sourceId = await tagIdOf('alpha');
        const targetId = await tagIdOf('beta');

        await assets().mergeTag(sourceId, targetId);

        const pointer = await mergePointerOf(sourceId);
        expect(pointer.mergedIntoTagId).toBe(targetId);
        expect(pointer.mergedAt).toBeInstanceOf(Date);
        expect(await mergePointerOf(targetId)).toEqual({ mergedIntoTagId: null, mergedAt: null });
      });

      it('should refuse to merge a tag that is already merged', async () => {
        await createManualAsset('host-1', ['alpha', 'beta', 'gamma']);
        await assets().mergeTag(await tagIdOf('alpha'), await tagIdOf('beta'));

        const refusal = assets().mergeTag(await tagIdOf('alpha'), await tagIdOf('gamma'));

        await expect(refusal).rejects.toBeInstanceOf(TagMergeRefusedError);
        await expect(refusal).rejects.toMatchObject({ data: { reason: 'sourceAlreadyMerged' } });
      });

      it('should refuse to merge into a tag that is already merged', async () => {
        await createManualAsset('host-1', ['alpha', 'beta', 'gamma']);
        await assets().mergeTag(await tagIdOf('alpha'), await tagIdOf('beta'));

        const refusal = assets().mergeTag(await tagIdOf('gamma'), await tagIdOf('alpha'));

        await expect(refusal).rejects.toBeInstanceOf(TagMergeRefusedError);
        await expect(refusal).rejects.toMatchObject({ data: { reason: 'targetAlreadyMerged' } });
      });

      it('should refuse to merge a tag into itself', async () => {
        await createManualAsset('host-1', ['alpha']);
        const tagId = await tagIdOf('alpha');

        const refusal = assets().mergeTag(tagId, tagId);

        await expect(refusal).rejects.toBeInstanceOf(TagMergeRefusedError);
        await expect(refusal).rejects.toMatchObject({ data: { reason: 'targetIsSource' } });
      });

      it('should wait for a crossed merge in flight and refuse rather than close a cycle', async () => {
        await createManualAsset('host-1', ['alpha', 'beta']);
        const [alphaId, betaId] = [await tagIdOf('alpha'), await tagIdOf('beta')];
        const crossed = holdWriteOpen((tx) => tx.update(tags).set({ mergedIntoTagId: alphaId, mergedAt: new Date() }).where(eq(tags.id, betaId)));
        await crossed.locked;

        const merging = assets().mergeTag(alphaId, betaId);
        expect(await waitUntilBlockedByAnotherBackend()).toBe(true);
        crossed.commit();
        await crossed.done;

        await expect(merging).rejects.toMatchObject({ data: { reason: 'targetAlreadyMerged' } });
        expect((await mergePointerOf(alphaId)).mergedIntoTagId).toBeNull();
      });
    });

    describe('unmerge', () => {
      it('should clear the pointer and the date', async () => {
        await createManualAsset('host-1', ['alpha', 'beta']);
        const sourceId = await tagIdOf('alpha');
        await assets().mergeTag(sourceId, await tagIdOf('beta'));

        await assets().unmergeTag(sourceId);

        expect(await mergePointerOf(sourceId)).toEqual({ mergedIntoTagId: null, mergedAt: null });
      });

      it('should refuse a tag that is not merged', async () => {
        await createManualAsset('host-1', ['alpha']);

        const refusal = assets().unmergeTag(await tagIdOf('alpha'));

        await expect(refusal).rejects.toBeInstanceOf(TagMergeRefusedError);
        await expect(refusal).rejects.toMatchObject({ data: { reason: 'notMerged' } });
      });
    });

    describe('delete', () => {
      it('should remove the tag, its asset links and its origins', async () => {
        const tagId = await upsertOpenaevTag('oa-1', 'Production');
        await createConnectorAsset('ep-1', [tagId]);
        await createManualAsset('host-1', ['production']);

        await assets().deleteTag(tagId);

        expect(await db.select().from(tags).where(eq(tags.id, tagId))).toHaveLength(0);
        expect(await db.select().from(supportingAssetTags).where(eq(supportingAssetTags.tagId, tagId))).toHaveLength(0);
        expect(await db.select().from(tagSources).where(eq(tagSources.tagId, tagId))).toHaveLength(0);
      });

      it('should remove the tags merged into it with their links and origins', async () => {
        await createManualAsset('host-1', ['alpha', 'beta']);
        const mergedId = await tagIdOf('alpha');
        const rootId = await tagIdOf('beta');
        await assets().mergeTag(mergedId, rootId);

        await assets().deleteTag(rootId);

        expect(await db.select().from(tags)).toHaveLength(0);
        expect(await db.select().from(supportingAssetTags)).toHaveLength(0);
        expect(await db.select().from(tagSources)).toHaveLength(0);
      });
    });

    describe('listManagedTags', () => {
      it('should list the manual and OpenAEV sources, with the name OpenAEV reports', async () => {
        const openaevTagId = await upsertOpenaevTag('oa-1', 'Production');
        await createManualAsset('host-1', ['Production']);
        await assets().renameTag(openaevTagId, 'Prod');

        const managed = await assets().listManagedTags();

        expect(managed).toHaveLength(1);
        expect(managed[0].name).toBe('Prod');
        expect(managed[0].sources).toEqual(expect.arrayContaining([
          { kind: 'manual' },
          { kind: 'connector', source: 'openaev', reportedName: 'Production' },
        ]));
        expect(managed[0].sources).toHaveLength(2);
      });

      it('should count an asset carrying both the merged tag and its target once', async () => {
        await createManualAsset('host-1', ['alpha', 'beta']);
        await assets().mergeTag(await tagIdOf('alpha'), await tagIdOf('beta'));

        const managed = await assets().listManagedTags();

        expect(managed.find((tag) => tag.name === 'beta')!.assetCount).toBe(1);
      });

      it('should count the assets reaching a tag through the tags merged into it', async () => {
        await createManualAsset('host-1', ['alpha', 'beta']);
        await createManualAsset('host-2', ['alpha']);
        await assets().mergeTag(await tagIdOf('alpha'), await tagIdOf('beta'));

        const managed = await assets().listManagedTags();

        expect(managed.find((tag) => tag.name === 'beta')!.assetCount).toBe(2);
        expect(managed.find((tag) => tag.name === 'alpha')!.assetCount).toBe(2);
      });

      it('should keep the merged tags in the list with their pointer', async () => {
        await createManualAsset('host-1', ['alpha', 'beta']);
        const targetId = await tagIdOf('beta');
        await assets().mergeTag(await tagIdOf('alpha'), targetId);

        const managed = await assets().listManagedTags();

        expect(managed.map((tag) => [tag.name, tag.mergedIntoTagId])).toEqual([['alpha', targetId], ['beta', null]]);
        expect(managed[0].mergedAt).toBeInstanceOf(Date);
      });
    });

    describe('listTags', () => {
      it('should not offer a merged tag', async () => {
        await createManualAsset('host-1', ['alpha', 'beta']);
        await assets().mergeTag(await tagIdOf('alpha'), await tagIdOf('beta'));

        expect((await assets().listTags()).map((tag) => tag.name)).toEqual(['beta']);
      });
    });

    describe('tenant isolation', () => {
      let otherOrigin: EventOrigin;
      let otherTenantId: string;

      beforeEach(async () => {
        otherTenantId = await createTenant(services, adminUserId);
        otherOrigin = { type: 'client', userId: adminUserId, tenantId: otherTenantId };
      });

      it('should not merge a tag into another tenant\'s tag, either way', async () => {
        await createManualAsset('host-1', ['alpha']);
        await createManualAsset('other-host', ['foreign'], otherOrigin);
        const ownId = await tagIdOf('alpha');
        const foreignId = await tagIdOf('foreign', otherTenantId);

        await expect(assets().mergeTag(ownId, foreignId)).rejects.toBeInstanceOf(TagNotFoundError);
        await expect(assets().mergeTag(foreignId, ownId)).rejects.toBeInstanceOf(TagNotFoundError);
        expect(await mergePointerOf(ownId)).toEqual({ mergedIntoTagId: null, mergedAt: null });
      });

      it('should not rename, delete or unmerge another tenant\'s tag', async () => {
        await createManualAsset('other-host', ['foreign', 'foreign-root'], otherOrigin);
        const foreignId = await tagIdOf('foreign', otherTenantId);
        await services.withOrigin(otherOrigin).supportingAssets.mergeTag(foreignId, await tagIdOf('foreign-root', otherTenantId));

        await expect(assets().renameTag(foreignId, 'mine')).rejects.toBeInstanceOf(TagNotFoundError);
        await expect(assets().deleteTag(foreignId)).rejects.toBeInstanceOf(TagNotFoundError);
        await expect(assets().unmergeTag(foreignId)).rejects.toBeInstanceOf(TagNotFoundError);
        expect(await db.select().from(tags).where(eq(tags.tenantId, otherTenantId))).toHaveLength(2);
        expect((await mergePointerOf(foreignId)).mergedIntoTagId).not.toBeNull();
      });
    });
  });

  describe('reads and writes follow merges', () => {
    const tagsOf = async (assetId: string) => (await assets().getSupportingAsset(assetId))!.tags;

    it('should show only the target, once, on an asset that carried both tags', async () => {
      const bothId = await createManualAsset('both', ['alpha', 'beta']);
      const onlyMergedId = await createManualAsset('only-merged', ['alpha']);
      const targetId = await tagIdOf('beta');

      await assets().mergeTag(await tagIdOf('alpha'), targetId);

      expect(await tagsOf(bothId)).toEqual([{ id: targetId, name: 'beta', color: null, isManual: true }]);
      expect(await tagsOf(onlyMergedId)).toEqual([{ id: targetId, name: 'beta', color: null, isManual: true }]);
    });

    it('should keep isManual false on an asset only a connector tagged through the merged tag', async () => {
      const openaevTagId = await upsertOpenaevTag('oa-1', 'Production');
      const connectorAssetId = await createConnectorAsset('ep-1', [openaevTagId]);
      await createManualAsset('host-1', ['prod']);
      const targetId = await tagIdOf('prod');

      await assets().mergeTag(openaevTagId, targetId);

      expect(await tagsOf(connectorAssetId)).toEqual([{ id: targetId, name: 'prod', color: null, isManual: false }]);
    });

    it('should give every asset back exactly its own tags when the merge is undone', async () => {
      const bothId = await createManualAsset('both', ['alpha', 'beta']);
      const onlyMergedId = await createManualAsset('only-merged', ['alpha']);
      const mergedId = await tagIdOf('alpha');
      await assets().mergeTag(mergedId, await tagIdOf('beta'));

      await assets().unmergeTag(mergedId);

      expect([...(await tagNamesOf(bothId))].sort()).toEqual(['alpha', 'beta']);
      expect(await tagNamesOf(onlyMergedId)).toEqual(['alpha']);
    });

    it('should link an asset to the root when a merged tag\'s name is typed', async () => {
      await createManualAsset('host-1', ['alpha', 'beta']);
      const rootId = await tagIdOf('beta');
      await assets().mergeTag(await tagIdOf('alpha'), rootId);
      const assetId = await createManualAsset('host-2', []);

      await assets().updateSupportingAsset(assetId, { tagNames: ['alpha'] });

      const links = await db.select().from(supportingAssetTags).where(eq(supportingAssetTags.supportingAssetId, assetId));
      expect(links.map((link) => link.tagId)).toEqual([rootId]);
      expect(await tagNamesOf(assetId)).toEqual(['beta']);
    });

    it('should give the root one manual origin when two typed names lead to it', async () => {
      const openaevTagId = await upsertOpenaevTag('oa-1', 'Production');
      await createManualAsset('host-1', ['alpha']);
      await assets().mergeTag(await tagIdOf('alpha'), openaevTagId);
      const assetId = await createManualAsset('host-2', []);

      await assets().updateSupportingAsset(assetId, { tagNames: ['alpha', 'Production'] });

      const manualOrigins = await db.select().from(tagSources).where(and(eq(tagSources.tagId, openaevTagId), isNull(tagSources.sourceTagId)));
      expect(manualOrigins).toHaveLength(1);
      expect(await tagNamesOf(assetId)).toEqual(['Production']);
    });

    it('should leave a merged OpenAEV tag merged through a sync that reports it unchanged', async () => {
      const openaevTagId = await upsertOpenaevTag('oa-1', 'Production');
      const connectorAssetId = await createConnectorAsset('ep-1', [openaevTagId]);
      await createManualAsset('host-1', ['prod']);
      await assets().mergeTag(openaevTagId, await tagIdOf('prod'));

      const syncedTagId = await upsertOpenaevTag('oa-1', 'Production');
      await services.withOrigin(connectorOrigin).supportingAssets.setAssetTags(connectorId, [{ supportingAssetId: connectorAssetId, tagIds: [syncedTagId] }]);

      expect(syncedTagId).toBe(openaevTagId);
      expect((await mergePointerOf(openaevTagId)).mergedIntoTagId).toBe(await tagIdOf('prod'));
      expect(await tagNamesOf(connectorAssetId)).toEqual(['prod']);
    });

    it('should keep a tag other tags are merged into when OpenAEV renames its origin to an existing name', async () => {
      const openaevTagId = await upsertOpenaevTag('oa-1', 'old');
      await createManualAsset('host-1', ['alpha', 'target']);
      await assets().mergeTag(await tagIdOf('alpha'), openaevTagId);

      await upsertOpenaevTag('oa-1', 'target');

      expect(await db.select().from(tags).where(eq(tags.id, openaevTagId))).toHaveLength(1);
      expect((await mergePointerOf(await tagIdOf('alpha'))).mergedIntoTagId).toBe(openaevTagId);
    });

    it('should keep a user\'s rename through an OpenAEV rename of the tag', async () => {
      const tagId = await upsertOpenaevTag('oa-1', 'Production');
      const connectorAssetId = await createConnectorAsset('ep-1', [tagId]);
      await assets().renameTag(tagId, 'prod-eu');

      expect(await upsertOpenaevTag('oa-1', 'Production v2')).toBe(tagId);

      expect(await tagNamesOf(connectorAssetId)).toEqual(['prod-eu']);
      const origins = await db.select().from(tagSources).where(eq(tagSources.tagId, tagId));
      expect(origins.map((origin) => origin.reportedName)).toEqual(['Production v2']);
    });

    it('should keep a user\'s rename when OpenAEV renames the tag to another tag\'s name', async () => {
      const tagId = await upsertOpenaevTag('oa-1', 'Production');
      const connectorAssetId = await createConnectorAsset('ep-1', [tagId]);
      await createManualAsset('host-1', ['Staging']);
      await assets().renameTag(tagId, 'prod-eu');

      expect(await upsertOpenaevTag('oa-1', 'Staging')).toBe(tagId);

      expect(await tagNamesOf(connectorAssetId)).toEqual(['prod-eu']);
    });

    it('should create a new tag for a name a user-renamed tag\'s origin takes in the same sync', async () => {
      const tagId = await upsertOpenaevTag('oa-1', 'Production');
      await assets().renameTag(tagId, 'prod-eu');

      const idBySourceTagId = await services.withOrigin(connectorOrigin).supportingAssets.upsertTagVocabulary(connectorId, [
        { sourceTagId: 'oa-1', name: 'Staging', color: '#ff0000' },
        { sourceTagId: 'oa-2', name: 'Staging', color: '#ff0000' },
      ]);

      expect(idBySourceTagId.get('oa-1')).toBe(tagId);
      expect(idBySourceTagId.get('oa-2')).not.toBe(tagId);
      expect(idBySourceTagId.get('oa-2')).toBe(await tagIdOf('Staging'));
    });

    it('should keep a merge through an OpenAEV rename of a merged tag a person also typed', async () => {
      const openaevTagId = await upsertOpenaevTag('oa-1', 'Prod');
      const connectorAssetId = await createConnectorAsset('ep-1', [openaevTagId]);
      await createManualAsset('host-1', ['Prod', 'production']);
      await assets().mergeTag(openaevTagId, await tagIdOf('production'));

      expect(await upsertOpenaevTag('oa-1', 'PROD')).toBe(openaevTagId);

      expect(await tagNamesOf(connectorAssetId)).toEqual(['production']);
    });

    it('should resolve a chain to its root, and to the middle tag once that link is undone', async () => {
      const assetId = await createManualAsset('host-1', ['alpha']);
      await createManualAsset('host-2', ['beta', 'gamma']);
      const [alphaId, betaId, gammaId] = [await tagIdOf('alpha'), await tagIdOf('beta'), await tagIdOf('gamma')];
      await assets().mergeTag(alphaId, betaId);
      await assets().mergeTag(betaId, gammaId);

      expect(await tagNamesOf(assetId)).toEqual(['gamma']);

      await assets().unmergeTag(betaId);

      expect(await tagNamesOf(assetId)).toEqual(['beta']);
    });
  });
});

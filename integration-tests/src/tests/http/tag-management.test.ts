import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { tags } from '@app/module';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenant } from '../../helpers/factories';
import { createTrpcTestClient } from '../../helpers/trpc-client';
import { db } from '../../setup/db';
import { createTestServices, truncateAllTables } from '../../setup/test-context';
import { getTestServer } from '../../setup/test-server';
import { signInAsFirstAdmin } from '../../helpers/sign-in';

const ADMIN_EMAIL = 'admin@test.com';

describe('Tag management (HTTP/tRPC)', () => {
  const services = createTestServices(db);
  let client: ReturnType<typeof createTrpcTestClient>;
  let tenantId: string;
  let otherTenantId: string;

  beforeEach(async () => {
    await truncateAllTables(db);
    const server = await getTestServer();
    client = createTrpcTestClient(server);

    const adminId = uuidv7();
    await signInAsFirstAdmin(client, { id: adminId, email: ADMIN_EMAIL });

    tenantId = await createTenant(services, adminId);
    otherTenantId = await createTenant(services, adminId);
    await createTaggedAsset(adminId, tenantId, ['alpha', 'bravo']);
    await createTaggedAsset(adminId, otherTenantId, ['foreign']);
  });

  const createTaggedAsset = async (userId: string, assetTenantId: string, tagNames: Array<string>) => {
    await services.withOrigin({ type: 'client', userId, tenantId: assetTenantId }).supportingAssets.createSupportingAsset({
      id: uuidv7(), name: 'host', exposure: 'internal', categoryId: 'host', tagNames,
    });
  };

  const tagIdOf = async (name: string, ofTenantId: string) => {
    const [row] = await db.select().from(tags).where(and(eq(tags.tenantId, ofTenantId), eq(tags.name, name)));
    return row.id;
  };

  const expectCode = (res: Awaited<ReturnType<typeof client.mutation>>, code: string) => {
    expect(res.json.error.data.code).toBe(code);
  };

  it('should answer CONFLICT when renaming a tag to a name another tag holds', async () => {
    const res = await client.mutation('supportingAssets.renameTag', { tagId: await tagIdOf('alpha', tenantId), name: 'bravo' }, { tenantId });

    expectCode(res, 'CONFLICT');
  });

  it('should answer BAD_REQUEST when renaming a tag to a blank name', async () => {
    const res = await client.mutation('supportingAssets.renameTag', { tagId: await tagIdOf('alpha', tenantId), name: '   ' }, { tenantId });

    expectCode(res, 'BAD_REQUEST');
  });

  it('should answer BAD_REQUEST when merging a tag into itself', async () => {
    const tagId = await tagIdOf('alpha', tenantId);

    const res = await client.mutation('supportingAssets.mergeTag', { tagId, targetTagId: tagId }, { tenantId });

    expectCode(res, 'BAD_REQUEST');
  });

  describe('another tenant\'s tag', () => {
    it('should answer NOT_FOUND on rename', async () => {
      const res = await client.mutation('supportingAssets.renameTag', { tagId: await tagIdOf('foreign', otherTenantId), name: 'mine' }, { tenantId });

      expectCode(res, 'NOT_FOUND');
    });

    it('should answer NOT_FOUND on merge, as the source or as the target', async () => {
      const ownId = await tagIdOf('alpha', tenantId);
      const foreignId = await tagIdOf('foreign', otherTenantId);

      expectCode(await client.mutation('supportingAssets.mergeTag', { tagId: foreignId, targetTagId: ownId }, { tenantId }), 'NOT_FOUND');
      expectCode(await client.mutation('supportingAssets.mergeTag', { tagId: ownId, targetTagId: foreignId }, { tenantId }), 'NOT_FOUND');
    });

    it('should answer NOT_FOUND on unmerge', async () => {
      const res = await client.mutation('supportingAssets.unmergeTag', { tagId: await tagIdOf('foreign', otherTenantId) }, { tenantId });

      expectCode(res, 'NOT_FOUND');
    });

    it('should answer NOT_FOUND on delete', async () => {
      const res = await client.mutation('supportingAssets.deleteTag', { tagId: await tagIdOf('foreign', otherTenantId) }, { tenantId });

      expectCode(res, 'NOT_FOUND');
    });
  });
});

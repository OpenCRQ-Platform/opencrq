import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { newError } from '@app/utils';
import { primaryAssetBusinessValueCategories } from '../business-value-categories/schema';
import { defineRepository } from '../../registry';
import { orderByFolded } from '../../db/fold-text';
import { primaryAssets } from './schema';

export const primaryAssetsRepository = defineRepository({
  insertPrimaryAsset: ({ db }, values: typeof primaryAssets.$inferInsert) =>
    db.insert(primaryAssets).values([values]),
  updatePrimaryAsset: ({ db }, id: string, values: Partial<typeof primaryAssets.$inferInsert>) =>
    db.update(primaryAssets).set(values).where(eq(primaryAssets.id, id)),
  deletePrimaryAssets: ({ db }, ids: Array<string>) =>
    db.delete(primaryAssets).where(inArray(primaryAssets.id, ids)),

  insertBusinessValueCategoryAssignments: ({ db }, values: Array<typeof primaryAssetBusinessValueCategories.$inferInsert>) =>
    db.insert(primaryAssetBusinessValueCategories).values(values),

  deleteBusinessValueCategoryAssignmentsByIds: ({ db }, primaryAssetId: string, businessValueCategoryIds: Array<string>) =>
    db.delete(primaryAssetBusinessValueCategories).where(
      and(
        eq(primaryAssetBusinessValueCategories.primaryAssetId, primaryAssetId),
        inArray(primaryAssetBusinessValueCategories.businessValueCategoryId, businessValueCategoryIds),
      ),
    ),

  validateBusinessValueCategoryIds: async ({ db, views }, ids: Array<string>) => {
    if (ids.length === 0) {
      return;
    }
    const found = await db
      .select({ id: views.businessValueCategories.id })
      .from(views.businessValueCategories)
      .where(inArray(views.businessValueCategories.id, ids));
    if (found.length !== new Set(ids).size) {
      throw newError('Access Denied');
    }
  },
  findBusinessValueCategoryAssignmentIds: async ({ db, views }, primaryAssetId: string) => {
    const rows = await db
      .select({ businessValueCategoryId: views.primaryAssetBusinessValueCategories.businessValueCategoryId })
      .from(views.primaryAssetBusinessValueCategories)
      .where(eq(views.primaryAssetBusinessValueCategories.primaryAssetId, primaryAssetId));
    return rows.map((r) => r.businessValueCategoryId);
  },
  findPrimaryAssetById: async ({ db, views }, id: string) => {
    const row = (await db
      .select({
        id: views.primaryAssets.id,
        organizationId: views.primaryAssets.organizationId,
        name: views.primaryAssets.name,
        description: views.primaryAssets.description,
        ownerId: views.primaryAssets.ownerId,
        reference: views.primaryAssets.reference,
        businessFunction: views.primaryAssets.businessFunction,
        availability: views.primaryAssets.availability,
        integrity: views.primaryAssets.integrity,
        confidentiality: views.primaryAssets.confidentiality,
        traceability: views.primaryAssets.traceability,
        rtoMinutes: views.primaryAssets.rtoMinutes,
        rpoMinutes: views.primaryAssets.rpoMinutes,
        mtpdMinutes: views.primaryAssets.mtpdMinutes,
        owner: {
          id: views.users.id,
          name: views.users.name,
        },
        organization: {
          id: views.organizations.id,
          name: views.organizations.name,
        },
      })
      .from(views.primaryAssets)
      .leftJoin(views.users, eq(views.primaryAssets.ownerId, views.users.id))
      .leftJoin(views.organizations, eq(views.primaryAssets.organizationId, views.organizations.id))
      .where(eq(views.primaryAssets.id, id))
      .limit(1)).at(0);
    if (!row) {
      return undefined;
    }
    const businessValueCategories = await db
      .select({
        id: views.businessValueCategories.id,
        code: views.businessValueCategories.code,
        name: views.businessValueCategories.name,
      })
      .from(views.primaryAssetBusinessValueCategories)
      .innerJoin(views.businessValueCategories, eq(views.primaryAssetBusinessValueCategories.businessValueCategoryId, views.businessValueCategories.id))
      .where(eq(views.primaryAssetBusinessValueCategories.primaryAssetId, id))
      .orderBy(asc(views.businessValueCategories.displayOrder));
    return { ...row, businessValueCategories };
  },
  findAllPrimaryAssets: async ({ db, views }, organizationId: string) => {
    const organizationFilter = eq(views.primaryAssets.organizationId, organizationId);
    const result = await db
      .select({
        id: views.primaryAssets.id,
        organizationId: views.primaryAssets.organizationId,
        name: views.primaryAssets.name,
        description: views.primaryAssets.description,
        ownerId: views.primaryAssets.ownerId,
        reference: views.primaryAssets.reference,
        businessFunction: views.primaryAssets.businessFunction,
        availability: views.primaryAssets.availability,
        integrity: views.primaryAssets.integrity,
        confidentiality: views.primaryAssets.confidentiality,
        traceability: views.primaryAssets.traceability,
        rtoMinutes: views.primaryAssets.rtoMinutes,
        rpoMinutes: views.primaryAssets.rpoMinutes,
        mtpdMinutes: views.primaryAssets.mtpdMinutes,
        onboardingTemplate: views.primaryAssets.onboardingTemplate,
        owner: {
          id: views.users.id,
          name: views.users.name,
        },
      })
      .from(views.primaryAssets)
      .leftJoin(views.users, eq(views.primaryAssets.ownerId, views.users.id))
      .where(organizationFilter);

    const assetIds = result.map((r) => r.id);
    const allCategories = assetIds.length > 0
      ? await db
        .select({
          primaryAssetId: views.primaryAssetBusinessValueCategories.primaryAssetId,
          id: views.businessValueCategories.id,
          code: views.businessValueCategories.code,
          name: views.businessValueCategories.name,
        })
        .from(views.primaryAssetBusinessValueCategories)
        .innerJoin(views.businessValueCategories, eq(views.primaryAssetBusinessValueCategories.businessValueCategoryId, views.businessValueCategories.id))
        .where(inArray(views.primaryAssetBusinessValueCategories.primaryAssetId, assetIds))
        .orderBy(asc(views.businessValueCategories.displayOrder))
      : [];

    const categoriesByAssetId = new Map<string, Array<{ id: string, code: string, name: string }>>();
    for (const c of allCategories) {
      const list = categoriesByAssetId.get(c.primaryAssetId) ?? [];
      list.push({ id: c.id, code: c.code, name: c.name });
      categoriesByAssetId.set(c.primaryAssetId, list);
    }

    return result.map((row) => ({
      ...row,
      businessValueCategories: categoriesByAssetId.get(row.id) ?? [],
    }));
  },
  /** The other primary asset of the risk scope holding this reference, if any. */
  findPrimaryAssetIdByReference: async ({ db, views }, organizationId: string, reference: string, excludedId: string | null) => {
    const rows = await db
      .select({ id: views.primaryAssets.id })
      .from(views.primaryAssets)
      .where(and(
        eq(views.primaryAssets.organizationId, organizationId),
        eq(views.primaryAssets.reference, reference),
        excludedId === null ? undefined : ne(views.primaryAssets.id, excludedId),
      ))
      .limit(1);
    return rows.at(0)?.id;
  },
  findPrimaryAssetsWithScope: ({ db, views }) =>
    db
      .select({
        id: views.primaryAssets.id,
        name: views.primaryAssets.name,
        organization: {
          id: views.organizations.id,
          name: views.organizations.name,
        },
        owner: {
          id: views.users.id,
          name: views.users.name,
          email: views.users.email,
        },
      })
      .from(views.primaryAssets)
      .innerJoin(views.organizations, eq(views.primaryAssets.organizationId, views.organizations.id))
      .leftJoin(views.users, eq(views.primaryAssets.ownerId, views.users.id))
      .orderBy(...orderByFolded(views.primaryAssets.nameFolded, views.primaryAssets.name, false), asc(views.primaryAssets.id)),
});

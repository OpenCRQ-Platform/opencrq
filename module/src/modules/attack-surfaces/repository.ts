import { and, asc, count, eq, inArray, or } from 'drizzle-orm';
import type { AssetCategory } from '../supporting-assets/constants';
import { defineRepository } from '../../registry';

export const attackSurfacesRepository = defineRepository({
  findAllAttackSurfaces: ({ db, views }) => db.select({
    id: views.attackSurfaces.id,
    tenantId: views.attackSurfaces.tenantId,
    categoryId: views.attackSurfaces.categoryId,
    createdAt: views.attackSurfaces.createdAt,
    updatedAt: views.attackSurfaces.updatedAt,
  })
    .from(views.attackSurfaces),

  findApplicableTechniquesByCategory: ({ db, views }, categoryId: AssetCategory) => db
    .select({
      id: views.mitreTechniques.id,
      externalId: views.mitreTechniques.externalId,
      name: views.mitreTechniques.name,
      isSubtechnique: views.mitreTechniques.isSubtechnique,
      url: views.mitreTechniques.url,
    })
    .from(views.attackSurfaceMitreTechniques)
    .innerJoin(views.attackSurfaces, eq(views.attackSurfaceMitreTechniques.attackSurfaceId, views.attackSurfaces.id))
    .innerJoin(views.mitreTechniques, eq(views.attackSurfaceMitreTechniques.mitreTechniqueId, views.mitreTechniques.id))
    .where(eq(views.attackSurfaces.categoryId, categoryId))
    .orderBy(asc(views.mitreTechniques.externalId)),

  findAllLiveTechniques: ({ db, views }) => db
    .select({
      id: views.mitreTechniques.id,
      externalId: views.mitreTechniques.externalId,
      name: views.mitreTechniques.name,
      isSubtechnique: views.mitreTechniques.isSubtechnique,
      url: views.mitreTechniques.url,
    })
    .from(views.mitreTechniques)
    .where(eq(views.mitreTechniques.revoked, false))
    .orderBy(asc(views.mitreTechniques.externalId)),

  countApplicableTechniquesPerCategory: ({ db, views }) => db
    .select({
      categoryId: views.attackSurfaces.categoryId,
      techniqueCount: count(views.attackSurfaceMitreTechniques.mitreTechniqueId),
    })
    .from(views.attackSurfaceMitreTechniques)
    .innerJoin(views.attackSurfaces, eq(views.attackSurfaceMitreTechniques.attackSurfaceId, views.attackSurfaces.id))
    .groupBy(views.attackSurfaces.categoryId),

  /**
   * Every applicable pair reached by the given techniques or by any sub-case of theirs.
   * The parent id travels with each row so the caller can fold a sub-case back onto the technique
   * it was asked about; resolving the branch rule in SQL would need a second pass anyway.
   * `tenantId` is the caller's own scoping: the secured views apply no tenant filter under a
   * `system` origin, and the junction is per-tenant, so a job has to name the tenant it answers for.
   */
  findApplicablePairsForTechniques: async ({ db, views }, techniqueIds: Array<string>, tenantId?: string) => {
    if (techniqueIds.length === 0) {
      return [];
    }
    return db
      .select({
        categoryId: views.attackSurfaces.categoryId,
        mitreTechniqueId: views.attackSurfaceMitreTechniques.mitreTechniqueId,
        parentTechniqueId: views.mitreTechniques.parentTechniqueId,
      })
      .from(views.attackSurfaceMitreTechniques)
      .innerJoin(views.attackSurfaces, eq(views.attackSurfaceMitreTechniques.attackSurfaceId, views.attackSurfaces.id))
      .innerJoin(views.mitreTechniques, eq(views.attackSurfaceMitreTechniques.mitreTechniqueId, views.mitreTechniques.id))
      .where(and(
        or(
          inArray(views.attackSurfaceMitreTechniques.mitreTechniqueId, techniqueIds),
          inArray(views.mitreTechniques.parentTechniqueId, techniqueIds),
        ),
        tenantId === undefined ? undefined : eq(views.attackSurfaces.tenantId, tenantId),
      ));
  },
});

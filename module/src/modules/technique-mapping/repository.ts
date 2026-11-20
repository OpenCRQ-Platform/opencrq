import { eq, inArray } from 'drizzle-orm';
import { defineRepository } from '../../registry';
import { cveTechniqueMapping, cveTechniqueResolution } from './schema';

// PostgreSQL limit: 65535 params per query. A mapping row carries ~10 columns, so 1000 rows fit.
const BATCH_CHUNK_SIZE = 1000;

export const techniqueMappingRepository = defineRepository({
  findResolutionsByCveIds: async ({ db, views }, cveIds: Array<string>) => {
    if (cveIds.length === 0) {
      return [];
    }
    return db.select({
      cveId: views.cveTechniqueResolution.cveId,
      state: views.cveTechniqueResolution.state,
      tablesVersion: views.cveTechniqueResolution.tablesVersion,
      resolvedAt: views.cveTechniqueResolution.resolvedAt,
    })
      .from(views.cveTechniqueResolution)
      .where(inArray(views.cveTechniqueResolution.cveId, cveIds));
  },

  findMappingsByCveIds: async ({ db, views }, cveIds: Array<string>) => {
    if (cveIds.length === 0) {
      return [];
    }
    return db.select({
      cveId: views.cveTechniqueMapping.cveId,
      mitreTechniqueId: views.cveTechniqueMapping.mitreTechniqueId,
      role: views.cveTechniqueMapping.role,
      lane: views.cveTechniqueMapping.lane,
      grain: views.cveTechniqueMapping.grain,
      techniqueExternalId: views.mitreTechniques.externalId,
      techniqueName: views.mitreTechniques.name,
    })
      .from(views.cveTechniqueMapping)
      .innerJoin(views.mitreTechniques, eq(views.cveTechniqueMapping.mitreTechniqueId, views.mitreTechniques.id))
      .where(inArray(views.cveTechniqueMapping.cveId, cveIds));
  },

  findTechniquesByExternalIds: async ({ db, views }, externalIds: Array<string>) => {
    if (externalIds.length === 0) {
      return [];
    }
    return db.select({
      id: views.mitreTechniques.id,
      externalId: views.mitreTechniques.externalId,
      name: views.mitreTechniques.name,
      isSubtechnique: views.mitreTechniques.isSubtechnique,
    })
      .from(views.mitreTechniques)
      .where(inArray(views.mitreTechniques.externalId, externalIds));
  },

  /**
   * The mapping rows are reached through the resolution row's cascade, so the delete needs no
   * second statement. Sequential awaits on purpose: this runs inside `atomic()`, so `db` is bound
   * to a single transactional connection and concurrent queries on it are queued, not parallel.
   */
  replaceResolutions: async ({ db }, cveIds: Array<string>, resolutions: Array<typeof cveTechniqueResolution.$inferInsert>, mappings: Array<typeof cveTechniqueMapping.$inferInsert>) => {
    if (cveIds.length === 0) {
      return;
    }
    // eslint-disable-next-line app/no-unguarded-rewrite -- the caller passes only the CVEs whose resolution inputs changed
    await db.delete(cveTechniqueResolution).where(inArray(cveTechniqueResolution.cveId, cveIds));
    for (let i = 0; i < resolutions.length; i += BATCH_CHUNK_SIZE) {
      await db.insert(cveTechniqueResolution).values(resolutions.slice(i, i + BATCH_CHUNK_SIZE));
    }
    for (let i = 0; i < mappings.length; i += BATCH_CHUNK_SIZE) {
      await db.insert(cveTechniqueMapping).values(mappings.slice(i, i + BATCH_CHUNK_SIZE));
    }
  },
});

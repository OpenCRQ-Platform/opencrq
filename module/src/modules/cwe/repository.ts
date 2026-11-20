import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { newError } from '@app/utils';
import { uuidv7 } from 'uuidv7';
import type { CweLinkOverrideKind } from './constants';
import { defineRepository } from '../../registry';
import { cweTechniqueOverrides } from './schema';

export const cweRepository = defineRepository({
  findWeaknesses: async ({ db, views }) => db
    .select({
      id: views.cweWeaknesses.id,
      externalId: views.cweWeaknesses.externalId,
      name: views.cweWeaknesses.name,
    })
    .from(views.cweWeaknesses),

  findWeaknessByExternalId: async ({ db, views }, externalId: string) => db
    .select({
      id: views.cweWeaknesses.id,
      externalId: views.cweWeaknesses.externalId,
      name: views.cweWeaknesses.name,
      description: views.cweWeaknesses.description,
    })
    .from(views.cweWeaknesses)
    .where(eq(views.cweWeaknesses.externalId, externalId))
    .limit(1)
    .then((rows) => rows.at(0)),

  findWeaknessIdsByExternalIds: async ({ db, views }, externalIds: Array<string>) => {
    if (externalIds.length === 0) {
      return [];
    }
    return db
      .select({ id: views.cweWeaknesses.id, externalId: views.cweWeaknesses.externalId })
      .from(views.cweWeaknesses)
      .where(inArray(views.cweWeaknesses.externalId, externalIds));
  },

  /** Every shipped row when `cweIds` is omitted, which the catalogue counts over. */
  findShippedLinkRows: async ({ db, views }, cweIds?: Array<string>) => {
    if (cweIds !== undefined && cweIds.length === 0) {
      return [];
    }
    return db
      .select({
        cweId: views.cweTechniqueLinks.cweId,
        techniqueId: views.cweTechniqueLinks.mitreTechniqueId,
        justificationKind: views.cweTechniqueLinks.justificationKind,
        justificationRef: views.cweTechniqueLinks.justificationRef,
        justificationName: views.cweTechniqueLinks.justificationName,
      })
      .from(views.cweTechniqueLinks)
      .where(cweIds === undefined ? undefined : inArray(views.cweTechniqueLinks.cweId, cweIds));
  },

  /**
   * Filtered on the tenant explicitly rather than left to the policy: a system origin reads every
   * tenant's rows through the view, and one tenant's edits must never reach another's link.
   */
  findOverrides: async ({ db, views }, tenantId: string, cweIds?: Array<string>) => {
    if (cweIds !== undefined && cweIds.length === 0) {
      return [];
    }
    return db
      .select({
        cweId: views.cweTechniqueOverrides.cweId,
        techniqueId: views.cweTechniqueOverrides.mitreTechniqueId,
        kind: views.cweTechniqueOverrides.kind,
      })
      .from(views.cweTechniqueOverrides)
      .where(and(
        eq(views.cweTechniqueOverrides.tenantId, tenantId),
        cweIds === undefined ? undefined : inArray(views.cweTechniqueOverrides.cweId, cweIds),
      ));
  },

  findTechniques: async ({ db, views }, techniqueIds: Array<string>) => {
    if (techniqueIds.length === 0) {
      return [];
    }
    return db
      .select({
        id: views.mitreTechniques.id,
        externalId: views.mitreTechniques.externalId,
        name: views.mitreTechniques.name,
        isSubtechnique: views.mitreTechniques.isSubtechnique,
      })
      .from(views.mitreTechniques)
      .where(inArray(views.mitreTechniques.id, techniqueIds));
  },

  /**
   * The distinct weakness lists of the vulnerabilities the tenant's findings carry: a handful of
   * arrays even on a large estate, where the findings themselves run to hundreds of thousands.
   */
  findCweListsOfCvesWithFindings: async ({ db, views }) => db
    .selectDistinct({ cwe: views.cve.cwe })
    .from(views.cve)
    .where(and(
      isNotNull(views.cve.cwe),
      inArray(views.cve.id, db.selectDistinct({ cveId: views.assetEvidence.cveId }).from(views.assetEvidence)
        .where(isNotNull(views.assetEvidence.cveId))),
    )),

  validateTechniqueId: async ({ db, views }, techniqueId: string) => {
    const rows = await db
      .select({ id: views.mitreTechniques.id })
      .from(views.mitreTechniques)
      .where(eq(views.mitreTechniques.id, techniqueId))
      .limit(1);
    if (rows.length === 0) {
      throw newError('Not Found');
    }
  },

  // An upsert because two concurrent first edits of the same technique would both miss the read
  // that precedes them and collide on the unique key.
  upsertOverride: async (
    { db },
    { tenantId, cweId, techniqueId }: { tenantId: string, cweId: string, techniqueId: string },
    kind: CweLinkOverrideKind,
  ) => db.insert(cweTechniqueOverrides)
    .values({ id: uuidv7(), tenantId, cweId, mitreTechniqueId: techniqueId, kind })
    .onConflictDoUpdate({
      target: [cweTechniqueOverrides.tenantId, cweTechniqueOverrides.cweId, cweTechniqueOverrides.mitreTechniqueId],
      set: { kind },
    }),

  deleteOverride: async (
    { db },
    { tenantId, cweId, techniqueId }: { tenantId: string, cweId: string, techniqueId: string },
  ) => db.delete(cweTechniqueOverrides).where(and(
    eq(cweTechniqueOverrides.tenantId, tenantId),
    eq(cweTechniqueOverrides.cweId, cweId),
    eq(cweTechniqueOverrides.mitreTechniqueId, techniqueId),
  )),

  deleteOverridesForCwe: async ({ db }, tenantId: string, cweId: string) => db
    .delete(cweTechniqueOverrides)
    .where(and(eq(cweTechniqueOverrides.tenantId, tenantId), eq(cweTechniqueOverrides.cweId, cweId))),
});

import { and, asc, eq, inArray } from 'drizzle-orm';
import { defineRepository } from '../../registry';

export const mitreAttackRepository = defineRepository({
  findAllTactics: ({ db, views }) => db
    .select()
    .from(views.mitreTactics)
    .orderBy(asc(views.mitreTactics.order)),

  findTacticByExternalId: async ({ db, views }, externalId: string) => {
    const tactic = (await db
      .select()
      .from(views.mitreTactics)
      .where(eq(views.mitreTactics.externalId, externalId))
      .limit(1)).at(0);

    if (!tactic) {
      return undefined;
    }

    // Sub-techniques carry their own tactic rows, so the junction answers at both grains.
    const techniques = await db
      .select({
        id: views.mitreTechniques.id,
        externalId: views.mitreTechniques.externalId,
        name: views.mitreTechniques.name,
        revoked: views.mitreTechniques.revoked,
        isSubtechnique: views.mitreTechniques.isSubtechnique,
      })
      .from(views.mitreTechniqueTactics)
      .innerJoin(views.mitreTechniques, eq(views.mitreTechniqueTactics.techniqueId, views.mitreTechniques.id))
      .where(eq(views.mitreTechniqueTactics.tacticId, tactic.id))
      .orderBy(asc(views.mitreTechniques.externalId));

    return { ...tactic, techniques };
  },

  findAllTechniques: ({ db, views }) => db
    .select({
      id: views.mitreTechniques.id,
      externalId: views.mitreTechniques.externalId,
      name: views.mitreTechniques.name,
      isSubtechnique: views.mitreTechniques.isSubtechnique,
    })
    .from(views.mitreTechniques)
    .where(eq(views.mitreTechniques.revoked, false))
    .orderBy(asc(views.mitreTechniques.externalId)),

  findTechniqueByExternalId: async ({ db, views }, externalId: string) => {
    // The secured view is already a subquery named after the table, so the self-join goes through
    // a second subquery over it rather than alias(), which only takes a table.
    const replacement = db
      .select({ id: views.mitreTechniques.id, externalId: views.mitreTechniques.externalId })
      .from(views.mitreTechniques)
      .as('replacement');
    const row = (await db
      .select()
      .from(views.mitreTechniques)
      .leftJoin(replacement, eq(replacement.id, views.mitreTechniques.replacedByTechniqueId))
      .where(eq(views.mitreTechniques.externalId, externalId))
      .limit(1)).at(0);

    if (!row) {
      return undefined;
    }
    const technique = row.mitre_techniques;
    const { id } = technique;

    // Batch fetch related tactics
    const tactics = await db
      .select({
        id: views.mitreTactics.id,
        externalId: views.mitreTactics.externalId,
        name: views.mitreTactics.name,
      })
      .from(views.mitreTechniqueTactics)
      .innerJoin(views.mitreTactics, eq(views.mitreTechniqueTactics.tacticId, views.mitreTactics.id))
      .where(eq(views.mitreTechniqueTactics.techniqueId, id));

    // Batch fetch sub-techniques (include revoked for badge display)
    const subTechniques = await db
      .select({
        id: views.mitreTechniques.id,
        externalId: views.mitreTechniques.externalId,
        name: views.mitreTechniques.name,
        revoked: views.mitreTechniques.revoked,
      })
      .from(views.mitreTechniques)
      .where(eq(views.mitreTechniques.parentTechniqueId, id))
      .orderBy(asc(views.mitreTechniques.externalId));

    // Batch fetch mitigations
    const mitigations = await db
      .select({
        id: views.mitreMitigations.id,
        externalId: views.mitreMitigations.externalId,
        name: views.mitreMitigations.name,
      })
      .from(views.mitreMitigationTechniques)
      .innerJoin(views.mitreMitigations, eq(views.mitreMitigationTechniques.mitigationId, views.mitreMitigations.id))
      .where(eq(views.mitreMitigationTechniques.techniqueId, id));

    return {
      ...technique,
      replacedByTechniqueExternalId: row.replacement?.externalId ?? null,
      tactics,
      subTechniques,
      mitigations,
    };
  },

  findAllMitigations: ({ db, views }) => db
    .select()
    .from(views.mitreMitigations)
    .orderBy(asc(views.mitreMitigations.externalId)),

  findMitigationByExternalId: async ({ db, views }, externalId: string) => {
    const mitigation = (await db
      .select()
      .from(views.mitreMitigations)
      .where(eq(views.mitreMitigations.externalId, externalId))
      .limit(1)).at(0);

    if (!mitigation) {
      return undefined;
    }

    // Batch fetch related techniques (include revoked for badge display)
    const techniques = await db
      .select({
        id: views.mitreTechniques.id,
        externalId: views.mitreTechniques.externalId,
        name: views.mitreTechniques.name,
        revoked: views.mitreTechniques.revoked,
        isSubtechnique: views.mitreTechniques.isSubtechnique,
      })
      .from(views.mitreMitigationTechniques)
      .innerJoin(views.mitreTechniques, eq(views.mitreMitigationTechniques.techniqueId, views.mitreTechniques.id))
      .where(eq(views.mitreMitigationTechniques.mitigationId, mitigation.id))
      .orderBy(asc(views.mitreTechniques.externalId));

    return { ...mitigation, techniques };
  },

  findMatrixData: async ({ db, views }) => {
    const tactics = await db
      .select()
      .from(views.mitreTactics)
      .orderBy(asc(views.mitreTactics.order));

    const tacticIds = tactics.map((t) => t.id);

    const junctions = tacticIds.length > 0
      ? await db
        .select()
        .from(views.mitreTechniqueTactics)
        .where(inArray(views.mitreTechniqueTactics.tacticId, tacticIds))
      : [];

    const techniqueIdsSubquery = db
      .selectDistinct({ techniqueId: views.mitreTechniqueTactics.techniqueId })
      .from(views.mitreTechniqueTactics)
      .where(inArray(views.mitreTechniqueTactics.tacticId, tacticIds));

    const techniquesFilter = and(
      inArray(views.mitreTechniques.id, techniqueIdsSubquery),
      eq(views.mitreTechniques.revoked, false),
    );

    const techniques = junctions.length > 0
      ? await db
        .select({
          id: views.mitreTechniques.id,
          externalId: views.mitreTechniques.externalId,
          name: views.mitreTechniques.name,
          isSubtechnique: views.mitreTechniques.isSubtechnique,
          parentTechniqueId: views.mitreTechniques.parentTechniqueId,
        })
        .from(views.mitreTechniques)
        .where(techniquesFilter)
        .orderBy(asc(views.mitreTechniques.externalId))
      : [];

    // Also fetch sub-techniques of the parent techniques found
    const parentIdsSubquery = db
      .select({ id: views.mitreTechniques.id })
      .from(views.mitreTechniques)
      .where(and(techniquesFilter, eq(views.mitreTechniques.isSubtechnique, false)));

    const allSubTechniques = techniques.length > 0
      ? await db
        .select({
          id: views.mitreTechniques.id,
          externalId: views.mitreTechniques.externalId,
          name: views.mitreTechniques.name,
          isSubtechnique: views.mitreTechniques.isSubtechnique,
          parentTechniqueId: views.mitreTechniques.parentTechniqueId,
        })
        .from(views.mitreTechniques)
        .where(and(inArray(views.mitreTechniques.parentTechniqueId, parentIdsSubquery), eq(views.mitreTechniques.revoked, false)))
        .orderBy(asc(views.mitreTechniques.externalId))
      : [];

    const existingIds = new Set(techniques.map((t) => t.id));
    const uniqueSubTechniques = allSubTechniques.filter((t) => !existingIds.has(t.id));

    return {
      tactics,
      techniques: [...techniques, ...uniqueSubTechniques],
      junctions,
    };
  },

  findTechniqueIdsByExternalIds: async ({ db, views }, externalIds: Array<string>) => {
    if (externalIds.length === 0) {
      return new Map<string, string>();
    }
    const rows = await db
      .select({ id: views.mitreTechniques.id, externalId: views.mitreTechniques.externalId })
      .from(views.mitreTechniques)
      .where(inArray(views.mitreTechniques.externalId, externalIds));
    return new Map(rows.map((r) => [r.externalId, r.id]));
  },
});

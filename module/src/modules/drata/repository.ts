import { and, count, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { newError } from '@app/utils';
import type { SecuredSchema } from '../../security';
import { diffRows } from '../../db/row-diff';
import { updatedAtOnDataChange, valuesChange } from '../../db/write-guards';
import { defineRepository } from '../../registry';
import { orderByFolded } from '../../db/fold-text';
import { drataControls, drataFrameworks, drataRequirementControls, drataRequirements } from './schema';

const linkKey = (link: { requirementId: string, controlId: string }) => `${link.requirementId}::${link.controlId}`;

/** The columns a control row exposes to a client, shared by every read that projects one. */
const controlRowColumns = (views: SecuredSchema) => ({
  id: views.drataControls.id,
  code: views.drataControls.code,
  name: views.drataControls.name,
  isReady: views.drataControls.isReady,
  isMonitored: views.drataControls.isMonitored,
  hasEvidence: views.drataControls.hasEvidence,
  hasPolicy: views.drataControls.hasPolicy,
  archivedAt: views.drataControls.archivedAt,
});

export const drataRepository = defineRepository({
  findFrameworksByTenant: async ({ db, views }, tenantId: string) =>
    db.select({
      id: views.drataFrameworks.id,
      tenantId: views.drataFrameworks.tenantId,
      drataId: views.drataFrameworks.drataId,
      slug: views.drataFrameworks.slug,
      tag: views.drataFrameworks.tag,
      name: views.drataFrameworks.name,
      description: views.drataFrameworks.description,
      isReady: views.drataFrameworks.isReady,
      numInScopeRequirements: views.drataFrameworks.numInScopeRequirements,
      numReadyInScopeRequirements: views.drataFrameworks.numReadyInScopeRequirements,
      numInScopeControls: views.drataFrameworks.numInScopeControls,
      lastReportedAt: views.drataFrameworks.lastReportedAt,
      createdAt: views.drataFrameworks.createdAt,
      updatedAt: views.drataFrameworks.updatedAt,
      derivedTotalRequirements: count(views.drataRequirements.id),
      derivedInScopeRequirements: sql<number>`(count(*) filter (where ${views.drataRequirements.isInScope}))::int`,
      derivedReadyInScopeRequirements: sql<number>`(count(*) filter (where ${views.drataRequirements.isInScope} and ${views.drataRequirements.isReady}))::int`,
    })
      .from(views.drataFrameworks)
      .leftJoin(views.drataRequirements, eq(views.drataRequirements.frameworkId, views.drataFrameworks.id))
      .where(eq(views.drataFrameworks.tenantId, tenantId))
      .groupBy(
        views.drataFrameworks.id,
        views.drataFrameworks.tenantId,
        views.drataFrameworks.drataId,
        views.drataFrameworks.slug,
        views.drataFrameworks.tag,
        views.drataFrameworks.name,
        views.drataFrameworks.nameFolded,
        views.drataFrameworks.description,
        views.drataFrameworks.isReady,
        views.drataFrameworks.numInScopeRequirements,
        views.drataFrameworks.numReadyInScopeRequirements,
        views.drataFrameworks.numInScopeControls,
        views.drataFrameworks.lastReportedAt,
        views.drataFrameworks.createdAt,
        views.drataFrameworks.updatedAt,
      )
      .orderBy(...orderByFolded(views.drataFrameworks.nameFolded, views.drataFrameworks.name, false)),

  findFrameworkById: async ({ db, views }, id: string) =>
    db.select().from(views.drataFrameworks)
      .where(eq(views.drataFrameworks.id, id))
      .limit(1)
      .then((r) => r.at(0) ?? null),

  findRequirementsByFramework: async ({ db, views }, frameworkId: string) =>
    db.select({
      id: views.drataRequirements.id,
      code: views.drataRequirements.code,
      name: views.drataRequirements.name,
      category: views.drataRequirements.category,
      isInScope: views.drataRequirements.isInScope,
      isReady: views.drataRequirements.isReady,
      controlCount: count(views.drataRequirementControls.controlId),
    })
      .from(views.drataRequirements)
      .leftJoin(views.drataRequirementControls, eq(views.drataRequirementControls.requirementId, views.drataRequirements.id))
      .where(eq(views.drataRequirements.frameworkId, frameworkId))
      .groupBy(
        views.drataRequirements.id,
        views.drataRequirements.code,
        views.drataRequirements.name,
        views.drataRequirements.category,
        views.drataRequirements.isInScope,
        views.drataRequirements.isReady,
      )
      .orderBy(views.drataRequirements.code),

  findRequirementById: async ({ db, views }, id: string) =>
    db.select().from(views.drataRequirements)
      .where(eq(views.drataRequirements.id, id))
      .limit(1)
      .then((r) => r.at(0) ?? null),

  // Archived mirror controls carry stale readiness, so the derivation never reads them.
  findLiveControlReadiness: async ({ db, views }, tenantId: string) =>
    db.select({
      code: views.drataControls.code,
      name: views.drataControls.name,
      isReady: views.drataControls.isReady,
    })
      .from(views.drataControls)
      .where(and(
        eq(views.drataControls.tenantId, tenantId),
        isNull(views.drataControls.archivedAt),
      ))
      .orderBy(views.drataControls.code),

  findControlsByRequirement: async ({ db, views }, requirementId: string) =>
    db.select(controlRowColumns(views))
      .from(views.drataControls)
      .innerJoin(views.drataRequirementControls, eq(views.drataRequirementControls.controlId, views.drataControls.id))
      .where(eq(views.drataRequirementControls.requirementId, requirementId))
      .orderBy(views.drataControls.code),

  findControlsByFramework: async ({ db, views }, frameworkId: string) =>
    db.select({ ...controlRowColumns(views), requirementCount: count(views.drataRequirements.id) })
      .from(views.drataControls)
      .innerJoin(views.drataRequirementControls, eq(views.drataRequirementControls.controlId, views.drataControls.id))
      .innerJoin(views.drataRequirements, eq(views.drataRequirements.id, views.drataRequirementControls.requirementId))
      .where(eq(views.drataRequirements.frameworkId, frameworkId))
      .groupBy(...Object.values(controlRowColumns(views)))
      .orderBy(views.drataControls.code),

  findFrameworkIdsByDrataId: async ({ db, views }, tenantId: string) =>
    db.select({ id: views.drataFrameworks.id, drataId: views.drataFrameworks.drataId })
      .from(views.drataFrameworks)
      .where(eq(views.drataFrameworks.tenantId, tenantId))
      .then((rows) => new Map(rows.map((r) => [r.drataId, r.id]))),

  findRequirementIdsByDrataId: async ({ db, views }, frameworkId: string) =>
    db.select({ id: views.drataRequirements.id, drataId: views.drataRequirements.drataId })
      .from(views.drataRequirements)
      .where(eq(views.drataRequirements.frameworkId, frameworkId))
      .then((rows) => new Map(rows.map((r) => [r.drataId, r.id]))),

  findControlIdsByDrataId: async ({ db, views }, tenantId: string) =>
    db.select({ id: views.drataControls.id, drataId: views.drataControls.drataId })
      .from(views.drataControls)
      .where(eq(views.drataControls.tenantId, tenantId))
      .then((rows) => new Map(rows.map((r) => [r.drataId, r.id]))),

  upsertFrameworks: async ({ db }, rows: Array<typeof drataFrameworks.$inferInsert>) => {
    if (rows.length === 0) {
      return;
    }
    const set = {
      slug: sql`excluded.slug`,
      tag: sql`excluded.tag`,
      name: sql`excluded.name`,
      description: sql`excluded.description`,
      isReady: sql`excluded.is_ready`,
      numInScopeRequirements: sql`excluded.num_in_scope_requirements`,
      numReadyInScopeRequirements: sql`excluded.num_ready_in_scope_requirements`,
      numInScopeControls: sql`excluded.num_in_scope_controls`,
      lastReportedAt: sql`excluded.last_reported_at`,
    };
    await db.insert(drataFrameworks).values(rows).onConflictDoUpdate({
      target: [drataFrameworks.tenantId, drataFrameworks.drataId],
      set: { ...set, updatedAt: updatedAtOnDataChange(drataFrameworks, set) },
      setWhere: valuesChange(drataFrameworks, set),
    });
  },

  deleteFrameworksNotIn: async ({ db }, tenantId: string, keptDrataIds: Array<number>) =>
    db.delete(drataFrameworks).where(keptDrataIds.length > 0
      ? and(eq(drataFrameworks.tenantId, tenantId), notInArray(drataFrameworks.drataId, keptDrataIds))
      : eq(drataFrameworks.tenantId, tenantId)),

  upsertRequirements: async ({ db }, rows: Array<typeof drataRequirements.$inferInsert>) => {
    if (rows.length === 0) {
      return;
    }
    const set = {
      code: sql`excluded.code`,
      name: sql`excluded.name`,
      description: sql`excluded.description`,
      category: sql`excluded.category`,
      isInScope: sql`excluded.is_in_scope`,
      isReady: sql`excluded.is_ready`,
    };
    await db.insert(drataRequirements).values(rows).onConflictDoUpdate({
      target: [drataRequirements.frameworkId, drataRequirements.drataId],
      set: { ...set, updatedAt: updatedAtOnDataChange(drataRequirements, set) },
      setWhere: valuesChange(drataRequirements, set),
    });
  },

  deleteRequirementsNotIn: async ({ db }, frameworkId: string, keptDrataIds: Array<number>) =>
    db.delete(drataRequirements).where(keptDrataIds.length > 0
      ? and(eq(drataRequirements.frameworkId, frameworkId), notInArray(drataRequirements.drataId, keptDrataIds))
      : eq(drataRequirements.frameworkId, frameworkId)),

  upsertControls: async ({ db }, rows: Array<typeof drataControls.$inferInsert>) => {
    if (rows.length === 0) {
      return;
    }
    const set = {
      code: sql`excluded.code`,
      name: sql`excluded.name`,
      description: sql`excluded.description`,
      isReady: sql`excluded.is_ready`,
      isMonitored: sql`excluded.is_monitored`,
      hasEvidence: sql`excluded.has_evidence`,
      hasPolicy: sql`excluded.has_policy`,
      archivedAt: sql`excluded.archived_at`,
    };
    await db.insert(drataControls).values(rows).onConflictDoUpdate({
      target: [drataControls.tenantId, drataControls.drataId],
      set: { ...set, updatedAt: updatedAtOnDataChange(drataControls, set) },
      setWhere: valuesChange(drataControls, set),
    });
  },

  deleteControlsNotIn: async ({ db }, tenantId: string, keptDrataIds: Array<number>) =>
    db.delete(drataControls).where(keptDrataIds.length > 0
      ? and(eq(drataControls.tenantId, tenantId), notInArray(drataControls.drataId, keptDrataIds))
      : eq(drataControls.tenantId, tenantId)),

  replaceRequirementControls: async (
    { db, views, rawDb },
    tenantId: string,
    requirementIds: Array<string>,
    rows: Array<{ requirementId: string, controlId: string }>,
  ) => {
    if (requirementIds.length === 0) {
      return;
    }
    const visible = await db.select({ id: views.drataRequirements.id })
      .from(views.drataRequirements)
      .where(and(eq(views.drataRequirements.tenantId, tenantId), inArray(views.drataRequirements.id, requirementIds)));
    if (visible.length !== requirementIds.length) {
      throw newError('Access Denied');
    }
    const held = await db.select({
      requirementId: views.drataRequirementControls.requirementId,
      controlId: views.drataRequirementControls.controlId,
    })
      .from(views.drataRequirementControls)
      .where(inArray(views.drataRequirementControls.requirementId, requirementIds));
    const { stale, missing } = diffRows(held, rows, linkKey, linkKey);
    if (stale.length > 0) {
      // eslint-disable-next-line no-restricted-syntax -- drata_requirement_controls is a junction table without security policies; requirement ownership validated via views.drataRequirements above
      await rawDb().delete(drataRequirementControls).where(
        sql`(${drataRequirementControls.requirementId}, ${drataRequirementControls.controlId}) in (${sql.join(
          stale.map((link) => sql`(${link.requirementId}, ${link.controlId})`),
          sql`, `,
        )})`,
      );
    }
    if (missing.length > 0) {
      // eslint-disable-next-line no-restricted-syntax -- drata_requirement_controls is a junction table without security policies; requirement ownership validated via views.drataRequirements above
      await rawDb().insert(drataRequirementControls).values(missing).onConflictDoNothing();
    }
  },
});

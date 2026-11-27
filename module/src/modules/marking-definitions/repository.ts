import { and, asc, eq, or, sql } from 'drizzle-orm';
import { newError } from '@app/utils';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { EventOrigin } from '../../security/policy';
import { inUuids } from '../../db/uuid-array';
import { defineRepository } from '../../registry';
import { clearedMarkings, nativeClearanceReader } from '../../security';
import { userIsSuperAdmin } from '../../security/policies';
import { riskScenarios } from '../risk-scenarios/schema';
import { findingLockOrder } from '../supporting-assets/finding-lock-order';
import { assetEvidence, supportingAssets, supportingAssetSources } from '../supporting-assets/schema';
import { threatAnalyses } from '../threat-analyses/schema';
import { groupMarkingDefinitions, markingDefinitions } from './schema';

/**
 * The marking definitions of a tenant and the clearance of its groups (CTEM marking parity, G2).
 * Reads go through the secured views, so a caller reads only its own tenant; writes are guarded by
 * `manageSecurityWritePolicy` and by the security procedure in `back`.
 */
export const markingDefinitionsRepository = defineRepository({
  findMarkingDefinitions: ({ db, views }) => db.select({
    id: views.markingDefinitions.id,
    stixId: views.markingDefinitions.stixId,
    definitionType: views.markingDefinitions.definitionType,
    definition: views.markingDefinitions.definition,
    color: views.markingDefinitions.color,
    order: views.markingDefinitions.order,
  })
    .from(views.markingDefinitions)
    .orderBy(asc(views.markingDefinitions.definitionType), asc(views.markingDefinitions.order), asc(views.markingDefinitions.definition)),
  findMarkingDefinitionByStixId: async ({ db, views }, stixId: string) => {
    const rows = await db.select({ id: views.markingDefinitions.id })
      .from(views.markingDefinitions)
      .where(eq(views.markingDefinitions.stixId, stixId))
      .limit(1);
    return rows.length > 0 ? rows[0] : undefined;
  },
  findMarkingDefinitionById: async ({ db, views }, id: string) => {
    const rows = await db.select({ stixId: views.markingDefinitions.stixId, order: views.markingDefinitions.order })
      .from(views.markingDefinitions)
      .where(eq(views.markingDefinitions.id, id))
      .limit(1);
    return rows.length > 0 ? rows[0] : undefined;
  },
  insertMarkingDefinition: ({ db }, marking: typeof markingDefinitions.$inferInsert) =>
    db.insert(markingDefinitions).values(marking).onConflictDoNothing(),
  /**
   * Writes the markings a peer defines, keyed by their STIX id: a new one is inserted, a known one
   * takes the peer's type, definition and colour. OpenCTI is the authority on rank: its rank replaces
   * the stored one, except an absent rank, which never erases it. OpenAEV sets a rank only when it
   * creates the marking. A row keeps its own id, so every clearance and every `marking_refs` naming
   * it still holds.
   */
  upsertMarkingDefinitions: ({ db }, rows: Array<typeof markingDefinitions.$inferInsert>, source: 'opencti' | 'openaev') =>
    db.insert(markingDefinitions).values(rows).onConflictDoUpdate({
      target: [markingDefinitions.tenantId, markingDefinitions.stixId],
      set: {
        definitionType: sql`excluded.definition_type`,
        definition: sql`excluded.definition`,
        color: sql`excluded.color`,
        order: source === 'opencti'
          ? sql`coalesce(excluded."order", marking_definitions."order")`
          : sql`marking_definitions."order"`,
      },
    }),
  updateMarkingDefinition: ({ db }, id: string, values: { color?: string | null, order?: number }) =>
    db.update(markingDefinitions).set(values).where(eq(markingDefinitions.id, id)),
  /**
   * The marking a person may delete: one they are cleared for, as OpenAEV answers not found to a
   * caller who cannot see the marking. Any other origin (a connector, a job) is not narrowed.
   */
  findDeletableMarking: async ({ db, views }, id: string, origin: EventOrigin) => {
    const reader = nativeClearanceReader(origin);
    const rows = await db.select({ stixId: views.markingDefinitions.stixId })
      .from(views.markingDefinitions)
      .where(and(
        eq(views.markingDefinitions.id, id),
        reader === undefined
          ? undefined
          : or(userIsSuperAdmin(reader.userId), sql`${views.markingDefinitions.stixId} = any(${clearedMarkings(reader.userId, reader.tenantId)})`),
      ))
      .limit(1);
    return rows.length > 0 ? rows[0] : undefined;
  },
  /** Whether the marking was deleted: a delete the write policy refuses removes nothing, silently. */
  deleteMarkingDefinition: async ({ db }, id: string) =>
    (await db.delete(markingDefinitions).where(eq(markingDefinitions.id, id)).returning()).length > 0,
  /**
   * Removes a deleted marking's STIX id from every row of the tenant that carries it, so those rows
   * are declassified rather than hidden from everyone for a marking no clearance can name again. The
   * threats mirrored from OpenCTI keep it: they follow OpenCTI's markings, and the stream rewrites them.
   * Takes its locks in the order a sync does, sources, then assets by id, then findings in
   * `findingLockOrder`, so the two queue instead of deadlocking.
   */
  scrubMarkingRefs: async ({ rawDb }, tenantId: string, stixId: string) => {
    const carries = (column: PgColumn) => sql`${column} @> array[${stixId}]::text[]`;
    const without = (column: PgColumn) => sql`array_remove(${column}, ${stixId})`;
    // eslint-disable-next-line no-restricted-syntax -- the rows the caller cannot read must be declassified too, or they stay hidden from everyone
    await rawDb().update(supportingAssetSources).set({ reportedMarkingRefs: without(supportingAssetSources.reportedMarkingRefs) })
      .where(and(eq(supportingAssetSources.tenantId, tenantId), carries(supportingAssetSources.reportedMarkingRefs)));
    // eslint-disable-next-line no-restricted-syntax -- the rows the caller cannot read must be locked and declassified too
    const assetIds = (await rawDb().select({ id: supportingAssets.id }).from(supportingAssets)
      .where(and(eq(supportingAssets.tenantId, tenantId), carries(supportingAssets.markingRefs)))
      .orderBy(supportingAssets.id)
      .for('no key update')).map(({ id }) => id);
    if (assetIds.length > 0) {
      // eslint-disable-next-line no-restricted-syntax -- the rows the caller cannot read must be declassified too, or they stay hidden from everyone
      await rawDb().update(supportingAssets).set({ markingRefs: without(supportingAssets.markingRefs) })
        .where(inUuids(supportingAssets.id, assetIds));
    }
    // eslint-disable-next-line no-restricted-syntax -- the rows the caller cannot read must be locked and declassified too
    const findingIds = (await rawDb().select({ id: assetEvidence.id }).from(assetEvidence)
      .where(and(eq(assetEvidence.tenantId, tenantId), carries(assetEvidence.markingRefs)))
      .orderBy(...findingLockOrder(assetEvidence))
      .for('no key update')).map(({ id }) => id);
    if (findingIds.length > 0) {
      // eslint-disable-next-line no-restricted-syntax -- the rows the caller cannot read must be declassified too, or they stay hidden from everyone
      await rawDb().update(assetEvidence).set({ markingRefs: without(assetEvidence.markingRefs) })
        .where(inUuids(assetEvidence.id, findingIds));
    }
    // eslint-disable-next-line no-restricted-syntax -- the rows the caller cannot read must be declassified too, or they stay hidden from everyone
    await rawDb().update(riskScenarios).set({ markingRefs: without(riskScenarios.markingRefs) })
      .where(and(eq(riskScenarios.tenantId, tenantId), carries(riskScenarios.markingRefs)));
    // eslint-disable-next-line no-restricted-syntax -- the rows the caller cannot read must be declassified too, or they stay hidden from everyone
    await rawDb().update(threatAnalyses).set({ markingRefs: without(threatAnalyses.markingRefs) })
      .where(and(eq(threatAnalyses.tenantId, tenantId), sql`${threatAnalyses.kind} <> 'connector'`, carries(threatAnalyses.markingRefs)));
  },

  findGroupMarkings: ({ db, views }, groupId: string) => db.select({
    id: views.markingDefinitions.id,
    stixId: views.markingDefinitions.stixId,
    definitionType: views.markingDefinitions.definitionType,
    definition: views.markingDefinitions.definition,
  })
    .from(views.groupMarkingDefinitions)
    .innerJoin(views.markingDefinitions, eq(views.groupMarkingDefinitions.markingDefinitionId, views.markingDefinitions.id))
    .where(eq(views.groupMarkingDefinitions.groupId, groupId))
    .orderBy(asc(views.markingDefinitions.definitionType), asc(views.markingDefinitions.order)),
  addGroupMarking: async ({ db, views }, tenantId: string, groupId: string, markingDefinitionId: string) => {
    const [group, marking] = await Promise.all([
      db.select({ id: views.groups.id }).from(views.groups).where(eq(views.groups.id, groupId)).limit(1),
      db.select({ id: views.markingDefinitions.id }).from(views.markingDefinitions).where(eq(views.markingDefinitions.id, markingDefinitionId)).limit(1),
    ]);
    if (group.length === 0 || marking.length === 0) {
      throw newError('Access Denied');
    }
    return db.insert(groupMarkingDefinitions).values({ tenantId, groupId, markingDefinitionId }).onConflictDoNothing();
  },
  removeGroupMarking: ({ db }, groupId: string, markingDefinitionId: string) =>
    db.delete(groupMarkingDefinitions).where(and(
      eq(groupMarkingDefinitions.groupId, groupId),
      eq(groupMarkingDefinitions.markingDefinitionId, markingDefinitionId),
    )),
});

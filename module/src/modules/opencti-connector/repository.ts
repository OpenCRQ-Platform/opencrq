import type { SQL } from 'drizzle-orm';
import { aliasedTable, and, eq, exists, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import type { PendingMark, PendingStreamObject } from './pending-batch';
import type { OpenctiThreatVisibility } from './threat-visibility';
import type { RepositoryContext } from '../../registry';
import { LATERAL_ON } from '../../db/lateral';
import { diffRows } from '../../db/row-diff';
import { valuesChange } from '../../db/write-guards';
import { defineRepository } from '../../registry';
import { serviceAccounts } from '../service-accounts/schema';
import { THREAT_ENTITY_TYPES } from '../threat-analyses/entity-types';
import { MAX_COUNTER_REPORTS } from '../threat-analyses/outcome-counter/counter-record';
import { openctiConnectorSettings, openctiStreamObjects, openctiStreamReportRefs, openctiStreamState } from './schema';

/**
 * Marks the mirror rows `reached` selects, already marked or not, and returns how many: counted rather
 * than returned, so no STIX body is loaded.
 */
const markPendingWhere = async (
  db: RepositoryContext['db'],
  mirror: RepositoryContext['views']['openctiStreamObjects'],
  tenantId: string,
  reached: SQL | undefined,
): Promise<number> => {
  const [counted] = await db.select({ count: sql<number>`count(*)::int` }).from(mirror).where(reached);
  if (!counted || counted.count === 0) {
    return 0;
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast to Date for timestamp columns
  const updatedAt = sql`now()` as unknown as Date;
  await db.update(openctiStreamObjects)
    .set({ pending: true, updatedAt })
    .where(and(
      eq(openctiStreamObjects.tenantId, tenantId),
      inArray(openctiStreamObjects.stixId, db.select({ stixId: mirror.stixId }).from(mirror).where(reached)),
    ));
  return counted.count;
};

/** A STIX timestamp: the only form of `published` whose Postgres cast and JavaScript parse agree on. */
const ISO_TIMESTAMP = String.raw`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)$`;

/** The next generation, read off the row itself so two callers cannot land on the same one. */
const nextGeneration = () =>
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast for an integer column
  sql`${openctiStreamState.streamGeneration} + 1` as unknown as number;

/** No position and nothing read, the generation aside. */
const STREAM_STATE_RESET = {
  cursor: null,
  lastEventAt: null,
  historyStartAt: null,
  backfillTargetAt: null,
  reachedLiveTailAt: null,
  objectsRead: 0,
  objectsReadAt: null,
};

/** Namespaces the rebuild's advisory locks, so its tenant keys cannot collide with another user's. */
const MIRROR_REBUILD_LOCK_CLASS = 1566;

const getString = (obj: Record<string, unknown>, key: string): string | null => {
  const value = obj[key];
  return typeof value === 'string' ? value : null;
};

export const openctiConnectorRepository = defineRepository({
  /**
   * The settings with the stream's position folded in, for the pages that show both. A read made on
   * every call must not use it: it observes the stream state, which every checkpoint rewrites. Every
   * settings row has a state row (a trigger creates it), so the join drops none.
   */
  findByTenant: async ({ db, views }, tenantId: string) => {
    const settings = views.openctiConnectorSettings;
    const state = views.openctiStreamState;
    const [row] = await db.select({
      id: settings.id,
      tenantId: settings.tenantId,
      serviceAccountId: settings.serviceAccountId,
      streamId: settings.streamId,
      enabled: settings.enabled,
      threatVisibility: settings.threatVisibility,
      authFailedAt: settings.authFailedAt,
      streamMissingCapability: settings.streamMissingCapability,
      createdAt: settings.createdAt,
      updatedAt: settings.updatedAt,
      cursor: state.cursor,
      lastEventAt: state.lastEventAt,
      historyStartAt: state.historyStartAt,
      backfillTargetAt: state.backfillTargetAt,
      reachedLiveTailAt: state.reachedLiveTailAt,
      streamGeneration: state.streamGeneration,
      objectsRead: state.objectsRead,
      objectsReadAt: state.objectsReadAt,
    })
      .from(settings)
      .innerJoin(state, eq(state.tenantId, settings.tenantId))
      .where(eq(settings.tenantId, tenantId))
      .limit(1);
    return row ?? null;
  },

  /** Answers `per_member` for a tenant with no settings row. Reads the settings alone, never the stream state. */
  findThreatVisibility: async ({ db, views }, tenantId: string): Promise<OpenctiThreatVisibility> => {
    const [row] = await db.select({ threatVisibility: views.openctiConnectorSettings.threatVisibility })
      .from(views.openctiConnectorSettings)
      .where(eq(views.openctiConnectorSettings.tenantId, tenantId))
      .limit(1);
    return row?.threatVisibility ?? 'per_member';
  },

  /** Leaves the row alone, `updatedAt` included, when the choice is the one it holds. */
  setThreatVisibility: async ({ db }, tenantId: string, id: string, threatVisibility: OpenctiThreatVisibility) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast to Date for timestamp columns
    const updatedAt = sql`now()` as unknown as Date;
    return db.insert(openctiConnectorSettings)
      .values([{ id, tenantId, threatVisibility }])
      .onConflictDoUpdate({
        target: openctiConnectorSettings.tenantId,
        set: { threatVisibility, updatedAt },
        setWhere: ne(openctiConnectorSettings.threatVisibility, threatVisibility),
      });
  },

  /**
   * Not read through `serviceAccounts`, whose view answers nothing to a member without MANAGE_SECURITY:
   * the stream panel is open to every member, and an unanswered read would show as a stopped stream.
   * Answers false for a tenant with no row and for an unbound stream.
   */
  isBoundServiceAccountActive: async ({ rawDb }, tenantId: string): Promise<boolean> => {
    // eslint-disable-next-line no-restricted-syntax -- service_accounts is gated on MANAGE_SECURITY; this answers one boolean about this tenant's own bound account, scoped by the settings row it joins from
    const result = await rawDb().select({ active: serviceAccounts.active })
      .from(openctiConnectorSettings)
      .innerJoin(serviceAccounts, eq(serviceAccounts.id, openctiConnectorSettings.serviceAccountId))
      .where(eq(openctiConnectorSettings.tenantId, tenantId))
      .limit(1);
    return result[0]?.active === true;
  },

  findAllEnabled: async ({ db, views }) =>
    db.select().from(views.openctiConnectorSettings)
      .where(eq(views.openctiConnectorSettings.enabled, true)),

  // Always resets the stream state — a `streamId` change makes any previously persisted `cursor`
  // meaningless (OpenCTI event ids are scoped to one stream), and the totals belong to the stream that
  // produced them. Always enables the connector — a user completing the Configure form expects the
  // stream to start immediately. The state goes first: the trigger that gives a new settings row its
  // state row would otherwise create it at generation 0 for this call to bump to 1. Two statements: the
  // caller runs it in a transaction.
  upsertConfig: async (
    { db }, tenantId: string, id: string, serviceAccountId: string, streamId: string,
  ) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast to Date for timestamp columns
    const updatedAt = sql`now()` as unknown as Date;
    await db.insert(openctiStreamState)
      .values([{ tenantId }])
      .onConflictDoUpdate({
        target: openctiStreamState.tenantId,
        set: { ...STREAM_STATE_RESET, streamGeneration: nextGeneration() },
      });
    await db.insert(openctiConnectorSettings)
      .values([{ id, tenantId, serviceAccountId, streamId, enabled: true }])
      .onConflictDoUpdate({
        target: openctiConnectorSettings.tenantId,
        set: {
          serviceAccountId,
          streamId,
          enabled: true,
          authFailedAt: null,
          streamMissingCapability: null,
          updatedAt,
        },
      });
  },

  /**
   * `upsertConfig` for the stream the deployment provides, applied only to a tenant nobody configured
   * (no row, or a row with neither account nor stream): an admin's choice, a disabled connector
   * included, is never overwritten. Answers whether it configured.
   */
  configureIfUnconfigured: async ({ db }, tenantId: string, id: string, serviceAccountId: string, streamId: string) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast to Date for timestamp columns
    const updatedAt = sql`now()` as unknown as Date;
    const configured = await db.insert(openctiConnectorSettings)
      .values([{ id, tenantId, serviceAccountId, streamId, enabled: true }])
      .onConflictDoUpdate({
        target: openctiConnectorSettings.tenantId,
        set: { serviceAccountId, streamId, enabled: true, streamMissingCapability: null, updatedAt },
        setWhere: and(isNull(openctiConnectorSettings.serviceAccountId), isNull(openctiConnectorSettings.streamId)),
      })
      .returning();
    return configured.length > 0;
  },

  /**
   * Records the capability the deployment's token lacks, or clears it with null; leaves every other
   * column alone, and the row itself, `updatedAt` included, when it already holds that capability: the
   * boot repeats this on every start.
   */
  setStreamMissingCapability: async ({ db }, tenantId: string, id: string, capability: string | null) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast to Date for timestamp columns
    const updatedAt = sql`now()` as unknown as Date;
    return db.insert(openctiConnectorSettings)
      .values([{ id, tenantId, streamMissingCapability: capability }])
      .onConflictDoUpdate({
        target: openctiConnectorSettings.tenantId,
        set: { streamMissingCapability: capability, updatedAt },
        setWhere: valuesChange(openctiConnectorSettings, { streamMissingCapability: capability }),
      });
  },

  // Any explicit `setEnabled` call (either direction) clears `authFailedAt` — it represents the
  // user taking manual control again, whether that's a deliberate disable or a retry after fixing
  // the token; a still-broken token gets `authFailedAt` re-set within moments by the next attempt.
  setEnabled: async ({ db }, tenantId: string, id: string, enabled: boolean) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast to Date for timestamp columns
    const updatedAt = sql`now()` as unknown as Date;
    return db.insert(openctiConnectorSettings)
      .values([{ id, tenantId, enabled }])
      .onConflictDoUpdate({
        target: openctiConnectorSettings.tenantId,
        set: { enabled, authFailedAt: null, updatedAt },
      });
  },

  // Forces `enabled` back to `false` and stamps `authFailedAt` — called on a confirmed OpenCTI
  // 401/403 (see `opencti-connector-manager.ts`/`opencti-router.ts`), so the Settings page can
  // explain why the connector stopped instead of just showing an unexplained "Disabled" toggle.
  markAuthFailed: async ({ db }, tenantId: string, id: string) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast to Date for timestamp columns
    const now = sql`now()` as unknown as Date;
    return db.insert(openctiConnectorSettings)
      .values([{ id, tenantId, enabled: false, authFailedAt: now }])
      .onConflictDoUpdate({
        target: openctiConnectorSettings.tenantId,
        set: { enabled: false, authFailedAt: now, updatedAt: now },
      });
  },

  // `lastEventAt` is a monotonic high-water mark (`GREATEST`, which ignores a NULL existing value
  // per Postgres semantics) since the source data isn't strictly ordered — the timeline cursor
  // must never visually regress. `historyStartAt`/`backfillTargetAt` are one-way latches (first
  // value wins, via COALESCE) anchoring the timeline's start/target for the progress percentage,
  // and they are only ever seeded while the row is still behind: a reconnect drops them and keeps
  // the live-tail latch, and re-anchoring there would draw a backfill for a stream at the edge.
  // `reachedLiveTailAt` is a separate one-way latch: `reachedLiveTailCandidate` is only non-null
  // once the caller (see `opencti-connector-manager.ts`) decides an event is close enough to "now"
  // to call us caught up.
  updateCursor: async (
    { db }, tenantId: string, cursor: string, lastEventAt: Date, reachedLiveTailCandidate: Date | null, objectsRead: number, generation: number,
  ) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast to Date for timestamp columns
    const monotonicLastEventAt = sql`greatest(coalesce(${openctiStreamState.lastEventAt}, ${lastEventAt}), ${lastEventAt})` as unknown as Date;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast to Date for timestamp columns
    const historyStartAt = sql`coalesce(${openctiStreamState.historyStartAt}, case when ${openctiStreamState.reachedLiveTailAt} is null then ${lastEventAt}::timestamptz end)` as unknown as Date;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast to Date for timestamp columns
    const backfillTargetAt = sql`coalesce(${openctiStreamState.backfillTargetAt}, case when ${openctiStreamState.reachedLiveTailAt} is null then now() end)` as unknown as Date;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast to Date for timestamp columns
    const reachedLiveTailAt = sql`coalesce(${openctiStreamState.reachedLiveTailAt}, ${reachedLiveTailCandidate})` as unknown as Date;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast for timestamp/counter columns
    const objectsReadTotal = sql`${openctiStreamState.objectsRead} + ${objectsRead}` as unknown as number;
    // The instant only moves when something was actually read, so a flush that carried no object leaves
    // the rate's denominator alone rather than reading as a burst of zero.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast for timestamp/counter columns
    const objectsReadAt = sql`case when ${objectsRead} > 0 then now() else ${openctiStreamState.objectsReadAt} end` as unknown as Date;
    // A consumer being replaced still runs a final flush, and the generation guard is what refuses the
    // position it was holding.
    return db.update(openctiStreamState)
      .set({
        cursor,
        lastEventAt: monotonicLastEventAt,
        historyStartAt,
        backfillTargetAt,
        reachedLiveTailAt,
        objectsRead: objectsReadTotal,
        objectsReadAt,
      })
      .where(and(
        eq(openctiStreamState.tenantId, tenantId),
        eq(openctiStreamState.streamGeneration, generation),
      ))
      .returning();
  },

  // No resume position with the live tail latched anyway, which opens the stream at its live edge, so
  // the abandoned backfill is never replayed.
  reconnectAtLiveTail: async ({ db }, tenantId: string) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast to Date for timestamp columns
    const reachedLiveTailAt = sql`coalesce(${openctiStreamState.reachedLiveTailAt}, now())` as unknown as Date;
    return db.update(openctiStreamState)
      .set({
        cursor: null,
        historyStartAt: null,
        backfillTargetAt: null,
        reachedLiveTailAt,
        streamGeneration: nextGeneration(),
      })
      .where(eq(openctiStreamState.tenantId, tenantId));
  },

  // Clears the live-tail latch too, so the next connection requests the stream from its origin rather
  // than its edge. Mirrored objects stay: a reset replays the stream, it does not un-import it.
  resetStreamState: async ({ db }, tenantId: string) =>
    db.update(openctiStreamState)
      .set({ ...STREAM_STATE_RESET, streamGeneration: nextGeneration() })
      .where(eq(openctiStreamState.tenantId, tenantId)),

  /**
   * `setWhere` is what keeps the stream's re-serving of an unchanged object free: an identical
   * payload leaves `updatedAt` and `pending` alone, so the job never rebuilds for it. A tombstone is
   * the exception, since reviving it is a change even when the body is byte-identical.
   */
  upsertStreamObject: async ({ db }, id: string, tenantId: string, stixId: string, stixType: string, data: Record<string, unknown>) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast to Date for timestamp columns
    const updatedAt = sql`now()` as unknown as Date;
    // Denormalized purely so a relationship can be looked up by endpoint without scanning `data`.
    const sourceRef = stixType === 'relationship' ? getString(data, 'source_ref') : null;
    const targetRef = stixType === 'relationship' ? getString(data, 'target_ref') : null;
    const relationshipType = stixType === 'relationship' ? getString(data, 'relationship_type') : null;
    // Not relationship-specific: a group's own record can also carry `created_by_ref`.
    const createdByRef = getString(data, 'created_by_ref');
    return db.insert(openctiStreamObjects)
      .values([{ id, tenantId, stixId, stixType, sourceRef, targetRef, relationshipType, createdByRef, data, pending: true }])
      .onConflictDoUpdate({
        target: [openctiStreamObjects.tenantId, openctiStreamObjects.stixId],
        set: { stixType, sourceRef, targetRef, relationshipType, createdByRef, data, deletedAt: null, pending: true, updatedAt },
        setWhere: sql`${openctiStreamObjects.data} is distinct from excluded.data or ${openctiStreamObjects.deletedAt} is not null`,
      });
  },

  /**
   * A tombstone, not a removal: what the object contributed is only retractable while the mirror
   * still says it existed. The job purges the row once it has folded it.
   *
   * The relationships holding the id at either end go with it, in this one statement: the stream
   * filter matches entities, so a deletion fans out to nothing and the platform never names them.
   * Left live they would outlive their endpoint and, since a threat's STIX id derives from
   * its name, be folded back into a same-named actor created later.
   *
   * `created_by_ref` is deliberately not a cascade: a producer identity carries no claim of its own
   * and the objects naming it stay true without it.
   */
  deleteStreamObject: async ({ db }, tenantId: string, stixId: string) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast to Date for timestamp columns
    const now = sql`now()` as unknown as Date;
    return db.update(openctiStreamObjects)
      .set({ deletedAt: now, pending: true, updatedAt: now })
      .where(and(
        eq(openctiStreamObjects.tenantId, tenantId),
        or(
          eq(openctiStreamObjects.stixId, stixId),
          eq(openctiStreamObjects.sourceRef, stixId),
          eq(openctiStreamObjects.targetRef, stixId),
        ),
        isNull(openctiStreamObjects.deletedAt),
      ));
  },

  // What OpenCTI does to the absorbed object's connections on a merge, with raw index writes and
  // no event: a relationship the survivor already carries to the same other end, undated, is
  // dropped, every other one keeps its own id and only its endpoint moves.
  repointStreamObjectRefs: async ({ db }, tenantId: string, fromStixId: string, toStixId: string) => {
    const survivor = aliasedTable(openctiStreamObjects, 'survivor');
    const undatedSurvivorRelation = (side: 'sourceRef' | 'targetRef') => {
      const otherEnd = side === 'sourceRef' ? 'targetRef' : 'sourceRef';
      return exists(db.select({ one: sql`1` }).from(survivor).where(and(
        eq(survivor.tenantId, openctiStreamObjects.tenantId),
        eq(survivor[side], toStixId),
        eq(survivor.relationshipType, openctiStreamObjects.relationshipType),
        eq(survivor[otherEnd], openctiStreamObjects[otherEnd]),
        isNull(survivor.deletedAt),
        sql`${survivor.data}->>'start_time' is null and ${survivor.data}->>'stop_time' is null`,
      )));
    };
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast to Date for timestamp columns
    const updatedAt = sql`now()` as unknown as Date;
    await db.update(openctiStreamObjects)
      .set({ deletedAt: updatedAt, pending: true, updatedAt })
      .where(and(
        eq(openctiStreamObjects.tenantId, tenantId),
        eq(openctiStreamObjects.sourceRef, fromStixId),
        isNull(openctiStreamObjects.deletedAt),
        undatedSurvivorRelation('sourceRef'),
      ));
    await db.update(openctiStreamObjects)
      .set({ deletedAt: updatedAt, pending: true, updatedAt })
      .where(and(
        eq(openctiStreamObjects.tenantId, tenantId),
        eq(openctiStreamObjects.targetRef, fromStixId),
        isNull(openctiStreamObjects.deletedAt),
        undatedSurvivorRelation('targetRef'),
      ));
    const rewritten = (field: string) =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast for a jsonb column
      sql`jsonb_set(${openctiStreamObjects.data}, array[${field}::text], to_jsonb(${toStixId}::text))` as unknown as Record<string, unknown>;
    await db.update(openctiStreamObjects)
      .set({ sourceRef: toStixId, data: rewritten('source_ref'), pending: true, updatedAt })
      .where(and(eq(openctiStreamObjects.tenantId, tenantId), eq(openctiStreamObjects.sourceRef, fromStixId), isNull(openctiStreamObjects.deletedAt)));
    await db.update(openctiStreamObjects)
      .set({ targetRef: toStixId, data: rewritten('target_ref'), pending: true, updatedAt })
      .where(and(eq(openctiStreamObjects.tenantId, tenantId), eq(openctiStreamObjects.targetRef, fromStixId), isNull(openctiStreamObjects.deletedAt)));
    await db.update(openctiStreamObjects)
      .set({ createdByRef: toStixId, data: rewritten('created_by_ref'), pending: true, updatedAt })
      .where(and(eq(openctiStreamObjects.tenantId, tenantId), eq(openctiStreamObjects.createdByRef, fromStixId), isNull(openctiStreamObjects.deletedAt)));

    // A report cites the absorbed threat in two places, the join table and its `object_refs`: a
    // rebuild of the survivor reads the first, a replay of the report rewrites the second.
    const survivorCitation = aliasedTable(openctiStreamReportRefs, 'survivor_citation');
    await db.delete(openctiStreamReportRefs).where(and(
      eq(openctiStreamReportRefs.tenantId, tenantId),
      eq(openctiStreamReportRefs.threatStixId, fromStixId),
      exists(db.select({ one: sql`1` }).from(survivorCitation).where(and(
        eq(survivorCitation.tenantId, openctiStreamReportRefs.tenantId),
        eq(survivorCitation.reportStixId, openctiStreamReportRefs.reportStixId),
        eq(survivorCitation.threatStixId, toStixId),
      ))),
    ));
    await db.update(openctiStreamReportRefs)
      .set({ threatStixId: toStixId })
      .where(and(eq(openctiStreamReportRefs.tenantId, tenantId), eq(openctiStreamReportRefs.threatStixId, fromStixId)));
    // A report citing both ends keeps the survivor once, at the position of its first mention.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast for a jsonb column
    const objectRefs = sql`jsonb_set(${openctiStreamObjects.data}, array['object_refs'], (
      select coalesce(jsonb_agg(cited.ref order by cited.position), '[]'::jsonb)
      from (
        select case when ref.value = ${fromStixId} then ${toStixId} else ref.value end as ref, min(ref.position) as position
        from jsonb_array_elements_text(${openctiStreamObjects.data}->'object_refs') with ordinality as ref(value, position)
        group by 1
      ) cited
    ))` as unknown as Record<string, unknown>;
    await db.update(openctiStreamObjects)
      .set({ data: objectRefs })
      .where(and(
        eq(openctiStreamObjects.tenantId, tenantId),
        eq(openctiStreamObjects.stixType, 'report'),
        isNull(openctiStreamObjects.deletedAt),
        sql`jsonb_exists(${openctiStreamObjects.data}->'object_refs', ${fromStixId})`,
      ));
  },

  // Point lookup by id, e.g. resolving a relationship's target_ref to its STIX body.
  findStreamObjectsByIds: async (
    { db, views }, tenantId: string, stixIds: Array<string>,
  ): Promise<Array<typeof openctiStreamObjects.$inferSelect>> => {
    if (stixIds.length === 0) {
      return [];
    }
    return db.select().from(views.openctiStreamObjects)
      .where(and(
        eq(views.openctiStreamObjects.tenantId, tenantId),
        inArray(views.openctiStreamObjects.stixId, stixIds),
        isNull(views.openctiStreamObjects.deletedAt),
      ));
  },

  // Relationships originating FROM one of `sourceRefs`: a group's own `targets`/`uses` edges.
  findRelationshipsBySourceRefs: async (
    { db, views }, tenantId: string, sourceRefs: Array<string>, relationshipTypes: Array<string>,
  ): Promise<Array<typeof openctiStreamObjects.$inferSelect>> => {
    if (sourceRefs.length === 0 || relationshipTypes.length === 0) {
      return [];
    }
    return db.select().from(views.openctiStreamObjects)
      .where(and(
        eq(views.openctiStreamObjects.tenantId, tenantId),
        inArray(views.openctiStreamObjects.sourceRef, sourceRefs),
        inArray(views.openctiStreamObjects.relationshipType, relationshipTypes),
        isNull(views.openctiStreamObjects.deletedAt),
      ));
  },

  /**
   * Marks the live threats a catalog object, a malware, a report or a producer identity feeds, so each is
   * rebuilt from its own row rather than inside the batch that met the catalog change: a producer as prolific as a
   * CTI vendor names thousands of them. A threat already marked keeps the watermark it was read with.
   *
   * Returns how many threats it marked, counted rather than returned so that no STIX body is loaded.
   */
  markThreatsReaching: async (
    { db, views }, tenantId: string, targetedStixIds: Array<string>, producerStixIds: Array<string>,
  ): Promise<number> => {
    if (targetedStixIds.length === 0 && producerStixIds.length === 0) {
      return 0;
    }
    const mirror = views.openctiStreamObjects;
    const live = and(eq(mirror.tenantId, tenantId), isNull(mirror.deletedAt));
    const reached = and(
      live,
      eq(mirror.pending, false),
      inArray(mirror.stixType, [...THREAT_ENTITY_TYPES]),
      or(
        targetedStixIds.length > 0
          ? inArray(mirror.stixId, db.select({ stixId: mirror.sourceRef }).from(mirror)
            .where(and(live, inArray(mirror.targetRef, targetedStixIds))))
          : undefined,
        // A report reaches the threats it cites, not through a relationship: the join table finds them.
        targetedStixIds.length > 0
          ? inArray(mirror.stixId, db.select({ stixId: views.openctiStreamReportRefs.threatStixId }).from(views.openctiStreamReportRefs)
            .where(and(
              eq(views.openctiStreamReportRefs.tenantId, tenantId),
              inArray(views.openctiStreamReportRefs.reportStixId, targetedStixIds),
            )))
          : undefined,
        producerStixIds.length > 0
          ? inArray(mirror.stixId, db.select({ stixId: mirror.sourceRef }).from(mirror)
            .where(and(live, eq(mirror.stixType, 'relationship'), inArray(mirror.createdByRef, producerStixIds))))
          : undefined,
        producerStixIds.length > 0 ? inArray(mirror.createdByRef, producerStixIds) : undefined,
      ),
    );
    const [counted] = await db.select({ count: sql<number>`count(*)::int` }).from(mirror).where(reached);
    if (!counted || counted.count === 0) {
      return 0;
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Drizzle: sql template literal must be cast to Date for timestamp columns
    const updatedAt = sql`now()` as unknown as Date;
    await db.update(openctiStreamObjects)
      .set({ pending: true, updatedAt })
      .where(and(
        eq(openctiStreamObjects.tenantId, tenantId),
        inArray(openctiStreamObjects.stixId, db.select({ stixId: mirror.stixId }).from(mirror).where(reached)),
      ));
    return counted.count;
  },

  /**
   * Makes the threats a mirrored report cites the ones `threatStixIds` names, and returns which it
   * stopped and started citing. Diffed rather than rewritten: a replayed report changes nothing.
   */
  replaceReportRefs: async (
    { db, views }, tenantId: string, reportStixId: string, threatStixIds: Array<string>,
  ): Promise<{ dropped: Array<string>, added: Array<string> }> => {
    const held = await db.select({ threatStixId: views.openctiStreamReportRefs.threatStixId })
      .from(views.openctiStreamReportRefs)
      .where(and(eq(views.openctiStreamReportRefs.tenantId, tenantId), eq(views.openctiStreamReportRefs.reportStixId, reportStixId)));
    const wanted = threatStixIds.map((threatStixId) => ({ threatStixId }));
    const key = (row: { threatStixId: string }): string => row.threatStixId;
    const { stale, missing } = diffRows(held, wanted, key, key);
    if (stale.length > 0) {
      await db.delete(openctiStreamReportRefs).where(and(
        eq(openctiStreamReportRefs.tenantId, tenantId),
        eq(openctiStreamReportRefs.reportStixId, reportStixId),
        inArray(openctiStreamReportRefs.threatStixId, stale.map(key)),
      ));
    }
    if (missing.length > 0) {
      await db.insert(openctiStreamReportRefs).values(missing.map((row) => ({ tenantId, reportStixId, threatStixId: row.threatStixId })));
    }
    return { dropped: stale.map(key), added: missing.map(key) };
  },

  /** Forgets what a report cited, and returns the threats it did. Any other object has no rows to forget. */
  deleteReportRefs: async ({ db }, tenantId: string, reportStixId: string): Promise<Array<string>> => {
    const deleted = await db.delete(openctiStreamReportRefs)
      .where(and(eq(openctiStreamReportRefs.tenantId, tenantId), eq(openctiStreamReportRefs.reportStixId, reportStixId)))
      .returning();
    return deleted.map((row) => row.threatStixId);
  },

  /**
   * The live mirrored reports among the most recent a counter reads for each of the threats, each
   * once. The order is the counter's (`byRecencyThenId` in `counter-record.ts`): a threat cited by
   * thousands of reports reads eight of them, so only those are loaded.
   */
  findReportsCitingThreats: async (
    { db, views }, tenantId: string, threatStixIds: Array<string>,
  ): Promise<Array<typeof openctiStreamObjects.$inferSelect>> => {
    if (threatStixIds.length === 0) {
      return [];
    }
    const refs = views.openctiStreamReportRefs;
    const mirror = views.openctiStreamObjects;
    const cited = db.select({ threatStixId: refs.threatStixId }).from(refs)
      .where(and(eq(refs.tenantId, tenantId), inArray(refs.threatStixId, threatStixIds)))
      .groupBy(refs.threatStixId)
      .as('cited_threat');
    // A date the parser would read as null is null here too: the cast only runs on a string Postgres accepts.
    const published = sql`case when ${mirror.data}->>'published' ~ ${ISO_TIMESTAMP}
      and pg_input_is_valid(${mirror.data}->>'published', 'timestamptz')
      then date_trunc('milliseconds', (${mirror.data}->>'published')::timestamptz) end`;
    const mostRecent = db.select({ stixId: mirror.stixId }).from(refs)
      .innerJoin(mirror, and(eq(mirror.tenantId, refs.tenantId), eq(mirror.stixId, refs.reportStixId)))
      .where(and(
        eq(refs.tenantId, tenantId),
        eq(refs.threatStixId, cited.threatStixId),
        eq(mirror.stixType, 'report'),
        isNull(mirror.deletedAt),
      ))
      // Code-point order on the id, as the counter's `<` compares it.
      .orderBy(sql`${published} desc nulls last`, sql`${mirror.stixId} collate "C"`)
      .limit(MAX_COUNTER_REPORTS)
      .as('most_recent_report');
    const kept = db.select({ stixId: mostRecent.stixId }).from(cited).innerJoinLateral(mostRecent, LATERAL_ON);
    return db.select().from(mirror).where(and(
      eq(mirror.tenantId, tenantId),
      inArray(mirror.stixId, kept),
    ));
  },

  /** Every live threat row of the mirror with whether it is already marked, and no STIX body. */
  findLiveThreatMarks: async (
    { db, views }, tenantId: string, stixIds: Array<string>,
  ): Promise<Array<{ stixId: string, pending: boolean }>> => {
    if (stixIds.length === 0) {
      return [];
    }
    const mirror = views.openctiStreamObjects;
    return db.select({ stixId: mirror.stixId, pending: mirror.pending }).from(mirror).where(and(
      eq(mirror.tenantId, tenantId),
      inArray(mirror.stixId, stixIds),
      inArray(mirror.stixType, [...THREAT_ENTITY_TYPES]),
      isNull(mirror.deletedAt),
    ));
  },

  /**
   * Marks live threats for a rebuild, whether or not they are already marked: a threat read by a batch
   * under way is cleared against the `updatedAt` it was read with, so only a new one keeps this mark
   * from being cleared with it. Returns how many it marked.
   */
  markThreatsPending: async ({ db, views }, tenantId: string, threatStixIds: Array<string>): Promise<number> => {
    if (threatStixIds.length === 0) {
      return 0;
    }
    const mirror = views.openctiStreamObjects;
    const reached = and(
      eq(mirror.tenantId, tenantId),
      inArray(mirror.stixId, threatStixIds),
      inArray(mirror.stixType, [...THREAT_ENTITY_TYPES]),
      isNull(mirror.deletedAt),
    );
    return markPendingWhere(db, mirror, tenantId, reached);
  },

  /**
   * Marks the live threats attributed to one threat, so each is rebuilt against the percentages that
   * threat has just been given. Marked even when already marked, for the reason `markThreatsPending`
   * gives. Returns how many it marked.
   */
  markAttributedChildren: async ({ db, views }, tenantId: string, parentStixId: string): Promise<number> => {
    const mirror = views.openctiStreamObjects;
    const children = db.select({ stixId: mirror.sourceRef }).from(mirror).where(and(
      eq(mirror.tenantId, tenantId),
      eq(mirror.relationshipType, 'attributed-to'),
      eq(mirror.targetRef, parentStixId),
      isNull(mirror.deletedAt),
    ));
    const reached = and(
      eq(mirror.tenantId, tenantId),
      inArray(mirror.stixId, children),
      inArray(mirror.stixType, [...THREAT_ENTITY_TYPES]),
      isNull(mirror.deletedAt),
    );
    return markPendingWhere(db, mirror, tenantId, reached);
  },

  countStreamObjects: async ({ db, views }, tenantId: string) =>
    db.select({ count: sql<number>`count(*)::int` }).from(views.openctiStreamObjects)
      .where(and(eq(views.openctiStreamObjects.tenantId, tenantId), isNull(views.openctiStreamObjects.deletedAt)))
      .then((rows) => rows[0]?.count ?? 0),

  /**
   * The rebuild's one-runner lock, held until the surrounding transaction ends and never waited on:
   * a second runner gives up and the dispatcher's follow-up brings it back. An advisory lock rather
   * than a row, so the connector's own writes never queue behind a rebuild.
   */
  tryLockMirrorRebuild: async ({ rawDb }, tenantId: string): Promise<boolean> => {
    // eslint-disable-next-line no-restricted-syntax -- an advisory lock is not table data: there are no rows for a policy to scope, and this runs on the caller's own transaction
    const result = await rawDb().execute(
      sql`select pg_try_advisory_xact_lock(${MIRROR_REBUILD_LOCK_CLASS}, hashtext(${tenantId})) as locked`,
    );
    return result.rows[0]?.['locked'] === true;
  },

  /**
   * Tombstones included: a mark on a removed object is precisely what the job has to fold.
   *
   * The watermark travels as the text Postgres itself prints, never as a `Date`: `timestamptz`
   * keeps microseconds and a JavaScript date only milliseconds, so a value read into one and sent
   * back would never equal the stored one again and no mark would ever clear.
   *
   * `after` is an exclusive lower bound on the `(updatedAt, stixId)` the scan is ordered by, so a
   * caller walking the backlog reads past the rows a previous scan left marked instead of taking
   * them again.
   */
  findPendingStreamObjects: async (
    { db, views }, tenantId: string, limit: number, after?: PendingMark,
  ): Promise<Array<PendingStreamObject>> =>
    db.select({
      stixId: views.openctiStreamObjects.stixId,
      stixType: views.openctiStreamObjects.stixType,
      sourceRef: views.openctiStreamObjects.sourceRef,
      deletedAt: views.openctiStreamObjects.deletedAt,
      watermark: sql<string>`${views.openctiStreamObjects.updatedAt}::text`,
    }).from(views.openctiStreamObjects)
      .where(and(
        eq(views.openctiStreamObjects.tenantId, tenantId),
        eq(views.openctiStreamObjects.pending, true),
        after
          ? sql`(${views.openctiStreamObjects.updatedAt}, ${views.openctiStreamObjects.stixId}) > (${after.watermark}::timestamptz, ${after.stixId}::text)`
          : undefined,
      ))
      .orderBy(views.openctiStreamObjects.updatedAt, views.openctiStreamObjects.stixId)
      .limit(limit),

  /**
   * Clears the mark of the live rows the caller read, and purges the tombstones among them, each
   * only where `updatedAt` still holds the value that was read: a row written again during the batch
   * keeps its mark and comes back in the next one.
   */
  settlePendingStreamObjects: async (
    { db }, tenantId: string, marks: Array<PendingMark>,
  ): Promise<number> => {
    if (marks.length === 0) {
      return 0;
    }
    const seen = sql.join(
      marks.map((mark) => sql`(${mark.stixId}::text, ${mark.watermark}::timestamptz)`),
      sql`, `,
    );
    const unchanged = sql`(${openctiStreamObjects.stixId}, ${openctiStreamObjects.updatedAt}) in (${seen})`;
    const purged = await db.delete(openctiStreamObjects)
      .where(and(eq(openctiStreamObjects.tenantId, tenantId), isNotNull(openctiStreamObjects.deletedAt), unchanged))
      .returning();
    const cleared = await db.update(openctiStreamObjects)
      .set({ pending: false })
      .where(and(eq(openctiStreamObjects.tenantId, tenantId), isNull(openctiStreamObjects.deletedAt), unchanged))
      .returning();
    return purged.length + cleared.length;
  },
});

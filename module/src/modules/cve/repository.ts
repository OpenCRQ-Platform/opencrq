import { and, asc, desc, eq, ilike, inArray, isNotNull, notExists, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { SecuredSchema } from '../../security';
import type { CveListSortKey } from './list-sort';
import { foldedLike } from '../../db/fold-text';
import { escapeLikePattern } from '../../db/like-pattern';
import { orderNullsLast } from '../../db/order-nulls-last';
import { diffRows } from '../../db/row-diff';
import { valuesChange } from '../../db/write-guards';
import { defineRepository } from '../../registry';
import { cisaListedSql } from './cisa-listing';
import { affectedVersionKey, referenceKey } from './enrichment-keys';
import { cve, cveAffectedVersions, cveReferences, cveSourceObservations } from './schema';

const asDate = (value: string): Date => new Date(value);

// A feed hands over whole pages of the catalogue, and the widest of these inserts binds about twenty
// parameters per row against PostgreSQL's 65 535 limit.
const WRITE_CHUNK = 2_000;

// The description is left out: a tenant carries the whole NVD catalogue, and an unindexed match on
// its texts costs half a second where the id and the title cost a tenth.
const searchCveList = (views: SecuredSchema, search: string | undefined) => {
  if (!search) {
    return undefined;
  }
  return or(ilike(views.cve.cveId, `%${escapeLikePattern(search)}%`), foldedLike(views.cve.cveTitleFolded, search, 'contains'));
};

const excluded = (column: AnyPgColumn) => sql.raw(`excluded.${column.name}`);

const keyedAssignments = (columns: Record<string, AnyPgColumn>, value: (column: AnyPgColumn) => SQL) =>
  Object.entries(columns).map(([key, column]) => ({ key, column, value: value(column) }));

const chunks = <T>(rows: Array<T>): Array<Array<T>> => {
  const out: Array<Array<T>> = [];
  for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
    out.push(rows.slice(i, i + WRITE_CHUNK));
  }
  return out;
};

export const cveRepository = defineRepository({
  insertCveShells: async ({ db }, rows: Array<{ id: string, tenantId: string, cveId: string }>) => {
    for (const chunk of chunks(rows)) {
      await db.insert(cve).values(chunk).onConflictDoNothing({ target: [cve.tenantId, cve.cveId] });
    }
  },

  upsertSourceObservations: async ({ db }, rows: Array<typeof cveSourceObservations.$inferInsert>) => {
    const replaced = keyedAssignments({
      cvss: cveSourceObservations.cvss,
      cvssVector: cveSourceObservations.cvssVector,
      cvssVersion: cveSourceObservations.cvssVersion,
      cvssV2UserInteractionRequired: cveSourceObservations.cvssV2UserInteractionRequired,
      cvssUpdatedAt: cveSourceObservations.cvssUpdatedAt,
      cwe: cveSourceObservations.cwe,
      title: cveSourceObservations.title,
      description: cveSourceObservations.description,
      publishedAt: cveSourceObservations.publishedAt,
      lastModifiedAt: cveSourceObservations.lastModifiedAt,
      epss: cveSourceObservations.epss,
      epssUpdatedAt: cveSourceObservations.epssUpdatedAt,
      kev: cveSourceObservations.kev,
      kevUpdatedAt: cveSourceObservations.kevUpdatedAt,
      kevRequiredAction: cveSourceObservations.kevRequiredAction,
      kevDueDate: cveSourceObservations.kevDueDate,
      kevNotes: cveSourceObservations.kevNotes,
      kevRansomwareUse: cveSourceObservations.kevRansomwareUse,
    }, excluded);
    const set = Object.fromEntries(replaced.map(({ key, value }) => [key, value]));
    for (const chunk of chunks(rows)) {
      await db.insert(cveSourceObservations).values(chunk).onConflictDoUpdate({
        target: [cveSourceObservations.cveId, cveSourceObservations.source],
        set: { ...set, updatedAt: sql`now()` },
        setWhere: valuesChange(cveSourceObservations, set),
      });
    }
  },

  findSourceObservations: async ({ db, views }, cveRowIds: Array<string>) => {
    if (cveRowIds.length === 0) {
      return [];
    }
    return db.select().from(views.cveSourceObservations).where(inArray(views.cveSourceObservations.cveId, cveRowIds));
  },

  /** A field left absent keeps its stored value, and a score without a vector never displaces a stored vector. */
  writeResolvedFields: async ({ db }, rows: Array<typeof cve.$inferInsert>) => {
    const tupleReplaced = sql`(${excluded(cve.cvssVector)} IS NOT NULL OR (${excluded(cve.cvss)} IS NOT NULL AND ${cve.cvssVector} IS NULL))`;
    const assignments = [
      ...keyedAssignments(
        { cvss: cve.cvss, cvssVector: cve.cvssVector, cvssUpdatedAt: cve.cvssUpdatedAt },
        (column) => sql`CASE WHEN ${tupleReplaced} THEN ${excluded(column)} ELSE ${column} END`,
      ),
      ...keyedAssignments({
        cvssV2UserInteractionRequired: cve.cvssV2UserInteractionRequired,
        cwe: cve.cwe,
        epss: cve.epss,
        epssUpdatedAt: cve.epssUpdatedAt,
        kev: cve.kev,
        kevUpdatedAt: cve.kevUpdatedAt,
        kevRequiredAction: cve.kevRequiredAction,
        kevDueDate: cve.kevDueDate,
        kevNotes: cve.kevNotes,
        kevRansomwareUse: cve.kevRansomwareUse,
        cveTitle: cve.cveTitle,
        cveDescription: cve.cveDescription,
      }, (column) => sql`COALESCE(${excluded(column)}, ${column})`),
    ];
    const set = Object.fromEntries(assignments.map(({ key, value }) => [key, value]));
    for (const chunk of chunks(rows)) {
      await db.insert(cve).values(chunk).onConflictDoUpdate({
        target: [cve.tenantId, cve.cveId],
        set: { ...set, updatedAt: sql`now()` },
        setWhere: valuesChange(cve, set),
      });
    }
  },

  upsertVendorSolutionBatch: async ({ db }, rows: Array<{ id: string, tenantId: string, cveId: string, vendorSolution: string }>) => {
    const set = { vendorSolution: sql`COALESCE(${excluded(cve.vendorSolution)}, ${cve.vendorSolution})` };
    for (const chunk of chunks(rows)) {
      await db.insert(cve).values(chunk).onConflictDoUpdate({
        target: [cve.tenantId, cve.cveId],
        set: { ...set, updatedAt: sql`now()` },
        setWhere: valuesChange(cve, set),
      });
    }
  },

  /**
   * The tenant's CVE rows that at least one finding points at, keyed by their published id.
   *
   * This is what bounds the remediation ingestion: the sync walks the whole NVD catalogue, and only
   * the flaws actually carried are worth the reference and version rows.
   */
  findCveRowIdsWithFindings: async ({ db, views }) =>
    db.selectDistinct({ id: views.cve.id, cveId: views.cve.cveId })
      .from(views.cve)
      .innerJoin(views.assetEvidence, eq(views.assetEvidence.cveId, views.cve.id))
      .where(isNotNull(views.assetEvidence.cveId)),

  findReferencesByCveRowId: async ({ db, views }, cveRowId: string) =>
    db.select({
      url: views.cveReferences.url,
      source: views.cveReferences.source,
      tags: views.cveReferences.tags,
    })
      .from(views.cveReferences)
      .where(eq(views.cveReferences.cveId, cveRowId))
      .orderBy(asc(views.cveReferences.url)),

  findAffectedVersionsByCveRowId: async ({ db, views }, cveRowId: string) =>
    db.select({
      vendor: views.cveAffectedVersions.vendor,
      product: views.cveAffectedVersions.product,
      affectedFrom: views.cveAffectedVersions.affectedFrom,
      affectedUpTo: views.cveAffectedVersions.affectedUpTo,
      affectedUpToIncluded: views.cveAffectedVersions.affectedUpToIncluded,
    })
      .from(views.cveAffectedVersions)
      .where(eq(views.cveAffectedVersions.cveId, cveRowId))
      .orderBy(asc(views.cveAffectedVersions.product), asc(views.cveAffectedVersions.affectedUpTo)),

  /**
   * Makes the enrichment of the given CVE rows what the feed states now: a row it no longer states
   * is deleted, a row it states anew is inserted, and a row both agree on, value for value, is left
   * alone. Rewriting it would ring the doorbell on every crawl, which walks the whole catalogue.
   *
   * The deletes and the inserts must land together, so the caller runs this inside a transaction:
   * a failure between the two would leave the flaw showing no fix guidance at all until the next
   * successful crawl.
   *
   * @param cveRowIds the rows whose enrichment is being replaced, never empty
   */
  replaceCveEnrichment: async (
    { db, views },
    cveRowIds: Array<string>,
    references: Array<typeof cveReferences.$inferInsert>,
    affectedVersions: Array<typeof cveAffectedVersions.$inferInsert>,
  ) => {
    const heldReferences = await db.select().from(views.cveReferences)
      .where(inArray(views.cveReferences.cveId, cveRowIds));
    const heldVersions = await db.select().from(views.cveAffectedVersions)
      .where(inArray(views.cveAffectedVersions.cveId, cveRowIds));
    const referenceDiff = diffRows(heldReferences, references, referenceKey, referenceKey);
    const versionDiff = diffRows(heldVersions, affectedVersions, affectedVersionKey, affectedVersionKey);
    if (referenceDiff.stale.length > 0) {
      await db.delete(cveReferences).where(inArray(cveReferences.id, referenceDiff.stale.map((row) => row.id)));
    }
    if (versionDiff.stale.length > 0) {
      await db.delete(cveAffectedVersions).where(inArray(cveAffectedVersions.id, versionDiff.stale.map((row) => row.id)));
    }
    if (referenceDiff.missing.length > 0) {
      await db.insert(cveReferences).values(referenceDiff.missing);
    }
    if (versionDiff.missing.length > 0) {
      await db.insert(cveAffectedVersions).values(versionDiff.missing);
    }
  },

  /** Drops the stored upgrade prose of the given CVEs, for a record that no longer states any. */
  clearVendorSolutions: async ({ db }, cveIds: Array<string>) => {
    if (cveIds.length === 0) {
      return;
    }
    await db.update(cve).set({ vendorSolution: null }).where(inArray(cve.cveId, cveIds));
  },

  findAll: async ({ db, views }, params: {
    limit: number,
    offset: number,
    search?: string,
    sortBy: CveListSortKey,
    sortDesc: boolean,
  }) => {
    const sortColumns = {
      cveId: views.cve.cveId,
      cvss: views.cve.cvss,
      epss: views.cve.epss,
      kev: cisaListedSql(views.cve),
      updatedAt: views.cve.updatedAt,
    };
    const sortColumn = sortColumns[params.sortBy];
    // A CVE no feed has scored yet goes last in both directions, not first of an ascending list.
    const sortOrder = orderNullsLast(sortColumn, params.sortDesc);
    return db.select().from(views.cve)
      .where(searchCveList(views, params.search))
      .orderBy(sortOrder, desc(views.cve.cveId))
      .limit(params.limit)
      .offset(params.offset);
  },

  countAll: async ({ db, views }, search?: string) =>
    db.select({ count: sql<number>`count(*)::int` }).from(views.cve)
      .where(searchCveList(views, search))
      .then((r) => r[0].count),

  findByCveId: async ({ db, views }, cveId: string) =>
    db.select().from(views.cve).where(eq(views.cve.cveId, cveId)).then((r) => r.at(0) ?? null),

  findByCveIds: async ({ db, views }, cveIds: Array<string>) => {
    if (cveIds.length === 0) {
      return [];
    }
    return db.select().from(views.cve).where(inArray(views.cve.cveId, cveIds)).orderBy(desc(views.cve.cveId));
  },

  /** `excludeAttachedToAssetId` leaves out the CVEs that asset already carries, before the limit cuts the list. */
  search: async ({ db, views }, query: string, limit: number, excludeAttachedToAssetId: string | null = null) =>
    db.select({ id: views.cve.id, cveId: views.cve.cveId, cveTitle: views.cve.cveTitle })
      .from(views.cve)
      .where(and(
        ilike(views.cve.cveId, `${escapeLikePattern(query)}%`),
        excludeAttachedToAssetId === null
          ? undefined
          : notExists(db.select({ attached: sql`1` }).from(views.assetEvidence).where(and(
            eq(views.assetEvidence.cveId, views.cve.id),
            eq(views.assetEvidence.supportingAssetId, excludeAttachedToAssetId),
          ))),
      ))
      .orderBy(asc(views.cve.cveId))
      .limit(limit),

  findTechniqueResolverInputs: async ({ db, views }, ids: Array<string>) => {
    if (ids.length === 0) {
      return [];
    }
    return db.select({
      id: views.cve.id,
      tenantId: views.cve.tenantId,
      cveId: views.cve.cveId,
      cwe: views.cve.cwe,
      cvssVector: views.cve.cvssVector,
      cvssV2UserInteractionRequired: views.cve.cvssV2UserInteractionRequired,
      updatedAt: views.cve.updatedAt,
      // Same clock as `updatedAt`: a staleness check against a client-side timestamp would race
      // whenever the app server and the database clocks drift apart.
      serverNow: sql<string>`now()`.mapWith(asDate),
    }).from(views.cve).where(inArray(views.cve.id, ids));
  },

  findIdsByCveIds: async ({ db, views }, cveIds: Array<string>) => {
    if (cveIds.length === 0) {
      return new Map<string, string>();
    }
    const rows = await db.select({ id: views.cve.id, cveId: views.cve.cveId })
      .from(views.cve)
      .where(inArray(views.cve.cveId, cveIds));
    return new Map(rows.map((r) => [r.cveId, r.id]));
  },

  /**
   * `findIdsByCveIds`, holding each row until the caller's transaction ends. Rows are taken in byte
   * order of their CVE id: a caller that inserts shells in the same transaction inserts them in that
   * order too, or two writers can wait on each other in a cycle.
   */
  lockIdsByCveIds: async ({ db, views }, cveIds: Array<string>) => {
    if (cveIds.length === 0) {
      return new Map<string, string>();
    }
    const rows = await db.select({ id: views.cve.id, cveId: views.cve.cveId })
      .from(views.cve)
      .where(inArray(views.cve.cveId, cveIds))
      .orderBy(sql`${views.cve.cveId} COLLATE "C"`)
      .for('no key update');
    return new Map(rows.map((r) => [r.cveId, r.id]));
  },
});

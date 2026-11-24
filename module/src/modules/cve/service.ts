import { newError } from '@app/utils';
import { uuidv7 } from 'uuidv7';
import type { EventOrigin } from '../../security';
import type { InferRepository } from '../../registry';
import type { CveListSortKey } from './list-sort';
import type { CveFetchListing } from './repository';
import type { cveSourceObservations } from './schema';
import type { CveSource } from './sources';
import { defineService } from '../../registry';
import { isCisaListed } from './cisa-listing';
import { nvdRecordState } from './nvd-record';
import { cveRepository } from './repository';
import { cvssVersionOf, resolveCveFields } from './resolution';

type Repo = InferRepository<typeof cveRepository>;

type SourceReport = Omit<typeof cveSourceObservations.$inferInsert, 'id' | 'tenantId' | 'cveId' | 'source' | 'createdAt' | 'updatedAt'> & { cveId: string };

const safeParseDate = (dateStr: string): Date | null => {
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? null : d;
};

const requireTenant = (eventOrigin: EventOrigin): string => {
  if (!('tenantId' in eventOrigin)) {
    throw newError('Tenant context required');
  }
  return eventOrigin.tenantId;
};

const PURGE_BATCH = 1_000;

type Atomic = <T>(callback: (ctx: { repo: Repo }) => Promise<T>) => Promise<T>;

/**
 * Creates the CVE rows the tenant lacks and holds every row of `cveIds` until the caller's
 * transaction ends.
 *
 * A row a purge had locked when the insert found it is gone by the time the hold gets it: it is
 * inserted again, once, and a row this transaction inserted is one no purge can see.
 */
const insertAndHoldCves = async (repo: Repo, tenantId: string, cveIds: Array<string>) => {
  let missing = cveIds;
  for (let attempt = 0; attempt < 2 && missing.length > 0; attempt++) {
    await repo.insertCveShells(missing.map((cveId) => ({ id: uuidv7(), tenantId, cveId })));
    const held = await repo.holdCveRowsByCveIds(missing);
    missing = missing.filter((cveId) => !held.has(cveId));
  }
};

/**
 * Holds the touched CVE rows from before reading their observations until the resolved fields are
 * written, so a source writing the same CVEs concurrently resolves after this one commits, with its
 * observation in hand.
 *
 * A report on a CVE the tenant does not hold is dropped: a feed enriches the flaws in the tenant's
 * scope, and only `shellCveIds`, the CVEs a finding connector carries, enter it here.
 */
const recordSourceReports = async (
  atomic: Atomic,
  tenantId: string,
  source: CveSource,
  reports: Array<SourceReport>,
  shellCveIds: Array<string> = [],
) => {
  // One statement cannot conflict twice on the same row, so a CVE listed twice keeps its last report.
  const byCveId = new Map(reports.map((report) => [report.cveId, report]));
  const shellIds = [...new Set(shellCveIds)].sort();
  if (byCveId.size === 0 && shellIds.length === 0) {
    return;
  }
  await atomic(async ({ repo }) => {
    await insertAndHoldCves(repo, tenantId, shellIds);
    if (byCveId.size === 0) {
      return;
    }
    const rowIdByCveId = await repo.lockIdsByCveIds([...byCveId.keys()]);
    if (rowIdByCveId.size === 0) {
      return;
    }
    await repo.upsertSourceObservations([...byCveId.values()].flatMap(({ cveId, ...fields }) => {
      const rowId = rowIdByCveId.get(cveId);
      return rowId === undefined ? [] : [{ ...fields, tenantId, cveId: rowId, source }];
    }));

    const observationsByRowId = Map.groupBy(await repo.findSourceObservations([...rowIdByCveId.values()]), (o) => o.cveId);
    await repo.writeResolvedFields([...rowIdByCveId].map(([cveId, rowId]) => ({
      ...resolveCveFields(observationsByRowId.get(rowId) ?? []),
      id: rowId,
      tenantId,
      cveId,
    })));
  });
};

/** The `kev` a caller reads is the CISA listing, whatever the stored flag says. */
const withCisaListing = <T extends { kevUpdatedAt: Date | null }>(row: T) => ({ ...row, kev: isCisaListed(row) });

export const cveService = defineService(
  'cve',
  cveRepository,
).implement({
  listCve: async ({ repo }, params: {
    page: number,
    limit: number,
    search?: string,
    sortBy?: CveListSortKey,
    sortDesc?: boolean,
  }) => {
    const offset = (params.page - 1) * params.limit;
    const [items, total] = await Promise.all([
      repo.findAll({
        limit: params.limit,
        offset,
        search: params.search,
        sortBy: params.sortBy ?? 'cveId',
        sortDesc: params.sortDesc ?? true,
      }),
      repo.countAll(params.search),
    ]);
    return { items: items.map(withCisaListing), total, page: params.page, limit: params.limit };
  },

  getCveByCveId: async ({ repo }, cveId: string) => {
    const row = await repo.findByCveId(cveId);
    if (row === null) {
      return null;
    }
    const hasNvdObservation = await repo.hasSourceObservation(row.id, 'nvd');
    return { ...withCisaListing(row), nvdRecord: nvdRecordState(row.remediationReadAt, hasNvdObservation) };
  },

  getCvesByCveIds: async ({ repo }, cveIds: Array<string>) =>
    (await repo.findByCveIds(cveIds)).map(withCisaListing),

  searchCve: async ({ repo }, query: string) => await repo.search(query, 20),

  upsertEpssScores: async ({ atomic, eventOrigin }, scores: Array<{ cveId: string, epss: number, date: string }>) => {
    const tenantId = requireTenant(eventOrigin);
    const reports: Array<SourceReport> = [];
    for (const s of scores) {
      const epssUpdatedAt = safeParseDate(s.date);
      if (!epssUpdatedAt) {
        continue;
      }
      reports.push({ cveId: s.cveId, epss: s.epss, epssUpdatedAt });
    }
    await recordSourceReports(atomic, tenantId, 'first', reports);
  },

  upsertCvssScores: async ({ atomic, eventOrigin }, scores: Array<{
    cveId: string,
    cvss?: number,
    cvssVector?: string,
    cvssV2UserInteractionRequired?: boolean,
    cwe?: Array<string>,
    published?: string,
    lastModified: string,
    title?: string,
    description?: string,
  }>) => {
    const tenantId = requireTenant(eventOrigin);
    const reports: Array<SourceReport> = [];
    for (const s of scores) {
      const lastModifiedAt = safeParseDate(s.lastModified);
      if (!lastModifiedAt) {
        continue;
      }
      reports.push({
        cveId: s.cveId,
        cvss: s.cvss,
        cvssVector: s.cvssVector,
        cvssV2UserInteractionRequired: s.cvssV2UserInteractionRequired,
        cvssVersion: s.cvssVector === undefined ? undefined : cvssVersionOf(s.cvssVector),
        // Left absent with the score, so a feed record with no metric never re-dates a score a connector supplied.
        cvssUpdatedAt: s.cvss === undefined ? undefined : lastModifiedAt,
        cwe: s.cwe,
        title: s.title,
        description: s.description,
        publishedAt: s.published === undefined ? undefined : safeParseDate(s.published) ?? undefined,
        lastModifiedAt,
      });
    }
    await recordSourceReports(atomic, tenantId, 'nvd', reports);
  },

  upsertKevFlags: async ({ atomic, eventOrigin }, entries: Array<{
    cveId: string,
    dateAdded: string,
    title?: string,
    requiredAction?: string,
    ransomwareUse?: string,
    dueDate?: string,
    notes?: string,
  }>) => {
    const tenantId = requireTenant(eventOrigin);
    const reports: Array<SourceReport> = [];
    for (const e of entries) {
      const kevUpdatedAt = safeParseDate(e.dateAdded);
      if (!kevUpdatedAt) {
        continue;
      }
      reports.push({
        cveId: e.cveId,
        kev: true,
        kevUpdatedAt,
        title: e.title,
        kevRequiredAction: e.requiredAction,
        kevDueDate: e.dueDate === undefined ? undefined : safeParseDate(e.dueDate) ?? undefined,
        kevNotes: e.notes,
        kevRansomwareUse: e.ransomwareUse,
      });
    }
    await recordSourceReports(atomic, tenantId, 'cisa_kev', reports);
  },

  /** A CVE Defender states neither a score nor a flag for is created without an observation. */
  upsertDefenderReports: async ({ atomic, eventOrigin }, reports: Array<{ cveId: string, cvss: number | null, isExploitAvailable: boolean | null }>) => {
    const tenantId = requireTenant(eventOrigin);
    const stated = reports.filter((r) => r.cvss !== null || r.isExploitAvailable !== null);
    await recordSourceReports(
      atomic,
      tenantId,
      'microsoft_defender',
      stated.map((r) => ({ cveId: r.cveId, cvss: r.cvss, kev: r.isExploitAvailable })),
      reports.map((r) => r.cveId),
    );
  },

  /**
   * The vendor's own upgrade prose, as the last record read states it.
   *
   * A null entry is a record that was read and states no solution: it clears what was stored, since
   * the upsert coalesces and would otherwise keep publishing prose the vendor has withdrawn. A CVE
   * whose record could not be read is absent from the entries and keeps what it had.
   */
  upsertVendorSolutions: async ({ repo, eventOrigin }, entries: Array<{ cveId: string, solution: string | null }>) => {
    const tenantId = requireTenant(eventOrigin);
    const stated = entries
      .map((e) => ({ cveId: e.cveId, solution: e.solution?.trim() ?? '' }))
      .filter((e) => e.solution.length > 0);
    const withdrawn = entries
      .filter((e) => (e.solution?.trim() ?? '').length === 0)
      .map((e) => e.cveId);
    if (stated.length > 0) {
      await repo.upsertVendorSolutionBatch(stated.map((e) => ({
        id: uuidv7(), tenantId, cveId: e.cveId, vendorSolution: e.solution,
      })));
    }
    if (withdrawn.length > 0) {
      await repo.clearVendorSolutions(withdrawn);
    }
  },

  /**
   * For a connector that only knows a CVE's id: the CVE exists afterwards, and nothing it holds
   * changes. Inside a caller's transaction the rows are held until it ends, so a caller writing the
   * finding or the threat that keeps them in the same transaction never loses them to the purge.
   */
  upsertCves: async ({ atomic, eventOrigin }, cves: Array<{ cveId: string }>) => {
    const tenantId = requireTenant(eventOrigin);
    const cveIds = [...new Set(cves.map(({ cveId }) => cveId))].sort();
    await atomic(async ({ repo }) => {
      await insertAndHoldCves(repo, tenantId, cveIds);
    });
  },

  getCveIdsWithFindings: async ({ repo }) => await repo.findCveRowIdsWithFindings(),

  getCveIdsToFetch: async ({ repo }, params: CveFetchListing & { afterCveId: string | null, limit: number }) =>
    await repo.findCveIdsToFetch(params),

  countCveIdsToFetch: async ({ repo }, params: CveFetchListing) => await repo.countCveIdsToFetch(params),

  /**
   * Brings a CVE into the tenant's scope by its published id, and holds its row until the caller's
   * transaction ends, so the purge cannot take it before the caller has attached what keeps it.
   *
   * A purge deleting the row between the insert and the lock is answered by inserting it again,
   * once: that purge has committed, and the next one passes by the row this call holds.
   */
  holdCve: async ({ atomic, eventOrigin }, cveId: string): Promise<string | null> => {
    const tenantId = requireTenant(eventOrigin);
    return atomic(async ({ repo }) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const createdId = await repo.insertCveShell({ id: uuidv7(), tenantId, cveId });
        const id = createdId ?? (await repo.findIdsByCveIds([cveId])).get(cveId);
        if (id !== undefined && await repo.holdCveRows([id]) > 0) {
          return id;
        }
      }
      return null;
    });
  },

  /** Holds a CVE row the tenant holds until the caller's transaction ends; false when it holds none. */
  lockCve: async ({ repo }, id: string) => await repo.holdCveRows([id]) > 0,

  /**
   * Deletes the tenant's CVEs nothing keeps any more, a batch per transaction so the first purge of
   * a tenant that held the whole NVD catalogue never holds its locks for the whole walk.
   *
   * @returns how many CVE rows went
   */
  purgeOutOfScope: async ({ atomic, eventOrigin }, signal?: AbortSignal) => {
    // The keep test reads findings and threats through their marking policies, which narrow a
    // member's reads: a finding out of their clearance would read as absent, and go with its CVE.
    if (eventOrigin.type !== 'job') {
      throw newError('The CVE purge runs as a job, whose origin no marking narrows');
    }
    requireTenant(eventOrigin);
    let purged = 0;
    while (signal?.aborted !== true) {
      const deleted = await atomic(async ({ repo }) => {
        const ids = await repo.lockPurgeableCveIds(PURGE_BATCH);
        return { locked: ids.length, deleted: await repo.deleteUnkeptCves(ids) };
      });
      purged += deleted.deleted;
      if (deleted.locked < PURGE_BATCH) {
        break;
      }
    }
    return purged;
  },

  /**
   * What the feeds published on how to fix this flaw.
   *
   * A CVE the tenant does not hold, or holds without the enrichment having run yet, answers with
   * empty collections rather than an error: nothing to remediate and nothing ingested read the same
   * to a caller, and the surface says which is which from its own state.
   *
   * The tenant is required, and absent it this throws rather than reading: a CVE id repeats across
   * tenants, and `tenantIsolationPolicy` leaves a client origin carrying no tenant unfiltered, so
   * the lookup would answer with whichever tenant's row came first.
   */
  getRemediation: async ({ repo, eventOrigin }, cveId: string) => {
    if (!('tenantId' in eventOrigin)) {
      throw newError('Tenant context required');
    }
    const row = await repo.findByCveId(cveId);
    if (row === null) {
      return { references: [], affectedVersions: [] };
    }
    const [references, affectedVersions] = await Promise.all([
      repo.findReferencesByCveRowId(row.id),
      repo.findAffectedVersionsByCveRowId(row.id),
    ]);
    return { references, affectedVersions };
  },

  /**
   * Stores the remediation the feed states for flaws the tenant carries.
   *
   * Entries naming a CVE row the caller did not resolve are dropped rather than created: this write
   * enriches known flaws, it never brings a new one into the catalogue.
   */
  replaceRemediation: async ({ atomic, eventOrigin }, entries: Array<{
    cveRowId: string,
    references: Array<{ url: string, source?: string, tags?: Array<string> }>,
    affectedVersions: Array<{
      vendor?: string,
      product?: string,
      affectedFrom?: string,
      affectedUpTo: string,
      affectedUpToIncluded: boolean,
    }>,
  }>) => {
    if (!('tenantId' in eventOrigin)) {
      throw newError('Tenant context required');
    }
    if (entries.length === 0) {
      return;
    }
    const tenantId = eventOrigin.tenantId;
    const references = entries.flatMap((entry) => entry.references.map((reference) => ({
      id: uuidv7(),
      tenantId,
      cveId: entry.cveRowId,
      url: reference.url,
      source: reference.source,
      tags: reference.tags,
    })));
    const affectedVersions = entries.flatMap((entry) => entry.affectedVersions.map((version) => ({
      id: uuidv7(),
      tenantId,
      cveId: entry.cveRowId,
      vendor: version.vendor,
      product: version.product,
      affectedFrom: version.affectedFrom,
      affectedUpTo: version.affectedUpTo,
      affectedUpToIncluded: version.affectedUpToIncluded,
    })));
    await atomic(async ({ repo }) => {
      const cveRowIds = entries.map((entry) => entry.cveRowId);
      await repo.replaceCveEnrichment(cveRowIds, references, affectedVersions);
      await repo.markRemediationRead(cveRowIds);
    });
  },

  getTechniqueResolverInputs: async ({ repo }, ids: Array<string>) =>
    await repo.findTechniqueResolverInputs(ids),

  getCveIdMap: async ({ repo, eventOrigin }, cveIds: Array<string>) => {
    if (!('tenantId' in eventOrigin)) {
      throw newError('Tenant context required');
    }
    return repo.findIdsByCveIds(cveIds);
  },
});

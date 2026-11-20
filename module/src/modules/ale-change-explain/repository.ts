import type { SQLWrapper } from 'drizzle-orm';
import type { SeverityBand } from '../finding-score/bands';
import type { ResolvedEstate } from '../organizations/estate-filter';
import { and, asc, between, countDistinct, desc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { defineRepository } from '../../registry';
import { estateFilter, estateOfMappedScope, OPEN_ESTATE } from '../organizations/estate-filter';
import { SYNC_ORIGINS } from '../supporting-assets/constants';

export const aleChangeExplainRepository = defineRepository({
  findScenarioRuns: async ({ db, views }, riskScenarioId: string, runIds: ReadonlyArray<string>) =>
    db
      .select()
      .from(views.crqIndicatorRuns)
      .where(and(
        eq(views.crqIndicatorRuns.riskScenarioId, riskScenarioId),
        inArray(views.crqIndicatorRuns.id, [...runIds]),
      )),

  /** Newest first, only the columns the curve of the "What changed" page is drawn from. */
  findScenarioRunCurve: async ({ db, views }, riskScenarioId: string) =>
    db
      .select({
        id: views.crqIndicatorRuns.id,
        createdAt: views.crqIndicatorRuns.createdAt,
        aleMean: views.crqIndicatorRuns.aleMean,
        tefMin: views.crqIndicatorRuns.tefMin,
        tefLikely: views.crqIndicatorRuns.tefLikely,
        tefMax: views.crqIndicatorRuns.tefMax,
        outcomeEvicted: views.crqIndicatorRuns.outcomeEvicted,
        outcomeImpactDetected: views.crqIndicatorRuns.outcomeImpactDetected,
        outcomeImpactUndetected: views.crqIndicatorRuns.outcomeImpactUndetected,
        magnitudeMean: views.crqIndicatorRuns.magnitudeMean,
      })
      .from(views.crqIndicatorRuns)
      .where(eq(views.crqIndicatorRuns.riskScenarioId, riskScenarioId))
      .orderBy(desc(views.crqIndicatorRuns.createdAt), desc(views.crqIndicatorRuns.id)),

  findScenarioRunsBetween: async ({ db, views }, riskScenarioId: string, from: Date, to: Date) =>
    db
      .select({
        id: views.crqIndicatorRuns.id,
        createdAt: views.crqIndicatorRuns.createdAt,
        readAt: views.crqIndicatorRuns.readAt,
        uncontestedPairCount: views.crqIndicatorRuns.uncontestedPairCount,
        uncontestablePairCount: views.crqIndicatorRuns.uncontestablePairCount,
      })
      .from(views.crqIndicatorRuns)
      .where(and(
        eq(views.crqIndicatorRuns.riskScenarioId, riskScenarioId),
        between(views.crqIndicatorRuns.createdAt, from, to),
      ))
      .orderBy(asc(views.crqIndicatorRuns.createdAt), asc(views.crqIndicatorRuns.id)),

  findGroupSharesByRunIds: async ({ db, views }, runIds: ReadonlyArray<string>) =>
    db
      .select({
        runId: views.crqIndicatorGroupScores.runId,
        actorClass: views.crqIndicatorGroupScores.actorClass,
        share: views.crqIndicatorGroupScores.share,
      })
      .from(views.crqIndicatorGroupScores)
      .where(inArray(views.crqIndicatorGroupScores.runId, [...runIds])),

  findReachGapsByRunIds: async ({ db, views }, runIds: ReadonlyArray<string>) =>
    db
      .select({
        runId: views.crqIndicatorRunReachGaps.runId,
        gap: views.crqIndicatorRunReachGaps.gap,
        family: views.crqIndicatorRunReachGaps.family,
        externalId: views.mitreTechniques.externalId,
        name: views.mitreTechniques.name,
      })
      .from(views.crqIndicatorRunReachGaps)
      .innerJoin(views.mitreTechniques, eq(views.crqIndicatorRunReachGaps.mitreTechniqueId, views.mitreTechniques.id))
      .where(inArray(views.crqIndicatorRunReachGaps.runId, [...runIds]))
      .orderBy(asc(views.mitreTechniques.externalId), asc(views.crqIndicatorRunReachGaps.family)),

  findScenarioScope: async ({ db, views }, riskScenarioId: string) =>
    db
      .select({ organizationId: views.organizations.id, name: views.organizations.name })
      .from(views.riskScenarios)
      .innerJoin(views.organizations, eq(views.riskScenarios.organizationId, views.organizations.id))
      .where(eq(views.riskScenarios.id, riskScenarioId))
      .then((rows) => rows.at(0)),

  findControlLeversByRunIds: async ({ db, views }, runIds: ReadonlyArray<string>) =>
    db
      .selectDistinct({
        runId: views.crqControlWhatIfResults.runId,
        controlId: views.crqControlWhatIfResults.controlId,
        name: views.controlCapabilities.name,
        currentStrength: views.crqControlWhatIfResults.currentStrength,
        currentCoverage: views.crqControlWhatIfResults.currentCoverage,
      })
      .from(views.crqControlWhatIfResults)
      .innerJoin(views.controlCapabilities, eq(views.crqControlWhatIfResults.controlId, views.controlCapabilities.id))
      .where(inArray(views.crqControlWhatIfResults.runId, [...runIds])),

  findControlAssessmentEvents: async ({ db, views }, controlIds: ReadonlyArray<string>, organizationId: string, until: Date) =>
    db
      .select({
        id: views.controlCapabilityAssessmentEvents.id,
        controlId: views.controlCapabilityAssessmentEvents.capabilityId,
        organizationId: views.controlCapabilityAssessmentEvents.organizationId,
        newStrength: views.controlCapabilityAssessmentEvents.newStrength,
        newCoverage: views.controlCapabilityAssessmentEvents.newCoverage,
        createdAt: views.controlCapabilityAssessmentEvents.createdAt,
      })
      .from(views.controlCapabilityAssessmentEvents)
      .where(and(
        inArray(views.controlCapabilityAssessmentEvents.capabilityId, [...controlIds]),
        or(
          isNull(views.controlCapabilityAssessmentEvents.organizationId),
          eq(views.controlCapabilityAssessmentEvents.organizationId, organizationId),
        ),
        lte(views.controlCapabilityAssessmentEvents.createdAt, until),
      )),

  findScenarioEstate: async ({ db, views }, riskScenarioId: string): Promise<ResolvedEstate | undefined> => {
    const scope = (await db
      .select({ organizationId: views.riskScenarios.organizationId, estateMode: views.organizations.estateMode })
      .from(views.riskScenarios)
      .innerJoin(views.organizations, eq(views.organizations.id, views.riskScenarios.organizationId))
      .where(eq(views.riskScenarios.id, riskScenarioId))
      .limit(1)).at(0);
    if (scope === undefined) {
      return undefined;
    }
    return scope.estateMode === 'closed' ? estateOfMappedScope(scope.organizationId) : OPEN_ESTATE;
  },

  /**
   * For each estate asset with a posture line after `from` and up to `to`, the line in force at
   * `from` when there is one, then those lines. An asset with no line in between kept its posture.
   * With `touched`, only the assets also holding a line in that span, still with all their lines.
   */
  findEstatePostureLines: async ({ db, views }, estate: ResolvedEstate, from: Date, to: Date, touched?: { from: Date, to: Date }) => {
    const history = views.assetPostureHistory;
    const line = {
      supportingAssetId: history.supportingAssetId,
      name: views.supportingAssets.name,
      derivedName: views.supportingAssets.derivedName,
      score: history.score,
      changedAt: history.changedAt,
    };
    const inWindow = and(
      gt(history.changedAt, from),
      lte(history.changedAt, to),
      estateFilter({ db, views }, estate, history.supportingAssetId),
      touched === undefined
        ? undefined
        : inArray(history.supportingAssetId, db.select({ supportingAssetId: history.supportingAssetId }).from(history).where(between(history.changedAt, touched.from, touched.to))),
    );
    const movedAssetIds = db.select({ supportingAssetId: history.supportingAssetId }).from(history).where(inWindow);
    const [inForce, moved] = await Promise.all([
      // eslint-disable-next-line app/no-distinct-on-subquery -- grows with each moved asset's posture history, which the trim caps by age, not count
      db
        .selectDistinctOn([history.supportingAssetId], line)
        .from(history)
        .innerJoin(views.supportingAssets, eq(views.supportingAssets.id, history.supportingAssetId))
        .where(and(lte(history.changedAt, from), inArray(history.supportingAssetId, movedAssetIds)))
        .orderBy(asc(history.supportingAssetId), desc(history.changedAt)),
      db
        .select(line)
        .from(history)
        .innerJoin(views.supportingAssets, eq(views.supportingAssets.id, history.supportingAssetId))
        .where(inWindow)
        .orderBy(asc(history.supportingAssetId), asc(history.changedAt)),
    ]);
    return [...inForce, ...moved];
  },

  /**
   * The estate's CVE unique findings whose presence or band differs between `from` and `to`, read
   * from their journal: a group is present at an instant when the line in force then has an asset
   * count. With `touched`, only those holding a line in that span: a change is dated on one of its lines.
   */
  findUniqueFindingChanges: async ({ db, views }, estate: ResolvedEstate, at: { from: Date, to: Date }, touched?: { from: Date, to: Date }) => {
    const { from, to } = at;
    const journal = views.uniqueFindingScoreHistory;
    const chronological = sql`partition by ${journal.cveId} order by ${journal.changedAt}, ${journal.id}`;
    const lines = db
      .select({
        cveRowId: sql<string>`${journal.cveId}`.as('line_cve_id'),
        lineId: sql<string>`${journal.id}`.as('line_id'),
        changedAt: sql<Date>`${journal.changedAt}`.as('line_changed_at'),
        band: sql<SeverityBand | null>`${journal.band}`.as('line_band'),
        assets: sql<number | null>`${journal.affectedAssetCount}`.as('line_assets'),
        previousBand: sql<SeverityBand | null>`lag(${journal.band}) over (${chronological})`.as('line_previous_band'),
        previousAssets: sql<number | null>`lag(${journal.affectedAssetCount}) over (${chronological})`.as('line_previous_assets'),
      })
      .from(journal)
      .where(and(
        lte(journal.changedAt, to),
        estate.mode === 'closed' ? eq(journal.organizationId, estate.organizationId) : isNull(journal.organizationId),
        touched === undefined
          ? undefined
          : inArray(journal.cveId, db.select({ cveId: journal.cveId }).from(journal).where(between(journal.changedAt, touched.from, touched.to))),
      ))
      .as('unique_finding_lines');

    const latestFirst = sql`order by ${lines.changedAt} desc, ${lines.lineId} desc`;
    const inForceAt = <T>(column: SQLWrapper, upTo: Date | null) => (upTo === null
      ? sql<T | null>`(array_agg(${column} ${latestFirst}))[1]`
      : sql<T | null>`(array_agg(${column} ${latestFirst}) filter (where ${lines.changedAt} <= ${upTo}))[1]`);
    const since = sql`${lines.changedAt} > ${from}`;
    const left = sql`${lines.assets} is null`;
    const timestamp = (value: string | null) => (value === null ? null : new Date(value));
    const assetsBefore = inForceAt<number>(lines.assets, from);
    const assetsAfter = inForceAt<number>(lines.assets, null);
    const bandBefore = inForceAt<SeverityBand>(lines.band, from);
    const bandAfter = inForceAt<SeverityBand>(lines.band, null);

    return db
      .select({
        cveId: views.cve.cveId,
        assetsBefore,
        assetsAfter,
        bandBefore,
        bandAfter,
        appearedAt: sql<Date | null>`max(${lines.changedAt}) filter (where ${since} and not ${left} and ${lines.previousAssets} is null)`.mapWith(timestamp),
        leftAt: sql<Date | null>`max(${lines.changedAt}) filter (where ${since} and ${left})`.mapWith(timestamp),
        bandMovedAt: sql<Date | null>`max(${lines.changedAt}) filter (where ${since} and not ${left} and ${lines.band} is distinct from ${lines.previousBand})`.mapWith(timestamp),
      })
      .from(lines)
      .innerJoin(views.cve, eq(views.cve.id, lines.cveRowId))
      .groupBy(views.cve.id, views.cve.cveId)
      .having(sql`(${assetsBefore} is null) <> (${assetsAfter} is null) or ${bandBefore} is distinct from ${bandAfter}`);
  },

  /**
   * Of the CVEs that left, those a connector took out whole: every estate finding that existed and
   * stood applicable at `from` and is dismissed at `to` was dismissed by a connector, and they cover
   * every asset the CVE held before. A finding created since does not count. A finding on an asset
   * that has since left the estate is not read here, so its CVE falls short of that count and keeps
   * reading as no longer applying. None qualifies once the scope's estate changed after `from`: the
   * mapping keeps no history, so an asset mapped since could stand in for one removed.
   */
  findCvesNoLongerReported: async (
    { db, views },
    riskScenarioId: string,
    estate: ResolvedEstate,
    left: ReadonlyArray<{ cveId: string, assetsBefore: number }>,
    at: { from: Date, to: Date },
  ) => {
    if (left.length === 0) {
      return new Set<string>();
    }
    const [scope] = await db
      .select({ estateChangedAt: views.organizations.estateChangedAt })
      .from(views.riskScenarios)
      .innerJoin(views.organizations, eq(views.organizations.id, views.riskScenarios.organizationId))
      .where(eq(views.riskScenarios.id, riskScenarioId));
    if (scope?.estateChangedAt != null && scope.estateChangedAt > at.from) {
      return new Set<string>();
    }
    const history = views.assetEvidenceHistory;
    const inForceAt = (moment: Date, name: string) => db
      .select({ state: history.state, origin: history.origin })
      .from(history)
      .where(and(eq(history.assetEvidenceId, views.assetEvidence.id), lte(history.stateChangedAt, moment)))
      .orderBy(desc(history.stateChangedAt), desc(history.id))
      .limit(1)
      .as(name);
    const inForceAtFrom = inForceAt(at.from, 'in_force_at_from');
    const inForceAtTo = inForceAt(at.to, 'in_force_at_to');
    const rows = await db
      .select({ cveId: views.cve.cveId, assets: countDistinct(views.assetEvidence.supportingAssetId) })
      .from(views.assetEvidence)
      .innerJoin(views.cve, eq(views.cve.id, views.assetEvidence.cveId))
      .innerJoinLateral(inForceAtFrom, sql`true`)
      .innerJoinLateral(inForceAtTo, sql`true`)
      .where(and(
        // One array parameter, not one per CVE: every CVE that left the scope is listed, which can pass
        // the driver's bind limit.
        sql`${views.cve.cveId} = any(${sql.param(left.map((cve) => cve.cveId))}::text[])`,
        estateFilter({ db, views }, estate, views.assetEvidence.supportingAssetId),
        lte(views.assetEvidence.createdAt, at.from),
        eq(inForceAtFrom.state, 'applicable'),
        eq(inForceAtTo.state, 'dismissed'),
      ))
      .groupBy(views.cve.cveId)
      .having(sql`bool_and(${inArray(inForceAtTo.origin, [...SYNC_ORIGINS])})`);
    const dismissedAssets = new Map(rows.map((row) => [row.cveId, row.assets]));
    return new Set(left
      .filter(({ cveId, assetsBefore }) => (dismissedAssets.get(cveId) ?? 0) >= assetsBefore)
      .map(({ cveId }) => cveId));
  },

  findRunTefTripletsByIds: async ({ db, views }, runIds: ReadonlyArray<string>) =>
    db
      .select({
        id: views.crqIndicatorRuns.id,
        tefMin: views.crqIndicatorRuns.tefMin,
        tefLikely: views.crqIndicatorRuns.tefLikely,
        tefMax: views.crqIndicatorRuns.tefMax,
      })
      .from(views.crqIndicatorRuns)
      .where(inArray(views.crqIndicatorRuns.id, [...runIds])),

  findTefEstimatesByScenarioId: async ({ db, views }, riskScenarioId: string) =>
    db
      .select({
        id: views.tefEstimates.id,
        catalogVintage: views.tefEstimates.catalogVintage,
        catalogId: views.tefEstimates.catalogId,
        catalogVersion: views.tefEstimates.catalogVersion,
        min: views.tefEstimates.min,
        likely: views.tefEstimates.likely,
        max: views.tefEstimates.max,
        countryIsoAlpha3: views.tefEstimates.countryIsoAlpha3,
        countryName: views.countries.name,
        sectorName: views.tefEstimates.sectorName,
        sizeSource: views.tefEstimates.sizeSource,
        readSizeClasses: views.tefEstimates.readSizeClasses,
        createdAt: views.tefEstimates.createdAt,
      })
      .from(views.tefEstimates)
      .innerJoin(views.riskScenarios, eq(views.riskScenarios.id, views.tefEstimates.riskScenarioId))
      .leftJoin(views.countries, and(eq(views.countries.tenantId, views.riskScenarios.tenantId), eq(views.countries.isoAlpha3, views.tefEstimates.countryIsoAlpha3)))
      .where(eq(views.tefEstimates.riskScenarioId, riskScenarioId))
      .orderBy(asc(views.tefEstimates.createdAt), asc(views.tefEstimates.id)),

});

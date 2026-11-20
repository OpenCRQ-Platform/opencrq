import type { SQL, SQLWrapper } from 'drizzle-orm';
import type { RepositoryContext } from '../../registry';
import type { CvssSeverityBucket } from '../cve/severity';
import type { SeverityBand } from '../finding-score/bands';
import type { ScenarioFindingSortKey, ScenarioFindingsQuery } from './scenario-lists';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { orderByFolded } from '../../db/fold-text';
import { LATERAL_ON } from '../../db/lateral';
import { inUuids } from '../../db/uuid-array';
import { cisaListedSql } from '../cve/cisa-listing';
import { latestEvidenceState } from '../supporting-assets/latest-evidence-state';

type ReadContext = Pick<RepositoryContext, 'db' | 'views'>;

/** Over the findings the filters keep, but `unfiltered`, which counts every finding of the scenario. */
export interface ScenarioFindingsSummary extends Record<SeverityBand | 'unscored', number> {
  dismissed: number,
  total: number,
  unfiltered: number,
}

export const NO_SCENARIO_FINDINGS: ScenarioFindingsSummary = {
  critical: 0, high: 0, medium: 0, low: 0, unscored: 0, dismissed: 0, total: 0, unfiltered: 0,
};

/** Counted over the applicable findings alone, but `dismissed` and `total`. */
export interface ScenarioFindingSeverities extends Record<CvssSeverityBucket, number> {
  kev: number,
  dismissed: number,
  total: number,
}

export const NO_SCENARIO_FINDING_SEVERITIES: ScenarioFindingSeverities = {
  critical: 0, high: 0, medium: 0, low: 0, none: 0, unscored: 0, kev: 0, dismissed: 0, total: 0,
};

/**
 * One row per (asset, CVE) among the CVE findings on the assets `primaryAssetIds` reach: when
 * several sources attached the same pair, the most recent wins, the latest of its state change and
 * its creation dating it, and it carries its stored state and the reason and origin of its latest
 * history row.
 *
 * Callers filter the state on this subquery, never inside it: a `dismissed` predicate under the
 * dedupe would let an older applicable row of the pair take the place of the dismissal that
 * superseded it.
 */
export const scenarioFindings = ({ db, views }: ReadContext, primaryAssetIds: Array<string>) => {
  const latest = latestEvidenceState({ db, views }, views.assetEvidence.id);
  // A connector persists the CVE id verbatim, and one-argument `btrim` strips spaces alone.
  const cveKey = sql<string>`upper(btrim(${views.cve.cveId}, E' \\t\\n\\r\\f\\v'))`;
  const recency = sql`greatest(${views.assetEvidence.currentStateChangedAt}, ${views.assetEvidence.createdAt})`;

  // bounded-by: restricted inside to the findings on the assets the scenario's primary assets reach
  return db
    .selectDistinctOn([views.assetEvidence.supportingAssetId, cveKey], {
      id: views.assetEvidence.id,
      supportingAssetId: views.assetEvidence.supportingAssetId,
      cveId: views.cve.cveId,
      cveTitle: views.cve.cveTitle,
      cvss: views.cve.cvss,
      epss: views.cve.epss,
      kev: cisaListedSql(views.cve).as('kev'),
      userId: views.assetEvidence.userId,
      createdAt: views.assetEvidence.createdAt,
      evaluatedAt: views.assetEvidence.evaluatedAt,
      currentState: views.assetEvidence.currentState,
      stateChangedAt: views.assetEvidence.currentStateChangedAt,
      stateReason: latest.reason,
      stateOrigin: latest.origin,
      dismissalType: latest.dismissalType,
    })
    .from(views.assetEvidence)
    .innerJoin(views.cve, eq(views.assetEvidence.cveId, views.cve.id))
    .leftJoinLateral(latest, LATERAL_ON)
    .where(inArray(
      views.assetEvidence.supportingAssetId,
      db.select({ id: views.primaryAssetReach.supportingAssetId })
        .from(views.primaryAssetReach)
        .where(inUuids(views.primaryAssetReach.primaryAssetId, primaryAssetIds)),
    ))
    .orderBy(views.assetEvidence.supportingAssetId, cveKey, desc(recency), desc(views.assetEvidence.id))
    .as('scenario_findings');
};

type ScenarioFindings = ReturnType<typeof scenarioFindings>;

/** The wire row of a finding, before its score and the threats exploiting it are added. */
export const scenarioFindingColumns = (findings: ScenarioFindings) => ({
  id: findings.id,
  supportingAssetId: findings.supportingAssetId,
  cveId: findings.cveId,
  cveTitle: findings.cveTitle,
  cvss: findings.cvss,
  epss: findings.epss,
  kev: findings.kev,
  userId: findings.userId,
  createdAt: findings.createdAt,
  currentState: findings.currentState,
  stateChangedAt: findings.stateChangedAt,
  stateReason: findings.stateReason,
  stateOrigin: findings.stateOrigin,
  dismissalType: findings.dismissalType,
});

export const applicableFinding = (findings: ScenarioFindings) => sql`${findings.currentState} <> 'dismissed'`;

/** On the finding's score row, which a `findings` read left-joins: a finding no score reached has no band. */
export const scenarioFindingsWhere = (
  { views }: Pick<RepositoryContext, 'views'>,
  findings: ScenarioFindings,
  { state, severity }: Pick<ScenarioFindingsQuery, 'state' | 'severity'>,
) => and(
  state === 'all' ? undefined : state === 'dismissed' ? sql`${findings.currentState} = 'dismissed'` : applicableFinding(findings),
  severity === 'all' ? undefined : severity === 'unscored' ? isNull(views.findingScores.band) : eq(views.findingScores.band, severity),
);

const nullsLast = (column: SQLWrapper, descending: boolean): SQL => (descending
  ? sql`${column} desc nulls last`
  : sql`${column} asc nulls last`);

/** Over the score row and the supporting asset a `findings` read joins; the finding's id breaks a tie, so a page is stable. */
export const scenarioFindingsOrder = (
  { views }: Pick<RepositoryContext, 'views'>,
  findings: ScenarioFindings,
  sortBy: ScenarioFindingSortKey,
  sortDesc: boolean,
): Array<SQL> => {
  // The row prints these three from the score line, so a finding no score has reached shows none and sorts last.
  const onceScored = (column: SQLWrapper) => sql`case when ${views.findingScores.assetEvidenceId} is null then null else ${column} end`;
  const columns: Record<ScenarioFindingSortKey, SQLWrapper> = {
    score: views.findingScores.score,
    name: findings.cveId,
    currentState: findings.currentState,
    assetName: views.supportingAssets.displayName,
    assetCategoryId: onceScored(views.supportingAssets.categoryId),
    lastEvaluatedAt: onceScored(findings.evaluatedAt),
    ageDays: onceScored(findings.createdAt),
  };
  // The oldest finding is the one of most days, so an age ordered down is a creation date ordered up.
  const descending = sortBy === 'ageDays' ? !sortDesc : sortDesc;
  const primary = sortBy === 'assetName'
    ? orderByFolded(views.supportingAssets.displayNameFolded, views.supportingAssets.displayName, descending)
    : [nullsLast(columns[sortBy], descending)];
  return [...primary, asc(findings.id)];
};

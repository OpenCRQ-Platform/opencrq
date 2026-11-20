import type { SQL, SQLWrapper } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { RepositoryContext } from '../../registry';
import type { EvidenceState } from './constants';
import { and, desc, eq, isNotNull, lte, sql } from 'drizzle-orm';

/**
 * One finding's latest history row, for a `leftJoinLateral(..., LATERAL_ON)` beside the finding, or
 * an `innerJoinLateral` where a finding without such a row is left out. The state and its date are
 * stored on the finding (`asset_evidence.current_state`), so this is read for what the stored state
 * does not carry (the reason, the origin, the kind of dismissal), and only for the rows of a page.
 *
 * Read per row through `asset_evidence_history_tenant_evidence_idx`, never as a `DISTINCT ON` over the
 * history joined afterwards: Postgres cannot push the join key into that subquery, so it sorts the
 * tenant's whole history on every call, whatever number of findings the caller reads.
 */
export const latestEvidenceState = (
  { db, views }: Pick<RepositoryContext, 'db' | 'views'>,
  evidenceIdColumn: PgColumn,
) => db
  .select({
    state: views.assetEvidenceHistory.state,
    stateChangedAt: views.assetEvidenceHistory.stateChangedAt,
    reason: views.assetEvidenceHistory.reason,
    origin: views.assetEvidenceHistory.origin,
    dismissalType: views.assetEvidenceHistory.dismissalType,
  })
  .from(views.assetEvidenceHistory)
  .where(eq(views.assetEvidenceHistory.assetEvidenceId, evidenceIdColumn))
  .orderBy(desc(views.assetEvidenceHistory.stateChangedAt), desc(views.assetEvidenceHistory.id))
  .limit(1)
  .as('latest_history');

/**
 * When a history row put its finding in its state, as `current_state_since` stores it: both call
 * `asset_evidence_history_entered_at`, the one definition. A window function: the query must read
 * every history row of the findings it covers.
 */
export const historyRowEnteredAt = ({ views }: Pick<RepositoryContext, 'views'>) => {
  const history = views.assetEvidenceHistory;
  return sql<Date>`asset_evidence_history_entered_at(${history.observedAt}, ${history.stateChangedAt}, lag(${history.stateChangedAt}) over (
    partition by ${history.assetEvidenceId} order by ${history.stateChangedAt}, ${history.id}
  ))`.mapWith(history.stateChangedAt);
};

/** A test verdict as the state it argues for: an expectation that held is `dismissed`, and no verdict argues for none. */
export const verdictState = (isExposed: SQLWrapper) =>
  sql<EvidenceState>`case when ${isExposed} then 'applicable' when not ${isExposed} then 'dismissed' end`;

/**
 * The latest test verdict of each finding `findings` keeps, as delivered by `upTo`, to join back on
 * those same findings: a reading of a past instant, which the stored verdict cannot answer. One
 * sorted pass over their verdicts, for a read covering many findings: a probe per finding loses past
 * a few thousand, and a pass over the tenant's whole log slows several times once its rows are not
 * stored in finding order.
 */
// bounded-by: restricted inside to the findings its caller joins it back on
export const latestVerdictsOf = (
  { db, views }: Pick<RepositoryContext, 'db' | 'views'>,
  findings: SQL,
  { upTo }: { upTo: Date },
) => db
  .selectDistinctOn([views.assetEvidenceVerdicts.assetEvidenceId], {
    assetEvidenceId: views.assetEvidenceVerdicts.assetEvidenceId,
    state: verdictState(views.assetEvidenceVerdicts.isExposed).as('state'),
    observedAt: views.assetEvidenceVerdicts.observedAt,
  })
  .from(views.assetEvidenceVerdicts)
  .innerJoin(views.assetEvidence, eq(views.assetEvidenceVerdicts.assetEvidenceId, views.assetEvidence.id))
  .where(and(lte(views.assetEvidenceVerdicts.recordedAt, upTo), findings))
  .orderBy(
    views.assetEvidenceVerdicts.assetEvidenceId,
    desc(views.assetEvidenceVerdicts.recordedAt),
    desc(views.assetEvidenceVerdicts.observedAt),
    desc(views.assetEvidenceVerdicts.id),
  )
  .as('latest_verdict');

/**
 * A finding's latest test verdict as the finding stores it (`asset_evidence.latest_verdict_*`, kept by
 * `asset_evidence_verdicts_refresh_latest`), read off the finding row itself. A reader that leaves out
 * the findings no test has spoken about adds `spoken` to its `where`.
 */
export const storedFindingVerdict = ({ views }: Pick<RepositoryContext, 'views'>) => ({
  state: verdictState(views.assetEvidence.latestVerdictExposed),
  observedAt: views.assetEvidence.latestVerdictObservedAt,
  spoken: isNotNull(views.assetEvidence.latestVerdictObservedAt),
});

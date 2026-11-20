import type { SeverityBand } from '../finding-score/bands';
import type { EvidenceState } from '../supporting-assets/constants';
import { SEVERITY_BANDS } from '../finding-score/bands';

/**
 * The orderings of a scenario's supporting assets. The walk below a primary asset can reach tens of
 * thousands of them, so each ranks the whole walk on the server and the page is cut from it.
 */
export const SCENARIO_SUPPORTING_ASSET_SORT_KEYS = ['impact', 'supportingAsset', 'depth', 'via'] as const;
export type ScenarioSupportingAssetSortKey = (typeof SCENARIO_SUPPORTING_ASSET_SORT_KEYS)[number];

/** The orderings of a scenario's findings, each one a column of the list. */
export const SCENARIO_FINDING_SORT_KEYS = ['score', 'name', 'currentState', 'assetName', 'assetCategoryId', 'lastEvaluatedAt', 'ageDays'] as const;
export type ScenarioFindingSortKey = (typeof SCENARIO_FINDING_SORT_KEYS)[number];

export const SCENARIO_FINDING_STATE_FILTERS = ['all', 'applicable', 'dismissed'] as const satisfies ReadonlyArray<EvidenceState | 'all'>;
export type ScenarioFindingStateFilter = (typeof SCENARIO_FINDING_STATE_FILTERS)[number];

/** `unscored` is a finding no score has reached yet, which carries no band. */
export const SCENARIO_FINDING_SEVERITY_FILTERS = ['all', ...SEVERITY_BANDS, 'unscored'] as const;
export type ScenarioFindingSeverityFilter = SeverityBand | 'all' | 'unscored';

export interface ScenarioPageQuery<SortKey extends string> {
  page: number,
  limit: number,
  /** Absent, the list's own default ordering. */
  sortBy?: SortKey,
  sortDesc: boolean,
}

export interface ScenarioFindingsQuery extends ScenarioPageQuery<ScenarioFindingSortKey> {
  state: ScenarioFindingStateFilter,
  severity: ScenarioFindingSeverityFilter,
}

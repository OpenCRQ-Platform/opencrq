import type { InferRepository } from '../../registry';
import type { SeverityBand } from '../finding-score/bands';
import type { crqIndicatorGroupScores, crqIndicatorRuns } from '../crq-indicators/schema';
import type { EvidenceState } from '../supporting-assets/constants';
import type { aleChangeExplainRepository } from './repository';

export const CHANGE_TABS = ['ale', 'tef', 'susceptibility', 'magnitude'] as const;
export type ChangeTab = typeof CHANGE_TABS[number];

export const CHANGE_CATEGORY_KEYS = ['run-results', 'technique-coverage', 'model', 'controls', 'findings-critical', 'findings-high', 'findings-other', 'assets-critical', 'assets-high', 'assets-other', 'attack-frequency'] as const;
export type ChangeCategoryKey = typeof CHANGE_CATEGORY_KEYS[number];

/** On the loss side: `up` raises it, `down` lowers it, `none` moves the model rather than the risk. */
export type ChangeDirection = 'up' | 'down' | 'none';

export const SCENARIO_TABS = ['overview', 'targets', 'findings', 'ttp', 'threat', 'financial-impact', 'controls', 'crq'] as const;
export type ScenarioTab = typeof SCENARIO_TABS[number];

export type ChangeLink =
  | { kind: 'scenario-tab', tab: ScenarioTab }
  | { kind: 'technique', externalId: string }
  | { kind: 'control', controlId: string }
  | { kind: 'asset', supportingAssetId: string }
  | { kind: 'cve', cveId: string }
  /** The findings list on one CVE, in the state its row is about. */
  | { kind: 'cve-findings', cveId: string, state: EvidenceState };

export type ChangeItemKind = 'run-figure' | 'actor-class-share' | 'model-setting' | 'technique-family' | 'control' | 'asset' | 'tef-read' | 'tef-input' | 'cve' | 'cve-group' | 'asset-group';

export interface ChangeItem {
  kind: ChangeItemKind,
  /** Names the item within its kind: what the client translates a `null` label from. */
  key: string,
  /** The item's own name when it has one, an entity's; `null` for a figure the client names. */
  label: string | null,
  link: ChangeLink | null,
}

export type ChangeValueFormat = 'frequency' | 'share' | 'currency' | 'count' | 'text';

export interface ChangeValues {
  format: ChangeValueFormat,
  /** `null` when the run had no such value: an unpriced run, a class it did not simulate. */
  before: number | string | null,
  after: number | string | null,
}

/**
 * When the change becomes observable: an input change when it was recorded (ISO, as the client
 * receives it); a state the engine stores on every run, at the run of the compared window from
 * which it held the state the later run has; a figure Monte Carlo moves on every run, as a balance
 * of the two runs compared.
 */
export type ChangeMoment =
  | { kind: 'recorded', at: string }
  | { kind: 'run', runId: string }
  | { kind: 'balance' };

/**
 * The first four group CVEs, the last two assets. `no-longer-reported` is a CVE that left because
 * its connectors stopped reporting it, apart from `left`, which a person's dismissal also produces.
 */
export const CHANGE_GROUP_KINDS = ['appeared', 'left', 'no-longer-reported', 'band-moved', 'first-measured', 'posture-moved'] as const;
export type ChangeGroupKind = typeof CHANGE_GROUP_KINDS[number];

export const RUN_CHANGE_GROUP_PAGE_SIZE = 10;

/** `band` orders by severity, ascending from no band to Critical. */
export const CHANGE_GROUP_SORT_KEYS = ['item', 'band', 'assets', 'time'] as const;
export type ChangeGroupSortKey = typeof CHANGE_GROUP_SORT_KEYS[number];

export interface ChangeGroupSort {
  by: ChangeGroupSortKey,
  desc: boolean,
}

/** Items of one change kind counted rather than listed, too many to read one row each. */
export interface ChangeGroup {
  kind: ChangeGroupKind,
  /** The moments of its first and last item (ISO), the span its paged detail is asked for. */
  from: string,
  to: string,
  up: number,
  down: number,
  /** Its items per band left and band reached, `null` on a side the kind has no band, or for no band. */
  bands: Array<{ from: SeverityBand | null, to: SeverityBand | null, count: number }>,
}

/** One CVE or asset of a group's detail, its bands following the group's own `null` convention. */
export interface ChangeGroupRow {
  item: ChangeItem,
  from: SeverityBand | null,
  to: SeverityBand | null,
  /** A CVE's asset count, `null` for an asset. */
  assets: number | null,
  /** ISO. */
  at: string,
  direction: ChangeDirection,
}

/** Never priced: no event carries a share of the loss move. */
export interface ChangeEvent {
  category: ChangeCategoryKey,
  moment: ChangeMoment,
  direction: ChangeDirection,
  item: ChangeItem,
  /** The sentence the client renders, by key, with the parts it interpolates. */
  sentence: { key: string, parts: Record<string, string | number> },
  values: ChangeValues | null,
  group?: ChangeGroup,
}

export type ComparedRunRow = typeof crqIndicatorRuns.$inferSelect & {
  groupScores: ReadonlyArray<Pick<typeof crqIndicatorGroupScores.$inferSelect, 'actorClass' | 'share'>>,
};

export interface ComparedRun {
  run: ComparedRunRow,
  /** When the run read its inputs, its `created_at` for a run stored without that time. */
  readAt: Date,
}

export type WindowRun = Pick<typeof crqIndicatorRuns.$inferSelect, 'id' | 'createdAt' | 'readAt' | 'uncontestedPairCount' | 'uncontestablePairCount'>;

/**
 * `repo` reads through the tenant's security views: a category needing more than the two runs adds
 * its own read to that repository.
 */
export interface CategoryResolverInput {
  riskScenarioId: string,
  before: ComparedRun,
  after: ComparedRun,
  /** Every run of the scenario from `before` to `after`, both included, oldest first. */
  window: ReadonlyArray<WindowRun>,
  /** Before it, the unique finding journal is trimmed, so a CVE read there may be missing or wrong. */
  uniqueScoreHistoryStart: Date,
  repo: InferRepository<typeof aleChangeExplainRepository>,
}

export interface ChangeCategory {
  key: ChangeCategoryKey,
  tabs: ReadonlyArray<ChangeTab>,
  resolve: (input: CategoryResolverInput) => Promise<ReadonlyArray<ChangeEvent>> | ReadonlyArray<ChangeEvent>,
}

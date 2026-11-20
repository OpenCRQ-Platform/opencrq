import {
  AttackOutcome_DataBreachResale,
  AttackOutcome_DataTheftExtortion,
  AttackOutcome_DestructiveAttack,
  AttackOutcome_Espionage,
  AttackOutcome_FinancialFraudFundsTheft,
  AttackOutcome_Ransomware,
  AttackOutcome_ServiceDisruption,
  deriveSeedId,
} from '@app/module/client';
import type { ScenarioReadiness } from '@app/module/client';
import type { OnboardingStepKey } from './onboarding-steps';

export const SCENARIO_OUTCOME_KEYS = ['ransomware', 'data-theft-extortion', 'data-breach-resale', 'financial-fraud', 'espionage', 'service-disruption', 'destructive-attack'] as const;

export type ScenarioOutcomeKey = (typeof SCENARIO_OUTCOME_KEYS)[number];

const CATALOGUE_OUTCOME_IDS: Record<ScenarioOutcomeKey, string> = {
  ransomware: AttackOutcome_Ransomware,
  'data-theft-extortion': AttackOutcome_DataTheftExtortion,
  'data-breach-resale': AttackOutcome_DataBreachResale,
  'financial-fraud': AttackOutcome_FinancialFraudFundsTheft,
  espionage: AttackOutcome_Espionage,
  'service-disruption': AttackOutcome_ServiceDisruption,
  'destructive-attack': AttackOutcome_DestructiveAttack,
};

/** What the first suggestions check: the outcomes most readers want a figure for first. */
const CHECKED_BY_DEFAULT: ReadonlyArray<ScenarioOutcomeKey> = ['ransomware', 'data-theft-extortion', 'financial-fraud', 'service-disruption'];

/**
 * A tenant's outcome row id is derived from the tenant and the catalogue id (`deriveSeedId`), and its
 * name is a label that can be edited: the catalogue id is what identifies an outcome.
 */
export const resolveOutcomeKey = (tenantId: string, outcomeId: string): ScenarioOutcomeKey | null =>
  SCENARIO_OUTCOME_KEYS.find((key) => deriveSeedId(tenantId, CATALOGUE_OUTCOME_IDS[key]) === outcomeId) ?? null;

interface OutcomeInput {
  id: string,
  name: string,
}

interface AssetInput {
  id: string,
  name: string,
  businessValueCategories: ReadonlyArray<{ id: string }>,
}

interface ExistingScenarioInput {
  attackOutcome: { id: string },
}

export interface ScenarioSuggestion {
  outcomeId: string,
  outcomeKey: ScenarioOutcomeKey | null,
  /** The tenant's own name for the outcome, shown when the catalogue id is unknown. */
  outcomeName: string,
  /** The scope's primary assets the outcome can reach. */
  primaryAssets: ReadonlyArray<{ id: string, name: string }>,
  checkedByDefault: boolean,
}

interface SuggestionInput {
  tenantId: string,
  outcomes: ReadonlyArray<OutcomeInput>,
  /** The scope's primary assets. */
  assets: ReadonlyArray<AssetInput>,
  /** Per outcome id, the business value categories the outcome can reach. */
  compatibleCategoryIds: Readonly<Record<string, ReadonlyArray<string>>>,
  /** The scope's scenarios: an outcome one of them already has is not suggested, whatever its primary assets. */
  existing: ReadonlyArray<ExistingScenarioInput>,
}

const outcomeOrder = (key: ScenarioOutcomeKey | null): number => (key === null ? SCENARIO_OUTCOME_KEYS.length : SCENARIO_OUTCOME_KEYS.indexOf(key));

/** One card per outcome the scope has no scenario of yet and that reaches at least one of its primary assets, holding all of them. */
export const buildScenarioSuggestions = ({ tenantId, outcomes, assets, compatibleCategoryIds, existing }: SuggestionInput): Array<ScenarioSuggestion> => {
  const covered = new Set(existing.map((scenario) => scenario.attackOutcome.id));

  return outcomes
    .map((outcome) => {
      const key = resolveOutcomeKey(tenantId, outcome.id);
      const compatible = new Set(compatibleCategoryIds[outcome.id] ?? []);
      const reached = assets.filter((asset) => asset.businessValueCategories.some((category) => compatible.has(category.id)));
      return { outcome, key, reached };
    })
    .filter(({ outcome, reached }) => reached.length > 0 && !covered.has(outcome.id))
    .map(({ outcome, key, reached }): ScenarioSuggestion => ({
      outcomeId: outcome.id,
      outcomeKey: key,
      outcomeName: outcome.name,
      primaryAssets: reached.map((asset) => ({ id: asset.id, name: asset.name })),
      checkedByDefault: key !== null && CHECKED_BY_DEFAULT.includes(key),
    }))
    .sort((a, b) => outcomeOrder(a.outcomeKey) - outcomeOrder(b.outcomeKey));
};

/** The reader's toggles override the default; a card never touched keeps it. */
export const isSuggestionChecked = (suggestion: ScenarioSuggestion, overrides: Readonly<Record<string, boolean>>): boolean =>
  overrides[suggestion.outcomeId] ?? suggestion.checkedByDefault;

/**
 * The step a scenario's readiness sends the reader back to, or null when nothing in the wizard fixes it.
 * A missing threat event frequency waits on the scope's threats, a missing financial impact on its financial profile.
 */
export const readinessStepKey = ({ status, missing }: Pick<ScenarioReadiness, 'status' | 'missing'>): OnboardingStepKey | null => {
  if (status === 'no-mapped-asset') {
    return 'assets';
  }
  if (status !== 'incomplete') {
    return null;
  }
  const next = missing[0];
  return next === 'tef' ? 'threats' : next === 'loss-drivers' ? 'finances' : null;
};

/** Counts the scenarios a run priced, the rule the Scenarios step's status follows: a run with no loss figure quantifies nothing. */
export const countComputedScenarios = (scenarios: ReadonlyArray<{ latestRun: { aleMean: number | null } | null }>): number =>
  scenarios.filter((scenario) => scenario.latestRun !== null && scenario.latestRun.aleMean !== null).length;

/** What a scenario's card says in place of its figure: the figure itself needs a run that priced something. */
export const hasScenarioFigure = (scenario: { noMappedAsset: boolean, latestRun: { aleMean: number | null } | null }): boolean =>
  !scenario.noMappedAsset && scenario.latestRun !== null && scenario.latestRun.aleMean !== null;

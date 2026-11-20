import { plural, t } from '@lingui/core/macro';
import type { ScenarioOutcomeKey, ScenarioSuggestion } from './scenarios-utils';

/** The outcome's name in the reader's language; the tenant's own name stands for an outcome the catalogue does not know. */
const outcomeLabel = (key: ScenarioOutcomeKey | null, fallback: string): string => {
  switch (key) {
    case 'ransomware': return t`Ransomware`;
    case 'data-theft-extortion': return t`Data theft extortion`;
    case 'data-breach-resale': return t`Data breach and resale`;
    case 'financial-fraud': return t`Financial fraud and funds theft`;
    case 'espionage': return t`Espionage`;
    case 'service-disruption': return t`Service disruption`;
    case 'destructive-attack': return t`Destructive attack`;
    case null: return fallback;
  }
};

export const suggestionOutcomeLabel = (suggestion: ScenarioSuggestion): string => outcomeLabel(suggestion.outcomeKey, suggestion.outcomeName);

export const suggestionTargetLabel = (suggestion: ScenarioSuggestion): string => suggestion.primaryAssets.map((asset) => asset.name).join(', ');

/** "<outcome> · <primary assets>". */
export const suggestionName = (suggestion: ScenarioSuggestion): string => {
  const outcome = suggestionOutcomeLabel(suggestion);
  const target = suggestionTargetLabel(suggestion);
  return t`${outcome} · ${target}`;
};

export const computedScenariosLabel = (count: number): string => plural(count, { one: '# risk scenario computed', other: '# risk scenarios computed' });

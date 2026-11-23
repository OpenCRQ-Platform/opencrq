import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { AssetCategory, AssetSubcategory, DependencyRuleNamePatternKind, IntegrationSource } from '@app/module/client';
import type { inferRouterOutputs } from '@trpc/server';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;
export type DependencyRule = RouterOutputs['assetDependencies']['listDependencyRules'][number];

/** The conditions a rule matches supporting assets on, as the editor holds them. */
export interface DependencyRuleConditionsDraft {
  categoryId: AssetCategory | null,
  subcategoryId: AssetSubcategory | null,
  namePattern: string,
  namePatternKind: DependencyRuleNamePatternKind,
  tagId: string | null,
  source: IntegrationSource | null,
}

/** The conditions as the API takes them: an empty pattern is no pattern, and then has no kind. */
export const toConditionsInput = (draft: DependencyRuleConditionsDraft) => {
  const namePattern = draft.namePattern.trim();
  return {
    categoryId: draft.categoryId,
    subcategoryId: draft.subcategoryId,
    namePattern: namePattern === '' ? null : namePattern,
    namePatternKind: namePattern === '' ? null : draft.namePatternKind,
    tagId: draft.tagId,
    source: draft.source,
  };
};

/** A rule matching every asset would link the whole estate: the API refuses it, the editor says so first. */
export const hasAnyCondition = (draft: DependencyRuleConditionsDraft): boolean => {
  const input = toConditionsInput(draft);
  return [input.categoryId, input.subcategoryId, input.namePattern, input.tagId, input.source].some((value) => value !== null);
};

/**
 * Whether a regular expression the database will evaluate is readable at all. PostgreSQL's POSIX
 * syntax is close enough to JavaScript's for the editor to catch an unbalanced bracket or group
 * before the preview call; the server still has the last word.
 */
export const isReadableRegex = (pattern: string): boolean => {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
};

/** The editor's draft of an existing rule, or the empty draft of a new one. */
export const conditionsDraftOf = (rule: DependencyRule | null): DependencyRuleConditionsDraft => ({
  categoryId: rule?.categoryId ?? null,
  subcategoryId: rule?.subcategoryId ?? null,
  namePattern: rule?.namePattern ?? '',
  namePatternKind: rule?.namePatternKind ?? 'glob',
  tagId: rule?.tagId ?? null,
  source: rule?.source ?? null,
});

export interface DependencyRuleConditionLabels {
  category: (category: AssetCategory) => string,
  subcategory: (subcategory: AssetSubcategory) => string,
  source: (source: IntegrationSource) => string,
  glob: (pattern: string) => string,
  regex: (pattern: string) => string,
  tag: (name: string) => string,
}

/** One short line per condition a rule carries, in the order the editor shows them. */
export const conditionSummaries = (rule: DependencyRule, labels: DependencyRuleConditionLabels): Array<string> => [
  ...(rule.categoryId === null ? [] : [labels.category(rule.categoryId)]),
  ...(rule.subcategoryId === null ? [] : [labels.subcategory(rule.subcategoryId)]),
  ...(rule.namePattern === null ? [] : [rule.namePatternKind === 'regex' ? labels.regex(rule.namePattern) : labels.glob(rule.namePattern)]),
  ...(rule.tagId === null ? [] : [labels.tag(rule.tagName ?? rule.tagId)]),
  ...(rule.source === null ? [] : [labels.source(rule.source)]),
];

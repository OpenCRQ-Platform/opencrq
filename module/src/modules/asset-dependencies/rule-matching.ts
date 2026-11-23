import type { IntegrationSource } from '../integration-settings/constants';
import type { AssetCategory, AssetSubcategory } from '../supporting-assets/constants';

/**
 * How a dependency rule's name pattern reads: a glob (`*` any run of characters, `?` one) or a
 * POSIX regular expression as PostgreSQL evaluates it. Both match case-insensitively and the glob is
 * anchored, so `*.example.io` matches a whole hostname and never part of one.
 */
export const DEPENDENCY_RULE_NAME_PATTERN_KINDS = ['glob', 'regex'] as const;
export type DependencyRuleNamePatternKind = (typeof DEPENDENCY_RULE_NAME_PATTERN_KINDS)[number];

/** Where a rule link comes from, as the API reports it beside each support-to-primary link. */
export const SUPPORT_TO_PRIMARY_LINK_SOURCES = ['manual', 'rule'] as const;
export type SupportToPrimaryLinkSource = (typeof SUPPORT_TO_PRIMARY_LINK_SOURCES)[number];

export const DEPENDENCY_RULE_NAME_MAX_LENGTH = 200;
export const DEPENDENCY_RULE_PATTERN_MAX_LENGTH = 500;
/** How many assets a preview lists; its count covers every match. */
export const DEPENDENCY_RULE_PREVIEW_LIMIT = 50;

const REGEX_SPECIALS = new Set(['\\', '.', '+', '^', '$', '(', ')', '[', ']', '{', '}', '|']);

/** The anchored POSIX expression a glob stands for. */
export const globToRegex = (glob: string): string => {
  let out = '^';
  for (const char of glob) {
    if (char === '*') {
      out += '.*';
    } else if (char === '?') {
      out += '.';
    } else {
      out += REGEX_SPECIALS.has(char) ? `\\${char}` : char;
    }
  }
  return `${out}$`;
};

/** The expression the database matches a pattern with, or null for a rule without one. */
export const namePatternRegex = (pattern: string | null, kind: DependencyRuleNamePatternKind | null): string | null => {
  if (pattern === null || kind === null) {
    return null;
  }
  return kind === 'glob' ? globToRegex(pattern) : pattern;
};

export interface DependencyRuleConditions {
  categoryId: AssetCategory | null,
  subcategoryId: AssetSubcategory | null,
  namePattern: string | null,
  namePatternKind: DependencyRuleNamePatternKind | null,
  tagId: string | null,
  source: IntegrationSource | null,
}

/** A rule matching every asset would link the whole estate: at least one condition is set. */
export const hasCondition = (conditions: DependencyRuleConditions): boolean =>
  [conditions.categoryId, conditions.subcategoryId, conditions.namePattern, conditions.tagId, conditions.source]
    .some((value) => value !== null);

export interface RuleLinkCandidate {
  ruleId: string,
  ruleName: string,
  supportingAssetId: string,
  primaryAssetId: string,
  roles: ReadonlyArray<string>,
}

/**
 * The rule links the estate should hold: one per pair, from the first rule by name when several
 * match it, none on a pair a person linked or unlinked.
 */
export const wantedRuleLinks = <Candidate extends RuleLinkCandidate>(
  candidates: ReadonlyArray<Candidate>,
  manualPairs: ReadonlySet<string>,
  suppressedPairs: ReadonlySet<string>,
): Array<Candidate> => {
  const byPair = new Map<string, Candidate>();
  for (const candidate of candidates.toSorted((a, b) => (a.ruleName < b.ruleName ? -1 : a.ruleName > b.ruleName ? 1 : 0))) {
    const pair = pairKey(candidate.supportingAssetId, candidate.primaryAssetId);
    if (!byPair.has(pair) && !manualPairs.has(pair) && !suppressedPairs.has(pair)) {
      byPair.set(pair, candidate);
    }
  }
  return [...byPair.values()];
};

export const pairKey = (supportingAssetId: string, primaryAssetId: string) => `${supportingAssetId}:${primaryAssetId}`;

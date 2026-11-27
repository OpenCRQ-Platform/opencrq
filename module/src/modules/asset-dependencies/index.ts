export * from './schema';
export { DEPENDENCY_CANDIDATE_RELATIONS, DEPENDENCY_GRAPH_DEFAULT_DEPTH, DEPENDENCY_GRAPH_FOLDS, DEPENDENCY_GRAPH_MAX_ASSETS, DEPENDENCY_GRAPH_MAX_DEPTH, DEPENDENCY_GRAPH_PROVIDERS_PER_ASSET, DEPENDENCY_LINK_KINDS, MAX_DEPENDENCY_LINKS_PER_WRITE } from './constants';
export type {
  DependencyCandidateRelation,
  DependencyGraph,
  DependencyGraphAsset,
  DependencyGraphAssetFindings,
  DependencyGraphFold,
  DependencyGraphLink,
  DependencyGraphNodeAsset,
  DependencyGraphTruncation,
  DependencyLinkKind,
} from './constants';
export {
  CRITERION_INHERITANCES,
  LINK_ROLE_INHERITANCE,
  SECURITY_CRITERIA,
  SUPPORT_TO_PRIMARY_LINK_ROLES,
  UNKNOWN_LINK_ROLE,
  canonicalLinkRoles,
  combineInheritedCriteria,
  inheritedCriteriaOfRoles,
  isStorableLinkRoleSet,
} from './link-roles';
export type { CriterionInheritance, InheritedCriteria, SecurityCriterion, SupportToPrimaryLinkRole } from './link-roles';
export { PRIMARY_TO_PRIMARY_LINK_STRENGTHS, UNKNOWN_LINK_STRENGTH } from './link-strengths';
export type { PrimaryToPrimaryLinkStrength } from './link-strengths';
export { assetDependenciesRepository } from './repository';
export {
  DEPENDENCY_RULE_NAME_MAX_LENGTH,
  DEPENDENCY_RULE_NAME_PATTERN_KINDS,
  DEPENDENCY_RULE_PATTERN_MAX_LENGTH,
  DEPENDENCY_RULE_PREVIEW_LIMIT,
  SUPPORT_TO_PRIMARY_LINK_SOURCES,
  globToRegex,
} from './rule-matching';
export type { DependencyRuleConditions, DependencyRuleNamePatternKind, SupportToPrimaryLinkSource } from './rule-matching';
export { DEFAULT_DEPENDENCY_RESOURCE_TYPES, DEPENDENCY_RESOURCE_TYPE_NAME_MAX_LENGTH, defaultDependencyResourceTypeNames } from './dependency-resource-types';
export {
  assetDependenciesService,
  DependencyResourceTypeNameTakenError,
  DependencyResourceTypeNotFoundError,
  DependencyRuleNotFoundError,
  DependencyRuleRefusedError,
  PrimaryAssetNotFoundError,
  PrimaryToPrimaryLinkRefusedError,
} from './service';
export type { DependencyRuleInput } from './service';

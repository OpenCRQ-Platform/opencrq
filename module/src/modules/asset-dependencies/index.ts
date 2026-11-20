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
export { assetDependenciesService, PrimaryAssetNotFoundError, PrimaryToPrimaryLinkRefusedError } from './service';

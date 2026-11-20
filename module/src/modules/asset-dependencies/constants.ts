import type { AssetCategory, AssetCriticality, AssetRelationKind, AssetRelationSource, SupportingAssetExposure } from '../supporting-assets/schema';
import type { SupportToPrimaryLinkRole } from './link-roles';

/**
 * Deeper than this and the walk costs more queries than a screen can justify; the payload states
 * what it cut rather than growing. Shared by the procedure's input and the depth control.
 */
export const DEPENDENCY_GRAPH_MAX_DEPTH = 6;
export const DEPENDENCY_GRAPH_DEFAULT_DEPTH = 3;

/**
 * How many providers of one asset the walk draws, and how many assets in all. A primary asset can
 * hold tens of thousands of supporting assets, which no canvas draws and no payload should carry, so
 * the rest fold into the asset's aggregate node as the depth folds what lies beyond it.
 */
export const DEPENDENCY_GRAPH_PROVIDERS_PER_ASSET = 50;
export const DEPENDENCY_GRAPH_MAX_ASSETS = 400;

/** Why an asset's aggregate node stands for providers: past the depth, or past what one asset draws. */
export const DEPENDENCY_GRAPH_FOLDS = ['depth', 'width'] as const;
export type DependencyGraphFold = (typeof DEPENDENCY_GRAPH_FOLDS)[number];

/**
 * The manual dependency link, which is the only kind that exists. It is carried on every link so
 * the typed relations scheduled to join it cost the graph a colour and a legend entry, not a
 * change of shape.
 */
export const DEPENDENCY_LINK_KINDS = ['depends_on'] as const;
export type DependencyLinkKind = (typeof DEPENDENCY_LINK_KINDS)[number];

/**
 * The link set a supporting-asset candidate list puts first, seen from the asset being edited:
 * `dependsOn` lists its providers, `providesTo` its dependents, and `supportsPrimary` the supporting
 * assets of a primary asset.
 */
export const DEPENDENCY_CANDIDATE_RELATIONS = ['dependsOn', 'providesTo', 'supportsPrimary'] as const;
export type DependencyCandidateRelation = (typeof DEPENDENCY_CANDIDATE_RELATIONS)[number];

/**
 * How many links one create, update or delete call takes. A batch is one transaction, and a create
 * proves each of its rows against the write policy inside it, so the bound keeps that transaction short.
 */
export const MAX_DEPENDENCY_LINKS_PER_WRITE = 500;

/**
 * The supporting-to-primary links a create or update call left as they were: the pair was already
 * linked, or the link to update is gone or out of reach. Both can be another writer's change made
 * after the caller read the links, so they do not refuse the rest of the call.
 */
export interface DependencyWriteOutcome {
  skippedIds: Array<string>,
}

/**
 * The links a create call left out because one of their assets is deleted or out of reach. The
 * caller may have read it before another writer deleted it, so it does not refuse the rest of the call.
 */
export interface DependencyCreateOutcome {
  goneIds: Array<string>,
}

export interface DependencyGraphAsset {
  id: string,
  name: string | null,
  derivedName: string | null,
  categoryId: AssetCategory,
  criticality: AssetCriticality,
  exposure: SupportingAssetExposure,
  ownerName: string | null,
  firstSeenAt: Date | null,
  lastSeenAt: Date | null,
}

export interface DependencyGraphAssetFindings {
  /** `null` when the asset has no posture row, which is no data, never a safe asset. */
  postureScore: number | null,
  criticalFindingCount: number,
  highFindingCount: number,
}

export type DependencyGraphNodeAsset = DependencyGraphAsset & DependencyGraphAssetFindings;

export interface DependencyGraphLink {
  id: string,
  /** The asset that depends, which is the primary asset itself on a first-level link. */
  dependentId: string,
  providerId: string,
  kind: DependencyLinkKind,
  /** `null` on a link between two supporting assets, which carries no role. */
  roles: Array<SupportToPrimaryLinkRole> | null,
}

/**
 * How many providers of an asset, a primary one included, the walk left undrawn; absent from the
 * list when none were.
 */
export interface DependencyGraphTruncation {
  assetId: string,
  hiddenProviderCount: number,
  foldedBy: DependencyGraphFold,
}

export interface DependencyGraph {
  assets: Array<DependencyGraphNodeAsset>,
  links: Array<DependencyGraphLink>,
  truncated: Array<DependencyGraphTruncation>,
  /**
   * The distinct supporting assets the chain reaches and the graph does not draw, at any distance.
   * Not the sum of `hiddenProviderCount`, which counts direct providers only and counts a shared one
   * per parent.
   */
  hiddenAssetCount: number,
}

export interface AccessRelationGraphAsset extends DependencyGraphNodeAsset {
  /** Set only when it is the band the asset has: a band set by hand, or a reading of its own at that band, takes it. */
  criticalityLift: { criticality: AssetCriticality, fromAssetId: string } | null,
}

/**
 * One drawn relation, in the dependency graph's link shape so one model draws both. The arrow points
 * at `dependentId`, the relation's first end, which is the identity of a `primary_user_of`. The rows
 * several connectors hold for one pair are one link, carrying every source and the widest window.
 */
export interface AccessRelationGraphLink {
  id: string,
  dependentId: string,
  providerId: string,
  kind: AssetRelationKind,
  roles: null,
  sources: Array<AssetRelationSource>,
  firstSeenAt: Date,
  lastReportedAt: Date,
}

export interface AccessRelationGraph {
  assets: Array<AccessRelationGraphAsset>,
  links: Array<AccessRelationGraphLink>,
  /** How many related assets of each asset on the last level the depth left undrawn. */
  truncated: Array<DependencyGraphTruncation>,
  hiddenAssetCount: number,
}

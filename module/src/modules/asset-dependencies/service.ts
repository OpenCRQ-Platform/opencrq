import { newError, StructuredError } from '@app/utils';
import type {
  AccessRelationGraph,
  AccessRelationGraphAsset,
  AccessRelationGraphLink,
  DependencyCreateOutcome,
  DependencyGraph,
  DependencyGraphAsset,
  DependencyGraphLink,
  DependencyGraphTruncation,
  DependencyWriteOutcome,
} from './constants';
import type { InferRepository } from '../../registry';
import type { AssetCriticality } from '../supporting-assets/constants';
import type { AttackPathHopRow } from './attack-path-reach';
import type { SupportToPrimaryLinkRole } from './link-roles';
import type { PrimaryToPrimaryLinkStrength } from './link-strengths';
import type { ReachRow } from './reach';
import { defineService } from '../../registry';
import { requireTenantId } from '../../security';
import { ASSET_CRITICALITY_SEVERITY, ATTACK_PATH_STALE_AFTER_DAYS } from '../supporting-assets/constants';
import { primaryAssetsService } from '../primary-assets/service';
import { liftGivesBand } from '../supporting-assets/criticality-lift';
import { supportingAssetsService } from '../supporting-assets/service';
import { attackPathFreshSince, attackPathHops, primaryAssetsBehind, walkAttackPath } from './attack-path-reach';
import { DEPENDENCY_GRAPH_MAX_ASSETS, DEPENDENCY_GRAPH_PROVIDERS_PER_ASSET } from './constants';
import { canonicalLinkRoles, isStorableLinkRoleSet, UNKNOWN_LINK_ROLE } from './link-roles';
import { UNKNOWN_LINK_STRENGTH } from './link-strengths';
import { diffReach, walkReach } from './reach';
import { assetDependenciesRepository } from './repository';

type Repo = InferRepository<typeof assetDependenciesRepository>;

// PostgreSQL limit: 65535 params per query. With 5 cols per upserted row, 1000 rows stays safe.
const BATCH_CHUNK_SIZE = 1000;

const NOTHING_SKIPPED: DependencyWriteOutcome = { skippedIds: [] };

const skippedAmong = (links: ReadonlyArray<{ id: string }>, written: ReadonlyArray<string>): DependencyWriteOutcome => {
  const writtenIds = new Set(written);
  return { skippedIds: links.filter((link) => !writtenIds.has(link.id)).map((link) => link.id) };
};

/** The links whose two assets the caller can see, and the ids of the others. */
const splitGone = <Link extends { id: string }>(links: ReadonlyArray<Link>, reachable: (link: Link) => boolean) => ({
  reachable: links.filter(reachable),
  goneIds: links.filter((link) => !reachable(link)).map((link) => link.id),
});

/**
 * Inserted in pair order, two concurrent batches sharing pairs meet them in the same order: the later
 * one waits at the first pair they share, instead of each holding a pair the other waits on.
 */
const inPairOrder = <T>(links: ReadonlyArray<T>, pair: (link: T) => readonly [string, string]): Array<T> =>
  links.toSorted((a, b) => {
    const [aFrom, aTo] = pair(a);
    const [bFrom, bTo] = pair(b);
    return aFrom === bFrom ? (aTo < bTo ? -1 : aTo > bTo ? 1 : 0) : (aFrom < bFrom ? -1 : 1);
  });

/** A primary asset id the caller's tenant cannot see: unknown, deleted, or another tenant's. */
export class PrimaryAssetNotFoundError extends StructuredError {
  override readonly name: string = 'PrimaryAssetNotFoundError';

  constructor() {
    super('Primary asset not found', { data: {} });
  }
}

export class PrimaryToPrimaryLinkRefusedError extends StructuredError {
  override readonly name: string = 'PrimaryToPrimaryLinkRefusedError';

  constructor(reason: string) {
    super(reason, { data: {} });
  }
}

const storableLinkRoles = (roles: ReadonlyArray<SupportToPrimaryLinkRole>): Array<SupportToPrimaryLinkRole> => {
  if (!isStorableLinkRoleSet(roles)) {
    throw newError('A dependency needs at least one role, and Unknown cannot be combined with another role');
  }
  return canonicalLinkRoles(roles);
};

const toGraphAsset = (row: DependencyGraphAsset): DependencyGraphAsset => ({
  id: row.id,
  name: row.name,
  derivedName: row.derivedName,
  categoryId: row.categoryId,
  criticality: row.criticality,
  exposure: row.exposure,
  ownerName: row.ownerName,
  firstSeenAt: row.firstSeenAt,
  lastSeenAt: row.lastSeenAt,
});

interface SupportingAssetDependencyGraph extends DependencyGraph {
  primaryAssets: Array<{ id: string, name: string }>,
}

/** Highest first: which providers a dependent draws when it holds more than the walk draws. */
type ProviderRank = (asset: DependencyGraphAsset) => number;

const byCriticality: ProviderRank = (asset) => ASSET_CRITICALITY_SEVERITY[asset.criticality];

interface LevelLink {
  linkId: string,
  dependentId: string,
  provider: DependencyGraphAsset,
  roles: Array<SupportToPrimaryLinkRole> | null,
}

/**
 * What a walk has drawn so far. Links are keyed by id because a stored cycle through the walk's
 * start is met from both sides of it.
 */
interface GraphDraft {
  assets: Map<string, DependencyGraphAsset>,
  links: Map<string, DependencyGraphLink>,
  primaryAssets: Map<string, string>,
  rank: ProviderRank,
  /**
   * The links to providers each dependent met and did not draw, past what one asset or the whole
   * graph draws, by provider. A later level can still draw one of them, and its link with it.
   */
  folded: Map<string, Map<string, LevelLink>>,
  /** The assets whose providers a level of the walk read, which the other drawn assets are not. */
  expanded: Set<string>,
}

const newDraft = (rank: ProviderRank = byCriticality): GraphDraft => ({
  assets: new Map(), links: new Map(), primaryAssets: new Map(), rank, folded: new Map(), expanded: new Set(),
});

const addSupportLink = (draft: GraphDraft, id: string, dependentId: string, providerId: string): void => {
  draft.links.set(id, { id, dependentId, providerId, kind: 'depends_on', roles: null });
};

const drawLink = (draft: GraphDraft, link: LevelLink): void => {
  draft.links.set(link.linkId, { id: link.linkId, dependentId: link.dependentId, providerId: link.provider.id, kind: 'depends_on', roles: link.roles });
};

/** Only an asset met for the first time is expanded further, which is what ends a walk on a cycle. */
const reachAsset = (draft: GraphDraft, row: DependencyGraphAsset, next: Array<string>): void => {
  if (!draft.assets.has(row.id)) {
    draft.assets.set(row.id, toGraphAsset(row));
    next.push(row.id);
  }
};

const displayNameOf = (asset: DependencyGraphAsset): string => asset.name ?? asset.derivedName ?? '';

/**
 * One level of providers, `frontier` holding its dependents in the order they were drawn. The
 * dependents take their highest ranked provider not drawn yet in turns, each at most
 * `DEPENDENCY_GRAPH_PROVIDERS_PER_ASSET`, until the graph holds `DEPENDENCY_GRAPH_MAX_ASSETS`, so a
 * wide dependent early in the frontier cannot spend the budget of the ones after it; the rest is
 * folded. A link to an asset drawn anyway is always drawn. Returns the assets drawn for the first
 * time, the only ones expanded further, which is what ends a walk on a cycle.
 */
const drawProviders = (draft: GraphDraft, frontier: Array<string>, levelLinks: Array<LevelLink>): Array<string> => {
  frontier.forEach((dependentId) => draft.expanded.add(dependentId));
  const linksOf = Map.groupBy(levelLinks, (link) => link.dependentId);
  const ranked = (a: LevelLink, b: LevelLink) => draft.rank(b.provider) - draft.rank(a.provider)
    || byCriticality(b.provider) - byCriticality(a.provider)
    || displayNameOf(a.provider).localeCompare(displayNameOf(b.provider))
    || a.provider.id.localeCompare(b.provider.id);
  const turns = frontier.map((dependentId) => ({ candidates: (linksOf.get(dependentId) ?? []).toSorted(ranked), cursor: 0, drawn: 0 }));
  const next: Array<string> = [];
  let drewInRound = true;
  while (drewInRound && draft.assets.size < DEPENDENCY_GRAPH_MAX_ASSETS) {
    drewInRound = false;
    for (const turn of turns) {
      if (turn.drawn === DEPENDENCY_GRAPH_PROVIDERS_PER_ASSET || draft.assets.size >= DEPENDENCY_GRAPH_MAX_ASSETS) {
        continue;
      }
      while (turn.cursor < turn.candidates.length && draft.assets.has(turn.candidates[turn.cursor].provider.id)) {
        turn.cursor += 1;
      }
      const link = turn.candidates[turn.cursor];
      if (link !== undefined) {
        draft.assets.set(link.provider.id, toGraphAsset(link.provider));
        next.push(link.provider.id);
        turn.cursor += 1;
        turn.drawn += 1;
        drewInRound = true;
      }
    }
  }
  for (const link of levelLinks) {
    if (draft.assets.has(link.provider.id)) {
      drawLink(draft, link);
    } else {
      draft.folded.set(link.dependentId, (draft.folded.get(link.dependentId) ?? new Map()).set(link.provider.id, link));
    }
  }
  return next;
};

/** Returns the last level expanded, whose own providers the depth left out. */
const walkProviders = async (repo: Repo, draft: GraphDraft, start: Array<string>, levels: number): Promise<Array<string>> => {
  let frontier = start;
  for (let level = 0; level < levels && frontier.length > 0; level += 1) {
    const rows = await repo.findSupportToSupportLinksAsDependentBatch(frontier);
    frontier = drawProviders(draft, frontier, rows.map((row) => ({ linkId: row.linkId, dependentId: row.dependentAssetId, provider: row, roles: null })));
  }
  return frontier;
};

/** A primary asset ends a branch: nothing depends on it. */
const walkDependents = async (repo: Repo, draft: GraphDraft, start: Array<string>, levels: number): Promise<Array<string>> => {
  let frontier = start;
  for (let level = 0; level < levels && frontier.length > 0; level += 1) {
    const [primaryRows, supportRows] = await Promise.all([
      repo.findSupportToPrimaryLinksOfSupportingAssetsBatch(frontier),
      repo.findSupportToSupportLinksAsProviderBatch(frontier),
    ]);
    for (const row of primaryRows) {
      draft.links.set(row.linkId, {
        id: row.linkId, dependentId: row.primaryAssetId, providerId: row.supportingAssetId, kind: 'depends_on', roles: row.roles,
      });
      draft.primaryAssets.set(row.primaryAssetId, row.primaryAssetName);
    }
    const next: Array<string> = [];
    for (const row of supportRows) {
      addSupportLink(draft, row.linkId, row.id, row.providerAssetId);
      reachAsset(draft, row, next);
    }
    frontier = next;
  }
  return frontier;
};

/**
 * The depth leaves the last levels unexpanded, yet a link from one of them to an asset already drawn
 * adds no node: dropping it would halve a mutual dependency whose pair sits on that level.
 */
const linkLastLevels = async (repo: Repo, draft: GraphDraft, providerFrontier: Array<string>, dependentFrontier: Array<string>): Promise<void> => {
  const [providerRows, primaryRows, dependentRows] = await Promise.all([
    repo.findSupportToSupportLinksAsDependentBatch(providerFrontier),
    repo.findSupportToPrimaryLinksOfSupportingAssetsBatch(dependentFrontier),
    repo.findSupportToSupportLinksAsProviderBatch(dependentFrontier),
  ]);
  for (const row of providerRows) {
    if (draft.assets.has(row.id)) {
      addSupportLink(draft, row.linkId, row.dependentAssetId, row.id);
    }
  }
  for (const row of primaryRows) {
    if (draft.primaryAssets.has(row.primaryAssetId)) {
      draft.links.set(row.linkId, {
        id: row.linkId, dependentId: row.primaryAssetId, providerId: row.supportingAssetId, kind: 'depends_on', roles: row.roles,
      });
    }
  }
  for (const row of dependentRows) {
    if (draft.assets.has(row.id)) {
      addSupportLink(draft, row.linkId, row.id, row.providerAssetId);
    }
  }
};

/**
 * The assets the depth left unexpanded towards their providers carry how many went undrawn, as do
 * the ones that met more providers than they draw, and the walk then goes on past what it drew on ids
 * alone, on both sides, to count the distinct supporting assets the chain still reaches. That costs
 * one light query per further level, the visited set ending it on a cycle. An asset the walk already
 * returned is counted in neither, since both stand for what the reader cannot see.
 */
const finishDraft = async (
  repo: Repo,
  draft: GraphDraft,
  providerFrontier: Array<string>,
  dependentFrontier: Array<string>,
): Promise<DependencyGraph> => {
  await linkLastLevels(repo, draft, providerFrontier, dependentFrontier);
  const drawnLate = new Set<string>();
  const widthFolds = [...draft.folded]
    .map(([assetId, links]) => {
      const undrawn: Array<string> = [];
      for (const link of links.values()) {
        if (draft.assets.has(link.provider.id)) {
          drawLink(draft, link);
          drawnLate.add(link.provider.id);
        } else {
          undrawn.push(link.provider.id);
        }
      }
      return { assetId, undrawn };
    })
    .filter((fold) => fold.undrawn.length > 0);
  const folded = [...new Set(widthFolds.flatMap((fold) => fold.undrawn))];
  // A provider folded on one side and drawn from the other, as a dependent, had its own providers read
  // by no level, and so had any provider of it the dependents' walk drew too: the chain is followed
  // through the drawn assets no level expanded, down to the providers none drew.
  const atDepth = new Set(providerFrontier);
  const isUnexpanded = (id: string) => draft.assets.has(id) && !draft.expanded.has(id) && !atDepth.has(id);
  const unexpandedChain = new Set<string>();
  let chainLevel = [...drawnLate].filter(isUnexpanded);
  while (chainLevel.length > 0) {
    chainLevel.forEach((id) => unexpandedChain.add(id));
    const providerIds = (await repo.findProviderIdsOf(chainLevel)).map((row) => row.providerAssetId);
    chainLevel = [...new Set(providerIds)].filter((id) => isUnexpanded(id) && !unexpandedChain.has(id));
  }
  const unexpanded = [...unexpandedChain];

  const drawn = [...draft.assets.keys()];
  const [hidden, hiddenOfUnexpanded, postures, findingCounts] = await Promise.all([
    repo.countProvidersOf(providerFrontier, drawn),
    repo.countProvidersOf(unexpanded, drawn),
    repo.findPosturesOf(drawn),
    repo.countCriticalAndHighFindingsOf(drawn),
  ]);

  const reached = new Set([...drawn, ...folded]);
  let hiddenAssetCount = folded.length;
  const countBeyond = async (start: Array<string>, step: (ids: Array<string>) => Promise<Array<string>>): Promise<void> => {
    let beyond = start;
    while (beyond.length > 0) {
      const next: Array<string> = [];
      for (const id of await step(beyond)) {
        if (!reached.has(id)) {
          reached.add(id);
          hiddenAssetCount += 1;
          next.push(id);
        }
      }
      beyond = next;
    }
  };
  const providersOf = async (ids: Array<string>) => (await repo.findProviderIdsOf(ids)).map((row) => row.providerAssetId);
  await countBeyond(folded, providersOf);
  await countBeyond(hidden.length === 0 ? [] : providerFrontier, providersOf);
  await countBeyond(hiddenOfUnexpanded.length === 0 ? [] : unexpanded, providersOf);
  await countBeyond(dependentFrontier, async (ids) => (await repo.findDependentIdsOf(ids)).map((row) => row.dependentAssetId));

  const postureOf = new Map(postures.map((row) => [row.supportingAssetId, row.score]));
  const countsOf = new Map(findingCounts.map((row) => [row.supportingAssetId, row]));

  return {
    assets: [...draft.assets.values()].map((asset) => ({
      ...asset,
      postureScore: postureOf.get(asset.id) ?? null,
      criticalFindingCount: countsOf.get(asset.id)?.critical ?? 0,
      highFindingCount: countsOf.get(asset.id)?.high ?? 0,
    })),
    links: [...draft.links.values()],
    truncated: [
      ...hidden.map((row): DependencyGraphTruncation => ({ assetId: row.dependentAssetId, hiddenProviderCount: row.providerCount, foldedBy: 'depth' })),
      ...widthFolds.map((fold): DependencyGraphTruncation => ({ assetId: fold.assetId, hiddenProviderCount: fold.undrawn.length, foldedBy: 'width' })),
      ...hiddenOfUnexpanded.map((row): DependencyGraphTruncation => ({ assetId: row.dependentAssetId, hiddenProviderCount: row.providerCount, foldedBy: 'width' })),
    ],
    hiddenAssetCount,
  };
};

/**
 * The chain of supporting assets below a set of primary assets, one query per level. Only the first
 * level is per primary asset: the walk then runs once from all of them, so an asset several of them
 * reach is one asset at its shortest distance from any. The visited set is what makes it terminate:
 * only the pair is unique on `support_to_support_links` and only self-dependency is refused, so A
 * depends on B and B depends on A is storable today.
 */
const walkDependencyGraph = async (repo: Repo, primaryAssetIds: Array<string>, depth: number, rank?: ProviderRank): Promise<DependencyGraph> => {
  const draft = newDraft(rank);
  const rows = await repo.findSupportToPrimaryLinksForGraph(primaryAssetIds);
  const firstLevel = drawProviders(draft, primaryAssetIds, rows.map((row) => ({ linkId: row.linkId, dependentId: row.dependentAssetId, provider: row, roles: row.roles })));
  const providerFrontier = await walkProviders(repo, draft, firstLevel, depth - 1);
  return finishDraft(repo, draft, providerFrontier, []);
};

/**
 * Both sides of a supporting asset, each bounded by the depth: what it supports, up to the primary
 * assets, and what supports it. An asset a cycle puts on both sides is drawn once, on the side the
 * providers' walk met it, which runs first.
 */
const walkAroundSupportingAsset = async (
  repo: Repo,
  asset: DependencyGraphAsset,
  depth: number,
): Promise<SupportingAssetDependencyGraph> => {
  const draft = newDraft();
  draft.assets.set(asset.id, toGraphAsset(asset));
  const providerFrontier = await walkProviders(repo, draft, [asset.id], depth);
  const dependentFrontier = await walkDependents(repo, draft, [asset.id], depth);
  const graph = await finishDraft(repo, draft, providerFrontier, dependentFrontier);
  const primaryAssets = [...draft.primaryAssets].map(([id, name]) => ({ id, name }));
  return { primaryAssets, ...graph };
};

type RelationRow = Awaited<ReturnType<Repo['findRelationsTouchingBatch']>>[number];

/** Keyed by pair and kind rather than row: each connector holds its own row for the pair it relates. */
const relationKey = (row: RelationRow): string => `${row.kind}\u0000${row.fromAssetId}\u0000${row.toAssetId}`;

const drawRelation = (links: Map<string, AccessRelationGraphLink>, row: RelationRow): void => {
  const key = relationKey(row);
  const drawn = links.get(key);
  if (drawn === undefined) {
    links.set(key, {
      id: row.id,
      dependentId: row.fromAssetId,
      providerId: row.toAssetId,
      kind: row.kind,
      roles: null,
      sources: [row.source],
      firstSeenAt: row.firstSeenAt,
      lastReportedAt: row.lastReportedAt,
    });
    return;
  }
  links.set(key, {
    ...drawn,
    // The smaller id, so a refetch returning the rows in another order keeps a selection.
    id: row.id < drawn.id ? row.id : drawn.id,
    sources: drawn.sources.includes(row.source) ? drawn.sources : [...drawn.sources, row.source].sort(),
    firstSeenAt: row.firstSeenAt < drawn.firstSeenAt ? row.firstSeenAt : drawn.firstSeenAt,
    lastReportedAt: row.lastReportedAt > drawn.lastReportedAt ? row.lastReportedAt : drawn.lastReportedAt,
  });
};

/**
 * One level per query, as `walkAroundSupportingAsset`. The last level is not expanded, but its
 * relations to assets already drawn are, and the assets past the depth are counted on ids alone.
 */
const walkRelationsAround = async (repo: Repo, asset: DependencyGraphAsset, depth: number): Promise<AccessRelationGraph> => {
  const assets = new Map<string, DependencyGraphAsset>([[asset.id, toGraphAsset(asset)]]);
  const links = new Map<string, AccessRelationGraphLink>();
  let frontier = [asset.id];
  for (let level = 0; level < depth && frontier.length > 0; level += 1) {
    const next: Array<string> = [];
    for (const row of await repo.findRelationsTouchingBatch(frontier)) {
      drawRelation(links, row);
      if (!assets.has(row.otherAsset.id)) {
        assets.set(row.otherAsset.id, toGraphAsset(row.otherAsset));
        next.push(row.otherAsset.id);
      }
    }
    frontier = next;
  }

  const undrawnOf = new Map<string, Set<string>>();
  for (const row of await repo.findRelationsTouchingBatch(frontier)) {
    if (assets.has(row.otherAsset.id)) {
      drawRelation(links, row);
    } else {
      const ownId = row.fromAssetId === row.otherAsset.id ? row.toAssetId : row.fromAssetId;
      undrawnOf.set(ownId, (undrawnOf.get(ownId) ?? new Set()).add(row.otherAsset.id));
    }
  }
  const reached = new Set(assets.keys());
  let beyond = [...new Set([...undrawnOf.values()].flatMap((ids) => [...ids]))];
  beyond.forEach((id) => reached.add(id));
  let hiddenAssetCount = beyond.length;
  while (beyond.length > 0) {
    const next: Array<string> = [];
    for (const { relatedId } of await repo.findRelatedIdsOf(beyond)) {
      if (!reached.has(relatedId)) {
        reached.add(relatedId);
        hiddenAssetCount += 1;
        next.push(relatedId);
      }
    }
    beyond = next;
  }

  const drawn = [...assets.keys()];
  const [postures, findingCounts, liftReads] = await Promise.all([
    repo.findPosturesOf(drawn),
    repo.countCriticalAndHighFindingsOf(drawn),
    repo.findCriticalityLiftsOf(drawn),
  ]);
  const postureOf = new Map(postures.map((row) => [row.supportingAssetId, row.score]));
  const countsOf = new Map(findingCounts.map((row) => [row.supportingAssetId, row]));
  const setByHand = new Set(liftReads.setByHand.map((row) => row.supportingAssetId));
  const readingsOf = new Map<string, Array<AssetCriticality>>();
  for (const row of liftReads.connectorReadings) {
    readingsOf.set(row.supportingAssetId, [...readingsOf.get(row.supportingAssetId) ?? [], row.criticality]);
  }
  const liftOf = new Map<string, AccessRelationGraphAsset['criticalityLift']>();
  for (const row of liftReads.lifts) {
    const lifted = assets.get(row.supportingAssetId);
    if (row.fromAssetId !== null && lifted !== undefined && liftGivesBand({
      lift: row.criticality,
      bandInEffect: lifted.criticality,
      connectorReadings: readingsOf.get(row.supportingAssetId) ?? [],
      isSetByHand: setByHand.has(row.supportingAssetId),
    })) {
      liftOf.set(row.supportingAssetId, { criticality: row.criticality, fromAssetId: row.fromAssetId });
    }
  }

  return {
    assets: [...assets.values()].map((drawnAsset) => ({
      ...drawnAsset,
      postureScore: postureOf.get(drawnAsset.id) ?? null,
      criticalFindingCount: countsOf.get(drawnAsset.id)?.critical ?? 0,
      highFindingCount: countsOf.get(drawnAsset.id)?.high ?? 0,
      criticalityLift: liftOf.get(drawnAsset.id) ?? null,
    })),
    links: [...links.values()],
    truncated: [...undrawnOf].map(([assetId, ids]): DependencyGraphTruncation => ({ assetId, hiddenProviderCount: ids.size, foldedBy: 'depth' })),
    hiddenAssetCount,
  };
};

export const assetDependenciesService = defineService(
  'assetDependencies',
  assetDependenciesRepository,
).dependsOn(() => [primaryAssetsService, supportingAssetsService]).implement({
  /**
   * A link whose pair is already linked is skipped, the stored one kept with its roles, and a link
   * to an asset deleted or out of reach is reported gone: both may be someone else's change made
   * after the caller read the links. An invalid role set refuses the batch.
   */
  createSupportToPrimaryLinks: async ({ atomic, eventOrigin }, links: ReadonlyArray<{
    id: string,
    supportingAssetId: string,
    primaryAssetId: string,
    roles?: Array<SupportToPrimaryLinkRole>,
  }>): Promise<DependencyWriteOutcome & DependencyCreateOutcome> => {
    const tenantId = requireTenantId(eventOrigin);
    const values = links.map(({ roles = [UNKNOWN_LINK_ROLE], ...link }) => ({ ...link, tenantId, roles: storableLinkRoles(roles) }));
    if (values.length === 0) {
      return { ...NOTHING_SKIPPED, goneIds: [] };
    }
    return atomic(async ({ repo }) => {
      const supporting = await repo.findVisibleSupportingAssetIds(values.map((link) => link.supportingAssetId));
      const primary = await repo.findVisiblePrimaryAssetIds(values.map((link) => link.primaryAssetId));
      const { reachable, goneIds } = splitGone(values, (link) => supporting.has(link.supportingAssetId) && primary.has(link.primaryAssetId));
      if (reachable.length === 0) {
        return { ...NOTHING_SKIPPED, goneIds };
      }
      const ordered = inPairOrder(reachable, (link) => [link.supportingAssetId, link.primaryAssetId]);
      return { ...skippedAmong(reachable, await repo.insertSupportToPrimaryLinks(ordered)), goneIds };
    });
  },
  /**
   * A link gone or out of reach is skipped, since it may have been deleted after the caller read
   * it; an invalid role set refuses the batch. The links given the same role set share one statement.
   */
  updateSupportToPrimaryLinks: async ({ atomic }, links: ReadonlyArray<{ id: string, roles: Array<SupportToPrimaryLinkRole> }>): Promise<DependencyWriteOutcome> => {
    const values = links.map((link) => ({ id: link.id, roles: storableLinkRoles(link.roles) }));
    if (values.length === 0) {
      return NOTHING_SKIPPED;
    }
    const byRoleSet = new Map<string, { roles: Array<SupportToPrimaryLinkRole>, ids: Array<string> }>();
    for (const link of values) {
      const key = link.roles.join(',');
      const group = byRoleSet.get(key) ?? { roles: link.roles, ids: [] };
      group.ids.push(link.id);
      byRoleSet.set(key, group);
    }
    return atomic(async ({ repo }) => {
      const updated: Array<string> = [];
      for (const group of byRoleSet.values()) {
        updated.push(...await repo.updateSupportToPrimaryLinkRoles(group.ids, group.roles));
      }
      return skippedAmong(values, updated);
    });
  },
  deleteSupportToPrimaryLinks: async ({ repo }, ids: Array<string>) =>
    await repo.deleteSupportToPrimaryLinks(ids),
  getSupportToPrimaryLinksBySupportingAssetId: async ({ repo }, supportingAssetId: string) =>
    await repo.findSupportToPrimaryLinksBySupportingAssetId(supportingAssetId),
  getSupportToPrimaryLinksByPrimaryAssetId: async ({ repo }, primaryAssetId: string) =>
    await repo.findSupportToPrimaryLinksByPrimaryAssetId(primaryAssetId),

  getPrimaryAssetDependencyGraph: async ({ repo }, primaryAssetId: string, depth: number): Promise<DependencyGraph> => {
    if (!(await repo.findVisiblePrimaryAssetIds([primaryAssetId])).has(primaryAssetId)) {
      throw new PrimaryAssetNotFoundError();
    }
    return walkDependencyGraph(repo, [primaryAssetId], depth);
  },
  /**
   * Refuses no id: one the caller cannot see is left out by the secured read and contributes nothing.
   * `rankOf` says which providers an asset draws first when it holds more than the walk draws, an
   * asset it does not name ranking last.
   */
  getDependencyGraphBelow: async ({ repo }, primaryAssetIds: Array<string>, depth: number, rankOf?: ReadonlyMap<string, number>): Promise<DependencyGraph> =>
    walkDependencyGraph(repo, primaryAssetIds, depth, rankOf ? (asset) => rankOf.get(asset.id) ?? 0 : undefined),
  getSupportingAssetDependencyGraph: async ({ repo }, supportingAssetId: string, depth: number): Promise<SupportingAssetDependencyGraph> => {
    const [asset] = await repo.findSupportingAssetsForGraph([supportingAssetId]);
    if (asset === undefined) {
      throw newError('Access Denied');
    }
    return walkAroundSupportingAsset(repo, asset, depth);
  },
  getSupportingAssetRelationGraph: async ({ repo }, supportingAssetId: string, depth: number): Promise<AccessRelationGraph> => {
    const [asset] = await repo.findSupportingAssetsForGraph([supportingAssetId]);
    if (asset === undefined) {
      throw newError('Access Denied');
    }
    return walkRelationsAround(repo, asset, depth);
  },

  /**
   * A pair already linked is left as it is and not reported, since a link without roles is then
   * already what was asked. A link to an asset deleted or out of reach is reported gone. A
   * self-dependency refuses the batch.
   */
  createSupportToSupportLinks: async ({ atomic, eventOrigin }, links: ReadonlyArray<{
    id: string,
    providerAssetId: string,
    dependentAssetId: string,
  }>): Promise<DependencyCreateOutcome> => {
    if (links.some((link) => link.providerAssetId === link.dependentAssetId)) {
      throw newError('An asset cannot depend on itself');
    }
    if (links.length === 0) {
      return { goneIds: [] };
    }
    const tenantId = requireTenantId(eventOrigin);
    return atomic(async ({ repo }) => {
      const visible = await repo.findVisibleSupportingAssetIds(links.flatMap((link) => [link.providerAssetId, link.dependentAssetId]));
      const { reachable, goneIds } = splitGone(links, (link) => visible.has(link.providerAssetId) && visible.has(link.dependentAssetId));
      if (reachable.length > 0) {
        await repo.insertSupportToSupportLinks(inPairOrder(reachable, (link) => [link.providerAssetId, link.dependentAssetId]).map((link) => ({ ...link, tenantId })));
      }
      return { goneIds };
    });
  },
  deleteSupportToSupportLinks: async ({ repo }, ids: Array<string>) =>
    await repo.deleteSupportToSupportLinks(ids),

  /**
   * A pair already linked is skipped, the stored strength kept, and a link to an asset deleted or out
   * of reach is reported gone: both may be someone else's change made after the caller read the
   * links. A self-dependency, or two primary assets of different organizations, refuses the batch.
   */
  createPrimaryToPrimaryLinks: async ({ atomic, eventOrigin }, requested: ReadonlyArray<{
    id: string,
    dependentAssetId: string,
    providerAssetId: string,
    strength?: PrimaryToPrimaryLinkStrength,
  }>): Promise<DependencyWriteOutcome & DependencyCreateOutcome> => {
    // Postgres hands ids back in lower case, and the outcome is told apart by comparing them.
    const links = requested.map((link) => ({
      ...link,
      id: link.id.toLowerCase(),
      dependentAssetId: link.dependentAssetId.toLowerCase(),
      providerAssetId: link.providerAssetId.toLowerCase(),
    }));
    if (links.some((link) => link.dependentAssetId === link.providerAssetId)) {
      throw new PrimaryToPrimaryLinkRefusedError('A primary asset cannot depend on itself');
    }
    if (links.length === 0) {
      return { ...NOTHING_SKIPPED, goneIds: [] };
    }
    const tenantId = requireTenantId(eventOrigin);
    return atomic(async ({ repo }) => {
      const organizationOf = await repo.findVisiblePrimaryAssetOrganizations(links.flatMap((link) => [link.dependentAssetId, link.providerAssetId]));
      const { reachable, goneIds } = splitGone(links, (link) => organizationOf.has(link.dependentAssetId) && organizationOf.has(link.providerAssetId));
      const crossing = reachable.find((link) => organizationOf.get(link.dependentAssetId) !== organizationOf.get(link.providerAssetId));
      if (crossing !== undefined) {
        throw new PrimaryToPrimaryLinkRefusedError('A primary asset can only depend on a primary asset of its own organization');
      }
      if (reachable.length === 0) {
        return { ...NOTHING_SKIPPED, goneIds };
      }
      const ordered = inPairOrder(reachable, (link) => [link.dependentAssetId, link.providerAssetId])
        .map(({ strength = UNKNOWN_LINK_STRENGTH, ...link }) => ({ ...link, strength, tenantId }));
      return { ...skippedAmong(reachable, await repo.insertPrimaryToPrimaryLinks(ordered)), goneIds };
    });
  },
  /** A link gone or out of reach is skipped, since it may have been deleted after the caller read it. */
  updatePrimaryToPrimaryLinks: async ({ atomic }, requested: ReadonlyArray<{ id: string, strength: PrimaryToPrimaryLinkStrength }>): Promise<DependencyWriteOutcome> => {
    if (requested.length === 0) {
      return NOTHING_SKIPPED;
    }
    const links = requested.map((link) => ({ ...link, id: link.id.toLowerCase() }));
    const idsByStrength = Map.groupBy(links, (link) => link.strength);
    return atomic(async ({ repo }) => {
      // One statement per strength would lock the links in the order of the strengths, which two batches can cross.
      await repo.lockPrimaryToPrimaryLinks(links.map((link) => link.id));
      const updated: Array<string> = [];
      for (const [strength, group] of idsByStrength) {
        updated.push(...await repo.updatePrimaryToPrimaryLinkStrength(group.map((link) => link.id), strength));
      }
      return skippedAmong(links, updated);
    });
  },
  deletePrimaryToPrimaryLinks: async ({ repo }, ids: Array<string>) =>
    await repo.deletePrimaryToPrimaryLinks(ids),
  /** A `depends` row names an asset this one relies on, a `provides` row an asset relying on it. */
  getPrimaryToPrimaryLinks: async ({ repo }, primaryAssetId: string) => {
    const [dependsOn, dependedOnBy] = await Promise.all([
      repo.findPrimaryToPrimaryLinksOf(primaryAssetId, 'dependent'),
      repo.findPrimaryToPrimaryLinksOf(primaryAssetId, 'provider'),
    ]);
    return [
      ...dependsOn.map((link) => ({ ...link, direction: 'depends' as const })),
      ...dependedOnBy.map((link) => ({ ...link, direction: 'provides' as const })),
    ].sort((a, b) => a.relatedAssetName.localeCompare(b.relatedAssetName));
  },
  /**
   * Brings the stored reach of every primary asset to the one its links give it, writing only the
   * rows that differ so a run with nothing to change writes nothing. One primary asset at a time,
   * so a run holds the widest reach in memory rather than the whole tenant's.
   */
  recomputePrimaryAssetReach: async ({ atomic, eventOrigin }) => {
    if (eventOrigin.type !== 'job') {
      throw newError('Primary asset reach is recomputed by its job alone', { origin: eventOrigin.type });
    }
    const { tenantId } = eventOrigin;
    return await atomic(async ({ repo }) => {
      const primaryAssets = await repo.findPrimaryAssetsForReach();
      const directLinks = Map.groupBy(await repo.findDirectLinksForReach(primaryAssets.map((asset) => asset.id)), (link) => link.primaryAssetId);
      const outcome = { primaryAssets: primaryAssets.length, rows: 0, upserted: 0, deleted: 0 };
      for (const { id, organizationId } of primaryAssets) {
        const direct = (directLinks.get(id) ?? []).map((link) => link.supportingAssetId);
        const reach = await walkReach(direct, (dependentIds) => repo.findProvidersForReach(dependentIds));
        const wanted: Array<ReachRow> = [...reach].map(([supportingAssetId, depth]) => ({ organizationId, primaryAssetId: id, supportingAssetId, depth }));
        const { upserts, stale } = diffReach(await repo.findReachOf(id), wanted);
        await repo.deleteReach(id, stale.map((row) => row.supportingAssetId));
        for (let i = 0; i < upserts.length; i += BATCH_CHUNK_SIZE) {
          await repo.upsertReach(upserts.slice(i, i + BATCH_CHUNK_SIZE).map((row) => ({ ...row, tenantId })));
        }
        outcome.rows += wanted.length;
        outcome.upserted += upserts.length;
        outcome.deleted += stale.length;
      }
      return outcome;
    });
  },

  /**
   * What a finding on `supportingAssetId` can reach along the attack paths OpenAEV showed: the
   * assets reached hop by hop (stale hops left out) and the primary assets behind them, so a weakness
   * on an asset nothing depends on still counts towards the primary assets it opens the way to.
   * Each hop says whether an OpenAEV execution proved it or it is inferred, and which simulation
   * showed it; the assets carry the name, exposure and criticality the caller may read. An asset the
   * caller cannot read stops the walk there and is never named (the origin too: Access Denied).
   */
  getAttackPathReach: async ({ repo }, supportingAssetId: string, now: Date = new Date()) => {
    const [origin] = await repo.findSupportingAssetsForGraph([supportingAssetId]);
    if (origin === undefined) {
      throw newError('Access Denied');
    }
    const freshSince = attackPathFreshSince(now);
    const rows: Array<AttackPathHopRow> = [];
    const visible = new Set<string>([origin.id]);
    const assets = new Map([[origin.id, origin]]);
    const depthOf = await walkAttackPath(supportingAssetId, async (assetIds) => {
      const hops = await repo.findAttackPathHopsFrom(assetIds, freshSince);
      const unseen = [...new Set(hops.map((hop) => hop.fromAssetId))].filter((id) => !assets.has(id));
      for (const asset of await repo.findSupportingAssetsForGraph(unseen)) {
        assets.set(asset.id, asset);
        visible.add(asset.id);
      }
      const kept = hops.filter((hop) => visible.has(hop.fromAssetId));
      rows.push(...kept);
      return kept;
    });
    const hops = attackPathHops(depthOf, rows, visible);
    const reached = [...depthOf].filter(([, depth]) => depth > 0).map(([assetId, depth]) => {
      const asset = assets.get(assetId);
      return {
        assetId,
        depth,
        name: asset?.name ?? null,
        derivedName: asset?.derivedName ?? null,
        exposure: asset?.exposure ?? null,
        criticality: asset?.criticality ?? null,
      };
    });
    const primaryAssets = primaryAssetsBehind(depthOf, await repo.findPrimaryAssetsReaching([...depthOf.keys()]));
    return {
      origin: { assetId: origin.id, name: origin.name, derivedName: origin.derivedName, exposure: origin.exposure, criticality: origin.criticality },
      reachedAssets: reached,
      hops,
      primaryAssets,
      staleAfterDays: ATTACK_PATH_STALE_AFTER_DAYS,
    };
  },

  getSupportToSupportLinks: async ({ repo }, assetId: string) => {
    const [providerLinks, dependentLinks] = await Promise.all([
      repo.findSupportToSupportLinksAsProvider(assetId),
      repo.findSupportToSupportLinksAsDependent(assetId),
    ]);
    const provides = providerLinks.map((link) => ({
      id: link.id,
      direction: 'provides' as const,
      relatedAssetId: link.dependentAssetId,
      relatedAssetName: link.dependentAssetName,
      relatedAssetDerivedName: link.dependentAssetDerivedName,
    }));
    const depends = dependentLinks.map((link) => ({
      id: link.id,
      direction: 'depends' as const,
      relatedAssetId: link.providerAssetId,
      relatedAssetName: link.providerAssetName,
      relatedAssetDerivedName: link.providerAssetDerivedName,
    }));
    return [...provides, ...depends].sort((a, b) =>
      (a.relatedAssetName ?? a.relatedAssetDerivedName ?? '').localeCompare(b.relatedAssetName ?? b.relatedAssetDerivedName ?? ''),
    );
  },
});

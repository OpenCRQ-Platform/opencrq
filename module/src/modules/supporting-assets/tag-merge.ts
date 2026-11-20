import { newError } from '@app/utils';
import type { IntegrationSource } from '../integration-settings/constants';

/** tagId → id of the tag it is merged into. Holds merged tags only; a root has no entry. */
export type TagMergePointers = ReadonlyMap<string, string>;

export const resolveTagRoot = (pointers: TagMergePointers, tagId: string): string => {
  const visited = new Set<string>([tagId]);
  let current = tagId;
  let next = pointers.get(current);
  while (next !== undefined) {
    if (visited.has(next)) {
      throw newError('Tag merge cycle');
    }
    visited.add(next);
    current = next;
    next = pointers.get(current);
  }
  return current;
};

export type TagMergeRefusal = 'sourceAlreadyMerged' | 'targetAlreadyMerged' | 'targetIsSource';

/**
 * Why merging `sourceTagId` into `targetTagId` is refused, or `null` when it is allowed. A merge
 * only moves a root into another root: a chain then only grows by merging a root that already holds
 * merged tags, and the pointers can never form a cycle.
 */
export const checkTagMerge = (
  pointers: TagMergePointers,
  sourceTagId: string,
  targetTagId: string,
): TagMergeRefusal | null => {
  if (pointers.has(sourceTagId)) {
    return 'sourceAlreadyMerged';
  }
  if (pointers.has(targetTagId)) {
    return 'targetAlreadyMerged';
  }
  if (targetTagId === sourceTagId) {
    return 'targetIsSource';
  }
  return null;
};

export interface DisplayedTag { id: string, name: string, color: string | null }

export const displayAssetTags = (
  linked: ReadonlyArray<DisplayedTag>,
  manualTagIds: ReadonlySet<string>,
  pointers: TagMergePointers,
  rootsById: ReadonlyMap<string, DisplayedTag>,
): Array<DisplayedTag & { isManual: boolean }> => {
  const byRoot = new Map<string, DisplayedTag & { isManual: boolean }>();
  for (const tag of linked) {
    const rootId = resolveTagRoot(pointers, tag.id);
    const isManual = manualTagIds.has(tag.id);
    const seen = byRoot.get(rootId);
    if (seen) {
      seen.isManual ||= isManual;
      continue;
    }
    const root = rootsById.get(rootId) ?? (rootId === tag.id ? tag : undefined);
    if (!root) {
      throw newError('Tag root is missing from rootsById', { tagId: tag.id, rootId });
    }
    byRoot.set(rootId, { id: root.id, name: root.name, color: root.color, isManual });
  }
  return [...byRoot.values()];
};

export const subtreeAssetCounts = (input: {
  tagIds: ReadonlyArray<string>,
  pointers: TagMergePointers,
  directCounts: ReadonlyMap<string, number>,
  familyLinks: ReadonlyArray<{ tagId: string, supportingAssetId: string }>,
}): Map<string, number> => {
  const { tagIds, pointers, directCounts, familyLinks } = input;

  const children = new Map<string, Array<string>>();
  for (const [tagId, parentId] of pointers) {
    children.set(parentId, [...(children.get(parentId) ?? []), tagId]);
  }

  const assetsByTag = new Map<string, Set<string>>();
  for (const { tagId, supportingAssetId } of familyLinks) {
    const assets = assetsByTag.get(tagId) ?? new Set<string>();
    assets.add(supportingAssetId);
    assetsByTag.set(tagId, assets);
  }

  const counts = new Map<string, number>();
  for (const tagId of tagIds) {
    if (!children.has(tagId)) {
      counts.set(tagId, directCounts.get(tagId) ?? 0);
      continue;
    }
    const distinctAssets = new Set<string>();
    const pending = [tagId];
    for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
      for (const assetId of assetsByTag.get(id) ?? []) {
        distinctAssets.add(assetId);
      }
      pending.push(...(children.get(id) ?? []));
    }
    counts.set(tagId, distinctAssets.size);
  }
  return counts;
};

export type ManagedTagSource =
  | { kind: 'manual' }
  | { kind: 'xtm_one' }
  | { kind: 'connector', source: IntegrationSource, reportedName: string };

export interface ManagedTag {
  id: string, name: string, color: string | null,
  mergedIntoTagId: string | null, mergedAt: Date | null,
  assetCount: number, sources: Array<ManagedTagSource>,
}

export const assembleManagedTags = (input: {
  vocabulary: ReadonlyArray<{ id: string, name: string, color: string | null, mergedIntoTagId: string | null, mergedAt: Date | null }>,
  origins: ReadonlyArray<{ tagId: string, connectorId: string | null, sourceTagId: string | null, reportedName: string, pushedByXtmOne?: boolean, connectorSource: IntegrationSource | null }>,
  assetCounts: ReadonlyMap<string, number>,
}): Array<ManagedTag> => {
  const sourcesByTag = new Map<string, Array<ManagedTagSource>>();
  for (const origin of input.origins) {
    let source: ManagedTagSource;
    if (origin.sourceTagId === null) {
      source = origin.pushedByXtmOne === true ? { kind: 'xtm_one' } : { kind: 'manual' };
    } else if (origin.connectorSource !== null) {
      source = { kind: 'connector', source: origin.connectorSource, reportedName: origin.reportedName };
    } else {
      continue;
    }
    sourcesByTag.set(origin.tagId, [...(sourcesByTag.get(origin.tagId) ?? []), source]);
  }

  return input.vocabulary
    .map((tag) => ({
      id: tag.id,
      name: tag.name,
      color: tag.color,
      mergedIntoTagId: tag.mergedIntoTagId,
      mergedAt: tag.mergedAt,
      assetCount: input.assetCounts.get(tag.id) ?? 0,
      sources: sourcesByTag.get(tag.id) ?? [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

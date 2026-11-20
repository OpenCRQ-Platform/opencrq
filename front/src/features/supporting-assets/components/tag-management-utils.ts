import { includesFolded } from '@app/utils/text-fold';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { IntegrationSource } from '@app/module/client';
import type { inferRouterOutputs } from '@trpc/server';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;
export type ManagedTag = RouterOutputs['supportingAssets']['listManagedTags'][number];

export interface TagRow extends ManagedTag {
  /** The tags merged directly into this one, oldest merge first. */
  mergedTags: Array<ManagedTag>,
  /** Names a connector reports for this tag that differ from the name it now carries. */
  connectorNames: Array<{ source: IntegrationSource, reportedName: string }>,
}

export const MANUAL_SOURCE = 'manual';

/** A tag an XTM One push gave the asset (#3152, section 2): no connector, but not typed by a person either. */
export const XTM_ONE_SOURCE = 'xtm_one';

export type TagSource = typeof MANUAL_SOURCE | typeof XTM_ONE_SOURCE | IntegrationSource;

const sourceOf = (entry: ManagedTag['sources'][number]): TagSource =>
  (entry.kind === 'connector' ? entry.source : entry.kind);

// `mergedAt` reaches the client as an ISO string: the tRPC link carries no date transformer.
const mergedAtTime = (tag: ManagedTag) => (tag.mergedAt === null ? 0 : Date.parse(tag.mergedAt));

const hasSource = (tag: ManagedTag, source: TagSource) =>
  tag.sources.some((entry) => sourceOf(entry) === source);

/**
 * The search also matches the tags merged into a root, at any depth. `filters.source` is `'all'`,
 * `'manual'` or a connector source, and matches the root's own sources only.
 */
export const buildTagRows = (
  tags: ReadonlyArray<ManagedTag>,
  filters: { search: string, source: 'all' | TagSource },
): Array<TagRow> => {
  const mergedByRoot = new Map<string, Array<ManagedTag>>();
  for (const tag of tags) {
    if (tag.mergedIntoTagId !== null) {
      mergedByRoot.set(tag.mergedIntoTagId, [...(mergedByRoot.get(tag.mergedIntoTagId) ?? []), tag]);
    }
  }

  const familyNames = (tagId: string): Array<string> =>
    (mergedByRoot.get(tagId) ?? []).flatMap((merged) => [merged.name, ...familyNames(merged.id)]);

  const rows: Array<TagRow> = [];
  for (const tag of tags) {
    if (tag.mergedIntoTagId !== null) {
      continue;
    }
    const mergedTags = (mergedByRoot.get(tag.id) ?? []).toSorted((a, b) => mergedAtTime(a) - mergedAtTime(b));
    const matchesSearch = [tag.name, ...familyNames(tag.id)].some((name) => includesFolded(name, filters.search));
    const matchesSource = filters.source === 'all' || hasSource(tag, filters.source);
    if (!matchesSearch || !matchesSource) {
      continue;
    }
    const connectorNames = tag.sources.flatMap((entry) =>
      entry.kind === 'connector' && entry.reportedName !== tag.name
        ? [{ source: entry.source, reportedName: entry.reportedName }]
        : []);
    rows.push({ ...tag, mergedTags, connectorNames });
  }
  return rows;
};

/** `'manual'` first when some tag has a manual source, then XTM One, then each connector source once. */
export const tagSourceOptions = (tags: ReadonlyArray<ManagedTag>): Array<TagSource> => {
  const sources = new Set<TagSource>();
  for (const tag of tags) {
    for (const entry of tag.sources) {
      sources.add(sourceOf(entry));
    }
  }
  const rank = (source: TagSource) => (source === MANUAL_SOURCE ? 0 : source === XTM_ONE_SOURCE ? 1 : 2);
  return [...sources].toSorted((a, b) => rank(a) - rank(b));
};

export type TagNameOwner =
  | { kind: 'unchanged' }
  | { kind: 'free' }
  | { kind: 'ownMergedTag' }
  | { kind: 'mergeInto', owner: ManagedTag, target: ManagedTag };

/**
 * Compares the way `tags_tenant_name_uq` does, case included: the typed name is trimmed, nothing
 * else. A name held by a merged tag leads to that tag's root, which is what a merge would target.
 */
export const findTagNameOwner = (tags: ReadonlyArray<ManagedTag>, tagId: string, rawName: string): TagNameOwner => {
  const name = rawName.trim();
  const byId = new Map(tags.map((tag) => [tag.id, tag]));
  if (byId.get(tagId)?.name === name) {
    return { kind: 'unchanged' };
  }
  const owner = tags.find((tag) => tag.name === name);
  if (owner === undefined) {
    return { kind: 'free' };
  }

  let target = owner;
  const visited = new Set([target.id]);
  while (target.mergedIntoTagId !== null) {
    const next = byId.get(target.mergedIntoTagId);
    if (next === undefined || visited.has(next.id)) {
      break;
    }
    visited.add(next.id);
    target = next;
  }
  return target.id === tagId ? { kind: 'ownMergedTag' } : { kind: 'mergeInto', owner, target };
};

export const mergeTargetOptions = (tags: ReadonlyArray<ManagedTag>, tagId: string): Array<ManagedTag> =>
  tags
    .filter((tag) => tag.mergedIntoTagId === null && tag.id !== tagId)
    .toSorted((a, b) => a.name.localeCompare(b.name));

/** The tag and every tag merged into it at any depth, the tag first; empty for an unknown id. */
export const tagFamily = (tags: ReadonlyArray<ManagedTag>, tagId: string): Array<ManagedTag> => {
  const root = tags.find((tag) => tag.id === tagId);
  if (root === undefined) {
    return [];
  }
  const family = [root];
  const visited = new Set([tagId]);
  for (const member of family) {
    for (const tag of tags) {
      if (tag.mergedIntoTagId === member.id && !visited.has(tag.id)) {
        visited.add(tag.id);
        family.push(tag);
      }
    }
  }
  return family;
};

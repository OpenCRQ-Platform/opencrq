import type { AssetRelationKind } from '@app/module/client';

/** `outgoing` when the asset is the relation's first end, as an identity is the primary user of a device. */
export type AssetRelationDirection = 'outgoing' | 'incoming';

export interface AssetRelationGroup<T> {
  kind: AssetRelationKind,
  direction: AssetRelationDirection,
  relations: Array<T>,
}

/** One group per kind and direction, in the order first met: a device lists its primary user, an identity its devices. */
export const groupAssetRelations = <T extends { kind: AssetRelationKind, direction: AssetRelationDirection }>(
  relations: ReadonlyArray<T>,
): Array<AssetRelationGroup<T>> => {
  const groups = new Map<string, AssetRelationGroup<T>>();
  for (const relation of relations) {
    const key = `${relation.kind}:${relation.direction}`;
    const group = groups.get(key) ?? { kind: relation.kind, direction: relation.direction, relations: [] };
    group.relations.push(relation);
    groups.set(key, group);
  }
  return [...groups.values()];
};

import { describe, expect, it } from 'vitest';
import { groupAssetRelations } from './asset-relations-utils';

describe('groupAssetRelations', () => {
  it('groups by kind and direction, keeping the order the relations came in', () => {
    const groups = groupAssetRelations([
      { id: 'a', kind: 'primary_user_of', direction: 'outgoing' as const },
      { id: 'b', kind: 'primary_user_of', direction: 'incoming' as const },
      { id: 'c', kind: 'primary_user_of', direction: 'outgoing' as const },
    ]);

    expect(groups.map((group) => [group.direction, group.relations.map((relation) => relation.id)])).toEqual([
      ['outgoing', ['a', 'c']],
      ['incoming', ['b']],
    ]);
  });

  it('draws no group for an asset with no relation', () => {
    expect(groupAssetRelations([])).toEqual([]);
  });
});

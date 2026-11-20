import { describe, expect, it } from 'vitest';
import {
  assembleManagedTags,
  checkTagMerge,
  displayAssetTags,
  resolveTagRoot,
  subtreeAssetCounts,
} from './tag-merge';

describe('resolveTagRoot', () => {
  it('returns a tag with no pointer as its own root', () => {
    expect(resolveTagRoot(new Map(), 'A')).toBe('A');
  });

  it('returns the tag a merged tag points at', () => {
    expect(resolveTagRoot(new Map([['A', 'B']]), 'A')).toBe('B');
  });

  it('follows a chain to its root, from any link of it', () => {
    const pointers = new Map([['A', 'B'], ['B', 'C']]);

    expect(resolveTagRoot(pointers, 'A')).toBe('C');
    expect(resolveTagRoot(pointers, 'B')).toBe('C');
  });

  it('throws on a cycle', () => {
    const pointers = new Map([['A', 'B'], ['B', 'A']]);

    expect(() => resolveTagRoot(pointers, 'A')).toThrow('Tag merge cycle');
  });
});

describe('checkTagMerge', () => {
  it('refuses a source that is already merged', () => {
    const pointers = new Map([['A', 'X']]);

    expect(checkTagMerge(pointers, 'A', 'B')).toBe('sourceAlreadyMerged');
  });

  it('refuses a target that is already merged', () => {
    const pointers = new Map([['B', 'X']]);

    expect(checkTagMerge(pointers, 'A', 'B')).toBe('targetAlreadyMerged');
  });

  it('refuses to merge a tag into itself', () => {
    expect(checkTagMerge(new Map(), 'A', 'A')).toBe('targetIsSource');
  });

  it('refuses a root as the source of a merge into a tag already merged into it', () => {
    const pointers = new Map([['A', 'B']]);

    expect(checkTagMerge(pointers, 'B', 'A')).toBe('targetAlreadyMerged');
  });

  it('allows a merge between two unrelated roots', () => {
    expect(checkTagMerge(new Map([['C', 'D']]), 'A', 'B')).toBeNull();
  });

  it('allows merging a root that already holds merged tags into another root', () => {
    expect(checkTagMerge(new Map([['A', 'B']]), 'B', 'C')).toBeNull();
  });

  it('reports the source refusal before the target ones', () => {
    const pointers = new Map([['A', 'X'], ['B', 'Y']]);

    expect(checkTagMerge(pointers, 'A', 'B')).toBe('sourceAlreadyMerged');
  });
});

describe('displayAssetTags', () => {
  const tagA = { id: 'A', name: 'PII', color: '#aaa' };
  const tagB = { id: 'B', name: 'pii', color: '#bbb' };

  it('shows a root once when an asset carries both the merged tag and the root', () => {
    const result = displayAssetTags(
      [tagA, tagB],
      new Set(),
      new Map([['A', 'B']]),
      new Map([['B', tagB]]),
    );

    expect(result).toEqual([{ ...tagB, isManual: false }]);
  });

  it('takes the name and color of a root the asset is not directly linked to', () => {
    const result = displayAssetTags(
      [tagA],
      new Set(),
      new Map([['A', 'B']]),
      new Map([['B', tagB]]),
    );

    expect(result).toEqual([{ id: 'B', name: 'pii', color: '#bbb', isManual: false }]);
  });

  it('takes a tag that is its own root from the linked tag when rootsById does not hold it', () => {
    expect(displayAssetTags([tagB], new Set(), new Map(), new Map())).toEqual([{ ...tagB, isManual: false }]);
  });

  it('marks a root manual when only the merged tag was linked by hand', () => {
    const result = displayAssetTags(
      [tagA, tagB],
      new Set(['A']),
      new Map([['A', 'B']]),
      new Map([['B', tagB]]),
    );

    expect(result).toEqual([{ ...tagB, isManual: true }]);
  });

  it('keeps the order in which the roots first appear', () => {
    const tagC = { id: 'C', name: 'cde', color: null };
    const result = displayAssetTags(
      [tagC, tagA, tagB],
      new Set(),
      new Map([['A', 'B']]),
      new Map([['B', tagB]]),
    );

    expect(result.map((tag) => tag.id)).toEqual(['C', 'B']);
  });

  it('throws when a root that differs from the linked tag is missing from rootsById', () => {
    expect(() => displayAssetTags([tagA], new Set(), new Map([['A', 'B']]), new Map())).toThrow();
  });
});

describe('subtreeAssetCounts', () => {
  it('gives a tag with no merged tag its direct count', () => {
    const counts = subtreeAssetCounts({
      tagIds: ['A'],
      pointers: new Map(),
      directCounts: new Map([['A', 3]]),
      familyLinks: [],
    });

    expect(counts).toEqual(new Map([['A', 3]]));
  });

  it('counts an asset once when it carries both a merged tag and its root', () => {
    const counts = subtreeAssetCounts({
      tagIds: ['A', 'B'],
      pointers: new Map([['A', 'B']]),
      directCounts: new Map([['A', 1], ['B', 1]]),
      familyLinks: [
        { tagId: 'A', supportingAssetId: 'asset-1' },
        { tagId: 'B', supportingAssetId: 'asset-1' },
      ],
    });

    expect(counts.get('B')).toBe(1);
    expect(counts.get('A')).toBe(1);
  });

  it('counts the assets of a whole chain on its root', () => {
    const counts = subtreeAssetCounts({
      tagIds: ['A', 'B', 'C'],
      pointers: new Map([['A', 'B'], ['B', 'C']]),
      directCounts: new Map([['A', 1], ['B', 1], ['C', 1]]),
      familyLinks: [
        { tagId: 'A', supportingAssetId: 'asset-a' },
        { tagId: 'B', supportingAssetId: 'asset-b' },
        { tagId: 'C', supportingAssetId: 'asset-c' },
      ],
    });

    expect(counts.get('C')).toBe(3);
    expect(counts.get('B')).toBe(2);
    expect(counts.get('A')).toBe(1);
  });

  it('counts 0 for a tag absent from directCounts', () => {
    const counts = subtreeAssetCounts({
      tagIds: ['A'],
      pointers: new Map(),
      directCounts: new Map(),
      familyLinks: [],
    });

    expect(counts).toEqual(new Map([['A', 0]]));
  });
});

describe('assembleManagedTags', () => {
  const vocabulary = [
    { id: 'tag-1', name: 'production', color: '#111', mergedIntoTagId: null, mergedAt: null },
  ];

  it('builds the manual and the OpenAEV sources of one tag', () => {
    const result = assembleManagedTags({
      vocabulary,
      origins: [
        { tagId: 'tag-1', connectorId: null, sourceTagId: null, reportedName: 'production', connectorSource: null },
        { tagId: 'tag-1', connectorId: 'conn-1', sourceTagId: 'oaev-1', reportedName: 'prod', connectorSource: 'openaev' },
      ],
      assetCounts: new Map([['tag-1', 4]]),
    });

    expect(result).toEqual([
      {
        id: 'tag-1',
        name: 'production',
        color: '#111',
        mergedIntoTagId: null,
        mergedAt: null,
        assetCount: 4,
        sources: [
          { kind: 'manual' },
          { kind: 'connector', source: 'openaev', reportedName: 'prod' },
        ],
      },
    ]);
  });

  it('tells an XTM One origin apart from a manual one', () => {
    const result = assembleManagedTags({
      vocabulary,
      origins: [
        { tagId: 'tag-1', connectorId: null, sourceTagId: null, reportedName: 'production', pushedByXtmOne: false, connectorSource: null },
        { tagId: 'tag-1', connectorId: null, sourceTagId: null, reportedName: 'production', pushedByXtmOne: true, connectorSource: null },
      ],
      assetCounts: new Map(),
    });

    expect(result[0]?.sources).toEqual([{ kind: 'manual' }, { kind: 'xtm_one' }]);
  });

  it('ignores an origin whose connector was deleted', () => {
    const result = assembleManagedTags({
      vocabulary,
      origins: [
        { tagId: 'tag-1', connectorId: null, sourceTagId: 'oaev-1', reportedName: 'prod', connectorSource: null },
      ],
      assetCounts: new Map(),
    });

    expect(result[0]?.sources).toEqual([]);
  });

  it('counts 0 assets for a tag absent from assetCounts', () => {
    const result = assembleManagedTags({ vocabulary, origins: [], assetCounts: new Map() });

    expect(result[0]?.assetCount).toBe(0);
  });

  it('sorts the tags by name', () => {
    const result = assembleManagedTags({
      vocabulary: [
        { id: 'tag-b', name: 'beta', color: null, mergedIntoTagId: null, mergedAt: null },
        { id: 'tag-a', name: 'alpha', color: null, mergedIntoTagId: null, mergedAt: null },
      ],
      origins: [],
      assetCounts: new Map(),
    });

    expect(result.map((tag) => tag.name)).toEqual(['alpha', 'beta']);
  });

  it('keeps the merge pointer and date of a merged tag', () => {
    const mergedAt = new Date('2026-10-01T10:00:00Z');
    const result = assembleManagedTags({
      vocabulary: [{ id: 'tag-a', name: 'PII', color: null, mergedIntoTagId: 'tag-b', mergedAt }],
      origins: [],
      assetCounts: new Map(),
    });

    expect(result[0]).toMatchObject({ id: 'tag-a', mergedIntoTagId: 'tag-b', mergedAt });
  });
});

import { describe, expect, it } from 'vitest';
import type { ManagedTag } from './tag-management-utils';
import { buildTagRows, findTagNameOwner, mergeTargetOptions, tagFamily, tagSourceOptions } from './tag-management-utils';

const manual = { kind: 'manual' } as const;
const openaev = (reportedName: string) => ({ kind: 'connector', source: 'openaev', reportedName }) as const;

const tag = (id: string, name: string, overrides: Partial<ManagedTag> = {}): ManagedTag => ({
  id,
  name,
  color: null,
  mergedIntoTagId: null,
  mergedAt: null,
  assetCount: 0,
  sources: [manual],
  ...overrides,
});

const NO_FILTER = { search: '', source: 'all' } as const;

describe('buildTagRows', () => {
  it('should exclude merged tags from the rows and list them under their root in mergedAt order', () => {
    const tags = [
      tag('a', 'A', { mergedIntoTagId: 'root', mergedAt: '2026-03-01T00:00:00.000Z' }),
      tag('root', 'Root'),
      tag('b', 'B', { mergedIntoTagId: 'root', mergedAt: '2026-01-01T00:00:00.000Z' }),
      tag('other', 'Other'),
    ];

    const rows = buildTagRows(tags, NO_FILTER);

    expect(rows.map((row) => row.id)).toEqual(['root', 'other']);
    expect(rows[0]?.mergedTags.map((merged) => merged.id)).toEqual(['b', 'a']);
    expect(rows[1]?.mergedTags).toEqual([]);
  });

  it('should keep the order the tags were received in', () => {
    const tags = [tag('z', 'Zeta'), tag('a', 'Alpha')];

    expect(buildTagRows(tags, NO_FILTER).map((row) => row.id)).toEqual(['z', 'a']);
  });

  it('should only put the directly merged tags under a root in a chain A -> B -> C', () => {
    const tags = [
      tag('a', 'A', { mergedIntoTagId: 'b', mergedAt: '2026-01-01T00:00:00.000Z' }),
      tag('b', 'B', { mergedIntoTagId: 'c', mergedAt: '2026-02-01T00:00:00.000Z' }),
      tag('c', 'C'),
    ];

    const rows = buildTagRows(tags, NO_FILTER);

    expect(rows.map((row) => row.id)).toEqual(['c']);
    expect(rows[0]?.mergedTags.map((merged) => merged.id)).toEqual(['b']);
  });

  it('should keep only the tags XTM One pushed under the XTM One source filter', () => {
    const tags = [
      tag('pushed', 'Pushed', { sources: [{ kind: 'xtm_one' }] }),
      tag('hand', 'Hand'),
      tag('both', 'Both', { sources: [manual, { kind: 'xtm_one' }] }),
    ];

    expect(buildTagRows(tags, { search: '', source: 'xtm_one' }).map((row) => row.id)).toEqual(['pushed', 'both']);
  });

  it('should find a row by a lowercase search on its name, whatever the case', () => {
    const tags = [tag('pci', 'PCI DSS'), tag('pii', 'PII')];

    expect(buildTagRows(tags, { search: 'pci', source: 'all' }).map((row) => row.id)).toEqual(['pci']);
  });

  it('should find a root by the name of a tag merged into it', () => {
    const tags = [
      tag('root', 'Payments'),
      tag('merged', 'PCI DSS', { mergedIntoTagId: 'root', mergedAt: '2026-01-01T00:00:00.000Z' }),
      tag('other', 'Other'),
    ];

    expect(buildTagRows(tags, { search: 'pci', source: 'all' }).map((row) => row.id)).toEqual(['root']);
  });

  it('should find a root by the name of a tag merged deeper in a chain', () => {
    const tags = [
      tag('a', 'pci', { mergedIntoTagId: 'b', mergedAt: '2026-01-01T00:00:00.000Z' }),
      tag('b', 'card-data', { mergedIntoTagId: 'c', mergedAt: '2026-02-01T00:00:00.000Z' }),
      tag('c', 'Compliance'),
    ];

    expect(buildTagRows(tags, { search: 'pci', source: 'all' }).map((row) => row.id)).toEqual(['c']);
  });

  it('should keep only the roots with a manual source for the manual filter', () => {
    const tags = [
      tag('m', 'Manual one', { sources: [manual] }),
      tag('o', 'OpenAEV one', { sources: [openaev('OpenAEV one')] }),
      tag('both', 'Both', { sources: [manual, openaev('Both')] }),
    ];

    expect(buildTagRows(tags, { search: '', source: 'manual' }).map((row) => row.id)).toEqual(['m', 'both']);
  });

  it('should keep only the roots with a source of that connector for a connector filter', () => {
    const tags = [
      tag('m', 'Manual one', { sources: [manual] }),
      tag('o', 'OpenAEV one', { sources: [openaev('OpenAEV one')] }),
      tag('both', 'Both', { sources: [manual, openaev('Both')] }),
    ];

    expect(buildTagRows(tags, { search: '', source: 'openaev' }).map((row) => row.id)).toEqual(['o', 'both']);
  });

  it('should filter on the sources of the root alone, not on those of the tags merged into it', () => {
    const tags = [
      tag('root', 'Root', { sources: [manual] }),
      tag('merged', 'Merged', { mergedIntoTagId: 'root', mergedAt: '2026-01-01T00:00:00.000Z', sources: [openaev('Merged')] }),
    ];

    expect(buildTagRows(tags, { search: '', source: 'openaev' })).toEqual([]);
  });

  it('should leave connectorNames empty while the connector name is the tag name', () => {
    const tags = [tag('a', 'production', { sources: [manual, openaev('production')] })];

    expect(buildTagRows(tags, NO_FILTER)[0]?.connectorNames).toEqual([]);
  });

  it('should list the connector names that differ from the tag name after a rename', () => {
    const tags = [tag('a', 'prod', { sources: [manual, openaev('production')] })];

    expect(buildTagRows(tags, NO_FILTER)[0]?.connectorNames).toEqual([{ source: 'openaev', reportedName: 'production' }]);
  });
});

describe('tagSourceOptions', () => {
  it('should list manual first, then each connector source once', () => {
    const tags = [
      tag('a', 'A', { sources: [openaev('A')] }),
      tag('b', 'B', { sources: [openaev('B'), manual] }),
      tag('c', 'C', { sources: [manual] }),
    ];

    expect(tagSourceOptions(tags)).toEqual(['manual', 'openaev']);
  });

  it('should not list manual when no tag has a manual source', () => {
    expect(tagSourceOptions([tag('a', 'A', { sources: [openaev('A')] })])).toEqual(['openaev']);
  });

  it('should return nothing for no tags', () => {
    expect(tagSourceOptions([])).toEqual([]);
  });
});

describe('findTagNameOwner', () => {
  const tags = [
    tag('pci', 'PCI'),
    tag('mine', 'Mine'),
    tag('mine-child', 'Old mine', { mergedIntoTagId: 'mine', mergedAt: '2026-01-01T00:00:00.000Z' }),
    tag('other-child', 'Legacy', { mergedIntoTagId: 'pci', mergedAt: '2026-01-01T00:00:00.000Z' }),
  ];

  it('should answer unchanged for the current name of the tag', () => {
    expect(findTagNameOwner(tags, 'mine', 'Mine')).toEqual({ kind: 'unchanged' });
  });

  it('should answer free for a name no tag carries', () => {
    expect(findTagNameOwner(tags, 'mine', 'Brand new')).toEqual({ kind: 'free' });
  });

  it('should answer ownMergedTag for the name of a tag merged into the renamed tag', () => {
    expect(findTagNameOwner(tags, 'mine', 'Old mine')).toEqual({ kind: 'ownMergedTag' });
  });

  it('should answer mergeInto, with the owner as its own target, for the name of another root', () => {
    expect(findTagNameOwner(tags, 'mine', 'PCI')).toEqual({ kind: 'mergeInto', owner: tags[0], target: tags[0] });
  });

  it('should answer mergeInto with the root as target for the name of a tag merged into another root', () => {
    expect(findTagNameOwner(tags, 'mine', 'Legacy')).toEqual({ kind: 'mergeInto', owner: tags[3], target: tags[0] });
  });

  it('should trim the typed name before comparing', () => {
    expect(findTagNameOwner(tags, 'mine', '  PCI  ')).toEqual({ kind: 'mergeInto', owner: tags[0], target: tags[0] });
    expect(findTagNameOwner(tags, 'mine', '  Mine ')).toEqual({ kind: 'unchanged' });
  });

  it('should compare the case exactly, as the unique index does', () => {
    expect(findTagNameOwner(tags, 'mine', 'pci')).toEqual({ kind: 'free' });
  });
});

describe('mergeTargetOptions', () => {
  it('should list the roots except the tag itself, sorted by name', () => {
    const tags = [
      tag('c', 'Charlie'),
      tag('self', 'Self'),
      tag('merged', 'Aardvark', { mergedIntoTagId: 'c', mergedAt: '2026-01-01T00:00:00.000Z' }),
      tag('a', 'Alpha'),
    ];

    expect(mergeTargetOptions(tags, 'self').map((option) => option.id)).toEqual(['a', 'c']);
  });
});

describe('tagFamily', () => {
  const MERGED_AT = '2026-01-01T00:00:00.000Z';

  it('should return the tag alone when nothing is merged into it', () => {
    const tags = [tag('a', 'Alpha'), tag('b', 'Bravo')];

    expect(tagFamily(tags, 'a').map((member) => member.id)).toEqual(['a']);
  });

  it('should include every tag merged into it at any depth', () => {
    const tags = [
      tag('c', 'Charlie'),
      tag('b', 'Bravo', { mergedIntoTagId: 'c', mergedAt: MERGED_AT }),
      tag('a', 'Alpha', { mergedIntoTagId: 'b', mergedAt: MERGED_AT }),
    ];

    expect(tagFamily(tags, 'c').map((member) => member.id)).toEqual(['c', 'b', 'a']);
  });

  it('should exclude a sibling root and the tags merged into it', () => {
    const tags = [
      tag('c', 'Charlie'),
      tag('b', 'Bravo', { mergedIntoTagId: 'c', mergedAt: MERGED_AT }),
      tag('other', 'Other'),
      tag('other-child', 'Other child', { mergedIntoTagId: 'other', mergedAt: MERGED_AT }),
    ];

    expect(tagFamily(tags, 'c').map((member) => member.id)).toEqual(['c', 'b']);
  });

  it('should return nothing for an unknown id', () => {
    expect(tagFamily([tag('a', 'Alpha')], 'missing')).toEqual([]);
  });

  it('should stop on a cycle instead of looping', () => {
    const tags = [
      tag('a', 'Alpha', { mergedIntoTagId: 'b', mergedAt: MERGED_AT }),
      tag('b', 'Bravo', { mergedIntoTagId: 'a', mergedAt: MERGED_AT }),
    ];

    expect(tagFamily(tags, 'a').map((member) => member.id)).toEqual(['a', 'b']);
  });
});

describe('buildTagRows accents', () => {
  it('should find an accented tag, or a merged one, from the plain spelling', () => {
    const tags = [tag('a', 'École Straße'), tag('r', 'Root'), tag('m', 'Façade', { mergedIntoTagId: 'r', mergedAt: '2026-03-01T00:00:00.000Z' })];

    expect(buildTagRows(tags, { search: 'ecole', source: 'all' }).map((row) => row.id)).toEqual(['a']);
    expect(buildTagRows(tags, { search: 'strasse', source: 'all' }).map((row) => row.id)).toEqual(['a']);
    expect(buildTagRows(tags, { search: 'facade', source: 'all' }).map((row) => row.id)).toEqual(['r']);
  });

  it('should find a plain tag from an accented search', () => {
    expect(buildTagRows([tag('p', 'ecole')], { search: 'éco', source: 'all' }).map((row) => row.id)).toEqual(['p']);
  });
});

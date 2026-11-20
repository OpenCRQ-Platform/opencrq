import { describe, expect, it } from 'vitest';
import type { RelatedTechnique } from './related-techniques-utils';
import { filterRelatedTechniques } from './related-techniques-utils';

const technique = (externalId: string, name: string, isSubtechnique?: boolean): RelatedTechnique => ({
  id: `id-${externalId}`,
  externalId,
  name,
  revoked: false,
  isSubtechnique,
});

const catalogue: Array<RelatedTechnique> = [
  technique('T1027', 'Obfuscated Files or Information', false),
  technique('T1027.002', 'Software Packing', true),
  technique('T1036', 'Masquerading', false),
  technique('T1078.004', 'Cloud Accounts', true),
];

describe('filterRelatedTechniques', () => {
  it('returns everything when nothing is asked', () => {
    expect(filterRelatedTechniques(catalogue, { search: '', grain: 'all' })).toHaveLength(4);
  });

  it('keeps only the asked grain', () => {
    const subs = filterRelatedTechniques(catalogue, { search: '', grain: 'sub-technique' });
    expect(subs.map((t) => t.externalId)).toEqual(['T1027.002', 'T1078.004']);
    const parents = filterRelatedTechniques(catalogue, { search: '', grain: 'technique' });
    expect(parents.map((t) => t.externalId)).toEqual(['T1027', 'T1036']);
  });

  it('treats a missing grain as a parent technique, so a list carrying none stays whole', () => {
    const untyped = [technique('T1078', 'Valid Accounts')];
    expect(filterRelatedTechniques(untyped, { search: '', grain: 'technique' })).toHaveLength(1);
    expect(filterRelatedTechniques(untyped, { search: '', grain: 'sub-technique' })).toHaveLength(0);
  });

  it('searches the external id as well as the name', () => {
    expect(filterRelatedTechniques(catalogue, { search: 'T1036', grain: 'all' }).map((t) => t.name))
      .toEqual(['Masquerading']);
    expect(filterRelatedTechniques(catalogue, { search: 'packing', grain: 'all' }).map((t) => t.externalId))
      .toEqual(['T1027.002']);
  });

  it('ignores case and surrounding spaces', () => {
    expect(filterRelatedTechniques(catalogue, { search: '  ClOuD  ', grain: 'all' }).map((t) => t.externalId))
      .toEqual(['T1078.004']);
  });

  it('applies the search within the asked grain, never across it', () => {
    expect(filterRelatedTechniques(catalogue, { search: 'T1027', grain: 'technique' }).map((t) => t.externalId))
      .toEqual(['T1027']);
  });

  it('leaves the given list untouched', () => {
    const given = [...catalogue];
    filterRelatedTechniques(given, { search: 'T1036', grain: 'technique' });
    expect(given).toHaveLength(4);
  });
});

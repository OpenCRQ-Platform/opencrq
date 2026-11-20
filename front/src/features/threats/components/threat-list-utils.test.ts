import { i18n } from '@lingui/core';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  isThreatCatalogEmpty,
  isThreatListFiltered,
  sourceKindLabel,
  THREAT_LIST_INITIAL_COLUMN_VISIBILITY,
  threatCatalogTotal,
} from './threat-list-utils';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

const NO_FILTER = { search: '', outcomeId: undefined, entityType: undefined, kind: undefined };

describe('sourceKindLabel', () => {
  it('names a connector-fed threat after its connector', () => {
    expect(sourceKindLabel('connector')).toBe('OpenCTI');
  });

  it('names a threat of the dataset after its connector', () => {
    expect(sourceKindLabel('default-threats')).toBe('OpenCRQ Default Threats');
  });

  it('names an uploaded bundle a STIX import', () => {
    expect(sourceKindLabel('stix-import')).toBe('STIX import');
  });
});

describe('THREAT_LIST_INITIAL_COLUMN_VISIBILITY', () => {
  it('hides the original creation date and the last update', () => {
    expect(THREAT_LIST_INITIAL_COLUMN_VISIBILITY).toEqual({ stixCreated: false, updatedAt: false });
  });
});

describe('isThreatListFiltered', () => {
  it('is false with no search and every filter on all', () => {
    expect(isThreatListFiltered(NO_FILTER)).toBe(false);
  });

  it('ignores a search made of spaces', () => {
    expect(isThreatListFiltered({ ...NO_FILTER, search: '   ' })).toBe(false);
  });

  it.each([
    ['a search', { search: 'apt' }],
    ['an outcome', { outcomeId: '0196f0b0-0000-7000-8000-000000000001' }],
    ['a type', { entityType: 'campaign' as const }],
    ['a source', { kind: 'stix-import' as const }],
  ])('is true with %s', (_, patch) => {
    expect(isThreatListFiltered({ ...NO_FILTER, ...patch })).toBe(true);
  });
});

describe('isThreatCatalogEmpty', () => {
  const SETTLED = { filtered: false, isPlaceholderData: false };

  it('is empty when the settled, unfiltered list counts no row', () => {
    expect(isThreatCatalogEmpty({ ...SETTLED, total: 0 })).toBe(true);
  });

  it('is not empty when a filter is what leaves no row', () => {
    expect(isThreatCatalogEmpty({ ...SETTLED, total: 0, filtered: true })).toBe(false);
  });

  it('is not empty before the list answers', () => {
    expect(isThreatCatalogEmpty({ ...SETTLED, total: undefined })).toBe(false);
  });

  it('is not empty with rows', () => {
    expect(isThreatCatalogEmpty({ ...SETTLED, total: 3 })).toBe(false);
  });

  it('is not empty while a reset reloads the list from a search that matched nothing', () => {
    const steps = [
      { total: 0, filtered: true, isPlaceholderData: false },
      { total: 0, filtered: false, isPlaceholderData: true },
      { total: 17, filtered: false, isPlaceholderData: false },
    ];

    expect(steps.map(isThreatCatalogEmpty)).toEqual([false, false, false]);
  });
});

describe('threatCatalogTotal', () => {
  it('adds the three threat types', () => {
    expect(threatCatalogTotal({ threatActors: 9, intrusionSets: 187, campaigns: 16 })).toBe(212);
  });
});

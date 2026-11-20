import { describe, expect, it } from 'vitest';
import type { RunFilters } from './run-filter-utils';
import type { RunsUrlFilters } from './runs-list-search';
import {
  runQueryParamsFromFilters,
  runsUrlFiltersEqual,
  toRunFilters,
  toRunUrlFilters,
} from './run-filter-utils';
import { RUNS_LIST_SEARCH_DEFAULTS } from './runs-list-search';

const SORT = { sortBy: 'enqueuedAt' as const, sortDesc: true };
const PAGE_ONE = { pageIndex: 0, pageSize: 25 };

describe('toRunFilters', () => {
  it('should turn the default, empty URL filters into empty lists and null dates', () => {
    const filters = toRunFilters(RUNS_LIST_SEARCH_DEFAULTS);

    expect(filters).toEqual({
      statuses: [],
      kinds: [],
      triggeredBy: [],
      dateField: 'enqueuedAt',
      dateFrom: null,
      dateTo: null,
      search: '',
    });
  });

  it('should parse the comma-joined lists and drop a status or trigger the vocabulary no longer defines', () => {
    const urlFilters: RunsUrlFilters = {
      ...RUNS_LIST_SEARCH_DEFAULTS,
      statuses: 'dlq,succeeded,retired-status',
      kinds: 'cve-first,drata-sync',
      triggeredBy: 'scheduler,retired-origin',
    };

    const filters = toRunFilters(urlFilters);

    expect(filters.statuses).toEqual(['dlq', 'succeeded']);
    expect(filters.kinds).toEqual(['cve-first', 'drata-sync']);
    expect(filters.triggeredBy).toEqual(['scheduler']);
  });

  it('should round-trip through toRunUrlFilters', () => {
    const filters: RunFilters = {
      statuses: ['dlq'],
      kinds: ['cve-first'],
      triggeredBy: ['scheduler'],
      dateField: 'finishedAt',
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
      search: 'cve',
    };

    expect(toRunFilters(toRunUrlFilters(filters))).toEqual(filters);
  });
});

describe('runQueryParamsFromFilters', () => {
  it('should turn the default, empty filters into an unconstrained query', () => {
    const params = runQueryParamsFromFilters(toRunFilters(RUNS_LIST_SEARCH_DEFAULTS), SORT, PAGE_ONE);

    expect(params).toMatchObject({
      kinds: null,
      statuses: null,
      triggeredBy: null,
      enqueuedFrom: null,
      enqueuedTo: null,
      startedFrom: null,
      startedTo: null,
      finishedFrom: null,
      finishedTo: null,
      search: null,
      sortBy: 'enqueuedAt',
      sortDesc: true,
      limit: 25,
      offset: 0,
    });
  });

  it('should route the date window to the instant the filter names, and leave the other two pairs null', () => {
    const filters: RunFilters = {
      ...toRunFilters(RUNS_LIST_SEARCH_DEFAULTS),
      dateField: 'finishedAt',
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
    };

    const params = runQueryParamsFromFilters(filters, SORT, PAGE_ONE);

    expect(params.finishedFrom).toBe(new Date('2026-01-01T00:00:00.000').toISOString());
    expect(params.finishedTo).toBe(new Date('2026-01-31T23:59:59.999').toISOString());
    expect(params.enqueuedFrom).toBeNull();
    expect(params.enqueuedTo).toBeNull();
    expect(params.startedFrom).toBeNull();
    expect(params.startedTo).toBeNull();
  });

  it('should trim the search text and turn an empty one into null', () => {
    const base = toRunFilters(RUNS_LIST_SEARCH_DEFAULTS);

    expect(runQueryParamsFromFilters({ ...base, search: '  cve  ' }, SORT, PAGE_ONE).search).toBe('cve');
    expect(runQueryParamsFromFilters({ ...base, search: '   ' }, SORT, PAGE_ONE).search).toBeNull();
  });

  it('should compute the offset from the page index and size', () => {
    const params = runQueryParamsFromFilters(toRunFilters(RUNS_LIST_SEARCH_DEFAULTS), SORT, { pageIndex: 3, pageSize: 25 });

    expect(params.offset).toBe(75);
  });
});

describe('runsUrlFiltersEqual', () => {
  it('should be true for two snapshots with the same values', () => {
    expect(runsUrlFiltersEqual(RUNS_LIST_SEARCH_DEFAULTS, { ...RUNS_LIST_SEARCH_DEFAULTS })).toBe(true);
  });

  it('should be false once any single field differs', () => {
    expect(runsUrlFiltersEqual(RUNS_LIST_SEARCH_DEFAULTS, { ...RUNS_LIST_SEARCH_DEFAULTS, kinds: 'cve-first' })).toBe(false);
  });
});

import type { JobStatus, RunSortKey, TriggeredBy } from '@app/module/client';
import type { RunDateField, RunsUrlFilters } from './runs-list-search';
import { formatUrlList, parseUrlList } from '../../utils';
import { RUN_DATE_FIELDS } from './runs-list-search';

/** The six run statuses, for the status filter's option list — kept in sync by hand with
 * `RUN_STATUS_SEVERITY` and `runStatusLabel` in `run-vocabulary.ts`. */
export const RUN_STATUSES: ReadonlyArray<JobStatus> = ['queued', 'running', 'succeeded', 'partial', 'cancelled', 'dlq'];

/** Every trigger, for the "triggered by" filter's option list — kept in sync by hand with
 * `triggeredByLabel` in `job-vocabulary.ts`. */
export const RUN_TRIGGERED_BY: ReadonlyArray<TriggeredBy> = ['user', 'scheduler', 'system', 'event', 'connector'];

export const isRunDateField = (value: string): value is RunDateField =>
  (RUN_DATE_FIELDS as ReadonlyArray<string>).includes(value);

export interface RunFilters {
  statuses: Array<JobStatus>,
  kinds: Array<string>,
  triggeredBy: Array<TriggeredBy>,
  dateField: RunDateField,
  /** Local calendar dates (`yyyy-mm-dd`), inclusive on both ends. */
  dateFrom: string | null,
  dateTo: string | null,
  search: string,
}

/** Drops a selection whose value the vocabulary no longer defines, rather than keeping one that
 * can never match anything — the same reasoning `resolveOptionFilter` applies to a single value. */
const toKnownValues = <V extends string>(vocabulary: ReadonlyArray<V>, raw: string): Array<V> => {
  const known = new Set<string>(vocabulary);
  return parseUrlList(raw).filter((value): value is V => known.has(value));
};

/** Parses the comma-joined URL fields into the shape the Runs view and `runQueryParamsFromFilters` expect. */
export const toRunFilters = (urlFilters: RunsUrlFilters): RunFilters => ({
  statuses: toKnownValues(RUN_STATUSES, urlFilters.statuses),
  kinds: parseUrlList(urlFilters.kinds),
  triggeredBy: toKnownValues(RUN_TRIGGERED_BY, urlFilters.triggeredBy),
  dateField: urlFilters.dateField,
  dateFrom: urlFilters.dateFrom === '' ? null : urlFilters.dateFrom,
  dateTo: urlFilters.dateTo === '' ? null : urlFilters.dateTo,
  search: urlFilters.search,
});

/** Inverse of {@link toRunFilters}, for writing a `RunFilters` back to the address. */
export const toRunUrlFilters = (filters: RunFilters): RunsUrlFilters => ({
  statuses: formatUrlList(filters.statuses),
  kinds: formatUrlList(filters.kinds),
  triggeredBy: formatUrlList(filters.triggeredBy),
  dateField: filters.dateField,
  dateFrom: filters.dateFrom ?? '',
  dateTo: filters.dateTo ?? '',
  search: filters.search,
});

/**
 * Whether two URL-shaped filter snapshots name the same query. A change resets the page to 1 —
 * without it, a filter narrowing the result set can leave the client on a page past the new last
 * one, and the client and server page numbers drift apart.
 */
export const runsUrlFiltersEqual = (a: RunsUrlFilters, b: RunsUrlFilters): boolean =>
  a.search === b.search
  && a.statuses === b.statuses
  && a.kinds === b.kinds
  && a.triggeredBy === b.triggeredBy
  && a.dateField === b.dateField
  && a.dateFrom === b.dateFrom
  && a.dateTo === b.dateTo;

export interface RunSort {
  sortBy: RunSortKey,
  sortDesc: boolean,
}

export interface RunPage {
  pageIndex: number,
  pageSize: number,
}

/** What `jobs.listAllRuns` takes, dates already turned into the ISO strings `z.coerce.date()` reads. */
export interface RunQueryParams {
  kinds: Array<string> | null,
  statuses: Array<JobStatus> | null,
  triggeredBy: Array<TriggeredBy> | null,
  enqueuedFrom: string | null,
  enqueuedTo: string | null,
  startedFrom: string | null,
  startedTo: string | null,
  finishedFrom: string | null,
  finishedTo: string | null,
  search: string | null,
  sortBy: RunSortKey,
  sortDesc: boolean,
  limit: number,
  offset: number,
}

/** A `yyyy-mm-dd` picked in a date field, read as the start or the end of that local calendar day. */
const dayBoundary = (date: string, edge: 'start' | 'end'): string => {
  // eslint-disable-next-line lingui/no-unlocalized-strings -- time-of-day literals for a Date constructor, not copy
  const time = edge === 'start' ? 'T00:00:00.000' : 'T23:59:59.999';
  return new Date(`${date}${time}`).toISOString();
};

/**
 * The one instant the date window is filtering on carries the `from`/`to` pair; the other two pairs
 * stay `null`, since `RunQueryInput` has no field naming which instant a lone `from`/`to` belongs to.
 */
export const runQueryParamsFromFilters = (
  filters: RunFilters,
  sort: RunSort,
  page: RunPage,
): RunQueryParams => {
  const from = filters.dateFrom === null ? null : dayBoundary(filters.dateFrom, 'start');
  const to = filters.dateTo === null ? null : dayBoundary(filters.dateTo, 'end');
  const search = filters.search.trim();
  return {
    kinds: filters.kinds.length === 0 ? null : filters.kinds,
    statuses: filters.statuses.length === 0 ? null : filters.statuses,
    triggeredBy: filters.triggeredBy.length === 0 ? null : filters.triggeredBy,
    enqueuedFrom: filters.dateField === 'enqueuedAt' ? from : null,
    enqueuedTo: filters.dateField === 'enqueuedAt' ? to : null,
    startedFrom: filters.dateField === 'startedAt' ? from : null,
    startedTo: filters.dateField === 'startedAt' ? to : null,
    finishedFrom: filters.dateField === 'finishedAt' ? from : null,
    finishedTo: filters.dateField === 'finishedAt' ? to : null,
    search: search === '' ? null : search,
    sortBy: sort.sortBy,
    sortDesc: sort.sortDesc,
    limit: page.pageSize,
    offset: page.pageIndex * page.pageSize,
  };
};

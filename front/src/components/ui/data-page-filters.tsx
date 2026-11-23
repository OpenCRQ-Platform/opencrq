import { includesFolded } from '@app/utils/text-fold';
import { t } from '@lingui/core/macro';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { DebouncedSearchField } from '../shared/debounced-search-field';
import { FilterClearAll, FilterPill, FilterPillItem } from './filter-pill';

/** The search box of a client-side records table: what it says and the texts a row is found by. */
export interface DataPageSearch<T> {
  placeholder: string,
  /** The row's texts the search matches, accent and case folded; a nullish text never matches. */
  texts: (row: T) => ReadonlyArray<string | null | undefined>,
}

export interface DataPageFilterOption {
  value: string,
  label: string,
}

/** One typed filter of a client-side records table, drawn as a filter pill (Design standards s.3). */
export interface DataPageFilter<T> {
  id: string,
  /** What the filter narrows on, shown alone on the pill while it is not set. */
  label: string,
  /** The menu row that lets every row through. */
  allLabel: string,
  options: ReadonlyArray<DataPageFilterOption>,
  /** The option value or values a row holds; a row matches when one of them is the one chosen. */
  valueOf: (row: T) => string | ReadonlyArray<string>,
}

interface DataPageFiltersResult<T> {
  /** The rows the search and the filters let through, every row while none is set. */
  rows: Array<T>,
  /** Search first, then the filter pills, then the active-filter count and Clear all. */
  controls: ReactNode,
  /** Whether a search or a filter is set. */
  narrowed: boolean,
}

const matchesFilter = <T extends object>(row: T, filter: DataPageFilter<T>, value: string): boolean => {
  const held = filter.valueOf(row);
  return typeof held === 'string' ? held === value : held.includes(value);
};

/**
 * The search and typed filters `DataPageLayout` draws for a list it holds whole (no `total`). They
 * narrow the rows before sorting and paging, and `onNarrow` is told so the pager goes back to the first page.
 */
export const useDataPageFilters = <T extends object>(
  data: Array<T>,
  search: DataPageSearch<T> | undefined,
  filters: ReadonlyArray<DataPageFilter<T>> | undefined,
  onNarrow: () => void,
): DataPageFiltersResult<T> => {
  const [query, setQuery] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});

  const activeFilters = (filters ?? []).filter((filter) => values[filter.id] !== undefined);
  const searching = search !== undefined && query.trim() !== '';
  const narrowed = searching || activeFilters.length > 0;

  const rows = narrowed
    ? data.filter((row) => (!searching || search.texts(row).some((text) => includesFolded(text, query)))
      && activeFilters.every((filter) => matchesFilter(row, filter, values[filter.id])))
    : data;

  const commitQuery = (next: string): void => {
    setQuery(next);
    onNarrow();
  };
  const setFilter = (id: string, value: string | undefined): void => {
    setValues((previous) => {
      const next = { ...previous };
      if (value === undefined) {
        delete next[id];
      } else {
        next[id] = value;
      }
      return next;
    });
    onNarrow();
  };
  const clearAll = (): void => {
    setQuery('');
    setValues({});
    onNarrow();
  };

  const controls = search === undefined && (filters === undefined || filters.length === 0)
    ? null
    : (
      <>
        {search !== undefined && (
          <DebouncedSearchField
            placeholder={search.placeholder}
            value={query}
            onCommit={commitQuery}
            clearLabel={t`Clear search`}
            className="w-80"
          />
        )}
        {(filters ?? []).map((filter) => {
          const chosen = values[filter.id];
          return (
            <FilterPill
              key={filter.id}
              label={filter.label}
              valueLabel={chosen === undefined ? undefined : (filter.options.find((option) => option.value === chosen)?.label ?? chosen)}
            >
              <FilterPillItem selected={chosen === undefined} onSelect={() => setFilter(filter.id, undefined)}>
                {filter.allLabel}
              </FilterPillItem>
              {filter.options.map((option) => (
                <FilterPillItem key={option.value} selected={chosen === option.value} onSelect={() => setFilter(filter.id, option.value)}>
                  {option.label}
                </FilterPillItem>
              ))}
            </FilterPill>
          );
        })}
        <FilterClearAll count={activeFilters.length + (searching ? 1 : 0)} onClearAll={clearAll} />
      </>
    );

  return { rows, controls, narrowed };
};

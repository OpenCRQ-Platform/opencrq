import { compareText } from '@app/utils/text-fold';
import type { ColumnDefWithOptionsHeader } from '@filigran/ui';
import type { Row } from '@tanstack/react-table';
import { sortingFns } from '@tanstack/react-table';

const isDate = (value: unknown): value is Date => Object.prototype.toString.call(value) === '[object Date]';

/**
 * TanStack's `auto` compares strings by code point, so `école` lands after `zèbre`. Strings go
 * through `compareText`, and a null facing a string reads as `''` so the answer is the same in both
 * directions; every other value keeps what `auto` picks for it (`datetime` for dates, `basic` otherwise).
 */
export const textAwareSortingFn = <T>(rowA: Row<T>, rowB: Row<T>, columnId: string): number => {
  const first: unknown = rowA.getValue(columnId);
  const second: unknown = rowB.getValue(columnId);
  if (typeof first === 'string' && typeof second === 'string') {
    return compareText(first, second);
  }
  if (typeof first === 'string' && second == null) {
    return compareText(first, '');
  }
  if (first == null && typeof second === 'string') {
    return compareText('', second);
  }
  if (isDate(first) && isDate(second)) {
    return sortingFns.datetime(rowA, rowB, columnId);
  }
  return sortingFns.basic(rowA, rowB, columnId);
};

/** Gives `textAwareSortingFn` to every leaf column whose `sortingFn` is unset or `'auto'`, groups included. */
export const withTextAwareSorting = <T>(
  columns: Array<ColumnDefWithOptionsHeader<T, unknown>>,
): Array<ColumnDefWithOptionsHeader<T, unknown>> =>
  columns.map((column) => {
    if ('columns' in column && column.columns !== undefined) {
      return { ...column, columns: withTextAwareSorting(column.columns) };
    }
    if (column.sortingFn === undefined || column.sortingFn === 'auto') {
      return { ...column, sortingFn: textAwareSortingFn };
    }
    return column;
  });

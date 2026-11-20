import { compareText } from '@app/utils/text-fold';
import type { ColumnDef, Row } from '@tanstack/react-table';
import { sortingFns } from '@tanstack/react-table';
import { describe, expect, it } from 'vitest';
import { textAwareSortingFn, withTextAwareSorting } from './table-sorting-utils';

// A minimal row: the sorting functions only ever call `getValue(columnId)`.
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the sorting functions only call `getValue`
const rowOf = (value: unknown): Row<unknown> => ({ getValue: () => value }) as unknown as Row<unknown>;
const compare = (first: unknown, second: unknown): number => textAwareSortingFn(rowOf(first), rowOf(second), 'col');
const sortValues = <V>(values: Array<V>): Array<V> => values.toSorted((first, second) => compare(first, second));

describe('textAwareSortingFn', () => {
  it('should order strings with accents next to their plain letter', () => {
    expect(sortValues(['Zèbre', 'eden', 'école', 'Ecole', 'abc'])).toEqual(['abc', 'Ecole', 'école', 'eden', 'Zèbre']);
  });

  it('should order numbers inside strings by value', () => {
    expect(sortValues(['Scenario 10', 'Scenario 2'])).toEqual(['Scenario 2', 'Scenario 10']);
  });

  it('should group case variants together', () => {
    expect(sortValues(['b', 'A', 'a', 'B'])).toEqual(['a', 'A', 'b', 'B']);
  });

  it('should delegate numbers to the basic sorting function', () => {
    expect(sortValues([10, 2, 33])).toEqual([2, 10, 33]);
    expect(compare(1, 2)).toBe(sortingFns.basic(rowOf(1), rowOf(2), 'col'));
  });

  it('should delegate booleans to the basic sorting function', () => {
    expect(compare(true, false)).toBe(sortingFns.basic(rowOf(true), rowOf(false), 'col'));
  });

  it('should delegate dates to the datetime sorting function', () => {
    const early = new Date('2026-01-01T00:00:00Z');
    const late = new Date('2026-06-01T00:00:00Z');
    expect(sortValues([late, early])).toEqual([early, late]);
    expect(compare(new Date(early), new Date(early))).toBe(0);
  });

  it('should read a null facing a string as an empty string, in both directions', () => {
    expect(compare(null, 'abc')).toBe(compareText('', 'abc'));
    expect(compare('abc', null)).toBe(compareText('abc', ''));
    expect(compare(null, 'abc')).toBe(-1);
    expect(compare('abc', null)).toBe(1);
    expect(compare(null, '')).toBe(0);
  });

  it('should group the nulls and order the strings of a mixed column', () => {
    expect(sortValues(['Mallory', null, 'alice', 'Bob', null])).toEqual([null, null, 'alice', 'Bob', 'Mallory']);
  });

  it('should treat two nulls as equal', () => {
    expect(compare(null, null)).toBe(0);
  });
});

describe('withTextAwareSorting', () => {
  const explicit = (): number => 0;
  const columns: Array<ColumnDef<{ id: string }, unknown>> = [
    { id: 'explicit', accessorFn: () => '', sortingFn: explicit },
    { id: 'named', accessorFn: () => '', sortingFn: 'basic' },
    { id: 'auto', accessorFn: () => '', sortingFn: 'auto' },
    { id: 'unset', accessorFn: () => '' },
    {
      id: 'group',
      header: 'Group',
      columns: [
        { id: 'leafAuto', accessorFn: () => '', sortingFn: 'auto' },
        { id: 'leafExplicit', accessorFn: () => '', sortingFn: 'alphanumeric' },
        { id: 'leafUnset', accessorFn: () => '' },
      ],
    },
  ];

  const byId = (list: Array<ColumnDef<{ id: string }, unknown>>, id: string): ColumnDef<{ id: string }, unknown> => {
    const found = list.find((column) => column.id === id);
    if (found === undefined) {
      throw new Error(`no column ${id}`);
    }
    return found;
  };

  it('should set the text-aware function on unset and auto columns', () => {
    const result = withTextAwareSorting(columns);
    expect(byId(result, 'auto').sortingFn).toBe(textAwareSortingFn);
    expect(byId(result, 'unset').sortingFn).toBe(textAwareSortingFn);
  });

  it('should keep a column with any other explicit sortingFn unchanged', () => {
    const result = withTextAwareSorting(columns);
    expect(byId(result, 'explicit')).toBe(columns[0]);
    expect(byId(result, 'named')).toBe(columns[1]);
  });

  it('should give a sortingFn to the leaves of a group, not to the group', () => {
    const group = byId(withTextAwareSorting(columns), 'group');
    expect('sortingFn' in group).toBe(false);
    const leaves = 'columns' in group ? group.columns ?? [] : [];
    expect(byId(leaves, 'leafAuto').sortingFn).toBe(textAwareSortingFn);
    expect(byId(leaves, 'leafUnset').sortingFn).toBe(textAwareSortingFn);
    expect(byId(leaves, 'leafExplicit').sortingFn).toBe('alphanumeric');
  });

  it('should not mutate its input', () => {
    withTextAwareSorting(columns);
    expect('sortingFn' in columns[3]).toBe(false);
    expect(columns[2].sortingFn).toBe('auto');
  });
});

/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { localTableStateCollection } from '../../stores';
import { usePersistedColumnVisibility } from './use-persisted-column-visibility';

const HIDDEN_BY_DEFAULT = { lifeline: false, coverage: false };

describe('usePersistedColumnVisibility', () => {
  it('should return no hidden column when the table declares no default', () => {
    const { result } = renderHook(() => usePersistedColumnVisibility('use-persisted-column-visibility-none'));

    expect(result.current.columnVisibility).toEqual({});
  });

  it('should seed the declared defaults while the user has not touched the panel', () => {
    const { result } = renderHook(
      () => usePersistedColumnVisibility('use-persisted-column-visibility-default', HIDDEN_BY_DEFAULT),
    );

    expect(result.current.columnVisibility).toEqual(HIDDEN_BY_DEFAULT);
  });

  it('should let a persisted map win over the declared defaults', () => {
    const tableId = 'use-persisted-column-visibility-persisted';
    // What an existing user's stored panel looks like: they revealed the column this table hides.
    localTableStateCollection.insert({ id: tableId, columnVisibility: { lifeline: true } });

    const { result } = renderHook(() => usePersistedColumnVisibility(tableId, HIDDEN_BY_DEFAULT));

    expect(result.current.columnVisibility).toEqual({ lifeline: true });
  });

  it('should persist the whole map once the user toggles a column', () => {
    const tableId = 'use-persisted-column-visibility-toggle';
    const { result } = renderHook(() => usePersistedColumnVisibility(tableId, HIDDEN_BY_DEFAULT));

    act(() => {
      result.current.setColumnVisibility({ ...HIDDEN_BY_DEFAULT, lifeline: true });
    });

    expect(result.current.columnVisibility).toEqual({ ...HIDDEN_BY_DEFAULT, lifeline: true });
  });
});

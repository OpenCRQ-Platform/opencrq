/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { localTableStateCollection } from '../../stores';
import { usePersistedView } from './use-persisted-view';

describe('usePersistedView', () => {
  it('should return the default view when no row exists for this tableId', () => {
    const { result } = renderHook(() => usePersistedView('use-persisted-view-default', 'table', ['table', 'grid']));

    expect(result.current.view).toBe('table');
  });

  it('should return the persisted view when it is valid', () => {
    const tableId = 'use-persisted-view-valid';
    const { result } = renderHook(() => usePersistedView(tableId, 'table', ['table', 'grid']));

    act(() => {
      result.current.setView('grid');
    });

    expect(result.current.view).toBe('grid');
  });

  it('should fall back to the default view when the persisted value is stale/invalid', () => {
    const tableId = 'use-persisted-view-stale';
    // Simulates a value written by a previous app version whose set of views has since changed.
    localTableStateCollection.insert({ id: tableId, view: 'matrix' });

    const { result } = renderHook(() => usePersistedView(tableId, 'table', ['table', 'grid']));

    expect(result.current.view).toBe('table');
  });
});

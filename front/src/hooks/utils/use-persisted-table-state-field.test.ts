/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { localTableStateCollection } from '../../stores';
import { usePersistedTableStateField } from './use-persisted-table-state-field';

const usePersistedPageSizeField = (tableId: string) =>
  usePersistedTableStateField(
    tableId,
    (state) => state.pageSize,
    (draft, value: number) => {
      draft.pageSize = value;
    },
    50,
  );

const usePersistedViewField = (tableId: string) =>
  usePersistedTableStateField(
    tableId,
    (state) => state.view,
    (draft, value: string) => {
      draft.view = value;
    },
    'table',
  );

describe('usePersistedTableStateField', () => {
  it('should return the default value when no row exists for this tableId', () => {
    const { result } = renderHook(() => usePersistedPageSizeField('use-persisted-table-state-field-default'));

    expect(result.current[0]).toBe(50);
  });

  it('should insert a new row on the first write and expose the new value', () => {
    const tableId = 'use-persisted-table-state-field-insert';
    const { result } = renderHook(() => usePersistedPageSizeField(tableId));

    act(() => {
      result.current[1](100);
    });

    expect(result.current[0]).toBe(100);
    expect(localTableStateCollection.get(tableId)?.pageSize).toBe(100);
  });

  it('should update an existing row on a subsequent write', () => {
    const tableId = 'use-persisted-table-state-field-update';
    const { result } = renderHook(() => usePersistedPageSizeField(tableId));

    act(() => {
      result.current[1](100);
    });
    act(() => {
      result.current[1](200);
    });

    expect(result.current[0]).toBe(200);
  });

  it('should support functional updates against the current value', () => {
    const tableId = 'use-persisted-table-state-field-functional-update';
    const { result } = renderHook(() => usePersistedPageSizeField(tableId));

    act(() => {
      result.current[1](100);
    });
    act(() => {
      result.current[1]((current) => current + 25);
    });

    expect(result.current[0]).toBe(125);
  });

  it('should apply two synchronous functional updates in the same tick without losing the first one', () => {
    const tableId = 'use-persisted-table-state-field-same-tick';
    const { result } = renderHook(() => usePersistedPageSizeField(tableId));

    act(() => {
      result.current[1]((current) => current + 10);
      result.current[1]((current) => current + 10);
    });

    expect(result.current[0]).toBe(70);
  });

  it('should read the row of the new tableId when the caller changes it', () => {
    const first = 'use-persisted-table-state-field-key-first';
    const second = 'use-persisted-table-state-field-key-second';
    const { result, rerender } = renderHook(({ tableId }) => usePersistedPageSizeField(tableId), {
      initialProps: { tableId: first },
    });

    act(() => {
      result.current[1](100);
    });
    rerender({ tableId: second });

    expect(result.current[0]).toBe(50);

    act(() => {
      result.current[1](200);
    });
    rerender({ tableId: first });

    expect(result.current[0]).toBe(100);
  });

  it('should not clobber a field written by another hook sharing the same tableId', () => {
    const tableId = 'use-persisted-table-state-field-shared-row';
    const { result: pageSizeResult } = renderHook(() => usePersistedPageSizeField(tableId));
    const { result: viewResult } = renderHook(() => usePersistedViewField(tableId));

    act(() => {
      pageSizeResult.current[1](100);
    });
    act(() => {
      viewResult.current[1]('grid');
    });

    expect(pageSizeResult.current[0]).toBe(100);
    expect(viewResult.current[0]).toBe('grid');
  });
});

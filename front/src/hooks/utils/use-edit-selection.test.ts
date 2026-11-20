/** @vitest-environment jsdom */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useEditSelection } from './use-edit-selection';

describe('useEditSelection', () => {
  it('should start with no selection', () => {
    const { result } = renderHook(() => useEditSelection());
    expect(result.current.editId).toBeUndefined();
    expect(result.current.isEditing).toBe(false);
  });

  it('should open edit with an id', () => {
    const { result } = renderHook(() => useEditSelection());
    act(() => result.current.openEdit('abc'));
    expect(result.current.editId).toBe('abc');
    expect(result.current.isEditing).toBe(true);
  });

  it('should close edit', () => {
    const { result } = renderHook(() => useEditSelection());
    act(() => result.current.openEdit('abc'));
    act(() => result.current.closeEdit());
    expect(result.current.editId).toBeUndefined();
    expect(result.current.isEditing).toBe(false);
  });

  it('should switch selection', () => {
    const { result } = renderHook(() => useEditSelection());
    act(() => result.current.openEdit('abc'));
    act(() => result.current.openEdit('xyz'));
    expect(result.current.editId).toBe('xyz');
  });
});

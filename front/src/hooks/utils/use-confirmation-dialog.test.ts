/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useConfirmationDialog } from './use-confirmation-dialog';

describe('useConfirmationDialog', () => {
  it('should start in closed state', () => {
    const { result } = renderHook(() => useConfirmationDialog());
    expect(result.current.isOpen).toBe(false);
    expect(result.current.pendingId).toBeNull();
  });

  it('should open with pending ID when requestConfirmation is called', () => {
    const { result } = renderHook(() => useConfirmationDialog());

    act(() => {
      result.current.requestConfirmation('entity-123');
    });

    expect(result.current.isOpen).toBe(true);
    expect(result.current.pendingId).toBe('entity-123');
  });

  it('should close and return ID on confirm', () => {
    const { result } = renderHook(() => useConfirmationDialog());

    act(() => {
      result.current.requestConfirmation('entity-123');
    });

    let confirmedId: string | null = null;
    act(() => {
      confirmedId = result.current.confirm();
    });

    expect(confirmedId).toBe('entity-123');
    expect(result.current.isOpen).toBe(false);
    expect(result.current.pendingId).toBeNull();
  });

  it('should close and clear ID on cancel', () => {
    const { result } = renderHook(() => useConfirmationDialog());

    act(() => {
      result.current.requestConfirmation('entity-123');
    });

    act(() => {
      result.current.cancel();
    });

    expect(result.current.isOpen).toBe(false);
    expect(result.current.pendingId).toBeNull();
  });

  it('should return null when confirming without pending ID', () => {
    const { result } = renderHook(() => useConfirmationDialog());

    let confirmedId: string | null = 'initial';
    act(() => {
      confirmedId = result.current.confirm();
    });

    expect(confirmedId).toBeNull();
  });

  it('should allow re-requesting after cancel', () => {
    const { result } = renderHook(() => useConfirmationDialog());

    act(() => {
      result.current.requestConfirmation('entity-1');
    });
    act(() => {
      result.current.cancel();
    });
    act(() => {
      result.current.requestConfirmation('entity-2');
    });

    expect(result.current.isOpen).toBe(true);
    expect(result.current.pendingId).toBe('entity-2');
  });
});

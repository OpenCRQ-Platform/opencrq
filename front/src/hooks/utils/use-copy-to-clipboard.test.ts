/** @vitest-environment jsdom */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCopyToClipboard } from './use-copy-to-clipboard';

describe('useCopyToClipboard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should start with copied = false', () => {
    const { result } = renderHook(() => useCopyToClipboard());
    expect(result.current.copied).toBe(false);
  });

  it('should set copied = true after copy', async () => {
    const { result } = renderHook(() => useCopyToClipboard());
    await act(async () => {
      await result.current.copy('test');
    });
    expect(result.current.copied).toBe(true);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('test');
  });

  it('should reset copied after delay', async () => {
    const { result } = renderHook(() => useCopyToClipboard(1000));
    await act(async () => {
      await result.current.copy('test');
    });
    expect(result.current.copied).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.copied).toBe(false);
  });

  it('should reset timer on subsequent copies', async () => {
    const { result } = renderHook(() => useCopyToClipboard(1000));
    await act(async () => {
      await result.current.copy('first');
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.copied).toBe(true);
    await act(async () => {
      await result.current.copy('second');
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    // Should still be true because timer was reset
    expect(result.current.copied).toBe(true);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.copied).toBe(false);
  });

  it('should clear timer on unmount', async () => {
    const { result, unmount } = renderHook(() => useCopyToClipboard(1000));
    await act(async () => {
      await result.current.copy('test');
    });
    expect(result.current.copied).toBe(true);
    unmount();
    // Timer should be cleared, no React warning about setState on unmounted component
    act(() => {
      vi.advanceTimersByTime(1000);
    });
  });

  it('should handle clipboard API failure gracefully', async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error('Permission denied')),
      },
    });
    const { result } = renderHook(() => useCopyToClipboard());
    await act(async () => {
      await result.current.copy('test');
    });
    // Should remain false when clipboard fails
    expect(result.current.copied).toBe(false);
  });
});

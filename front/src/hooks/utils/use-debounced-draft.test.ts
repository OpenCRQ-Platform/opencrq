/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reconcileDraft, useDebouncedDraft } from './use-debounced-draft';

describe('reconcileDraft', () => {
  it('should keep the draft when the URL has not changed', () => {
    expect(reconcileDraft({ committed: 'vpn', draft: 'vp', lastCommitted: 'vpn' })).toBe('vp');
  });

  it('should adopt the URL value when the URL has changed', () => {
    expect(reconcileDraft({ committed: 'firewall', draft: 'vp', lastCommitted: 'vpn' })).toBe('firewall');
  });

  it('should not crash when the URL changes to the draft value', () => {
    expect(reconcileDraft({ committed: 'vpn', draft: 'vpn', lastCommitted: 'firewall' })).toBe('vpn');
  });
});

describe('useDebouncedDraft', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should call commit once with the last value after a burst of setValue calls', () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useDebouncedDraft('', commit));

    act(() => {
      result.current.setValue('v');
      result.current.setValue('vp');
      result.current.setValue('vpn');
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith('vpn');
  });

  it('should reflect each setValue immediately, before the deadline', () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useDebouncedDraft('', commit));

    act(() => {
      result.current.setValue('vpn');
    });

    expect(result.current.value).toBe('vpn');
    expect(commit).not.toHaveBeenCalled();
  });

  it('should follow an externally changed committed value and cancel the pending commit', () => {
    const commit = vi.fn();
    const { result, rerender } = renderHook(
      ({ committed }) => useDebouncedDraft(committed, commit),
      { initialProps: { committed: '' } },
    );

    act(() => {
      result.current.setValue('vpn');
    });
    rerender({ committed: 'firewall' });

    expect(result.current.value).toBe('firewall');

    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(commit).not.toHaveBeenCalled();
  });

  it('should keep a more recent draft when committed echoes the hook\'s own earlier commit', () => {
    const commit = vi.fn();
    const { result, rerender } = renderHook(
      ({ committed }) => useDebouncedDraft(committed, commit),
      { initialProps: { committed: '' } },
    );

    act(() => {
      result.current.setValue('vpn');
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(commit).toHaveBeenCalledWith('vpn');

    act(() => {
      result.current.setValue('vpn2');
    });
    rerender({ committed: 'vpn' });

    expect(result.current.value).toBe('vpn2');

    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(commit).toHaveBeenLastCalledWith('vpn2');
  });

  it('should not call commit when the value is already the committed one', () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useDebouncedDraft('vpn', commit));

    act(() => {
      result.current.setValue('vpn');
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(commit).not.toHaveBeenCalled();
  });

  it('should keep the just-committed value across a rerender where committed has not caught up yet', () => {
    const commit = vi.fn();
    const { result, rerender } = renderHook(
      ({ committed }) => useDebouncedDraft(committed, commit),
      { initialProps: { committed: '' } },
    );

    act(() => {
      result.current.setValue('vpn');
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(commit).toHaveBeenCalledWith('vpn');
    expect(result.current.value).toBe('vpn');

    rerender({ committed: '' });

    expect(result.current.value).toBe('vpn');
  });

  it('should commit an empty value when the draft is cleared', () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useDebouncedDraft('vpn', commit));

    act(() => {
      result.current.setValue('');
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(commit).toHaveBeenCalledWith('');
  });

  it('should never call commit if the component unmounts before the deadline', () => {
    const commit = vi.fn();
    const { result, unmount } = renderHook(() => useDebouncedDraft('', commit));

    act(() => {
      result.current.setValue('vpn');
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(commit).not.toHaveBeenCalled();
  });

  it('should commit a draft still in flight when the field loses focus', () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useDebouncedDraft('', commit));

    act(() => {
      result.current.setValue('vpn');
    });
    act(() => {
      result.current.onBlur();
    });

    expect(commit).toHaveBeenCalledWith('vpn');

    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('should not commit when the field loses focus with nothing typed since the last commit', () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useDebouncedDraft('vpn', commit));

    act(() => {
      result.current.onBlur();
    });
    act(() => {
      result.current.setValue('vpn');
    });
    act(() => {
      result.current.onBlur();
    });

    expect(commit).not.toHaveBeenCalled();
  });
});

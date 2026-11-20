/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDelayedFlag } from './use-delayed-flag';

const OPTIONS = { delay: 250, minDuration: 200 };

const renderFlag = () => renderHook(
  ({ active }) => useDelayedFlag(active, OPTIONS),
  { initialProps: { active: false } },
);

const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

describe('useDelayedFlag', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should stay off when active drops before the delay', () => {
    const { result, rerender } = renderFlag();

    rerender({ active: true });
    advance(249);
    rerender({ active: false });
    advance(1000);

    expect(result.current).toBe(false);
  });

  it('should turn on once active has held for the delay', () => {
    const { result, rerender } = renderFlag();

    rerender({ active: true });
    advance(249);
    expect(result.current).toBe(false);

    advance(1);
    expect(result.current).toBe(true);
  });

  it('should stay on for the minimum duration although active dropped right after it turned on', () => {
    const { result, rerender } = renderFlag();

    rerender({ active: true });
    advance(250);
    rerender({ active: false });
    advance(199);
    expect(result.current).toBe(true);

    advance(1);
    expect(result.current).toBe(false);
  });

  it('should turn off right away when active drops after the minimum duration', () => {
    const { result, rerender } = renderFlag();

    rerender({ active: true });
    advance(250 + 500);
    rerender({ active: false });
    advance(0);

    expect(result.current).toBe(false);
  });

  it('should never turn on while active flips faster than the delay', () => {
    const { result, rerender } = renderFlag();

    for (let i = 0; i < 5; i += 1) {
      rerender({ active: true });
      advance(200);
      rerender({ active: false });
      advance(100);
    }

    expect(result.current).toBe(false);
  });
});

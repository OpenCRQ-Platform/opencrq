/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTweened } from './use-tweened';

const DURATION = 400;

let pending = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
let reducedMotion = false;

const frame = (now: number) => {
  act(() => {
    const callbacks = [...pending.values()];
    pending = new Map();
    callbacks.forEach((callback) => callback(now));
  });
};

const renderTween = () => renderHook(({ target }) => useTweened(target, DURATION), { initialProps: { target: 0 } });

describe('useTweened', () => {
  beforeEach(() => {
    pending = new Map();
    reducedMotion = false;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextFrame++;
      pending.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      pending.delete(id);
    });
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: reducedMotion, media: query }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should cross from 0 to 1 in the duration, then stop asking for frames', () => {
    const { result, rerender } = renderTween();
    frame(0);

    rerender({ target: 1 });
    frame(1000);
    expect(result.current).toBe(0);
    frame(1100);
    expect(result.current).toBeCloseTo(0.25);
    frame(1400);
    expect(result.current).toBe(1);
    expect(pending.size).toBe(0);
  });

  it('should turn back from where it stands when the target reverses mid-way, cancelling the frame in flight', () => {
    const { result, rerender } = renderTween();
    frame(0);
    rerender({ target: 1 });
    frame(1000);
    frame(1200);
    expect(result.current).toBeCloseTo(0.5);

    rerender({ target: 0 });
    expect(pending.size).toBe(1);
    frame(2000);
    expect(result.current).toBeCloseTo(0.5);
    frame(2100);
    expect(result.current).toBeCloseTo(0.25);
  });

  it('should jump to the target on the first frame under reduced motion', () => {
    reducedMotion = true;
    const { result, rerender } = renderTween();
    frame(0);

    rerender({ target: 1 });
    frame(1000);

    expect(result.current).toBe(1);
    expect(pending.size).toBe(0);
  });

  it('should cancel its frame on unmount', () => {
    const { rerender, unmount } = renderTween();
    frame(0);
    rerender({ target: 1 });

    unmount();

    expect(pending.size).toBe(0);
  });
});
